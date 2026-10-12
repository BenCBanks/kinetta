"""Weigh-ins (2026-10-12): old ones can be added; the profile weight (used for calorie burn) stays the newest one."""
import datetime as dt
from kc import person
p = person('zz_test_weigh')
n = 0
def ck(cond, m):
    global n
    assert cond, m; n += 1
day = lambda k: (dt.date.today() - dt.timedelta(days=k)).isoformat()
for k in (0, 30, 400): p.delete(f'/api/food/weights/{day(k)}')
s, _ = p.put('/api/food/weights', {'day': day(0), 'kg': 80}); ck(s == 200, 'today')
ck(p.get('/api/me')[1]['weight_kg'] == 80, 'profile = today')
s, _ = p.put('/api/food/weights', {'day': day(30), 'kg': 84}); ck(s == 200, 'a month ago')
s, _ = p.put('/api/food/weights', {'day': day(400), 'kg': 90}); ck(s == 200, 'over a year ago')
ck(p.get('/api/me')[1]['weight_kg'] == 80, 'an old weigh-in leaves the profile weight alone')
pts = [x['day'] for x in p.get('/api/food/weights?days=3650')[1]['points']]
ck(pts == [day(400), day(30), day(0)], f'all three listed {pts}')
s, _ = p.put('/api/food/weights', {'day': (dt.date.today() + dt.timedelta(days=5)).isoformat(), 'kg': 70}); ck(s == 400, f'not a future day {s}')
p.delete(f'/api/food/weights/{day(0)}')
ck(p.get('/api/me')[1]['weight_kg'] == 84, 'deleting the newest falls back to the next one')
for k in (30, 400): p.delete(f'/api/food/weights/{day(k)}')
print(f'weights: {n} checks passed')
