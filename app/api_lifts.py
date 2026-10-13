"""Lifting (2026-10-13): what you did in a strength session - exercises, sets, reps and weight - and what you did last
time, so the next session starts from it. A session is an ordinary activity (sport 'workout', source 'lift' when it was
started here); its sets are lift_sets rows. Weights are stored in kg; the phone shows lb or kg.
Every query is limited to the logged-in person (user['id'])."""
import datetime as dt
import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import activities, db, parsers
from .auth import current_user

router = APIRouter(prefix='/api')

# The common lifts, offered before someone has their own list. kind: weight = reps x weight, body = reps (weight added
# optional), time = held for seconds. Added to the person's own list the first time they use one.
COMMON = [
    ('Bench press', 'weight', 'Chest'), ('Incline bench press', 'weight', 'Chest'), ('Dumbbell bench press', 'weight', 'Chest'),
    ('Incline dumbbell press', 'weight', 'Chest'), ('Chest fly', 'weight', 'Chest'), ('Push-up', 'body', 'Chest'), ('Dip', 'body', 'Chest'),
    ('Squat', 'weight', 'Legs'), ('Front squat', 'weight', 'Legs'), ('Goblet squat', 'weight', 'Legs'), ('Leg press', 'weight', 'Legs'),
    ('Lunge', 'weight', 'Legs'), ('Bulgarian split squat', 'weight', 'Legs'), ('Leg extension', 'weight', 'Legs'),
    ('Leg curl', 'weight', 'Legs'), ('Calf raise', 'weight', 'Legs'), ('Hip thrust', 'weight', 'Legs'),
    ('Deadlift', 'weight', 'Back'), ('Romanian deadlift', 'weight', 'Back'), ('Trap bar deadlift', 'weight', 'Back'),
    ('Barbell row', 'weight', 'Back'), ('Dumbbell row', 'weight', 'Back'), ('Seated cable row', 'weight', 'Back'),
    ('Lat pulldown', 'weight', 'Back'), ('Pull-up', 'body', 'Back'), ('Chin-up', 'body', 'Back'), ('Back extension', 'body', 'Back'),
    ('Overhead press', 'weight', 'Shoulders'), ('Dumbbell shoulder press', 'weight', 'Shoulders'), ('Lateral raise', 'weight', 'Shoulders'),
    ('Rear delt fly', 'weight', 'Shoulders'), ('Face pull', 'weight', 'Shoulders'), ('Shrug', 'weight', 'Shoulders'),
    ('Biceps curl', 'weight', 'Arms'), ('Hammer curl', 'weight', 'Arms'), ('Triceps pushdown', 'weight', 'Arms'),
    ('Skull crusher', 'weight', 'Arms'), ('Overhead triceps extension', 'weight', 'Arms'),
    ('Plank', 'time', 'Core'), ('Side plank', 'time', 'Core'), ('Crunch', 'body', 'Core'), ('Hanging leg raise', 'body', 'Core'),
    ('Russian twist', 'body', 'Core'), ('Ab wheel', 'body', 'Core'), ('Cable crunch', 'weight', 'Core'),
    ('Kettlebell swing', 'weight', 'Full body'), ('Clean', 'weight', 'Full body'), ('Thruster', 'weight', 'Full body'),
    ('Farmer carry', 'weight', 'Full body'), ('Burpee', 'body', 'Full body'), ('Box jump', 'body', 'Full body'),
]
COMMON_BY_NAME = {n.lower(): (n, k, m) for n, k, m in COMMON}
OPEN_FOR = dt.timedelta(hours=4)      # a session still "open" after this long was left running: its time stops growing


def e1rm(kg, reps):
    """Estimated one-rep max (Epley). Only believable from 1-12 reps; None otherwise."""
    if not kg or not reps or reps > 12: return None
    return kg if reps == 1 else kg * (1 + reps / 30)


def _counts(s):
    """A set that counts in history and records: ticked off and not a warm-up."""
    return s['done'] and not s['warmup']


# ---------- your exercises ----------
def _mine(c, uid):
    return c.execute("""
        SELECT e.id, e.name::text AS name, e.kind, e.muscle, e.note,
          count(DISTINCT s.activity_id) FILTER (WHERE s.done) AS sessions,
          max(a.start_time) FILTER (WHERE s.done) AS last,
          max(s.kg) FILTER (WHERE s.done AND NOT s.warmup AND s.reps > 0) AS best_kg,
          max(CASE WHEN s.done AND NOT s.warmup AND s.reps BETWEEN 1 AND 12 AND s.kg > 0
                   THEN CASE WHEN s.reps = 1 THEN s.kg ELSE s.kg * (1 + s.reps / 30.0) END END) AS best_e1rm,
          max(s.reps) FILTER (WHERE s.done AND NOT s.warmup) AS best_reps,
          max(s.secs) FILTER (WHERE s.done AND NOT s.warmup) AS best_secs
        FROM exercises e LEFT JOIN lift_sets s ON s.exercise_id = e.id LEFT JOIN activities a ON a.id = s.activity_id
        WHERE e.user_id = %s GROUP BY e.id ORDER BY max(a.start_time) DESC NULLS LAST, e.name""", (uid,)).fetchall()


@router.get('/lifts/exercises')
def exercises(user=Depends(current_user)):
    with db.connect() as c:
        mine = _mine(c, user['id'])
    have = {m['name'].lower() for m in mine}
    return {'mine': mine, 'common': [{'name': n, 'kind': k, 'muscle': m} for n, k, m in COMMON if n.lower() not in have]}


class ExerciseIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str | None = Field(None, pattern='^(weight|body|time)$')
    muscle: str | None = Field(None, max_length=40)


def _get_or_make(c, uid, name, kind=None, muscle=None):
    name = ' '.join(name.split())
    if not name: raise HTTPException(400, 'Give the exercise a name')
    hit = c.execute('SELECT id, name::text AS name, kind, muscle, note FROM exercises WHERE user_id = %s AND name = %s', (uid, name)).fetchone()
    if hit: return hit
    known = COMMON_BY_NAME.get(name.lower())
    if known: name, kind, muscle = known[0], kind or known[1], muscle or known[2]
    return c.execute("""INSERT INTO exercises (user_id, name, kind, muscle) VALUES (%s, %s, %s, %s)
                        RETURNING id, name::text AS name, kind, muscle, note""", (uid, name, kind or 'weight', muscle)).fetchone()


@router.post('/lifts/exercises')
def add_exercise(body: ExerciseIn, user=Depends(current_user)):
    """Your exercise by this name (made the first time; a common one keeps its usual kind and muscle group)."""
    with db.connect() as c:
        return _get_or_make(c, user['id'], body.name, body.kind, body.muscle)


class ExerciseEdit(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80)
    kind: str | None = Field(None, pattern='^(weight|body|time)$')
    muscle: str | None = Field(None, max_length=40)
    note: str | None = Field(None, max_length=500)


@router.patch('/lifts/exercises/{eid}')
def edit_exercise(eid: int, body: ExerciseEdit, user=Depends(current_user)):
    v = body.model_dump(exclude_unset=True)
    if 'name' in v: v['name'] = ' '.join(v['name'].split())
    if 'note' in v: v['note'] = (v['note'] or '').strip() or None
    with db.connect() as c:
        if v.get('name') and c.execute('SELECT 1 FROM exercises WHERE user_id = %s AND name = %s AND id <> %s', (user['id'], v['name'], eid)).fetchone():
            raise HTTPException(409, 'You already have an exercise with that name')
        if v and not c.execute(f"UPDATE exercises SET {', '.join(f'{k} = %s' for k in v)} WHERE id = %s AND user_id = %s RETURNING id",
                               (*v.values(), eid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


@router.delete('/lifts/exercises/{eid}')
def delete_exercise(eid: int, user=Depends(current_user)):
    """The exercise and every set of it (the sessions themselves stay)."""
    with db.connect() as c:
        if not c.execute('DELETE FROM exercises WHERE id = %s AND user_id = %s RETURNING id', (eid, user['id'])).fetchone():
            raise HTTPException(404, 'Not found')
    return {'ok': True}


# ---------- one exercise over time ----------
def _summary(sets):
    """Per session: the top set, the best estimated 1RM, total reps, volume (kg x reps) and the longest hold."""
    real = [s for s in sets if _counts(s)]
    top = max(real, key=lambda s: ((s['kg'] or 0), (s['reps'] or 0)), default=None)
    ests = [e1rm(s['kg'], s['reps']) for s in real]
    return {'top': {'kg': top['kg'], 'reps': top['reps']} if top else None,
            'e1rm': max((x for x in ests if x), default=None),
            'reps': sum(s['reps'] or 0 for s in real),
            'volume': sum((s['kg'] or 0) * (s['reps'] or 0) for s in real),
            'secs': max((s['secs'] or 0 for s in real), default=0) or None}


def _sessions(c, uid, eid, before=None, limit=200):
    """Sessions with this exercise, newest first, each with its sets (planned sets left out)."""
    rows = c.execute("""
        SELECT a.id AS activity_id, a.start_time, a.tz, a.name,
          jsonb_agg(jsonb_build_object('n', s.n, 'reps', s.reps, 'kg', s.kg, 'secs', s.secs, 'warmup', s.warmup, 'done', s.done) ORDER BY s.n) AS sets
        FROM lift_sets s JOIN activities a ON a.id = s.activity_id
        WHERE s.user_id = %s AND s.exercise_id = %s AND s.done AND (%s::timestamptz IS NULL OR a.start_time < %s)
        GROUP BY a.id ORDER BY a.start_time DESC LIMIT %s""", (uid, eid, before, before, limit)).fetchall()
    for r in rows: r.update(_summary(r['sets']))
    return rows


def _records(sessions):
    """Your bests for an exercise, each with the session it came from."""
    out = {}
    def better(key, val, s, extra=None):
        if val and (key not in out or val > out[key]['value']):
            out[key] = {'value': val, 'activity_id': s['activity_id'], 'start_time': s['start_time'], **(extra or {})}
    for s in sessions:
        for x in s['sets']:
            if not _counts(x): continue
            if x['kg'] and x['reps']: better('heaviest', x['kg'], s, {'reps': x['reps']})
            better('e1rm', e1rm(x['kg'], x['reps']), s, {'kg': x['kg'], 'reps': x['reps']})
            better('reps', x['reps'], s, {'kg': x['kg']})
            better('secs', x['secs'], s)
        better('volume', s['volume'], s)
    return out


@router.get('/lifts/exercises/{eid}')
def exercise_history(eid: int, user=Depends(current_user)):
    with db.connect() as c:
        ex = next((m for m in _mine(c, user['id']) if m['id'] == eid), None)
        if not ex: raise HTTPException(404, 'Not found')
        sessions = _sessions(c, user['id'], eid)
    return {'exercise': ex, 'sessions': sessions, 'records': _records(sessions)}


# ---------- a session's sets ----------
def _lifts(c, uid, a):
    """The session's exercises in order, each with its sets, what you did last time (the latest earlier session) and your
    bests before this session, with the sets that beat them marked as records."""
    rows = c.execute("""SELECT s.exercise_id, e.name::text AS name, e.kind, e.muscle, e.note, s.pos, s.n, s.reps, s.kg, s.secs, s.warmup, s.done
                        FROM lift_sets s JOIN exercises e ON e.id = s.exercise_id
                        WHERE s.activity_id = %s AND s.user_id = %s ORDER BY s.pos, s.n""", (a['id'], uid)).fetchall()
    out = []
    for r in rows:
        if not out or out[-1]['pos'] != r['pos']:
            out.append({k: r[k] for k in ('exercise_id', 'name', 'kind', 'muscle', 'note', 'pos')} | {'sets': []})
        out[-1]['sets'].append({k: r[k] for k in ('reps', 'kg', 'secs', 'warmup', 'done')})
    for ex in out:
        past = _sessions(c, uid, ex['exercise_id'], before=a['start_time'])
        ex['last'] = ({k: past[0][k] for k in ('activity_id', 'start_time', 'tz', 'sets', 'top', 'e1rm', 'volume')} if past else None)
        ex['sessions_before'] = len(past)
        _mark_records(ex, _records(past) if past else None)
    return out


def _mark_records(ex, before):
    """pr on the one set per kind that beat your best from before this session ('heaviest', 'e1rm', 'reps', 'secs').
    The first time you do an exercise nothing is a record yet - there's nothing to beat."""
    if not before: return
    best = {}
    for i, s in enumerate(ex['sets']):
        if not _counts(s): continue
        vals = {'heaviest': s['kg'] if s['reps'] else None, 'e1rm': e1rm(s['kg'], s['reps']),
                'reps': s['reps'] if ex['kind'] == 'body' else None, 'secs': s['secs'] if ex['kind'] == 'time' else None}
        for k, v in vals.items():
            old = before.get(k, {}).get('value') or 0
            if v and v > old + 1e-6 and (k not in best or v > best[k][1]): best[k] = (i, v)
    for k, (i, _) in best.items():
        if k == 'e1rm' and 'heaviest' in best: continue    # a heavier weight says it already
        ex['sets'][i].setdefault('pr', []).append(k)


def _session(c, uid, aid):
    a = c.execute('SELECT id, start_time, tz, name, sport, source, lift_open, elapsed_s FROM activities WHERE id = %s AND user_id = %s', (aid, uid)).fetchone()
    if not a: raise HTTPException(404, 'Not found')
    return a


@router.get('/activities/{aid}/lifts')
def session_lifts(aid: int, user=Depends(current_user)):
    with db.connect() as c:
        a = _session(c, user['id'], aid)
        return {'open': a['lift_open'], 'start_time': a['start_time'], 'exercises': _lifts(c, user['id'], a)}


class SetIn(BaseModel):
    reps: int | None = Field(None, ge=0, le=1000)
    kg: float | None = Field(None, ge=0, le=1000)
    secs: int | None = Field(None, ge=0, le=86400)
    warmup: bool = False
    done: bool = True


class ExSetsIn(BaseModel):
    exercise_id: int
    sets: list[SetIn] = Field(max_length=50)


class LiftsIn(BaseModel):
    exercises: list[ExSetsIn] = Field(max_length=40)
    finish: bool = False


@router.put('/activities/{aid}/lifts')
def save_lifts(aid: int, body: LiftsIn, user=Depends(current_user)):
    """The whole session at once (the phone sends it after each change, so a resend is harmless). While a session is
    open its time runs on: elapsed = now - start, up to 4 hours. finish closes it."""
    uid = user['id']
    with db.connect() as c:
        a = _session(c, uid, aid)
        ids = {e.exercise_id for e in body.exercises}
        if ids:
            own = {r['id'] for r in c.execute('SELECT id FROM exercises WHERE user_id = %s AND id = ANY(%s)', (uid, list(ids))).fetchall()}
            if own != ids: raise HTTPException(404, 'Exercise not found')
        c.execute('DELETE FROM lift_sets WHERE activity_id = %s AND user_id = %s', (aid, uid))
        rows = [(uid, aid, e.exercise_id, pos, n, s.reps, s.kg, s.secs, s.warmup, s.done)
                for pos, e in enumerate(body.exercises) for n, s in enumerate(e.sets, start=1)]
        if rows:
            with c.cursor() as cur:
                cur.executemany("""INSERT INTO lift_sets (user_id, activity_id, exercise_id, pos, n, reps, kg, secs, warmup, done)
                                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""", rows)
        if a['lift_open']:
            now = dt.datetime.now(dt.timezone.utc)
            secs = max(a['elapsed_s'] or 0, min((now - a['start_time']).total_seconds(), OPEN_FOR.total_seconds()))
            c.execute('UPDATE activities SET elapsed_s = %s, moving_s = %s, lift_open = %s, updated = now() WHERE id = %s AND user_id = %s',
                      (secs, secs, not body.finish and now - a['start_time'] < OPEN_FOR, aid, uid))
            a = _session(c, uid, aid)
        else:
            c.execute('UPDATE activities SET updated = now() WHERE id = %s AND user_id = %s', (aid, uid))
        return {'open': a['lift_open'], 'start_time': a['start_time'], 'exercises': _lifts(c, uid, a)}


# ---------- starting a session ----------
class StartIn(BaseModel):
    copy_from: int | None = None          # a past session: its exercises and number of sets come along, blank (not done yet)


@router.post('/lifts/start')
def start(body: StartIn, user=Depends(current_user)):
    """A new strength session starting now (or the one already open, so a second tap doesn't make two)."""
    uid = user['id']
    with db.connect() as c:
        hit = c.execute("""SELECT id FROM activities WHERE user_id = %s AND lift_open AND start_time > now() - %s
                           ORDER BY start_time DESC LIMIT 1""", (uid, OPEN_FOR)).fetchone()
        if hit: return {'id': hit['id'], 'resumed': True}
        plan = []
        if body.copy_from:
            src = _session(c, uid, body.copy_from)
            plan = c.execute("""SELECT exercise_id, pos, n, reps, kg, secs, warmup FROM lift_sets
                                WHERE activity_id = %s AND user_id = %s AND done ORDER BY pos, n""", (src['id'], uid)).fetchall()
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    meta = {'sport': 'workout', 'sport_label': 'Strength Training', 'start': now, 'elapsed_s': 60, 'moving_s': 60}
    parsed = {'sport': 'workout', 'sub_sport': None, 'start': now, 'device': None, 'laps': [],
              'session': {'elapsed_s': 60, 'moving_s': 60, 'distance_m': None}, 'streams': {k: [] for k in ('t',) + parsers.STREAMS}}
    res, aid = activities.store(uid, parsed, meta, source='lift')
    if res != 'added': return {'id': aid, 'resumed': True}     # a workout already started this minute: log onto that one
    with db.connect() as c:
        c.execute("UPDATE activities SET lift_open = true, name = %s WHERE id = %s AND user_id = %s", (_name(c, uid, now), aid, uid))
        if plan:
            with c.cursor() as cur:
                cur.executemany("""INSERT INTO lift_sets (user_id, activity_id, exercise_id, pos, n, reps, kg, secs, warmup, done)
                                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, false)""",
                                [(uid, aid, p['exercise_id'], p['pos'], p['n'], None, None, None, p['warmup']) for p in plan])   # blank: the phone shows that day's numbers in grey
    return {'id': aid, 'resumed': False}


def _name(c, uid, t):
    tz = (c.execute('SELECT tz FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}).get('tz') or db.DEFAULT_TZ
    return activities.default_name(t, tz, 'workout').replace('Workout', 'Lift')


@router.post('/activities/{aid}/lifts/reopen')
def reopen(aid: int, user=Depends(current_user)):
    """Back into a session finished by mistake, within its 4 hours."""
    with db.connect() as c:
        if not c.execute("""UPDATE activities SET lift_open = true WHERE id = %s AND user_id = %s AND source = 'lift'
                            AND start_time > now() - %s RETURNING id""", (aid, user['id'], OPEN_FOR)).fetchone():
            raise HTTPException(409, 'This session is too old to carry on')
    return {'ok': True}


# ---------- recent sessions ----------
@router.get('/lifts/sessions')
def sessions(limit: int = 20, user=Depends(current_user)):
    """Recent sessions with sets in them, newest first: the exercises in order and how much was done (to repeat one)."""
    limit = max(1, min(limit, 100))
    with db.connect() as c:
        return c.execute("""
            SELECT a.id, a.name, a.start_time, a.tz, a.moving_s, a.lift_open,
              (SELECT jsonb_agg(x.name ORDER BY x.pos) FROM (SELECT DISTINCT ON (s.pos) s.pos, e.name::text AS name FROM lift_sets s
                 JOIN exercises e ON e.id = s.exercise_id WHERE s.activity_id = a.id ORDER BY s.pos) x) AS exercises,
              (SELECT count(*) FROM lift_sets s WHERE s.activity_id = a.id AND s.done AND NOT s.warmup) AS sets,
              (SELECT coalesce(sum(s.kg * s.reps), 0) FROM lift_sets s WHERE s.activity_id = a.id AND s.done AND NOT s.warmup) AS volume
            FROM activities a WHERE a.user_id = %s AND (a.lift_open OR EXISTS (SELECT 1 FROM lift_sets s WHERE s.activity_id = a.id))
            ORDER BY a.start_time DESC LIMIT %s""", (user['id'], limit)).fetchall()


# for the activity list and feed cards: a short summary of a session's lifting (None for sessions without sets)
FEED_SQL = """(SELECT CASE WHEN count(*) > 0 THEN jsonb_build_object(
                 'sets', count(*) FILTER (WHERE s.done AND NOT s.warmup),
                 'volume', coalesce(sum(s.kg * s.reps) FILTER (WHERE s.done AND NOT s.warmup), 0),
                 'exercises', count(DISTINCT s.exercise_id),
                 'names', (SELECT jsonb_agg(x.name ORDER BY x.pos) FROM (SELECT DISTINCT ON (s2.pos) s2.pos, e.name::text AS name
                            FROM lift_sets s2 JOIN exercises e ON e.id = s2.exercise_id WHERE s2.activity_id = a.id ORDER BY s2.pos) x)) END
               FROM lift_sets s WHERE s.activity_id = a.id) AS lifts"""


def coach_text(c, uid, aid):
    """The session's lifting in a few lines for the AI coach, e.g. 'Squat: 3 x 5 @ 100 kg (last time 3 x 5 @ 97.5 kg)'."""
    a = c.execute('SELECT id, start_time FROM activities WHERE id = %s AND user_id = %s', (aid, uid)).fetchone()
    if not a: return ''
    def sets_txt(sets):
        real = [s for s in sets if _counts(s)]
        return ', '.join(f"{s['reps'] or 0}" + (f" @ {s['kg']:g} kg" if s['kg'] else '') if not s['secs'] else f"{s['secs']} s" for s in real)
    lines = []
    for ex in _lifts(c, uid, a):
        now = sets_txt(ex['sets'])
        if not now: continue
        last = sets_txt(ex['last']['sets']) if ex['last'] else ''
        lines.append(f"{ex['name']}: {now}" + (f" (last time: {last})" if last else ' (first time)'))
    return '\n'.join(lines)


def merge_watch(c, uid, start, end, numbers):
    """A strength workout from a watch (Apple Health, a file, intervals.icu) that overlaps a session logged here: the
    watch's numbers go onto the logged session instead of making a second activity. Returns its id, or None."""
    hit = c.execute("""SELECT id, start_time FROM activities WHERE user_id = %s AND source = 'lift'
                       AND start_time < %s AND start_time + make_interval(secs => coalesce(elapsed_s, 0)) > %s
                       ORDER BY lift_open DESC, abs(extract(epoch FROM start_time - %s)) LIMIT 1""",
                    (uid, end + dt.timedelta(minutes=15), start - dt.timedelta(minutes=15), start)).fetchone()   # the one being logged, else the nearest
    if not hit: return None
    keep = {k: v for k, v in numbers.items() if v is not None}
    first = min(start, hit['start_time'])
    keep['elapsed_s'] = max(numbers.get('elapsed_s') or 0, (end - first).total_seconds())
    c.execute(f"""UPDATE activities SET {', '.join(f'{k} = %s' for k in keep)}, start_time = %s, lift_open = false, updated = now()
                  WHERE id = %s AND user_id = %s""", (*keep.values(), first, hit['id'], uid))
    return hit['id']
