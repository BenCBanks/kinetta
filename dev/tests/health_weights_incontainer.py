"""Real Health-weight contracts; fictional two-person records, no HealthKit/provider access."""
import datetime as dt,io,json,os,secrets,tempfile,uuid,zipfile
from contextlib import contextmanager
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
import psycopg
from psycopg import sql
from app import auth,db,coach,api_mydata,api_health_weights as H
from app.main import app
uids=[];clients=[];role='zz_test_healthweight_reader_'+uuid.uuid4().hex[:8];password=secrets.token_urlsafe(24)
try:
 for _ in range(2):
  login='zz_test_healthweight_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Health weight',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,kcal_target,protein_target,weight_kg,resting_source,ai_ok,health_ai_ok) VALUES(%s,'Pacific/Honolulu',2100,120,75,'apple_health',true,true)",(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients;uid,other=uids;now=dt.datetime.now(dt.timezone.utc);anchor=now-dt.timedelta(days=2);day=anchor.astimezone(dt.timezone(dt.timedelta(hours=-10))).date().isoformat();key=str(uuid.uuid4())
 def prefs(client=a,enabled=True,**extra):
  r=client.put('/api/health/weights/preferences',json={'enabled':enabled,'confirmed':True,**extra});assert r.status_code==200,r.text;return r.json()
 def body(state,samples=None,deleted=None):return {'epoch':state['epoch'],'tz':state['tz'],'observed_at':now.isoformat(),'samples':samples or [],'deleted':deleted or []}
 def sample(identity=key,kg=73,at=anchor):return {'sample_id':identity,'sampled_at':at.isoformat(),'kg':kg,'source_name':'Fictional scale','source_bundle':'example.fictional.scale'}
 def send(payload,client=a,status=200):
  r=client.post('/api/health/weights',json=payload);assert r.status_code==status,(r.status_code,r.text);return r.json() if status!=500 else None
 def points(client=a):return client.get('/api/food/weights?days=3650').json()['points']
 off=a.get('/api/health/weights').json();assert not off['enabled'] and off['samples']==0 and not off['health_weight_ai_ok']
 send(body(off,[sample()]),status=409);assert not points()
 assert a.put('/api/health/weights/preferences',json={'enabled':True}).status_code==400
 assert a.put('/api/health/weights/preferences',json={'enabled':1,'confirmed':True}).status_code==422
 state=prefs();assert state['epoch']!=off['epoch'] and prefs()['epoch']==state['epoch'];send(body(off,[sample()]),status=409)
 sent=send(body(state,[sample()]));assert sent['received']==1 and sent['sample_ids']==[key] and sent['last_sync']
 p=points()[0];assert p['day']==day and p['kg']==73 and p['source']=='healthkit' and p['source_label']=='Apple Health · Fictional scale'
 me=a.get('/api/me').json();assert me['weight_kg']==73 and me['weight_health_derived'] and me['kcal_target']==2100 and me['protein_target']==120 and me['resting_source']=='apple_health'
 assert not points(b)
 send(body(state,[sample()]));assert len(points())==1
 # Concurrent identical pages still produce one point and one raw sample per owner.
 batch=H.Batch.model_validate(body(state,[sample()]));
 with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(lambda _:H.import_weights(batch,{'id':uid}),range(3)))
 assert len(points())==1
 # A Health UUID cannot change its measurement; rollback protects the entire page.
 fresh=str(uuid.uuid4());send(body(state,[sample(fresh,72),sample(kg=80)]),status=409)
 assert len(points())==1 and a.get('/api/health/weights').json()['samples']==1
 # Two samples on the same local day select the latest; another account's UUID is independent.
 later=str(uuid.uuid4());send(body(state,[sample(later,72,anchor+dt.timedelta(minutes=1))]));assert len(points())==1 and points()[0]['kg']==72
 otherstate=prefs(b);send(body(otherstate,[sample(kg=90)]),client=b);assert points(b)[0]['kg']==90 and points()[0]['kg']==72
 # Existing workout/resting consent alone never authorizes newly imported Health weight for AI.
 with db.connect() as c:assert not coach.health_ok(c,uid)
 assert a.put('/api/profile',json={'health_weight_ai_ok':1}).status_code==422
 assert a.put('/api/profile',json={'health_weight_ai_ok':True}).status_code==200
 with db.connect() as c:assert coach.health_ok(c,uid)
 assert a.put('/api/profile',json={'health_ai_ok':False,'health_weight_ai_ok':True}).status_code==200
 with db.connect() as c:assert not coach.health_ok(c,uid)
 assert not a.get('/api/me').json()['health_weight_ai_ok']
 assert a.put('/api/profile',json={'health_weight_ai_ok':True}).status_code==400
 assert a.put('/api/profile',json={'health_ai_ok':True}).status_code==200
 with db.connect() as c:assert not coach.health_ok(c,uid)
 # Manual weigh-in for that day wins, including against replay and later native samples.
 assert a.put('/api/food/weights',json={'day':day,'kg':74,'note':'Fictional manual weigh-in'}).status_code==200
 send(body(state,[sample(later,72,anchor+dt.timedelta(minutes=1))]));p=points()[0];assert p['kg']==74 and p['source']=='manual'
 assert not a.get('/api/me').json()['weight_health_derived']
 # Deleting a manual point prevents old Health observations from silently bringing the day back.
 assert a.delete('/api/food/weights/'+day,headers={'Content-Type':'application/json'}).status_code==200
 send(body(state,[sample()]));assert not points()
 # Health deletion is explicit: empty/denied queries do not wipe data or invent zero.
 newday=now-dt.timedelta(days=1);newkey=str(uuid.uuid4());send(body(state,[sample(newkey,71,newday)]));assert points()[0]['kg']==71
 send(body(state));assert points()[0]['kg']==71
 send(body(state,deleted=[newkey]));assert not points() and a.get('/api/me').json().get('weight_kg') is None
 send(body(state,[sample(newkey,71,newday)]));assert not points(), 'A deleted UUID must stay deleted'
 # Future, repeated, conflicting, unknown identities and settings are bounded/owner protected.
 for payload in [body(state,[sample(at=now+dt.timedelta(days=1))]),body(state,[sample(),sample()]),body(state,[sample()],deleted=[key])]:send(payload,status=400)
 send({**body(state),'tz':'UTC'},status=409);send({**body(state),'user_id':other},status=422)
 assert a.post('/api/health/weights',json=body(state,[{**sample(),'kg':True}])).status_code==422
 assert a.post('/api/health/weights',json=body(state,[{**sample(),'kg':0}])).status_code==422
 # New Health measurements after a user's deletion cutoff remain eligible.
 todaykey=str(uuid.uuid4());send(body(state,[sample(todaykey,70,now)]));assert points()[0]['kg']==70
 disabled=prefs(enabled=False);send(body(state,[sample(todaykey,70,now)]),status=409);assert points()[0]['kg']==70
 state2=prefs();send(body(state,[sample(todaykey,70,now)]),status=409)
 send(body(state2,[sample(todaykey,70,now)]));assert points()[0]['kg']==70
 # A local-zone change fences an old in-flight read; it cannot upload against the new calendar.
 assert a.put('/api/profile',json={'tz':'Asia/Tokyo'}).status_code==200
 send(body(state2,[sample(todaykey,70,now)]),status=409)
 state3=a.get('/api/health/weights').json();assert state3['epoch']!=state2['epoch'] and state3['tz']=='Asia/Tokyo'
 # Forced projection failure rolls back raw samples and state together.
 original=H.rebuild
 with patch.object(H,'rebuild',side_effect=RuntimeError('Fictional projection failure')):send(body(state3,[sample(str(uuid.uuid4()),69,now)]),status=500)
 with db.connect() as c:
  assert not c.execute('SELECT 1 FROM health_weight_samples WHERE user_id=%s AND kg=69',(uid,)).fetchone()
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uid))
 with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
  rows=reader.execute('SELECT user_id FROM health_weight_samples').fetchall();assert rows and all(r['user_id']==uid for r in rows)
  assert reader.execute('SELECT count(*) AS n FROM health_weight_exclusions WHERE user_id=%s',(other,)).fetchone()['n']==0
  try:reader.execute('DELETE FROM health_weight_samples')
  except psycopg.errors.InsufficientPrivilege:reader.rollback()
  else:raise AssertionError('SQL reader could delete Health samples')
 with db.connect() as c:
  c.execute('SET LOCAL ROLE fit_coach')
  try:c.execute('SELECT * FROM health_weight_samples')
  except psycopg.errors.InsufficientPrivilege:c.rollback()
  else:raise AssertionError('AI SQL role could read raw Health weight samples')
 with tempfile.TemporaryDirectory() as folder:
  path=os.path.join(folder,'export.zip');api_mydata._write_export(uid,path)
  with zipfile.ZipFile(path) as z:
   rows=[json.loads(x) for x in z.read('data/health_weight_samples.jsonl').splitlines()];assert rows and all('user_id' not in x for x in rows)
   assert 'data/health_weight_exclusions.jsonl' in z.namelist()
 assert TestClient(app).get('/api/health/weights').status_code==401
 print('Health weight actual HTTP/SQL: off/explicit/read epoch/tz/identity guards, immutable UUID/replay/concurrency, daily dedupe/manual priority/deletion cutoff, Health tombstones vs empty, profile/G inputs/no target or resting change, fresh scoped AI consent, rollback, two-owner RLS/coach denial/export PASS')
finally:
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
