"""Fictional shared cards on a guarded local test project; no provider/device records."""
import datetime as dt
import json,os,subprocess,sys
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,str(Path(__file__).parent))
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT']
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:200])
 return r[1]
clients={}
for key,name in [('owner','Alex Example'),('viewer','Jordan Example'),('other','Casey Example')]:
 login='zz_test_inline_'+key;c=person(login);ok(c.post('/api/account/delete',{'password':PW}));c=person(login,name);ok(c.put('/api/profile',{'tz':'UTC','ai_ok':False,'setup_hidden':True}));clients[key]=c
owner,viewer,other=clients.values();ok(viewer.post('/api/friends',{'login':'zz_test_inline_owner'}));ok(owner.post('/api/friends/zz_test_inline_viewer/accept'))
now=dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=1);ids={}
for i,key in enumerate(['empty','mixed','selected']):
 aid=ok(owner.post('/api/activities/manual',{'sport':'run','name':'Fictional '+key+' run','start':(now-dt.timedelta(days=i)).isoformat(),'duration_s':1800,'distance_m':5000}))['id'];ids[key]=aid;ok(owner.put(f'/api/activities/{aid}/sharing',{'visibility':'everyone'}))
for actor,kind in [(owner,'cheer'),(viewer,'strong'),(other,'applause')]:ok(actor.post(f'/api/activities/{ids["mixed"]}/reaction',{'kind':kind}))
ok(viewer.post(f'/api/activities/{ids["selected"]}/reaction',{'kind':'cheer'}))
ok(viewer.post(f'/api/activities/{ids["mixed"]}/comments',{'text':'Great effort!'}))
if os.environ.get('KINETTA_REACTION_IDS'):Path(os.environ['KINETTA_REACTION_IDS']).write_text(json.dumps(ids))
print('Three fictional reaction cards: empty, mixed with comment, viewer reaction selected; no real accounts/providers/devices')
