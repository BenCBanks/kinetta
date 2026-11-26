"""Launch plan counterexamples through authenticated APIs on the disposable DB only."""
import datetime as dt
import json
import os
import subprocess
from kc import person,PW

project=os.environ.get('KINETTA_PROJECT','kinettatest')
a=person('zz_test_plan_launch');a.post('/api/account/delete',{'password':PW});a=person('zz_test_plan_launch')
b=person('zz_test_plan_launch_other');b.post('/api/account/delete',{'password':PW});b=person('zz_test_plan_launch_other')
assert a.put('/api/profile',{'tz':'UTC','units':'metric'})[0]==200
today=dt.date.fromisoformat(a.get('/api/plans/options')[1]['today']);monday=today-dt.timedelta(days=today.weekday())
body={'race':'marathon','level':'beginner','weeks':18,'runs':4,'long_day':6}
assert a.post('/api/plans',{**body,'weeks':5})[0]==400
assert a.post('/api/plans',{**body,'race_day':str(today+dt.timedelta(weeks=5))})[0]==400
assert a.post('/api/plans',body)[0]==400,'no logged base must not silently start a marathon'
assert a.get('/api/plans/current')[1]['plan'] is None
# Four consistent weeks: 50km weekly and one 12km run; only this fictional account.
for i in range(1,29):
    if i%7 in (1,2,4,6):
        distance=12000 if i%7==1 else 13000
        code,row=a.post('/api/activities/manual',{'sport':'run','name':'Fictional base run','start':str(today-dt.timedelta(days=i))+'T08:00:00Z','duration_s':distance/2.5,'distance_m':distance})
        assert code==200,(code,row)
# Current shipped clients can carry the last level's run count into a new choice.
for level,runs,expected in [('beginner',6,4),('advanced',3,5)]:
    code,preview=a.post('/api/plans/preview',{'race':'5k','level':level,'weeks':8,'runs':runs,'long_day':6})
    assert code==200,(code,preview)
    assert preview['summary']['runs']==expected,preview
assert a.post('/api/plans',{**body,'break_days':14})[0]==400
status,row=a.post('/api/plans',body);assert status==200,(status,row)
pid=row['id'];cur=a.get('/api/plans/current')[1];assert cur['prescription_version']==2
assert b.get('/api/plans/current')[1]['plan'] is None
before=cur['weeks']
# Deleting source running must not secretly rebuild a frozen prescription or enable new readiness.
for run in a.get('/api/activities?limit=100')[1]:
    if run['name']=='Fictional base run':assert a.delete('/api/activities/'+str(run['id']))[0]==200
now=a.get('/api/plans/current')[1];assert [w['workouts'][0]['title'] if w['workouts'] else '' for w in before]==[w['workouts'][0]['title'] if w['workouts'] else '' for w in now['weeks']]
assert a.post('/api/plans',body)[0]==400
assert a.get('/api/plans/current')[1]['plan']['id']==pid,'failed replacement leaves active plan alone'
# Timed completion: one tiny run cannot complete the session; sufficient moving time can.
first={'race':'5k','level':'first','weeks':8,'runs':6,'long_day':6,'race_day':str(monday+dt.timedelta(weeks=8,days=6))}
code,preview=a.post('/api/plans/preview',first);assert code==200,(code,preview)
assert (preview['summary']['weeks'],preview['summary']['runs'])==(9,3)
status,row=a.post('/api/plans',first);assert status==200,(status,row)
normalized=a.get('/api/plans/current')[1];assert (normalized['plan']['weeks'],normalized['plan']['runs'])==(9,3)
uid=a.get('/api/me')[1]['id'];pid=row['id']
# Shift the frozen schedule, not just its settings. Preserve legacy date-mutation tests separately.
script='''from app import db
import json,datetime as dt
uid,pid='''+repr((uid,pid))+'''
with db.connect() as c:
 p=c.execute("SELECT * FROM training_plans WHERE user_id=%s AND id=%s",(uid,pid)).fetchone()
 s=p['prescription']
 for wk in s['weeks']:
  wk['start']=str(dt.date.fromisoformat(wk['start'])-dt.timedelta(days=14))
  for w in wk['workouts']:w['day']=str(dt.date.fromisoformat(w['day'])-dt.timedelta(days=14))
 c.execute("UPDATE training_plans SET start_day=start_day-14,race_day=race_day-14,created=created-interval '14 days',prescription=%s WHERE user_id=%s AND id=%s",(json.dumps(s),uid,pid))
'''
subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],input=script,text=True,check=True)
cur=a.get('/api/plans/current')[1];w=cur['weeks'][0]['workouts'][0]
code,run=a.post('/api/activities/manual',{'sport':'run','name':'Fictional tiny timed run','start':w['day']+'T08:00:00Z','duration_s':1,'distance_m':1});assert code==200
current=lambda:next(x for wk in a.get('/api/plans/current')[1]['weeks'] for x in wk['workouts'] if x['day']==w['day'])
assert current()['status']!='done'
a.delete('/api/activities/'+str(run['id']))
code,run=a.post('/api/activities/manual',{'sport':'run','name':'Fictional full timed run','start':w['day']+'T08:00:00Z','duration_s':w['duration_s'],'distance_m':1000});assert code==200
assert current()['status']=='done'
assert a.post('/api/plans/current/marks',{'day':w['day'],'done':False})[0]==200
assert current()['status']!='done','explicit manual correction still wins'
assert a.post('/api/account/delete',{'password':PW})[0]==200
assert b.post('/api/account/delete',{'password':PW})[0]==200
print('Launch plan API: unsupported/short dates/readiness/return/snapshot/isolation/timed completion/manual override PASS')
