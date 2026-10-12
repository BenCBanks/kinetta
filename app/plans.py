"""Training plans (2026-10-10): 5K, 10K, half marathon and marathon; first-timer (5K run/walk), beginner, intermediate
and advanced; 6-20 weeks; 3-6 runs a week; long run on Saturday or Sunday.

Our own generator, following the structure most published plans share (Higdon-style beginner plans: easy miles, one
long run, no hard sessions; Hansons/Pfitzinger-style intermediate and advanced plans: tempo + interval days, goal-pace
long runs, a mid-week long run for advanced marathoners; couch-to-5K style run/walk for first-timers):
  - phases: base -> build -> peak -> taper -> race; weekly volume and long run grow steadily, every 4th week is a
    lighter "cutback" week; taper 1 week (5K/10K), 2 (half), 3 (marathon).
  - paces come from current running fitness (Daniels VDOT, same as Progress > Fitness) and update as you get fitter;
    a goal time sets the race-pace sessions. Without any fast runs yet, workouts are described by effort only.
Only the plan settings are stored (training_plans); the weeks are rebuilt from them, so the schedule never drifts.
Completion (2026-10-12, revised the same day): a run that day (any source) at least the planned distance (a 2%
allowance for GPS); a run-walk (timed, no distance) counts with any run. Runs on other days never tick off a workout.
Ticks by hand (plan_marks) work on any workout day, past or future, and win over the runs: done, or "not done"."""
import datetime as dt
import math
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import analysis, db
from .auth import current_user

router = APIRouter(prefix='/api/plans')
MI = 1609.344

RACES = {
    '5k':       {'name': '5K', 'm': 5000, 'weeks': [6, 8, 10, 12], 'default': 8, 'taper': 1},
    '10k':      {'name': '10K', 'm': 10000, 'weeks': [8, 10, 12], 'default': 10, 'taper': 1},
    'half':     {'name': 'Half marathon', 'm': 21097.5, 'weeks': [10, 12, 14, 16], 'default': 12, 'taper': 2},
    'marathon': {'name': 'Marathon', 'm': 42195, 'weeks': [12, 16, 18, 20], 'default': 18, 'taper': 3},
}
# miles per week (start -> peak), long run miles (start -> peak), hard sessions per week, runs per week (min, max, default)
LEVELS = {
    '5k': {
        'first':        {'runs': (3, 3, 3), 'quality': 0, 'desc': 'New to running: run/walk 3 times a week, building to 30 minutes of running (9 weeks).'},
        'beginner':     {'vol': (8, 15), 'long': (3, 5), 'quality': 0, 'runs': (3, 4, 3), 'desc': 'Easy runs plus short strides; finish strong.'},
        'intermediate': {'vol': (15, 25), 'long': (5, 7), 'quality': 1, 'runs': (4, 5, 4), 'desc': 'One speed session a week (intervals or tempo).'},
        'advanced':     {'vol': (25, 40), 'long': (7, 10), 'quality': 2, 'runs': (5, 6, 5), 'desc': 'Intervals and tempo every week, higher mileage.'},
    },
    '10k': {
        'beginner':     {'vol': (10, 18), 'long': (3, 7), 'quality': 0, 'runs': (3, 4, 3), 'desc': 'Easy runs, strides and a little fartlek.'},
        'intermediate': {'vol': (18, 30), 'long': (5, 9), 'quality': 1, 'runs': (4, 5, 4), 'desc': 'One speed session a week.'},
        'advanced':     {'vol': (28, 45), 'long': (8, 12), 'quality': 2, 'runs': (5, 6, 5), 'desc': 'Intervals and tempo every week.'},
    },
    'half': {
        'beginner':     {'vol': (12, 25), 'long': (4, 10), 'quality': 0, 'runs': (3, 4, 3), 'desc': 'Just finish: easy miles and a weekly long run up to 10 mi.'},
        'intermediate': {'vol': (20, 35), 'long': (6, 12), 'quality': 1, 'runs': (4, 5, 4), 'desc': 'A tempo or interval day, goal-pace miles in long runs.'},
        'advanced':     {'vol': (30, 50), 'long': (8, 14), 'quality': 2, 'runs': (5, 6, 5), 'desc': 'Two hard days a week, long runs up to 14 mi.'},
    },
    'marathon': {
        'beginner':     {'vol': (15, 40), 'long': (6, 20), 'quality': 0, 'runs': (3, 5, 4), 'desc': 'First marathon: easy miles, long run up to 20 mi.'},
        'intermediate': {'vol': (25, 50), 'long': (8, 20), 'quality': 1, 'runs': (4, 6, 5), 'desc': 'A tempo day plus marathon-pace miles in long runs.'},
        'advanced':     {'vol': (35, 65), 'long': (10, 22), 'quality': 2, 'runs': (5, 6, 6), 'desc': 'Two hard days, a mid-week long run, long runs to 22 mi.'},
    },
}
RACE_PACE = {'5k': '5k', '10k': '10k', 'half': 'hmp', 'marathon': 'mp'}
LEVEL_NAMES = {'first': 'First-timer', 'beginner': 'Beginner', 'intermediate': 'Intermediate', 'advanced': 'Advanced'}
# run days (0 = Monday) for each count, long run on Saturday (5) or Sunday (6)
DAYS = {5: {3: [1, 3, 5], 4: [1, 2, 3, 5], 5: [1, 2, 3, 5, 6], 6: [0, 1, 2, 3, 5, 6]},
        6: {3: [1, 3, 6], 4: [1, 2, 3, 6], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6]}}
# couch-to-5K style: (run minutes, walk minutes, repeats) for the three sessions of each week
RUNWALK = [(1, 1.5, 8), (1.5, 2, 6), (2, 2, 5), (3, 1.5, 5), (5, 2, 3), (8, 2, 2), (12, 2, 2), (20, 0, 1), (25, 0, 1)]
EFFORT = {
    'easy': 'conversational - you can talk in full sentences',
    'recovery': 'very easy, slower than your easy pace',
    'long': 'easy and steady',
    'tempo': 'comfortably hard - a few words at a time (the pace you could hold for about an hour)',
    'intervals': 'hard but controlled, about your 5K race effort',
    'race': 'race day',
}


# ---------- paces (Daniels) ----------
def _speed_at(vo2):
    """m/min at a given oxygen cost (inverse of Daniels' VO2 = -4.60 + 0.182258 v + 0.000104 v^2)."""
    a, b, c = 0.000104, 0.182258, -4.60 - vo2
    return (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)


def paces(vdot, goal_s=None, race_m=None):
    """Seconds per km for each kind of run, or None without a fitness estimate."""
    out = {}
    if vdot:
        spk = lambda f: 60000 / _speed_at(vdot * f)
        mp = analysis.race_time(vdot, 42195) / 42.195     # easy paces hang off marathon pace (+1 to +2 min/mi, like Daniels' E)
        out = {'easy': (mp * 1.12, mp * 1.25), 'long': (mp * 1.12, mp * 1.25), 'recovery': (mp * 1.27, mp * 1.36),
               'tempo': spk(.88), 'intervals': spk(.975), 'mp': mp,
               'hmp': analysis.race_time(vdot, 21097.5) / 21.0975, '10k': analysis.race_time(vdot, 10000) / 10,
               '5k': analysis.race_time(vdot, 5000) / 5}
    if goal_s and race_m:
        out['goal'] = goal_s / (race_m / 1000)
    return out


def fmt_pace(spk, unit):
    if spk is None: return None
    s = spk * (MI / 1000 if unit == 'mi' else 1)
    m, x = divmod(round(s), 60)
    return f'{m}:{x:02d}/{unit}'


def _pace_txt(P, key, unit):
    v = P.get(key)
    if v is None: return ''
    if isinstance(v, tuple):   # a range, fast-slow: "(8:40-9:50/mi)"
        return f" ({fmt_pace(v[0], unit).split('/')[0]}-{fmt_pace(v[1], unit)})"
    return f' ({fmt_pace(v, unit)})'


# ---------- the generator ----------
def _r(x, step=0.5): return max(step, round(x / step) * step)


def build(p, P):
    """Weeks of workouts for plan settings p (race, level, weeks, runs, long_day, start_day, race_day, unit,
    start_vol, goal_s); P = paces. Distances in the plan's unit (mi or km)."""
    race, lvl, W, unit = p['race'], p['level'], p['weeks'], p['unit']
    R, L = RACES[race], LEVELS[race][lvl]
    k = 1.0 if unit == 'mi' else MI / 1000          # level tables are in miles
    start = dt.date.fromisoformat(str(p['start_day']))
    race_day = dt.date.fromisoformat(str(p['race_day']))
    pt = lambda key: _pace_txt(P, key, unit)
    U = unit
    weeks = []
    if lvl == 'first':
        for i in range(W):
            run, walk, reps = RUNWALK[min(i, len(RUNWALK) - 1)]
            ws = []
            for dow in DAYS[p['long_day']][3]:
                day = start + dt.timedelta(days=i * 7 + dow)
                if day > race_day: continue
                if day == race_day:
                    ws.append({'day': day, 'type': 'race', 'title': f"Race: {R['name']}", 'dist': _r(R['m'] / 1000 / (MI / 1000 if U == 'mi' else 1), 0.1),
                               'detail': 'Start slower than you want to. Walk breaks are allowed - finishing is the goal.'})
                    continue
                if walk:
                    mins = round(reps * (run + walk) + 10)
                    detail = f'5 min brisk walk, then {reps} x (run {run:g} min, walk {walk:g} min), 5 min walk. About {mins} min. Run at an easy, chatty pace.'
                    title = f'Run/walk {reps} x {run:g} min'
                else:
                    mins = run + 10
                    detail = f'5 min brisk walk, run {run} minutes without stopping (slow is fine), 5 min walk.'
                    title = f'Run {run} min'
                ws.append({'day': day, 'type': 'runwalk', 'title': title, 'dist': None, 'minutes': mins, 'detail': detail})
            if i == W - 1 and not any(w['type'] == 'race' for w in ws) and start <= race_day:
                ws.append({'day': race_day, 'type': 'race', 'title': f"Race: {R['name']}", 'dist': _r(R['m'] / 1000 / (MI / 1000 if U == 'mi' else 1), 0.1),
                           'detail': 'Start slower than you want to. Walk breaks are allowed - finishing is the goal.'})
            weeks.append({'n': i + 1, 'phase': 'Run/walk' if i < 7 else 'Running', 'start': start + dt.timedelta(days=i * 7),
                          'workouts': sorted(ws, key=lambda w: w['day'])})
        return weeks

    taper, n_runs = R['taper'], p['runs']
    peak_i = W - taper - 1                                     # last full-training week
    v0, v1 = L['vol'][0] * k, L['vol'][1] * k
    l0, l1 = L['long'][0] * k, L['long'][1] * k
    v0 = max(v0, min(p.get('start_vol') or 0, v1 * 0.8))      # start nearer what you already run
    l0 = max(l0, min(v0 * 0.3, l1 * 0.7)) if p.get('start_vol') else l0
    race_dist = R['m'] / 1000 / (MI / 1000 if U == 'mi' else 1)
    tf = {1: [0.6], 2: [0.7, 0.5], 3: [0.75, 0.6, 0.4]}[taper]
    min_easy = 2 * k if U == 'mi' else 3
    for i in range(W):
        wk_start = start + dt.timedelta(days=i * 7)
        frac = i / peak_i if peak_i > 0 else 1
        base = i <= peak_i and frac < 0.34
        if i <= peak_i:
            phase = 'Base' if base else 'Peak' if i > peak_i - 3 else 'Build'
            vol = v0 + (v1 - v0) * min(1, frac)
            lng = l0 + (l1 - l0) * min(1, frac)
            cut = (i + 1) % 4 == 0 and i < peak_i
            if cut: vol *= 0.8; lng *= 0.75; phase = 'Cutback'
        else:
            t = i - peak_i - 1
            phase = 'Race week' if i == W - 1 else 'Taper'
            vol = v1 * tf[t]; lng = l1 * ([0.65, 0.5, 0][t] if taper == 3 else [0.7, 0][t] if taper == 2 else 0)
            cut = False
        lng = _r(lng)
        days = list(DAYS[p['long_day']][n_runs])
        ws = []
        race_week = i == W - 1
        if race_week:   # race replaces the long run; no running the day before
            rd = (race_day - wk_start).days
            days = [d for d in days if d not in (rd, rd - 1) and d != p['long_day'] and d < rd] + [rd]
        q = L['quality']
        quality_days = []
        if not race_week and (not base or q == 2):
            if q >= 1 and 1 in days: quality_days.append(1)
            if q >= 2 and 3 in days: quality_days.append(3)
        mlr_day = 2 if race == 'marathon' and lvl == 'advanced' and 2 in days and not race_week and i < W - taper else None
        budget = vol
        plan = {}
        for d in days:
            if race_week and d == days[-1]:
                plan[d] = {'type': 'race', 'title': f"Race: {R['name']}", 'dist': _r(race_dist, 0.1),
                           'detail': f"Start a little slower than {'goal' if P.get('goal') else 'your predicted'} pace{pt('goal' if P.get('goal') else RACE_PACE[race])}, settle in, and finish strong."}
                continue
            if d == p['long_day'] and not race_week:
                lt, ld = 'long', f"Long run - {EFFORT['long']}{pt('long')}." + (' Walk breaks are fine.' if lvl == 'beginner' else '')
                gp = P.get('goal') and 'goal' or ('mp' if race == 'marathon' else 'hmp' if race == 'half' else None)
                if lvl != 'beginner' and race in ('marathon', 'half') and phase in ('Build', 'Peak') and i % 2 == 1 and gp:
                    fin = _r(lng * (0.4 if lvl == 'advanced' else 0.3))
                    ld = f"Long run with the last {fin:g} {U} at goal {'marathon' if race == 'marathon' else 'half-marathon'} pace{pt(gp)}; the rest easy{pt('long')}."
                    lt = 'long_pace'
                plan[d] = {'type': lt, 'title': f'Long run {lng:g} {U}', 'dist': lng, 'detail': ld}
                budget -= lng
        for d in quality_days:
            if d in plan: continue
            sess = _quality(race, lvl, 'Base' if base else phase, i, frac, d, U, pt, vol)
            plan[d] = sess; budget -= sess['dist']
        if mlr_day is not None and mlr_day not in plan:
            m = _r(min(lng * (0.75 if phase != 'Base' else 0.6), 15 * k))
            plan[mlr_day] = {'type': 'medium_long', 'title': f'Medium-long run {m:g} {U}', 'dist': m,
                             'detail': f"Steady and aerobic{pt('easy')} - a bit longer than an everyday run."}
            budget -= m
        rest = [d for d in days if d not in plan]
        if rest:
            after_long = [d for d in rest if d == (p['long_day'] + 1) % 7]
            weights = {d: 0.7 if d in after_long else 1.0 for d in rest}
            tot = sum(weights.values())
            for d in rest:
                dist = max(min_easy, _r(budget * weights[d] / tot)) if budget > 0 else min_easy
                if race_week: dist = max(min_easy, _r(v1 * 0.07))
                rec = d in after_long
                strides = (not rec and not race_week and lvl != 'advanced' and d == max(rest) and i >= 1) or (race_week and d == max(rest))
                fart = lvl == 'beginner' and race in ('5k', '10k') and phase in ('Build', 'Peak') and d == min(rest) and not race_week
                if fart:
                    plan[d] = {'type': 'fartlek', 'title': f'Fartlek {dist:g} {U}', 'dist': dist,
                               'detail': f"Easy run{pt('easy')} with 6-8 x 1 min a little faster (not sprinting), easy jog between."}
                else:
                    plan[d] = {'type': 'recovery' if rec else 'easy', 'title': f"{'Recovery' if rec else 'Easy'} run {dist:g} {U}", 'dist': dist,
                               'detail': f"{EFFORT['recovery' if rec else 'easy'].capitalize()}{pt('recovery' if rec else 'easy')}."
                               + (' Finish with 4-6 x 20 s strides: quick, relaxed, full recovery.' if strides else '')}
        ws = [{'day': wk_start + dt.timedelta(days=d), **plan[d]} for d in sorted(plan)]
        ws = [w for w in ws if w['day'] <= race_day]
        weeks.append({'n': i + 1, 'phase': phase, 'start': wk_start, 'workouts': ws})
    return weeks


def _quality(race, lvl, phase, i, frac, dow, U, pt, vol):
    """A tempo or interval session for week i. Interval reps by race distance; tempo length grows with volume."""
    wu = 1 if U == 'mi' else 2
    tempo_day = dow == 3 or (lvl == 'intermediate' and i % 2 == 0)
    if race in ('half', 'marathon') and lvl == 'intermediate': tempo_day = i % 3 != 1   # mostly tempo for longer races
    if phase == 'Base' and dow == 1:
        reps = 6 + int(frac * 6)
        d = _r(wu * 2 + 1.5)
        return {'type': 'hills', 'title': f'Hill repeats {d:g} {U}', 'dist': d,
                'detail': f"{wu} {U} easy, then {reps} x 45-60 s uphill at a strong effort, jog down to recover, {wu} {U} easy."}
    if tempo_day:
        t = max(2 if U == 'mi' else 3, min(7 if U == 'mi' else 11, round(vol * 0.12)))
        if phase in ('Base', 'Taper'): t = max(2 if U == 'mi' else 3, t - 1)
        d = _r(t + 2 * wu)
        return {'type': 'tempo', 'title': f'Tempo run {d:g} {U}', 'dist': d,
                'detail': f"{wu} {U} easy, {t:g} {U} at tempo{pt('tempo')} - {EFFORT['tempo']}, {wu} {U} easy."}
    reps_tab = {'5k': [(400, 8, 12), (800, 4, 6), (1000, 4, 6)], '10k': [(800, 5, 8), (1000, 5, 6), (1609, 3, 5)],
                'half': [(1000, 5, 6), (1609, 3, 5)], 'marathon': [(1000, 6, 8), (1609, 3, 6)]}[race]
    rep_m, lo, hi = reps_tab[i % len(reps_tab)]
    n = lo if phase == 'Taper' else lo + round((hi - lo) * min(1, frac))
    label = '1 mile' if rep_m == 1609 else f'{rep_m} m'
    work = n * rep_m * 1.5 / (MI if U == 'mi' else 1000)       # reps + half-distance jogs
    d = _r(work + 2 * wu)
    key = '5k' if race == '5k' else '10k' if race == '10k' else 'intervals'
    return {'type': 'intervals', 'title': f'Intervals {n} x {label}', 'dist': d,
            'detail': f"{wu} {U} easy, then {n} x {label}{pt(key)} - {EFFORT['intervals']} - with a {'200' if rep_m <= 400 else '400'} m easy jog between, {wu} {U} easy."}


# ---------- helpers on stored data ----------
def _ctx(c, uid):
    p = c.execute('SELECT tz, units FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}
    tz = p.get('tz') or db.DEFAULT_TZ
    return tz, ('km' if p.get('units') == 'metric' else 'mi'), dt.datetime.now(ZoneInfo(tz)).date()


def current_vdot(c, uid):
    """Same rule as Progress > Fitness: best effort of a mile or more in the last 90 days, as Daniels VDOT."""
    rows = c.execute("""SELECT distance_m, elapsed_s FROM best_efforts WHERE user_id = %s AND sport = 'run' AND distance_m >= 1609
                        AND elapsed_s > 0 AND start_time > now() - interval '90 days'""", (uid,)).fetchall()
    vs = [analysis.vdot(r['distance_m'], r['elapsed_s']) for r in rows]
    vs = [v for v in vs if 25 <= v <= 85]
    return round(max(vs), 1) if vs else None


def run_predictions(c, uid, targets):
    """Race predictions from the best efforts (a mile or longer) of the last 90 days and the last 8 weeks' running
    (analysis.predictions). Shared by Progress > Fitness and the plan."""
    effs = c.execute("""SELECT label, distance_m, elapsed_s, start_time, activity_id FROM best_efforts WHERE user_id = %s
                        AND sport = 'run' AND distance_m >= 1609 AND elapsed_s > 0 AND start_time > now() - interval '90 days'""", (uid,)).fetchall()
    effs = [e for e in effs if 25 <= analysis.vdot(e['distance_m'], e['elapsed_s']) <= 85]      # drop GPS glitches
    km = c.execute("""SELECT coalesce(sum(distance_m), 0) / 8000.0 AS km FROM activities WHERE user_id = %s AND sport = 'run'
                      AND start_time > now() - interval '56 days'""", (uid,)).fetchone()['km']
    return analysis.predictions(effs, float(km), targets)


def recent_weekly(c, uid, unit):
    r = c.execute("""SELECT coalesce(sum(distance_m), 0) AS m FROM activities WHERE user_id = %s AND sport = 'run'
                     AND start_time > now() - interval '28 days'""", (uid,)).fetchone()
    return round(r['m'] / 4 / (MI if unit == 'mi' else 1000), 1)


def _monday(d): return d - dt.timedelta(days=d.weekday())


class PlanIn(BaseModel):
    race: str = Field(pattern='^(5k|10k|half|marathon)$')
    level: str = Field(pattern='^(first|beginner|intermediate|advanced)$')
    weeks: int = Field(ge=4, le=24)
    runs: int = Field(3, ge=3, le=6)
    long_day: int = Field(5, ge=5, le=6)
    race_day: dt.date | None = None
    goal_s: float | None = Field(None, gt=600, lt=8 * 3600)


def _settings(c, uid, b: PlanIn):
    if b.level not in LEVELS[b.race]: raise HTTPException(400, f'{LEVEL_NAMES[b.level]} is only offered for the 5K')
    tz, unit, today = _ctx(c, uid)
    L = LEVELS[b.race][b.level]
    weeks = 9 if b.level == 'first' else b.weeks
    runs = min(max(b.runs, L['runs'][0]), L['runs'][1])
    if b.race_day:
        if b.race_day <= today: raise HTTPException(400, 'Pick a race date in the future')
        start = _monday(b.race_day) - dt.timedelta(weeks=weeks - 1)
        if start + dt.timedelta(days=6) < today:    # race sooner than the plan length: shorten (from this week)
            weeks = (_monday(b.race_day) - _monday(today)).days // 7 + 1
            start = _monday(today)
            need = 6 if b.race in ('5k', '10k') else 8 if b.race == 'half' else 10
            if weeks < need or b.level == 'first':
                raise HTTPException(400, f"Your race is only {weeks} week{'s' if weeks != 1 else ''} away - a {RACES[b.race]['name']} plan needs at least {9 if b.level == 'first' else need}. Pick a later race date.")
        race_day = b.race_day
    else:
        start = _monday(today) + (dt.timedelta(weeks=1) if today.weekday() >= 3 else dt.timedelta(0))   # Thu-Sun: start next Monday
        race_day = start + dt.timedelta(weeks=weeks - 1, days=b.long_day)
    return {'race': b.race, 'level': b.level, 'weeks': weeks, 'runs': runs, 'long_day': b.long_day, 'unit': unit,
            'start_day': start, 'race_day': race_day, 'goal_s': b.goal_s, 'start_vol': recent_weekly(c, uid, unit)}


def _summary(p, weeks):
    tots = [sum(w['dist'] or 0 for w in wk['workouts']) for wk in weeks]
    longest = max((w['dist'] or 0 for wk in weeks for w in wk['workouts'] if w['type'] in ('long', 'long_pace')), default=0)
    hard = max((sum(w['type'] in ('tempo', 'intervals', 'hills') for w in wk['workouts']) for wk in weeks), default=0)
    return {'weeks': len(weeks), 'runs': p['runs'], 'peak_week': round(max(tots), 1) if tots else 0, 'first_week': round(tots[0], 1) if tots else 0,
            'longest': longest, 'hard_per_week': hard, 'unit': p['unit']}


def _out_week(wk, unit):
    return {**wk, 'start': wk['start'].isoformat(),
            'workouts': [{**w, 'day': w['day'].isoformat()} for w in wk['workouts']],
            'planned': round(sum(w['dist'] or 0 for w in wk['workouts']), 1)}


@router.get('/options')
def options(user=Depends(current_user)):
    with db.connect() as c:
        tz, unit, today = _ctx(c, user['id'])
        v = current_vdot(c, user['id']); wk = recent_weekly(c, user['id'], unit)
        pred = {x['label']: x['seconds'] for x in run_predictions(c, user['id'], [(R['m'], key) for key, R in RACES.items()])}
    k = 1.0 if unit == 'mi' else MI / 1000
    races = []
    for key, R in RACES.items():
        lv = []
        for lk, L in LEVELS[key].items():
            item = {'key': lk, 'name': LEVEL_NAMES[lk], 'desc': L['desc'], 'runs': L['runs'], 'quality': L['quality']}
            if 'vol' in L: item |= {'peak_week': round(L['vol'][1] * k), 'longest': round(L['long'][1] * k)}
            lv.append(item)
        races.append({'key': key, 'name': R['name'], 'weeks': R['weeks'], 'default_weeks': R['default'], 'levels': lv,
                      'predicted_s': pred.get(key)})
    suggest = 'first' if wk < 3 else 'beginner' if wk < 15 * k else 'intermediate' if wk < 30 * k else 'advanced'
    return {'races': races, 'unit': unit, 'vdot': v, 'recent_weekly': wk, 'suggest_level': suggest, 'today': today.isoformat()}


@router.post('/preview')
def preview(b: PlanIn, user=Depends(current_user)):
    with db.connect() as c:
        p = _settings(c, user['id'], b); v = current_vdot(c, user['id'])
    weeks = build(p, paces(v, p['goal_s'], RACES[p['race']]['m']))
    s = _summary(p, weeks)
    warn = None
    if p['level'] != 'first' and p['start_vol'] < s['first_week'] * 0.6:
        warn = (f"You've averaged {p['start_vol']:g} {p['unit']} a week lately; week 1 has {s['first_week']:g}. "
                'Consider an easier level or a longer plan, and build up gradually.')
    return {'summary': s, 'start_day': p['start_day'].isoformat(), 'race_day': p['race_day'].isoformat(), 'warning': warn,
            'weeks': [_out_week(w, p['unit']) for w in weeks[:3]]}


@router.post('')
def create(b: PlanIn, user=Depends(current_user)):
    with db.connect() as c:
        p = _settings(c, user['id'], b)
        c.execute('UPDATE training_plans SET active = false, ended = now() WHERE user_id = %s AND active', (user['id'],))
        pid = c.execute("""INSERT INTO training_plans (user_id, race, level, weeks, runs, long_day, start_day, race_day, goal_s, unit, start_vol)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                        (user['id'], p['race'], p['level'], p['weeks'], p['runs'], p['long_day'], p['start_day'], p['race_day'],
                         p['goal_s'], p['unit'], p['start_vol'])).fetchone()['id']
    return {'id': pid}


@router.get('/current')
def current(user=Depends(current_user)):
    with db.connect() as c:
        p = c.execute('SELECT * FROM training_plans WHERE user_id = %s AND active', (user['id'],)).fetchone()
        if not p: return {'plan': None}
        tz, unit, today = _ctx(c, user['id'])
        v = current_vdot(c, user['id'])
        runs = c.execute("""SELECT (start_time AT TIME ZONE %s)::date AS d, sum(distance_m) AS m, min(id) AS id, count(*) AS n
                            FROM activities WHERE user_id = %s AND sport = 'run' AND start_time >= %s::date - 1
                            GROUP BY 1""", (tz, user['id'], p['start_day'])).fetchall()
        marks = {r['day']: r['done'] for r in c.execute('SELECT day, done FROM plan_marks WHERE plan_id = %s AND user_id = %s', (p['id'], user['id'])).fetchall()}
        pred = run_predictions(c, user['id'], [(RACES[p['race']]['m'], p['race'])])
    P = paces(v, p['goal_s'], RACES[p['race']]['m'])
    weeks = build(p, P)
    U = p['unit']; per = MI if U == 'mi' else 1000
    by_day = {r['d']: r for r in runs}
    created = p['created'].astimezone(ZoneInfo(tz)).date()   # days before the plan existed aren't "missed"
    out, today_w, this_week = [], None, None
    for wk in weeks:
        o = _out_week(wk, U)
        end = wk['start'] + dt.timedelta(days=6)
        o['done'] = round(sum(r['m'] or 0 for d, r in by_day.items() if wk['start'] <= d <= end) / per, 1)
        pairs = list(zip(o['workouts'], wk['workouts']))
        for w, raw in pairs:
            r = by_day.get(raw['day'])
            if r: w['actual'] = round((r['m'] or 0) / per, 1); w['activity_id'] = r['id']
            enough = r and (not raw['dist'] or (r['m'] or 0) / per >= raw['dist'] * 0.98)
            if r and not enough: w['short'] = True
            if raw['day'] in marks:
                w['by_hand'] = True
                if marks[raw['day']]: w['status'] = 'done'
            elif enough: w['status'] = 'done'
            if 'status' not in w:
                w['status'] = ('today' if raw['day'] == today else 'before' if raw['day'] < created else
                               'missed' if raw['day'] < today else 'upcoming')
            if raw['day'] == today: today_w = w
        if wk['start'] <= today <= end: this_week = o['n']
        out.append(o)
    nxt = next((w for wk in out for w in wk['workouts'] if w['day'] > today.isoformat() and w['status'] != 'done'), None)
    ran = by_day.get(today)     # a run today, even on a rest day, shows on the Today card
    today_run = {'actual': round((ran['m'] or 0) / per, 1), 'activity_id': ran['id']} if ran else None
    # progress so far: workouts and distance due up to yesterday (today counts once it's done)
    due = [w for wk in out for w in wk['workouts'] if w['status'] in ('done', 'missed')]
    done_w = [w for wk in out for w in wk['workouts'] if w['status'] == 'done']
    progress = {'workouts_due': len(due), 'workouts_done': len(done_w),
                'planned_so_far': round(sum(w['dist'] or 0 for w in due), 1), 'done_so_far': round(sum(wk['done'] for wk in out if wk['start'] <= today.isoformat()), 1),
                'weeks_done': sum(1 for wk in out if (dt.date.fromisoformat(wk['start']) + dt.timedelta(days=6)) < today),
                'total_workouts': sum(len(wk['workouts']) for wk in out), 'total_distance': round(sum(wk['planned'] for wk in out), 1)}
    pace_out = {k: ([fmt_pace(x, U) for x in v_] if isinstance(v_, tuple) else fmt_pace(v_, U)) for k, v_ in P.items()}
    R = RACES[p['race']]
    return {'plan': {'id': p['id'], 'race': p['race'], 'race_name': R['name'], 'level': p['level'], 'level_name': LEVEL_NAMES[p['level']],
                     'weeks': p['weeks'], 'runs': p['runs'], 'long_day': p['long_day'], 'unit': U, 'start_day': p['start_day'].isoformat(),
                     'race_day': p['race_day'].isoformat(), 'goal_s': p['goal_s']},
            'today': today.isoformat(), 'today_workout': today_w, 'next_workout': nxt, 'this_week': this_week, 'today_run': today_run,
            'days_to_race': (p['race_day'] - today).days, 'vdot': v, 'predicted_s': pred[0]['seconds'] if pred else None,
            'paces': pace_out, 'summary': _summary(p, weeks), 'progress': progress, 'level_desc': LEVELS[p['race']][p['level']]['desc'],
            'taper_weeks': R['taper'], 'weeks': out}


class MarkIn(BaseModel):
    day: dt.date
    done: bool = True


def _plan_day(c, uid, day):
    """The active plan, if `day` is one of its workouts."""
    p = c.execute('SELECT * FROM training_plans WHERE user_id = %s AND active', (uid,)).fetchone()
    if not p: raise HTTPException(404, 'No training plan')
    if not any(w['day'] == day for wk in build(p, paces(None)) for w in wk['workouts']): raise HTTPException(400, 'No workout that day')
    return p


@router.post('/current/marks')
def mark(b: MarkIn, user=Depends(current_user)):
    """Tick a workout off by hand (done without a recorded run), or untick it (done=false: not done, even with a run)."""
    with db.connect() as c:
        p = _plan_day(c, user['id'], b.day)
        c.execute("""INSERT INTO plan_marks (user_id, plan_id, day, done) VALUES (%s, %s, %s, %s)
                     ON CONFLICT (plan_id, day) DO UPDATE SET done = EXCLUDED.done, created = now()""", (user['id'], p['id'], b.day, b.done))
    return {'ok': True}


@router.delete('/current/marks/{day}')
def unmark(day: dt.date, user=Depends(current_user)):
    with db.connect() as c:
        c.execute("""DELETE FROM plan_marks WHERE user_id = %s AND day = %s
                     AND plan_id = (SELECT id FROM training_plans WHERE user_id = %s AND active)""", (user['id'], day, user['id']))
    return {'ok': True}


@router.post('/restart')
def restart(user=Depends(current_user)):
    """Same settings, starting over from week 1 (next Monday, or this Monday early in the week). A race date that is
    still far enough away is kept (the plan is counted back from it again)."""
    with db.connect() as c:
        p = c.execute('SELECT * FROM training_plans WHERE user_id = %s AND active', (user['id'],)).fetchone()
    if not p: raise HTTPException(404, 'No plan to restart')
    b = PlanIn(race=p['race'], level=p['level'], weeks=p['weeks'] if p['level'] != 'first' else 9, runs=p['runs'], long_day=p['long_day'],
               race_day=None, goal_s=p['goal_s'])
    with db.connect() as c:
        _, _, today = _ctx(c, user['id'])
    if p['race_day'] > today + dt.timedelta(weeks=p['weeks']): b.race_day = p['race_day']
    return create(b, user)


@router.delete('/current')
def end(user=Depends(current_user)):
    with db.connect() as c:
        c.execute('UPDATE training_plans SET active = false, ended = now() WHERE user_id = %s AND active', (user['id'],))
    return {'ok': True}
