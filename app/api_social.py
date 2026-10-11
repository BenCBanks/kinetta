"""Friends and sharing (2026-10-11): friend requests by exact username, who sees each activity (only me / friends /
everyone on this Lankki), which details others see, shared maps without the start and end, a friends feed, cheers and
comments.

Keeping people's data safe:
 - CAN_SEE / can_see() is the one rule for "may this person see this activity". Every endpoint here that touches someone
   else's activity goes through it, and anything they may not see answers 404, the same as an activity that doesn't exist.
 - Someone else's activity is put together field by field (shared_activity): only fields listed below, and only the
   details the owner shares. Everything else is left out of the answer, not just hidden on the phone. Private notes,
   coach notes, files, raw streams, gear and the exact start and end points are never listed.
 - Shared maps are trimmed here, with PostGIS: the first and last stretch of the route (the owner's choice: off, 200,
   400 or 800 m) is cut off before the line leaves the server. A route too short to trim gets no map at all.
"""
import datetime as dt
import json

from fastapi import APIRouter, Depends, HTTPException
from psycopg import errors
from pydantic import BaseModel, Field

from . import db
from .api_activities import DETAIL_TOL, PREVIEW_TOL, polyline
from .auth import current_user

router = APIRouter(prefix='/api')
VISIBILITY = ('me', 'friends', 'everyone')
# The details a person picks, and the defaults: map on (trimmed), heart rate and calories off, the rest on.
DETAILS = {'map': True, 'heart_rate': False, 'pace': True, 'splits': True, 'elevation': True, 'calories': False,
           'description': True, 'device': True}
TRIMS = (0, 200, 400, 800)
MIN_SHOWN_M = 200          # after trimming, at least this much route must be left, or no map is shared
# What someone else may get. Always: what it was and how far and long. The rest only when its detail is shared.
ALWAYS = ('id', 'sport', 'sport_label', 'name', 'start_time', 'distance_m', 'moving_s', 'elapsed_s')
FIELDS = {'pace': ('gap_s_per_km', 'max_speed'), 'heart_rate': ('avg_hr', 'max_hr', 'effort', 'zones'),
          'elevation': ('ascent_m', 'descent_m', 'max_alt', 'min_alt', 'vam'), 'calories': ('calories',),
          'description': ('description',), 'device': ('device',)}
MAX_PENDING = 50           # friend requests one person can have waiting at once
FEED_MAX = 50

CAN_SEE = """(a.user_id = %(viewer)s OR a.visibility = 'everyone' OR (a.visibility = 'friends' AND EXISTS (
    SELECT 1 FROM friendships f WHERE f.status = 'accepted'
      AND ((f.requester = a.user_id AND f.addressee = %(viewer)s) OR (f.addressee = a.user_id AND f.requester = %(viewer)s)))))"""
FRIEND_IDS = """SELECT CASE WHEN f.requester = %(viewer)s THEN f.addressee ELSE f.requester END FROM friendships f
    WHERE f.status = 'accepted' AND %(viewer)s IN (f.requester, f.addressee)"""


def can_see(c, viewer, aid):
    """The owner's id when `viewer` may see activity `aid`; otherwise 404 (as if it didn't exist)."""
    r = c.execute(f'SELECT a.user_id FROM activities a WHERE a.id = %(aid)s AND {CAN_SEE}', {'aid': aid, 'viewer': viewer}).fetchone()
    if not r: raise HTTPException(404, 'Not found')
    return r['user_id']


def details_of(person=None, activity=None):
    """The details shared: the defaults, then the person's own choice, then this activity's (if it has one)."""
    d = dict(DETAILS)
    for src in (person or {}, activity or {}):
        d.update({k: bool(v) for k, v in src.items() if k in DETAILS})
    return d


def _clean_details(v):
    if not isinstance(v, dict) or not set(v) <= set(DETAILS) or not all(isinstance(x, bool) for x in v.values()):
        raise HTTPException(400, 'Unknown detail')
    return details_of(v)


# Someone else's view of an activity: one query for the feed and the detail page. The map is cut here: the line is
# projected to metres (Web Mercator keeps proportions along a local route), then ST_LineSubstring keeps the part between
# trim_m from the start and trim_m from the end.
def _select(extra=''):
    return f"""SELECT a.id, a.sport, a.sport_label, a.name, a.start_time, a.distance_m, a.moving_s, a.elapsed_s,
      a.gap_s_per_km, a.max_speed, a.avg_hr, a.max_hr, a.effort, a.ascent_m, a.descent_m, a.max_alt, a.min_alt, a.vam,
      a.calories, a.description, a.device, {extra}
      a.share_details AS a_details, p.share_details AS p_details, s.trim_m, u.login::text AS owner_login, u.name AS owner_name,
      CASE WHEN a.geom IS NULL THEN NULL
           WHEN s.trim_m = 0 THEN ST_AsGeoJSON(ST_Simplify(a.geom, %(tol)s))
           WHEN s.len_m < 2 * s.trim_m + %(min_m)s THEN NULL
           ELSE ST_AsGeoJSON(ST_Simplify(ST_Transform(ST_LineSubstring(ST_Transform(a.geom, 3857),
                  s.trim_m / s.len_m, 1 - s.trim_m / s.len_m), 4326), %(tol)s)) END AS g,
      (SELECT count(*) FROM cheers ch WHERE ch.activity_id = a.id) AS cheer_n,
      EXISTS (SELECT 1 FROM cheers ch WHERE ch.activity_id = a.id AND ch.user_id = %(viewer)s) AS cheered,
      (SELECT count(*) FROM comments cm WHERE cm.activity_id = a.id) AS comment_n
    FROM activities a JOIN users u ON u.id = a.user_id LEFT JOIN profile p ON p.user_id = a.user_id
    CROSS JOIN LATERAL (SELECT coalesce(p.share_trim_m, 400) AS trim_m, ST_Length(a.geom::geography) AS len_m) s"""


def _pick(rows, keys):
    return [{k: r[k] for k in keys if r.get(k) is not None} for r in rows or [] if isinstance(r, dict)]


def shared_activity(r):
    """Build the answer for someone else from a row of _select(): listed fields only, unshared details left out."""
    d = details_of(r['p_details'], r['a_details'])
    out = {k: r[k] for k in ALWAYS}
    for key, cols in FIELDS.items():
        if d[key]: out.update({k: r[k] for k in cols if k in r})
    out['line'] = polyline(json.loads(r['g'])['coordinates']) if d['map'] and r['g'] else None
    out['ends_hidden'] = bool(out['line']) and r['trim_m'] > 0
    hr, el = d['heart_rate'], d['elevation']
    if d['splits'] and d['pace']:   # a split is a pace, so splits need pace too
        sk = ('n', 'distance_m', 'moving_s', 'pace_s_per_km', 'gap_s_per_km') + (('elev_m',) if el else ()) + (('avg_hr',) if hr else ())
        lk = ('distance_m', 'moving_s', 'elapsed_s') + (('avg_hr', 'max_hr') if hr else ()) + (('ascent_m',) if el else ())
        for k in ('splits_km', 'splits_mi'):
            if k in r: out[k] = _pick(r[k], sk)
        if 'laps' in r: out['laps'] = _pick(r['laps'], lk)
    ch = r.get('chart')
    if ch:   # chart series: only the shared ones; without pace, only the distance axis (distance + time = pace)
        keep = [k for k, on in (('speed', d['pace']), ('gap_speed', d['pace']), ('hr', hr), ('alt', el)) if on and ch.get(k)]
        if keep:
            axes = ('d', 't') if d['pace'] or not ch.get('d') else ('d',)
            out['chart'] = {k: ch[k] for k in (*axes, *keep) if ch.get(k)}
    out['owner'] = {'login': r['owner_login'], 'name': r['owner_name']}
    out['shares'] = d
    out.update(cheers=r['cheer_n'], cheered=r['cheered'], comments=r['comment_n'])
    return out


def _params(viewer, tol, **kw):
    return {'viewer': viewer, 'tol': float(tol), 'min_m': MIN_SHOWN_M, **kw}


# ---------- friends ----------
class FriendIn(BaseModel):
    login: str = Field(min_length=1, max_length=60)


def _person(c, login):
    t = c.execute('SELECT id, login::text AS login, name FROM users WHERE login = %s', ((login or '').strip().lower(),)).fetchone()
    if not t: raise HTTPException(404, 'No one on this Lankki has that username')
    return t


def _pair(c, me, them, lock=False):
    return c.execute(f"""SELECT requester, addressee, status FROM friendships
                         WHERE (requester = %(me)s AND addressee = %(them)s) OR (requester = %(them)s AND addressee = %(me)s)
                         {'FOR UPDATE' if lock else ''}""", {'me': me, 'them': them}).fetchone()


@router.get('/friends')
def friends(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute("""SELECT u.login::text AS login, u.name, f.status, f.requester = %(me)s AS sent, f.created, f.accepted
                            FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester = %(me)s THEN f.addressee ELSE f.requester END
                            WHERE %(me)s IN (f.requester, f.addressee) ORDER BY u.name""", {'me': user['id']}).fetchall()
    pick = lambda r: {'login': r['login'], 'name': r['name'], 'since': r['accepted'] or r['created']}
    return {'friends': [pick(r) for r in rows if r['status'] == 'accepted'],
            'incoming': [pick(r) for r in rows if r['status'] == 'pending' and not r['sent']],
            'outgoing': [pick(r) for r in rows if r['status'] == 'pending' and r['sent']]}


def waiting(c, uid):
    return c.execute("SELECT count(*) AS n FROM friendships WHERE addressee = %s AND status = 'pending'", (uid,)).fetchone()['n']


@router.get('/friends/waiting')
def friends_waiting(user=Depends(current_user)):
    with db.connect() as c:
        return {'n': waiting(c, user['id'])}


@router.post('/friends')
def friend_request(body: FriendIn, user=Depends(current_user)):
    """Ask someone to be friends, by their exact username. If they already asked you, you're friends now."""
    with db.connect() as c:
        t = _person(c, body.login)
        if t['id'] == user['id']: raise HTTPException(400, "That's your own username")
        f = _pair(c, user['id'], t['id'], lock=True)
        if f and f['status'] == 'accepted': raise HTTPException(409, f"You and {t['name']} are already friends")
        if f and f['requester'] == t['id']:
            c.execute("UPDATE friendships SET status = 'accepted', accepted = now() WHERE requester = %s AND addressee = %s", (t['id'], user['id']))
            return {'status': 'friends', 'name': t['name']}
        if not f:
            n = c.execute("SELECT count(*) AS n FROM friendships WHERE requester = %s AND status = 'pending'", (user['id'],)).fetchone()['n']
            if n >= MAX_PENDING: raise HTTPException(429, 'You have a lot of requests waiting - cancel some first')
            try:
                with c.transaction():
                    c.execute('INSERT INTO friendships (requester, addressee) VALUES (%s, %s)', (user['id'], t['id']))
            except errors.UniqueViolation:
                pass    # they asked at the same moment; their request stands
    return {'status': 'sent', 'name': t['name']}


@router.post('/friends/{login}/accept')
def friend_accept(login: str, user=Depends(current_user)):
    with db.connect() as c:
        t = _person(c, login)
        if not c.execute("""UPDATE friendships SET status = 'accepted', accepted = now()
                            WHERE requester = %s AND addressee = %s AND status = 'pending' RETURNING 1""", (t['id'], user['id'])).fetchone():
            raise HTTPException(404, 'No request from that person')
        return {'ok': True, 'waiting': waiting(c, user['id'])}


@router.post('/friends/{login}/decline')
def friend_decline(login: str, user=Depends(current_user)):
    """Say no to a request. The other person isn't told; their request just goes away."""
    with db.connect() as c:
        t = _person(c, login)
        c.execute("DELETE FROM friendships WHERE requester = %s AND addressee = %s AND status = 'pending'", (t['id'], user['id']))
        return {'ok': True, 'waiting': waiting(c, user['id'])}


@router.delete('/friends/{login}')
def friend_remove(login: str, user=Depends(current_user)):
    """Cancel a request you sent, or stop being friends (either of you can)."""
    with db.connect() as c:
        t = _person(c, login)
        c.execute("""DELETE FROM friendships WHERE (requester = %(me)s AND addressee = %(them)s)
                       OR (requester = %(them)s AND addressee = %(me)s AND status = 'accepted')""", {'me': user['id'], 'them': t['id']})
    return {'ok': True}


# ---------- sharing settings ----------
class SharingIn(BaseModel):
    default: str | None = Field(None, pattern='^(me|friends|everyone)$')
    details: dict | None = None
    trim_m: int | None = None


@router.get('/sharing')
def sharing(user=Depends(current_user)):
    with db.connect() as c:
        p = c.execute('SELECT share_default, share_details, share_trim_m FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
    return {'default': p.get('share_default', 'me'), 'details': details_of(p.get('share_details')), 'trim_m': p.get('share_trim_m', 400),
            'trims': TRIMS}


@router.put('/sharing')
def set_sharing(body: SharingIn, user=Depends(current_user)):
    sets = {}
    if body.default is not None: sets['share_default'] = body.default
    if body.details is not None: sets['share_details'] = json.dumps(_clean_details(body.details))
    if body.trim_m is not None:
        if body.trim_m not in TRIMS: raise HTTPException(400, 'Choose off, 200, 400 or 800 m')
        sets['share_trim_m'] = body.trim_m
    if sets:
        with db.connect() as c:
            c.execute(f"UPDATE profile SET {', '.join(f'{k} = %s' for k in sets)} WHERE user_id = %s", (*sets.values(), user['id']))
    return {'ok': True}


class ActivitySharingIn(BaseModel):
    visibility: str | None = Field(None, pattern='^(me|friends|everyone)$')
    details: dict | None = None          # this activity's own choice of details
    usual_details: bool = False          # back to the person's usual details


@router.put('/activities/{aid}/sharing')
def set_activity_sharing(aid: int, body: ActivitySharingIn, user=Depends(current_user)):
    sets, args = [], []
    if body.visibility is not None: sets.append('visibility = %s'); args.append(body.visibility)
    if body.usual_details: sets.append('share_details = NULL')
    elif body.details is not None: sets.append('share_details = %s'); args.append(json.dumps(_clean_details(body.details)))
    with db.connect() as c:
        if not c.execute(f"UPDATE activities SET {', '.join(sets or ['id = id'])} WHERE id = %s AND user_id = %s RETURNING id",
                         (*args, aid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- seeing others' activities ----------
@router.get('/feed/friends')
def friends_feed(before: dt.datetime | None = None, limit: int = 25, user=Depends(current_user)):   # a bad date is refused (422)
    """Friends' activities they share with friends or everyone, newest first (page on with ?before=<start_time>)."""
    limit = max(1, min(limit, FEED_MAX))
    q = _select() + f' WHERE a.user_id IN ({FRIEND_IDS}) AND {CAN_SEE}'
    args = _params(user['id'], PREVIEW_TOL, limit=limit)
    if before: q += ' AND a.start_time < %(before)s'; args['before'] = before
    with db.connect() as c:
        rows = c.execute(q + ' ORDER BY a.start_time DESC LIMIT %(limit)s', args).fetchall()
    return [shared_activity(r) for r in rows]


def _social(c, aid, viewer, owner):
    cheers = c.execute("""SELECT u.login::text AS login, u.name FROM cheers ch JOIN users u ON u.id = ch.user_id
                          WHERE ch.activity_id = %s ORDER BY ch.created""", (aid,)).fetchall()
    comments = c.execute("""SELECT cm.id, cm.text, cm.created, u.login::text AS login, u.name,
                              (cm.user_id = %(viewer)s OR %(owner)s) AS can_delete
                            FROM comments cm JOIN users u ON u.id = cm.user_id WHERE cm.activity_id = %(aid)s
                            ORDER BY cm.created, cm.id""", {'viewer': viewer, 'owner': owner == viewer, 'aid': aid}).fetchall()
    cheered = bool(c.execute('SELECT 1 FROM cheers WHERE activity_id = %s AND user_id = %s', (aid, viewer)).fetchone())
    return {'mine': owner == viewer, 'cheers': cheers, 'cheered': cheered, 'comments': comments}


@router.get('/shared/{aid}')
def shared(aid: int, user=Depends(current_user)):
    """Someone else's activity, as they share it. For your own activity: what others see."""
    with db.connect() as c:
        owner = can_see(c, user['id'], aid)
        r = c.execute(_select('a.zones, a.splits_km, a.splits_mi, a.laps, a.chart,') + ' WHERE a.id = %(aid)s',
                      _params(user['id'], DETAIL_TOL, aid=aid)).fetchone()
        out = shared_activity(r)
        out['social'] = _social(c, aid, user['id'], owner)
    return out


@router.get('/activities/{aid}/social')
def social(aid: int, user=Depends(current_user)):
    """Cheers and comments; for the owner also who sees it and which details."""
    with db.connect() as c:
        owner = can_see(c, user['id'], aid)
        out = _social(c, aid, user['id'], owner)
        if owner == user['id']:
            a = c.execute("""SELECT a.visibility, a.share_details, p.share_details AS p_details, p.share_trim_m FROM activities a
                             LEFT JOIN profile p ON p.user_id = a.user_id WHERE a.id = %s""", (aid,)).fetchone()
            out.update(visibility=a['visibility'], details=details_of(a['p_details'], a['share_details']),
                       custom=a['share_details'] is not None, trim_m=a['share_trim_m'])
    return out


@router.post('/activities/{aid}/cheer')
def cheer(aid: int, user=Depends(current_user)):
    with db.connect() as c:
        if can_see(c, user['id'], aid) == user['id']: raise HTTPException(400, "You can't cheer your own activity")
        c.execute('INSERT INTO cheers (activity_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING', (aid, user['id']))
        return _social(c, aid, user['id'], None)


@router.delete('/activities/{aid}/cheer')
def uncheer(aid: int, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM cheers WHERE activity_id = %s AND user_id = %s', (aid, user['id']))
    return {'ok': True}


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@router.post('/activities/{aid}/comments')
def comment(aid: int, body: CommentIn, user=Depends(current_user)):
    text = body.text.strip()
    if not text: raise HTTPException(400, 'Write something first')
    with db.connect() as c:
        owner = can_see(c, user['id'], aid)
        c.execute('INSERT INTO comments (activity_id, user_id, text) VALUES (%s, %s, %s)', (aid, user['id'], text))
        return _social(c, aid, user['id'], owner)


@router.delete('/comments/{cid}')
def comment_delete(cid: int, user=Depends(current_user)):
    """Your own comment, or any comment on your own activity."""
    with db.connect() as c:
        if not c.execute("""DELETE FROM comments cm USING activities a WHERE cm.id = %(cid)s AND a.id = cm.activity_id
                              AND (cm.user_id = %(me)s OR a.user_id = %(me)s) RETURNING cm.id""", {'cid': cid, 'me': user['id']}).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}
