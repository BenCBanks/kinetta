"""Pure safety cases plus real SQL/HTTP weekly decisions. No models/devices."""
import datetime as dt
import io,json,uuid,zipfile,secrets
import psycopg
from psycopg import sql
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from unittest.mock import patch
from fastapi.testclient import TestClient
from psycopg import errors
from app import auth,db,nutrition_checkin as W
from app.main import app
I={'logged_days':14,'weigh_ins':3,'weigh_in_span_days':13,'observed':2400,'bmr':1750,'resting_burn':1750.4,'kg':80,'avg_intake':2200,'trend_kg_per_week':-.18,'expected':2275,'avg_exercise':0}
P={'nutrition_goal':'maintain','goal_pace_percent':0,'kcal_target':2100,'birth_year':1990,'resting_source':'formula'}
assert W.suggestion(I,P,2026)['suggested_kcal']==2400
loss=W.suggestion(I,{**P,'nutrition_goal':'lose_weight','goal_pace_percent':1},2026);assert loss['suggested_kcal']==1760 and loss['floor_applied']
assert W.suggestion(I,{**P,'nutrition_goal':'build_muscle','goal_pace_percent':.25},2026)['suggested_kcal']==2620
for goal in ['maintain','eat_healthier','fuel_training']:assert W.suggestion(I,{**P,'nutrition_goal':goal},2026)['suggested_kcal']==2400
for field,value in [('logged_days',6),('weigh_ins',2),('weigh_in_span_days',9),('observed',None),('observed',-100),('observed',float('nan'))]:assert not W.suggestion({**I,field:value},P,2026)['ready']
assert not W.suggestion(I,{**P,'nutrition_goal':'lose_weight','goal_pace_percent':1.01},2026)['ready']
assert not W.suggestion(I,{**P,'birth_year':2010},2026)['ready']
assert W.suggestion(I,{**P,'nutrition_goal':None},2026)['action']=='goal'
print('Check-in pure cases: maintenance/loss/gain/healthy/fuel, no workouts, sparse/span thresholds, raw resting floor, unsafe pace/minor/nonfinite guards PASS')
PW='green teapot on the hill';uids=[];clients=[];role='zz_test_checkin_reader_'+uuid.uuid4().hex[:8];password=secrets.token_urlsafe(24)
try:
 for i in range(2):
  name='zz_test_checkin_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(name,'Fictional weekly check',auth.hash_pw(PW))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,units,nutrition_goal,goal_pace_percent,kcal_target,protein_target,carbs_target,fat_target,fiber_target,weight_kg,height_cm,birth_year,sex,activity_factor,resting_source) VALUES (%s,'UTC','imperial','maintain',0,2150,120,200,60,25,80,180,1990,'male',1.3,'apple_health')",(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':name,'password':PW}).status_code==200;clients.append(cl)
 a,b=clients;uid,other=uids
 with db.connect() as c:
  today=c.execute("SELECT (now() AT TIME ZONE 'UTC')::date AS day").fetchone()['day']
  for n in range(1,15):c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g) VALUES (%s,%s,'dinner','Fictional full day',2200,120,250,70,25)",(uid,today-dt.timedelta(days=n)))
  c.execute('INSERT INTO day_goals(user_id,day,kcal) VALUES (%s,%s,1900)',(uid,today))
  for n in [14,7,1]:c.execute('INSERT INTO weights(user_id,day,kg) VALUES (%s,%s,80)',(uid,today-dt.timedelta(days=n)))
 def get(client=a):
  r=client.get('/api/food/check-in');assert r.status_code==200,r.text;return r.json()
 def target():return a.get('/api/me').json()['kcal_target']
 with patch('app.coach_chat.answer',side_effect=AssertionError('No AI')),patch('app.food_photo.ask',side_effect=AssertionError('No AI')):
  data=get();row=data['current'];assert row['data']['suggested_kcal']==2200 and row['data']['observed_burn']==2200 and row['data']['avg_exercise']==0
  assert target()==2150 and get()['current']['id']==row['id']
  assert get(b)['current'] is None and get(b)['readiness']['action']=='food'
  path=f'/api/food/check-in/{row["id"]}/accept';body={'baseline':row['baseline'],'confirmed':True}
  assert b.post(path,json=body).status_code==404
  assert a.post(path,json={'baseline':row['baseline'],'confirmed':False}).status_code==400
  assert a.post(path,json={'baseline':row['baseline'],'confirmed':1}).status_code==422
  assert a.post(path,json={**body,'user_id':other}).status_code==422
  # A manual target edit makes the displayed snapshot stale; neither the stale tap nor GET overrides it.
  assert a.put('/api/food/targets',json={'kcal_target':2250,'protein_target':120,'carbs_target':200,'fat_target':60,'fiber_target':25}).status_code==200
  assert a.post(path,json=body).status_code==409 and target()==2250
  fresh=get()['current'];assert fresh['id']==row['id'] and fresh['baseline']!=row['baseline'] and target()==2250
  body={'baseline':fresh['baseline'],'confirmed':True}
  original_connect=db.connect
  class FailDecision:
   def __init__(self,c):self.c=c
   def execute(self,sql_text,*args,**kwargs):
    if str(sql_text).startswith('UPDATE nutrition_checkins SET state'):raise RuntimeError('Fictional decision-write failure')
    return self.c.execute(sql_text,*args,**kwargs)
  @contextmanager
  def failing_connect():
   with original_connect() as c:yield FailDecision(c)
  with patch('app.db.connect',side_effect=failing_connect):assert a.post(path,json=body).status_code==500
  assert target()==2250 and get()['current']['state']=='pending'
  with ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(lambda _:W.act(uid,uuid.UUID(row['id']),'accept',fresh['baseline']),range(6)))
  assert all(r['current']['state']=='accepted' for r in results) and target()==2200
  assert a.get('/api/food/day').json()['goal']['kcal']==1900
  me=a.get('/api/me').json();assert [me[k] for k in ['protein_target','carbs_target','fat_target','fiber_target','resting_source']]==[120,200,60,25,'apple_health']
  # A later manual change remains intact when an old accepted request is replayed.
  assert a.put('/api/food/targets',json={'kcal_target':2300,'protein_target':120,'carbs_target':200,'fat_target':60,'fiber_target':25}).status_code==200
  assert a.post(path,json=body).status_code==200 and target()==2300
  with db.connect() as c:c.execute('UPDATE nutrition_checkins SET week=week-7 WHERE user_id=%s AND id=%s',(uid,row['id']))
  assert a.post(path,json=body).status_code==409
  pending=get()['current'];assert pending['id']!=row['id']
  later=a.post(f'/api/food/check-in/{pending["id"]}/later',json={});assert later.status_code==200 and later.json()['current']['state']=='deferred' and target()==2300
  assert get()['current']['state']=='deferred'
  with db.connect() as c:
   c.execute('UPDATE nutrition_checkins SET week=week-21 WHERE user_id=%s',(uid,))
  renewed=get()['current'];assert renewed['state']=='pending' and renewed['id']!=pending['id']
  # Unknown calorie days cannot supply the seven complete food days needed for a suggestion.
  with db.connect() as c:c.execute("UPDATE food_entries SET ref=%s WHERE user_id=%s AND day<%s",(json.dumps({'unknown_nutrients':['kcal']}),uid,today-dt.timedelta(days=6)))
  no_data=get();assert no_data['current'] is None and not no_data['readiness']['ready']
  assert a.post(f'/api/food/check-in/{renewed["id"]}/accept',json={'baseline':renewed['baseline'],'confirmed':True}).status_code==409 and target()==2300
 with db.connect() as c:
  c.execute("INSERT INTO nutrition_checkins(id,user_id,week,data,baseline) VALUES (%s,%s,%s,'{}',%s)",(uuid.uuid4(),other,today,'a'*64))
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
  c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
  c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uid))
 with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
  rows=reader.execute('SELECT * FROM nutrition_checkins').fetchall();assert len(rows)==3 and all(r['user_id']==uid for r in rows)
  assert reader.execute('SELECT count(*) AS n FROM nutrition_checkins WHERE user_id=%s',(other,)).fetchone()['n']==0
  try:reader.execute('DELETE FROM nutrition_checkins')
  except errors.InsufficientPrivilege:reader.rollback()
  else:raise AssertionError('Read-only SQL login wrote check-ins')
 try:
  with db.coach_connect(uid) as c:c.execute('SELECT * FROM nutrition_checkins')
 except errors.InsufficientPrivilege:pass
 else:raise AssertionError('Unapproved coach tool role could read new check-ins')
 export=a.get('/api/account/export');assert export.status_code==200
 with zipfile.ZipFile(io.BytesIO(export.content)) as z:
  rows=[json.loads(x) for x in z.read('data/nutrition_checkins.jsonl').splitlines()];assert len(rows)==3 and all('user_id' not in r for r in rows)
 print('Weekly API/SQL: no implicit target writes, no watch/workout/AI dependency, owner isolation/RLS/read-only, strict tap, stale re-review, forced decision-write rollback, day override, concurrent Accept/replay, later manual target, macro/Health preservation, defer/new-week/history, unknown-day exclusion/export PASS')
finally:
 with db.connect() as c:
  for uid in uids:c.execute('DELETE FROM users WHERE id=%s',(uid,))
  c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
 with db.connect() as c:assert not c.execute('SELECT id FROM nutrition_checkins WHERE user_id=ANY(%s)',(uids,)).fetchone()
