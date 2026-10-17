"""Optional code daily notes and at-most-once AI; isolated fictional accounts only."""
import datetime as dt
import io,json,uuid,zipfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,food_thread_daily as daily,food_thread_kit as kit,ai_budget as budget
from app.main import app
uid=None;PW='green teapot on the hill';now=dt.datetime(2026,10,17,22,30,tzinfo=dt.timezone.utc)
try:
 name='zz_test_daily_'+uuid.uuid4().hex[:10]
 with db.connect() as c:
  uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(name,'Fictional daily notes',auth.hash_pw(PW))).fetchone()['id']
  c.execute("INSERT INTO profile(user_id,tz,ai_ok,kcal_target,protein_target,weight_kg,height_cm,birth_year,sex) VALUES (%s,'UTC',true,2100,120,75,175,1990,'male')",(uid,))
 client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':name,'password':PW}).status_code==200
 def pref(value):
  r=client.put('/api/food/thread/preferences',json={'daily_note':value});assert r.status_code==200;return r.json()
 assert client.get('/api/food/thread/preferences').json()['daily_note']=='off'
 assert client.post('/api/food/thread/daily-note',json={}).status_code==409
 for bad in [None,'daily',True,{'user_id':uid}]:assert client.put('/api/food/thread/preferences',json={'daily_note':bad}).status_code==422
 pref('code')
 with patch('app.coach_chat.answer',side_effect=AssertionError('Code note cannot call AI')),patch('urllib.request.urlopen',side_effect=AssertionError('No providers')):
  with ThreadPoolExecutor(max_workers=4) as pool:results=list(pool.map(lambda _:daily.create(uid,now=now),range(4)))
  roots=[next(m for m in r['messages'] if m['kind']=='user') for r in results];mid=roots[0]['id'];assert {m['id'] for m in roots}=={mid}
  reply=next(m for m in results[0]['messages'] if m['kind']=='reply');assert 'No food is logged' in reply['body'] and reply['result']['daily_note']
  assert roots[0]['result']['daily_note'] is True
  assert client.post(f'/api/food/thread/messages/{mid}/kit',json={}).status_code==409
 with db.connect() as c:
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES (%s,'2026-10-18','Fictional low day',100,5)",(uid,))
 nextday=now+dt.timedelta(days=1)
 result=daily.create(uid,now=nextday);low=next(m for m in result['messages'] if m['kind']=='reply');assert 'low or incomplete' in low['body'] and 'kept a record' not in low['body']
 with db.connect() as c:c.execute("UPDATE food_entries SET kcal=2000,protein_g=120 WHERE user_id=%s AND day='2026-10-18'",(uid,))
 refreshed=daily.create(uid,now=nextday);updated=next(m for m in refreshed['messages'] if m['kind']=='reply')
 assert updated['id']==low['id'] and 'low or incomplete' not in updated['body'] and '2,000' in updated['body']
 # Unknown nutrient flags never become a zero total; numbers tone omits the warm lead.
 with db.connect() as c:
  c.execute("UPDATE profile SET food_chat_tone='numbers' WHERE user_id=%s",(uid,))
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES (%s,'2026-10-19','Fictional unknown bowl',1800,0,%s)",(uid,json.dumps({'unknown_nutrients':['protein_g']})))
 unknown=daily.create(uid,now=now+dt.timedelta(days=2));text=next(m['body'] for m in unknown['messages'] if m['kind']=='reply');assert 'protein is incomplete' in text and '0 g protein' not in text and 'One idea:' in text
 pref('ai');calls=[]
 def reserved():
  rid=budget.reserve('gemini-3.1-flash-lite','test daily',{'contents':[]})
  budget.release_failed(rid,503);budget.finish(rid)
 def failure(*args,**kwargs):reserved();calls.append(1);raise ValueError('Fictional failed provider')
 with patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=failure):
  first=kit.generate(uid,mid);again=kit.generate(uid,mid);assert len(calls)==1
  assert next(m for m in first['messages'] if m['kind']=='reply')['result']['kit_error']
 pref('off');pref('ai')
 with patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=AssertionError('No second attempt after toggle')):kit.generate(uid,mid)
 # A process crash consumes this day's attempt too; expired leases recover to code, never another paid call.
 with db.connect() as c:
  reply=c.execute('SELECT id,result FROM food_chat_messages WHERE user_id=%s AND reply_to=%s',(uid,mid)).fetchone();r=reply['result'];r['kit_processing']=True
  c.execute('UPDATE food_chat_messages SET result=%s WHERE id=%s AND user_id=%s',(json.dumps(r),reply['id'],uid))
  c.execute("UPDATE food_chat_jobs SET state='running',expires=now()-interval '1 minute' WHERE user_id=%s AND message_id=%s",(uid,mid))
 with patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=AssertionError('No expired-lease retry')):
  result=kit.generate(uid,mid);assert not next(m for m in result['messages'] if m['kind']=='reply')['result']['kit_processing']
 # Older notes cannot bypass the current local day's durable one-attempt cap.
 other=next(m['id'] for m in unknown['messages'] if m['kind']=='user')
 with patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=lambda *a,**k:reserved()):
  capped=client.post(f'/api/food/thread/messages/{other}/kit',json={});assert capped.status_code==200
  assert 'already attempted today' in next(m['result'] for m in capped.json()['messages'] if m['kind']=='reply')['kit_error']
 # Simulate the next local day for the revocation scenario without waiting.
 with db.connect() as c:c.execute("DELETE FROM ai_daily_usage WHERE user_id=%s AND kind='food_daily_local'",(uid,))
 # Turning off daily Kit while a requested answer runs drops its late result.
 other=next(m['id'] for m in unknown['messages'] if m['kind']=='user')
 def revoked(*args,**kwargs):reserved();pref('off');return {'interpretation':'Illustrative food answer.','facts':[],'selection':None,'limitations':[]}
 with patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=revoked):
  stopped=kit.generate(uid,other);r=next(m['result'] for m in stopped['messages'] if m['kind']=='reply');assert not r.get('kit') and r['kit_error']
 pref('ai')
 assert client.delete(f'/api/food/thread/messages/{mid}',headers={'Content-Type':'application/json'}).status_code==200
 assert daily.create(uid,now=now)['deleted']
 # Local-day identity follows the profile zone and survives repeated opens.
 with db.connect() as c:c.execute("UPDATE profile SET tz='Pacific/Kiritimati' WHERE user_id=%s",(uid,))
 local=daily.create(uid,now=now+dt.timedelta(days=3));root=next(m for m in local['messages'] if m['kind']=='user');assert root['local_day'].isoformat()=='2026-10-21'
 export=client.get('/api/account/export');assert export.status_code==200
 with zipfile.ZipFile(io.BytesIO(export.content)) as z:
  profile=json.loads(z.read('data/profile.jsonl').splitlines()[0]);assert profile['food_chat_daily_note']=='ai'
  rows=[json.loads(x) for x in z.read('data/food_chat_messages.jsonl').splitlines()];assert any((r.get('result') or {}).get('daily_note') for r in rows)
 print('Daily notes: off default, validation, concurrent one/day code note/no AI, empty/low/unknown/numbers tone, one failed AI attempt/day, toggle/crash guards, local-day identity, delete tombstone, export PASS')
finally:
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
  with db.connect() as c:assert not c.execute('SELECT id FROM food_chat_messages WHERE user_id=%s',(uid,)).fetchone()
