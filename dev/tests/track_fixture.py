"""Real fictional accounts in a guarded local test project; no devices/providers."""
import sys,os,subprocess,datetime as dt,uuid
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
from track_fixture_clock import select_plan_day
base=urlparse(os.environ.get('KINETTA_URL','http://localhost:8798'));project=os.environ.get('KINETTA_PROJECT','kinettatest')
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip()
assert base.port==int(port),'URL must reach this isolated project'
# The API evaluates plan status against the live server date. Keep the fictional runner's
# Today plan valid across every weekday and UTC date boundary, including Sunday.
zone,today,long_day=select_plan_day(dt.datetime.now(dt.timezone.utc))
for who in ('empty','runner','lifter'):
 c=person('zz_test_track_'+who);assert c.post('/api/account/delete',{'password':PW})[0]==200;c=person('zz_test_track_'+who,'River '+who.title())
 assert c.put('/api/profile',{'tz':zone,'ai_ok':False})[0]==200
 if who=='runner':
  monday=today-dt.timedelta(days=today.weekday());race=monday+dt.timedelta(weeks=8,days=long_day)
  result=c.post('/api/plans',{'race':'5k','level':'first','weeks':9,'runs':3,'long_day':long_day,'race_day':str(race)})
  assert result[0]==200,result
  preset={'schema':1,'name':'Fictional 3 / 1','description':'','blocks':[{'id':'main','repeat':3,'steps':[{'id':'run','action':'run','role':'effort','title':'','target':{'kind':'time','amount':'3','unit':'min'}},{'id':'walk','action':'walk','role':'recovery','title':'','target':{'kind':'time','amount':'1','unit':'min'}}]}]}
  result=c.put('/api/interval-presets/'+str(uuid.uuid4()),{'mutation_id':str(uuid.uuid4()),'definition':preset})
  assert result[0]==200,result
 print(who,'ready')
