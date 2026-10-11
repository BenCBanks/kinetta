"""Automatic connections.

Apple Watch: the iPhone app "Health Auto Export" (Premium: REST API automation) POSTs JSON to
    https://<your Lankki address>/api/ingest/apple     with header   Authorization: Bearer <token from Me > Connections>
  Workouts become activities (route + heart rate when present); body-mass metrics become weigh-ins.
  The payload format (v2) is parsed tolerantly: data.workouts[] {name, start, end, duration, distance{qty,units},
  activeEnergyBurned{qty,units}, heartRateData[], route[] {latitude, longitude, altitude, timestamp}}; data.metrics[].

Garmin (and others) through intervals.icu: athlete id + API key (Settings > Developer). The server checks every 30 minutes for
  activities in the last 14 days and imports the original FIT files (duplicates are skipped as usual).
"""
import base64
import datetime as dt
import hashlib
import json
import secrets
import threading
import time
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import activities, coach, db, parsers
from .auth import current_user

router = APIRouter(prefix='/api')
_h = lambda t: hashlib.sha256(t.encode()).hexdigest()


@router.get('/connections')
def connections(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute('SELECT kind, status, last_sync, last_count, created, settings->>\'athlete_id\' AS athlete_id FROM connections WHERE user_id = %s',
                         (user['id'],)).fetchall()
    return {r['kind']: r for r in rows}


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
    try: body = json.loads(await request.body())
    except ValueError: raise HTTPException(400, 'Body must be JSON')
    data = body.get('data') if isinstance(body, dict) else None
    data = data or {}
    added, dup, failed, weights, new_ids = 0, 0, 0, 0, []
    for w in data.get('workouts') or []:
        try:
            parsed, meta = apple_workout(w)
            res, aid = activities.store(uid, parsed, meta, raw=json.dumps(w, sort_keys=True).encode(), ext='.apple.json', source='apple')
            if res == 'added': added += 1; new_ids.append(aid)
            else: dup += 1
        except Exception as e:
            failed += 1; print('apple workout failed', e, flush=True)
    for m in data.get('metrics') or []:
        if (m.get('name') or '').lower() in ('weight_body_mass', 'body_mass', 'weight_&_body_mass', 'weight'):
            unit = (m.get('units') or 'kg').lower()
            for p in m.get('data') or []:
                t, q = _t(p.get('date')), p.get('qty')
                if not t or q is None: continue
                kg = float(q) * (0.45359237 if unit in ('lb', 'lbs') else 1)
                with db.connect() as c:
                    tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
                    from zoneinfo import ZoneInfo
                    c.execute("""INSERT INTO weights (user_id, day, kg) VALUES (%s, %s, %s) ON CONFLICT (user_id, day) DO UPDATE SET kg = excluded.kg""",
                              (uid, t.astimezone(ZoneInfo(tz)).date(), kg))
                weights += 1
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
        'Authorization': 'Basic ' + base64.b64encode(f'API_KEY:{key}'.encode()).decode(), 'User-Agent': 'Lankki/1.0 (+https://lankki.com)', 'Accept': '*/*'})
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


@router.post('/connections/intervals/sync')
def intervals_sync_now(user=Depends(current_user)):
    threading.Thread(target=sync_intervals, args=(user['id'],), daemon=True).start()
    return {'ok': True}


_sync_lock = threading.Lock()


def sync_intervals(uid, days=14):
    with _sync_lock:
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


def scheduler():
    """Every 30 minutes: sync everyone with an intervals.icu connection."""
    while True:
        time.sleep(1800)
        try:
            with db.connect() as c:
                ids = [r['user_id'] for r in c.execute("SELECT user_id FROM connections WHERE kind = 'intervals'").fetchall()]
            for uid in ids: sync_intervals(uid)
        except Exception as e:
            print('scheduler', e, flush=True)
