"""Retired training allowances stay inactive even for existing opted-in profiles."""
import datetime as dt,uuid
from fastapi.testclient import TestClient
from app import db,auth,energy,coach_tools
from app.main import app
uids=[];clients=[]
try:
 for target in (2100,1800):
  login='zz_test_dailygoal_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional target review',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,birth_year,kcal_target,protein_target,weight_kg,nutrition_goal,training_day_targets,training_food_adult_confirmed) VALUES(%s,'UTC',1990,%s,110,80,'fuel_training',true,true)",(uid,target))
  cl=TestClient(app);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients;today=dt.datetime.now(dt.timezone.utc).date()
 with db.connect() as c:
  c.execute("INSERT INTO activities(user_id,sport,name,start_time,moving_s,distance_m,calories,source) VALUES(%s,'run','Fictional long run',%s,6000,16000,1400,'test')",(uids[0],dt.datetime.combine(today,dt.time(1),dt.timezone.utc)))
 def day(client):
  r=client.get('/api/food/day?d='+str(today));assert r.status_code==200,r.text;return r.json()
 assert day(a)['goal']['kcal']==2100 and day(b)['goal']['kcal']==1800
 assert day(a)['goal']['extra']==0 and 'training' not in day(a)
 assert day(a)['burned']['kcal']==1400,'recorded exercise remains available'
 assert a.get('/api/food/training-days').status_code==404
 assert a.put('/api/food/training-days',json={'enabled':True}).status_code in (404,405)
 r=a.put('/api/food/day-goal',json={'day':str(today),'kcal':2400});assert r.status_code==200,r.text
 assert day(a)['goal']['kcal']==2400 and day(a)['goal']['custom']==2400
 assert day(b)['goal']['kcal']==1800,'another account cannot inherit the override'
 with db.connect() as c:
  goals=energy.day_goals(c,uids[0],today-dt.timedelta(days=1),today)
  assert goals[today]['kcal']==2400 and goals[today-dt.timedelta(days=1)]['kcal']==2100
  tool=coach_tools.AccountTools(uids[0]).call('meal_options',{'day':today.isoformat()},connection=c)
  assert tool['remaining']['kcal']==2400
 r=a.put('/api/food/day-goal',json={'day':str(today),'kcal':None});assert r.status_code==200,r.text
 assert day(a)['goal']['kcal']==2100
 assert 'training_day_targets' not in a.get('/api/me').json()
 print('Daily goals: existing opt-in ignored, recorded workouts retained, two-account/manual/clear/batch/tool agreement and retired APIs PASS')
finally:
 for client in clients:client.close()
 with db.connect() as c:
  for uid in uids:c.execute('DELETE FROM users WHERE id=%s',(uid,))
