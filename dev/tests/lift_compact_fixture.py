"""Fictional lifting records on this explicitly guarded isolated project only."""
import os,sys,json,datetime as dt,subprocess
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT'];assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:400])
 return r[1]
c=person('zz_test_lift_compact');ok(c.post('/api/account/delete',{'password':PW}));c=person('zz_test_lift_compact','River Lifter');ok(c.put('/api/profile',{'tz':'UTC','ai_ok':False,'units':'imperial'}))
ex=[ok(c.post('/api/lifts/exercises',{'name':name}))['id'] for name in ('Squat','Bench press','Plank','Fictional new exercise')];ok(c.patch('/api/lifts/exercises/'+str(ex[0]),{'note':'Safety pins on 6'}))
now=dt.datetime.now(dt.timezone.utc)
for days,kg in ((5,75),(3,80)):
 aid=ok(c.post('/api/activities/manual',{'sport':'workout','name':'Fictional strength session','start':(now-dt.timedelta(days=days)).isoformat(),'duration_s':2700}))['id']
 ok(c.put(f'/api/activities/{aid}/lifts',{'exercises':[{'exercise_id':ex[0],'sets':[{'kg':40,'reps':8,'warmup':True}]+[{'kg':kg,'reps':5}]*3},{'exercise_id':ex[1],'sets':[{'kg':60,'reps':8}]*3},{'exercise_id':ex[2],'sets':[{'secs':45}]}]}))
aid=ok(c.post('/api/lifts/start',{'copy_from':aid}))['id'];ok(c.put(f'/api/activities/{aid}/lifts',{'exercises':[{'exercise_id':ex[0],'sets':[{'kg':40,'reps':8,'warmup':True,'done':True},{'kg':90,'reps':5,'done':True},{'kg':90,'reps':5,'done':False},{'kg':90,'reps':5,'done':False}]},{'exercise_id':ex[1],'sets':[{'kg':60,'reps':8,'done':False}]*3},{'exercise_id':ex[2],'sets':[{'secs':45,'done':False}]}]}))
data=ok(c.get(f'/api/activities/{aid}/lifts'));assert data['open'] and len(data['exercises'])==3;assert data['exercises'][0]['sets'][1]['pr'];ids={'live':aid,'exercise':ex[0],'new':ex[3]};
if os.environ.get('KINETTA_LIFT_IDS'):Path(os.environ['KINETTA_LIFT_IDS']).write_text(json.dumps(ids))
print('Fictional three-exercise/warmup/record/unfinished/history/empty lifting fixture ready')
print(json.dumps(ids))
