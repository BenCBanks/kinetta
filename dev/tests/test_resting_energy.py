"""Private fictional Health resting totals; independently set food goals and workout calories stay intact."""
import datetime as dt
import sys
from kc import person

ok = 0

def check(name, value):
    global ok
    assert value, name
    ok += 1

p, other = person('zz_test_resting'), person('zz_test_resting_other')
for client in (p, other):
    client.delete('/api/health/resting')
    client.put('/api/profile', {'tz': 'UTC', 'activity_factor': 1.45})
    for row in client.get('/api/activities?limit=100')[1]: client.delete('/api/activities/' + str(row['id']))
check('manual target', p.put('/api/food/targets', {'kcal_target': 1800})[0] == 200)
now = dt.datetime.now(dt.timezone.utc)
today, yesterday, missing = now.date(), now.date() - dt.timedelta(days=1), now.date() - dt.timedelta(days=2)
for day in (today, yesterday, missing):
    for e in p.get('/api/food/day?d='+day.isoformat())[1]['entries']:p.delete('/api/food/entries/'+str(e['id']))
    p.post('/api/food/entries', [{'day': str(day), 'meal': 'dinner', 'name': 'Fictional dinner', 'kcal': 1600}])
check('custom day target', p.put('/api/food/day-goal', {'day': str(today), 'kcal': 1750})[0] == 200)
r=p.post('/api/activities/manual', {'name': 'Fictional recorded workout', 'sport': 'run', 'start': now.isoformat(), 'duration_s': 1800, 'distance_m': 5000, 'calories': 500})
check('activity added',r[0]==200)
# Manual route's calories may be under 'calories'; inspect through the real day response.
base=p.get('/api/food/day')[1]
exercise=base['burned']['kcal']
check('workout has positive calories', exercise>0)

def send(client, rows, observed=now, **kw):
    return client.post('/api/health/resting', {'tz': 'UTC', 'observed_at': observed.isoformat(), 'days': rows, **kw})
rows=[{'day': str(today),'resting_kcal': 1200}, {'day': str(yesterday),'resting_kcal': 1700}]
check('requires selected source',send(p,rows)[0]==409)
check('choose watch',p.put('/api/profile',{'resting_source':'apple_health'})[0]==200)
check('prior in-progress total received',send(p,[{'day':str(yesterday),'resting_kcal':1400}],now-dt.timedelta(days=1))[0]==200)
check('prior in-progress total is not a finished day',p.get('/api/food/day?d='+str(yesterday))[1]['burned']['day_burn'] is None)
check('daily upload',send(p,rows)[0]==200)
check('replay idempotent',send(p,rows)[0]==200 and len(p.get('/api/health/resting')[1]['days'])==2)
day=p.get('/api/food/day')[1];b=day['burned']
check('actual resting replaces BMR', b['bmr']==1200 and b['source']=='apple_health')
check('workout unchanged and counted once', b['kcal']==exercise and b['day_burn']==1200+exercise)
check('no multiplier daily life',b['daily_life']==0 and b['base']==1200)
check('manual target preserved',day['goal']['kcal']==1750 and day['goal']['default']==1800)
check('corrected health total',send(p,[{'day':str(today),'resting_kcal':1300}],now+dt.timedelta(seconds=1))[0]==200)
check('older delayed read accepted without replacing newer',send(p,[{'day':str(today),'resting_kcal':900}],now-dt.timedelta(seconds=10))[0]==200 and p.get('/api/food/day')[1]['burned']['bmr']==1300)
check('missing stays unknown',p.get('/api/food/day?d='+str(missing))[1]['burned']['day_burn'] is None)
D=p.get('/api/food/deficit')[1];d={r['day']:r for r in D['days']}
check('historical Health total used',d[str(yesterday)]['burned']==1700 and d[str(yesterday)]['deficit']==100)
check('missing not fabricated as zero/formula',d[str(missing)]['burn_missing'] and d[str(missing)]['deficit'] is None)
I=p.get('/api/food/insights?days=7')[1];i={r['day']:r for r in I['rows']}
check('insights consistent with running deficit',i[str(yesterday)]['burned']==1700 and i[str(missing)]['burned'] is None)
check('food averages do not depend on watch data', I['summary']['logged']==2 and I['summary']['avg_eaten']==1600 and I['summary']['burn_counted_days']==1 and I['summary']['avg_deficit']==100)
check('today not counted in historical deficits',not i[str(today)]['counted'])
check('no future date',send(p,[{'day':str(today+dt.timedelta(days=1)),'resting_kcal':1200}])[0]==400)
check('no duplicate day in request',send(p,[rows[0],rows[0]])[0]==400)
for value in (0,-1,10001,float('nan'),float('inf')):
    check('invalid calorie rejected '+str(value),send(p,[{'day':str(today),'resting_kcal':value}])[0]==422)
check('wrong time zone rejected',send(p,rows,tz='America/New_York')[0]==409)
check('missing timestamp zone rejected',send(p,rows,now.replace(tzinfo=None))[0]==400)
check('other account empty',not other.get('/api/health/resting')[1]['days'])
other.put('/api/profile',{'resting_source':'apple_health'})
check('other cannot overwrite this user via body',send(other,[{'day':str(today),'resting_kcal':5000}],user_id=p.get('/api/me')[1]['id'])[0]==200 and p.get('/api/food/day')[1]['burned']['bmr']==1300)
p.put('/api/profile',{'tz':'America/Los_Angeles'})
check('time zone change does not reassign totals',not p.get('/api/health/resting')[1]['days'])
p.put('/api/profile',{'tz':'UTC'})
check('own zone restores',p.get('/api/food/day')[1]['burned']['bmr']==1300)
check('switch back',p.put('/api/profile',{'resting_source':'formula'})[0]==200 and p.get('/api/food/day')[1]['burned']['source']=='formula')
check('late upload after disable rejected',send(p,rows)[0]==409)
check('delete health values',p.delete('/api/health/resting')[0]==200 and not p.get('/api/health/resting')[1]['days'])
check('deletion preserves target and workout',p.get('/api/food/day')[1]['goal']['kcal']==1750 and p.get('/api/food/day')[1]['burned']['kcal']==exercise)
other.delete('/api/health/resting')
print(f'resting energy: {ok} passed')
