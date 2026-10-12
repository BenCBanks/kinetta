"""Training plans tick off a run of the planned distance that day (not other days), and by hand on any day; calorie-burn goals (daily too); race predictions slow down
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

# a run today: shows on the Today card; ticks off today's workout when it's long enough
s, r = p.post('/api/activities/manual', {'sport': 'run', 'name': 'zz plan run', 'start': f'{today}T07:00', 'duration_s': 3300,
                                         'distance_m': 6.1 * 1609.344, 'calories': 650})
check('run added', s == 200, r)
D = p.get('/api/plans/current')[1]
check('today shows the run', D['today_run'] and abs(D['today_run']['actual'] - 6.1) < 0.05, D['today_run'])
W = {w['day']: w for w in D['weeks'][0]['workouts']}
t = today.isoformat()
if t in W and W[t]['dist'] and W[t]['dist'] <= 6.1: check("today's workout done", W[t]['status'] == 'done', W[t])

# week 2 is always ahead: a full-length run ticks its day off, a short one doesn't, a rest-day run ticks nothing off
def week2(): return {w['day']: w for w in p.get('/api/plans/current')[1]['weeks'][1]['workouts']}
W2 = week2(); d1, d2 = sorted(W2)[:2]
run = lambda day, mi: p.post('/api/activities/manual', {'sport': 'run', 'name': 'zz plan run', 'start': f'{day}T07:00',
                                                         'duration_s': 3000, 'distance_m': mi * 1609.344, 'calories': 500})
run(d1, W2[d1]['dist'] * 0.99); run(d2, W2[d2]['dist'] * 0.5)
rest2 = next(d for d in (dt.date.fromisoformat(d1) + dt.timedelta(days=k) for k in range(1, 7)) if d.isoformat() not in W2)
run(rest2, 20)
W2 = week2()
check('full-length run ticks it off', W2[d1]['status'] == 'done' and not W2[d1].get('by_hand'), W2[d1])
check('short run does not', W2[d2]['status'] != 'done' and W2[d2].get('short') and W2[d2]['actual'], W2[d2])
check('rest-day run ticks nothing else off', [d for d, w in W2.items() if w['status'] == 'done'] == [d1], W2)

# by hand: any workout day, future too; unticking wins over a run; clearing goes back to the run
check('no ticking off a rest day', p.post('/api/plans/current/marks', {'day': rest2.isoformat()})[0] == 400)
check('tick off ahead by hand', p.post('/api/plans/current/marks', {'day': d2})[0] == 200)
check('shows as done by hand', week2()[d2]['status'] == 'done' and week2()[d2].get('by_hand'))
check('untick', p.post('/api/plans/current/marks', {'day': d1, 'done': False})[0] == 200)
check('not done after untick, run or not', week2()[d1]['status'] != 'done', week2()[d1])
check('tick again', p.post('/api/plans/current/marks', {'day': d1, 'done': True})[0] == 200 and week2()[d1]['status'] == 'done')
check('clear', p.delete(f'/api/plans/current/marks/{d2}')[0] == 200)
check('not done after clearing (short run)', week2()[d2]['status'] != 'done', week2()[d2])
past = next((d for d in sorted(W) if d < t), None)
if past: check('tick off a past day', p.post('/api/plans/current/marks', {'day': past})[0] == 200)

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
