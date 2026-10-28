"""A new recipe uses ingredient memory, never a saved whole recipe; saving and logging stay independent."""
import json,uuid,unittest
from fastapi.testclient import TestClient
from app import db,auth
from app.main import app
class RecipeCreation(unittest.TestCase):
 def setUp(self):
  self.ids=[];self.clients=[]
  with db.connect() as c:
   for _ in range(2):
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_recipe_mode_'+uuid.uuid4().hex[:8],'Fictional recipe maker',auth.hash_pw('fictional recipe creation test'))).fetchone()['id'];self.ids.append(uid);c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,));client=TestClient(app);client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'});client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'fictional test'));self.clients.append(client)
   self.old=c.execute("INSERT INTO dishes(user_id,name,known_kcal,known_protein_g,known_carbs_g,known_fat_g) VALUES(%s,'Fictional brown sugar shaken espresso',80,2,10,3) RETURNING id",(self.ids[0],)).fetchone()['id']
   rows=[]
   for i,(name,kcal,units) in enumerate([('Milk',50,{}),('Espresso',5,{'shot':30}),('Brown sugar',400,{'tsp':4})]):rows.append({'id':str(uuid.uuid4()),'name':name,'grams':100,'amount':'100 g','per100':{'kcal':kcal,'protein_g':0,'carbs_g':0,'fat_g':0},'units':units,'source':'manual','kcal':kcal,'protein_g':0,'carbs_g':0,'fat_g':0})
   c.execute("INSERT INTO dishes(user_id,name,items) VALUES(%s,'Fictional ingredient memory',%s)",(self.ids[0],json.dumps(rows)))
 def tearDown(self):
  from app.api_account import erase,erase_files
  with db.connect() as c:
   for uid in self.ids:erase(c,{'id':uid,'sql_role':None})
  for uid in self.ids:erase_files(uid)
 def test_new_recipe_ingredient_list_never_substitutes_previous_whole_recipe(self):
  client=self.clients[0];new=client.post('/api/dishes',json={});self.assertEqual(new.status_code,200,new.text);did=new.json()['id'];self.assertNotEqual(did,self.old)
  client.patch('/api/dishes/'+str(did),json={'name':'Fictional new coffee'})
  r=client.post(f'/api/dishes/{did}/say',json={'text':'120 ml milk, 2 shots espresso, 1 tsp brown sugar'});self.assertEqual(r.status_code,200,r.text);d=r.json()['dish'];self.assertEqual(r.json()['by'],'memory');self.assertEqual([it['name'] for it in d['items']],['Milk','Espresso','Brown sugar']);self.assertEqual([it['grams'] for it in d['items']],[120,60,4]);self.assertAlmostEqual(d['totals']['kcal'],79);self.assertNotIn(str(self.old),json.dumps([it.get('ref') for it in d['items']]))
  with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],0)
  self.assertEqual(client.get('/api/dishes/'+str(self.old)).json()['totals']['kcal'],80)
  self.assertEqual(self.clients[1].get('/api/dishes/'+str(did)).status_code,404)
 def test_explicit_portion_is_still_separate_and_retry_safe(self):
  did=self.clients[0].post('/api/dishes',json={'name':'Fictional portion recipe'}).json()['id'];self.clients[0].patch('/api/dishes/'+str(did),json={'known_kcal':200,'known_protein_g':10,'known_carbs_g':20,'known_fat_g':9,'yield_servings':2})
  with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(self.ids[0],)).fetchone()['n'],0)
  body={'client_id':str(uuid.uuid4()),'count':1,'meal':'lunch'};r=self.clients[0].post(f'/api/dishes/{did}/portion',json=body);self.assertEqual(r.status_code,200,r.text);again=self.clients[0].post(f'/api/dishes/{did}/portion',json=body);self.assertEqual(again.status_code,200,again.text)
  with db.connect() as c:
   rows=c.execute('SELECT kcal FROM food_entries WHERE user_id=%s',(self.ids[0],)).fetchall();self.assertEqual(len(rows),1);self.assertEqual(rows[0]['kcal'],100)
if __name__=='__main__':unittest.main(verbosity=2)
