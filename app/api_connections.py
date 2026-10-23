"""Automatic connections.

Apple Watch: the iPhone app "Health Auto Export" (Premium: REST API automation) POSTs JSON to
    https://<your Kinetta address>/api/ingest/apple     with header   Authorization: Bearer <token from Me > Connections>
  Workouts become activities (route + heart rate when present); body-mass metrics become weigh-ins.
  The payload format (v2) is parsed tolerantly: data.workouts[] {name, start, end, duration, distance{qty,units},
  activeEnergyBurned{qty,units}, heartRateData[], route[] {latitude, longitude, altitude, timestamp}}; data.metrics[].

Garmin (and others) through intervals.icu: athlete id + API key (Settings > Developer). The server checks every 30 minutes for
  activities in the last 14 days and imports the original FIT files (duplicates are skipped as usual).

Garmin Connect directly: a Personal API key (Garmin Connect > Settings > Personal API Key, your own data only). The key is
  swapped for a day-long access token; the same 30-minute check downloads each new activity's original FIT file.
"""
import base64
import datetime as dt
import io
import json
import secrets
import threading
import time
import urllib.error
import urllib.request
import zipfile

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from . import activities, auth, coach, db, parsers
from .auth import current_user

router = APIRouter(prefix='/api')
_h = auth.token_hash


@router.get('/connections')
def connections(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute('SELECT kind, status, last_sync, last_count, created, settings->>\'athlete_id\' AS athlete_id FROM connections WHERE user_id = %s',
                         (user['id'],)).fetchall()
    from . import garmin_connect
    return {r['kind']: r for r in rows} | {'garmin_available': _garmin_allowed(user), 'garmin_connect_available': garmin_connect.allowed(user)}


@router.post('/connections/apple')
def apple_connect(user=Depends(current_user)):
    """New secret token (shown once). Replaces any previous one."""
    token = 'bf_' + secrets.token_urlsafe(32)
    with db.connect() as c:
        c.execute("""INSERT INTO connections (user_id, kind, token_hash, status) VALUES (%s, 'apple', %s, 'waiting for first upload')
                     ON CONFLICT (user_id, kind) DO UPDATE SET token_hash = excluded.token_hash, status = excluded.status""", (user['id'], _h(token)))
    return {'token': token, 'url': '/api/ingest/apple'}


@router.delete('/connections/{kind}')
def disconnect(kind: str, user=Depends(current_user)):
    if kind == 'garmin_connect':      # tell Garmin to stop sending data too
        from . import garmin_connect
        garmin_connect.forget(user['id']); return {'ok': True}
    with db.connect() as c:
        c.execute('DELETE FROM connections WHERE user_id = %s AND kind = %s', (user['id'], kind))
    return {'ok': True}


# ---------- Apple Health Auto Export ----------
def _qty(v, want='m'):
    """{'qty': 3.1, 'units': 'mi'} or a number -> metres / kcal / seconds."""
    if v is None: return None
    if isinstance(v, (int, float)): return float(v)
    q, u = v.get('qty'), (v.get('units') or '').lower()
    if q is None: return None
    q = float(q)
    if want == 'm': return q * {'mi': 1609.344, 'km': 1000, 'm': 1, 'yd': 0.9144, 'ft': 0.3048}.get(u, 1)
    if want == 'kcal': return q / 4.184 if u == 'kj' else q
    return q


def _t(s):
    if not s: return None
    for fmt in ('%Y-%m-%d %H:%M:%S %z', '%Y-%m-%dT%H:%M:%S%z', '%Y-%m-%d %H:%M:%S'):
        try:
            t = dt.datetime.strptime(str(s).replace('Z', '+0000'), fmt)
            return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)
        except ValueError: continue
    try: return dt.datetime.fromisoformat(str(s))
    except ValueError: return None


def apple_workout(w):
    start, end = _t(w.get('start')), _t(w.get('end'))
    if not start: raise ValueError('workout without a start time')
    name = w.get('name') or 'Workout'
    sport = parsers.sport_of(name)
    rows = []
    for p in w.get('route') or []:
        t = _t(p.get('timestamp'))
        if t is None or p.get('latitude') is None: continue
        rows.append((t, {'lat': float(p['latitude']), 'lon': float(p['longitude']), 'alt': p.get('altitude'), 'speed': p.get('speed')}))
    hr = []
    for h in w.get('heartRateData') or []:
        t = _t(h.get('date'))
        v = h.get('Avg') or h.get('avg') or h.get('qty')
        if t and v: hr.append((t, float(v)))
    if hr and rows:      # nearest heart-rate sample within 30 s for each route point
        j = 0
        for t, v in rows:
            while j + 1 < len(hr) and abs((hr[j + 1][0] - t).total_seconds()) <= abs((hr[j][0] - t).total_seconds()): j += 1
            if abs((hr[j][0] - t).total_seconds()) <= 30: v['hr'] = hr[j][1]
    elif hr:             # indoor: heart rate only
        rows = [(t, {'hr': v}) for t, v in hr]
    hrv = [v for _, v in hr]
    session = {'elapsed_s': _qty(w.get('duration'), 's') or ((end - start).total_seconds() if end else None),
               'distance_m': _qty(w.get('distance')), 'calories': _qty(w.get('activeEnergyBurned') or w.get('activeEnergy'), 'kcal'),
               'ascent_m': _qty(w.get('elevationUp')), 'avg_hr': (w.get('heartRate') or {}).get('avg', {}).get('qty') if isinstance((w.get('heartRate') or {}).get('avg'), dict) else (sum(hrv) / len(hrv) if hrv else None)}
    out = parsers._finish(start, rows, sport, None, 'Apple Watch', session, [])
    if not out['streams']['t']:   # summary only
        out['streams'] = {k: [] for k in ('t',) + parsers.STREAMS}
    return out, {'name': None, 'sport_label': name, 'source_id': w.get('id'), 'distance_m': session['distance_m'],
                 'elapsed_s': session['elapsed_s'], 'start': start}


@router.post('/ingest/apple')
async def ingest_apple(request: Request):
    auth = request.headers.get('authorization', '')
    token = auth[7:].strip() if auth.lower().startswith('bearer ') else request.headers.get('x-fit-token', '')
    if not token: raise HTTPException(401, 'Missing token')
    with db.connect() as c:
        con = c.execute("SELECT user_id FROM connections WHERE kind = 'apple' AND token_hash = %s", (_h(token),)).fetchone()
    if not con: raise HTTPException(401, 'Unknown token')
    uid = con['user_id']
    # 2026-10-12 review: capped in size and count, and the work runs in a worker thread, so one big upload can't stall
    # everyone else's requests (this function is async: anything slow in it blocks the whole server)
    raw, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > APPLE_MAX: raise HTTPException(413, 'Too much at once - send fewer days per upload')
        raw.append(chunk)
    try: body = json.loads(b''.join(raw))
    except ValueError: raise HTTPException(400, 'Body must be JSON')
    data = body.get('data') if isinstance(body, dict) else None
    data = data if isinstance(data, dict) else {}
    if len(data.get('workouts') or []) > APPLE_WORKOUTS: raise HTTPException(413, f'Up to {APPLE_WORKOUTS} workouts per upload')
    return await run_in_threadpool(_ingest_apple, uid, data)


APPLE_MAX = 100 * 1024 ** 2         # one upload (routes with heart rate are about 1 MB a workout)
APPLE_WORKOUTS = 500


def _ingest_apple(uid, data):
    added, dup, failed, weights, new_ids = 0, 0, 0, 0, []
    for w in data.get('workouts') or []:
        try:
            parsed, meta = apple_workout(w)
            res, aid = activities.store(uid, parsed, meta, raw=json.dumps(w, sort_keys=True).encode(), ext='.apple.json', source='apple')
            if res == 'added': added += 1; new_ids.append(aid)
            else: dup += 1
        except Exception as e:
            failed += 1; print('apple workout failed', e, flush=True)
    # Health Auto Export is Health-derived too: use the same opt-in, UUID storage,
    # manual priority, deletion fences and AI-consent provenance as native reads.
    from . import api_health_weights as H
    from uuid import uuid5,NAMESPACE_URL
    import datetime as dt
    samples=[]
    for m in data.get('metrics') or []:
        if (m.get('name') or '').lower() not in ('weight_body_mass','body_mass','weight_&_body_mass','weight'):continue
        unit=(m.get('units') or 'kg').lower()
        if unit not in ('kg','lb','lbs'):continue
        for point in m.get('data') or []:
            try:
                stamp=_t(point.get('date'));kg=float(point['qty'])*(.45359237 if unit in ('lb','lbs') else 1)
                if not stamp or stamp.tzinfo is None or stamp>dt.datetime.now(dt.timezone.utc)+dt.timedelta(minutes=5) or not 20<=kg<=400:continue
                identity=uuid5(NAMESPACE_URL,f'kinetta:health-auto-export:{uid}:{stamp.isoformat()}:{kg:.6f}')
                samples.append(H.Sample(sample_id=identity,sampled_at=stamp,kg=kg,source_name='Health Auto Export',source_bundle='health-auto-export'))
            except (ValueError,TypeError,KeyError):continue
    with db.connect() as c:p=H.profile(c,uid)
    if p['health_weight_read']:
        unique={s.sample_id:s for s in samples}
        values=list(unique.values())
        for start in range(0,len(values),500):
            H.import_weights(H.Batch(epoch=p['health_weight_epoch'],tz=p['tz'] or db.DEFAULT_TZ,observed_at=dt.datetime.now(dt.timezone.utc),samples=values[start:start+500]),{'id':uid})
            weights+=len(values[start:start+500])
    with db.connect() as c:
        c.execute("""UPDATE connections SET status = %s, last_sync = now(), last_count = %s WHERE user_id = %s AND kind = 'apple'""",
                  (f'{added} added, {dup} already here' + (f', {failed} failed' if failed else '') + (f', {weights} weigh-ins' if weights else ''), added, uid))
    coach.after_import(uid, new_ids)
    return {'added': added, 'duplicates': dup, 'failed': failed, 'weights': weights}


# ---------- intervals.icu ----------
class IntervalsIn(BaseModel):
    athlete_id: str = Field(pattern=r'^i?\d{1,12}$')
    api_key: str = Field(min_length=10, max_length=200)


def _icu(path, key, raw=False):
    req = urllib.request.Request('https://intervals.icu' + path, headers={
        'Authorization': 'Basic ' + base64.b64encode(f'API_KEY:{key}'.encode()).decode(), 'User-Agent': 'Kinetta/1.0 (+https://kinetta.app)', 'Accept': '*/*'})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
        return data if raw else json.loads(data)


@router.post('/connections/intervals')
def intervals_connect(body: IntervalsIn, user=Depends(current_user)):
    aid = body.athlete_id if body.athlete_id.startswith('i') else 'i' + body.athlete_id
    try: _icu(f'/api/v1/athlete/{aid}', body.api_key)
    except urllib.error.HTTPError as e: raise HTTPException(400, f'intervals.icu said {e.code} - check the athlete id and API key')
    except Exception: raise HTTPException(502, "Couldn't reach intervals.icu")
    with db.connect() as c:
        c.execute("""INSERT INTO connections (user_id, kind, settings, status) VALUES (%s, 'intervals', %s, 'connected - first sync starting')
                     ON CONFLICT (user_id, kind) DO UPDATE SET settings = excluded.settings, status = excluded.status""",
                  (user['id'], json.dumps({'athlete_id': aid, 'api_key': body.api_key})))
    threading.Thread(target=sync_intervals, args=(user['id'],), daemon=True).start()
    return {'ok': True}


SYNC_EVERY = 120        # seconds between Sync now taps that start a sync (2026-10-12 review: taps piled up work)
_last_tap = {}


@router.post('/connections/intervals/sync')
def intervals_sync_now(user=Depends(current_user)):
    now = time.time()
    if now - _last_tap.get(user['id'], 0) < SYNC_EVERY or _user_lock(user['id']).locked():
        return {'ok': True, 'already': True}      # one is running or just ran: nothing new to fetch yet
    _last_tap[user['id']] = now
    threading.Thread(target=sync_intervals, args=(user['id'],), daemon=True).start()
    return {'ok': True}


_locks, _locks_guard = {}, threading.Lock()


def _user_lock(uid):
    """One sync per person at a time; different people's syncs run side by side (it was one lock for everyone)."""
    with _locks_guard: return _locks.setdefault(uid, threading.Lock())


def sync_intervals(uid, days=14):
    lock = _user_lock(uid)
    if not lock.acquire(blocking=False): return     # already syncing this person
    try:
        _sync_intervals(uid, days)
    finally:
        lock.release()


def _sync_intervals(uid, days):
    with db.connect() as c:
        con = c.execute("SELECT settings FROM connections WHERE user_id = %s AND kind = 'intervals'", (uid,)).fetchone()
    if not con: return
    s = con['settings']
    oldest = (dt.date.today() - dt.timedelta(days=days)).isoformat()
    added, dup, failed, new_ids = 0, 0, 0, []
    try:
        acts = _icu(f"/api/v1/athlete/{s['athlete_id']}/activities?oldest={oldest}&newest={dt.date.today().isoformat()}", s['api_key'])
    except Exception as e:
        with db.connect() as c:
            c.execute("UPDATE connections SET status = %s WHERE user_id = %s AND kind = 'intervals'", (f'sync failed: {e}', uid))
        return
    for a in acts or []:
        try:
            raw = None
            for path in (f"/api/v1/activity/{a['id']}/file", f"/api/v1/activity/{a['id']}/fit-file"):   # original upload first
                try: raw = _icu(path, s['api_key'], raw=True); break
                except urllib.error.HTTPError: continue
            if not raw: failed += 1; continue
            name = 'activity.fit.gz' if raw[:2] == b'\x1f\x8b' else 'activity.fit'
            parsed = parsers.read(name, raw)
            res, aid = activities.store(uid, parsed, {'source_id': str(a['id'])}, raw=raw, ext='.fit' + ('.gz' if name.endswith('.gz') else ''), source='garmin')
            if res == 'added': added += 1; new_ids.append(aid)
            else: dup += 1
        except Exception as e:
            failed += 1; print('intervals activity failed', a.get('id'), e, flush=True)
    with db.connect() as c:
        c.execute("UPDATE connections SET status = %s, last_sync = now(), last_count = %s WHERE user_id = %s AND kind = 'intervals'",
                  (f'{added} new, {dup} already here' + (f', {failed} failed' if failed else ''), added, uid))
    coach.after_import(uid, new_ids)


# ---------- Garmin Connect (Personal API key) ----------
GARMIN = 'https://personal.connectapi.garmin.com'
GARMIN_FIRST_DAYS = 30      # first sync looks back further; later syncs use the usual 14 days
GARMIN_SEEN = 400           # Garmin activity ids already handled, so each sync doesn't re-download two weeks of files
FIT_MAX = 50 * 1024 * 1024
_garmin_tokens = {}         # user id -> (key hash, access token, expiry epoch); tokens last about a day and can't be refreshed


class GarminIn(BaseModel):
    api_key: str = Field(min_length=10, max_length=1000)


def _garmin_allowed(user):
    """Personal API keys are for your own data; until Garmin approves business access, only the admin can connect (Ben, 2026-10-23)."""
    return bool(user.get('is_admin'))


def _garmin_gate(user):
    if not _garmin_allowed(user): raise HTTPException(403, 'Garmin Connect is not available on this account yet')


class GarminKeyError(Exception):
    """Garmin refused the key: it expired, was deleted, or was mistyped."""


def _garmin_req(path, headers, method='GET', data=None):
    req = urllib.request.Request(GARMIN + path, data=data, method=method,
                                 headers={'User-Agent': 'Kinetta/1.0 (+https://kinetta.app)', 'Accept': '*/*', **headers})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def _garmin_new_token(key):
    """Swap the personal key for an access token: Garmin answers with the bare token (a JWT) as plain text."""
    try:
        token = _garmin_req('/personalapitoken-service/personal-api/personal-api-key/token',
                            {'Authorization': 'ApiKey ' + key}, method='POST', data=b'').decode().strip()
    except urllib.error.HTTPError as e:
        if e.code in (400, 401, 403): raise GarminKeyError(e.code)
        raise
    if token.count('.') != 2: raise ValueError('Garmin sent no access token')
    try:     # only the expiry is read; Garmin checks the signature
        part = token.split('.')[1]
        expires = float(json.loads(base64.urlsafe_b64decode(part + '=' * (-len(part) % 4)))['exp'])
    except (ValueError, KeyError, TypeError): expires = time.time() + 3600
    return token, max(time.time() + 60, expires - 300)


def _garmin(uid, key, path, raw=False):
    """GET with a cached access token; one retry with a fresh token if Garmin says it has expired."""
    kh = _h(key)
    for attempt in (0, 1):
        cached = _garmin_tokens.get(uid)
        if attempt or not cached or cached[0] != kh or cached[2] < time.time():
            token, expires = _garmin_new_token(key)
            _garmin_tokens[uid] = cached = (kh, token, expires)
        try:
            data = _garmin_req(path, {'Authorization': 'Bearer ' + cached[1]})
            return data if raw else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code != 401 or attempt: raise
            _garmin_tokens.pop(uid, None)


def _fit_from_download(data):
    """Garmin's original-file download is a ZIP holding the FIT file."""
    if data[:2] != b'PK': return data
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for info in z.infolist():
            if info.filename.lower().endswith('.fit') and info.file_size <= FIT_MAX:
                return z.read(info)
    raise parsers.ParseError('no FIT file in the Garmin download')


@router.post('/connections/garmin')
def garmin_connect(body: GarminIn, user=Depends(current_user)):
    _garmin_gate(user)
    key = body.api_key.strip()
    try: _garmin_tokens[user['id']] = (_h(key), *_garmin_new_token(key))
    except GarminKeyError: raise HTTPException(400, "Garmin didn't accept that key. Check it, or create a new one in Garmin Connect")
    except Exception: raise HTTPException(502, "Couldn't reach Garmin")
    with db.connect() as c:
        c.execute("""INSERT INTO connections (user_id, kind, settings, status) VALUES (%s, 'garmin', %s, 'connected - first sync starting')
                     ON CONFLICT (user_id, kind) DO UPDATE SET settings = excluded.settings, status = excluded.status""",
                  (user['id'], json.dumps({'api_key': key, 'seen': []})))
    threading.Thread(target=sync_garmin, args=(user['id'], GARMIN_FIRST_DAYS), daemon=True).start()
    return {'ok': True}


@router.post('/connections/garmin/sync')
def garmin_sync_now(user=Depends(current_user)):
    _garmin_gate(user)
    now, tap = time.time(), (user['id'], 'garmin')
    if now - _last_tap.get(tap, 0) < SYNC_EVERY or _user_lock(user['id']).locked():
        return {'ok': True, 'already': True}
    _last_tap[tap] = now
    threading.Thread(target=sync_garmin, args=(user['id'],), daemon=True).start()
    return {'ok': True}


def sync_garmin(uid, days=14):
    lock = _user_lock(uid)
    if not lock.acquire(blocking=False): return
    try:
        _sync_garmin(uid, days)
    finally:
        lock.release()


def _garmin_status(uid, status):
    with db.connect() as c:
        c.execute("UPDATE connections SET status = %s WHERE user_id = %s AND kind = 'garmin'", (status, uid))


def _sync_garmin(uid, days):
    with db.connect() as c:
        con = c.execute("SELECT settings FROM connections WHERE user_id = %s AND kind = 'garmin'", (uid,)).fetchone()
    if not con: return
    s = con['settings']
    seen = list(s.get('seen') or [])
    today = dt.date.today()
    try:
        acts = _garmin(uid, s['api_key'], '/activitylist-service/activities/search/activities?limit=99'
                       f'&startDate={(today - dt.timedelta(days=days)).isoformat()}&endDate={today.isoformat()}')
    except GarminKeyError:
        _garmin_status(uid, 'Garmin no longer accepts this key (it may have expired). Create a new key in Garmin Connect and paste it here.'); return
    except Exception as e:
        _garmin_status(uid, f'sync failed: {e}'); return
    added, dup, failed, new_ids = 0, 0, 0, []
    for a in acts or []:
        gid = str(a.get('activityId') or '')
        if not gid or gid in seen: continue
        try:
            raw = _fit_from_download(_garmin(uid, s['api_key'], f'/download-service/files/activity/{gid}', raw=True))
            res, aid = activities.store(uid, parsers.read('activity.fit', raw), {'source_id': gid}, raw=raw, ext='.fit', source='garmin')
            if res == 'added': added += 1; new_ids.append(aid)
            else: dup += 1
            seen.append(gid)
        except parsers.ParseError as e:
            seen.append(gid); failed += 1; print('garmin activity unreadable', gid, e, flush=True)   # no point fetching it again
        except Exception as e:
            failed += 1; print('garmin activity failed', gid, e, flush=True)
    with db.connect() as c:
        c.execute("""UPDATE connections SET status = %s, last_sync = now(), last_count = %s,
                     settings = jsonb_set(settings, '{seen}', %s::jsonb) WHERE user_id = %s AND kind = 'garmin'""",
                  (f'{added} new, {dup} already here' + (f', {failed} failed' if failed else ''), added, json.dumps(seen[-GARMIN_SEEN:]), uid))
    coach.after_import(uid, new_ids)


def scheduler():
    """Every 30 minutes: sync everyone with an intervals.icu or Garmin connection."""
    while True:
        time.sleep(1800)
        try:
            with db.connect() as c:
                rows = c.execute("SELECT user_id, kind FROM connections WHERE kind IN ('intervals', 'garmin')").fetchall()
            for r in rows: (sync_intervals if r['kind'] == 'intervals' else sync_garmin)(r['user_id'])
        except Exception as e:
            print('scheduler', e, flush=True)
