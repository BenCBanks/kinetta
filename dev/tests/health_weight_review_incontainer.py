"""Fictional Health/legacy import regressions; real local transactions, no device/provider."""
import datetime as dt,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,coach,api_connections,api_health_weights as H
from app.main import app
uid=None;now=dt.datetime.now(dt.timezone.utc)
try:
 login='zz_test_weight_review_'+uuid.uuid4().hex[:10]
 with db.connect() as c:
  uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Health review',auth.hash_pw('green teapot on the hill'))).fetchone()['id']
  c.execute('INSERT INTO profile(user_id,tz,ai_ok,health_ai_ok) VALUES(%s,%s,true,true)',(uid,db.DEFAULT_TZ))
 client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200
 def state():return client.get('/api/health/weights').json()
 def pref(on):
  r=client.put('/api/health/weights/preferences',json={'enabled':on,'confirmed':True});assert r.status_code==200,r.text;return r.json()
 def points():return client.get('/api/food/weights?days=3650').json()['points']
 def send(key,at,kg=73):
  p=state();r=client.post('/api/health/weights',json={'epoch':p['epoch'],'tz':p['tz'],'observed_at':now.isoformat(),'samples':[{'sample_id':key,'sampled_at':at.isoformat(),'kg':kg}]});assert r.status_code==200,r.text
 old=state();assert client.put('/api/profile',json={'tz':db.DEFAULT_TZ}).status_code==200;assert state()['epoch']==old['epoch']
 assert client.put('/api/profile',json={'tz':'UTC'}).status_code==200
 pref(True);stamp=dt.datetime.combine(now.date()-dt.timedelta(days=3),dt.time(23,30),dt.timezone.utc);key=str(uuid.uuid4());send(key,stamp)
 assert client.delete('/api/food/weights/'+stamp.date().isoformat(),headers={'Content-Type':'application/json'}).status_code==200
 assert not points()
 assert client.put('/api/profile',json={'tz':'Pacific/Kiritimati'}).status_code==200;send(key,stamp);assert not points(),'deleted sample reappeared after zone change'
 pref(False)
 with patch.object(H,'rebuild',side_effect=AssertionError('Off source must not rebuild')):assert client.put('/api/profile',json={'tz':'UTC'}).status_code==200
 day=(now.date()-dt.timedelta(days=1)).isoformat()
 assert client.put('/api/food/weights',json={'day':day,'kg':80}).status_code==200
 assert client.delete('/api/food/weights/'+day,headers={'Content-Type':'application/json'}).status_code==200
 with db.connect() as c:assert not c.execute('SELECT 1 FROM health_weight_exclusions WHERE user_id=%s AND day=%s',(uid,day)).fetchone()
 pref(True);at=now-dt.timedelta(days=1);newkey=str(uuid.uuid4());send(newkey,at,79)
 # Manual import overwrites provenance cleanly; Undo restores the eligible Health measurement.
 r=client.post('/api/food/history',json={'rows':[{'day':day,'weight_kg':84}]});assert r.status_code==200,r.text
 with db.connect() as c:
  row=c.execute('SELECT source,health_sample_id,source_name FROM weights WHERE user_id=%s AND day=%s',(uid,day)).fetchone();assert row['source']=='import' and row['health_sample_id'] is None and row['source_name'] is None
 assert client.delete('/api/food/history',headers={'Content-Type':'application/json'}).status_code==200
 assert any(p['kg']==79 and p['source']=='healthkit' for p in points())
 # Manual re-entry lifts the day fence, without allowing Health to replace that manual value.
 assert client.delete('/api/food/weights/'+day,headers={'Content-Type':'application/json'}).status_code==200
 assert client.put('/api/food/weights',json={'day':day,'kg':85}).status_code==200
 with db.connect() as c:assert not c.execute('SELECT 1 FROM health_weight_exclusions WHERE user_id=%s AND day=%s',(uid,day)).fetchone()
 # Legacy HAE uses the same source, opt-in and AI consent protections, and respects manual priority.
 payload={'metrics':[{'name':'body_mass','units':'kg','data':[{'date':at.isoformat(),'qty':79}]}]}
 with patch.object(coach,'after_import',return_value=None):result=api_connections._ingest_apple(uid,payload)
 assert result['weights']==1 and any(p['kg']==85 and p['source']=='manual' for p in points())
 with db.connect() as c:
  c.execute('DELETE FROM weights WHERE user_id=%s',(uid,));c.execute('DELETE FROM health_weight_exclusions WHERE user_id=%s',(uid,));c.execute('DELETE FROM health_weight_samples WHERE user_id=%s',(uid,))
 with patch.object(coach,'after_import',return_value=None):api_connections._ingest_apple(uid,payload)
 assert points()[0]['source']=='healthkit' and points()[0]['source_label']=='Apple Health · Health Auto Export'
 with db.connect() as c:assert not coach.health_ok(c,uid)
 # A page for another day does not rewrite the prior day's projected point.
 with db.connect() as c:before=c.execute('SELECT ctid::text AS stamp FROM weights WHERE user_id=%s AND day=%s',(uid,day)).fetchone()['stamp']
 send(str(uuid.uuid4()),now-dt.timedelta(days=2),77)
 with db.connect() as c:assert c.execute('SELECT ctid::text AS stamp FROM weights WHERE user_id=%s AND day=%s',(uid,day)).fetchone()['stamp']==before
 pref(False);assert not points()
 with db.connect() as c:assert coach.health_ok(c,uid)
 with patch.object(coach,'after_import',return_value=None):assert api_connections._ingest_apple(uid,payload)['weights']==0
 assert not points()
 print('Health weight review: effective zone, UUID deletion across timezone, off no-rebuild/no-fence, import provenance/Undo, manual fence lift, legacy HAE opt-in/consent/manual priority, off-source AI and touched-day projection PASS')
finally:
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
