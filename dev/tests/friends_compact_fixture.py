"""Fictional friends only; isolated guarded project. No real account or device access."""
import os,sys,subprocess,json
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT'];assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:300])
 return r[1]
clients={}
def actor(login,name):
 c=person(login);ok(c.post('/api/account/delete',{'password':PW}));c=person(login,name);ok(c.put('/api/profile',{'tz':'UTC','ai_ok':False}));clients[login]=c;return c
main={state:actor('zz_test_fc_'+state,'River '+state.title()) for state in ('empty','typical','heavy')}
peers=[actor(f'zz_test_fc_peer{i:02}',f'Fictional Friend {i+1:02}') for i in range(40)]
req=[actor(f'zz_test_fc_request{i}',f'Casey Request {i+1}') for i in range(3)]
out=[actor(f'zz_test_fc_sent{i}',f'Fictional Sent {i+1}') for i in range(2)]
for i,c in enumerate(peers):
 ok(main['heavy'].post('/api/friends',{'login':f'zz_test_fc_peer{i:02}'}));ok(c.post('/api/friends/zz_test_fc_heavy/accept',{}))
ok(main['typical'].post('/api/friends',{'login':'zz_test_fc_peer00'}));ok(peers[0].post('/api/friends/zz_test_fc_typical/accept',{}))
for i,c in enumerate(req):ok(c.post('/api/friends',{'login':'zz_test_fc_heavy'}))
ok(req[0].post('/api/friends',{'login':'zz_test_fc_typical'}))
for state in ['typical','heavy']:
 for i,c in enumerate(out):ok(main[state].post('/api/friends',{'login':f'zz_test_fc_sent{i}'}))
for state,c in main.items():
 r=ok(c.get('/api/friends'));print(state,{k:len(v) for k,v in r.items() if isinstance(v,list)})
print(json.dumps({'states':list(main)}))
