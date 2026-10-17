"""Own target reads, explicit preferences and conservative plan/exercise accounting."""
import datetime as dt,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,auth,training_food
from app.main import app
uids=[];clients=[]
try:
 for _ in range(2):
  login='zz_test_trainingfood_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Training Food',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid);c.execute("INSERT INTO profile(user_id,tz,birth_year,kcal_target,protein_target,weight_kg,nutrition_goal) VALUES(%s,'UTC',1990,2100,110,80,'maintain')",(uid,))
  cl=TestClient(app);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients;today=dt.datetime.now(dt.timezone.utc).date();uid=uids[0]
 def settings(client=a):
  r=client.get('/api/food/training-days');assert r.status_code==200,r.text;return r.json()
 def day(d=today):
  r=a.get('/api/food/day?d='+str(d));assert r.status_code==200,r.text;return r.json()
 def update(**values):
  with db.connect() as c:c.execute('UPDATE profile SET '+','.join(k+'=%s' for k in values)+' WHERE user_id=%s',(*values.values(),uid))
 def save(body,code=200):
  r=a.put('/api/food/training-days',json=body);assert r.status_code==code,r.text
 assert settings()['reason']=='no_training' and not settings()['enabled']
 with db.connect() as c:
  for d,cal in [(today,1000),(today-dt.timedelta(days=1),2800)]:c.execute("INSERT INTO activities(user_id,sport,name,start_time,moving_s,distance_m,calories,source) VALUES(%s,'run','Fictional long run',%s,6000,16000,%s,'test')",(uid,dt.datetime.combine(d,dt.time(12),dt.timezone.utc),cal))
 s=settings();assert s['eligible'] and not s['enabled'];assert day()['goal']['kcal']==2100
 update(nutrition_goal='fuel_training');s=settings();assert s['enabled'] and s['usual_exercise']==100 and s['extra']==900
 assert day()['goal']['kcal']==3000 and day()['targets']['kcal_target']==2100
 # An accepted check-in already included300kcal/day; don't add it a second time after usual exercise falls.
 update(training_target_average=300,training_target_kcal=2100);assert a.put('/api/food/targets',json={'kcal_target':2100,'protein_target':110}).status_code==200;assert settings()['extra']==700 and day()['goal']['kcal']==2800
 save({'enabled':False});assert day()['goal']['kcal']==2100
 save({'enabled':True});assert day()['goal']['kcal']==2800
 save({'enabled':1},422);save({'enabled':True,'adult_confirmed':1},422)
 assert settings(b)['reason']=='no_training' and not settings(b)['enabled']
 save({'enabled':True,'user_id':uids[1]},422)
 with db.connect() as c:c.execute('INSERT INTO day_goals(user_id,day,kcal) VALUES(%s,%s,1900)',(uid,today))
 assert settings()['kcal']==1900 and day()['goal']['kcal']==1900 and day()['goal']['extra']==0
 with db.connect() as c:c.execute('DELETE FROM day_goals WHERE user_id=%s',(uid,))
 assert day(today-dt.timedelta(days=1))['goal']['kcal']==2100
 update(birth_year=today.year-16,training_food_adult_confirmed=True);save({'enabled':True,'adult_confirmed':True},400);assert not settings()['eligible'] and day()['goal']['kcal']==2100 and not settings()['ranges']
 update(birth_year=None,training_food_adult_confirmed=False);assert not settings()['eligible']
 save({'enabled':True,'adult_confirmed':True});assert settings()['eligible']
 save({'enabled':None,'adult_confirmed':False});assert settings()['override'] is None and not settings()['eligible']
 update(birth_year=1990,nutrition_goal='maintain')
 # Synthetic generator output stands in only for the schedule; real profile/energy/API remain in use.
 plan={'id':-1,'unit':'km'}
 with patch.object(training_food,'planned',return_value=(plan,{'title':'Fictional long plan','type':'long','estimated_kcal':1200,'estimated_minutes':100,'distance_km':15})):
  s=settings();assert s['default_enabled'] and s['extra']==900 and s['kcal']==3000
 with patch.object(training_food,'planned',return_value=(plan,{'title':'Fictional easy plan','type':'easy','estimated_kcal':200,'estimated_minutes':20,'distance_km':2})):
  assert settings()['extra']==700,'recorded1000 vs planned200 uses max, never sums'
 # Actual generated schedule and mark cancellation, with no provider or fabricated workout.
 with db.connect() as c:
  pid=c.execute("INSERT INTO training_plans(user_id,race,level,weeks,runs,long_day,start_day,race_day,unit,start_vol) VALUES(%s,'5k','beginner',8,3,6,%s,%s,'km',10) RETURNING id",(uid,today,today+dt.timedelta(days=55))).fetchone()['id']
  from app import plans
  raw=c.execute('SELECT * FROM training_plans WHERE user_id=%s AND id=%s',(uid,pid)).fetchone()
  workout=next(w for week in plans.build(raw,plans.paces(None)) for w in week['workouts'] if w.get('dist'))
  active,actual=training_food.planned(c,uid,workout['day'],80)
  assert actual['estimated_kcal']==round(80*workout['dist']) and actual['title']==workout['title']
  c.execute('INSERT INTO plan_marks(user_id,plan_id,day,done) VALUES(%s,%s,%s,false)',(uid,pid,workout['day']))
  assert training_food.planned(c,uid,workout['day'],80)[1] is None
  assert training_food.planned(c,uids[1],workout['day'],80)==(None,None)
 # Manual target save explicitly clears the check-in exercise allowance.
 assert a.put('/api/food/targets',json={'kcal_target':2200}).status_code==200
 with db.connect() as c:assert c.execute('SELECT training_target_average,training_target_kcal FROM profile WHERE user_id=%s',(uid,)).fetchone()=={'training_target_average':None,'training_target_kcal':None}
 assert a.get('/api/me').json()['kcal_target']==2200 and a.get('/api/me').json()['protein_target']==110
 print('Training food HTTP/SQL: no training silence, fuel/activeplan defaults and explicit off, recorded/planned max minus usual/accepted-checkin allowance, no implicit profile writes, customday/history, strict inputs/two-owner isolation,18+unknown/minor gates and manual-target allowance reset PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
 for cl in clients:cl.close()
