"""Recipe unknown/photo adapters, stand-in estimator only; no paid models or photos retained."""
import json,threading,uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,recipe_fetch as F,recipe_import as R,food_photo
from app.main import app
PW='green teapot on the hill';uids=[];clients=[]
URL='https://recipes.example/fictional-pots'
RECIPE={'@type':'Recipe','name':'Fictional pots','recipeYield':'2 servings','recipeIngredient':['100 g fictional beans','  a   handful of fictional leaves &amp; herbs  '],'nutrition':{'calories':'300 kcal'}}
EST={'items':[{'name':'Fictional leaves','amount':'1 handful','grams':30,'kcal':50,'protein_g':2,'carbs_g':8,'fat_g':1,'fiber_g':3}],'notes':'Assumed one 30 g handful.','model':'stand-in'}
try:
 for _ in range(2):
  login='zz_test_recipe_est_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional recipe estimate',auth.hash_pw(PW))).fetchone()['id'];uids.append(uid)
   c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':PW}).status_code==200;clients.append(cl)
 a,b=clients;uid,other=uids
 assert a.post('/api/food/foods',json={'name':'Fictional beans','kcal':200,'serving_g':100,'protein_g':10,'carbs_g':25,'fat_g':3,'fiber_g':6}).status_code==200
 def draft():
  identity=str(uuid.uuid4())
  with patch.object(F,'fetch',return_value={'url':URL,'html':'<script type="application/ld+json">'+json.dumps(RECIPE)+'</script>'}):
   result=a.post('/api/recipe-links/read',json={'url':URL,'client_id':identity});assert result.json()['state']=='ready',result.text
  return '/api/recipe-links/'+identity
 def review(path,**extra):
  body={'candidate':0,'name':'Fictional pots','servings':2,'lines':RECIPE['recipeIngredient'],'basis':'published',**extra}
  r=a.post(path+'/review',json=body);assert r.status_code==200,r.text;return r.json()
 path=draft();old=review(path)
 body={'candidate':0,'index':1,'confirmed':True,'client_id':str(uuid.uuid4())}
 with patch.object(food_photo,'estimate',return_value=EST) as estimate:
  assert a.post(path+'/estimate',json={**body,'confirmed':False}).status_code==400
  assert b.post(path+'/estimate',json=body).status_code==404
  assert a.post(path+'/estimate',json={**body,'index':0}).status_code==409
  assert estimate.call_count==0
  with db.connect() as c:c.execute('UPDATE profile SET ai_ok=false WHERE user_id=%s',(uid,))
  assert a.post(path+'/estimate',json=body).status_code==403 and estimate.call_count==0
  with db.connect() as c:c.execute('UPDATE profile SET ai_ok = true, ai_adult_at = now() WHERE user_id=%s',(uid,))
  result=a.post(path+'/estimate',json=body);assert result.status_code==200,result.text
  assert estimate.call_count==1 and estimate.call_args.args[0].note==__import__('app.recipe_schema',fromlist=['text']).text(RECIPE['recipeIngredient'][1])
  assert estimate.call_args.args[0].image is None and not estimate.call_args.args[0].images
  assert a.post(path+'/estimate',json=body).json()['replayed'] and estimate.call_count==1
 updated=review(path);assert updated['per_serving']['kcal']==300 and updated['sources']['kcal']=='site'
 assert updated['per_serving']['protein_g']==6 and updated['sources']['protein_g']=='estimated_ingredients' and not updated['pending']
 assert updated['matching'][1]['entries'][0]['ref']['origin_notes']=='Assumed one 30 g handful.'
 assert a.post(path+'/save',json={'baseline':old['baseline'],'confirmed':True}).status_code==409
 saved=a.post(path+'/save',json={'baseline':updated['baseline'],'confirmed':True});assert saved.status_code==200,saved.text
 d=saved.json()['dish'];assert d['per_serving']['kcal']==300 and d['recipe_source']['sources']['protein_g']=='estimated_ingredients'
 # Reusing a prior cooked AI ingredient retains its recorded origin, without another model call.
 prior=a.post('/api/dishes',json={'name':'Fictional prior estimated meal'}).json()['id']
 assert a.post(f'/api/dishes/{prior}/items',json={'name':'Fictional prior cooked grain','grams':100,'per100':{'kcal':200,'protein_g':10,'carbs_g':20,'fat_g':5,'fiber_g':3},'source':'ai'}).status_code==200
 path=draft();remembered=review(path,lines=['50 g fictional prior cooked grain'],servings=1,basis='ingredients')
 assert remembered['totals']['kcal']==100 and remembered['sources']['kcal']=='estimated_ingredients' and remembered['items'][0]['ref']['origin']=='ai'
 # Pending cancellation and revocation drop late provider results.
 for revoke in [False,True]:
  path=draft();review(path);started=threading.Event();release=threading.Event();request={**body,'client_id':str(uuid.uuid4())}
  def slow(*args,**kwargs):started.set();assert release.wait(5);return EST
  with patch.object(food_photo,'estimate',side_effect=slow),ThreadPoolExecutor(max_workers=1) as pool:
   work=pool.submit(a.post,path+'/estimate',json=request);assert started.wait(3)
   assert a.post(path+'/estimate',json=request).json()['processing']
   if revoke:
    with db.connect() as c:c.execute('UPDATE profile SET ai_ok=false WHERE user_id=%s',(uid,))
   else:assert a.delete(path,headers={'Content-Type':'application/json'}).status_code==200
   release.set();result=work.result();assert result.status_code==(403 if revoke else 200),result.text
   if not revoke:assert result.json()['cancelled']
  with db.connect() as c:
   row=c.execute('SELECT data FROM recipe_link_drafts WHERE user_id=%s AND id=%s',(uid,path.rsplit('/',1)[1])).fetchone();assert not row['data'].get('estimates')
   c.execute('UPDATE profile SET ai_ok = true, ai_adult_at = now() WHERE user_id=%s',(uid,))
 # Reuse the real estimator validation adapter; only its transport is a stand-in.
 identity=str(uuid.uuid4());photo={'client_id':identity,'image':'data:image/jpeg;base64,/9j/2Q=='}
 model={'items':[{'name':'Fictional screenshot beans','amount':'100 g','grams':100,'kcal':200,'protein_g':10,'carbs_g':25,'fat_g':3,'fiber_g':6}],'notes':'Illustrative screenshot result; no actual OCR.'}
 with patch.object(food_photo,'ask',return_value=(model,{'usageMetadata':{}},'stand-in')) as ask:
  result=a.post('/api/recipe-links/photo',json=photo);assert result.status_code==200 and result.json()['state']=='ready',result.text
  assert ask.call_count==1 and a.post('/api/recipe-links/photo',json=photo).json()['id']==identity and ask.call_count==1
  assert a.post('/api/recipe-links/photo',json={**photo,'note':'A different screenshot request'}).status_code==409 and ask.call_count==1
 photo_path='/api/recipe-links/'+identity
 assert b.get(photo_path).status_code==404
 candidate=result.json()['candidates'][0];assert candidate['source_url'] is None and candidate['servings'] is None
 reviewed=a.post(photo_path+'/review',json={'candidate':0,'name':'Fictional screenshot recipe','servings':2,'lines':candidate['ingredients'],'basis':'ingredients'});assert reviewed.status_code==200,reviewed.text
 r=reviewed.json();assert r['per_serving']['kcal']==100 and r['sources']['kcal']=='estimated_ingredients'
 assert a.post(photo_path+'/save',json={'baseline':r['baseline'],'confirmed':True}).status_code==200
 with db.connect() as c:
  rows=c.execute('SELECT data::text AS text FROM recipe_link_drafts WHERE user_id=%s',(uid,)).fetchall();assert all('/9j/2Q==' not in row['text'] and 'data:image' not in row['text'] for row in rows)
  assert not c.execute('SELECT 1 FROM food_entries WHERE user_id=ANY(%s)',(uids,)).fetchone()
 # Weighing an imported count-only ingredient preserves its known nutrition; Undo can restore it unweighted.
 d=a.get('/api/dishes/'+str(d['id'])).json();item=d['items'][1]
 assert a.patch(f"/api/dishes/{d['id']}/items/{item['id']}",json={'grams':40}).status_code==200
 # A count-only imported ingredient can be removed/undone and then assigned its first weight without inventing a rescale.
 unknown=a.post('/api/dishes/'+str(d['id'])+'/items',json={'name':'Fictional unweighed spoon','grams':None,'kcal':100,'protein_g':None,'fat_g':0}).json()
 item=unknown['items'][-1];assert item['grams'] is None and item['kcal']==100 and item['protein_g'] is None
 assert a.delete(f"/api/dishes/{d['id']}/items/{item['id']}",headers={'Content-Type':'application/json'}).status_code==200
 restored=a.post('/api/dishes/'+str(d['id'])+'/items',json={k:item.get(k) for k in ('name','grams','per100','kcal','protein_g','carbs_g','fat_g','fiber_g','source','ref')});assert restored.status_code==200,restored.text
 item=restored.json()['items'][-1]
 weighed=a.patch(f"/api/dishes/{d['id']}/items/{item['id']}",json={'grams':40});assert weighed.status_code==200,weighed.text
 weighed=weighed.json()['items'][-1];assert weighed['kcal']==100 and weighed['per100']['kcal']==250 and weighed['protein_g'] is None
 # User-entered totals and explicit Use ingredients keep labels honest.
 changed=a.patch('/api/dishes/'+str(d['id']),json={'known_kcal':800,'known_fiber_g':0}).json();assert changed['recipe_source']['sources']['kcal']=='entered' and changed['totals']['fiber_g']==0
 rebuilt=a.patch('/api/dishes/'+str(d['id']),json={'use_ingredients':True});assert rebuilt.status_code==200,rebuilt.text
 rebuilt=rebuilt.json();assert rebuilt['recipe_source']['sources']['kcal']=='estimated_ingredients' and rebuilt['totals']['protein_g'] is None and rebuilt['recipe_source']['sources']['protein_g']=='unknown'
 print('Recipe AI/photo adapters: explicit consent/unknown-only input, known/site preservation, one-attempt replay/concurrency, cancel/revoke late guards, strict existing photo transport, held AI screenshot/portion labels, no images or food logs, manual source labels PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
