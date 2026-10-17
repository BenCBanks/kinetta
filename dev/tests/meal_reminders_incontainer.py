"""Fictional reminders, real HTTP/SQL, APNs replaced; never contacts a phone."""
import datetime as dt,json,uuid,os,tempfile,zipfile,secrets
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from zoneinfo import ZoneInfo
import psycopg,httpx
from psycopg import sql
from fastapi.testclient import TestClient
from app import db,auth,meal_reminders as M,notify,api_mydata,apns
from app.main import app
uids=[];clients=[];role='zz_test_mealnudge_'+uuid.uuid4().hex[:8];password=secrets.token_urlsafe(24)
now=dt.datetime.now(dt.timezone.utc);offset=12-now.hour;zone='Etc/GMT'+('+' if offset<0 else '-')+str(abs(offset)) if offset else 'Etc/GMT';local=now.astimezone(ZoneInfo(zone));day=local.date();clock=local.replace(minute=0,second=0,microsecond=0).astimezone(dt.timezone.utc)
try:
 for _ in range(2):
  login='zz_test_mealnudge_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Reminder',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid);c.execute('INSERT INTO profile(user_id,tz) VALUES(%s,%s)',(uid,zone))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';response=cl.post('/api/login',json={'login':login,'password':'green teapot on the hill','app':True});assert response.status_code==200;cl.headers['Authorization']='Bearer '+response.json()['token'];clients.append(cl)
 uid,other=uids;a,b=clients
 for cl,owner in [(a,uid),(b,other)]:
  with db.connect() as c:
   token=c.execute('SELECT token_hash FROM sessions WHERE user_id=%s ORDER BY created DESC LIMIT 1',(owner,)).fetchone()['token_hash']
   c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s)",('f'*63+str(owner%10),owner,token))
  assert not cl.get('/api/food/reminders').json()['enabled']
 assert a.put('/api/food/reminders',json={'enabled':True}).status_code==400
 assert a.put('/api/food/reminders',json={'enabled':1,'confirmed':True}).status_code==422
 with patch.object(apns,'ready',return_value=False):assert a.put('/api/food/reminders',json={'enabled':True,'confirmed':True}).status_code==409
 def food(owner,ago,meal='lunch'):
  on=day-dt.timedelta(days=ago);created=dt.datetime.combine(on,dt.time(12),ZoneInfo(zone))
  with db.connect() as c:c.execute('INSERT INTO food_entries(user_id,day,meal,name,kcal,created) VALUES(%s,%s,%s,%s,300,%s)',(owner,on,meal,'Fictional usual plate',created))
 for ago in [1,2,3]:food(uid,ago)
 with patch.object(apns,'ready',return_value=True):assert a.put('/api/food/reminders',json={'enabled':True,'confirmed':True}).status_code==200
 status=a.get('/api/food/reminders').json();assert status['enabled'] and status['device_ready'];assert next(t for t in status['times'] if t['meal']=='lunch')['time']=='12:00'
 assert not any(t['ready'] for t in b.get('/api/food/reminders').json()['times'])
 sent=[]
 def sender(device,payload):sent.append(payload);return True
 assert M.tick(clock,send=sender)==1 and len(sent)==1 and sent[0]['url']=='/food/describe?meal=lunch'
 assert 'calorie' not in json.dumps(sent).lower() and 'Fictional usual' not in json.dumps(sent) and sent[0]['expires_at']>int(now.timestamp())
 assert M.tick(clock,send=sender)==0 and len(sent)==1
 with db.connect() as c:
  assert not c.execute("SELECT 1 FROM notifications WHERE user_id=%s AND kind='meal_reminder'",(uid,)).fetchone()
  c.execute('DELETE FROM meal_reminder_attempts WHERE user_id=%s',(uid,))
 food(uid,0)
 assert M.tick(clock,send=sender)==0 # a logged meal stays quiet
 with db.connect() as c:c.execute('DELETE FROM food_entries WHERE user_id=%s AND day=%s',(uid,day))
 # Claim uniqueness across two concurrent schedulers.
 with ThreadPoolExecutor(max_workers=2) as pool:assert sum(pool.map(lambda _:M.tick(clock,send=sender),range(2)))==1
 assert len(sent)==2
 assert a.put('/api/food/reminders',json={'enabled':False}).status_code==200
 assert notify.private_meal_push(uid,day,'lunch',{'title':'Test','body':'','url':'/food','badge':0,'tag':'test'},send=sender)==0
 assert M.tick(clock,send=sender)==0
 # Final delivery rechecks account transfer, a newly logged meal and expired claims.
 with db.connect() as c:
  c.execute('UPDATE profile SET food_reminders=true WHERE user_id=%s',(uid,))
  original=c.execute('SELECT token,environment,session_hash FROM native_push_devices WHERE user_id=%s',(uid,)).fetchone()
  foreign=c.execute('SELECT session_hash FROM native_push_devices WHERE user_id=%s',(other,)).fetchone()['session_hash']
  c.execute('UPDATE native_push_devices SET user_id=%s,session_hash=%s WHERE token=%s AND environment=%s',(other,foreign,original['token'],original['environment']))
 payload={'title':'Log lunch?','body':'Open your food chat when it suits you.','url':'/food/describe?meal=lunch','badge':0,'tag':'fictional-reminder','expires_at':1234567890}
 assert notify.private_meal_push(uid,day,'lunch',payload,send=sender)==0
 with db.connect() as c:c.execute('UPDATE native_push_devices SET user_id=%s,session_hash=%s WHERE token=%s AND environment=%s',(uid,original['session_hash'],original['token'],original['environment']))
 food(uid,0)
 assert notify.private_meal_push(uid,day,'lunch',payload,send=sender)==0
 with db.connect() as c:c.execute('DELETE FROM food_entries WHERE user_id=%s AND day=%s',(uid,day));c.execute("UPDATE meal_reminder_attempts SET attempted_at=now()-interval '6 minutes' WHERE user_id=%s",(uid,))
 assert notify.private_meal_push(uid,day,'lunch',payload,send=sender)==0
 # Apple must not queue an optional nudge for the next day when a phone is offline.
 def transport(request):
  assert request.headers['apns-expiration']=='1234567890';return httpx.Response(200)
 with patch.object(apns,'provider_token',return_value='fictional-token'):
  assert apns.deliver({'token':'fictional-device','environment':'sandbox'},payload,transport=httpx.MockTransport(transport))
 assert a.put('/api/food/reminders',json={'enabled':False,'user_id':other}).status_code==422
 assert not any(t['ready'] for t in b.get('/api/food/reminders?user_id='+str(uid)).json()['times'])
 # Missing configuration consumes nothing; stale session and transferred device cannot receive.
 with db.connect() as c:c.execute('DELETE FROM meal_reminder_attempts WHERE user_id=%s',(uid,));c.execute('UPDATE profile SET food_reminders=true WHERE user_id=%s',(uid,));c.execute("UPDATE sessions SET last_seen=now()-interval '1 year' WHERE user_id=%s",(uid,))
 assert M.tick(clock,send=sender)==0
 with patch.object(apns,'ready',return_value=False):assert M.tick(clock)==0
 with db.connect() as c:
  assert not c.execute('SELECT 1 FROM meal_reminder_attempts WHERE user_id=%s',(uid,)).fetchone()
  c.execute('INSERT INTO meal_reminder_attempts(user_id,day,meal) VALUES(%s,%s,%s)',(uid,day,'lunch'))
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uid))
 with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
  rows=reader.execute('SELECT user_id FROM meal_reminder_attempts').fetchall();assert rows and all(r['user_id']==uid for r in rows)
  try:reader.execute('DELETE FROM meal_reminder_attempts')
  except psycopg.errors.InsufficientPrivilege:reader.rollback()
  else:raise AssertionError('Reminder reader could delete')
 with db.connect() as c:
  c.execute('SET LOCAL ROLE fit_coach')
  try:c.execute('SELECT * FROM meal_reminder_attempts')
  except psycopg.errors.InsufficientPrivilege:c.rollback()
  else:raise AssertionError('AI role could read reminder attempts')
 with tempfile.TemporaryDirectory() as folder:
  path=os.path.join(folder,'export.zip');api_mydata._write_export(uid,path)
  with zipfile.ZipFile(path) as z:assert b'user_id' not in z.read('data/meal_reminder_attempts.jsonl')
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=%s',(uid,));assert not c.execute('SELECT 1 FROM meal_reminder_attempts WHERE user_id=%s',(uid,)).fetchone()
 print('Meal reminders HTTP/SQL: off/confirmed/strict/APNs+device gates, own usual history, at-most-once concurrent claims, already-logged/off/missing-config/expired-session silence, private payload/short expiry/no bell, SQL RLS/read-only/coach denial/export/cascade PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
