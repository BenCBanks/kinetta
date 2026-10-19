"""Review regressions: fictional ingredients, real SQL/HTTP, stand-in model only."""
import json,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,api_dishes as D,cook_chat,food_photo,recipe_estimate,recipe_schema
from app.main import app
uid=None
try:
 with db.connect() as c:
  name='zz_test_recipe_regress_'+uuid.uuid4().hex[:10]
  uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(name,'Fictional recipe regressions',auth.hash_pw('green teapot on the hill'))).fetchone()['id']
  c.execute('INSERT INTO profile(user_id,ai_ok) VALUES(%s,true)',(uid,))
 client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver'
 assert client.post('/api/login',json={'login':name,'password':'green teapot on the hill'}).status_code==200
 did=client.post('/api/dishes',json={'name':'Fictional weightless recipe'}).json()['id']
 item={'id':'unweighed','name':'Fictional salad','grams':None,'per100':None,'kcal':200,'protein_g':None,'carbs_g':20,'fat_g':5,'fiber_g':None,'amount':'1 serving salad','source':'ai','ref':{'origin':'ai','origin_notes':'Recipe A note','unknown_nutrients':['protein_g']}}
 source={'import_id':str(uuid.uuid4()),'basis':'published','servings':2,'pending':['a handful of leaves'],'sources':{k:'site' for k in D.NUM},'source_url':'https://recipes.example/fictional'}
 with db.connect() as c:c.execute('UPDATE dishes SET items=%s,recipe_source=%s,known_kcal=400 WHERE user_id=%s AND id=%s',(json.dumps([item]),json.dumps(source),uid,did))
 # Real chat formatting and action application encounter the weightless ingredient.
 action={'actions':[{'op':'change','id':'unweighed','grams':100}],'reply':'Illustrative weight assignment.'}
 with patch.object(cook_chat,'_ai_ready',return_value=True),patch.object(cook_chat,'product_refs',return_value=''),patch.object(food_photo,'ask',return_value=(action,{'usageMetadata':{}},'stand-in')) as ask:
  response=client.post(f'/api/dishes/{did}/say',json={'text':'add 100 g rice'});assert response.status_code==200,response.text
  assert ask.call_count==1 and 'weight unknown' in ask.call_args.args[0][0]['text']
  assert response.json()['by']=='clarification' and response.json()['dish']['items'][0]['grams'] is None,'An add-rice request must not change a different ingredient'
  response=client.post(f'/api/dishes/{did}/say',json={'text':'change fictional salad to 100 g'});assert response.status_code==200,response.text
  assert ask.call_count==2
  changed=response.json()['dish'];assert changed['items'][0]['grams']==100 and changed['items'][0]['kcal']==200
  assert not changed['recipe_source'].get('site_recipe_changed')
 # Remembered AI identity survives, but another recipe's note/unknown flags do not.
 with db.connect() as c:
  memory=cook_chat.memory(c,uid);remembered=cook_chat.from_memory('50 g fictional salad',memory)[0]
  assert remembered['ref']['origin']=='ai' and 'origin_notes' not in remembered['ref'] and 'unknown_nutrients' not in remembered['ref']
 assert D.source_label([remembered])=='estimated_ingredients'
 # Explicitly resolving/dismissing a missing line unlocks ingredient totals.
 assert client.patch(f'/api/dishes/{did}',json={'use_ingredients':True}).json()['totals']['kcal'] is None
 rebuilt=client.patch(f'/api/dishes/{did}',json={'dismiss_pending':['a handful of leaves'],'use_ingredients':True});assert rebuilt.status_code==200,rebuilt.text
 rebuilt=rebuilt.json();assert not rebuilt['recipe_source']['pending'] and rebuilt['totals']['kcal']==200 and rebuilt['totals']['protein_g'] is None
 assert rebuilt['recipe_source']['sources']['kcal']=='estimated_ingredients'
 assert client.post(f'/api/dishes/{did}/portion',json={'count':1,'meal':'lunch'}).status_code==200
 # Same canonical key is used for raw review lines and cleaned review construction.
 for raw in ['  a   handful &amp; leaves  ','<b>a handful</b> of leaves']:
  assert recipe_estimate.key(0,raw)==recipe_estimate.key(0,recipe_schema.text(raw))
 # A legacy pending receipt is completed and undone as the same card.
 from app import food_thread_receipts as receipts,food_thread
 identity=str(uuid.uuid4());entry=client.post(f'/api/dishes/{did}/portion',json={'client_id':identity,'count':1,'meal':'dinner'}).json()['entry']
 with db.connect() as c:
  day=entry['day'];key=receipts.identity(uid,identity)
  root=c.execute("INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state,result) VALUES(%s,%s,'user','Logged fictional recipe',now(),%s,'pending',%s) RETURNING id",(uid,key,day,json.dumps({'receipt':{'client_id':identity,'source':'dish'}}))).fetchone()['id']
 undone=client.post(f'/api/dishes/{did}/portion/cancel',json={'client_id':identity});assert undone.status_code==200,undone.text
 assert undone.json()['removed']==1 and any(m['kind']=='reply' and m['result']['kind']=='undone' for m in undone.json()['messages'])
 assert client.post(f'/api/food/thread/messages/{root}/undo',json={}).status_code==200
 print('Recipe review regressions: weightless real chat formatting/change, preserved nutrition/source, explicit pending dismissal/log, memory identity only, canonical estimate keys, pending-receipt Undo PASS')
finally:
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
