"""Reviewed recipe saves and portions, real transactions/HTTP, no providers."""
import json,uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,recipe_fetch as F,recipe_import as R
from app.main import app
PW='green teapot on the hill';uids=[];clients=[]
URL='https://recipes.example/fictional-stew'
base={'@type':'Recipe','name':'Fictional stew','recipeYield':'6 servings','recipeIngredient':['200 g fictional beans','a handful of fictional leaves'],'nutrition':{'calories':'210 kcal','proteinContent':'12 g'}}
def page(value,recipe=base):return {'url':value,'html':'<script type="application/ld+json">'+json.dumps(recipe)+'</script>'}
try:
 for _ in range(2):
  login='zz_test_recipe_review_'+uuid.uuid4().hex[:10]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional recipe review',auth.hash_pw(PW))).fetchone()['id'];uids.append(uid)
   c.execute('INSERT INTO profile(user_id,tz) VALUES(%s,\'UTC\')',(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':PW}).status_code==200;clients.append(cl)
 a,b=clients;uid,other=uids
 food=a.post('/api/food/foods',json={'name':'Fictional beans','serving_g':100,'kcal':200,'protein_g':10,'carbs_g':25,'fat_g':3,'fiber_g':6}).json()['id']
 def draft(recipe=base):
  identity=str(uuid.uuid4())
  with patch.object(F,'fetch',side_effect=lambda url:page(url,recipe)):
   response=a.post('/api/recipe-links/read',json={'url':URL,'client_id':identity});assert response.status_code==200,response.text
   assert response.json()['state']=='ready',response.text
  return '/api/recipe-links/'+identity
 def review(path,**changes):
  body={'candidate':0,'name':'Fictional reviewed stew','servings':6,'lines':base['recipeIngredient'],'basis':'published',**changes}
  result=a.post(path+'/review',json=body);assert result.status_code==200,result.text
  return result.json()
 def count():
  with db.connect() as c:return c.execute('SELECT count(*) AS n FROM dishes WHERE user_id=%s',(uid,)).fetchone()['n']
 path=draft();r=review(path)
 assert r['totals']['kcal']==1260 and r['per_serving']['kcal']==210 and r['totals']['protein_g']==72
 assert r['totals']['fat_g'] is None and r['sources']['fat_g']=='unknown' and len(r['pending'])==1
 assert count()==0 and not a.get('/api/food/day').json()['entries']
 body={'baseline':r['baseline'],'confirmed':True}
 assert b.post(path+'/save',json=body).status_code==404
 assert a.post(path+'/save',json={**body,'confirmed':False}).status_code==400
 assert a.post(path+'/save',json={**body,'confirmed':1}).status_code==422
 assert a.post(path+'/save',json={**body,'user_id':other}).status_code==422
 original=db.connect
 class FailSave:
  def __init__(self,c):self.c=c
  def execute(self,query,*args,**kwargs):
   if str(query).startswith("UPDATE recipe_link_drafts SET state='saved'"):raise RuntimeError('Fictional atomic failure')
   return self.c.execute(query,*args,**kwargs)
 @contextmanager
 def broken():
  with original() as c:yield FailSave(c)
 with patch.object(db,'connect',side_effect=broken):assert a.post(path+'/save',json=body).status_code==500
 assert count()==0 and a.get(path).json()['state']=='ready'
 with ThreadPoolExecutor(max_workers=4) as pool:responses=list(pool.map(lambda _:R.save(uuid.UUID(path.rsplit('/',1)[1]),R.SaveIn(**body),user={'id':uid}),range(4)))
 assert len({x['dish']['id'] for x in responses})==1 and count()==1
 d=responses[0]['dish'];did=d['id'];assert d['servings']==6 and d['serving_count']==6 and d['per_serving']['kcal']==210 and d['weight_g'] is None
 assert d['totals']['fat_g'] is None and d['recipe_source']['sources']['kcal']=='site'
 with db.connect() as c:
  row=c.execute('SELECT data FROM recipe_link_drafts WHERE user_id=%s AND id=%s',(uid,path.rsplit('/',1)[1])).fetchone()['data']
  assert set(row)=={'saved_baseline'}
 assert a.post(path+'/save',json=body).json()['replayed']
 assert b.get('/api/dishes/'+str(did)).status_code==404
 portion=a.post(f'/api/dishes/{did}/portion?thread=true',json={'count':1,'meal':'dinner','client_id':str(uuid.uuid4())});assert portion.status_code==200,portion.text
 entry=portion.json()['entry'];assert entry['kcal']==210 and entry['protein_g']==12
 assert 'fat_g' in entry['ref']['unknown_nutrients'] and entry['ref']['recipe_source']['source_url']==URL
 assert a.get('/api/food/day').json()['unknown_nutrients']['fat_g']==1
 assert not b.get('/api/food/day').json()['entries']
 # Existing conversational recipe selection uses the same one-of-six amount and preserves unknowns.
 result=a.post('/api/food/meals-chat/resolve',json={'say':'1 fictional reviewed stew'});assert result.status_code==200,result.text
 ready=result.json()['items'][0];assert ready['totals']['kcal']==210 and ready['totals']['fat_g'] is None,result.text
 # An explicit full cooked weight enables accurate grams without using partial ingredient weights.
 assert a.patch('/api/dishes/'+str(did),json={'cooked_g':1200}).status_code==200
 weighed=a.post(f'/api/dishes/{did}/portion',json={'grams':200,'meal':'lunch'});assert weighed.json()['entry']['kcal']==210
 # Saved replay never overwrites later edits; deleted saved recipe cannot be resurrected by retry.
 assert a.patch('/api/dishes/'+str(did),json={'name':'Fictional later name','known_kcal':1800}).status_code==200
 replay=a.post(path+'/save',json=body).json()['dish'];assert replay['name']=='Fictional later name' and replay['recipe_source']['edited']
 assert a.delete('/api/dishes/'+str(did),headers={'Content-Type':'application/json'}).status_code==200
 assert a.post(path+'/save',json=body).status_code==410 and count()==0
 # Ingredient-only review sums the full matched recipe and detects changed source foods at Save.
 path=draft({**base,'nutrition':{}});r=review(path,servings=2,lines=['100 g fictional beans'],basis='ingredients')
 assert r['totals']['kcal']==200 and r['per_serving']['kcal']==100 and r['per_serving']['fiber_g']==3 and not r['pending']
 with db.connect() as c:c.execute('UPDATE custom_foods SET kcal=240 WHERE user_id=%s AND id=%s',(uid,food))
 assert a.post(path+'/save',json={'baseline':r['baseline'],'confirmed':True}).status_code==409 and count()==0
 r=review(path,servings=2,lines=['100 g fictional beans'],basis='ingredients')
 saved=a.post(path+'/save',json={'baseline':r['baseline'],'confirmed':True});assert saved.status_code==200,saved.text
 assert saved.json()['dish']['per_serving']['kcal']==120 and saved.json()['dish']['per_serving']['fiber_g']==3
 # Explicit entered values retain missing vs zero; absent published values can use complete matched ingredients.
 path=draft();r=review(path,servings=2,lines=['100 g fictional beans'])
 assert r['site_recipe_changed'] and r['per_serving']['kcal']==210 and r['sources']['kcal']=='site' and r['per_serving']['fiber_g']==3 and r['sources']['fiber_g']=='ingredients'
 r=review(path,servings=2,basis='entered',values={'kcal':300,'fat_g':0})
 assert r['per_serving']['kcal']==300 and r['per_serving']['fat_g']==0 and r['per_serving']['protein_g'] is None and r['sources']['kcal']=='entered'
 for change in [{'servings':0},{'servings':float('inf')},{'candidate':8},{'lines':['']},{'values':{'kcal':-1}}]:
  payload={**r['input'],**change}
  if change.get('servings')==float('inf'):continue # JSON transport itself rejects nonfinite numbers; model checked below.
  assert a.post(path+'/review',json=payload).status_code==422
 from app.recipe_review import ReviewIn
 try:ReviewIn.model_validate({**r['input'],'servings':float('inf')})
 except ValueError:pass
 else:raise AssertionError('Nonfinite servings accepted')
 # Unknown calories remain an unloggable saved draft, never a zero-calorie food.
 path=draft({**base,'nutrition':{}});r=review(path,basis='ingredients')
 saved=a.post(path+'/save',json={'baseline':r['baseline'],'confirmed':True}).json()['dish'];assert saved['totals']['kcal'] is None
 assert a.post('/api/dishes/'+str(saved['id'])+'/portion',json={'count':1,'meal':'dinner'}).status_code==400
 # A calorie-only four-serving recipe logs unknown protein, never a zero reading.
 path=draft({**base,'nutrition':{'calories':'240 kcal'}})
 r=review(path,servings=4,basis='published')
 unknown=a.post(path+'/save',json={'baseline':r['baseline'],'confirmed':True}).json()['dish']
 assert unknown['servings']==4 and unknown['per_serving']['kcal']==240
 logged=a.post(f"/api/dishes/{unknown['id']}/portion",json={'count':1,'meal':'dinner'});assert logged.status_code==200,logged.text
 assert 'protein_g' in logged.json()['entry']['ref']['unknown_nutrients']
 day=a.get('/api/food/day').json();assert day['unknown_nutrients']['protein_g']>=1
 insights=a.get('/api/food/insights').json();assert insights['rows'][-1]['protein_g'] is None
 from app import food_thread_facts as facts,energy
 with db.connect() as c:
  today=energy.context(c,uid)['today'];snapshot=facts.snapshot(c,uid,today)
  assert any(facts._missing(e,'protein_g') for e in snapshot['day']['entries'])
 # Old recipes still treat one serving as the whole meal.
 old=a.post('/api/dishes',json={'name':'Fictional ordinary meal'}).json()
 a.patch('/api/dishes/'+str(old['id']),json={'known_kcal':400,'known_fiber_g':8})
 logged=a.post('/api/dishes/'+str(old['id'])+'/portion',json={'count':2,'meal':'breakfast'}).json()['entry'];assert logged['kcal']==800 and logged['fiber_g']==16
 print('Recipe review/save: published/matched/entered sources, partial unknown/zero/fiber, explicit tap, atomic rollback/concurrent retry, stale source second tap, multi-serving/weight/conversation portion, no cross-account log, deletion tombstone, ordinary recipe compatibility PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
