"""Fictional weight-only histories, guarded to the caller's isolated test project."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse
import uuid

sys.path.insert(0,str(Path(__file__).parent))
from kc import person,PW

base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT']
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip()
assert base.port==int(port),'Use the project that owns this test port'
today=dt.datetime.now(dt.timezone.utc).date();now=dt.datetime.now(dt.timezone.utc)
def ok(result):
    assert result[0]==200,(result[0],str(result[1])[:200])
    return result[1]

for state in ('empty','typical','health','actions'):
    login='zz_test_weight_'+state;client=person(login)
    ok(client.post('/api/account/delete',{'password':PW}));client=person(login,'Alex Example')
    ok(client.put('/api/profile',{'tz':'UTC','ai_ok':False,'units':'imperial','setup_hidden':True}))
    if state=='actions':ok(client.put('/api/food/weights',{'day':str(today-dt.timedelta(days=1)),'kg':75}))
    if state=='typical':
        for days,kg in [(30,76),(14,75.5),(1,75.1)]:ok(client.put('/api/food/weights',{'day':str(today-dt.timedelta(days=days)),'kg':kg}))
    if state=='health':
        status=ok(client.put('/api/health/weights/preferences',{'enabled':True,'confirmed':True}))
        samples=[]
        for i in range(365):
            day=today-dt.timedelta(days=365-i)
            samples.append({'sample_id':str(uuid.uuid5(uuid.NAMESPACE_URL,'fictional-weight-progress-'+str(day))),
              'sampled_at':day.isoformat()+'T08:00:00Z','kg':round(80-i*.01+((i%5)-2)*.08,2),'source_name':'Fictional scale','source_bundle':'example.invalid.scale'})
        ok(client.post('/api/health/weights',{'epoch':status['epoch'],'tz':status['tz'],'observed_at':now.isoformat(),'samples':samples}))
        ok(client.put('/api/food/weights',{'day':str(today-dt.timedelta(days=14)),'kg':76.6}))
    me=ok(client.get('/api/me'));history=ok(client.get('/api/food/weights?days=365'))
    assert not me.get('kcal_target') and not me.get('food_user'),'Weight must be visible without food use'
    assert len(history['points'])==(0 if state=='empty' else 3 if state=='typical' else 1 if state=='actions' else 365)
    if state=='health':assert any(p['source']=='healthkit' for p in history['points']) and any(p['source']=='manual' for p in history['points'])
print('Weight-only fictional accounts: empty, three manual points, year of Health plus manual priority; no food/AI/provider/device writes')
