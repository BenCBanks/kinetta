"""Real authenticated two-person weekly food review, local-day boundary and no AI."""
import datetime as dt,json,types,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,nutrition_insights as I,food_photo
from app.main import app
uids=[];clients=[]
class Clock:
 @classmethod
 def now(cls,tz=None):return dt.datetime(2026,10,17,2,tzinfo=dt.timezone.utc).astimezone(tz or dt.timezone.utc)
try:
 for tz in ['Pacific/Honolulu','Asia/Tokyo']:
  login='zz_test_weekly_food_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional weekly food log',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid)
   c.execute('INSERT INTO profile(user_id,tz,ai_ok,ai_adult_at) VALUES(%s,%s,false,now())',(uid,tz))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients;uid,other=uids
 with db.connect() as c:
  for owner,day,name,cal,protein,fiber,sodium,sugar,sat,ref in [
   (uid,'2026-10-09','Fictional earliest beans',300,10,4,300,0,1,None),
   (uid,'2026-10-15','Fictional latest bowl',500,20,None,None,None,None,None),
   (uid,'2026-10-15','Fictional partial label',200,0,0,0,0,0,{'unknown_nutrients':['protein_g']}),
   (uid,'2026-10-16','Fictional current day excluded',999,90,20,900,90,50,None),
   (uid,'2026-10-08','Fictional too old excluded',999,90,20,900,90,50,None),
   (other,'2026-10-16','Fictional other local yesterday',800,80,10,800,20,5,None)]:
   c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,ref) VALUES(%s,%s,'dinner',%s,%s,%s,%s,%s,%s,%s,%s)",(owner,day,name,cal,protein,fiber,sodium,sugar,sat,json.dumps(ref)))
 with patch.object(I,'dt',types.SimpleNamespace(datetime=Clock,timedelta=dt.timedelta)),patch.object(food_photo,'ask',side_effect=AssertionError('No model in weekly review')):
  r=a.get('/api/food/weekly-review');assert r.status_code==200,r.text;v=r.json();assert v['start']=='2026-10-09' and v['end']=='2026-10-15' and v['days_logged']==2 and v['entries']==3,v
  assert v['nutrients']['protein_g']['recorded']==30 and v['nutrients']['protein_g']['unknown_count']==1
  assert v['nutrients']['sugar_g']['recorded']==0 and v['nutrients']['sodium_mg']['unknown_count']==1
  assert v['top_foods'][0]['name']=='Fictional latest bowl' and all('excluded' not in f['name'] for f in v['top_foods'])
  other_review=b.get('/api/food/weekly-review').json();assert other_review['end']=='2026-10-16' and other_review['days_logged']==1 and other_review['top_foods'][0]['name']=='Fictional other local yesterday'
  assert 'other local' not in r.text and len(v['suggestions'])<=2
  assert a.get('/api/food/weekly-review?user_id='+str(other)).json()==v
  assert TestClient(app).get('/api/food/weekly-review').status_code==401
 with db.connect() as c:
  assert not c.execute('SELECT 1 FROM food_chat_messages WHERE user_id=ANY(%s)',(uids,)).fetchone()
  assert not c.execute('SELECT 1 FROM ai_food_attempts WHERE user_id=ANY(%s)',(uids,)).fetchone()
 print('Weekly review actual HTTP/SQL: own local-day boundaries, earliest/last/today exclusions, two owners/ignored user_id, no AI/consent/watch/writes, source coverage/zero/missing and top foods PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
