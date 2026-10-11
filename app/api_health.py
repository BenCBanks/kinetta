"""Apple Health workouts sent by the Lankki iPhone app (mobile/, app/static/native.js).

POST /api/health/workouts   {"workouts": [...]}   from the logged-in person only (the app's login token, auth.session_token)

Each workout carries HealthKit's own id for it. It is stored as source 'healthkit' with that id, and sending it again
(the next sync overlaps the last one, a retry after a dropped connection, a second iPhone) changes nothing: the id is
looked up first, and a unique index (migration 19) catches two copies that arrive at the same moment. A workout that is
already here from somewhere else (a Garmin file, a Strava export) is a duplicate too: same start time and distance,
see activities.find_duplicate.

The AI coach reads these workouts only after the person says yes (profile.health_ai_ok, see coach.health_ok), so new ones
don't get an automatic coach note here.
"""
import datetime as dt
import re

from fastapi import APIRouter, Depends, HTTPException
from psycopg import errors
from pydantic import BaseModel, Field

from . import activities, db, parsers
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
    source: str | None = Field(None, max_length=100)      # the app or watch that recorded it, e.g. "Apple Watch"
    route: list[Point] = Field(default_factory=list, max_length=100_000)
    heart_rate: list[Beat] = Field(default_factory=list, max_length=100_000)


class WorkoutsIn(BaseModel):
    workouts: list[WorkoutIn] = Field(max_length=50)       # the app sends big histories in batches


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
    return parsed, meta


def _known(uid, wid):
    with db.connect() as c:
        r = c.execute("SELECT id FROM activities WHERE user_id = %s AND source = 'healthkit' AND source_id = %s", (uid, wid)).fetchone()
    return r['id'] if r else None


def save(uid, w):
    """('added' | 'duplicate', activity id)"""
    aid = _known(uid, w.id)
    if aid: return 'duplicate', aid
    parsed, meta = to_activity(w)
    try:
        res, aid = activities.store(uid, parsed, meta, source='healthkit')
    except errors.UniqueViolation:     # the same workout, sent at the same moment by another request
        return 'duplicate', _known(uid, w.id)
    if res == 'added' and not w.route:   # indoors, heart rate can't tell moving from resting: HealthKit's own time it is
        with db.connect() as c:
            c.execute('UPDATE activities SET moving_s = %s WHERE id = %s AND user_id = %s', (w.duration_s, aid, uid))
    return ('added' if res == 'added' else 'duplicate'), aid


@router.post('/health/workouts')
def upload_workouts(body: WorkoutsIn, user=Depends(current_user)):
    soon = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
    out = []
    for w in body.workouts:
        if _utc(w.start) > soon or _utc(w.end) < _utc(w.start):
            out.append({'id': w.id, 'result': 'failed', 'error': 'start or end time is wrong'}); continue
        try:
            res, aid = save(user['id'], w)
            out.append({'id': w.id, 'result': res, 'activity_id': aid})
        except Exception as e:     # one bad workout never stops the rest
            print('healthkit workout failed', e, flush=True)
            out.append({'id': w.id, 'result': 'failed', 'error': 'could not read this workout'})
    count = lambda k: sum(1 for o in out if o['result'] == k)
    return {'added': count('added'), 'duplicates': count('duplicate'), 'failed': count('failed'), 'results': out}
