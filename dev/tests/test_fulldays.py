"""Partly logged days (a single snack) and empty days stay out of deficits, averages and totals; past days can be edited."""
import datetime as dt
import sys
from kc import person

ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print('FAIL', name, extra)

p = person('zz_test_days')
today = dt.date.fromisoformat(p.get('/api/food/day')[1]['day'])
d1, d2, d3 = (today - dt.timedelta(days=k) for k in (3, 2, 1))
check('goal set', p.put('/api/food/targets', {'kcal_target': 2000})[0] == 200)
food = lambda day, kcal, name: p.post('/api/food/entries', [{'day': day.isoformat(), 'meal': 'dinner', 'name': name, 'kcal': kcal}])
# d1 full day, d2 one snack (under 40% of the 2,000 goal), d3 nothing
check('log a full past day', food(d1, 1800, 'Test full day')[0] == 200)
check('log a snack on a past day', food(d2, 150, 'Test snack')[0] == 200)

I = p.get('/api/food/insights?days=7')[1]; S = I['summary']; R = {r['day']: r for r in I['rows']}
check('only the full day counts', S['logged'] == 1, S)
check('snack day not counted', R[d2.isoformat()]['counted'] is False and R[d2.isoformat()]['deficit'] is None, R[d2.isoformat()])
check('empty day not counted', R[d3.isoformat()]['counted'] is False and R[d3.isoformat()]['eaten'] is None)
check('total = the full day only', S['total_deficit'] == R[d1.isoformat()]['deficit'] and S['avg_deficit'] == S['total_deficit'], S)
D = p.get('/api/food/deficit')[1]
check('running total skips the snack day', D['counted_days'] == 1 and D['total'] == S['total_deficit'], D)
day2 = p.get(f'/api/food/day?d={d2}')[1]
check('day view says partly logged', day2['burned']['partly'] is True, day2['burned'])
check('full day not partly', p.get(f'/api/food/day?d={d1}')[1]['burned']['partly'] is False)

# finishing the snack day makes it count; editing an entry's day moves it
food(d2, 1500, 'Test rest of the day')
S2 = p.get('/api/food/insights?days=7')[1]['summary']
check('finished day now counts', S2['logged'] == 2, S2)
eid = next(e['id'] for e in p.get(f'/api/food/day?d={d2}')[1]['entries'] if e['name'] == 'Test snack')
check('edit a past entry', p.patch(f'/api/food/entries/{eid}', {'kcal': 200, 'day': d3.isoformat()})[0] == 200)
check('moved to the other day', any(e['id'] == eid and e['kcal'] == 200 for e in p.get(f'/api/food/day?d={d3}')[1]['entries']))
check('delete a past entry', p.delete(f'/api/food/entries/{eid}')[0] == 200)

p.delete('/api/food/entries/' + str(next(e['id'] for e in p.get(f'/api/food/day?d={d1}')[1]['entries'])))
for e in p.get(f'/api/food/day?d={d2}')[1]['entries']: p.delete(f"/api/food/entries/{e['id']}")
food(d1, 100, 'Test lone snack')
S3 = p.get('/api/food/insights?days=7')[1]['summary']
check('only a snack logged: nothing counted', S3['logged'] == 0 and S3['avg_deficit'] is None and S3['total_deficit'] == 0, S3)
check('needs check ignores the snack', p.get('/api/food/energy')[1]['logged_days'] == 0)

print(f'full days: {ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
