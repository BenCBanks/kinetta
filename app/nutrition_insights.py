"""Nutrition > Trends (2026-10-09): everything for one date range in one call - per day eaten / burned / deficit /
goal / macros / weight, top foods, meal split, and plain-language insights worked out from the numbers (no AI).

Burned per day = daily needs (BMR x everyday activity) + that day's workouts, or an imported number (energy.py).
Goal per day = a goal set for that date, else the daily target. Days with nothing logged, or clearly only partly logged, are "not counted"
in averages and deficits. Today is shown but never counted (it isn't over).
"""
import datetime as dt
from statistics import median

from fastapi import APIRouter, Depends

from . import db, energy, nutrients as N
from .auth import current_user

router = APIRouter(prefix='/api/food')
MEALS = ('breakfast', 'lunch', 'dinner', 'snacks')


def _f(v): return float(v or 0)


@router.get('/insights')
def insights(days: int = 30, since: dt.date | None = None, user=Depends(current_user)):
    with db.connect() as c:
        return insights_data(c, user['id'], days, since)


def insights_data(c, uid, days=30, since=None):
    """days = the last N days; since = from that date (e.g. the start of a diet) to today, at most 2 years."""
    ctx, info = energy.context(c, uid), energy.tdee(c, uid)
    today = ctx['today']
    days = max(1, min((today - since).days + 1, 731)) if since and since <= today else max(7, min(days, 366))
    start = today - dt.timedelta(days=days - 1)
    prof = c.execute('SELECT kcal_target, protein_target, carbs_target, fat_target, fiber_target, deficit_start, units FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}
    food = {r['day']: r for r in c.execute("""
        SELECT day, sum(kcal) AS kcal, sum(protein_g) AS protein_g, sum(carbs_g) AS carbs_g, sum(fat_g) AS fat_g,
               sum(fiber_g) AS fiber_g, count(fiber_g) AS fiber_n, count(*) AS n,
               sum(kcal) FILTER (WHERE meal = 'breakfast' AND source <> 'import') AS m_breakfast, sum(kcal) FILTER (WHERE meal = 'lunch' AND source <> 'import') AS m_lunch,
               sum(kcal) FILTER (WHERE meal = 'dinner' AND source <> 'import') AS m_dinner, sum(kcal) FILTER (WHERE meal = 'snacks' AND source <> 'import') AS m_snacks
        FROM food_entries WHERE user_id = %s AND day BETWEEN %s AND %s GROUP BY day""", (uid, start, today)).fetchall()}
    top = c.execute("""SELECT min(name) AS name, count(*) AS n, sum(kcal) AS kcal, sum(protein_g) AS protein_g
                       FROM food_entries WHERE user_id = %s AND day BETWEEN %s AND %s AND day < %s AND source <> 'import'
                       GROUP BY lower(regexp_replace(name, '\\s*\\(.*\\)$', '')) ORDER BY sum(kcal) DESC LIMIT 8""",
                    (uid, start, today, today)).fetchall()
    goals = {r['day']: float(r['kcal']) for r in c.execute('SELECT day, kcal FROM day_goals WHERE user_id = %s AND day BETWEEN %s AND %s', (uid, start, today)).fetchall()}
    ex = energy.exercise_by_day(c, uid, ctx['tz'], start - dt.timedelta(days=28), today, ctx['kg'])
    over = energy.burn_overrides(c, uid, start, today)
    resting = energy.resting_by_day(c, uid, ctx['tz'], start, today) if info['resting_source'] == 'apple_health' else {}
    least = energy.full_day_min(c, uid, info['base'])
    raw_w = {r['day']: float(r['kg']) for r in c.execute('SELECT day, kg FROM weights WHERE user_id = %s AND day BETWEEN %s AND %s', (uid, start, today)).fetchall()}

    usual = sum(v['kcal'] for d, v in ex.items() if start - dt.timedelta(days=28) <= d < start) / 28 if ex else 0
    usual = usual or info['avg_exercise']
    past_kcal = [_f(r['kcal']) for d, r in food.items() if d < today]
    typical = median(past_kcal) if past_kcal else 0
    rows, total = [], 0.0
    d = start
    while d <= today:
        f = food.get(d); exk = (ex.get(d) or {}).get('kcal', 0.0)
        burn = energy.burn_for_day(info, exk, d, resting, over)
        burned = burn['total']
        default = prof.get('kcal_target')
        goal = goals.get(d, default if default else None)      # workouts deepen the deficit, they don't raise the goal
        eaten = _f(f['kcal']) if f else None
        counted = bool(f) and d < today and not (typical and eaten < 0.5 * typical) and eaten >= least
        deficit = burned - eaten if counted and burned is not None else None
        if deficit is not None: total += deficit
        rows.append({'day': d.isoformat(), 'imported_burn': burn['source'] == 'imported', 'burn_source': burn['source'], 'burn_missing': burned is None, 'eaten': round(eaten) if eaten is not None else None, 'burned': round(burned) if burned is not None else None, 'exercise': round(exk),
                     'goal': round(goal) if goal else None, 'deficit': round(deficit) if deficit is not None else None, 'total': round(total),
                     'counted': counted, 'burn_counted': counted and burned is not None, 'today': d == today, 'training': exk > usual + 150,
                     **{k: round(_f(f[k]), 1) if f else None for k in ('protein_g', 'carbs_g', 'fat_g')},
                     'fiber_g': round(_f(f['fiber_g']), 1) if f and f['fiber_n'] else None,
                     'weight': raw_w.get(d), 'trend': round(energy.trend_on(ctx['points'], d), 2) if energy.trend_on(ctx['points'], d) is not None else None,
                     **({f'm_{m}': round(_f(f[f'm_{m}'])) for m in MEALS} if f else {})})
        d += dt.timedelta(days=1)

    C = [r for r in rows if r['counted']]
    B = [r for r in C if r['burn_counted']]
    n = len(C); avg = lambda k: sum(r[k] or 0 for r in C) / n if n else None
    summary = {'days': days, 'logged': n, 'past_days': days - 1, 'avg_eaten': round(avg('eaten')) if n else None,
               'burn_counted_days': len(B), 'missing_burn_days': sum(r['burn_missing'] for r in C),
               'avg_burned': round(sum(r['burned'] for r in B) / len(B)) if B else None, 'avg_deficit': round(total / len(B)) if B else None, 'total_deficit': round(total),
               'avg_goal': round(sum(r['goal'] for r in C if r['goal']) / max(1, sum(1 for r in C if r['goal']))) if any(r['goal'] for r in C) else None,
               **{f'avg_{k}': round(avg(k), 1) if n else None for k in ('protein_g', 'carbs_g', 'fat_g')},
               'predicted_kg': round(-total / energy.KCAL_PER_KG, 2), 'tdee': info['tdee'], 'tdee_confidence': info['confidence'], 'kg': ctx['kg']}
    tr = [r['trend'] for r in rows if r['trend'] is not None]
    summary['trend_change_kg'] = round(tr[-1] - tr[0], 2) if len(tr) >= 2 and len(raw_w) >= 2 else None
    meal_tot = {m: sum(r.get(f'm_{m}', 0) for r in C) for m in MEALS}
    all_kcal = sum(meal_tot.values()) or 1
    summary['meals'] = {m: round(v / all_kcal * 100) for m, v in meal_tot.items()}
    tg = {k: prof.get(k) for k in ('kcal_target', 'protein_target', 'carbs_target', 'fat_target', 'fiber_target')}
    summary['start'] = start.isoformat()
    # Aggregate only this person's recorded values. Missing foods are counted,
    # not turned into zeros or presented as a complete intake estimate.
    columns=[]
    for key in N.EXTRA:
        valid=f"{key} IS NOT NULL AND NOT coalesce(ref->'unknown_nutrients' ? '{key}',false)"
        columns.extend([f'sum({key}) FILTER(WHERE {valid}) AS {key}',f'count(*) FILTER(WHERE {valid}) AS {key}_known'])
    extra_row=c.execute('SELECT count(*) AS n,'+','.join(columns)+' FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s',(uid,start,today)).fetchone()
    extra={key:{'recorded':N.rounded(key,extra_row[key]),'known_count':extra_row[key+'_known'],
                'unknown_count':extra_row['n']-extra_row[key+'_known'],'complete':bool(extra_row['n']) and extra_row['n']==extra_row[key+'_known'],'unit':N.UNITS[key]}
           for key in N.EXTRA}
    return {'rows': rows, 'summary': summary, 'extra_nutrients':extra, 'targets': tg, 'deficit_start': prof['deficit_start'].isoformat() if prof.get('deficit_start') else None, 'insights': _insights(C, summary, tg, top, ctx, raw_w, prof.get('units') or 'imperial'),
            'top_foods': [{'name': t['name'], 'n': t['n'], 'kcal': round(_f(t['kcal'])), 'protein_g': round(_f(t['protein_g']))} for t in top]}


def _insights(C, S, tg, top, ctx, raw_w, units='imperial'):
    """Short plain sentences, most useful first; only when there is enough data to say it."""
    out, n = [], len(C)
    if S['missing_burn_days']: out.append(('info', f"Resting calories have not finished syncing for {S['missing_burn_days']} logged day(s). Food averages still count those days; deficit totals wait for resting data."))
    kcal = lambda value: f'{round(float(value)/5)*5:,}'
    weight = lambda kg: f"{abs(kg) * (2.20462 if units=='imperial' else 1):.1f} {'lb' if units=='imperial' else 'kg'}"
    if S['past_days'] and n / S['past_days'] < 0.7:
        out.append(('info', f"Logged {n} of the last {S['past_days']} days. Complete food records and weigh-ins help review the estimates; missing days are not zero intake."))
    if n < 3: return out
    if S['avg_goal']:
        diff = S['avg_eaten'] - S['avg_goal']
        out.append(('good' if abs(diff) <= S['avg_goal'] * .05 else 'warn' if diff > 0 else 'info',
                    f"Logged about {kcal(S['avg_eaten'])} kcal a day on average, "
                    + ('near your goal.' if abs(diff) <= S['avg_goal'] * .05 else f"about {kcal(abs(diff))} {'over' if diff > 0 else 'under'} your {kcal(S['avg_goal'])} kcal goal.")))
        hit = sum(1 for r in C if r['goal'] and abs(r['eaten'] - r['goal']) <= r['goal'] * .1)
        out.append(('info', f"Within 10% of your goal on {hit} of {n} days."))
    if S['trend_change_kg'] is not None and S['burn_counted_days'] >= 7:
        out.append(('info', f"Logged food and estimated burn suggest a rough change of {weight(S['predicted_kg'])} {'lost' if S['predicted_kg'] <= 0 else 'gained'}; "
                            f"your recorded scale trend is {'down' if S['trend_change_kg'] <= 0 else 'up'} {weight(S['trend_change_kg'])}."
                            + (" They are broadly consistent; neither proves why your weight changed." if abs(S['predicted_kg'] - S['trend_change_kg']) < 0.6
                               else " A gap can reflect water changes, missed or underestimated food, or an inaccurate burn estimate. Use the weekly check-in to review your target.")))
    if tg.get('protein_target'):
        hit = sum(1 for r in C if (r['protein_g'] or 0) >= tg['protein_target'] * .95)
        out.append(('good' if hit >= n * .7 else 'warn', f"Logged protein reached your {tg['protein_target']:.0f} g goal on {hit} of {n} days. "
                                                         f"Logged average: about {S['avg_protein_g']:.0f} g."))
    else:
        out.append(('info', f"Logged protein: about {S['avg_protein_g']:.0f} g a day. Set a protein goal if you would like a comparison."))
    wk = [r['eaten'] for r in C if dt.date.fromisoformat(r['day']).weekday() >= 5]
    wd = [r['eaten'] for r in C if dt.date.fromisoformat(r['day']).weekday() < 5]
    if len(wk) >= 2 and len(wd) >= 3:
        diff = sum(wk) / len(wk) - sum(wd) / len(wd)
        if abs(diff) >= 150: out.append(('info', f"You logged about {kcal(abs(diff))} kcal {'more' if diff > 0 else 'less'} on weekends than on weekdays."))
    tr, rs = [r['eaten'] for r in C if r['training']], [r['eaten'] for r in C if not r['training']]
    if len(tr) >= 3 and len(rs) >= 3 and abs(sum(tr) / len(tr) - sum(rs) / len(rs)) >= 100:
        diff = sum(tr) / len(tr) - sum(rs) / len(rs)
        out.append(('info', f"On bigger training days you logged about {kcal(abs(diff))} kcal {'more' if diff >= 0 else 'less'} than on other days. Incomplete logging can affect this comparison."))
    if S['meals']:
        m, p = max(S['meals'].items(), key=lambda x: x[1])
        if p >= 40: out.append(('info', f"{m.capitalize()} accounts for about {p}% of your logged calories."))
    if top:
        t = top[0]; share = _f(t['kcal']) / max(1, sum(r['eaten'] for r in C)) * 100
        if share >= 5: out.append(('info', f"Biggest logged calorie source: {t['name']} (about {kcal(_f(t['kcal']))} kcal across {t['n']} log{'s' if t['n'] > 1 else ''}, about {share:.0f}% of the logged total)."))
    fib = [r['fiber_g'] for r in C if r['fiber_g'] is not None]
    if len(fib) >= max(3, n // 2):
        a = sum(fib) / len(fib)
        if a < 25: out.append(('info', f"Reported fiber averages about {a:.0f} g across {len(fib)} days with fiber data. Foods without fiber values are missing data, not zero."))
    return out[:8]
