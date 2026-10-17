"""Eight nutrient recipe/thread round trips against real private transactions; no model/provider calls."""
import datetime as dt,json,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,nutrients as N,recipe_fetch as F,food_thread_sources as S,cook_chat
from app.main import app
uids=[];clients=[];PW='green teapot on the hill'
try:
 for _ in range(2):
  login='zz_test_pipeline_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional nutrient pipeline',auth.hash_pw(PW))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'UTC')",(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':PW}).status_code==200;clients.append(cl)
 a,b=clients;uid,other=uids;day=dt.datetime.now(dt.timezone.utc).date().isoformat()
 def post(path,body):
  r=a.post(path,json=body);assert r.status_code==200,(path,r.status_code,r.text);return r.json()
 def values(row,expected):assert [row.get(k) for k in N.EXTRA]==expected,row
 def entry(eid):
  with db.connect() as c:return c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=%s',(uid,eid)).fetchone()
 # Recipe ingredients and whole-recipe overrides carry milligrams separately from grams.
 did=post('/api/dishes',{'name':'Fictional salted stew'})['id']
 d=post(f'/api/dishes/{did}/items',{'name':'Fictional beans','grams':200,'per100':{'kcal':200,'protein_g':10,'carbs_g':25,'fat_g':3,'fiber_g':6,'sodium_mg':450,'sugar_g':0,'saturated_fat_g':1.25}})
 values(d['totals'],[900,0,2.5]);values(d['per_100g'],[450,0,1.25])
 portion=post(f'/api/dishes/{did}/portion?thread=true',{'share':.5,'meal':'lunch','client_id':str(uuid.uuid4())})
 values(portion['entry'],[450,0,1.25]);eid=portion['entry']['id'];values(entry(eid),[450,0,1.25])
 assert not b.get('/api/food/day').json()['entries'] and b.get('/api/dishes/'+str(did)).status_code==404
 # The legacy explicit chat uses identical arithmetic and retry identities.
 resolved=post('/api/food/meals-chat/resolve',{'say':'100 g fictional salted stew'})
 item=resolved['items'][0];values(item['totals'],[450,0,1.25])
 body={'items':[{k:item[k] for k in ('kind','id','portion','expected')}],'issued':resolved['issued'],'client_id':resolved['client_id'],'day':day,'meal':'dinner','confirm':True}
 logged=post('/api/food/meals-chat/confirm',body);values(entry(logged['ids'][0]),[450,0,1.25]);assert post('/api/food/meals-chat/confirm',body)['replayed']
 # Unknown macros in a calories-only recipe stay marked unknown through SQL's legacy non-null columns.
 bare=post('/api/dishes',{'name':'Fictional calories only'})['id']
 r=a.patch('/api/dishes/'+str(bare),json={'known_kcal':400});assert r.status_code==200,r.text
 assert r.json()['totals']['fat_g'] is None
 r=post(f'/api/dishes/{bare}/portion?thread=true',{'count':1,'meal':'snacks','client_id':str(uuid.uuid4())})
 assert set(N.ALL)-{'kcal'}<=set(r['entry']['ref']['unknown_nutrients']);values(r['entry'],[None,None,None])
 # Existing schema estimates contain only five nutrients: extras remain unknown, not fabricated zero.
 estimate={'items':[{'name':'Fictional estimated soup','kcal':200,'protein_g':10,'carbs_g':20,'fat_g':5,'fiber_g':2,'grams':200}]}
 draft=S.model_drafts(estimate)[0];values(draft['food'],[None,None,None])
 ai_item=cook_chat._ai_item({'name':'Fictional soup','grams':200,'kcal':200,'protein_g':10,'carbs_g':20,'fat_g':5});values(ai_item['per100'],[None,None,None])
 # Catalog materialization and learning keep reported zero and tiny amounts.
 catalog={'source':'off','id':'1234567890123','name':'Fictional labelled soup','per100':{'kcal':100,'protein_g':5,'carbs_g':10,'fat_g':2,'fiber_g':1,'sodium_mg':450,'sugar_g':0,'saturated_fat_g':.0123},'serving':{'g':200,'label':'1 bowl'}}
 catalog_draft=S.catalog_draft(catalog,{'grams':100});values(catalog_draft['food'],[450,0,.0123])
 from app import food_thread_compose as C
 with db.connect() as c:
  fid,entries=C._custom(c,uid,catalog_draft);values(entries[0],[450,0,.0123])
  learned=c.execute('SELECT * FROM custom_foods WHERE user_id=%s AND id=%s',(uid,fid)).fetchone();values(learned,[450,0,.0123])
 # Thread logging, current-row correction, replay and Undo preserve every value.
 def send(text):
  r=a.post('/api/food/thread/messages',json={'body':text,'client_id':str(uuid.uuid4())});assert r.status_code==201,r.text
  message=r.json()['message'];return message,post(f"/api/food/thread/messages/{message['id']}/process",{})
 own=post('/api/food/foods',{'name':'Fictional ocean rice','serving_g':200,'kcal':300,'protein_g':5,'sodium_mg':800,'sugar_g':0,'saturated_fat_g':2})
 root,r=send('200 g fictional ocean rice')
 with db.connect() as c:
  row=c.execute("SELECT * FROM food_entries WHERE user_id=%s AND name='Fictional ocean rice'",(uid,)).fetchone();rice=row['id'];values(row,[800,0,2])
 correction,r=send('only half the fictional ocean rice');values(entry(rice),[400,0,1])
 post(f"/api/food/thread/messages/{correction['id']}/process",{});values(entry(rice),[400,0,1])
 undone=post(f"/api/food/thread/messages/{root['id']}/undo",{});assert undone['kept']==1 and entry(rice) is not None
 assert a.delete('/api/food/entries/'+str(rice),headers={'Content-Type':'application/json'}).status_code==200
 # Nullable manual fields and genuine zero must differ both in receipts and the saved row.
 with patch('app.meal_chat.lookup',return_value={'kind':'none','foods':[]}):root,r=send('fictional mystery plate')
 r=post(f"/api/food/thread/messages/{root['id']}/manual",{'part':0,'confirm':True,'items':[{'name':'Fictional entered plate','kcal':250,'sodium_mg':0,'sugar_g':None,'saturated_fat_g':1.2345}]})
 with db.connect() as c:row=c.execute("SELECT * FROM food_entries WHERE user_id=%s AND name='Fictional entered plate'",(uid,)).fetchone()
 values(row,[0,None,1.2345]);assert 'sugar_g' in row['ref']['unknown_nutrients'] and 'sodium_mg' not in row['ref']['unknown_nutrients']
 send('only half the fictional entered plate');row=entry(row['id']);values(row,[0,None,.6172]);assert 'protein_g' in row['ref']['unknown_nutrients']
 assert b.post(f"/api/food/thread/messages/{root['id']}/manual",json={'part':0,'confirm':True,'items':[{'name':'Foreign','kcal':1,'sodium_mg':0}]}).status_code==404
 # Published site values survive old five-field review clients; explicit null and zero edits still win.
 recipe={'@type':'Recipe','name':'Fictional site stew','recipeYield':'4 servings','recipeIngredient':['1 fictional leaf'],'nutrition':{'calories':'200 kcal','proteinContent':'10 g','sodiumContent':'600 mg','sugarContent':'0 g','saturatedFatContent':'1.5 g'}}
 identity=str(uuid.uuid4());path='/api/recipe-links/'+identity
 with patch.object(F,'fetch',return_value={'url':'https://recipes.example/stew','html':'<script type="application/ld+json">'+json.dumps(recipe)+'</script>'}):post('/api/recipe-links/read',{'client_id':identity,'url':'https://recipes.example/stew'})
 review={'candidate':0,'name':recipe['name'],'servings':4,'lines':recipe['recipeIngredient'],'basis':'published','values':{'kcal':200,'protein_g':10,'carbs_g':None,'fat_g':None,'fiber_g':None}}
 reviewed=post(path+'/review',review);values(reviewed['per_serving'],[600,0,1.5]);assert reviewed['sources']['sodium_mg']=='site'
 saved=post(path+'/save',{'baseline':reviewed['baseline'],'confirmed':True})['dish'];values(saved['totals'],[2400,0,6])
 portion=post('/api/dishes/'+str(saved['id'])+'/portion',{'count':1,'meal':'dinner'});values(portion['entry'],[600,0,1.5])
 assert a.patch('/api/dishes/'+str(did),json={'known_sodium_mg':True}).status_code==422
 assert a.post(f'/api/dishes/{did}/items',json={'name':'Too much','grams':100,'per100':{'kcal':200,'sodium_mg':100001}}).status_code==422
 # Changing only an extra nutrient is still a later edit: original-card Undo keeps it.
 logged=post('/api/food/entries?thread=true',[{'day':day,'meal':'lunch','name':'Fictional later nutrient edit','kcal':100,'sodium_mg':20,'client_id':str(uuid.uuid4())}])
 eid=logged['ids'][0];root=next(m for m in logged['messages'] if m['kind']=='user')
 assert a.patch('/api/food/entries/'+str(eid),json={'sodium_mg':30}).status_code==200
 undone=post(f"/api/food/thread/messages/{root['id']}/undo",{});assert undone['kept']==1 and entry(eid)['sodium_mg']==30
 assert 'future_nutrient' in N.storage({'kcal':1,'ref':{'unknown_nutrients':['future_nutrient']}})['ref']['unknown_nutrients']
 print('Eight-nutrient recipes/portions/chat/replay/private learning/catalog/source/old-client/unknown-vs-zero/unit bounds PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
