"""Actual two-person extra-nutrient storage/coverage APIs, no providers or personal data."""
import csv,datetime as dt,io,json,os,secrets,tempfile,uuid,zipfile
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from app import auth,db,api_mydata
from app.main import app
uids=[];clients=[];PW='green teapot on the hill';role='zz_test_nutrient_reader_'+uuid.uuid4().hex[:8];password=secrets.token_urlsafe(24)
try:
 for _ in range(2):
  name='zz_test_nutrient_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(name,'Fictional nutrient log',auth.hash_pw(PW))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,kcal_target,protein_target) VALUES(%s,'UTC',2000,110)",(uid,))
  client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':name,'password':PW}).status_code==200;clients.append(client)
 a,b=clients;uid,other=uids;day=dt.datetime.now(dt.timezone.utc).date().isoformat()
 before=a.get('/api/food/day').json();assert all(v['recorded'] is None and v['target'] is None for v in before['extra_nutrients'].values())
 body={'day':day,'meal':'lunch','name':'Fictional labelled bowl','kcal':300,'protein_g':20,'sodium_mg':350,'sugar_g':0,'saturated_fat_g':2.5,'source':'label','client_id':str(uuid.uuid4()),'ref':{'unknown_nutrients':['sugar_g']}}
 result=a.post('/api/food/entries',json=[body]);assert result.status_code==200,result.text;eid=result.json()['ids'][0]
 data=a.get('/api/food/day').json();entry=data['entries'][0];assert [entry[k] for k in ('sodium_mg','sugar_g','saturated_fat_g')]==[350,0,2.5]
 assert 'sugar_g' not in entry['ref']['unknown_nutrients'] and data['extra_nutrients']['sugar_g']['complete']
 assert data['extra_nutrients']['sodium_mg']['recorded']==350 and data['extra_nutrients']['sodium_mg']['unit']=='mg'
 assert not b.get('/api/food/day').json()['entries']
 assert b.patch('/api/food/entries/'+str(eid),json={'sodium_mg':1}).status_code==404
 assert a.patch('/api/food/entries/'+str(eid),json={'amount':None}).status_code==422
 assert a.patch('/api/food/entries/'+str(eid),json={'sodium_mg':True}).status_code==422
 assert a.patch('/api/food/entries/'+str(eid),json={'sodium_mg':None}).status_code==200
 data=a.get('/api/food/day').json();assert data['entries'][0]['sodium_mg'] is None and data['extra_nutrients']['sodium_mg']['recorded'] is None and data['extra_nutrients']['sodium_mg']['unknown_count']==1
 assert a.patch('/api/food/entries/'+str(eid),json={'sodium_mg':0}).status_code==200
 assert a.get('/api/food/day').json()['extra_nutrients']['sodium_mg']['recorded']==0
 # An older client supplies none of the new fields; existing totals remain unchanged, coverage is partial.
 assert a.post('/api/food/entries',json=[{'day':day,'meal':'dinner','name':'Fictional old-client food','kcal':400}]).status_code==200
 data=a.get('/api/food/day').json();assert data['totals']['kcal']==700 and data['targets']['kcal_target']==2000
 assert data['extra_nutrients']['sugar_g']['known_count']==1 and data['extra_nutrients']['sugar_g']['unknown_count']==1 and not data['extra_nutrients']['sugar_g']['complete']
 assert a.post('/api/food/entries',json=[{**body,'sodium_mg':-1,'client_id':str(uuid.uuid4())}]).status_code==422
 tomorrow=(dt.date.fromisoformat(day)+dt.timedelta(days=1)).isoformat()
 assert a.post('/api/food/copy',json={'from_day':day,'to_day':tomorrow}).json()['copied']==2
 copied=a.get('/api/food/day?d='+tomorrow).json()['entries'];assert copied[0]['sugar_g']==0 and copied[0]['saturated_fat_g']==2.5 and copied[1]['sodium_mg'] is None
 assert a.post('/api/food/meals',json={'name':'Fictional saved combination','entry_ids':[eid]}).status_code==200
 saved=a.get('/api/food/meals').json()[0];assert saved['items'][0]['saturated_fat_g']==2.5 and saved['items'][0]['sugar_g']==0
 # Custom-food serving/100g output and edits preserve a reported zero and unknown independently.
 food=a.post('/api/food/foods',json={'name':'Fictional source portion','serving_g':50,'kcal':200,'sodium_mg':250,'sugar_g':0,'saturated_fat_g':None});assert food.status_code==200,food.text
 own=a.get('/api/food/foods').json()[0];assert own['per100']['sodium_mg']==500 and own['per_serving']['sugar_g']==0 and own['per100']['saturated_fat_g'] is None
 assert not b.get('/api/food/foods').json()
 assert a.put('/api/food/foods/'+str(food.json()['id']),json={'name':'Fictional renamed source portion','serving_g':50,'kcal':220}).status_code==200
 own=a.get('/api/food/foods').json()[0];assert own['per_serving']['sodium_mg']==250 and own['per_serving']['sugar_g']==0
 # Old amount-edit forms scale the new known fields in the same unit; unconvertible unit changes clear them to unknown.
 assert a.patch('/api/food/entries/'+str(eid),json={'amount':2}).status_code==200
 edited=a.get('/api/food/day').json()['entries'][0];assert edited['saturated_fat_g']==5 and edited['sugar_g']==0
 assert a.patch('/api/food/entries/'+str(eid),json={'amount':1}).status_code==200
 assert a.patch('/api/food/entries/'+str(eid),json={'unit':'g'}).status_code==200
 assert all(a.get('/api/food/day').json()['entries'][0][k] is None for k in ('sodium_mg','sugar_g','saturated_fat_g'))
 assert a.patch('/api/food/entries/'+str(eid),json={'unit':'serving','sodium_mg':0,'sugar_g':0,'saturated_fat_g':2.5}).status_code==200
 # Optional limits are never set by default; old target forms cannot erase them.
 assert a.put('/api/food/targets',json={'sodium_target_mg':1234,'sugar_target_g':0,'saturated_fat_target_g':12}).status_code==200
 assert a.put('/api/food/targets',json={'kcal_target':2100,'protein_target':120}).status_code==200
 profile=a.get('/api/me').json();assert profile['sodium_target_mg']==1234 and profile['sugar_target_g']==0 and profile['saturated_fat_target_g']==12 and profile['kcal_target']==2100
 assert a.put('/api/food/targets',json={'sodium_target_mg':None}).status_code==200
 assert a.get('/api/food/day').json()['extra_nutrients']['sodium_mg']['target'] is None
 assert b.get('/api/me').json().get('sugar_target_g') is None
 # The database rejects nonfinite values too, including writes outside Pydantic.
 for value in ['NaN','Infinity']:
  try:
   with db.connect() as c:c.execute("UPDATE profile SET sodium_target_mg=%s::real WHERE user_id=%s",(value,uid))
  except psycopg.errors.CheckViolation:pass
  else:raise AssertionError('Database accepted a nonfinite optional limit')
 # Deletion response keeps all values for the existing Undo path.
 removed=a.delete('/api/food/entries/'+str(eid),headers={'Content-Type':'application/json'});assert removed.status_code==200
 values=removed.json()['deleted'];assert values['sugar_g']==0 and values['saturated_fat_g']==2.5
 values['client_id']=str(uuid.uuid4());assert a.post('/api/food/entries',json=[values]).status_code==200
 with db.connect() as c:
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
  c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
  c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uid))
 with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
  rows=reader.execute('SELECT user_id,sodium_mg,sugar_g,saturated_fat_g FROM food_entries').fetchall();assert rows and all(r['user_id']==uid for r in rows)
  assert reader.execute('SELECT count(*) AS n FROM profile WHERE user_id=%s',(other,)).fetchone()['n']==0
  try:reader.execute('UPDATE food_entries SET sodium_mg=0')
  except psycopg.errors.InsufficientPrivilege:reader.rollback()
  else:raise AssertionError('Reader could write new nutrient fields')
 with tempfile.TemporaryDirectory() as folder:
  path=os.path.join(folder,'export.zip');api_mydata._write_export(uid,path)
  with zipfile.ZipFile(path) as z:
   rows=list(csv.DictReader(io.StringIO(z.read('food.csv').decode())));assert rows and all(k in rows[0] for k in ('sodium_mg','sugar_g','saturated_fat_g'))
   rows=[json.loads(line) for line in z.read('data/food_entries.jsonl').splitlines()];assert all('user_id' not in row for row in rows) and any(row['sugar_g']==0 for row in rows)
 print('Extra nutrient API/SQL: private add/edit/unknown-vs-zero/day coverage, old clients, copy/saved combination/delete Undo/custom serving units, opt-in limits preserved across old forms, real RLS/read-only and CSV/JSON export PASS')
finally:
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
