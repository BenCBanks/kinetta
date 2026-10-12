"""Energy balance:

Daily needs = BMR x everyday activity (profile.activity_factor: 1.2 mostly sitting, 1.3 some walking/standing,
  1.45 on your feet a lot). BMR = Mifflin-St Jeor from weight, height, age and sex (without height/age: ~22 kcal/kg
  for men, ~20 for women). NO exercise is in it - past exercise is never projected forward.
Burned on a day = daily needs + that day's workouts (the watch's number, else an estimate from the person's weight:
  run ~1.0 kcal per kg per km, walk/hike ~0.6 + climbing, ride = average power x time, anything else ~5 METs),
  or the burned number imported from another app for that day. Workouts therefore deepen that day's deficit.
Measured check (not used for targets): over the last 4 weeks, average logged intake minus the energy in the weight
  change (7,700 kcal per kg, straight line through the weigh-ins) = what the person really burned per day including
  workouts; compared with needs + average workouts to show whether the estimate runs high or low.
"""
import datetime as dt
from statistics import median

from . import db

KCAL_PER_KG = 7700


def weight_trend(rows):
    """rows: [{day, kg}] oldest first -> [(day, kg, trend)]; exponential average, 10 % per day (Happy Scale style)."""
    out, trend, prev = [], None, None
    for r in rows:
        if trend is None: trend = r['kg']
        else: trend += (1 - 0.9 ** max((r['day'] - prev).days, 1)) * (r['kg'] - trend)
        prev = r['day']
        out.append((r['day'], r['kg'], trend))
    return out


def trend_on(points, day):
    """Trend value on `day`: the last trend point on or before it (None before the first weigh-in)."""
    v = None
    for d, _, t in points:
        if d > day: break
        v = t
    return v


def activity_kcal(a, kg):
    if a.get('calories') and a['calories'] > 0: return float(a['calories']), False
    km, h = (a.get('distance_m') or 0) / 1000, (a.get('moving_s') or 0) / 3600
    sport = a.get('sport')
    if sport == 'run' and km: return kg * km * 1.0, True
    if sport in ('walk', 'hike') and km: return kg * km * 0.6 + kg * (a.get('ascent_m') or 0) * 0.0098 / 0.25 / 4.184, True
    if sport == 'ride' and a.get('avg_power') and h: return a['avg_power'] * h * 3.6, True
    if sport == 'ride' and h: return 7.0 * kg * h, True
    return 5.0 * kg * h, True


def exercise_by_day(c, user_id, tz, start, end, kg):
    """{date: {'kcal', 'n', 'estimated', 'items': [...]}} for start..end (local dates)."""
    rows = c.execute("""SELECT id, name, sport, distance_m, moving_s, ascent_m, avg_power, calories,
                               (start_time AT TIME ZONE %s)::date AS d
                        FROM activities WHERE user_id = %s AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s
                        ORDER BY start_time""", (tz, user_id, tz, start, end)).fetchall()
    out = {}
    for a in rows:
        k, est = activity_kcal(a, kg)
        o = out.setdefault(a['d'], {'kcal': 0.0, 'n': 0, 'estimated': False, 'items': []})
        o['kcal'] += k; o['n'] += 1; o['estimated'] |= est
        o['items'].append({'id': a['id'], 'name': a['name'], 'sport': a['sport'], 'distance_m': a['distance_m'], 'kcal': round(k), 'estimated': est})
    return out


def bmr(kg, height_cm, birth_year, sex, year):
    """Mifflin-St Jeor resting burn (kcal/day); None without height or age."""
    if not (kg and height_cm and birth_year): return None
    return 10 * kg + 6.25 * height_cm - 5 * (year - birth_year) + {'male': 5, 'female': -161}.get(sex, -78)


def context(c, user_id):
    p = c.execute('SELECT tz, weight_kg, sex, height_cm, birth_year FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}
    tz = p.get('tz') or db.DEFAULT_TZ
    today = c.execute('SELECT (now() AT TIME ZONE %s)::date AS d', (tz,)).fetchone()['d']
    weights = c.execute('SELECT day, kg FROM weights WHERE user_id = %s ORDER BY day', (user_id,)).fetchall()
    pts = weight_trend(weights)
    kg = pts[-1][2] if pts else (p.get('weight_kg') or 75.0)
    return {'tz': tz, 'today': today, 'points': pts, 'kg': kg, 'sex': p.get('sex'),
            'bmr': bmr(kg, p.get('height_cm'), p.get('birth_year'), p.get('sex'), today.year)}


ACTIVITY = {1.2: 'Mostly sitting', 1.3: 'Some walking and standing', 1.45: 'On my feet a lot'}


# A day with only a snack logged isn't a 2,000 kcal deficit: days under 40% of the calorie goal (or of daily needs, without
# a goal) look partly logged and stay out of deficits, averages and the needs check, like days with nothing logged.
PARTLY = 0.4


def full_day_min(c, user_id, base):
    goal = (c.execute('SELECT kcal_target FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}).get('kcal_target')
    return PARTLY * float(goal or base)


def tdee(c, user_id, days=28):
    """Daily needs from BMR (see the top of this file) + the measured check. Key 'tdee' = daily needs WITHOUT exercise."""
    ctx = context(c, user_id)
    factor = float((c.execute('SELECT activity_factor FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}).get('activity_factor') or 1.2)
    bmr = ctx['bmr'] or ctx['kg'] * (20 if ctx['sex'] == 'female' else 22)
    base = bmr * factor
    end = ctx['today'] - dt.timedelta(days=1)            # today isn't finished
    start = end - dt.timedelta(days=days - 1)
    intake = {r['day']: float(r['kcal']) for r in c.execute(
        'SELECT day, sum(kcal) AS kcal FROM food_entries WHERE user_id = %s AND day BETWEEN %s AND %s GROUP BY day',
        (user_id, start, end)).fetchall()}
    typical = median(intake.values()) if intake else 0
    least = full_day_min(c, user_id, base)
    full = {d: k for d, k in intake.items() if k >= 0.5 * typical and k >= least}     # partly logged days left out
    ex = exercise_by_day(c, user_id, ctx['tz'], start, end, ctx['kg'])
    avg_ex = sum(v['kcal'] for v in ex.values()) / days
    inside = [p for p in ctx['points'] if start <= p[0] <= end]
    observed = rate = None
    if len(full) >= 7 and len(inside) >= 3 and (inside[-1][0] - inside[0][0]).days >= 10:
        xs = [(p[0] - start).days for p in inside]; ys = [p[1] for p in inside]
        mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
        rate = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)   # kg per day
        observed = sum(full.values()) / len(full) - rate * KCAL_PER_KG
    expected = base + avg_ex           # what the model says was burned on average, workouts included
    return {'tdee': round(base), 'base': round(base), 'bmr': round(bmr), 'bmr_exact': bool(ctx['bmr']),
            'activity_factor': factor, 'activity': ACTIVITY.get(round(factor, 2), f'x{factor:g}'),
            'confidence': 'bmr' if ctx['bmr'] else 'rough',
            'observed': round(observed) if observed is not None else None, 'expected': round(expected),
            'check_diff': round(observed - expected) if observed is not None else None,
            'logged_days': len(full), 'partial_days': len(intake) - len(full), 'weigh_ins': len(inside), 'days': days,
            'avg_intake': round(sum(full.values()) / len(full)) if full else None, 'avg_exercise': round(avg_ex),
            'trend_kg_per_week': round(rate * 7, 2) if rate is not None else None, 'kg': round(ctx['kg'], 1)}


def burn_overrides(c, user_id, start, end):
    """{day: kcal} burned per day imported from another app (day_energy) - used instead of the estimate."""
    return {r['day']: float(r['burned_kcal']) for r in c.execute(
        'SELECT day, burned_kcal FROM day_energy WHERE user_id = %s AND day BETWEEN %s AND %s', (user_id, start, end)).fetchall()}


def daily_burn(info, exercise_kcal):
    """Calories burned on one day: daily needs (BMR x everyday activity) + that day's workouts."""
    return info['base'] + exercise_kcal


def deficits(c, user_id, since=None):
    """Day by day from `since` (default: first day with food) to today: eaten, burned, deficit (burned - eaten) and the
    running total. Days with nothing logged, or clearly only partly logged, don't count (shown as skipped).
    Today counts 'so far'. Also: what the running total predicts on the scale vs the weight trend's actual change."""
    ctx, info = context(c, user_id), tdee(c, user_id)
    first = c.execute('SELECT min(day) AS d FROM food_entries WHERE user_id = %s', (user_id,)).fetchone()['d']
    since = since or first
    if not since: return {'since': None, 'days': [], 'tdee': info['tdee']}
    since = min(since, ctx['today'])
    intake = {r['day']: float(r['kcal']) for r in c.execute(
        'SELECT day, sum(kcal) AS kcal FROM food_entries WHERE user_id = %s AND day BETWEEN %s AND %s GROUP BY day',
        (user_id, since, ctx['today'])).fetchall()}
    done = [k for d, k in intake.items() if d < ctx['today']]
    typical = median(done) if done else 0
    least = full_day_min(c, user_id, info['base'])
    ex = exercise_by_day(c, user_id, ctx['tz'], since, ctx['today'], ctx['kg'])
    over = burn_overrides(c, user_id, since, ctx['today'])
    days, total, counted = [], 0.0, 0
    d = since
    while d <= ctx['today']:
        eaten, exk = intake.get(d), (ex.get(d) or {}).get('kcal', 0.0)
        burn = over.get(d, daily_burn(info, exk))
        today = d == ctx['today']
        skip = eaten is None or (not today and ((typical and eaten < 0.5 * typical) or eaten < least))
        deficit = None if skip else burn - eaten
        if deficit is not None and not today: total += deficit; counted += 1
        days.append({'day': d.isoformat(), 'eaten': round(eaten) if eaten is not None else None, 'burned': round(burn),
                     'exercise': round(exk), 'deficit': round(deficit) if deficit is not None else None,
                     'total': round(total), 'skipped': skip, 'today': today})
        d += dt.timedelta(days=1)
    t0, t1 = trend_on(ctx['points'], since), trend_on(ctx['points'], ctx['today'])
    return {'since': since.isoformat(), 'first_food': first.isoformat() if first else None, 'tdee': info['tdee'], 'confidence': info['confidence'],
            'days': days, 'total': round(total), 'counted_days': counted, 'avg_deficit': round(total / counted) if counted else None,
            'predicted_kg': round(-total / KCAL_PER_KG, 2), 'trend_change_kg': round(t1 - t0, 2) if t0 is not None and t1 is not None else None}
