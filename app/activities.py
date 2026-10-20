"""Save an activity: analyse it, skip duplicates, store streams + best efforts, match it to a route.

Matched routes (like Strava's Matched Activities): same sport family, start and finish within 200 m, distance within 7 %,
and the same path in the same direction (discrete Fréchet distance of the simplified lines < ~250 m).
"""
from contextlib import nullcontext
import datetime as dt
import bisect
import hashlib
import json
import math
import os
from zoneinfo import ZoneInfo

from . import analysis, db

DATA = os.environ.get('FIT_DATA', '/data')
SPORT_GROUP = {'run': 'run', 'walk': 'foot', 'hike': 'foot', 'ride': 'ride', 'swim': 'swim', 'row': 'row', 'ski': 'ski',
               'workout': 'workout', 'other': 'other'}
MI = 1609.344


def num(v, as_int=False):
    """float/int for the database; NaN/inf (e.g. averages of empty data) become NULL."""
    if v is None: return None
    v = float(v)
    if not math.isfinite(v): return None
    return int(round(v)) if as_int else v


def default_name(start, tz, sport, label=None):
    h = start.astimezone(ZoneInfo(tz)).hour
    part = 'Morning' if 5 <= h < 11 else 'Lunch' if 11 <= h < 14 else 'Afternoon' if 14 <= h < 18 else 'Evening' if 18 <= h < 22 else 'Night'
    # a workout or other activity is named after its kind when there is one (2026-10-13, Ben): "Lunch Yoga", not "Lunch Workout"
    label = (label or '').strip()
    if sport in ('workout', 'other') and label and label != 'Strength Training' and len(label) <= 24:
        return f"{part} {label}"
    return f"{part} {({'run': 'Run', 'ride': 'Ride', 'walk': 'Walk', 'hike': 'Hike', 'swim': 'Swim', 'row': 'Row', 'ski': 'Ski',
                      'workout': 'Workout'}).get(sport, 'Activity')}"


def profile_of(c, user_id):
    p = c.execute('SELECT max_hr, rest_hr, sex, tz, share_default FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}
    p = dict(p)
    if not p.get('max_hr'):   # until set by hand: the highest believable HR seen (P99.5 of activity maxima), else 190
        r = c.execute("""SELECT percentile_cont(0.995) WITHIN GROUP (ORDER BY max_hr) AS m FROM activities
                         WHERE user_id = %s AND max_hr BETWEEN 120 AND 220""", (user_id,)).fetchone()
        p['max_hr'] = round(r['m']) if r and r['m'] else 190
    return p


def find_duplicate(c, user_id, start, distance_m, sport=None, elapsed_s=None):
    rows = c.execute("""SELECT id, start_time, distance_m, elapsed_s, sport, auto_name, source, summary_original, summary_overrides FROM activities WHERE user_id = %s
                        AND start_time BETWEEN %s AND %s""",
                     (user_id, start - dt.timedelta(minutes=2), start + dt.timedelta(minutes=2))).fetchall()
    from . import activity_corrections as corrections
    for r in rows:
        r=corrections.original(r)
        if sport and sport != r['sport']: continue
        if elapsed_s and r['elapsed_s'] and abs(elapsed_s - r['elapsed_s']) > max(120, r['elapsed_s'] * .1): continue
        if r['distance_m'] is None and elapsed_s and r['elapsed_s'] and abs((r['start_time']-start).total_seconds())<=30:return r
        a, b = r['distance_m'] or 0, distance_m or 0
        if (a < 50 and b < 50) or (max(a, b) > 0 and min(a, b) / max(a, b) > 0.85):
            return r
    return None


def save_file(user_id, raw, ext):
    sha = hashlib.sha256(raw).hexdigest()
    d = os.path.join(DATA, 'files', str(user_id)); os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f'{sha}{ext}')
    if not os.path.exists(path):
        with open(path, 'wb') as f: f.write(raw)
    return sha, os.path.relpath(path, DATA)


def store(user_id, parsed, meta=None, raw=None, ext=None, source='file', connection=None):
    """Returns ('added', id) | ('duplicate', id) | ('updated', id). meta: Strava CSV fields (name, description, ...)."""
    meta = meta or {}
    sport = meta.get('sport') or parsed['sport']
    start = parsed['start'] or meta.get('start')
    if start is None: raise ValueError('no start time')
    with (nullcontext(connection) if connection is not None else db.connect()) as c:
        prof = profile_of(c, user_id)
        tz = prof.get('tz') or db.DEFAULT_TZ
        S = analysis.prepare(parsed['streams'], sport)
        summ = analysis.summary(S, sport, parsed.get('session') or {}, prof)
        if source == 'track':
            # Session totals span pauses; map/derived sample metrics describe one uninterrupted segment only.
            summ.update({k: meta[k] for k in ('elapsed_s', 'moving_s', 'distance_m')})
        sha = path = None
        if raw is not None:
            sha, path = save_file(user_id, raw, ext or '')
            hit = c.execute('SELECT id FROM activities WHERE user_id = %s AND file_sha256 = %s', (user_id, sha)).fetchone()
            if hit: return 'duplicate', hit['id']
        if sport == 'workout' and source not in ('lift', 'track'):   # a watch's strength workout during a session logged in Kinetta (2026-10-13)
            from . import api_lifts
            secs = summ.get('elapsed_s') or meta.get('elapsed_s') or 0
            sess = parsed.get('session') or {}
            numbers = {k: num(summ.get(k)) or num(meta.get(k)) or num(sess.get(k)) for k in ('moving_s', 'avg_hr', 'max_hr', 'calories', 'effort')}
            numbers.update(device=parsed.get('device'), source_id=meta.get('source_id'), file_sha256=sha, file_path=path,
                           zones=json.dumps(summ['zones']) if summ.get('zones') else None)
            merged = api_lifts.merge_watch(c, user_id, start, start + dt.timedelta(seconds=float(secs)), numbers)
            if merged: return 'updated', merged
        dup = None if source in ('lift', 'track') else find_duplicate(c, user_id, start, summ.get('distance_m'), sport, summ.get('elapsed_s'))   # a session started here is always new
        if dup:
            richer = enrich_file(c, user_id, dup['id'], parsed, summ, sha, path) if raw is not None else False
            if meta.get('name') and dup['auto_name']:   # e.g. Garmin copy first, then Strava export brings the real title
                c.execute("""UPDATE activities SET name = %s, auto_name = false, description = coalesce(description, %s),
                             private_note = coalesce(private_note, %s), strava_id = coalesce(strava_id, %s), updated = now()
                             WHERE id = %s""", (meta['name'], meta.get('description'), meta.get('private_note'), meta.get('strava_id'), dup['id']))
                return 'updated', dup['id']
            return ('updated' if richer else 'duplicate'), dup['id']
        name = meta.get('name') or default_name(start, tz, sport, meta.get('sport_label'))
        gear_id = gear_for(c, user_id, sport, meta.get('gear'))
        row = dict(user_id=user_id, sport=sport, sub_sport=parsed.get('sub_sport'), sport_label=meta.get('sport_label'), name=name, auto_name=not meta.get('name'),
                   description=meta.get('description'), private_note=meta.get('private_note'), commute=bool(meta.get('commute')),
                   start_time=start, tz=tz, device=parsed.get('device'), source=source, source_id=meta.get('source_id'),
                   file_sha256=sha, file_path=path, strava_id=meta.get('strava_id'), gear_id=gear_id,
                   laps=json.dumps(parsed.get('laps') or [], default=str),
                   visibility=prof.get('share_default') or 'everyone')   # who sees it: the person's choice for new activities
        for k in ('elapsed_s', 'moving_s', 'distance_m', 'ascent_m', 'descent_m', 'avg_hr', 'max_hr', 'avg_cad', 'avg_power',
                  'max_power', 'max_speed', 'avg_temp', 'calories', 'avg_vo', 'avg_gct', 'avg_stride', 'gap_s_per_km', 'effort',
                  'decoupling', 'vo2max', 'max_alt', 'min_alt', 'vam', 'norm_power', 'steps', 'pool_length_m', 'lengths',
                  'strokes', 'swolf'):
            v = summ.get(k)
            row[k] = num(v, as_int=(k == 'lengths'))
        for k in ('elapsed_s', 'distance_m', 'moving_s', 'calories', 'avg_hr', 'max_hr', 'ascent_m'):   # manual entries (no samples)
            if not row.get(k) and meta.get(k): row[k] = float(meta[k])
        row['zones'] = json.dumps(summ.get('zones'))
        row['splits_km'] = json.dumps(analysis.splits(S, sport, 1000))
        row['splits_mi'] = json.dumps(analysis.splits(S, sport, MI))
        row['power_curve'] = json.dumps(analysis.power_curve(S))
        row['chart'] = json.dumps(analysis.chart_series(S, sport))
        cols = ', '.join(row); ph = ', '.join(f'%({k})s' for k in row)
        aid = c.execute(f'INSERT INTO activities ({cols}) VALUES ({ph}) RETURNING id', row).fetchone()['id']
        st = parsed['streams']
        if st['t']:
            c.execute("""INSERT INTO activity_streams (activity_id, user_id, t, lat, lon, alt, dist, hr, cad, power, speed, temp, vo, gct, stride)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                      (aid, user_id, _floats(st['t']), _floats(st['lat']), _floats(st['lon']), _floats(st['alt']),
                       _floats(S['dist']) if S['n'] > 1 else None, _floats(st['hr']), _floats(st['cad']),
                       _floats(st['power']), _floats(st['speed']), _floats(st['temp']), _floats(st['vo']), _floats(st['gct']),
                       _floats(st['stride'])))
        set_geometry(c, aid, st)
        for e in analysis.best_efforts(S, sport):
            c.execute("""INSERT INTO best_efforts (user_id, activity_id, sport, distance_m, label, elapsed_s, start_s, start_time)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                      (user_id, aid, sport, e['distance_m'], e['label'], e['elapsed_s'], e['start_s'], start))
        match_route(c, user_id, aid)
        from . import notify
        if source in notify.AUTO_SOURCES:      # arrived by itself; not one you just typed in or uploaded
            notify.activity_loaded(c, user_id, aid)
        return 'added', aid


def _floats(xs):
    """Stream array for a float8[] column. Watch files mix ints and floats (hr 142, then 142.5), which psycopg refuses."""
    return [None if x is None else float(x) for x in xs] if xs is not None and len(xs) else None   # lists or numpy arrays


def merge_streams(old, incoming):
    """Keep the richer GPS grid; fill each signal from its richer recording, joined within 30 seconds.

    Sparse or temporarily unavailable Health reads must never erase a fuller recording.
    """
    from .parsers import STREAMS
    count = lambda s, k: sum(v is not None for v in s.get(k, []))
    def richer(k):
        if count(incoming, k) <= count(old, k): return False
        before = [t for t, v in zip(old.get('t', []), old.get(k, [])) if v is not None]
        after = [t for t, v in zip(incoming.get('t', []), incoming.get(k, [])) if v is not None]
        return not before or (after and min(after) <= min(before) + 30 and max(after) >= max(before) - 30)
    gps = lambda s: sum(a is not None and b is not None for a, b in zip(s.get('lat', []), s.get('lon', [])))
    base = incoming if gps(incoming) > gps(old) and richer('lat') else old
    if not gps(base): base = incoming if richer('t') else old
    times = base.get('t', [])
    merged = {'t': times}
    for k in STREAMS:
        src = incoming if richer(k) else old
        pairs = sorted((t, v) for t, v in zip(src.get('t', []), src.get(k, [])) if v is not None)
        ts = [t for t, _ in pairs]
        vals = []
        for t in times:
            i = bisect.bisect_left(ts, t)
            near = min((j for j in (i - 1, i) if 0 <= j < len(ts)), key=lambda j: abs(ts[j] - t), default=None)
            vals.append(pairs[near][1] if near is not None and abs(ts[near] - t) <= 30 else None)
        merged[k] = vals
    return merged


def enrich_file(c, uid, aid, parsed, incoming_summary, sha, path):
    """A full recording arriving after a Health summary supplies its missing route and signals."""
    from .parsers import STREAMS
    a = c.execute('SELECT * FROM activities WHERE id = %s AND user_id = %s FOR UPDATE', (aid, uid)).fetchone()
    if not a or not (a['source'] == 'healthkit' or a.get('healthkit_id')): return False
    from . import activity_corrections as corrections
    raw_a=a;a=corrections.original(a)
    x, y = a.get('distance_m') or 0, incoming_summary.get('distance_m') or 0
    if x and y and min(x, y) / max(x, y) < .93: return False
    old = c.execute('SELECT * FROM activity_streams WHERE activity_id = %s AND user_id = %s', (aid, uid)).fetchone() or {}
    old = {k: old.get(k) or [] for k in ('t',) + STREAMS}
    incoming = dict(parsed['streams'])
    offset = (parsed['start'] - a['start_time']).total_seconds()
    incoming['t'] = [t + offset for t in incoming['t']]
    st = merge_streams(old, incoming)
    if not st['t'] or st == old: return False
    S = analysis.prepare(st, a['sport'])
    session = {k: a[k] for k in ('elapsed_s', 'moving_s', 'distance_m', 'calories', 'ascent_m', 'descent_m') if a.get(k) is not None}
    summ = analysis.summary(S, a['sport'], session, profile_of(c, uid))
    cols = ('t',) + STREAMS
    c.execute('INSERT INTO activity_streams (activity_id,user_id,' + ','.join(cols) + ') VALUES (' + ','.join(['%s']*(len(cols)+2)) + ') ON CONFLICT (activity_id) DO UPDATE SET ' + ','.join(k+'=EXCLUDED.'+k for k in cols), (aid,uid,*[_floats(st[k]) for k in cols]))
    sets = {}
    for k in ('avg_hr', 'max_hr', 'avg_cad', 'avg_power', 'max_power', 'max_speed', 'avg_vo', 'avg_gct', 'avg_stride', 'steps'):
        if a.get(k) is None and summ.get(k) is not None: sets[k] = num(summ[k])
    sets.update(chart=json.dumps(analysis.chart_series(S, a['sport'])), zones=json.dumps(summ.get('zones')),
        splits_km=json.dumps(analysis.splits(S,a['sport'],1000)), splits_mi=json.dumps(analysis.splits(S,a['sport'],MI)),
        power_curve=json.dumps(analysis.power_curve(S)))
    corrections.capture(c,raw_a,sets)
    c.execute('UPDATE activities SET '+','.join(k+'=%('+k+')s' for k in sets)+', file_sha256=coalesce(file_sha256,%(sha)s), file_path=coalesce(file_path,%(path)s), updated=now() WHERE id=%(aid)s AND user_id=%(uid)s', {**sets,'sha':sha,'path':path,'aid':aid,'uid':uid})
    c.execute('DELETE FROM best_efforts WHERE activity_id=%s AND user_id=%s', (aid,uid))
    for e in analysis.best_efforts(S,a['sport']):
        c.execute('INSERT INTO best_efforts (user_id,activity_id,sport,distance_m,label,elapsed_s,start_s,start_time) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)', (uid,aid,a['sport'],e['distance_m'],e['label'],e['elapsed_s'],e['start_s'],a['start_time']))
    set_geometry(c,aid,st); match_route(c,uid,aid)
    if raw_a.get('summary_overrides'):corrections.apply(c,uid,aid)
    return True


def set_geometry(c, aid, st):
    pts = [(lo, la) for la, lo in zip(st.get('lat') or [], st.get('lon') or []) if la is not None and lo is not None
           and -90 <= la <= 90 and -180 <= lo <= 180 and not (la == 0 and lo == 0)]
    if len(pts) < 2: return
    step = max(1, len(pts) // 4000)
    pts = pts[::step] + ([pts[-1]] if (len(pts) - 1) % step else [])
    wkt = 'LINESTRING(' + ','.join(f'{x:.6f} {y:.6f}' for x, y in pts) + ')'
    c.execute("""UPDATE activities SET geom = ST_Simplify(ST_GeomFromText(%s, 4326), 0.00001),
                 start_pt = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography,
                 end_pt = ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography WHERE id = %s""",
              (wkt, pts[0][0], pts[0][1], pts[-1][0], pts[-1][1], aid))


def route_name(c, aid):
    a = c.execute("""SELECT sport, distance_m, ST_Distance(start_pt, end_pt) AS gap, tz, start_time FROM activities WHERE id = %s""", (aid,)).fetchone()
    shape = 'route'
    if (a['gap'] or 0) < 250:   # back at the start: an out-and-back retraces itself, a loop doesn't
        ob = c.execute("""SELECT ST_HausdorffDistance(ST_Transform(ST_LineSubstring(geom, 0, 0.5), 3857),
                              ST_Transform(ST_Reverse(ST_LineSubstring(geom, 0.5, 1)), 3857)) AS h FROM activities WHERE id = %s""", (aid,)).fetchone()
        shape = 'out & back' if ob['h'] is not None and ob['h'] < 120 else 'loop'
    return f"{a['distance_m'] / MI:.1f} mi {shape}"


def match_route(c, user_id, aid):
    a = c.execute("""SELECT sport, distance_m, geom IS NOT NULL AS has_geom,
                        summary_overrides ?| array['distance_m','moving_s','elapsed_s'] AS corrected FROM activities WHERE id = %s AND user_id = %s""", (aid,user_id)).fetchone()
    # a corrected distance/time no longer belongs to its recording, so it isn't matched to routes until restored
    if not a or not a['has_geom'] or not a['distance_m'] or a['distance_m'] < 400 or a['corrected']: return None
    group = SPORT_GROUP.get(a['sport'], 'other')
    sports = [s for s, g in SPORT_GROUP.items() if g == group]
    # Rank cheap candidates before the expensive shape comparison. MATERIALIZED
    # keeps that comparison outside the sort; the named sort key lets Postgres 17
    # carry the order through the CTE and stop at the first matching route.
    m = c.execute("""
        WITH candidates AS MATERIALIZED (
          SELECT o.id, o.route_id, o.start_time, (o.route_id IS NULL) AS unmatched,
                 o.geom AS old_geom, n.geom AS new_geom
          FROM activities o, activities n
          WHERE n.id = %s AND o.user_id = %s AND n.user_id = o.user_id AND o.id <> n.id AND o.sport = ANY(%s) AND o.geom IS NOT NULL
            AND NOT o.summary_overrides ?| array['distance_m','moving_s','elapsed_s']
            AND o.distance_m BETWEEN n.distance_m * 0.93 AND n.distance_m * 1.07
            AND ST_DWithin(o.start_pt, n.start_pt, 200) AND ST_DWithin(o.end_pt, n.end_pt, 200)
          ORDER BY unmatched, o.start_time DESC
        )
        SELECT id, route_id FROM candidates
        WHERE ST_FrechetDistance(ST_Segmentize(ST_Transform(ST_Simplify(old_geom, 0.0001), 3857), 50),
                                ST_Segmentize(ST_Transform(ST_Simplify(new_geom, 0.0001), 3857), 50))
            < 250 / cos(radians(ST_Y(ST_StartPoint(new_geom))))
        ORDER BY unmatched, start_time DESC LIMIT 1""", (aid, user_id, sports)).fetchone()
    if not m: return None
    rid = m['route_id']
    if rid is None:
        rid = c.execute('INSERT INTO routes (user_id, sport, name) VALUES (%s, %s, %s) RETURNING id',
                        (user_id, group if group != 'foot' else 'walk', route_name(c, aid))).fetchone()['id']
        c.execute('UPDATE activities SET route_id = %s WHERE id = %s', (rid, m['id']))
    c.execute('UPDATE activities SET route_id = %s WHERE id = %s', (rid, aid))
    return rid


def gear_for(c, user_id, sport, name):
    if name:
        name = ' '.join(name.replace('+', ' ').split())
        g = c.execute('SELECT id FROM gear WHERE user_id = %s AND name = %s', (user_id, name)).fetchone()
        if g: return g['id']
        kind = 'bike' if sport == 'ride' else 'shoe' if sport in ('run', 'walk', 'hike') else 'other'
        return c.execute('INSERT INTO gear (user_id, kind, name) VALUES (%s, %s, %s) RETURNING id', (user_id, kind, name)).fetchone()['id']
    kind = 'bike' if sport == 'ride' else 'shoe' if sport in ('run', 'walk', 'hike') else None
    if not kind: return None
    g = c.execute('SELECT id FROM gear WHERE user_id = %s AND kind = %s AND is_default AND NOT retired', (user_id, kind)).fetchone()
    return g['id'] if g else None


def reprocess(user_id, aid):
    """Recompute analysis from the stored streams (after a model change or new max HR). Keeps names/notes/gear."""
    from .parsers import STREAMS
    with db.connect() as c:
        a = c.execute('SELECT * FROM activities WHERE id = %s AND user_id = %s FOR UPDATE', (aid, user_id)).fetchone()
        s = c.execute('SELECT * FROM activity_streams WHERE activity_id = %s AND user_id = %s', (aid, user_id)).fetchone()
        if not a or not s: return False
        streams = {'t': s['t'] or []}
        for k in STREAMS: streams[k] = s.get(k) or []
        if streams.get('dist'): streams['dist'] = streams['dist']
        from . import activity_corrections as corrections
        raw_a=a;a=corrections.original(a)
        prof = profile_of(c, user_id)
        S = analysis.prepare(streams, a['sport'])
        summ = analysis.summary(S, a['sport'], {k:a.get(k) for k in corrections.FIELDS}, prof)
        sets = {k: num(summ.get(k)) for k in
                ('moving_s', 'avg_hr', 'avg_cad', 'avg_power', 'max_speed', 'gap_s_per_km', 'effort', 'decoupling', 'vo2max',
                 'max_alt', 'min_alt', 'vam', 'norm_power', 'steps')}
        sets.update(zones=json.dumps(summ.get('zones')), splits_km=json.dumps(analysis.splits(S, a['sport'], 1000)),
                    splits_mi=json.dumps(analysis.splits(S, a['sport'], MI)), power_curve=json.dumps(analysis.power_curve(S)),
                    chart=json.dumps(analysis.chart_series(S, a['sport'])))
        corrections.capture(c,raw_a,sets)
        c.execute('UPDATE activities SET ' + ', '.join(f'{k} = %({k})s' for k in sets) + ', updated = now() WHERE id = %(id)s AND user_id = %(uid)s',
                  {**sets, 'id': aid, 'uid': user_id})
        c.execute('DELETE FROM best_efforts WHERE activity_id = %s AND user_id = %s', (aid, user_id))
        for e in analysis.best_efforts(S, a['sport']):
            c.execute("""INSERT INTO best_efforts (user_id, activity_id, sport, distance_m, label, elapsed_s, start_s, start_time)
                         VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                      (user_id, aid, a['sport'], e['distance_m'], e['label'], e['elapsed_s'], e['start_s'], a['start_time']))
        if raw_a.get('summary_overrides'):corrections.apply(c,user_id,aid)
        return True
