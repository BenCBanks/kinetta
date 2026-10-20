"""Friends and sharing (2026-10-11): friend requests (find people by name or username), who sees each activity (only me / friends /
everyone on this Kinetta), which details others see, shared maps without the start and end, a friends feed, cheers and
comments, and blocking and reporting people (Apple requires both).

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
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from psycopg import errors
from pydantic import BaseModel, Field
from typing import Literal

from . import db, notify, reactions
from .api_account import _admin
from .api_activities import DETAIL_TOL, PHOTOS_SQL, PREVIEW_TOL, polyline
from .auth import current_user
from .activity_chart import sunday, weekly_distances
from .admin_auth import admin_user, audit

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

# Blocking works both ways: neither person sees the other's activities, cheers or comments, finds them in search or
# can ask them to be friends. {who} is the other person's id column.
def blocked(who):
    return f"""EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id = %(viewer)s AND b.blocked = {who})
                                         OR (b.user_id = {who} AND b.blocked = %(viewer)s))"""


CAN_SEE = f"""(a.user_id = %(viewer)s OR (NOT {blocked('a.user_id')} AND (a.visibility = 'everyone' OR (a.visibility = 'friends' AND EXISTS (
    SELECT 1 FROM friendships f WHERE f.status = 'accepted'
      AND ((f.requester = a.user_id AND f.addressee = %(viewer)s) OR (f.addressee = a.user_id AND f.requester = %(viewer)s)))))))"""
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
      a.share_details AS a_details, p.share_details AS p_details, s.trim_m, u.login::text AS owner_login, u.name AS owner_name, u.photo_v AS owner_photo, {PHOTOS_SQL},
      CASE WHEN a.geom IS NULL THEN NULL
           WHEN s.trim_m = 0 THEN ST_AsGeoJSON(ST_Simplify(a.geom, %(tol)s))
           WHEN s.len_m < 2 * s.trim_m + %(min_m)s THEN NULL
           ELSE ST_AsGeoJSON(ST_Simplify(ST_Transform(ST_LineSubstring(ST_Transform(a.geom, 3857),
                  s.trim_m / s.len_m, 1 - s.trim_m / s.len_m), 4326), %(tol)s)) END AS g,
      (SELECT count(*) FROM cheers ch WHERE ch.activity_id = a.id AND {reactions.visible('%(viewer)s')}) AS cheer_n,
      {reactions.columns('%(viewer)s')},
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
    out['owner'] = {'login': r['owner_login'], 'name': r['owner_name'], 'photo': r['owner_photo']}
    out['photos'] = r['photos']    # photos follow the activity: whoever sees it sees them (api_photos.py)
    out['shares'] = d
    out.update(cheers=r['cheer_n'], cheered=r['cheered'], comments=r['comment_n'],reactions=r['reactions'],my_reaction=r['my_reaction'])
    return out


def _params(viewer, tol, **kw):
    return {'viewer': viewer, 'tol': float(tol), 'min_m': MIN_SHOWN_M, **kw}


# ---------- friends ----------
class FriendIn(BaseModel):
    login: str = Field(min_length=1, max_length=60)


def _person(c, login):
    t = c.execute('SELECT id, login::text AS login, name FROM users WHERE login = %s', ((login or '').strip().lower(),)).fetchone()
    if not t: raise HTTPException(404, 'No one on this Kinetta has that username')
    return t


def _blocked_pair(c, me, them):
    return bool(c.execute('SELECT 1 FROM blocks WHERE (user_id = %s AND blocked = %s) OR (user_id = %s AND blocked = %s)',
                          (me, them, them, me)).fetchone())


def _pair(c, me, them, lock=False):
    return c.execute(f"""SELECT requester, addressee, status FROM friendships
                         WHERE (requester = %(me)s AND addressee = %(them)s) OR (requester = %(them)s AND addressee = %(me)s)
                         {'FOR UPDATE' if lock else ''}""", {'me': me, 'them': them}).fetchone()


@router.get('/friends')
def friends(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute("""SELECT u.login::text AS login, u.name, u.photo_v AS photo, f.status, f.requester = %(me)s AS sent, f.created, f.accepted
                            FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester = %(me)s THEN f.addressee ELSE f.requester END
                            WHERE %(me)s IN (f.requester, f.addressee) ORDER BY u.name""", {'me': user['id']}).fetchall()
    pick = lambda r: {'login': r['login'], 'name': r['name'], 'photo': r['photo'], 'since': r['accepted'] or r['created']}
    return {'friends': [pick(r) for r in rows if r['status'] == 'accepted'],
            'incoming': [pick(r) for r in rows if r['status'] == 'pending' and not r['sent']],
            'outgoing': [pick(r) for r in rows if r['status'] == 'pending' and r['sent']]}


def waiting(c, uid):
    return c.execute("SELECT count(*) AS n FROM friendships WHERE addressee = %s AND status = 'pending'", (uid,)).fetchone()['n']


@router.get('/friends/waiting')
def friends_waiting(user=Depends(current_user)):
    with db.connect() as c:
        return {'n': waiting(c, user['id'])}


@router.get('/people/search')
def people_search(q: str = Query('', max_length=60), user=Depends(current_user)):
    """Find people to add by name or username (like Strava's athlete search). Only names and usernames come back,
    with where you stand with each: never anything they've logged. At most 20 people; an empty query discovers people.
    Someone who turned off "Let people find me" shows up only when the search is exactly their username, or when
    you're already friends or have a request between you."""
    q = q.strip().removeprefix('@').strip()
    like = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    with db.connect() as c:
        rows = c.execute("""SELECT u.login::text AS login, u.name, u.photo_v AS photo, f.status, f.requester = %(me)s AS sent
            FROM users u LEFT JOIN friendships f ON (f.requester = %(me)s AND f.addressee = u.id) OR (f.requester = u.id AND f.addressee = %(me)s)
            LEFT JOIN profile p ON p.user_id = u.id
            WHERE u.id <> %(me)s AND u.pw_hash IS NOT NULL AND NOT {blocked}
              AND (coalesce(p.findable, true) OR f.status IS NOT NULL OR u.login = lower(%(q)s))
              AND (%(q)s = '' OR u.login ILIKE %(match)s OR u.name ILIKE %(match)s)
            ORDER BY (u.login = lower(%(q)s)) DESC, (lower(u.name) = lower(%(q)s)) DESC,
                     (f.status = 'accepted') DESC NULLS LAST, u.name, u.login LIMIT 20""".replace('{blocked}', blocked('u.id')),
                         {'viewer': user['id'], 'me': user['id'], 'q': q, 'match': '%' + like + '%'}).fetchall()
    rel = lambda r: 'friends' if r['status'] == 'accepted' else ('sent' if r['sent'] else 'incoming') if r['status'] else None
    return [{'login': r['login'], 'name': r['name'], 'photo': r['photo'], 'status': rel(r)} for r in rows]


@router.get('/people/{login}/profile')
def public_profile(login: str, before: dt.datetime | None = None, before_id: int | None = None,
                   limit: int = Query(20, ge=1, le=50), as_friend: bool = False, user=Depends(current_user)):
    """An authenticated profile directory, never a bypass around activity visibility or blocking.
    as_friend (your own profile only): what a friend sees - your activities shared with friends or everyone."""
    with db.connect() as c:
        person = c.execute("""SELECT id, login::text AS login, name, photo_v AS photo, created
                              FROM users WHERE login = %s AND pw_hash IS NOT NULL""", (login.lower(),)).fetchone()
        if not person or _blocked_pair(c, user['id'], person['id']): raise HTTPException(404, 'Not found')
        person['bio'] = (c.execute('SELECT bio FROM profile WHERE user_id = %s', (person['id'],)).fetchone() or {}).get('bio', '')
        relation = _pair(c, user['id'], person['id'])
        status = ('friends' if relation['status'] == 'accepted' else
                  'sent' if relation['requester'] == user['id'] else 'incoming') if relation else None
        params = _params(user['id'], PREVIEW_TOL, person=person['id'], limit=limit + 1)
        visible = f'a.user_id = %(person)s AND {CAN_SEE}'
        if as_friend and person['id'] == user['id']: visible += " AND a.visibility IN ('friends', 'everyone')"
        overview = c.execute(f"""SELECT count(*) AS activities, coalesce(sum(a.distance_m), 0) AS distance_m,
                                  coalesce(sum(coalesce(a.moving_s, a.elapsed_s)), 0) AS time_s
                                  FROM activities a WHERE {visible}""", params).fetchone()
        sports = c.execute(f"""SELECT a.sport, count(*) AS activities, coalesce(sum(a.distance_m),0) AS distance_m,
                                coalesce(sum(coalesce(a.moving_s,a.elapsed_s)),0) AS time_s
                                FROM activities a WHERE {visible} GROUP BY a.sport ORDER BY count(*) DESC, a.sport""", params).fetchall()
        # Use the identical visibility predicate, before pagination. Dates follow the viewer's settings.
        zone = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
        today = dt.datetime.now(ZoneInfo(zone)).date()
        # Both periods reuse the feed's visibility rule, even for the owner's friend preview.
        recent_start, recent_end = today - dt.timedelta(days=29), today + dt.timedelta(days=1)
        params.update(chart_zone=zone, recent_start=recent_start, recent_end=recent_end,
                      previous_start=recent_start - dt.timedelta(days=30))
        periods = c.execute(f"""SELECT
                    CASE WHEN a.start_time AT TIME ZONE %(chart_zone)s >= %(recent_start)s THEN 'current' ELSE 'previous' END AS period,
                    count(*) AS activities, coalesce(sum(a.distance_m), 0) AS distance_m,
                    coalesce(sum(coalesce(a.moving_s, a.elapsed_s)), 0) AS time_s,
                    count(DISTINCT (a.start_time AT TIME ZONE %(chart_zone)s)::date) AS active_days
                    FROM activities a WHERE {visible}
                    AND a.start_time AT TIME ZONE %(chart_zone)s >= %(previous_start)s
                    AND a.start_time AT TIME ZONE %(chart_zone)s < %(recent_end)s GROUP BY 1""", params).fetchall()
        empty_period = {'activities': 0, 'distance_m': 0, 'time_s': 0, 'active_days': 0}
        by_period = {row['period']: {k: row[k] for k in empty_period} for row in periods}
        recent = {'start': recent_start, 'end': today, 'current': by_period.get('current', empty_period),
                  'previous': by_period.get('previous', empty_period)}
        first_day = today - dt.timedelta(days=13)
        params.update(chart_zone=zone, chart_start=sunday(today) - dt.timedelta(weeks=6), chart_end=today + dt.timedelta(days=1))
        distances = c.execute(f"""SELECT (a.start_time AT TIME ZONE %(chart_zone)s)::date AS d,
                    coalesce(sum(a.distance_m), 0) AS distance_m FROM activities a
                    WHERE {visible} AND a.start_time AT TIME ZONE %(chart_zone)s >= %(chart_start)s
                    AND a.start_time AT TIME ZONE %(chart_zone)s < %(chart_end)s GROUP BY 1""", params).fetchall()
        by_day = {row['d']: float(row['distance_m']) for row in distances}
        mileage = {'today': today, 'weeks': weekly_distances(today, by_day), 'days': [{'d': first_day + dt.timedelta(days=i),
                            'distance_m': by_day.get(first_day + dt.timedelta(days=i), 0),
                            'today': i == 13} for i in range(14)]}
        query = _select() + ' WHERE ' + visible
        if before:
            query += ' AND (a.start_time < %(before)s OR (a.start_time = %(before)s AND a.id < %(before_id)s))'
            params.update(before=before, before_id=before_id or 0)
        rows = c.execute(query + ' ORDER BY a.start_time DESC, a.id DESC LIMIT %(limit)s', params).fetchall()
    items = [shared_activity(row) for row in rows[:limit]]
    last = rows[limit - 1] if len(rows) > limit else None
    return {'person': {k: person[k] for k in ('login', 'name', 'photo', 'created', 'bio')}, 'status': status,
            'mileage': mileage, 'recent': recent, 'mine': person['id'] == user['id'], 'overview': overview, 'sports': sports, 'items': items,
            'next': {'before': last['start_time'], 'before_id': last['id']} if last else None}


@router.post('/friends')
def friend_request(body: FriendIn, user=Depends(current_user)):
    """Ask someone to be friends, by their exact username. If they already asked you, you're friends now."""
    with db.connect() as c:
        t = _person(c, body.login)
        if t['id'] == user['id']: raise HTTPException(400, "That's your own username")
        if _blocked_pair(c, user['id'], t['id']): raise HTTPException(404, 'No one on this Kinetta has that username')
        f = _pair(c, user['id'], t['id'], lock=True)
        if f and f['status'] == 'accepted': raise HTTPException(409, f"You and {t['name']} are already friends")
        if f and f['requester'] == t['id']:
            c.execute("UPDATE friendships SET status = 'accepted', accepted = now() WHERE requester = %s AND addressee = %s", (t['id'], user['id']))
            notify.drop(c, user['id'], 'friend_request', t['id']); notify.add(c, t['id'], 'friend_accepted', user['id'])
            return {'status': 'friends', 'name': t['name']}
        if not f:
            n = c.execute("SELECT count(*) AS n FROM friendships WHERE requester = %s AND status = 'pending'", (user['id'],)).fetchone()['n']
            if n >= MAX_PENDING: raise HTTPException(429, 'You have a lot of requests waiting - cancel some first')
            try:
                with c.transaction():
                    c.execute('INSERT INTO friendships (requester, addressee) VALUES (%s, %s)', (user['id'], t['id']))
                notify.add(c, t['id'], 'friend_request', user['id'])
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
        notify.drop(c, user['id'], 'friend_request', t['id']); notify.add(c, t['id'], 'friend_accepted', user['id'])
        return {'ok': True, 'waiting': waiting(c, user['id'])}


@router.post('/friends/{login}/decline')
def friend_decline(login: str, user=Depends(current_user)):
    """Say no to a request. The other person isn't told; their request just goes away."""
    with db.connect() as c:
        t = _person(c, login)
        c.execute("DELETE FROM friendships WHERE requester = %s AND addressee = %s AND status = 'pending'", (t['id'], user['id']))
        notify.drop(c, user['id'], 'friend_request', t['id'])
        return {'ok': True, 'waiting': waiting(c, user['id'])}


@router.delete('/friends/{login}')
def friend_remove(login: str, user=Depends(current_user)):
    """Cancel a request you sent, or stop being friends (either of you can)."""
    with db.connect() as c:
        t = _person(c, login)
        c.execute("""DELETE FROM friendships WHERE (requester = %(me)s AND addressee = %(them)s)
                       OR (requester = %(them)s AND addressee = %(me)s AND status = 'accepted')""", {'me': user['id'], 'them': t['id']})
        notify.drop(c, t['id'], 'friend_request', user['id'])           # a request you cancelled stops showing for them
        # dishes either of you shared with the other stop being shared (api_dishes also checks the friendship)
        c.execute("""DELETE FROM dish_shares s USING dishes d WHERE s.dish_id = d.id
                       AND ((d.user_id = %(me)s AND s.user_id = %(them)s) OR (d.user_id = %(them)s AND s.user_id = %(me)s))""",
                  {'me': user['id'], 'them': t['id']})
    return {'ok': True}


# ---------- sharing settings ----------
class SharingIn(BaseModel):
    default: str | None = Field(None, pattern='^(me|friends|everyone)$')
    details: dict | None = None
    trim_m: int | None = None
    findable: bool | None = None         # show me in friend search


@router.get('/sharing')
def sharing(user=Depends(current_user)):
    with db.connect() as c:
        p = c.execute('SELECT share_default, share_details, share_trim_m, findable FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
    return {'default': p.get('share_default', 'everyone'), 'details': details_of(p.get('share_details')), 'trim_m': p.get('share_trim_m', 400),
            'trims': TRIMS, 'findable': p.get('findable', True)}


@router.put('/sharing')
def set_sharing(body: SharingIn, user=Depends(current_user)):
    sets = {}
    if body.default is not None: sets['share_default'] = body.default
    if body.details is not None: sets['share_details'] = json.dumps(_clean_details(body.details))
    if body.trim_m is not None:
        if body.trim_m not in TRIMS: raise HTTPException(400, 'Choose off, 200, 400 or 800 m')
        sets['share_trim_m'] = body.trim_m
    if body.findable is not None: sets['findable'] = body.findable
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
    cheers = c.execute(f"""SELECT u.login::text AS login, u.name, u.photo_v AS photo, ch.kind FROM cheers ch JOIN users u ON u.id = ch.user_id
                           WHERE ch.activity_id = %(aid)s AND NOT {blocked('u.id')} ORDER BY ch.created""", {'aid': aid, 'viewer': viewer}).fetchall()
    comments = c.execute(f"""SELECT cm.id, cm.text, cm.created, u.login::text AS login, u.name, u.photo_v AS photo,
                              (cm.user_id = %(viewer)s OR %(owner)s) AS can_delete
                            FROM comments cm JOIN users u ON u.id = cm.user_id WHERE cm.activity_id = %(aid)s AND NOT {blocked('u.id')}
                            ORDER BY cm.created, cm.id""", {'viewer': viewer, 'owner': owner == viewer, 'aid': aid}).fetchall()
    mine=c.execute('SELECT kind FROM cheers WHERE activity_id=%s AND user_id=%s',(aid,viewer)).fetchone()
    return {'mine':owner==viewer,'cheers':cheers,'cheered':bool(mine),'my_reaction':mine['kind'] if mine else None,'reactions':reactions.summary(cheers),'comments':comments}


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


class ReactionIn(BaseModel):
    kind:Literal['cheer','strong','applause']='cheer'


def _react(aid,kind,user):
    with db.connect() as c:
        owner=can_see(c,user['id'],aid)
        changed=c.execute("""INSERT INTO cheers(activity_id,user_id,kind) VALUES(%s,%s,%s)
          ON CONFLICT(activity_id,user_id) DO UPDATE SET kind=excluded.kind
          WHERE cheers.kind<>excluded.kind RETURNING kind""",(aid,user['id'],kind)).fetchone()
        if changed and owner!=user['id']:notify.add(c,owner,'cheer',user['id'],activity_id=aid,reaction_kind=kind)
        return _social(c,aid,user['id'],owner)


@router.post('/activities/{aid}/reaction')
def react(aid:int,body:ReactionIn,user=Depends(current_user)):
    return _react(aid,body.kind,user)


@router.post('/activities/{aid}/cheer')
def cheer(aid:int,user=Depends(current_user)):
    # Existing phones retain the one-tap Cheers action.
    return _react(aid,'cheer',user)


@router.delete('/activities/{aid}/reaction')
@router.delete('/activities/{aid}/cheer')
def uncheer(aid:int,user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM cheers WHERE activity_id=%s AND user_id=%s',(aid,user['id']))
        c.execute("UPDATE notifications SET cancelled=true WHERE kind='cheer' AND activity_id=%s AND actor_id=%s",(aid,user['id']))
        try:owner=can_see(c,user['id'],aid)
        except HTTPException as error:
            if error.status_code==404:return {'ok':True}
            raise
        return _social(c,aid,user['id'],owner)


class CommentIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)


@router.post('/activities/{aid}/comments')
def comment(aid: int, body: CommentIn, user=Depends(current_user)):
    text = body.text.strip()
    if not text: raise HTTPException(400, 'Write something first')
    with db.connect() as c:
        owner = can_see(c, user['id'], aid)
        cid = c.execute('INSERT INTO comments (activity_id, user_id, text) VALUES (%s, %s, %s) RETURNING id', (aid, user['id'], text)).fetchone()['id']
        notify.add(c, owner, 'comment', user['id'], activity_id=aid, comment_id=cid)
        return _social(c, aid, user['id'], owner)


@router.delete('/comments/{cid}')
def comment_delete(cid: int, user=Depends(current_user)):
    """Your own comment, or any comment on your own activity."""
    with db.connect() as c:
        if not c.execute("""DELETE FROM comments cm USING activities a WHERE cm.id = %(cid)s AND a.id = cm.activity_id
                              AND (cm.user_id = %(me)s OR a.user_id = %(me)s) RETURNING cm.id""", {'cid': cid, 'me': user['id']}).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- blocking and reporting (2026-10-11; App Store guideline 1.2) ----------
@router.get('/blocks')
def blocks(user=Depends(current_user)):
    with db.connect() as c:
        return c.execute("""SELECT u.login::text AS login, u.name, u.photo_v AS photo, b.created AS since FROM blocks b JOIN users u ON u.id = b.blocked
                            WHERE b.user_id = %s ORDER BY u.name""", (user['id'],)).fetchall()


@router.post('/people/{login}/block')
def block(login: str, user=Depends(current_user)):
    """Block someone: you stop being friends (requests either way go too), dishes stop being shared, notifications
    between you are removed, and from now on neither of you sees the other. They aren't told."""
    with db.connect() as c:
        t = _person(c, login)
        if t['id'] == user['id']: raise HTTPException(400, "You can't block yourself")
        c.execute('INSERT INTO blocks (user_id, blocked) VALUES (%s, %s) ON CONFLICT DO NOTHING', (user['id'], t['id']))
        pair = {'me': user['id'], 'them': t['id']}
        c.execute("""DELETE FROM friendships WHERE (requester = %(me)s AND addressee = %(them)s)
                       OR (requester = %(them)s AND addressee = %(me)s)""", pair)
        c.execute("""DELETE FROM dish_shares s USING dishes d WHERE s.dish_id = d.id
                       AND ((d.user_id = %(me)s AND s.user_id = %(them)s) OR (d.user_id = %(them)s AND s.user_id = %(me)s))""", pair)
        c.execute("""DELETE FROM notifications WHERE (user_id = %(me)s AND actor_id = %(them)s)
                       OR (user_id = %(them)s AND actor_id = %(me)s)""", pair)
    return {'ok': True, 'name': t['name']}


@router.delete('/people/{login}/block')
def unblock(login: str, user=Depends(current_user)):
    with db.connect() as c:
        t = _person(c, login)
        c.execute('DELETE FROM blocks WHERE user_id = %s AND blocked = %s', (user['id'], t['id']))
    return {'ok': True}


REASONS = ('spam', 'abuse', 'inappropriate', 'other')
MAX_OPEN_REPORTS = 20      # per person reporting, so the admins' list can't be flooded


class ReportIn(BaseModel):
    login: str = Field(min_length=1, max_length=60)
    activity_id: int | None = None
    comment_id: int | None = None
    reason: str = Field(pattern='^(spam|abuse|inappropriate|other)$')
    note: str | None = Field(None, max_length=500)


@router.post('/reports')
def report(body: ReportIn, user=Depends(current_user)):
    """Report a person, one of their activities or one of their comments to this server's admins. Only something you
    can see can be reported; the admins get a notification and a copy of the words as they were."""
    with db.connect() as c:
        t = _person(c, body.login)
        if t['id'] == user['id']: raise HTTPException(400, "You can't report yourself")
        what = f"{t['name']} (@{t['login']})"
        if body.comment_id:
            cm = c.execute('SELECT activity_id, user_id, text FROM comments WHERE id = %s', (body.comment_id,)).fetchone()
            if not cm or cm['user_id'] != t['id']: raise HTTPException(404, 'Not found')
            can_see(c, user['id'], cm['activity_id'])
            body.activity_id, what = cm['activity_id'], f'Comment: "{cm["text"]}"'
        elif body.activity_id:
            if can_see(c, user['id'], body.activity_id) != t['id']: raise HTTPException(404, 'Not found')
            a = c.execute('SELECT name, description FROM activities WHERE id = %s', (body.activity_id,)).fetchone()
            what = f"Activity: {a['name']}" + (f" - {a['description']}" if a['description'] else '')
        n = c.execute("SELECT count(*) AS n FROM reports WHERE reporter = %s AND status = 'open'", (user['id'],)).fetchone()['n']
        if n >= MAX_OPEN_REPORTS: raise HTTPException(429, 'You have a lot of reports waiting - the admins will get to them')
        rid = c.execute("""INSERT INTO reports (reporter, person, activity_id, comment_id, what, reason, note)
                           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                        (user['id'], t['id'], body.activity_id, body.comment_id, what[:1000], body.reason,
                         (body.note or '').strip() or None)).fetchone()['id']
        for a in c.execute('SELECT id FROM users WHERE is_admin AND id <> %s', (user['id'],)).fetchall():
            notify.add(c, a['id'], 'report', user['id'])
    return {'ok': True, 'id': rid}


def reports(user=Depends(admin_user)):
    """Open reports, for the admins (Me > People)."""
    _admin(user)
    with db.connect() as c:
        return c.execute("""SELECT r.id, r.what, r.reason, r.note, r.created, r.activity_id, r.comment_id,
                              p.login::text AS login, p.name, p.photo_v AS photo, rp.name AS reporter
                            FROM reports r JOIN users p ON p.id = r.person LEFT JOIN users rp ON rp.id = r.reporter
                            WHERE r.status = 'open' ORDER BY r.created""").fetchall()


def report_done(rid: int, remove: bool = False, user=Depends(admin_user)):
    """Close a report. remove=true also takes the reported thing down: the comment is deleted, the activity goes back
    to "Only me" (it stays in its owner's account), or for a report about the person, their profile photo is removed."""
    _admin(user)
    with db.connect() as c:
        r = c.execute("UPDATE reports SET status = 'done' WHERE id = %s RETURNING person, activity_id, comment_id", (rid,)).fetchone()
        if not r: raise HTTPException(404, 'Not found')
        if remove and r['comment_id']: c.execute('DELETE FROM comments WHERE id = %s', (r['comment_id'],))
        elif remove and r['activity_id']: c.execute("UPDATE activities SET visibility = 'me' WHERE id = %s", (r['activity_id'],))
        elif remove:
            c.execute('DELETE FROM profile_photos WHERE user_id = %s', (r['person'],))
            c.execute('UPDATE users SET photo_v = NULL WHERE id = %s', (r['person'],))
        audit(c,user['id'],'report.remove' if remove else 'report.resolve',rid)
    return {'ok': True}
