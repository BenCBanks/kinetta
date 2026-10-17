"""Actual authenticated HTTP/SQL recipe drafts; only fictional network stand-ins."""
import json,os,secrets,tempfile,threading,uuid,zipfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from app import auth,db,recipe_import as R,recipe_fetch as F,api_mydata
from app.main import app
PW='green teapot on the hill';uids=[];clients=[]
role='zz_test_recipe_reader_'+uuid.uuid4().hex[:8];password=secrets.token_urlsafe(24)
URL='https://recipes.example/fictional-bowls'
recipe={'@type':'Recipe','name':'Fictional bean bowls','recipeYield':'2 servings','recipeIngredient':['100 g fictional beans','a handful of fictional leaves'],'nutrition':{'calories':'210 kcal','proteinContent':'12 g'}}
HTML='<script type="application/ld+json">'+json.dumps(recipe)+'</script><p>This page must never be stored.</p>'
def page(value):return {'html':HTML,'url':value}
try:
 for _ in range(2):
  login='zz_test_recipe_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional recipe tester',auth.hash_pw(PW))).fetchone()['id'];uids.append(uid)
   c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
  client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':login,'password':PW}).status_code==200;clients.append(client)
 a,b=clients;uid,other=uids
 def read(client=a,identity=None,url=URL):
  response=client.post('/api/recipe-links/read',json={'url':url,'client_id':str(identity or uuid.uuid4())})
  return response
 assert TestClient(app).post('/api/recipe-links/read',json={'url':URL,'client_id':str(uuid.uuid4())}).status_code==401
 assert a.post('/api/recipe-links/read',json={'url':URL,'client_id':'invalid'}).status_code==422
 assert a.post('/api/food/foods',json={'name':'Fictional beans','serving_g':100,'kcal':200,'protein_g':10,'carbs_g':25,'fat_g':3,'fiber_g':6}).status_code==200
 with patch.object(F,'fetch',side_effect=page) as fetch,patch('app.food_photo.ask',side_effect=AssertionError('No AI')),patch('app.cook_chat.ai_actions',side_effect=AssertionError('No AI')):
  identity=uuid.uuid4();response=read(identity=identity);assert response.status_code==200,response.text
  result=response.json();assert result['state']=='ready' and len(result['candidates'])==1
  candidate=result['candidates'][0];assert candidate['nutrition']['calories']==210 and candidate['nutrition']['fat'] is None
  assert candidate['matches'][0]['status']=='ready' and candidate['matches'][0]['entries'][0]['kcal']==200
  assert candidate['matches'][1]['status'] in ('unknown','quantity')
  assert read(identity=identity).json()==result and fetch.call_count==1
  assert read(identity=identity,url='https://recipes.example/other').status_code==409
  path='/api/recipe-links/'+str(identity)
  assert b.get(path).status_code==404 and b.delete(path,headers={'Content-Type':'application/json'}).status_code==404
  assert a.get(path).json()==result
  with db.connect() as c:
   assert c.execute('SELECT count(*) AS n FROM dishes WHERE user_id=%s',(uid,)).fetchone()['n']==0
   assert c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(uid,)).fetchone()['n']==0
   stored=c.execute('SELECT data::text AS data FROM recipe_link_drafts WHERE user_id=%s AND id=%s',(uid,identity)).fetchone()['data']
   assert 'This page must never be stored' not in stored and '<script' not in stored
  # Simultaneous same-identity reads fetch once; cancelling pending work blocks its late completion.
  started=threading.Event();release=threading.Event();pending_id=uuid.uuid4()
  def slow(value):started.set();assert release.wait(5);return page(value)
  with patch.object(F,'fetch',side_effect=slow) as slow_fetch,ThreadPoolExecutor(max_workers=1) as pool:
   work=pool.submit(read,identity=pending_id);assert started.wait(3)
   assert read(identity=pending_id).json()['state']=='pending'
   cancel=a.delete('/api/recipe-links/'+str(pending_id),headers={'Content-Type':'application/json'});assert cancel.json()['state']=='cancelled'
   release.set();assert work.result().json()['state']=='cancelled' and slow_fetch.call_count==1
  assert read(identity=pending_id).json()['state']=='cancelled'
  # Independent owners may reuse an opaque UUID without seeing each other's ingredients.
  second=read(b,identity);assert second.status_code==200 and second.json()['candidates'][0]['matches'][0]['status']=='unknown'
  # Expiry/crash recovery do not automatically contact the site again.
  with db.connect() as c:c.execute("UPDATE recipe_link_drafts SET expires=now()-interval '1 second' WHERE user_id=%s AND id=%s",(uid,identity))
  expired=a.get(path).json();assert expired['state']=='cancelled' and not expired['candidates'] and expired['error_code']=='expired'
  crash=uuid.uuid4()
  with db.connect() as c:c.execute("INSERT INTO recipe_link_drafts(user_id,id,url,created) VALUES(%s,%s,%s,now()-interval '31 seconds')",(uid,crash,URL))
  assert a.get('/api/recipe-links/'+str(crash)).json()['state']=='failed'
  assert read(identity=crash).json()['error_code']=='timeout'
 with patch.object(F,'fetch',side_effect=F.RecipeFetchError('unsafe_address','Recipe links must use public internet addresses.')):
  denied=read().json();assert denied['state']=='failed' and denied['error_code']=='unsafe_address'
 with patch.object(F,'fetch',return_value={'html':'<p>no recipe</p>','url':URL}):assert read().json()['error_code']=='no_recipe'
 with patch.object(F,'fetch',side_effect=RuntimeError('PRIVATE SECRET PAGE')):
  error=read().json();assert error['state']=='failed' and 'PRIVATE' not in json.dumps(error)
 # Replays and GETs do not count again; failed/cancelled reads still consume a slot.
 with db.connect() as c:
  count=c.execute("SELECT count(*) AS n FROM recipe_link_drafts WHERE user_id=%s",(uid,)).fetchone()['n']
  for _ in range(30-count):c.execute("INSERT INTO recipe_link_drafts(user_id,id,url,state) VALUES(%s,%s,%s,'cancelled')",(uid,uuid.uuid4(),URL))
 with patch.object(F,'fetch',side_effect=AssertionError('Rate limit must precede fetch')):assert read().status_code==429
 assert a.get(path).status_code==200
 # Real SQL login only sees its own records, cannot write; coach gets no access.
 with db.connect() as c:
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
  c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
  c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uid))
 with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
  rows=reader.execute('SELECT * FROM recipe_link_drafts').fetchall();assert len(rows)==30 and all(row['user_id']==uid for row in rows)
  try:reader.execute('DELETE FROM recipe_link_drafts')
  except psycopg.errors.InsufficientPrivilege:reader.rollback()
  else:raise AssertionError('SQL reader could write recipe drafts')
 try:
  with db.coach_connect(uid) as c:c.execute('SELECT * FROM recipe_link_drafts')
 except psycopg.errors.InsufficientPrivilege:pass
 else:raise AssertionError('Coach could read unapproved recipe draft table')
 with tempfile.TemporaryDirectory() as folder:
  path=os.path.join(folder,'export.zip');api_mydata._write_export(uid,path)
  with zipfile.ZipFile(path) as z:
   rows=[json.loads(line) for line in z.read('data/recipe_link_drafts.jsonl').splitlines()]
   assert len(rows)==30 and all('user_id' not in row for row in rows)
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=%s',(uid,));assert not c.execute('SELECT 1 FROM recipe_link_drafts WHERE user_id=%s',(uid,)).fetchone()
  assert c.execute('SELECT 1 FROM recipe_link_drafts WHERE user_id=%s',(other,)).fetchone()
 print('Recipe draft API/SQL: auth, own matching/no AI, explicit reads only, no recipe/food save, replay/concurrency/cancel/late/expiry/crash, failed-attempt cap, sanitized errors/no page retention, real RLS/coach denial/export/account cascade PASS')
finally:
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
  c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
