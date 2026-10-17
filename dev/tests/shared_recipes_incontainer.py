"""Deliberate shared recipe discovery, private portions and revocation with stand-in push only."""
import datetime as dt,json,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,notify,api_dishes as D
from app.main import app
uids=[];clients=[];logins=[]
try:
 for _ in range(3):
  login='zz_test_shared_recipe_'+uuid.uuid4().hex[:12];logins.append(login)
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional recipe friend',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,kcal_target) VALUES(%s,'UTC',2100)",(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b,stranger=clients;owner,recipient,other=uids
 def post(client,path,body):
  r=client.post(path,json=body);assert r.status_code==200,(path,r.status_code,r.text);return r.json()
 assert post(a,'/api/friends',{'login':logins[1]}) is not None
 post(b,'/api/friends/'+logins[0]+'/accept',{})
 post(stranger,'/api/friends',{'login':logins[0]}) # Pending is not approved.
 dish=post(a,'/api/dishes',{'name':'Fictional shared bean stew'});did=dish['id']
 r=a.patch('/api/dishes/'+str(did),json={'known_kcal':1200,'known_protein_g':60,'known_sodium_mg':1800,'known_sugar_g':0,'known_saturated_fat_g':6,'cooked_g':1200});assert r.status_code==200,r.text
 assert b.get('/api/dishes/shared').json()==[] and stranger.get('/api/dishes/shared').json()==[]
 assert a.post(f'/api/dishes/{did}/share',json={'login':logins[2]}).status_code==404
 assert b.post(f'/api/dishes/{did}/share',json={'login':logins[2]}).status_code==404
 with patch.object(notify,'_push_later',return_value=None),patch.object(D,'MAX_SHARES',1):
  shared=post(a,f'/api/dishes/{did}/share',{'login':logins[1]});assert len(shared['shared_with'])==1
  post(a,f'/api/dishes/{did}/share',{'login':logins[1]}) # Retry at the cap succeeds once.
 rows=b.get('/api/dishes/shared').json();assert len(rows)==1 and rows[0]['id']==did and not rows[0]['mine'] and rows[0]['owner']['login']==logins[0]
 assert 'items' not in rows[0] and 'review' not in rows[0] and 'user_id' not in rows[0]
 assert stranger.get('/api/dishes/'+str(did)).status_code==404 and not stranger.get('/api/dishes/shared').json()
 notes=b.get('/api/notifications').json();assert len(notes['items'])==1 and notes['items'][0]['kind']=='dish_shared';nid=notes['items'][0]['id']
 with db.connect() as c:
  session=auth.new_session(c,recipient,'zz_test_recipe_notice')
  c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s)",(uuid.uuid4().hex*2,recipient,auth.token_hash(session)))
 sent=[];assert b.put('/api/notifications/settings',json={'dishes':False}).status_code==200
 assert notify.push(nid,send=lambda d,p:sent.append(p))==0 and not sent
 assert b.put('/api/notifications/settings',json={'dishes':True}).status_code==200
 assert notify.push(nid,send=lambda d,p:sent.append(p))==1 and sent[0]['url']==f'/food/cook/{did}'
 # A stale/forged notice naming a recipe owned by somebody else grants nothing.
 with db.connect() as c:forged=c.execute("INSERT INTO notifications(user_id,kind,actor_id,dish_id) VALUES(%s,'dish_shared',%s,%s) RETURNING id",(owner,recipient,did)).fetchone()['id']
 assert notify.push(forged,send=lambda *_:(_ for _ in ()).throw(AssertionError('Forged notice push'))) is None
 assert all(n['id']!=forged for n in a.get('/api/notifications').json()['items'])
 # Recipe visibility never grants access to either person's private food log.
 own=post(a,f'/api/dishes/{did}/portion',{'share':.5,'meal':'dinner','client_id':str(uuid.uuid4())})
 key=str(uuid.uuid4());portion=post(b,f'/api/dishes/{did}/portion?thread=true',{'grams':300,'meal':'lunch','client_id':key})
 assert portion['entry']['kcal']==300 and portion['entry']['sodium_mg']==450 and portion['entry']['sugar_g']==0
 assert len(b.get('/api/food/day').json()['entries'])==1 and len(a.get('/api/food/day').json()['entries'])==1 and not stranger.get('/api/food/day').json()['entries']
 assert b.patch('/api/food/entries/'+str(own['entry']['id']),json={'amount':2}).status_code==404
 assert b.patch('/api/dishes/'+str(did),json={'known_kcal':1}).status_code==404
 assert b.post(f'/api/dishes/{did}/items',json={'name':'Foreign edit','grams':100,'kcal':100}).status_code==404
 # Blocking hides stale shares and notices even if an old accepted friendship remains.
 with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(recipient,owner))
 assert not b.get('/api/dishes/shared').json() and b.get('/api/dishes/'+str(did)).status_code==404
 assert not b.get('/api/notifications').json()['items'] and b.get('/api/notifications/count').json()['unread']==0
 assert notify.push(nid,send=lambda *_:(_ for _ in ()).throw(AssertionError('Revoked push'))) is None
 with db.connect() as c:c.execute('DELETE FROM blocks WHERE user_id=%s AND blocked=%s',(recipient,owner))
 # Stop sharing revokes discovery, direct reads/new logs and queued notices; own already logged portions remain.
 r=a.delete(f'/api/dishes/{did}/share/'+logins[1],headers={'Content-Type':'application/json'});assert r.status_code==200,r.text
 assert not b.get('/api/dishes/shared').json() and b.get('/api/dishes/'+str(did)).status_code==404
 assert b.post(f'/api/dishes/{did}/portion',json={'count':1,'meal':'snacks'}).status_code==404
 assert not b.get('/api/notifications').json()['items'] and notify.push(nid,send=lambda *_:None) is None
 assert len(b.get('/api/food/day').json()['entries'])==1
 post(b,f'/api/dishes/{did}/portion/cancel',{'client_id':key});assert not b.get('/api/food/day').json()['entries']
 assert TestClient(app).get('/api/dishes/shared').status_code==401
 # A legacy owner split is used by the recipient; both log private quarter-pot portions.
 pot=post(a,'/api/dishes',{'name':'Fictional quarter-pot recipe'})['id']
 assert a.patch('/api/dishes/'+str(pot),json={'known_kcal':2000}).status_code==200
 own=post(a,f'/api/dishes/{pot}/portion',{'share':.25,'of':4,'meal':'dinner'})
 with db.connect() as c:c.execute('UPDATE dishes SET items=%s WHERE id=%s AND user_id=%s',(json.dumps([{'id':'safe','name':'Fictional beans','grams':100,'kcal':200,'source':'ai','ref':{'origin_notes':'PRIVATE OWNER SOURCE NOTE'},'key':'private memory'}]),pot,owner))
 with patch.object(notify,'_push_later',return_value=None):post(a,f'/api/dishes/{pot}/share',{'login':logins[1]})
 seen=b.get('/api/dishes/'+str(pot)).json();assert seen['serving_count']==4 and seen['per_serving']['kcal']==500
 assert 'ref' not in seen['items'][0] and 'PRIVATE OWNER' not in json.dumps(b.get('/api/dishes').json())
 assert a.get('/api/dishes/'+str(pot)).json()['items'][0]['ref']['origin_notes']=='PRIVATE OWNER SOURCE NOTE'
 plate=post(b,f'/api/dishes/{pot}/portion',{'count':1,'meal':'dinner'})
 assert own['entry']['kcal']==500 and plate['entry']['kcal']==500
 assert a.delete(f'/api/dishes/{pot}/share/{logins[1]}',headers={'Content-Type':'application/json'}).status_code==200
 assert b.get('/api/dishes/'+str(pot)).status_code==404
 assert any(e['id']==plate['entry']['id'] for e in b.get('/api/food/day').json()['entries'])
 print('Shared recipes actual HTTP/SQL: explicit approved-friend sharing only, compact discovery, private portions/8nutrients, replay at cap, recipient cannot edit, opt-in stand-in push, block/revoke/notifications/Undo and3-owner isolation PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
