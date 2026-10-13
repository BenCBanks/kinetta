"""Lifting (api_lifts.py, 2026-10-13): exercises, sets, last time, records, repeating a session, privacy between people,
and a watch's strength workout merging into a session logged here. Made-up zz_test people only; deleted at the end."""
import datetime as dt
from kc import PW, person

n = 0
def ck(cond, what):
    global n
    assert cond, what; n += 1

for name in ('zz_test_lift_a', 'zz_test_lift_b'):     # left over from a run that stopped part-way: start clean
    person(name).post('/api/account/delete', {'password': PW})
a, b = person('zz_test_lift_a', 'Lift Tester'), person('zz_test_lift_b')

# the common list is offered until used; using one makes it yours (with its usual kind)
s, ex = a.get('/api/lifts/exercises'); ck(s == 200 and not ex['mine'] and any(x['name'] == 'Bench press' for x in ex['common']), 'common list')
s, bench = a.post('/api/lifts/exercises', {'name': '  bench   PRESS '}); ck(s == 200 and bench['name'] == 'Bench press' and bench['kind'] == 'weight', f'bench {bench}')
ck(a.post('/api/lifts/exercises', {'name': 'Bench press'})[1]['id'] == bench['id'], 'same name -> same exercise')
s, plank = a.post('/api/lifts/exercises', {'name': 'Plank'}); ck(plank['kind'] == 'time', 'plank is timed')
s, mine = a.post('/api/lifts/exercises', {'name': 'Zz sled push', 'kind': 'body'}); ck(mine['kind'] == 'body', 'own exercise')
ck(not any(x['name'] == 'Bench press' for x in a.get('/api/lifts/exercises')[1]['common']), 'used one leaves the common list')

# session 1, logged afterwards (by hand, then sets)
s, one = a.post('/api/activities/manual', {'sport': 'workout', 'name': 'Push day', 'start': '2026-10-01T18:00', 'duration_s': 3600}); ck(s == 200, 'manual workout')
s, r = a.put(f"/api/activities/{one['id']}/lifts", {'exercises': [
    {'exercise_id': bench['id'], 'sets': [{'reps': 10, 'kg': 40, 'warmup': True}, {'reps': 5, 'kg': 80}, {'reps': 5, 'kg': 80}]},
    {'exercise_id': plank['id'], 'sets': [{'secs': 60}]}]})
ck(s == 200 and len(r['exercises']) == 2 and r['exercises'][0]['last'] is None, f'save session 1 {s} {r}')
ck(not any(x.get('pr') for e in r['exercises'] for x in e['sets']), 'first time: no records yet')
ck(a.put(f"/api/activities/{one['id']}/lifts", {'exercises': [{'exercise_id': 999999999, 'sets': []}]})[0] == 404, 'unknown exercise refused')

# session 2: last time shows, heavier set is a record, warm-ups and planned sets never count
s, two = a.post('/api/activities/manual', {'sport': 'workout', 'start': '2026-10-04T18:00', 'duration_s': 3000})
s, r = a.put(f"/api/activities/{two['id']}/lifts", {'exercises': [
    {'exercise_id': bench['id'], 'sets': [{'reps': 3, 'kg': 120, 'warmup': True}, {'reps': 5, 'kg': 85}, {'reps': 3, 'kg': 90}, {'reps': 12, 'kg': 200, 'done': False}]},
    {'exercise_id': plank['id'], 'sets': [{'secs': 75}]}]})
bs = r['exercises'][0]
ck(bs['last'] and bs['last']['activity_id'] == one['id'] and len(bs['last']['sets']) == 3, 'last time = session 1')
ck(bs['sets'][0].get('pr') is None, 'warm-up is never a record')
ck('heaviest' in (bs['sets'][2].get('pr') or []) and 'heaviest' not in (bs['sets'][1].get('pr') or []), f"heaviest on the 90 kg set {bs['sets']}")
ck(bs['sets'][3].get('pr') is None, 'planned set is never a record')
ck('secs' in (r['exercises'][1]['sets'][0].get('pr') or []), 'longer plank is a record')

# history: records + sessions newest first; planned sets left out
s, h = a.get(f"/api/lifts/exercises/{bench['id']}")
ck(s == 200 and [x['activity_id'] for x in h['sessions']] == [two['id'], one['id']], 'history order')
ck(h['records']['heaviest']['value'] == 90 and h['records']['heaviest']['activity_id'] == two['id'], f"heaviest record {h['records']}")
ck(abs(h['records']['e1rm']['value'] - 85 * (1 + 5 / 30)) < 0.01, 'best estimated 1RM (85 x 5)')
ck(all(x['done'] for x in h['sessions'][0]['sets']) and len(h['sessions'][0]['sets']) == 3, 'planned set left out of history')
s, lst = a.get('/api/lifts/exercises')
row = next(x for x in lst['mine'] if x['id'] == bench['id'])
ck(row['sessions'] == 2 and row['best_kg'] == 90, f'list summary {row}')

# feed and detail carry the summary
s, d = a.get(f"/api/activities/{two['id']}")
ck(d['lifts'] and d['lifts']['sets'] == 3 and d['lifts']['names'] == ['Bench press', 'Plank'] and abs(d['lifts']['volume'] - (85 * 5 + 90 * 3)) < 0.01, f"detail summary {d['lifts']}")
feed = a.get('/api/activities?limit=5')[1]
ck(any(x['id'] == two['id'] and x['lifts'] for x in feed), 'feed summary')

# start now: a live session; a second tap resumes it; repeating copies sets as planned
s, live = a.post('/api/lifts/start', {'copy_from': two['id']}); ck(s == 200 and not live['resumed'], f'start {live}')
ck(a.post('/api/lifts/start', {})[1] == {'id': live['id'], 'resumed': True}, 'second start resumes')
s, L = a.get(f"/api/activities/{live['id']}/lifts")
ck(L['open'] and [e['name'] for e in L['exercises']] == ['Bench press', 'Plank'] and not any(x['done'] for e in L['exercises'] for x in e['sets']), 'copied as plan')
ck(len(L['exercises'][0]['sets']) == 3, 'copied only the done sets')
ck(any(x['id'] == live['id'] and x['lift_open'] for x in a.get('/api/lifts/sessions')[1]), 'open session listed')
sets = L['exercises'][0]['sets']; sets[1]['done'] = True
s, r = a.put(f"/api/activities/{live['id']}/lifts", {'exercises': [{'exercise_id': bench['id'], 'sets': sets}], 'finish': True})
ck(s == 200 and not r['open'], 'finish closes it')
ck(a.get(f"/api/activities/{live['id']}")[1]['name'].endswith('Lift'), 'named "... Lift"')

# privacy: another person can't read, change or use any of it
ck(b.get(f"/api/activities/{two['id']}/lifts")[0] == 404, 'other person: no sets')
ck(b.put(f"/api/activities/{two['id']}/lifts", {'exercises': []})[0] == 404, 'other person: no changes')
ck(b.get(f"/api/lifts/exercises/{bench['id']}")[0] == 404, 'other person: no history')
ck(b.patch(f"/api/lifts/exercises/{bench['id']}", {'note': 'x'})[0] == 404, 'other person: no edit')
s, bt = b.post('/api/activities/manual', {'sport': 'workout', 'start': '2026-10-04T18:00', 'duration_s': 600})
ck(b.put(f"/api/activities/{bt['id']}/lifts", {'exercises': [{'exercise_id': bench['id'], 'sets': [{'reps': 1, 'kg': 1}]}]})[0] == 404, "can't log with someone else's exercise")
ck(not b.get('/api/lifts/exercises')[1]['mine'], "other person's list is empty")

# note, rename (name clash refused), delete
ck(a.patch(f"/api/lifts/exercises/{bench['id']}", {'note': ' seat on 4 '})[0] == 200, 'note')
ck(a.get(f"/api/lifts/exercises/{bench['id']}")[1]['exercise']['note'] == 'seat on 4', 'note saved, trimmed')
ck(a.patch(f"/api/lifts/exercises/{mine['id']}", {'name': 'plank'})[0] == 409, 'rename onto another name refused')

# a watch's strength workout during a session logged here: its numbers join the session, no second activity
s, lv = a.post('/api/lifts/start', {}); ck(s == 200, 'start for merge')
st = a.get(f"/api/activities/{lv['id']}")[1]['start_time']
t0 = dt.datetime.fromisoformat(st) + dt.timedelta(minutes=3)
w = {'id': 'zz-test-watch-1', 'type': 'traditionalStrengthTraining', 'start': t0.isoformat(), 'end': (t0 + dt.timedelta(minutes=40)).isoformat(),
     'duration_s': 2400, 'calories': 250, 'heart_rate': [{'t': (t0 + dt.timedelta(minutes=m)).isoformat(), 'bpm': 100 + m} for m in range(0, 40, 2)], 'route': []}
s, res = a.post('/api/health/workouts', {'workouts': [w]})
ck(s == 200 and res['results'][0]['activity_id'] == lv['id'], f'merged into the session {res}')
m = a.get(f"/api/activities/{lv['id']}")[1]
ck(m['calories'] == 250 and m['avg_hr'] and not m['lift_open'] and m['elapsed_s'] >= 2400, f"watch numbers on it {m['calories']} {m['avg_hr']} {m['elapsed_s']}")
s, res = a.post('/api/health/workouts', {'workouts': [w]})
ck(res['duplicates'] == 1 and res['results'][0]['activity_id'] == lv['id'], 'sent again: duplicate')

ck(a.delete(f"/api/lifts/exercises/{plank['id']}")[0] == 200 and a.get(f"/api/lifts/exercises/{plank['id']}")[0] == 404, 'delete exercise')
s, r = a.get(f"/api/activities/{two['id']}/lifts"); ck([e['name'] for e in r['exercises']] == ['Bench press'], 'its sets went with it')

for x in (a, b): x.post('/api/account/delete', {'password': PW})
print(f'test_lifts: {n} checks passed')
