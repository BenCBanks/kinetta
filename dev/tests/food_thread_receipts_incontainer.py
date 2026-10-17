"""Receipt and food writes share one transaction; no provider is allowed."""
import uuid
import io,json,zipfile
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,meal_chat,food_thread_log as engine
from app.main import app

PW='green teapot on the hill';login='zz_test_receipt_atomic_'+uuid.uuid4().hex[:10]
with db.connect() as c:
 uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(login,'Fictional receipt check',auth.hash_pw(PW))).fetchone()['id']
 c.execute("INSERT INTO profile(user_id,tz) VALUES (%s,'UTC')",(uid,))
client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver'
assert client.post('/api/login',json={'login':login,'password':PW}).status_code==200
try:
 key=str(uuid.uuid4());body=[{'day':'2026-10-16','meal':'lunch','name':'Fictional oats','kcal':200,'client_id':key}]
 with patch('urllib.request.urlopen',side_effect=AssertionError('No providers')),patch('app.food_thread_receipts.create',side_effect=RuntimeError('Fictional receipt failure')):
  assert client.post('/api/food/entries?thread=true',json=body).status_code==500
 with db.connect() as c:
  assert not c.execute('SELECT id FROM food_entries WHERE user_id=%s AND client_id=%s',(uid,key)).fetchone()
  assert not c.execute('SELECT id FROM food_chat_messages WHERE user_id=%s',(uid,)).fetchone()
 d=client.post('/api/dishes',json={'name':'Fictional soup'}).json();did=d['id']
 assert client.patch(f'/api/dishes/{did}',json={'known_kcal':600}).status_code==200
 portion={'count':.5,'day':'2026-10-16','meal':'dinner','client_id':str(uuid.uuid4())}
 with patch('app.food_thread_receipts.create',side_effect=RuntimeError('Fictional recipe receipt failure')):
  assert client.post(f'/api/dishes/{did}/portion?thread=true',json=portion).status_code==500
 with db.connect() as c:assert not c.execute('SELECT id FROM food_entries WHERE user_id=%s',(uid,)).fetchone()
 with patch('urllib.request.urlopen',side_effect=AssertionError('No providers')):
  assert client.post('/api/food/entries?thread=true',json=body).status_code==200
  assert client.post(f'/api/dishes/{did}/portion?thread=true',json=portion).status_code==200
 # A ready preview remains a clarification after its recipe is removed.
 gone=client.post('/api/dishes',json={'name':'Deleted preview source'}).json()['id']
 assert client.patch(f'/api/dishes/{gone}',json={'known_kcal':600}).status_code==200
 pending=client.post('/api/food/thread/messages',json={'client_id':str(uuid.uuid4()),'body':'Deleted preview source'}).json()['message']
 with db.connect() as c:
  resolution=meal_chat.resolve_data(c,uid,meal_chat.ResolveIn(parts=[{'text':'Deleted preview source','pick':{'kind':'dish','id':gone},'portion':{'count':1}}]))
  assert resolution['status']=='ready',resolution
 assert client.delete(f'/api/dishes/{gone}').status_code==200
 with db.connect() as c:
  message=engine.locked_message(c,uid,pending['id']);result=engine.make_result(c,uid,message,resolution)
  assert result['kind']=='needs' and 'removed' in result['text'],result
 export=client.get('/api/account/export');assert export.status_code==200
 with zipfile.ZipFile(io.BytesIO(export.content)) as z:
  messages=[json.loads(line) for line in z.read('data/food_chat_messages.jsonl').splitlines()]
  assert len([m for m in messages if m.get('result',{}).get('receipt')])==2
  assert all('user_id' not in m for m in messages)
 print('Atomic receipts: food/reply failure rolls back food and recipe writes; retry succeeds; no provider calls PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
