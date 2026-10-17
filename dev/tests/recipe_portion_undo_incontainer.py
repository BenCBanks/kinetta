"""Undo races against recipe uploads remain owner-bound and cannot resurrect food."""
import uuid
from concurrent.futures import ThreadPoolExecutor
from fastapi.testclient import TestClient
from app import auth,db,api_dishes as D
from app.main import app
uids=[];clients=[];PW='green teapot on the hill'
try:
 for _ in range(2):
  name='zz_test_recipe_undo_'+uuid.uuid4().hex[:10]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(name,'Fictional portion Undo',auth.hash_pw(PW))).fetchone()['id'];uids.append(uid)
   c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
  client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':name,'password':PW}).status_code==200;clients.append(client)
 a,b=clients;uid,other=uids
 d=a.post('/api/dishes',json={'name':'Fictional Undo recipe'}).json();did=d['id'];assert a.patch('/api/dishes/'+str(did),json={'known_kcal':400}).status_code==200
 path=f'/api/dishes/{did}/portion';cancel=path+'/cancel'
 identity=str(uuid.uuid4());body={'client_id':identity,'count':1,'meal':'lunch'}
 assert a.post(cancel,json={'client_id':identity}).json()['removed']==0
 assert a.post(path+'?thread=true',json=body).status_code==409
 identity=str(uuid.uuid4());body={**body,'client_id':identity}
 logged=a.post(path+'?thread=true',json=body);assert logged.status_code==200,logged.text
 entry=logged.json()['entry'];assert b.post(cancel,json={'client_id':identity}).json()['removed']==0
 assert any(e['id']==entry['id'] for e in a.get('/api/food/day').json()['entries'])
 assert a.post(f'/api/dishes/{did+1}/portion/cancel',json={'client_id':identity}).status_code==409
 removed=a.post(cancel,json={'client_id':identity});assert removed.status_code==200 and removed.json()['removed']==1
 assert a.post(cancel,json={'client_id':identity}).json()['removed']==0
 assert a.post(path+'?thread=true',json=body).status_code==409
 assert not a.get('/api/food/day').json()['entries'] and not b.get('/api/food/day').json()['entries']
 # Real shared account lock serializes concurrent original/cancel calls in either order.
 for _ in range(3):
  identity=str(uuid.uuid4());body={**body,'client_id':identity}
  def upload():
   try:return D.portion(did,D.PortionIn(**body),user={'id':uid},thread=True)
   except Exception as e:
    assert getattr(e,'status_code',None)==409;return None
  def undo():return D.cancel_portion(did,D.PortionCancelIn(client_id=identity),user={'id':uid})
  with ThreadPoolExecutor(max_workers=4) as pool:
   results=[pool.submit(fn) for fn in [upload,undo,upload,undo]]
   for result in results:result.result()
  assert not a.get('/api/food/day').json()['entries']
  assert a.post(path+'?thread=true',json=body).status_code==409
 # Undo still works after its recipe was deleted or unshared.
 identity=str(uuid.uuid4());body={**body,'client_id':identity};assert a.post(path+'?thread=true',json=body).status_code==200
 assert a.delete('/api/dishes/'+str(did),headers={'Content-Type':'application/json'}).status_code==200
 assert a.post(cancel,json={'client_id':identity}).json()['removed']==1
 assert a.post(cancel,json={'client_id':identity,'user_id':other}).status_code==422
 print('Recipe portion Undo: queued-before-upload tombstone, sent/repeated Undo, other-owner/wrong-dish guards, concurrent upload/cancel and no resurrection, deleted recipe, strict identity PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
