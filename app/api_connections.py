"""Automatic connections.

Apple Watch: the iPhone app "Health Auto Export" (Premium: REST API automation) POSTs JSON to
    https://<your Kinetta address>/api/ingest/apple     with header   Authorization: Bearer <token from Me > Connections>
  Workouts become activities (route + heart rate when present); body-mass metrics become weigh-ins.
  The payload format (v2) is parsed tolerantly: data.workouts[] {name, start, end, duration, distance{qty,units},
  activeEnergyBurned{qty,units}, heartRateData[], route[] {latitude, longitude, altitude, timestamp}}; data.metrics[].

Garmin Connect: garmin_connect.py (Garmin's developer program). intervals.icu and the Garmin Personal API key were removed
  on 2026-10-23 (Ben); old 'intervals'/'garmin' kinds stay allowed in the database only because shipped migrations can't change.
"""
import datetime as dt
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from . import activities, auth, coach, db, parsers
from .auth import current_user

router = APIRouter(prefix='/api')
_h = auth.token_hash


@router.get('/connections')
def connections(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute('SELECT kind, status, last_sync, last_count, created FROM connections WHERE user_id = %s',
                         (user['id'],)).fetchall()
    from . import garmin_connect
    return {r['kind']: r for r in rows} | {'garmin_connect_available': garmin_connect.allowed(user)}


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
