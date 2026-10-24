"""Garmin Connect through Garmin's developer program (OAuth 2.0 with PKCE), for everyone once Garmin approves production keys.

How it works:
  1. Me > Connections > Connect Garmin asks /api/connections/garmin-connect/start for Garmin's consent page and opens it.
  2. Garmin sends the person back to /api/connections/garmin/callback with a one-time code. The state in that link (not the
     login cookie) says whose account it is, so it also works when the iPhone app opens Garmin in Safari.
  3. When a watch syncs, Garmin tells Kinetta, in one of two modes set in the developer portal:
     - ping, to /api/garmin/notify: a list of {userId, callbackURL} with no data, so a forged one can do nothing:
       Kinetta fetches the data itself, from Garmin, with that person's own token;
     - push, to /api/garmin/push/<GARMIN_PUSH_SECRET>: the data itself. Garmin doesn't sign it, so the secret in the
       address is what keeps strangers from posting fake activities.
     Deregistration and permission notices are checked with Garmin before anything changes, in either mode.
  4. Activity details (summary + GPS/heart-rate samples) become activities with source 'garmin_connect'.

The keys come from the environment (GARMIN_CLIENT_ID / GARMIN_CLIENT_SECRET); without them the card stays hidden.
Garmin's terms: data is never sold or shared, and never used to train, evaluate or improve AI models. The AI coach reads
Garmin activities only after the person says yes (profile.garmin_ai_ok, checked in coach.health_ok).
"""
import datetime as dt
import hashlib
import base64
import html
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

from . import activities, coach, db, parsers
from .auth import current_user

router = APIRouter(prefix='/api')

AUTHORIZE = 'https://connect.garmin.com/oauth2Confirm'
TOKEN = 'https://diauth.garmin.com/di-oauth2-service/oauth/token'
API = 'https://apis.garmin.com/wellness-api/rest'
FIRST_DAYS = 30             # best-effort backfill where Garmin access permits history
STATE_TTL = 600             # seconds to finish signing in at Garmin
PING_MAX = 2 * 1024 ** 2    # a ping is a short list of links
DATA_MAX = 64 * 1024 ** 2   # one fetched batch of activity details with samples
_pending, _pending_guard = {}, threading.Lock()   # state -> (user id, PKCE verifier, expiry); one server process
_locks, _locks_guard = {}, threading.Lock()


def keys():
    return os.environ.get('GARMIN_CLIENT_ID', ''), os.environ.get('GARMIN_CLIENT_SECRET', '')


def redirect_uri():
    return (os.environ.get('KINETTA_PUBLIC_URL') or 'https://login.kinetta.app').rstrip('/') + '/api/connections/garmin/callback'


def allowed(user):
    """The admin first, to try it with real data; GARMIN_CONNECT_OPEN=1 offers it to everyone (Ben, 2026-10-23)."""
    return all(keys()) and (bool(user.get('is_admin')) or os.environ.get('GARMIN_CONNECT_OPEN') == '1')


def _gate(user):
    if not allowed(user): raise HTTPException(403, 'Garmin Connect is not available on this account yet')


def _lock(uid):
    with _locks_guard: return _locks.setdefault(uid, threading.Lock())


class Revoked(Exception):
    """Garmin no longer accepts this person's tokens: they disconnected Kinetta in Garmin Connect."""


def _http(url, data=None, headers=None, method=None, cap=DATA_MAX):
    req = urllib.request.Request(url, data=data, method=method, headers={'User-Agent': 'Kinetta/1.0 (+https://kinetta.app)', 'Accept': 'application/json', **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read(cap + 1)
    if len(body) > cap: raise ValueError('Garmin sent more than expected')
    return body


def _token_request(fields):
    cid, secret = keys()
    body = urllib.parse.urlencode({**fields, 'client_id': cid, 'client_secret': secret}).encode()
    try:
        t = json.loads(_http(TOKEN, body, {'Content-Type': 'application/x-www-form-urlencoded'}, 'POST', cap=64 * 1024))
    except urllib.error.HTTPError as e:
        if e.code in (400, 401): raise Revoked(e.code)
        raise
    if not t.get('access_token'): raise ValueError('Garmin sent no access token')
    now = time.time()
    return {'access': t['access_token'], 'refresh': t.get('refresh_token'),
            'expires': now + float(t.get('expires_in') or 3600) - 300,
            'refresh_expires': now + float(t.get('refresh_token_expires_in') or 0) if t.get('refresh_token_expires_in') else None}


# ---------- signing in ----------
class StartIn(BaseModel):
    native: bool = False    # the iPhone app's sign-in sheet: send the answer back to the app, not to a web page


@router.post('/connections/garmin-connect/start')
def start(body: StartIn | None = None, user=Depends(current_user)):
    _gate(user)
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    state = secrets.token_urlsafe(32)
    now = time.time()
    with _pending_guard:
        for k in [k for k, v in _pending.items() if v[2] < now]: del _pending[k]
        _pending[state] = (user['id'], verifier, now + STATE_TTL, bool(body and body.native))
    q = urllib.parse.urlencode({'client_id': keys()[0], 'response_type': 'code', 'code_challenge': challenge,
                                'code_challenge_method': 'S256', 'redirect_uri': redirect_uri(), 'state': state})
    return {'url': f'{AUTHORIZE}?{q}'}


def _page(title, text, ok):
    """Garmin's redirect lands in a browser tab (Safari, for the iPhone app), so the answer is a small page of its own."""
    back = '<p><a href="/me/connections">Back to Kinetta</a></p>'
    return HTMLResponse(f"""<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)}</title><link rel="stylesheet" href="/static/theme.css"><link rel="stylesheet" href="/static/standalone.css">
<main><h1>{html.escape(title)}</h1><p>{html.escape(text)}</p>{back}</main>""", status_code=200 if ok else 400)


@router.get('/connections/garmin/callback')
def callback(state: str = '', code: str = '', error: str = ''):
    with _pending_guard: pend = _pending.pop(state, None)
    if not pend or pend[2] < time.time():
        return _page('That link has expired', 'Start again from Me → Connections in Kinetta.', False)
    uid, verifier, _, native = pend
    page = _page
    if native:      # the app's sheet closes on a kinetta:// address and the app shows the result itself
        page = lambda title, text, ok: RedirectResponse('kinetta://garmin-connect?' + urllib.parse.urlencode({'ok': int(ok), 'title': title, 'text': text}), 302)
    if error or not code:
        return page('Garmin wasn’t connected', 'Nothing was shared. You can try again from Me → Connections.', False)
    try:
        tok = _token_request({'grant_type': 'authorization_code', 'code': code, 'code_verifier': verifier, 'redirect_uri': redirect_uri()})
        gid = str(json.loads(_http(API + '/user/id', headers={'Authorization': 'Bearer ' + tok['access']}))['userId'])
        perms = _permissions(tok['access'])
    except Exception as e:
        print('garmin connect failed', type(e).__name__, flush=True)
        return page('Couldn’t connect Garmin', 'Garmin didn’t finish signing in. Try again in a minute.', False)
    with db.connect() as c:
        other = c.execute("SELECT user_id FROM connections WHERE kind = 'garmin_connect' AND settings->>'garmin_user_id' = %s AND user_id <> %s",
                          (gid, uid)).fetchone()
        if other:
            return page('Already connected elsewhere', 'This Garmin account is connected to a different Kinetta account. Disconnect it there first.', False)
        c.execute("""INSERT INTO connections (user_id, kind, settings, status) VALUES (%s, 'garmin_connect', %s, %s)
                     ON CONFLICT (user_id, kind) DO UPDATE SET settings = excluded.settings, status = excluded.status""",
                  (uid, json.dumps({**tok, 'garmin_user_id': gid, 'permissions': perms}), _status_for(perms, 'connected - new activities arrive after your watch syncs')))
    threading.Thread(target=backfill, args=(uid,), daemon=True).start()
    return page('Garmin is connected', 'New activities arrive after your watch syncs. For older history, import a Strava export or past workouts from Apple Health.', True)


def _perm_list(raw):
    # Garmin answers {"permissions": ["ACTIVITY_EXPORT", ...]} (seen on a real account, 2026-10-24); reading that object
    # as a list gave ['permissions'], so a Health-only connection looked connected with activities on.
    d = json.loads(raw)
    return list(d.get('permissions') or []) if isinstance(d, dict) else list(d)


def _permissions(access):
    try: return _perm_list(_http(API + '/user/permissions', headers={'Authorization': 'Bearer ' + access}))
    except Exception: return []


def _status_for(perms, ok):
    return ok if 'ACTIVITY_EXPORT' in perms or not perms else 'connected - activity sharing is off in Garmin Connect'


# ---------- tokens ----------
def _settings(c, uid, lock=False):
    r = c.execute("SELECT settings FROM connections WHERE user_id = %s AND kind = 'garmin_connect'" + (' FOR UPDATE' if lock else ''), (uid,)).fetchone()
    return r['settings'] if r else None


def access_token(uid):
    """A valid access token, refreshing it under a row lock so two threads never spend the same refresh token."""
    with db.connect() as c:
        s = _settings(c, uid, lock=True)
        if not s: raise Revoked('not connected')
        if s.get('expires', 0) > time.time(): return s['access']
        if not s.get('refresh'): raise Revoked('no refresh token')
        tok = _token_request({'grant_type': 'refresh_token', 'refresh_token': s['refresh']})
        tok['refresh'] = tok['refresh'] or s['refresh']
        c.execute("UPDATE connections SET settings = settings || %s::jsonb WHERE user_id = %s AND kind = 'garmin_connect'", (json.dumps(tok), uid))
        return tok['access']


def _get(uid, url):
    for attempt in (0, 1):
        tok = access_token(uid)
        try: return _http(url, headers={'Authorization': 'Bearer ' + tok})
        except urllib.error.HTTPError as e:
            if e.code != 401 or attempt: raise
            with db.connect() as c:     # Garmin says the token is no good: force one refresh, then give up
                c.execute("UPDATE connections SET settings = settings || '{\"expires\": 0}'::jsonb WHERE user_id = %s AND kind = 'garmin_connect'", (uid,))


def _set_status(uid, status, count=None):
    with db.connect() as c:
        if count is None: c.execute("UPDATE connections SET status = %s WHERE user_id = %s AND kind = 'garmin_connect'", (status, uid))
        else: c.execute("UPDATE connections SET status = %s, last_sync = now(), last_count = %s WHERE user_id = %s AND kind = 'garmin_connect'", (status, count, uid))


def backfill(uid, days=FIRST_DAYS):
    """Best-effort request for recent activity details where supported; Starter access excludes history."""
    end = int(time.time())
    try:
        _get(uid, f'{API}/backfill/activityDetails?summaryStartTimeInSeconds={end - days * 86400}&summaryEndTimeInSeconds={end}')
    except urllib.error.HTTPError as e:
        if e.code != 409: _set_status(uid, f'connected - Garmin couldn’t resend older activities ({e.code})')   # 409: already asked
    except Exception as e:
        print('garmin backfill failed', type(e).__name__, flush=True)


# ---------- notices from Garmin ----------
def _garmin_url(url):
    """Only Garmin's own API, over HTTPS: a forged ping must not make the server send a token anywhere else."""
    p = urllib.parse.urlsplit(str(url or ''))
    return p.scheme == 'https' and p.hostname == 'apis.garmin.com' and p.port in (None, 443) and p.path.startswith('/wellness-api/rest/') and not p.username


def _owner(gid):
    with db.connect() as c:
        r = c.execute("SELECT user_id FROM connections WHERE kind = 'garmin_connect' AND settings->>'garmin_user_id' = %s", (str(gid),)).fetchone()
    return r['user_id'] if r else None


def push_secret():
    return os.environ.get('GARMIN_PUSH_SECRET', '')


async def _read(request, cap):
    parts, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > cap: raise HTTPException(413, 'Too large')
        parts.append(chunk)
    try: body = json.loads(b''.join(parts) or b'{}')
    except ValueError: raise HTTPException(400, 'Body must be JSON')
    if not isinstance(body, dict): raise HTTPException(400, 'Body must be an object')
    return body


@router.post('/garmin/notify')
async def notify(request: Request):
    """Ping mode: notices with links only, so it needs no secret. Answer fast; work in the background."""
    body = await _read(request, PING_MAX)
    threading.Thread(target=handle, args=(body, False), daemon=True).start()
    return {'ok': True}


@router.post('/garmin/push/{secret}')
async def push(secret: str, request: Request):
    """Push mode: Garmin posts the data itself, unsigned, so the address carries a secret only Garmin's portal knows
    (GARMIN_PUSH_SECRET). Without it nobody can add activities to someone's account."""
    want = push_secret()
    if len(want) < 32 or not secrets.compare_digest(secret.encode(), want.encode()): raise HTTPException(404, 'Not found')
    body = await _read(request, DATA_MAX)
    threading.Thread(target=handle, args=(body, True), daemon=True).start()
    return {'ok': True}


def handle(body, pushed=False):
    details = {}     # user id -> pushed activity details
    for kind, items in body.items():
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict): continue
            uid = _owner(item.get('userId'))
            if not uid: continue
            try:
                if kind == 'deregistrations': check_still_connected(uid)
                elif kind == 'userPermissionsChange': refresh_permissions(uid)
                elif kind == 'activityDetails' and _garmin_url(item.get('callbackURL')): fetch_details(uid, item['callbackURL'])
                elif kind == 'activityDetails' and pushed and isinstance(item.get('summary'), dict): details.setdefault(uid, []).append(item)
            except Exception as e:
                print('garmin notice failed', kind, type(e).__name__, flush=True)
    for uid, items in details.items():
        try: store_details(uid, items)
        except Exception as e: print('garmin push failed', type(e).__name__, flush=True)


def check_still_connected(uid):
    """Garmin says this person disconnected Kinetta. Confirm with Garmin before forgetting the tokens."""
    try:
        _get(uid, API + '/user/id')
    except (Revoked, urllib.error.HTTPError) as e:
        if isinstance(e, urllib.error.HTTPError) and e.code not in (401, 403): raise
        with db.connect() as c:
            c.execute("DELETE FROM connections WHERE user_id = %s AND kind = 'garmin_connect'", (uid,))


def refresh_permissions(uid):
    perms = _perm_list(_get(uid, API + '/user/permissions'))
    with db.connect() as c:
        c.execute("""UPDATE connections SET settings = jsonb_set(settings, '{permissions}', %s::jsonb), status = %s
                     WHERE user_id = %s AND kind = 'garmin_connect'""", (json.dumps(perms), _status_for(perms, 'connected'), uid))


def fetch_details(uid, url):
    data = json.loads(_get(uid, url))
    store_details(uid, data if isinstance(data, list) else [])


def store_details(uid, items):
    with _lock(uid):
        added, dup, failed, new_ids = 0, 0, 0, []
        for item in items:
            try:
                parsed, meta = activity(item)
                res, aid = activities.store(uid, parsed, meta, raw=json.dumps(item, sort_keys=True).encode(), ext='.garmin.json', source='garmin_connect')
                if res == 'added': added += 1; new_ids.append(aid)
                else: dup += 1
            except Exception as e:
                failed += 1; print('garmin activity failed', type(e).__name__, e, flush=True)
        _set_status(uid, f'{added} new, {dup} already here' + (f', {failed} failed' if failed else ''), added)
    coach.after_import(uid, new_ids)


def activity(item):
    """One Health API activityDetails record -> the parser's common shape."""
    s = item.get('summary') or {}
    if not s.get('startTimeInSeconds'): raise ValueError('activity without a start time')
    utc = dt.timezone.utc
    start = dt.datetime.fromtimestamp(int(s['startTimeInSeconds']), utc)
    kind = s.get('activityType') or 'Activity'
    sport = parsers.sport_of(kind)
    rows = []
    for p in item.get('samples') or []:
        if not isinstance(p, dict) or p.get('startTimeInSeconds') is None: continue
        v = {'lat': p.get('latitudeInDegree'), 'lon': p.get('longitudeInDegree'), 'alt': p.get('elevationInMeters'),
             'dist': p.get('totalDistanceInMeters'), 'hr': p.get('heartRate'), 'speed': p.get('speedMetersPerSecond'),
             'power': p.get('powerInWatts'), 'temp': p.get('airTemperatureCelcius'),
             'cad': p.get('bikeCadenceInRPM') if sport == 'ride' else None}
        if v['lat'] is None or v['lon'] is None: v['lat'] = v['lon'] = None
        rows.append((dt.datetime.fromtimestamp(int(p['startTimeInSeconds']), utc), v))
    session = {'elapsed_s': s.get('durationInSeconds'), 'distance_m': s.get('distanceInMeters'), 'calories': s.get('activeKilocalories'),
               'ascent_m': s.get('totalElevationGainInMeters'), 'avg_hr': s.get('averageHeartRateInBeatsPerMinute'),
               'max_hr': s.get('maxHeartRateInBeatsPerMinute')}
    out = parsers._finish(start, rows, sport, None, s.get('deviceName') or 'Garmin', session, [])
    return out, {'sport_label': kind.replace('_', ' ').capitalize(), 'source_id': str(item.get('activityId') or item.get('summaryId') or ''),
                 'distance_m': session['distance_m'], 'elapsed_s': session['elapsed_s'], 'start': start}


# ---------- disconnecting ----------
def deregister(s):
    """Garmin's DELETE registration with a stored token set (refreshed here if needed: the account row may already be gone)."""
    try:
        access = s['access'] if s.get('expires', 0) > time.time() else _token_request({'grant_type': 'refresh_token', 'refresh_token': s['refresh']})['access']
        _http(API + '/user/registration', headers={'Authorization': 'Bearer ' + access}, method='DELETE')
    except Exception as e:
        print('garmin deregistration failed', type(e).__name__, flush=True)


def forget(uid):
    """Tell Garmin to stop sending this person's data, then drop the tokens either way. Used by Disconnect."""
    with db.connect() as c: s = _settings(c, uid)
    if s: deregister(s)
    with db.connect() as c:
        c.execute("DELETE FROM connections WHERE user_id = %s AND kind = 'garmin_connect'", (uid,))


@router.post('/connections/garmin-connect/sync')
def sync_now(user=Depends(current_user)):
    """No polling with these keys (Garmin sends notices instead); Sync now asks Garmin to resend the last two days."""
    _gate(user)
    threading.Thread(target=backfill, args=(user['id'], 2), daemon=True).start()
    return {'ok': True}
