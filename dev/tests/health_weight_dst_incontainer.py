"""Real SQL/API retry contracts at fixed DST instants; no HealthKit or provider calls."""
import datetime as dt
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo
from fastapi.testclient import TestClient
from app import auth,db,api_health_weights as H
from app.main import app

uid=None
original_connect=db.connect
observed=dt.datetime(2026,11,2,12,tzinfo=dt.timezone.utc)
class Clock(dt.datetime):
    @classmethod
    def now(cls,tz=None):return observed.astimezone(tz) if tz else observed.replace(tzinfo=None)
@contextmanager
def connection():
    with original_connect() as c:
        c.execute("SET LOCAL TIME ZONE 'America/New_York'")
        yield c
try:
    login='zz_test_weight_dst_'+uuid4().hex[:12]
    with original_connect() as c:
        uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional DST sample',auth.hash_pw('green teapot on the hill'))).fetchone()['id']
        c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'America/New_York')",(uid,))
    client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver'
    assert client.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200
    state=client.put('/api/health/weights/preferences',json={'enabled':True,'confirmed':True}).json()
    with patch.object(db,'connect',connection),patch.object(H,'dt',SimpleNamespace(datetime=Clock,timedelta=dt.timedelta,timezone=dt.timezone,time=dt.time)):
        for stamp,fold in [('2026-11-01T05:30:00+00:00',0),('2026-11-01T06:30:00+00:00',1),('2026-11-01T07:30:00+00:00',0)]:
            at=dt.datetime.fromisoformat(stamp);assert at.astimezone(ZoneInfo('America/New_York')).fold==fold
            key=str(uuid4());sample={'sample_id':key,'sampled_at':stamp,'kg':73}
            body={'epoch':state['epoch'],'tz':state['tz'],'observed_at':observed.isoformat(),'samples':[sample]}
            first=client.post('/api/health/weights',json=body);assert first.status_code==200,first.text
            retry=client.post('/api/health/weights',json=body);assert retry.status_code==200,(stamp,retry.status_code,retry.text)
            # An equivalent fixed-offset local timestamp is also the identical measurement.
            local=at.astimezone(ZoneInfo('America/New_York')).isoformat()
            assert client.post('/api/health/weights',json={**body,'samples':[{**sample,'sampled_at':local}]}).status_code==200
            for changed in [{**sample,'sampled_at':(at+dt.timedelta(seconds=1)).isoformat()},{**sample,'kg':74}]:
                assert client.post('/api/health/weights',json={**body,'samples':[changed]}).status_code==409
            with original_connect() as c:
                row=c.execute('SELECT count(*) AS n,min(kg) AS kg FROM health_weight_samples WHERE user_id=%s AND sample_id=%s',(uid,key)).fetchone()
                assert row['n']==1 and row['kg']==73
    print('Health weight DST: both repeated-hour folds and ordinary time replay once; equivalent offsets accepted; changed time/weight rejected PASS')
finally:
    if uid:
        with original_connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
