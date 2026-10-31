"""Fictional guide accounts on a matching throwaway project; no activity/food/provider data is needed."""
import sys,os,subprocess,json
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT']
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
for state in ('new','typical','heavy'):
 c=person('zz_test_explore_'+state);assert c.post('/api/account/delete',{'password':PW})[0]==200;c=person('zz_test_explore_'+state,'Fictional '+state.title());assert c.put('/api/profile',{'ai_ok':False,'tz':'UTC'})[0]==200
print('Fictional new / typical / heavy guide-use accounts ready (no personal-history claims)')
