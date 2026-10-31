"""Fictional plans and matching activities on an explicitly guarded isolated project."""
import os,sys,subprocess,datetime as dt,json
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ.get('KINETTA_PROJECT','kinettatest')
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:500])
 return r[1]
today=dt.datetime.now(dt.timezone.utc).date();monday=today-dt.timedelta(days=today.weekday());next_monday=monday+dt.timedelta(weeks=1);clients={};shifts=[]
for state in ('empty','future','week3','race','first'):
 c=person('zz_test_plan_compact_'+state);ok(c.post('/api/account/delete',{'password':PW}));c=person('zz_test_plan_compact_'+state,'River '+state.title());ok(c.put('/api/profile',{'tz':'UTC','ai_ok':False}));clients[state]=c
 if state=='empty':continue
 first=state=='first';weeks=9 if first else 10
 p=ok(c.post('/api/plans',{'race':'5k' if first else '10k','level':'first' if first else 'intermediate','weeks':weeks,'runs':3 if first else 4,'long_day':6,'race_day':str(next_monday+dt.timedelta(weeks=weeks-1,days=6))}))
 if state in ('week3','race'):
  start=monday-dt.timedelta(weeks=2 if state=='week3' else weeks-1);uid=ok(c.get('/api/me'))['id'];shifts.append((uid,p['id'],str(start),str(start+dt.timedelta(weeks=weeks-1,days=6))))
script='from app import db\nrows='+repr(shifts)+'''\nwith db.connect() as c:
 for uid,pid,start,race in rows:
  assert c.execute("SELECT login::text FROM users WHERE id=%s",(uid,)).fetchone()['login'].startswith('zz_test_plan_compact_')
  c.execute("UPDATE training_plans SET start_day=%s,race_day=%s,created=%s::date+interval '8 hours' WHERE id=%s AND user_id=%s",(start,race,start,pid,uid))
'''
subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],input=script,text=True,check=True)
for state in ('week3','race'):
 c=clients[state];d=ok(c.get('/api/plans/current'));current=next(w for w in d['weeks'] if w['n']==d['this_week']);selected=[]
 for week in [d['weeks'][0],d['weeks'][1],current]:
  candidates=[w for w in week['workouts'] if w['day']<str(today) and w['type']!='race']
  if candidates:selected.append(candidates[0])
 for i,w in enumerate(selected):
  metres=(w.get('dist') or 3)*(1609.344 if d['plan']['unit']=='mi' else 1000)*1.02
  ok(c.post('/api/activities/manual',{'sport':'run','name':'Fictional completed plan run '+str(i+1),'start':w['day']+'T08:00:00Z','duration_s':2700,'distance_m':metres}))
 d=ok(c.get('/api/plans/current'));current=next(w for w in d['weeks'] if w['n']==d['this_week']);assert any(w['status']=='done' for w in current['workouts']);assert any(w['status']=='missed' for week in d['weeks'] for w in week['workouts'])
 print(state,'week',d['this_week'],'done/missed fixtures ready')
for state in ('empty','future','first'):print(state,'ready')
