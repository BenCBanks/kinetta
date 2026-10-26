"""Named segments, leaderboards and their integrity tools (#278, #285, #286; 2026-10-26).

- A segment is a named, one-way course. Everything that defines it is fixed when it is created: name, description,
  path, start, finish, direction and sport. The database refuses changes (db.py migration 74, segments_frozen), so no
  endpoint, old app, bulk action or admin screen can edit one. A correction is a new segment with its own ID and board.
- Only me or Everyone on this Kinetta. Publishing a private segment is a one-way step; a published one can only be
  retired (stays readable, takes no new times) or taken down (definition wiped, tombstone kept, ID never reused).
- Times come only from the person's own GPS recordings (segments.py), never typed in.
- Leaderboards are worked out on every request from ELIGIBLE below: one best time per person who has joined, from an
  Everyone activity whose shared map includes the pass, from a source we may show publicly, not held or excluded, not
  blocked either way. Leaving, making an activity private or a moderator's decision applies on the next page load.
- Reports and appeals go to admins (#286). A report never removes a time by itself; an admin decides, with a reason, and
  every decision is in the audit history.
"""
import datetime as dt
import json
import time
import uuid
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import errors
from pydantic import BaseModel, Field

from . import db, notify, route_geo, route_providers, segments
from .admin_auth import admin_user, audit
from .api_routes_plan import FromActivityIn, _clean, _line, activity_part
from .api_social import MIN_SHOWN_M, blocked, unconfirmed
from .auth import current_user

router = APIRouter(prefix='/api')
SPORT = Literal['run', 'walk', 'hike', 'ride']
# Source-rights matrix (docs/segments.md): your own phone recordings, your own uploaded files and Apple Health workouts
# you chose to sync may appear on public boards once you join. Garmin's API data is not cleared for public competition,
# so those workouts keep private times only. Anything not listed is excluded by default.
BOARD_SOURCES = ['track', 'file', 'healthkit', 'apple']
PAGE = 25
TRIM = 'coalesce(p.share_trim_m, 400)'
ELIGIBLE = f"""e.state = 'ok' AND e.moderation IS NULL AND e.on_line
  AND a.visibility = 'everyone' AND NOT a.leaderboard_excluded AND a.source = ANY(%(sources)s)
  AND coalesce(p.segment_boards, false) AND NOT {unconfirmed('e.user_id')}
  AND coalesce((a.share_details->>'map')::boolean, (p.share_details->>'map')::boolean, true)
  AND e.start_m >= {TRIM} AND e.end_m <= e.line_m - {TRIM} AND e.line_m >= 2 * {TRIM} + {MIN_SHOWN_M}"""
BOARD_FROM = """segment_efforts e JOIN activities a ON a.id = e.activity_id LEFT JOIN profile p ON p.user_id = e.user_id"""
_hits = defaultdict(deque)


def _limit(uid, n=120, window=60):
    """A light per-person limit on board and discovery requests (they're the expensive ones)."""
    q, now = _hits[uid], time.monotonic()
    while q and now - q[0] > window: q.popleft()
    if len(q) >= n: raise HTTPException(429, 'Too many requests. Wait a moment.')
    q.append(now)


def boards_on(c):
    r = c.execute("SELECT enabled FROM feature_switches WHERE name = 'leaderboards'").fetchone()
    return True if r is None else r['enabled']


def _points(g): return [[la, lo] for lo, la in json.loads(g)['coordinates']] if g else None


SEG_COLS = """s.id, s.creator_id, s.name, s.description, s.sport, s.distance_m, s.ascent_m, s.elevation_source, s.source, s.created,
              s.audience, s.published, s.status, s.status_reason, s.status_changed, s.replaced_by, s.fingerprint,
              ST_AsGeoJSON(s.geom) AS g, cu.login::text AS creator_login, cu.name AS creator_name"""


def _visible(c, uid, sid):
    """The segment if this person may see it: their own, or published. Taken-down ones answer with a tombstone."""
    s = c.execute(f"""SELECT {SEG_COLS} FROM segments s LEFT JOIN users cu ON cu.id = s.creator_id WHERE s.id = %s""", (sid,)).fetchone()
    if not s or (s['audience'] != 'everyone' and s['creator_id'] != uid): raise HTTPException(404, 'Segment not found')
    if s['status'] == 'removed': raise HTTPException(410, {'code': 'removed', 'message': 'This segment was removed and is no longer available.'})
    # A published course belongs to everyone racing it: blocking its creator hides their name (and their times), not the course.
    if s['creator_id'] and s['creator_id'] != uid and c.execute(
            f"SELECT {blocked('%(c)s')} OR {unconfirmed('%(c)s')} AS b", {'viewer': uid, 'c': s['creator_id']}).fetchone()['b']:
        s['creator_login'] = s['creator_name'] = None
    return s


def _out(c, s, uid):
    pts = _points(s['g'])
    return {'id': s['id'], 'name': s['name'], 'description': s['description'], 'sport': s['sport'], 'distance_m': s['distance_m'],
            'ascent_m': s['ascent_m'], 'elevation_source': s['elevation_source'], 'created': s['created'], 'audience': s['audience'],
            'published': s['published'], 'status': s['status'], 'status_reason': s['status_reason'] if s['status'] == 'retired' else None,
            'replaced_by': s['replaced_by'], 'line': route_geo.encode(pts) if pts else None, 'mine': s['creator_id'] == uid,
            'creator': {'login': s['creator_login'], 'name': s['creator_name']} if s['creator_login'] else None,
            'saved': bool(c.execute('SELECT 1 FROM segment_bookmarks WHERE user_id = %s AND segment_id = %s', (uid, s['id'])).fetchone()),
            'processing': bool(c.execute("SELECT 1 FROM segment_jobs WHERE kind = 'segment' AND ref = %s", (s['id'],)).fetchone()),
            'fingerprint': s['fingerprint'][:12], 'path': f"/segments/{s['id']}"}


# ---------- drafts and review ----------
class DraftIn(BaseModel):
    data: dict


@router.get('/segment-drafts')
def drafts(user=Depends(current_user)):
    with db.connect() as c:
        return c.execute('SELECT id, data, updated FROM segment_drafts WHERE user_id = %s ORDER BY updated DESC LIMIT 50', (user['id'],)).fetchall()


@router.post('/segment-drafts')
def draft_new(body: DraftIn, user=Depends(current_user)):
    if len(json.dumps(body.data)) > 500_000: raise HTTPException(413, 'This draft is too big')
    with db.connect() as c:
        if c.execute('SELECT count(*) AS n FROM segment_drafts WHERE user_id = %s', (user['id'],)).fetchone()['n'] >= 50:
            raise HTTPException(400, 'You have 50 segment drafts. Create or delete some first.')
        return c.execute('INSERT INTO segment_drafts (user_id, data) VALUES (%s, %s) RETURNING id, updated', (user['id'], json.dumps(body.data))).fetchone()


@router.put('/segment-drafts/{did}')
def draft_save(did: int, body: DraftIn, user=Depends(current_user)):
    if len(json.dumps(body.data)) > 500_000: raise HTTPException(413, 'This draft is too big')
    with db.connect() as c:
        r = c.execute('UPDATE segment_drafts SET data = %s, updated = now() WHERE id = %s AND user_id = %s RETURNING id, updated',
                      (json.dumps(body.data), did, user['id'])).fetchone()
    if not r: raise HTTPException(404, 'Draft not found')
    return r


@router.delete('/segment-drafts/{did}')
def draft_delete(did: int, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM segment_drafts WHERE id = %s AND user_id = %s', (did, user['id']))
    return {'ok': True}


class PathIn(BaseModel):
    sport: SPORT
    line: str | None = Field(None, min_length=2, max_length=400_000)
    activity: FromActivityIn | None = None       # a stretch of your own activity: the server cuts it itself


def _path(uid, body):
    """The exact path a segment would have. From an activity, the server reads the stretch from the recording and checks
    it stays clear of the start and finish your privacy settings hide on shared maps."""
    if body.activity:
        pts, _ = activity_part(uid, body.activity)
        pts = route_geo.simplify(pts, 1.0)
        with db.connect() as c:
            r = c.execute("""SELECT coalesce(p.share_trim_m, 400) AS trim,
                               ST_Distance(a.start_pt, ST_GeomFromText(%(w)s, 4326)::geography) AS ds,
                               ST_Distance(a.end_pt, ST_GeomFromText(%(w)s, 4326)::geography) AS de
                             FROM activities a LEFT JOIN profile p ON p.user_id = a.user_id WHERE a.id = %(a)s AND a.user_id = %(u)s""",
                          {'w': _wkt(pts), 'a': body.activity.activity_id, 'u': uid}).fetchone()
        if r and r['trim'] and (r['ds'] is None or r['de'] is None or min(r['ds'], r['de']) < r['trim']):
            raise HTTPException(400, {'code': 'hidden_area', 'message': f"This stretch comes within {r['trim']} m of where the activity started or finished, which your privacy settings keep hidden. Choose a stretch further away."})
        return pts, 'activity'
    if not body.line: raise HTTPException(400, 'Draw the segment first')
    return _line(body.line), None


def _wkt(pts): return 'LINESTRING(' + ','.join(f'{lo:.6f} {la:.6f}' for la, lo in pts) + ')'


def _similar(c, pts, sport):
    return c.execute("""SELECT s.id, s.name, s.distance_m FROM segments s
        WHERE s.status = 'active' AND s.audience = 'everyone' AND s.sport = %(s)s
          AND ST_DWithin(ST_StartPoint(s.geom)::geography, ST_SetSRID(ST_MakePoint(%(x0)s, %(y0)s), 4326)::geography, 60)
          AND ST_DWithin(ST_EndPoint(s.geom)::geography, ST_SetSRID(ST_MakePoint(%(x1)s, %(y1)s), 4326)::geography, 60)
          AND ST_HausdorffDistance(ST_Transform(s.geom, 3857), ST_Transform(ST_GeomFromText(%(w)s, 4326), 3857)) < 60 / cos(radians(%(y0)s))
        ORDER BY s.created LIMIT 5""",
                     {'s': sport, 'x0': pts[0][1], 'y0': pts[0][0], 'x1': pts[-1][1], 'y1': pts[-1][0], 'w': _wkt(pts)}).fetchall()


@router.post('/segments/check')
def check(body: PathIn, user=Depends(current_user)):
    """The review before creating: the exact course, its problems (if any) and published segments already like it."""
    pts, _ = _path(user['id'], body)
    if len(pts) > 5000: pts = route_geo.simplify(pts, 2.0)
    problems = segments.check_path(pts)
    with db.connect() as c:
        similar = _similar(c, pts, body.sport) if len(pts) > 1 else []
    return {'line': route_geo.encode(pts), 'distance_m': round(route_geo.length(pts), 1), 'problems': problems, 'similar': similar}


class SegmentIn(PathIn):
    client_id: uuid.UUID
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    source: Literal['map', 'route', 'activity'] = 'map'
    audience: Literal['me', 'everyone']
    understood_fixed: Literal[True]          # the person saw "this can't be changed later" and agreed
    draft_id: int | None = None


@router.post('/segments')
def create(body: SegmentIn, user=Depends(current_user)):
    """Create a segment. Retrying (a lost answer, a double tap) returns the same one."""
    with db.connect() as c:
        had = c.execute('SELECT id FROM segments WHERE creator_id = %s AND client_id = %s', (user['id'], str(body.client_id))).fetchone()
        if had: return get(had['id'], user=user) | {'duplicate': True}
        if c.execute('SELECT needs_email_confirm FROM users WHERE id = %s', (user['id'],)).fetchone()['needs_email_confirm'] and body.audience == 'everyone':
            raise HTTPException(403, 'Confirm your email first to publish segments.')
    pts, src = _path(user['id'], body)
    if len(pts) > 5000: pts = route_geo.simplify(pts, 2.0)
    problems = segments.check_path(pts)
    if problems: raise HTTPException(400, {'code': 'bad_path', 'message': problems[0], 'problems': problems})
    name, desc = _clean(body.name), _clean(body.description)
    if not name: raise HTTPException(400, 'Give the segment a name')
    pts = [[round(a, 6), round(b, 6)] for a, b in pts]
    climb = None
    try: climb = route_providers.elevation(user['id'], pts)          # fixed with the course; unknown if unavailable
    except route_providers.Unavailable: pass
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', (f"segment:{user['id']}:{body.client_id}",))
        had = c.execute('SELECT id FROM segments WHERE creator_id = %s AND client_id = %s', (user['id'], str(body.client_id))).fetchone()
        if had: return get(had['id'], user=user) | {'duplicate': True}
        if c.execute("SELECT count(*) AS n FROM segments WHERE creator_id = %s AND created > now() - interval '1 day'", (user['id'],)).fetchone()['n'] >= 30:
            raise HTTPException(429, 'You have created a lot of segments today. Try again tomorrow.')
        sid = c.execute("""INSERT INTO segments (creator_id, client_id, name, description, sport, geom, distance_m, ascent_m, elevation_source,
                             source, fingerprint, matcher, audience, published)
                           VALUES (%s, %s, %s, %s, %s, ST_GeomFromText(%s, 4326), %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                        (user['id'], str(body.client_id), name, desc, body.sport, _wkt(pts), round(route_geo.length(pts), 1),
                         climb and climb['ascent_m'], climb and climb['source'], src or body.source,
                         segments.fingerprint(name, desc, body.sport, pts), segments.MATCHER, body.audience,
                         dt.datetime.now(dt.timezone.utc) if body.audience == 'everyone' else None)).fetchone()['id']
        c.execute("INSERT INTO segment_jobs (kind, ref) VALUES ('segment', %s)", (sid,))     # look through past activities
        c.execute('INSERT INTO segment_bookmarks (user_id, segment_id) VALUES (%s, %s)', (user['id'], sid))
        if body.draft_id: c.execute('DELETE FROM segment_drafts WHERE id = %s AND user_id = %s', (body.draft_id, user['id']))
    return get(sid, user=user) | {'duplicate': False}


class PublishIn(BaseModel):
    understood_public: Literal[True]


@router.post('/segments/{sid}/publish')
def publish(sid: int, body: PublishIn, user=Depends(current_user)):
    """Only me -> Everyone, unchanged. One way: a published segment can't go back to private."""
    with db.connect() as c:
        s = _visible(c, user['id'], sid)
        if s['creator_id'] != user['id']: raise HTTPException(404, 'Segment not found')
        if s['audience'] == 'everyone': return get(sid, user=user)
        if s['status'] != 'active': raise HTTPException(400, 'Retired segments can\'t be published')
        if c.execute('SELECT needs_email_confirm FROM users WHERE id = %s', (user['id'],)).fetchone()['needs_email_confirm']:
            raise HTTPException(403, 'Confirm your email first to publish segments.')
        c.execute("UPDATE segments SET audience = 'everyone', published = now() WHERE id = %s", (sid,))
        c.execute("INSERT INTO segment_jobs (kind, ref) VALUES ('segment', %s) ON CONFLICT (kind, ref) DO UPDATE SET cursor = 0", (sid,))
    return get(sid, user=user)


@router.get('/segments/{sid}')
def get(sid: int, user=Depends(current_user)):
    with db.connect() as c:
        return _out(c, _visible(c, user['id'], sid), user['id'])


@router.get('/segments')
def discover(q: str = Query('', max_length=120), sport: str = Query('', pattern='^(|run|walk|hike|ride)$'),
             lat: float | None = Query(None, ge=-90, le=90), lon: float | None = Query(None, ge=-180, le=180),
             mine: bool = False, saved: bool = False, user=Depends(current_user)):
    """Find segments by name, sport and area: published ones (not by people you've blocked) plus your own."""
    _limit(user['id'])
    where = ["s.status <> 'removed'", "(s.audience = 'everyone' OR s.creator_id = %(viewer)s)"]
    args = {'viewer': user['id'], 'x': lon, 'y': lat}
    if q.strip(): where.append('s.name ILIKE %(m)s'); args['m'] = '%' + q.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'
    if sport: where.append('s.sport = %(s)s'); args['s'] = sport
    if mine: where.append('s.creator_id = %(viewer)s')
    if saved: where.append('EXISTS (SELECT 1 FROM segment_bookmarks b WHERE b.user_id = %(viewer)s AND b.segment_id = s.id)')
    near = lat is not None and lon is not None
    dist = 'ST_Distance(s.geom::geography, ST_SetSRID(ST_MakePoint(%(x)s, %(y)s), 4326)::geography)' if near else 'NULL::float'
    if near and not (q.strip() or mine or saved): where.append(f'{dist} < 50000')
    with db.connect() as c:
        rows = c.execute(f"""SELECT s.id, s.name, s.sport, s.distance_m, s.ascent_m, s.audience, s.status, s.creator_id = %(viewer)s AS mine,
                               ST_AsGeoJSON(ST_Simplify(s.geom, 0.00005)) AS g, {dist} AS away,
                               EXISTS (SELECT 1 FROM segment_bookmarks b WHERE b.user_id = %(viewer)s AND b.segment_id = s.id) AS saved
                             FROM segments s WHERE {' AND '.join(where)}
                             ORDER BY {'away' if near else 's.created DESC'} LIMIT 60""", args).fetchall()
    return [{**{k: r[k] for k in ('id', 'name', 'sport', 'distance_m', 'ascent_m', 'audience', 'status', 'mine', 'saved', 'away')},
             'line': route_geo.encode(_points(r['g'])) if r['g'] else None} for r in rows]


@router.post('/segments/{sid}/bookmark')
def bookmark(sid: int, user=Depends(current_user)):
    with db.connect() as c:
        _visible(c, user['id'], sid)
        c.execute('INSERT INTO segment_bookmarks (user_id, segment_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (user['id'], sid))
    return {'saved': True}


@router.delete('/segments/{sid}/bookmark')
def unbookmark(sid: int, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM segment_bookmarks WHERE user_id = %s AND segment_id = %s', (user['id'], sid))
    return {'saved': False}


@router.delete('/segments/{sid}')
def delete_private(sid: int, user=Depends(current_user)):
    """Your own private segment can be deleted with its times. A published one goes through retirement instead."""
    with db.connect() as c:
        s = _visible(c, user['id'], sid)
        if s['creator_id'] != user['id']: raise HTTPException(404, 'Segment not found')
        if s['audience'] == 'everyone': raise HTTPException(400, 'Published segments can\'t be deleted. Ask for it to be retired instead.')
        c.execute('DELETE FROM segments WHERE id = %s AND creator_id = %s', (sid, user['id']))
    return {'ok': True}


# ---------- times ----------
def _why_not(e, joined, boards):
    """Why one of your times isn't on the public board, in your own words (most fixable first)."""
    if e['state'] == 'excluded' or e['moderation'] == 'excluded': return 'excluded'
    if e['state'] == 'held' or e['moderation'] == 'held': return 'held'
    if not boards: return 'paused'
    if e['audience'] != 'everyone': return 'segment_private'
    if not joined: return 'not_joined'
    if e['visibility'] != 'everyone': return 'activity_private'
    if e['leaderboard_excluded']: return 'excluded_by_you'
    if e['source'] not in BOARD_SOURCES: return 'source'
    if not e['map_shared']: return 'map_hidden'
    if not e['public_ok']: return 'hidden_area'
    return None


MY_EFFORTS = f"""SELECT e.id, e.activity_id, e.started, e.elapsed_s, e.state, e.reason, e.moderation, e.moderation_reason, e.rev,
       a.name AS activity_name, a.visibility, a.leaderboard_excluded, a.source, s.audience, s.distance_m, s.id AS segment_id, s.name AS segment_name,
       coalesce((a.share_details->>'map')::boolean, (p.share_details->>'map')::boolean, true) AS map_shared,
       (e.on_line AND e.start_m >= {TRIM} AND e.end_m <= e.line_m - {TRIM} AND e.line_m >= 2 * {TRIM} + {MIN_SHOWN_M}) AS public_ok,
       (SELECT status FROM segment_appeals ap WHERE ap.effort_id = e.id ORDER BY ap.created DESC LIMIT 1) AS appeal
     FROM segment_efforts e JOIN activities a ON a.id = e.activity_id JOIN segments s ON s.id = e.segment_id LEFT JOIN profile p ON p.user_id = e.user_id"""


def _effort(e, joined, boards):
    out = {k: e[k] for k in ('id', 'activity_id', 'activity_name', 'started', 'elapsed_s', 'state', 'segment_id', 'segment_name', 'distance_m', 'rev', 'appeal')}
    out['reason'] = e['moderation_reason'] if e['moderation'] else e['reason']
    out['reason_text'] = segments.REASONS.get(e['reason']) if not e['moderation'] else None
    out['public'] = _why_not(e, joined, boards) is None
    out['why_not'] = _why_not(e, joined, boards)
    return out


def _joined(c, uid):
    r = c.execute('SELECT segment_boards FROM profile WHERE user_id = %s', (uid,)).fetchone()
    return bool(r and r['segment_boards'])


@router.get('/segments/{sid}/efforts')
def my_efforts(sid: int, user=Depends(current_user)):
    """Your own times on this segment, fastest first, and recordings that didn't count (with why)."""
    with db.connect() as c:
        _visible(c, user['id'], sid)
        joined, on = _joined(c, user['id']), boards_on(c)
        rows = c.execute(MY_EFFORTS + ' WHERE e.segment_id = %s AND e.user_id = %s ORDER BY e.elapsed_s, e.started LIMIT 200', (sid, user['id'])).fetchall()
        misses = c.execute("""SELECT sc.activity_id, sc.reason, a.name, a.start_time FROM segment_scans sc JOIN activities a ON a.id = sc.activity_id
                              WHERE sc.segment_id = %s AND sc.user_id = %s AND sc.outcome <> 'match' AND sc.reason <> 'wrong_sport'
                              ORDER BY a.start_time DESC LIMIT 10""", (sid, user['id'])).fetchall()
    return {'efforts': [_effort(e, joined, on) for e in rows], 'joined': joined,
            'near_misses': [{'activity_id': m['activity_id'], 'name': m['name'], 'start_time': m['start_time'], 'reason': m['reason'],
                             'reason_text': segments.REASONS.get(m['reason'], 'Didn\'t match the whole segment.')} for m in misses]}


@router.get('/activities/{aid}/segment-efforts')
def activity_efforts(aid: int, user=Depends(current_user)):
    with db.connect() as c:
        a = c.execute('SELECT leaderboard_excluded FROM activities WHERE id = %s AND user_id = %s', (aid, user['id'])).fetchone()
        if not a: raise HTTPException(404, 'Not found')
        joined, on = _joined(c, user['id']), boards_on(c)
        rows = c.execute(MY_EFFORTS + " WHERE e.activity_id = %s AND e.user_id = %s AND s.status <> 'removed' ORDER BY e.started", (aid, user['id'])).fetchall()
        best = {r['segment_id']: r['b'] for r in c.execute("""SELECT segment_id, min(elapsed_s) AS b FROM segment_efforts WHERE user_id = %s
            AND segment_id = ANY(%s) AND state = 'ok' AND moderation IS NULL GROUP BY segment_id""", (user['id'], [r['segment_id'] for r in rows])).fetchall()}
        pending = bool(c.execute("SELECT 1 FROM segment_jobs WHERE kind = 'activity' AND ref = %s", (aid,)).fetchone())
    return {'efforts': [_effort(e, joined, on) | {'personal_best': e['state'] == 'ok' and not e['moderation'] and best.get(e['segment_id']) == e['elapsed_s']} for e in rows],
            'excluded': a['leaderboard_excluded'], 'joined': joined, 'processing': pending}


class ExcludeIn(BaseModel):
    excluded: bool


@router.put('/activities/{aid}/leaderboards')
def exclude_activity(aid: int, body: ExcludeIn, user=Depends(current_user)):
    """Keep one activity off public boards without making it private."""
    with db.connect() as c:
        r = c.execute('UPDATE activities SET leaderboard_excluded = %s WHERE id = %s AND user_id = %s RETURNING id', (body.excluded, aid, user['id'])).fetchone()
    if not r: raise HTTPException(404, 'Not found')
    return {'excluded': body.excluded}


class JoinIn(BaseModel):
    joined: bool


@router.get('/segment-settings')
def settings(user=Depends(current_user)):
    with db.connect() as c:
        return {'joined': _joined(c, user['id']), 'boards': boards_on(c), 'sources': BOARD_SOURCES}


@router.put('/segment-settings')
def set_settings(body: JoinIn, user=Depends(current_user)):
    """Show my eligible segment times on leaderboards (off until you turn it on). Joining shows your past eligible
    times too; leaving removes them from every board at once."""
    with db.connect() as c:
        c.execute('UPDATE profile SET segment_boards = %s WHERE user_id = %s', (body.joined, user['id']))
    return {'joined': body.joined}


@router.get('/segments/{sid}/leaderboard')
def leaderboard(sid: int, after: str | None = Query(None, max_length=80), user=Depends(current_user)):
    """One row per person: their best time that's eligible right now. Equal whole seconds share a rank (1, 1, 3)."""
    _limit(user['id'])
    with db.connect() as c:
        s = _visible(c, user['id'], sid)
        on = boards_on(c)
        base = {'segment': sid, 'paused': not on, 'rows': [], 'next': None, 'count': 0, 'me': None,
                'processing': bool(c.execute("SELECT 1 FROM segment_jobs WHERE kind = 'segment' AND ref = %s", (sid,)).fetchone()),
                'scope': None, 'public': s['audience'] == 'everyone'}
        joined = _joined(c, user['id'])
        mine = c.execute(MY_EFFORTS + " WHERE e.segment_id = %s AND e.user_id = %s ORDER BY e.elapsed_s, e.started LIMIT 50", (sid, user['id'])).fetchall()
        private_best = next((e for e in mine if e['state'] == 'ok' and not e['moderation']), None)
        if not on or s['audience'] != 'everyone':
            base['me'] = {'joined': joined, 'private_best': private_best and private_best['elapsed_s'], 'rank': None, 'public_best': None,
                          'why_not': private_best and _why_not(private_best, joined, on)}
            return base
        args = {'sid': sid, 'viewer': user['id'], 'sources': BOARD_SOURCES}
        ranked = f"""WITH best AS (
              SELECT DISTINCT ON (e.user_id) e.user_id, e.elapsed_s, e.activity_id, e.started FROM {BOARD_FROM}
              WHERE e.segment_id = %(sid)s AND {ELIGIBLE} AND (e.user_id = %(viewer)s OR NOT {blocked('e.user_id')})
              ORDER BY e.user_id, e.elapsed_s, e.started, e.id),
            ranked AS (SELECT b.*, rank() OVER (ORDER BY b.elapsed_s) AS rank, md5(b.user_id::text || ':' || %(sid)s::text) AS tie FROM best b)"""
        where = ''
        if after:
            try: a_s, a_tie = after.split(':', 1); args.update(a_s=int(a_s), a_tie=a_tie); where = 'WHERE (r.elapsed_s, r.tie) > (%(a_s)s, %(a_tie)s)'
            except ValueError: raise HTTPException(400, 'Bad page')
        rows = c.execute(ranked + f"""SELECT r.*, u.login::text AS login, u.name, u.photo_v AS photo FROM ranked r JOIN users u ON u.id = r.user_id
                                     {where} ORDER BY r.elapsed_s, r.tie LIMIT {PAGE + 1}""", args).fetchall()
        count = c.execute(ranked + 'SELECT count(*) AS n FROM ranked', args).fetchone()['n']
        me = c.execute(ranked + 'SELECT rank, elapsed_s FROM ranked WHERE user_id = %(viewer)s', args).fetchone()
        has_blocks = bool(c.execute('SELECT 1 FROM blocks WHERE user_id = %s OR blocked = %s LIMIT 1', (user['id'], user['id'])).fetchone())
    more = len(rows) > PAGE; rows = rows[:PAGE]
    base.update(count=count, next=f"{rows[-1]['elapsed_s']}:{rows[-1]['tie']}" if more else None,
                scope='Ranked among the members you can see.' if has_blocks else None,
                rows=[{'rank': r['rank'], 'elapsed_s': r['elapsed_s'], 'login': r['login'], 'name': r['name'], 'photo': r['photo'],
                       'activity_id': r['activity_id'], 'date': r['started'].date().isoformat(), 'me': r['user_id'] == user['id'],
                       'leader': r['rank'] == 1 and not base['processing']} for r in rows])
    base['me'] = {'joined': joined, 'private_best': private_best and private_best['elapsed_s'], 'rank': me and me['rank'],
                  'public_best': me and me['elapsed_s'], 'why_not': None if me else private_best and _why_not(private_best, joined, True)}
    return base


# ---------- reports and appeals (#286) ----------
class ReportIn(BaseModel):
    reason: Literal['gps', 'wrong_sport', 'duplicate', 'unsafe', 'abusive', 'privacy', 'creator_request']
    login: str | None = Field(None, max_length=60)        # a person's result on this board, or None for the segment itself
    note: str | None = Field(None, max_length=500)


@router.post('/segments/{sid}/report')
def report(sid: int, body: ReportIn, user=Depends(current_user)):
    """Report a segment or a result on its board to this server's admins. A report never removes anything by itself, and
    the person reported is never told who reported them."""
    with db.connect() as c:
        s = _visible(c, user['id'], sid)
        person = None
        if body.login:
            if body.reason in ('creator_request', 'duplicate', 'unsafe'): raise HTTPException(400, 'Choose a reason about the result')
            t = c.execute('SELECT id FROM users WHERE login = %s', (body.login.strip().lower(),)).fetchone()
            row = t and c.execute(f"""SELECT 1 FROM {BOARD_FROM} WHERE e.segment_id = %(sid)s AND e.user_id = %(t)s AND {ELIGIBLE}
                                     AND NOT {blocked('e.user_id')} LIMIT 1""", {'sid': sid, 't': t['id'], 'viewer': user['id'], 'sources': BOARD_SOURCES}).fetchone()
            if not row or t['id'] == user['id']: raise HTTPException(404, 'Not found')
            person = t['id']
        elif body.reason == 'creator_request' and s['creator_id'] != user['id']:
            raise HTTPException(400, 'Only the person who created a segment can ask for it to be retired')
        if c.execute("SELECT count(*) AS n FROM segment_reports WHERE reporter = %s AND status = 'open'", (user['id'],)).fetchone()['n'] >= 20:
            raise HTTPException(429, 'You have a lot of reports waiting. The admins will get to them.')
        try:
            with c.transaction():
                rid = c.execute("""INSERT INTO segment_reports (reporter, segment_id, person, reason, note) VALUES (%s, %s, %s, %s, %s) RETURNING id""",
                                (user['id'], sid, person, body.reason, _clean(body.note))).fetchone()['id']
        except errors.UniqueViolation:
            return {'ok': True, 'already': True}
        for a in c.execute('SELECT id FROM users WHERE is_admin AND id <> %s', (user['id'],)).fetchall():
            notify.add(c, a['id'], 'report', user['id'])
    return {'ok': True, 'id': rid}


class AppealIn(BaseModel):
    note: str = Field(min_length=1, max_length=1000)


@router.post('/segment-efforts/{eid}/appeal')
def appeal(eid: int, body: AppealIn, user=Depends(current_user)):
    """Ask an admin to look again at one of your held or excluded times. It stays as it is until they decide."""
    if not body.note.strip(): raise HTTPException(400, 'Add a short explanation for the review')
    with db.connect() as c:
        e = c.execute('SELECT state, moderation, reason FROM segment_efforts WHERE id = %s AND user_id = %s', (eid, user['id'])).fetchone()
        if not e: raise HTTPException(404, 'Not found')
        if e['state'] == 'ok' and not e['moderation']: raise HTTPException(400, 'This time already counts')
        if e['reason'] == 'duplicate': raise HTTPException(400, 'Your other copy of this workout already has this time')
        try:
            with c.transaction():
                c.execute('INSERT INTO segment_appeals (effort_id, user_id, note) VALUES (%s, %s, %s)', (eid, user['id'], body.note.strip()))
        except errors.UniqueViolation:
            raise HTTPException(409, 'You already asked for a review of this time')
        for a in c.execute('SELECT id FROM users WHERE is_admin AND id <> %s', (user['id'],)).fetchall():
            notify.add(c, a['id'], 'report', user['id'])
    return {'ok': True}


# ---------- admin (portal at /admin, MFA session) ----------
def _effort_evidence(c, eid):
    """The minimum needed to decide: the derived timing and its checks. No streams, heart rate, notes or other history."""
    return c.execute("""SELECT e.id, e.segment_id, e.elapsed_s, e.elapsed_raw, e.state, e.reason, e.moderation, e.moderation_reason, e.rev,
                          e.started::date AS day, e.end_i - e.start_i + 1 AS fixes, e.matcher, a.sport, a.sport_label, a.source, a.visibility,
                          s.name AS segment_name,
                          a.id AS activity_id, u.login::text AS login, u.name, s.distance_m, s.sport AS segment_sport,
                          round((s.distance_m / e.elapsed_raw)::numeric, 2) AS avg_speed
                        FROM segment_efforts e JOIN activities a ON a.id = e.activity_id JOIN users u ON u.id = e.user_id
                        JOIN segments s ON s.id = e.segment_id WHERE e.id = %s""", (eid,)).fetchone()


@router.get('/admin/segments')
def admin_overview(user=Depends(admin_user)):
    with db.connect() as c:
        reports = c.execute("""SELECT r.id, r.segment_id, r.reason, r.note, r.created, s.name AS segment, s.status, s.audience,
                                 p.login::text AS person_login, p.name AS person_name, r.person
                               FROM segment_reports r JOIN segments s ON s.id = r.segment_id LEFT JOIN users p ON p.id = r.person
                               WHERE r.status = 'open' ORDER BY r.created""").fetchall()
        for r in reports:   # the reported person's best current time on that board, with its checks
            if r['person']:
                e = c.execute("""SELECT id FROM segment_efforts WHERE segment_id = %s AND user_id = %s AND state <> 'excluded'
                                 ORDER BY (moderation IS NULL) DESC, elapsed_s LIMIT 1""", (r['segment_id'], r['person'])).fetchone()
                r['effort'] = e and _effort_evidence(c, e['id'])
            r.pop('person')
        appeals = c.execute("""SELECT ap.id, ap.note, ap.created, ap.effort_id FROM segment_appeals ap WHERE ap.status = 'open' ORDER BY ap.created""").fetchall()
        for ap in appeals: ap['effort'] = _effort_evidence(c, ap['effort_id'])
        held = c.execute("""SELECT e.id FROM segment_efforts e JOIN segments s ON s.id = e.segment_id WHERE s.audience = 'everyone'
                            AND (e.state = 'held' OR e.moderation = 'held') ORDER BY e.created LIMIT 50""").fetchall()
        held = [_effort_evidence(c, h['id']) for h in held]
        stats = c.execute("""SELECT (SELECT count(*) FROM segment_jobs) AS backlog, (SELECT count(*) FROM segment_jobs WHERE attempts >= 5) AS stuck,
                               (SELECT count(*) FROM segments WHERE status = 'active' AND audience = 'everyone') AS public_segments,
                               (SELECT count(*) FROM segment_efforts) AS efforts""").fetchone()
        reasons = c.execute("""SELECT coalesce(moderation_reason, reason) AS reason, count(*) AS n FROM segment_efforts
                               WHERE state <> 'ok' OR moderation IS NOT NULL GROUP BY 1 ORDER BY 2 DESC""").fetchall()
        on = boards_on(c)
    return {'reports': reports, 'appeals': appeals, 'held': held, 'stats': stats, 'exclusions': reasons, 'leaderboards': on}


@router.get('/admin/segment-efforts/{eid}')
def admin_effort(eid: int, user=Depends(admin_user)):
    with db.connect() as c:
        _reviewable(c, eid)
        e = _effort_evidence(c, eid)
    if not e: raise HTTPException(404, 'Not found')
    return e


def _reviewable(c, eid):
    """A case or a held public-course result is the narrow exception, never arbitrary private history."""
    if not c.execute("""SELECT 1 FROM segment_efforts e JOIN segments s ON s.id = e.segment_id WHERE e.id = %s AND (
          (s.audience = 'everyone' AND (e.state = 'held' OR e.moderation = 'held')) OR
          EXISTS (SELECT 1 FROM segment_reports r WHERE r.segment_id = e.segment_id AND r.person = e.user_id AND r.status = 'open') OR
          EXISTS (SELECT 1 FROM segment_appeals ap WHERE ap.effort_id = e.id AND ap.status = 'open'))""", (eid,)).fetchone():
        raise HTTPException(404, 'No open review case for this time')


def _decision(c, user, kind, target, action, reason, rev=None):
    c.execute('INSERT INTO segment_decisions (actor_id, target_kind, target_id, action, reason, reviewed_rev) VALUES (%s,%s,%s,%s,%s,%s)',
              (user['id'], kind, target, action, reason.strip(), rev))


class DecideIn(BaseModel):
    action: Literal['hold', 'exclude', 'restore']
    reason: str = Field(min_length=3, max_length=300)
    rev: int                                         # the version the admin looked at: an older view can't overwrite a newer one
    report_id: int | None = None
    appeal_id: int | None = None


@router.post('/admin/segment-efforts/{eid}/decide')
def decide(eid: int, body: DecideIn, user=Depends(admin_user)):
    if len(body.reason.strip()) < 3: raise HTTPException(400, 'Add a specific reason')
    with db.connect() as c:
        e = c.execute('SELECT id, rev, state, reason, user_id, segment_id FROM segment_efforts WHERE id = %s FOR UPDATE', (eid,)).fetchone()
        if not e: raise HTTPException(404, 'Not found')
        if e['rev'] != body.rev: raise HTTPException(409, 'This time changed since you opened it. Reload and look again.')
        _reviewable(c, eid)
        if body.report_id and not c.execute("SELECT 1 FROM segment_reports WHERE id = %s AND segment_id = %s AND person = %s AND status = 'open' FOR UPDATE",
                                           (body.report_id, e['segment_id'], e['user_id'])).fetchone():
            raise HTTPException(409, 'This report changed or belongs to another result. Reload the cases.')
        if body.appeal_id and not c.execute("SELECT 1 FROM segment_appeals WHERE id = %s AND effort_id = %s AND status = 'open' FOR UPDATE", (body.appeal_id, eid)).fetchone():
            raise HTTPException(409, 'This appeal was already handled or belongs to another time')
        if body.action == 'restore':
            if e['reason'] == 'duplicate': raise HTTPException(400, 'Duplicates are worked out automatically')
            c.execute("""UPDATE segment_efforts SET moderation = NULL, moderation_reason = NULL, rev = rev + 1,
                           state = CASE WHEN state = 'held' THEN 'ok' ELSE state END,
                           reason = CASE WHEN state = 'held' THEN 'reviewed' ELSE reason END WHERE id = %s""", (eid,))
        else:
            c.execute('UPDATE segment_efforts SET moderation = %s, moderation_reason = %s, rev = rev + 1 WHERE id = %s',
                      ('held' if body.action == 'hold' else 'excluded', body.reason.strip(), eid))
        if body.report_id:
            c.execute("UPDATE segment_reports SET status = 'actioned', decided_by = %s, decided = now(), outcome = %s WHERE id = %s AND status = 'open'",
                      (user['id'], f'{body.action}: {body.reason.strip()}'[:300], body.report_id))
        if body.appeal_id:
            c.execute("UPDATE segment_appeals SET status = %s, decided = now(), outcome = %s WHERE id = %s AND effort_id = %s AND status = 'open'",
                      ('restored' if body.action == 'restore' else 'upheld', body.reason.strip(), body.appeal_id, eid))
        _decision(c, user, 'effort', eid, body.action, body.reason, body.rev)
        audit(c, user['id'], f'segment_effort.{body.action}', eid)
    return {'ok': True}


class CloseIn(BaseModel):
    outcome: str = Field(min_length=3, max_length=300)
    rev: int | None = None


@router.post('/admin/segment-reports/{rid}/dismiss')
def dismiss(rid: int, body: CloseIn, user=Depends(admin_user)):
    if len(body.outcome.strip()) < 3: raise HTTPException(400, 'Add a specific reason')
    with db.connect() as c:
        r = c.execute("UPDATE segment_reports SET status = 'dismissed', decided_by = %s, decided = now(), outcome = %s WHERE id = %s AND status = 'open' RETURNING id",
                      (user['id'], body.outcome.strip(), rid)).fetchone()
        if not r: raise HTTPException(409, 'This report was already handled')
        _decision(c, user, 'report', rid, 'dismiss', body.outcome)
        audit(c, user['id'], 'segment_report.dismiss', rid)
    return {'ok': True}


@router.post('/admin/segment-appeals/{aid}/uphold')
def uphold(aid: int, body: CloseIn, user=Depends(admin_user)):
    if len(body.outcome.strip()) < 3: raise HTTPException(400, 'Add a specific reason')
    with db.connect() as c:
        # Use the same lock order as a result decision. An old case must not uphold a changed result.
        e = c.execute('SELECT id, rev FROM segment_efforts WHERE id = (SELECT effort_id FROM segment_appeals WHERE id = %s) FOR UPDATE', (aid,)).fetchone()
        if not e or e['rev'] != body.rev: raise HTTPException(409, 'This time changed. Reload the appeal before deciding.')
        r = c.execute("UPDATE segment_appeals SET status = 'upheld', decided = now(), outcome = %s WHERE id = %s AND status = 'open' RETURNING id",
                      (body.outcome.strip(), aid)).fetchone()
        if not r: raise HTTPException(409, 'This appeal was already handled')
        _decision(c, user, 'appeal', aid, 'uphold', body.outcome, body.rev)
        audit(c, user['id'], 'segment_appeal.uphold', aid)
    return {'ok': True}


class RetireIn(BaseModel):
    kind: Literal['retire', 'takedown']
    reason: str = Field(min_length=3, max_length=300)
    replaced_by: int | None = None
    report_id: int | None = None
    expected_status: Literal['active', 'retired']


def take_down(c, sids, reason):
    """Wipe published definitions (name, description, path, creator) and their boards; the ID stays as a tombstone.
    Other people's workouts are untouched; only the derived times on this course go."""
    if not sids: return
    c.execute("""UPDATE segments SET status = 'removed', name = NULL, description = NULL, geom = NULL, creator_id = NULL,
                   status_reason = %s, status_changed = now() WHERE id = ANY(%s) AND status <> 'removed'""", (reason, sids))
    for t in ('segment_efforts', 'segment_scans'): c.execute(f'DELETE FROM {t} WHERE segment_id = ANY(%s)', (sids,))
    c.execute("DELETE FROM segment_jobs WHERE kind = 'segment' AND ref = ANY(%s)", (sids,))


@router.post('/admin/segments/{sid}/retire')
def retire(sid: int, body: RetireIn, user=Depends(admin_user)):
    if len(body.reason.strip()) < 3: raise HTTPException(400, 'Add a specific reason')
    with db.connect() as c:
        s = c.execute('SELECT status FROM segments WHERE id = %s FOR UPDATE', (sid,)).fetchone()
        if not s: raise HTTPException(404, 'Not found')
        if s['status'] == 'removed': raise HTTPException(409, 'Already taken down')
        if s['status'] != body.expected_status: raise HTTPException(409, 'This course changed. Reload the cases before deciding.')
        if not body.report_id or not c.execute("SELECT 1 FROM segment_reports WHERE id = %s AND segment_id = %s AND status = 'open' FOR UPDATE", (body.report_id, sid)).fetchone():
            raise HTTPException(409, 'An open report about this course is required')
        if body.replaced_by and not c.execute("SELECT 1 FROM segments WHERE id = %s AND id <> %s AND status = 'active' AND audience = 'everyone'", (body.replaced_by, sid)).fetchone():
            raise HTTPException(400, 'The replacement must be a different published segment')
        if body.kind == 'takedown': take_down(c, [sid], body.reason.strip())
        elif s['status'] != 'retired':
            # Public status stays neutral; the case detail belongs only in the restricted decision receipt.
            c.execute("UPDATE segments SET status = 'retired', status_reason = 'Retired after administrator review.', status_changed = now(), replaced_by = %s WHERE id = %s",
                      (body.replaced_by, sid))
            c.execute("DELETE FROM segment_jobs WHERE kind = 'segment' AND ref = %s", (sid,))
        if body.report_id:
            c.execute("UPDATE segment_reports SET status = 'actioned', decided_by = %s, decided = now(), outcome = %s WHERE id = %s AND status = 'open'",
                      (user['id'], f'{body.kind}: {body.reason.strip()}'[:300], body.report_id))
        audit(c, user['id'], f'segment.{body.kind}', sid)
        _decision(c, user, 'segment', sid, body.kind, body.reason)
    return {'ok': True}


class SwitchIn(BaseModel):
    enabled: bool
    expected: bool


@router.put('/admin/segments/leaderboards')
def switch(body: SwitchIn, user=Depends(admin_user)):
    """The public-leaderboard switch: off hides every board at once (personal times stay)."""
    with db.connect() as c:
        c.execute("SELECT pg_advisory_xact_lock(hashtext('segment-board-switch'))")
        if boards_on(c) != body.expected: raise HTTPException(409, 'The boards switch changed. Reload before deciding.')
        c.execute("""INSERT INTO feature_switches (name, enabled, actor_id) VALUES ('leaderboards', %s, %s)
                     ON CONFLICT (name) DO UPDATE SET enabled = EXCLUDED.enabled, actor_id = EXCLUDED.actor_id, changed = now()""", (body.enabled, user['id']))
        audit(c, user['id'], 'leaderboards.' + ('on' if body.enabled else 'off'))
    return {'enabled': body.enabled}


@router.post('/admin/segments/jobs/retry')
def retry_jobs(user=Depends(admin_user)):
    with db.connect() as c:
        n = c.execute('UPDATE segment_jobs SET attempts = 0, last_error = NULL WHERE attempts >= 5 RETURNING id').fetchall()
        audit(c, user['id'], 'segment_jobs.retry', len(n))
    return {'retried': len(n)}
