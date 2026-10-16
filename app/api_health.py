"""Apple Health workouts sent by the Kinetta iPhone app (mobile/, app/static/native.js).

POST /api/health/workouts   {"workouts": [...]}   from the logged-in person only (the app's login token, auth.session_token)

Each workout carries HealthKit's own id for it. It is stored as source 'healthkit' with that id, and sending it again
(the next sync overlaps the last one, a retry after a dropped connection, a second iPhone) fills missing details without
creating another activity. Health identity is retained on compatible imports from other sources too. Unique indexes
catch simultaneous copies. A workout that is
already here from somewhere else (a Garmin file, a Strava export) is a duplicate too: same start time and distance,
see activities.find_duplicate.

The AI coach reads these workouts only after the person says yes (profile.health_ai_ok, see coach.health_ok), so new ones
don't get an automatic coach note here.
"""
import datetime as dt
import json
import math
import re

from fastapi import APIRouter, Depends, HTTPException
from psycopg import errors
from pydantic import BaseModel, Field, model_validator

from . import activities, analysis, db, parsers
from .auth import current_user

router = APIRouter(prefix='/api')
SLACK = dt.timedelta(minutes=1)


class Point(BaseModel):
    t: dt.datetime
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    alt: float | None = Field(None, ge=-500, le=9000)


class Beat(BaseModel):
    t: dt.datetime
    bpm: float = Field(gt=20, lt=260)


class WorkoutIn(BaseModel):
    id: str = Field(pattern=r'^[A-Za-z0-9-]{8,64}$')       # HealthKit's id (a UUID)
    type: str = Field(max_length=60)                       # HealthKit activity type: running, cycling, yoga, ...
    start: dt.datetime
    end: dt.datetime
    duration_s: float = Field(gt=0, le=86400 * 2)
    distance_m: float | None = Field(None, ge=0, le=1_000_000)
    calories: float | None = Field(None, ge=0, le=20000)
    steps: float | None = Field(None, ge=0, le=500_000)
    ascent_m: float | None = Field(None, ge=0, le=30000)
    descent_m: float | None = Field(None, ge=0, le=30000)
    avg_power: float | None = Field(None, ge=0, le=3000)
    max_power: float | None = Field(None, ge=0, le=5000)
    avg_cad: float | None = Field(None, ge=0, le=300)
    max_speed: float | None = Field(None, ge=0, le=100)
    avg_stride: float | None = Field(None, ge=0, le=5000)  # millimetres, like the FIT importer
    avg_vo: float | None = Field(None, ge=0, le=500)
    avg_gct: float | None = Field(None, ge=0, le=3000)
    source: str | None = Field(None, max_length=100)      # the app or watch that recorded it, e.g. "Apple Watch"
    route: list[Point] = Field(default_factory=list, max_length=100_000)
    heart_rate: list[Beat] = Field(default_factory=list, max_length=100_000)


class WorkoutsIn(BaseModel):
    workouts: list[WorkoutIn] = Field(max_length=50)       # the app sends big histories in batches

    @model_validator(mode='after')
    def not_too_big(self):     # the app sends 10 workouts at a time; this keeps one request from tying up the server
        if sum(len(w.route) + len(w.heart_rate) for w in self.workouts) > 300_000: raise ValueError('Too many points in one request - send fewer workouts at a time')
        return self


def _utc(t):
    return t if t.tzinfo else t.replace(tzinfo=dt.timezone.utc)


def label(kind):
    """HealthKit's 'traditionalStrengthTraining' -> 'Traditional Strength Training' (shown like Strava's sport names)."""
    return re.sub(r'(?<=[a-z])(?=[A-Z])', ' ', kind).strip().title() or 'Workout'


def to_activity(w):
    """One workout -> (parsed, meta) for activities.store: the route with heart rate joined on (nearest beat within
    30 s, like the Health Auto Export import), or heart rate alone for indoor workouts."""
    start, end = _utc(w.start), _utc(w.end)
    sport = parsers.sport_of(label(w.type))
    inside = lambda t: start - SLACK <= t <= end + SLACK     # only samples from this workout's own time
    hr = sorted((t, b.bpm) for b in w.heart_rate if inside(t := _utc(b.t)))
    rows = sorted(((t, {'lat': p.lat, 'lon': p.lng, 'alt': p.alt}) for p in w.route if inside(t := _utc(p.t))), key=lambda r: r[0])
    if rows and hr:
        j = 0
        for t, v in rows:
            while j + 1 < len(hr) and abs((hr[j + 1][0] - t).total_seconds()) <= abs((hr[j][0] - t).total_seconds()): j += 1
            if abs((hr[j][0] - t).total_seconds()) <= 30: v['hr'] = hr[j][1]
    elif hr:
        rows = [(t, {'hr': v}) for t, v in hr]
        # beats may not cover the whole workout (a strap that dropped out): keep its real start and end, or the
        # elapsed time would shrink to the stretch with heart rate
        if rows[0][0] > start: rows.insert(0, (start, {}))
        if rows[-1][0] < end: rows.append((end, {}))
    bpm = [v for _, v in hr]
    # HealthKit's duration leaves out pauses: it is the moving time when there's no recording to measure it from
    session = {'elapsed_s': (end - start).total_seconds(), 'moving_s': w.duration_s, 'distance_m': w.distance_m or None, 'calories': w.calories or None,
               'avg_hr': sum(bpm) / len(bpm) if bpm else None, 'max_hr': max(bpm) if bpm else None}
    parsed = parsers._finish(start, rows, sport, None, w.source or 'Apple Health', session, [])
    if not parsed['streams']['t']:   # summary only
        parsed['streams'] = {k: [] for k in ('t',) + parsers.STREAMS}
    meta = {'sport_label': label(w.type), 'source_id': w.id, 'start': start, 'elapsed_s': (end - start).total_seconds(), 'moving_s': w.duration_s,
            'distance_m': w.distance_m or None, 'calories': w.calories or None}
    for k in EXTRA:
        meta[k] = getattr(w, k)
        session[k] = getattr(w, k)
    return parsed, meta


EXTRA = ('steps', 'ascent_m', 'descent_m', 'avg_power', 'max_power', 'avg_cad', 'max_speed', 'avg_stride', 'avg_vo', 'avg_gct')


def _known(uid, wid):
    with db.connect() as c:
        r = c.execute("SELECT id FROM activities WHERE user_id = %s AND (healthkit_id = %s OR (source IN ('healthkit', 'lift') AND source_id = %s))", (uid, wid, wid)).fetchone()
    return r['id'] if r else None



def _same_measurement(a, b):
    # Activity summaries use PostgreSQL real (float32); JSON provenance keeps the original Python precision.
    # Ignore only storage rounding, so a replay still recognizes its own imported value without losing edits.
    if a is None or b is None: return a is b
    return math.isclose(a, b, rel_tol=1e-6, abs_tol=1e-6)


def enrich(uid, aid, w, parsed, meta):
    """Fill missing details on this user's compatible activity, preserving edits and fuller imports."""
    with db.connect() as c:
        a = c.execute('SELECT * FROM activities WHERE id = %s AND user_id = %s FOR UPDATE', (aid, uid)).fetchone()
        from . import activity_corrections as corrections
        raw_a=a
        if a:a=corrections.original(a)
        if not a or a['sport'] != parsed['sport'] or abs((a['start_time'] - _utc(w.start)).total_seconds()) > 120: return False
        if a.get('healthkit_id') and a['healthkit_id'] != w.id: return False
        elapsed = (a.get('elapsed_s') or 0)
        if elapsed and abs(elapsed - meta['elapsed_s']) > max(120, elapsed * .1): return False
        if a.get('distance_m') and w.distance_m and min(a['distance_m'], w.distance_m) / max(a['distance_m'], w.distance_m) < .93: return False
        old = c.execute('SELECT * FROM activity_streams WHERE activity_id = %s AND user_id = %s', (aid, uid)).fetchone() or {}
        old = {k: old.get(k) or [] for k in ('t',) + parsers.STREAMS}
        incoming = dict(parsed['streams'])
        offset = (_utc(w.start) - a['start_time']).total_seconds()
        incoming['t'] = [t + offset for t in incoming['t']]
        st = activities.merge_streams(old, incoming)
        changed = st != old
        previous = (a.get('health_details') or {}).get('imported', {})
        S = analysis.prepare(st, a['sport'])
        summ = analysis.summary(S, a['sport'], parsed.get('session') or {}, activities.profile_of(c, uid))
        # The stream analysis can leave aggregate-only Health statistics empty.
        for k in EXTRA + ('calories', 'distance_m', 'elapsed_s', 'moving_s'):
            if summ.get(k) is None or (k in EXTRA and meta.get(k) is not None): summ[k] = meta.get(k)
        imported = dict(previous)
        updates = {}
        for k in ('avg_hr', 'max_hr') + EXTRA + ('calories', 'distance_m', 'elapsed_s', 'moving_s'):
            value = activities.num(summ.get(k))
            if value is None: continue
            current = a.get(k)
            if a['source'] == 'healthkit' and _same_measurement(current, value): imported.setdefault(k, value)
            # Preserve user corrections, and never replace another import's nonempty summary.
            if current is None or (a['source'] == 'healthkit' and k in previous and _same_measurement(current, previous[k])) or (
                a['source'] == 'healthkit' and k in ('ascent_m', 'descent_m') and current == 0 and not previous and not any(v is not None for v in old['alt'])):
                if not _same_measurement(current, value): updates[k] = value
                imported[k] = value
        # A replay can correct the old sparse-HR average even when its recording did not change.
        # Keep the matching derived HR summary in step without rebuilding unrelated GPS/route records.
        if not changed and 'avg_hr' in updates:
            updates['zones'] = json.dumps(summ.get('zones'))
            updates['effort'] = activities.num(summ.get('effort'))
        if changed and st['t']:
            cols = ('t',) + parsers.STREAMS
            arrays = [activities._floats(st[k]) for k in cols]
            c.execute('INSERT INTO activity_streams (activity_id, user_id, ' + ','.join(cols) + ') VALUES (' + ','.join(['%s'] * (len(cols) + 2)) + ') ON CONFLICT (activity_id) DO UPDATE SET ' + ','.join(k + '=EXCLUDED.' + k for k in cols), (aid, uid, *arrays))
            for k in ('effort', 'gap_s_per_km', 'decoupling', 'vo2max', 'norm_power', 'vam', 'min_alt', 'max_alt'):
                if summ.get(k) is not None: updates[k] = activities.num(summ[k])
            updates.update(zones=json.dumps(summ.get('zones')), chart=json.dumps(analysis.chart_series(S, a['sport'])),
                splits_km=json.dumps(analysis.splits(S, a['sport'], 1000)), splits_mi=json.dumps(analysis.splits(S, a['sport'], activities.MI)),
                power_curve=json.dumps(analysis.power_curve(S)))
            c.execute('DELETE FROM best_efforts WHERE activity_id = %s AND user_id = %s', (aid, uid))
            for e in analysis.best_efforts(S, a['sport']):
                c.execute('INSERT INTO best_efforts (user_id, activity_id, sport, distance_m, label, elapsed_s, start_s, start_time) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
                    (uid, aid, a['sport'], e['distance_m'], e['label'], e['elapsed_s'], e['start_s'], a['start_time']))
            activities.set_geometry(c, aid, st)
            activities.match_route(c, uid, aid)
        details = {'imported': imported, 'route_points': sum(v is not None for v in st['lat']), 'heart_rate_points': sum(v is not None for v in st['hr'])}
        corrections.capture(c,raw_a,updates)
        updated = bool(updates or changed)
        updates.update(healthkit_id=w.id, health_details=json.dumps(details))
        c.execute('UPDATE activities SET ' + ','.join(k + '=%(' + k + ')s' for k in updates) + (', updated=now()' if updated else '') + ' WHERE id=%(id)s AND user_id=%(uid)s', {**updates, 'id': aid, 'uid': uid})
        if raw_a.get('summary_overrides'):corrections.apply(c,uid,aid)
        return updated


def save(uid, w):
    """Keep legacy acknowledgements so already installed iPhones remain compatible."""
    aid = _known(uid, w.id)
    parsed, meta = to_activity(w)
    if aid: return 'duplicate', aid, enrich(uid, aid, w, parsed, meta)
    try:
        res, aid = activities.store(uid, parsed, meta, source='healthkit')
    except errors.UniqueViolation:     # the same workout, sent at the same moment by another request
        aid = _known(uid, w.id)
        if not aid: raise
        return 'duplicate', aid, enrich(uid, aid, w, parsed, meta)
    if res == 'added' and not w.route:   # indoors, heart rate can't tell moving from resting: HealthKit's own time it is
        with db.connect() as c:
            c.execute('UPDATE activities SET moving_s = %s WHERE id = %s AND user_id = %s', (w.duration_s, aid, uid))
    updated = enrich(uid, aid, w, parsed, meta)
    return ('added' if res == 'added' else 'duplicate'), aid, updated and res != 'added'


@router.post('/health/workouts')
def upload_workouts(body: WorkoutsIn, user=Depends(current_user)):
    soon = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
    out = []
    for w in body.workouts:
        if _utc(w.start) > soon or _utc(w.end) < _utc(w.start):
            out.append({'id': w.id, 'result': 'failed', 'error': 'start or end time is wrong'}); continue
        try:
            res, aid, updated = save(user['id'], w)
            out.append({'id': w.id, 'result': res, 'activity_id': aid, 'details_updated': updated})
        except Exception as e:     # one bad workout never stops the rest
            print('healthkit workout failed', e, flush=True)
            out.append({'id': w.id, 'result': 'failed', 'error': 'could not read this workout'})
    count = lambda k: sum(1 for o in out if o['result'] == k)
    return {'added': count('added'), 'duplicates': count('duplicate'), 'updated': sum(bool(o.get('details_updated')) for o in out), 'failed': count('failed'), 'results': out}
