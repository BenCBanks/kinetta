"""Actual own-data reads with local-midnight and existing energy-source rules."""
import datetime as dt,uuid
from fastapi.testclient import TestClient
from app import db,auth,api_food
from unittest.mock import patch
from app.main import app
uids=[];clients=[]
try:
 for _ in range(2):
  login='zz_test_activityfood_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Week',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid);c.execute("INSERT INTO profile(user_id,tz,kcal_target,protein_target,weight_kg) VALUES(%s,'America/Los_Angeles',2000,100,80)",(uid,))
  cl=TestClient(app);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients
 with db.connect() as c:
  today=c.execute("SELECT (now() AT TIME ZONE 'America/Los_Angeles')::date AS d").fetchone()['d'];y=today-dt.timedelta(days=1)
  for day,protein in [(y,110),(y-dt.timedelta(days=1),0),(today,300)]:
   c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,ref) VALUES(%s,%s,'lunch','Fictional plate',500,%s,%s)",(uids[0],day,protein,'{"unknown_nutrients":["protein_g"]}' if protein==0 else '{}'))
  ids=[]
  for day,cal,distance in [(today,540,10000),(y,300,5000),(today-dt.timedelta(days=7),None,3000),(today-dt.timedelta(days=8),999,99999)]:
   ids.append(c.execute("INSERT INTO activities(user_id,sport,name,start_time,moving_s,distance_m,calories,source) VALUES(%s,'run','Fictional run',(%s::date+time '12:00') AT TIME ZONE 'America/Los_Angeles',1800,%s,%s,'test') RETURNING id",(uids[0],day,distance,cal)).fetchone()['id'])
 with patch.object(api_food,'day_data',side_effect=AssertionError('Summary must not load complete food day')):r=a.get('/api/activity-food')
 assert r.status_code==200,r.text;s=r.json();w=s['week'];assert w['workouts']==2 and w['distance_m']==8000 and w['seconds']==3600 and w['days_logged']==2 and w['protein_days_reached']==1 and w['protein_days_unknown']==1,w
 with db.connect() as c:c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES(%s,%s,'Fictional unknown side',0,0,'{\"unknown_nutrients\":[\"protein_g\"]}')",(uids[0],y))
 mixed=a.get('/api/activity-food').json()['week'];assert mixed['protein_days_reached']==1 and mixed['protein_days_unknown']==1
 assert s['today']['items'][0]['id']==ids[0] and s['today']['exercise_kcal']==540
 assert a.get('/api/food/day').json()['burned']['kcal']==s['today']['exercise_kcal'];before=a.get('/api/me').json()['kcal_target']
 foreign=b.get('/api/activity-food?user_id='+str(uids[0])).json();assert foreign['week']['workouts']==0 and foreign['week']['days_logged']==0 and not foreign['today']['items']
 with db.connect() as c:c.execute('INSERT INTO day_energy(user_id,day,burned_kcal) VALUES(%s,%s,2700)',(uids[0],today))
 t=a.get('/api/activity-food').json()['today'];assert t['burn_source']=='imported' and t['day_burn']==2700 and not t['included_in_day_burn']
 with db.connect() as c:c.execute("UPDATE profile SET resting_source='apple_health' WHERE user_id=%s",(uids[0],))
 t=a.get('/api/activity-food').json()['today'];assert t['day_burn'] is None and t['exercise_kcal']==540 and t['burn_source']=='apple_health'
 with db.connect() as c:c.execute("INSERT INTO health_resting(user_id,day,tz,resting_kcal,observed_at) VALUES(%s,%s,'America/Los_Angeles',1200,now())",(uids[0],today))
 t=a.get('/api/activity-food').json()['today'];assert t['day_burn']==1740 and t['exercise_kcal']==540
 assert a.get('/api/me').json()['kcal_target']==before
 print('Combined activity-food actual HTTP/SQL: own local7completed days, unknown protein, today540samefoodlog, otherowner/queryignored, imported total precedence/watch resting1200+activity540 exactlyonce/missing resting and independent unchanged target PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
 for cl in clients:cl.close()
