"""Training plans tick off runs on swapped days and by hand; calorie-burn goals (daily too); race predictions slow down
for longer races (2026-10-12)."""
import datetime as dt
import sys
from kc import person

ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print('FAIL', name, extra)

p = person('zz_test_plans')
p.put('/api/me', {'units': 'imperial'})
p.delete('/api/plans/current')
# a 10-week 10K plan that started this Monday (a race day 9 weeks and 6 days on)
today = dt.date.fromisoformat(p.get('/api/plans/options')[1]['today'])
monday = today - dt.timedelta(days=today.weekday())
s, r = p.post('/api/plans', {'race': '10k', 'level': 'beginner', 'weeks': 10, 'runs': 3, 'long_day': 6,
                             'race_day': (monday + dt.timedelta(weeks=9, days=6)).isoformat()})
check('plan made', s == 200, r)
D = p.get('/api/plans/current')[1]
week = D['weeks'][0]['workouts']
days = {w['day'] for w in week}
check('plan starts this Monday', D['plan']['start_day'] == monday.isoformat(), D['plan'])
check('no run yet today', D['today_run'] is None)

# a run today: counts for today's workout, or (on a rest day) the nearest open one - a day before, or tomorrow's
s, r = p.post('/api/activities/manual', {'sport': 'run', 'name': 'zz plan run', 'start': f'{today}T07:00', 'duration_s': 3300,
                                         'distance_m': 6.1 * 1609.344, 'calories': 650})
check('run added', s == 200, r)
D = p.get('/api/plans/current')[1]
check('today shows the run', D['today_run'] and abs(D['today_run']['actual'] - 6.1) < 0.05, D['today_run'])
W = {w['day']: w for w in D['weeks'][0]['workouts']}
t = today.isoformat()
if t in W: check("today's workout done", W[t]['status'] == 'done', W[t])
else:
    near = [d for d in sorted(W) if -3 <= (dt.date.fromisoformat(d) - today).days <= 1]
    if near:
        hit = [w for w in W.values() if w.get('ran_on') == t]
        check('rest-day run ticks off a nearby workout', len(hit) == 1 and hit[0]['day'] in near, W)

# by hand: only a workout day, not in the future; undo works
future = next((d for d in sorted(W) if d > t), None)
if future: check('no ticking off ahead', p.post('/api/plans/current/marks', {'day': future})[0] == 400)
rest = next((monday + dt.timedelta(days=k) for k in range(7) if (monday + dt.timedelta(days=k)).isoformat() not in days), None)
if rest and rest <= today: check('no ticking off a rest day', p.post('/api/plans/current/marks', {'day': rest.isoformat()})[0] == 400)
open_ = next((d for d in sorted(W) if d <= t and W[d]['status'] != 'done'), None)
if open_:
    check('tick off by hand', p.post('/api/plans/current/marks', {'day': open_})[0] == 200)
    w = next(x for x in p.get('/api/plans/current')[1]['weeks'][0]['workouts'] if x['day'] == open_)
    check('shows as done by hand', w['status'] == 'done' and w.get('by_hand'), w)
    check('undo', p.delete(f'/api/plans/current/marks/{open_}')[0] == 200)
    w = next(x for x in p.get('/api/plans/current')[1]['weeks'][0]['workouts'] if x['day'] == open_)
    check('not done after undo', w['status'] != 'done', w)

# calorie-burn goals, daily and weekly
s, r = p.post('/api/goals', {'period': 'day', 'metric': 'calories', 'target': 600})
check('daily calorie goal', s == 200, r)
G = [g for g in p.get('/api/goals')[1] if g['metric'] == 'calories' and g['period'] == 'day']
check('counts today\'s calories', G and G[0]['value'] >= 650, G)
check('bad metric refused', p.post('/api/goals', {'period': 'week', 'metric': 'steps', 'target': 1})[0] == 422)
for g in p.get('/api/goals')[1]: p.delete(f"/api/goals/{g['id']}")

# predictions: slower per mile as races get longer
F = p.get('/api/fitness?days=60')[1]
P = F['predictions']
if P: check('predictions slow down with distance', all(P[i]['seconds'] / P[i]['distance_m'] < P[i + 1]['seconds'] / P[i + 1]['distance_m'] for i in range(len(P) - 1)), P)

for a in p.get('/api/activities?limit=20')[1]:
    if a['name'] == 'zz plan run': p.delete(f"/api/activities/{a['id']}")
p.delete('/api/plans/current')
print(f'plans: {ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
