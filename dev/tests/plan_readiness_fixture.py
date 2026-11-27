"""Fictional readiness accounts in the disposable test project only."""
import datetime as dt
import os
from urllib.parse import urlparse
from kc import person,PW
assert urlparse(os.environ['KINETTA_URL']).hostname in ('localhost','127.0.0.1')
assert os.environ['KINETTA_PROJECT'].startswith('kt-') or os.environ['KINETTA_PROJECT']=='kinettatest'
for state in ('base','empty'):
    c=person('zz_test_plan_ready_'+state);c.post('/api/account/delete',{'password':PW});c=person('zz_test_plan_ready_'+state,'River Runner')
    assert c.put('/api/profile',{'tz':'UTC','ai_ok':False})[0]==200
    assert c.put('/api/profile',{'units':'metric'})[0]==200
    today=dt.date.fromisoformat(c.get('/api/plans/options')[1]['today'])
    if state=='base':
        for i in range(1,29):
            if i%7 in (1,2,4,6):
                assert c.post('/api/activities/manual',{'sport':'run','name':'Fictional easy run','start':str(today-dt.timedelta(days=i))+'T08:00:00Z','duration_s':5200,'distance_m':13000})[0]==200
print('Readiness fictional fixtures ready')
