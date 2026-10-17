"""Fictional Health nutrition change journal, no HealthKit or provider calls."""
import datetime as dt,json,os,secrets,tempfile,uuid,zipfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from app import auth,db,api_mydata,api_health_nutrition as H
from app.main import app
uids=[];clients=[];role='zz_test_healthfood_'+uuid.uuid4().hex[:8];password=secrets.token_urlsafe(24)
try:
 for _ in range(2):
  login='zz_test_healthfood_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Health nutrition',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'America/New_York')",(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients;uid,other=uids
 def preferences(enabled=True,client=a):
  r=client.put('/api/health/nutrition/preferences',json={'enabled':enabled,'confirmed':True});assert r.status_code==200,r.text;return r.json()
 def days(state,after=0,limit=50,client=a,status=200):
  r=client.get('/api/health/nutrition/days',params={'epoch':state['epoch'],'after':after,'limit':limit});assert r.status_code==status,(r.status_code,r.text);return r.json()
 def insert(day='2026-03-08',owner=uid,**values):
  with db.connect() as c:
   r=c.execute('INSERT INTO food_entries(user_id,day,name,kcal,protein_g,carbs_g,fat_g,fiber_g,ref) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id',(owner,day,'Fictional journal plate',values.get('kcal',300),values.get('protein_g',20),values.get('carbs_g',40),values.get('fat_g',10),values.get('fiber_g',5),json.dumps(values.get('ref',{})))).fetchone();return r['id']
 off=a.get('/api/health/nutrition').json();assert not off['enabled'];days(off,status=409)
 entry=insert()
 with db.connect() as c:assert not c.execute('SELECT 1 FROM health_nutrition_days WHERE user_id=%s',(uid,)).fetchone()
 assert a.put('/api/health/nutrition/preferences',json={'enabled':True}).status_code==400
 assert a.put('/api/health/nutrition/preferences',json={'enabled':1,'confirmed':True}).status_code==422
 state=preferences();assert state['epoch']!=off['epoch'] and preferences()['epoch']==state['epoch']
 page=days(state);row=page['days'][0];assert row['day']=='2026-03-08' and row['values']==dict(kcal=300,protein_g=20,carbs_g=40,fat_g=10,fiber_g=5)
 assert row['start']=='2026-03-08T00:00:00-05:00' and row['end']=='2026-03-09T00:00:00-04:00' # 23h local DST day
 assert not row['deleted'] and not page['more'];cursor=page['next'];assert not days(state,cursor)['days']
 # An actual old-client API update queues the changed day; replay returns stable revision.
 assert a.patch('/api/food/entries/'+str(entry),json={'kcal':350}).status_code==200
 page=days(state,cursor);assert page['days'][0]['values']['kcal']==350 and page['next']>cursor
 assert days(state,cursor)==page;cursor=page['next']
 # Unknown calories/macros never become a partial/zero complete-day Health quantity.
 partial=insert(kcal=0,protein_g=0,ref={'unknown_nutrients':['kcal','protein_g']},fiber_g=None)
 row=days(state,cursor)['days'][0];assert row['values']['kcal'] is None and row['values']['protein_g'] is None and row['values']['fiber_g'] is None
 assert row['values']['carbs_g']==80 and row['coverage']['kcal']=={'known':1,'entries':2}
 # Moving a plate journals both dates; an empty old date remains a deletion record.
 with db.connect() as c:c.execute("UPDATE food_entries SET day='2026-03-09' WHERE user_id=%s AND id=ANY(%s)",(uid,[entry,partial]))
 page=days(state,cursor);by={r['day']:r for r in page['days']};assert by['2026-03-08']['deleted'] and all(v is None for v in by['2026-03-08']['values'].values()) and not by['2026-03-09']['deleted'];cursor=page['next']
 # Rollback cannot publish a nutrition change.
 try:
  with db.connect() as c:
   c.execute('DELETE FROM food_entries WHERE user_id=%s',(uid,));raise RuntimeError('Fictional rollback')
 except RuntimeError:pass
 assert not days(state,cursor)['days']
 # The journal read waits for an earlier writer; a cursor cannot skip its commit.
 with ThreadPoolExecutor(max_workers=1) as pool:
  with db.connect() as c:
   c.execute('UPDATE food_entries SET kcal=360 WHERE user_id=%s AND id=%s',(uid,entry))
   future=pool.submit(H.days,uuid.UUID(state['epoch']),cursor,50,{'id':uid})
   import time;time.sleep(.05);assert not future.done()
  result=future.result(timeout=10);assert result['days'] and result['next']>cursor
 # Pagination is bounded and includes deletion-only dates; no data from another person.
 for day in ['2026-03-10','2026-03-11','2026-03-12']:insert(day)
 otherstate=preferences(client=b);insert('2026-03-13',owner=other,kcal=999)
 seen=[];after=0
 while True:
  page=days(state,after,limit=1);seen+=page['days'];after=page['next']
  if not page['more']:break
 assert len(seen)==5 and '2026-03-13' not in [r['day'] for r in seen]
 assert len(days(otherstate,client=b)['days'])==1
 days(otherstate,client=a,status=409)
 assert a.get('/api/health/nutrition/days',params={'epoch':state['epoch'],'after':-1}).status_code==422
 # Off retains the journal; changes while off are included after explicit re-enable,
 # including a day removed while off so native can delete an older Health sample.
 preferences(False);days(state,status=409)
 with db.connect() as c:c.execute('DELETE FROM food_entries WHERE user_id=%s',(uid,))
 state2=preferences();assert state2['epoch']!=state['epoch'];days(state,status=409)
 assert len(days(state2)['days'])==5 and all(r['deleted'] for r in days(state2)['days'])
 assert a.put('/api/profile',json={'tz':'Pacific/Honolulu'}).status_code==200
 days(state2,status=409);state3=a.get('/api/health/nutrition').json();assert state3['epoch']!=state2['epoch']
 assert all(r['start'].endswith('-10:00') for r in days(state3)['days'])
 # Known zero is writable, unlike unknown; only the five expressly requested types.
 insert('2026-03-14',kcal=0,protein_g=0,carbs_g=0,fat_g=0,fiber_g=0)
 row=next(r for r in days(state3)['days'] if r['day']=='2026-03-14');assert all(v==0 for v in row['values'].values()) and len(row['values'])==5
 with db.connect() as c:
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uid))
 with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
  rows=reader.execute('SELECT user_id FROM health_nutrition_days').fetchall();assert rows and all(r['user_id']==uid for r in rows)
  try:reader.execute('DELETE FROM health_nutrition_days')
  except psycopg.errors.InsufficientPrivilege:reader.rollback()
  else:raise AssertionError('Read-only SQL journal deletion')
 with db.connect() as c:
  c.execute('SET LOCAL ROLE fit_coach')
  try:c.execute('SELECT * FROM health_nutrition_days')
  except psycopg.errors.InsufficientPrivilege:c.rollback()
  else:raise AssertionError('Raw output journal accessible to coach')
 with tempfile.TemporaryDirectory() as folder:
  path=os.path.join(folder,'export.zip');api_mydata._write_export(uid,path)
  with zipfile.ZipFile(path) as z:
   rows=[json.loads(x) for x in z.read('data/health_nutrition_days.jsonl').splitlines()];assert rows and all('user_id' not in x for x in rows)
 assert TestClient(app).get('/api/health/nutrition').status_code==401
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=%s',(uid,));assert not c.execute('SELECT 1 FROM health_nutrition_days WHERE user_id=%s',(uid,)).fetchone()
 print('Health nutrition HTTP/SQL: separate confirmed off-default, existing history/updates/moves/deletes/rollback, stable commit-ordered revisions/paging, complete known-zero vs partial unknown5 nutrients, local DST/timezone epochs, off/re-enable deletion recovery, two-owner SQL/RLS/read-only/coach denial/export/cascade PASS')
finally:
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
