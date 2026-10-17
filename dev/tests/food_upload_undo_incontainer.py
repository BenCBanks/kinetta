"""Real HTTP/SQL upload cancellation, including delayed old-client uploads."""
import datetime as dt,uuid,concurrent.futures
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,auth,food_thread_log
from app.main import app
uids=[];clients=[]
try:
 for _ in range(2):
  login='zz_test_uploadundo_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Undo',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid);c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'UTC')",(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients;day=dt.datetime.now(dt.timezone.utc).date().isoformat()
 def entry(key=None):return {'day':day,'name':'Fictional lunch','kcal':500,'client_id':key or str(uuid.uuid4()),'protein_g':30,'sodium_mg':450,'sugar_g':0}
 def cancel(items,client=a,confirm=True):return client.post('/api/food/entries/undo',json={'client_ids':[e['client_id'] for e in items],'confirm':confirm})
 def add(items,thread=True,client=a):return client.post('/api/food/entries'+('?thread=true' if thread else ''),json=items)
 def rows(client=a):return client.get('/api/food/day?d='+day).json()['entries']
 # A queued request may reach either API version after cancellation.
 e=entry();assert cancel([e]).status_code==200
 for thread in (False,True):assert add([e],thread).status_code==409
 assert not rows()
 # A foreign account's identical upload ID is independent.
 assert add([e],client=b).status_code==200
 assert cancel([e]).status_code==200 and len(rows(b))==1
 # Lost acknowledgement / repeated Undo / partial batches / new intentional log.
 pair=[entry(),entry()];assert add(pair).status_code==200
 assert cancel(pair,confirm=False).status_code==400 and len(rows())==2
 assert cancel(pair,confirm=1).status_code==422
 with patch.object(food_thread_log,'undo',side_effect=RuntimeError('forced rollback')):assert cancel(pair).status_code==500
 assert len(rows())==2
 assert cancel(pair).status_code==200 and not rows();assert cancel(pair).status_code==200
 assert add(pair).status_code==409
 fresh=entry();assert add([fresh],False).status_code==200
 assert cancel([fresh]).status_code==200 and not rows();assert add([fresh],False).status_code==409
 # The shared upload endpoint must not bypass the chat receipt's later-edit guard.
 edited=entry();response=add([edited]);eid=response.json()['ids'][0]
 assert a.patch('/api/food/entries/'+str(eid),json={'sodium_mg':999}).status_code==200
 result=cancel([edited]);assert result.status_code==200 and result.json()['kept']==1 and any(e['id']==eid for e in rows())
 assert a.delete('/api/food/entries/'+str(eid),headers={'Content-Type':'application/json'}).status_code==200
 # Serialized concurrent arrival always leaves no food and a durable tombstone.
 for _ in range(6):
  e=entry()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   upload=pool.submit(add,[e]);undo=pool.submit(cancel,[e]);assert upload.result().status_code in (200,409);assert undo.result().status_code==200
  assert not rows();assert add([e],False).status_code==409
 assert a.post('/api/food/entries/undo',json={'client_ids':['invalid!'],'confirm':True}).status_code==422
 assert a.post('/api/food/entries/undo',json={'client_ids':[],'confirm':True}).status_code==422
 assert a.post('/api/food/entries/undo',json={'client_ids':[str(uuid.uuid4())]*101,'confirm':True}).status_code==422
 assert a.post('/api/food/entries/undo',json={'client_ids':[str(uuid.uuid4())],'confirm':True,'user_id':uids[1]}).status_code==422
 assert len(rows(b))==1
 print('Food upload Undo HTTP/SQL: before-upload/old-client, receipt and legacy, strict confirmation, atomic rollback/replay, concurrent upload/cancel, new identity and two-owner isolation PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
 for cl in clients:cl.close()
