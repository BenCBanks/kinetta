"""Disposable signup checks: controlled mail UI plus one real email-free invitation."""
import json, os, subprocess
from pathlib import Path
from urllib.parse import urlparse
from kc import person, login, ALEX
base=urlparse(os.environ.get('KINETTA_URL','http://localhost:8798'));project=os.environ.get('KINETTA_PROJECT','kinettatest')
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
person('zz_test_username_ui','Casey Example')
friend=person('zz_test_friend_inviter_long496','Jamie Example');status,link=friend.get('/api/friends/link');assert status==200
admin=login(*ALEX);status,invite=admin.post('/api/admin/invites',{});assert status==200
path=invite['path']
assert admin.get('/api/join/'+path.rsplit('/',1)[-1])[1]['email'] is False,'Actual join fixture must not send mail'
fixture={'base':base.geturl().rstrip('/'),'project':project,'invite_path':path,'friend_path':urlparse(link['url']).path,'login':'walkthrough_demo'}
Path(os.environ.get('KINETTA_SIGNUP_FLOW_FIXTURE','/tmp/'+project+'-signup-flow.json')).write_text(json.dumps(fixture))
print('Fictional username UI account and isolated email-free invite ready')
