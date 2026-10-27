"""Segment efforts: finding complete, in-order passes of a named segment in a person's own GPS recordings (#278, #286).

How a pass is found (matcher version MATCHER; docs/segments.md has the full rules and the reasoning behind each number):
 1. Start: the recording crosses the start line in the segment's direction, within START_R metres of the start. The
    crossing time is interpolated between the two fixes on either side, so it does not depend on when a fix happened to
    land. A recording that begins right on the start (within ON_LINE metres) starts there.
 2. Course: every fix after the start stays within CORRIDOR metres of the segment path, moving forward along it. Each
    fix is matched only to the nearby stretch of path just ahead of the previous one, so a parallel road, the other leg
    of a switchback or the other loop of a figure-eight can't stand in for the real path. Going backwards more than
    BACKTRACK metres, a gap over MAX_GAP_S seconds, or fixes too far apart to show the path (SPARSE) end the attempt.
 3. Finish: the same crossing test at the finish line, after covering the whole path.
 4. Time: finish crossing minus start crossing (elapsed, so stopping never helps), rounded to whole seconds with halves
    rounded up. The unrounded value is kept privately and is never a tie-breaker.
 5. Checks (#286): wrong sport or an assisted/virtual ride never counts. A jump faster than the sport allows, or an
    average faster than PLAUSIBLE, is held for review: not a public result until an admin looks, and never an accusation.
A recording can pass a segment several times; passes never overlap. Phone/watch copies of one workout are de-duplicated.
"""
import bisect
import hashlib
import json
import logging
import math
import threading
import time

import numpy as np

from . import db, route_geo
from .analysis import MAX_SPEED

log = logging.getLogger(__name__)
MATCHER = 2
STEP = 5.0              # the segment path is measured at a point every 5 m
START_R = 25.0          # how close the recording must pass the start and finish
ON_LINE = 10.0
CORRIDOR = 35.0         # how far a fix may stray from the path (phone GPS in town is often 10-20 m out)
FAR = 80.0              # one fix this far off ends the attempt
OUTLIERS = 0.05         # share of fixes allowed between CORRIDOR and FAR
BACKTRACK = 60.0
MAX_GAP_S = 30.0
SPARSE = {'run': 60.0, 'walk': 60.0, 'hike': 60.0, 'ride': 150.0}
SPARSE_S = 25.0
PLAUSIBLE = {'run': (7.5, 10.5), 'walk': (3.3, 3.3), 'hike': (3.5, 3.5), 'ride': (22.0, 22.0)}   # m/s average: (1 km+, shorter)
MIN_M, MAX_M = 100.0, 50_000.0
ASSISTED = ('e-bike', 'ebike', 'e_bike', 'electric', 'virtual', 'indoor', 'motor', 'trainer', 'zwift')
REASONS = {
    'invalid_times': 'The GPS timestamps are missing, non-finite or go backwards. The recording needs correction.',
    'recomputed': 'This pass no longer matches the current recording and course checks.',
    'wrong_sport': 'A different sport from this segment.',
    'assisted': 'Assisted, virtual or indoor rides compete separately.',
    'gap': 'The recording has a gap on the segment.',
    'sparse': 'The GPS points are too far apart on the segment to be sure of the path.',
    'left_course': 'The recording leaves the segment path.',
    'wrong_direction': 'The recording goes the wrong way along part of the segment.',
    'incomplete': 'The recording doesn\'t cover the whole segment, start to finish.',
    'no_start': 'The recording doesn\'t cross the segment start.',
    'speed_jump': 'The recording jumps faster than this sport allows. Held for review.',
    'fast': 'Faster than usual for this sport. Held for review.',
    'duplicate': 'Another copy of this workout already has this time.',
    'no_times': 'This workout has no GPS times, so no segment time can be worked out.',
}


def fingerprint(name, description, sport, points):
    data = json.dumps({'n': name, 'd': description or '', 's': sport, 'p': [[round(a, 6), round(b, 6)] for a, b in points], 'm': MATCHER},
                      separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(data.encode()).hexdigest()


def sport_fit(segment_sport, sport, label=None):
    """None if this activity may compete on a segment of this sport, else the reason it can't."""
    if sport != segment_sport: return 'wrong_sport'
    if sport == 'ride' and any(k in (label or '').lower() for k in ASSISTED): return 'assisted'
    return None


class Course:
    """A segment path in local metres, with a vertex every STEP metres."""
    def __init__(self, points):
        self.lat0, self.lon0 = points[0]
        self.kx = 111_320 * math.cos(math.radians(self.lat0)); self.ky = 110_540
        xy = np.array([self.xy(p) for p in points], dtype=float)
        seg = np.hypot(*np.diff(xy, axis=0).T) if len(xy) > 1 else np.zeros(0)
        cum = np.concatenate([[0.0], np.cumsum(seg)])
        self.length = float(cum[-1])
        m = np.arange(0.0, self.length + STEP / 2, STEP)
        if m[-1] < self.length: m = np.append(m, self.length)
        m[-1] = self.length
        self.m = m
        self.v = np.column_stack([np.interp(m, cum, xy[:, 0]), np.interp(m, cum, xy[:, 1])])
        self.t0 = self._unit(self.v[min(len(self.v) - 1, 4)] - self.v[0])          # direction over the first ~20 m
        self.t1 = self._unit(self.v[-1] - self.v[max(0, len(self.v) - 5)])         # and the last ~20 m

    @staticmethod
    def _unit(d):
        n = float(np.hypot(*d)); return d / n if n else np.array([1.0, 0.0])

    def xy(self, p): return ((p[1] - self.lon0) * self.kx, (p[0] - self.lat0) * self.ky)

    def latlon(self, x, y): return [float(self.lat0 + y / self.ky), float(self.lon0 + x / self.kx)]

    def nearest(self, x, y, lo_m, hi_m):
        """Nearest path vertex with measure in [lo_m, hi_m]: (distance, measure)."""
        i = max(0, bisect.bisect_left(self.m, lo_m)); j = min(len(self.m), bisect.bisect_right(self.m, hi_m) + 1)
        if i >= j: i, j = max(0, j - 1), j
        d = np.hypot(self.v[i:j, 0] - x, self.v[i:j, 1] - y); k = int(np.argmin(d))
        return float(d[k]), float(self.m[i + k])

    def overlap_share(self):
        """Share of the path that runs back over another part of itself (an out-and-back can't be one segment)."""
        v, m, n = self.v, self.m, len(self.m)
        if n < 4: return 0.0
        hits = 0
        for i in range(0, n, 2):
            d = np.hypot(v[:, 0] - v[i, 0], v[:, 1] - v[i, 1])
            if np.any((d < 12) & (np.abs(m - m[i]) > 60)): hits += 1
        return hits / len(range(0, n, 2))


def check_path(points):
    """Problems that stop a path becoming a segment (an empty list when it's fine). Never alters the path."""
    if len(points) < 2: return ['Draw at least two points.']
    c = Course(points); out = []
    if c.length < MIN_M: out.append('Segments must be at least 100 m long.')
    if c.length > MAX_M: out.append('Segments can be up to 50 km long.')
    if c.length >= MIN_M and math.hypot(*(c.v[-1] - c.v[0])) < 40:
        out.append('The start and finish are in the same place. Segments run from one place to another; choose a finish further along.')
    if c.length >= MIN_M and c.overlap_share() > 0.15:
        out.append('This path goes back over itself. Choose a stretch that runs one way.')
    return out


def _cross(u_prev, u, t_prev, t):
    f = -u_prev / (u - u_prev) if u != u_prev else 0.0
    return t_prev + f * (t - t_prev), f


def match(points, sport, t, lat, lon):
    """Complete passes of the path `points` in a recording. Returns (passes, reason when there were none)."""
    if not t or not lat: return [], 'no_times'
    c = Course(points)
    idx = [i for i in range(min(len(t), len(lat), len(lon))) if t[i] is not None and lat[i] is not None and lon[i] is not None
           and route_geo.valid([lat[i], lon[i]]) and not (lat[i] == 0 and lon[i] == 0)]
    if len(idx) < 2: return [], 'no_times'
    T = np.array([float(t[i]) for i in idx]); P = np.array([c.xy([lat[i], lon[i]]) for i in idx])
    # A summary duration cannot repair an unreliable recording clock. Keep it out rather than invent elapsed time.
    if not np.isfinite(T).all() or np.any(np.diff(T) <= 0): return [], 'invalid_times'
    S0, S1 = c.v[0], c.v[-1]
    u0 = (P - S0) @ c.t0; d0 = np.hypot(*(P - S0).T)
    u1 = (P - S1) @ c.t1; d1 = np.hypot(*(P - S1).T)
    vmax, sparse = MAX_SPEED.get(sport, 30.0), SPARSE.get(sport, 60.0)
    passes, why, k, n = [], 'no_start', 0, len(idx)
    while k < n:
        # the next start crossing at or after k
        start = None
        for j in range(max(k, 1), n):
            if (d0[j] <= START_R or d0[j - 1] <= START_R) and u0[j - 1] < 0 <= u0[j] and T[j] - T[j - 1] <= MAX_GAP_S:
                ts, f = _cross(u0[j - 1], u0[j], T[j - 1], T[j]); start = (j, ts, P[j - 1] + f * (P[j] - P[j - 1])); break
        if start is None and k == 0 and d0[0] <= ON_LINE and u0[0] >= 0:
            start = (0, T[0], P[0])
        if start is None: break
        j0, ts, sp = start
        res = _follow(c, T, P, d1, u1, j0, ts, sport, vmax, sparse)
        if res.get('reason'):
            why = res['reason']; k = j0 + 1; continue
        je, te, ep = res['end']
        elapsed = te - ts
        if elapsed <= 0: k = j0 + 1; continue
        speed = c.length / elapsed
        long_cap, short_cap = PLAUSIBLE.get(sport, (30.0, 30.0))
        state, reason = 'ok', None
        if res['jump']: state, reason = 'held', 'speed_jump'
        elif speed > (long_cap if c.length >= 1000 else short_cap): state, reason = 'held', 'fast'
        passes.append({'start_i': int(idx[max(0, j0 - 1)] if j0 else idx[0]), 'end_i': int(idx[je]), 't_start': float(ts), 't_end': float(te),
                       'elapsed_raw': round(float(elapsed), 3), 'elapsed_s': max(1, int(math.floor(elapsed + 0.5))),
                       'start_pt': c.latlon(*sp), 'end_pt': c.latlon(*ep), 'state': state, 'reason': reason,
                       'avg_speed': round(float(speed), 2), 'max_step_speed': round(float(res['max_step']), 2), 'fixes': je - j0 + 1})
        k = je + 1
    return passes, None if passes else why


def _follow(c, T, P, d1, u1, j0, ts, sport, vmax, sparse):
    """Walk the recording along the path from a start crossing at fix j0 until the finish crossing."""
    m_prev = m_max = 0.0; out = fixes = 0; jump = False; max_step = 0.0
    for j in range(j0, len(T)):
        if j > j0:
            dt = T[j] - T[j - 1]; step = float(np.hypot(*(P[j] - P[j - 1])))
            if dt > MAX_GAP_S: return {'reason': 'gap'}
            if dt > SPARSE_S or step > sparse: return {'reason': 'sparse'}
            if dt > 0:
                max_step = max(max_step, step / dt)
                if step / dt > vmax: jump = True
            # the finish: crossing its line after covering (almost) the whole path
            if m_max >= c.length - 2 * START_R and (d1[j] <= START_R or d1[j - 1] <= START_R) and u1[j - 1] < 0 <= u1[j]:
                te, f = _cross(u1[j - 1], u1[j], T[j - 1], T[j])
                return {'end': (j, te, P[j - 1] + f * (P[j] - P[j - 1])), 'jump': jump, 'max_step': max_step}
            if T[j] - ts > 12 * 3600: return {'reason': 'incomplete'}
        else: dt = 1.0
        ahead = max(80.0, vmax * max(dt, 1.0) * 1.5 + 30.0)
        d, m = c.nearest(P[j][0], P[j][1], m_prev - BACKTRACK, m_prev + ahead)
        fixes += 1
        if d > FAR: return {'reason': 'left_course'}
        if d > CORRIDOR:
            out += 1
            if out > max(1, OUTLIERS * fixes): return {'reason': 'left_course'}
            continue
        if m < m_max - BACKTRACK: return {'reason': 'wrong_direction'}
        m_prev = m; m_max = max(m_max, m)
    # the recording ends on the finish (stopped the watch right there)
    j = len(T) - 1
    if m_max >= c.length - 2 * START_R and d1[j] <= ON_LINE:
        return {'end': (j, T[j], P[j]), 'jump': jump, 'max_step': max_step}
    return {'reason': 'incomplete'}


# ---------- applying matches to the database ----------
def lock_people(c, ids):
    """Deletion locks accounts before their courses. Workers follow that order before adding personal rows."""
    if ids: c.execute('SELECT id FROM users WHERE id=ANY(%s) ORDER BY id FOR KEY SHARE',(sorted(set(ids)),)).fetchall()


def lock_match_people(c,sids,aids):
    ids=[r['id'] for r in c.execute('''SELECT creator_id AS id FROM segments WHERE id=ANY(%s) AND creator_id IS NOT NULL
      UNION SELECT user_id FROM activities WHERE id=ANY(%s)''',(sids,aids)).fetchall()]
    lock_people(c,ids)


def _segment_points(c, sid):
    r = c.execute('SELECT ST_AsGeoJSON(geom) AS g, sport FROM segments WHERE id = %s', (sid,)).fetchone()
    if not r or not r['g']: return None, None
    return [[la, lo] for lo, la in json.loads(r['g'])['coordinates']], r['sport']


def calculate(c, sid, aid, points=None, seg_sport=None):
    """Read and match one source revision. Source locks also fence concurrent stream replacement/deletion."""
    if points is None: points, seg_sport = _segment_points(c, sid)
    if not points: return None
    a = c.execute("""SELECT user_id,sport,sport_label,start_time,segment_revision FROM activities WHERE id=%s FOR SHARE""", (aid,)).fetchone()
    if not a: return None
    stream=c.execute('SELECT t,lat,lon FROM activity_streams WHERE activity_id=%s',(aid,)).fetchone()
    a.update(stream or {'t':None,'lat':None,'lon':None})
    bad = sport_fit(seg_sport, a['sport'], a['sport_label'])
    passes, why = ([], bad) if bad else match(points, seg_sport, a['t'], a['lat'], a['lon'])
    for p in passes:
        p['started'] = a['start_time'].timestamp() + p['t_start']
        p.update(c.execute("""SELECT ST_Length(a.geom::geography) AS line_m,
          ST_LineLocatePoint(a.geom,q.sp)*ST_Length(a.geom::geography) AS start_m,
          ST_LineLocatePoint(a.geom,q.ep)*ST_Length(a.geom::geography) AS end_m,
          coalesce(ST_DWithin(a.geom::geography,q.sp::geography,30) AND ST_DWithin(a.geom::geography,q.ep::geography,30),false) AS on_line
          FROM activities a, LATERAL (SELECT ST_SetSRID(ST_MakePoint(%s,%s),4326) AS sp,
            ST_SetSRID(ST_MakePoint(%s,%s),4326) AS ep) q WHERE a.id=%s""",
          (p['start_pt'][1],p['start_pt'][0],p['end_pt'][1],p['end_pt'][0],aid)).fetchone())
    return a, passes, 'match' if passes else 'ineligible' if bad else 'none', None if passes else why


def scan(c, sid, aid, points=None, seg_sport=None):
    """Replace the current derived answer, retaining moderation and appeal identity on the same pass."""
    from .segment_rebuilds import lock_state
    lock_match_people(c,[sid],[aid])
    g = lock_state(c,sid)
    if not g or g['active_matcher'] != MATCHER: return
    data = calculate(c,sid,aid,points,seg_sport)
    if not data: return
    a,passes,outcome,why = data
    uid,revision = a['user_id'],a['segment_revision']
    keep=[]
    for p in passes:
        state,reason=p['state'],p['reason']
        dup = c.execute("""SELECT 1 FROM segment_efforts WHERE segment_id=%s AND generation=%s AND user_id=%s AND activity_id<%s
          AND reason IS DISTINCT FROM 'recomputed' AND abs(extract(epoch FROM started)-%s)<30
          AND abs(elapsed_s-%s)<=greatest(3,%s*0.05)""",(sid,g['active'],uid,aid,p['started'],p['elapsed_s'],p['elapsed_s'])).fetchone()
        if dup: state,reason='excluded','duplicate'
        c.execute("""INSERT INTO segment_efforts(segment_id,user_id,activity_id,start_i,end_i,started,elapsed_raw,elapsed_s,matcher,state,reason,
            on_line,start_m,end_m,line_m,generation,source_revision)
          VALUES(%s,%s,%s,%s,%s,to_timestamp(%s),%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
          ON CONFLICT(segment_id,activity_id,start_i) DO UPDATE SET
            state=CASE WHEN segment_efforts.reason='reviewed' AND segment_efforts.matcher=EXCLUDED.matcher
              AND segment_efforts.source_revision=EXCLUDED.source_revision AND segment_efforts.elapsed_raw=EXCLUDED.elapsed_raw
              AND segment_efforts.end_i=EXCLUDED.end_i AND segment_efforts.started=EXCLUDED.started AND EXCLUDED.reason IS DISTINCT FROM 'duplicate'
              THEN 'ok' ELSE EXCLUDED.state END,
            reason=CASE WHEN segment_efforts.reason='reviewed' AND segment_efforts.matcher=EXCLUDED.matcher
              AND segment_efforts.source_revision=EXCLUDED.source_revision AND segment_efforts.elapsed_raw=EXCLUDED.elapsed_raw
              AND segment_efforts.end_i=EXCLUDED.end_i AND segment_efforts.started=EXCLUDED.started AND EXCLUDED.reason IS DISTINCT FROM 'duplicate'
              THEN 'reviewed' ELSE EXCLUDED.reason END,
            end_i=EXCLUDED.end_i,started=EXCLUDED.started,elapsed_raw=EXCLUDED.elapsed_raw,elapsed_s=EXCLUDED.elapsed_s,
            matcher=EXCLUDED.matcher,on_line=EXCLUDED.on_line,start_m=EXCLUDED.start_m,end_m=EXCLUDED.end_m,line_m=EXCLUDED.line_m,
            generation=EXCLUDED.generation,source_revision=EXCLUDED.source_revision,rev=segment_efforts.rev+1""",
          (sid,uid,aid,p['start_i'],p['end_i'],p['started'],p['elapsed_raw'],p['elapsed_s'],MATCHER,state,reason,
           p['on_line'],p['start_m'],p['end_m'],p['line_m'],g['active'],revision))
        keep.append(p['start_i'])
    # A vanished pass remains private with its moderation/appeal receipt, never an eligible old time.
    c.execute("""UPDATE segment_efforts SET state='excluded',reason='recomputed',generation=%s,source_revision=%s,rev=rev+1
      WHERE segment_id=%s AND activity_id=%s AND NOT(start_i=ANY(%s))""",(g['active'],revision,sid,aid,keep))
    c.execute("""INSERT INTO segment_scans(segment_id,activity_id,user_id,matcher,outcome,reason,generation,source_revision)
      VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(segment_id,activity_id) DO UPDATE SET
      matcher=EXCLUDED.matcher,outcome=EXCLUDED.outcome,reason=EXCLUDED.reason,scanned=now(),
      generation=EXCLUDED.generation,source_revision=EXCLUDED.source_revision""",(sid,aid,uid,MATCHER,outcome,why,g['active'],revision))


# Segments an activity could pass: active, the activity's owner may use them (published, or their own private one),
# and the path runs near the recording. The sport check happens in scan() so a mismatch can be explained.
NEAR = """s.status = 'active' AND s.geom IS NOT NULL AND (s.audience = 'everyone' OR s.creator_id = a.user_id)
          AND s.geom && ST_Expand(a.geom, 0.002) AND ST_DWithin(ST_StartPoint(s.geom)::geography, a.geom::geography, 60)
          AND ST_DWithin(ST_EndPoint(s.geom)::geography, a.geom::geography, 60)"""
BATCH = 150


def activity_job(c, aid):
    rows=c.execute(f'''SELECT s.id FROM segments s,activities a WHERE a.id=%s AND s.status='active' AND s.geom IS NOT NULL
        AND ((a.geom IS NOT NULL AND {NEAR}) OR EXISTS(SELECT 1 FROM segment_efforts e WHERE e.segment_id=s.id AND e.activity_id=a.id)) ORDER BY s.id''',(aid,)).fetchall()
    lock_match_people(c,[s['id'] for s in rows],[aid])
    for s in rows:
        scan(c, s['id'], aid)
    return True


def segment_job(c, sid, cursor):
    """Backfill one batch of past activities for a segment. Returns the new cursor, or None when finished."""
    points, sport = _segment_points(c, sid)
    if not points: return None
    rows = c.execute(f"""SELECT a.id FROM activities a, segments s WHERE s.id = %s AND a.id > %s AND a.geom IS NOT NULL AND a.sport = s.sport
                         AND {NEAR} ORDER BY a.id LIMIT %s""", (sid, cursor, BATCH)).fetchall()
    lock_match_people(c,[sid],[r['id'] for r in rows])
    for r in rows: scan(c, sid, r['id'], points, sport)
    return rows[-1]['id'] if len(rows) == BATCH else None


def run_jobs(limit=10):
    """Do up to `limit` waiting jobs. Each runs in its own transaction; a failing job is retried a few times, then kept
    (with its error) for the operator, without blocking the others. Returns how many jobs it touched."""
    done = 0
    for _ in range(limit):
        with db.connect() as c:
            j = c.execute("""SELECT id, kind, ref, cursor, attempts, epoch FROM segment_jobs WHERE attempts < 5
                             ORDER BY (kind = 'segment'), id FOR UPDATE SKIP LOCKED LIMIT 1""").fetchone()
            if not j: break
            try:
                with c.transaction():
                    if j['kind'] == 'activity':
                        activity_job(c, j['ref']); c.execute('DELETE FROM segment_jobs WHERE id = %s', (j['id'],))
                    elif j['kind'] == 'rebuild':
                        from .segment_rebuilds import run_batch
                        if run_batch(c,j['ref'],j['epoch']): c.execute('DELETE FROM segment_jobs WHERE id=%s',(j['id'],))
                    else:
                        nxt = segment_job(c, j['ref'], j['cursor'])
                        if nxt is None: c.execute('DELETE FROM segment_jobs WHERE id = %s', (j['id'],))
                        else: c.execute('UPDATE segment_jobs SET cursor = %s WHERE id = %s', (nxt, j['id']))
            except Exception as e:      # noqa: BLE001 - kept for the operator; the next job still runs
                log.exception('segment job %s failed', j['id'])
                c.execute('UPDATE segment_jobs SET attempts = attempts + 1, last_error = %s WHERE id = %s', (type(e).__name__, j['id']))
        done += 1
    return done


def worker(stop):
    while not stop.is_set():
        try: busy = run_jobs()
        except Exception:      # noqa: BLE001 - the database may be restarting
            log.exception('segment worker'); busy = 0
        stop.wait(0.5 if busy else 4)


def start_worker():
    stop = threading.Event(); t = threading.Thread(target=worker, args=(stop,), daemon=True); t.start()
    return stop, t
