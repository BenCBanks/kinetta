"""Real owner-bound shared food review; all data fictional, no provider/device calls."""
import datetime as dt,json,unittest,uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,food_thread as T
from app.main import app

class Review(unittest.TestCase):
 def setUp(self):
  self.ids=[];self.clients=[];self.draft=str(uuid.uuid4())
  for _ in range(2):
   login='zz_test_review_'+uuid.uuid4().hex[:12]
   with db.connect() as c:
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional food reviewer',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];self.ids.append(uid)
    c.execute('INSERT INTO profile(user_id,ai_ok) VALUES(%s,false)',(uid,))
   client=TestClient(app);client.headers['Origin']='http://testserver';self.assertEqual(client.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code,200);self.clients.append(client)
  self.a,self.b=self.clients;self.network=patch('urllib.request.urlopen',side_effect=AssertionError('No external provider call'));self.network.start()
 def tearDown(self):
  self.network.stop()
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))
 def post(self,path,body=None,client=None,status=200):
  response=(client or self.a).post(path,json=body or {});self.assertEqual(response.status_code,status,response.text[:1200]);return response.json()
 def stage(self,items=None,**extra):
  body={'client_id':str(uuid.uuid4()),'draft_id':self.draft,'items':items or [{'day':str(dt.date.today()),'meal':'snacks','name':'Fictional sauce','amount':1,'unit':'serving','kcal':400}],**extra}
  result=self.post('/api/food/thread/reviews/items',body);return next(m for m in result['messages'] if m['kind']=='user'),body
 def prepare(self,messages,**extra):return self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[m['id'] for m in messages],**extra})
 def confirm(self,review,**extra):return self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'dinner',**extra})
 def rows(self,table):
  with db.connect() as c:return c.execute(f'SELECT * FROM {table} WHERE user_id=%s ORDER BY id',(self.ids[0],)).fetchall()
 def food(self,name,kcal=100):return self.post('/api/food/foods',{'name':name,'serving_label':'1 serving','serving_g':100,'kcal':kcal,'protein_g':5,'carbs_g':10,'fat_g':2})
 def send(self,text,context=None,review=True):
  body={'client_id':str(uuid.uuid4()),'body':text,**({'review_only':True,'draft_id':self.draft} if review else {}),**({'context':context} if context else {})}
  m=self.post('/api/food/thread/messages',body,status=201)['message'];r=self.post(f"/api/food/thread/messages/{m['id']}/process");return m,r
 def test_named_recipe_and_portion_are_atomic_retry_safe_and_undoable(self):
  m,body=self.stage();self.assertEqual(self.rows('food_entries'),[]);self.assertEqual(self.rows('dishes'),[])
  self.post('/api/food/thread/reviews/items',body);review=self.prepare([m]);self.assertEqual(review['review']['totals']['kcal'],400);self.assertIsNone(review['review']['totals']['protein_g'])
  choices={'save_recipe':True,'name':'Fictional sauce recipe','basis':'servings','servings':4,'whole':False,'portion':1.5}
  result=self.confirm(review,**choices);self.assertEqual(self.rows('food_entries')[0]['kcal'],150)
  dish=self.rows('dishes')[0];self.assertEqual(dish['items'][0]['name'],'Fictional sauce');self.assertEqual(dish['yield_servings'],4)
  self.assertIn('protein_g',self.rows('food_entries')[0]['ref']['unknown_nutrients'])
  self.assertTrue(self.confirm(review,**choices)['replayed']);self.assertEqual(len(self.rows('dishes')),1);self.assertEqual(len(self.rows('food_entries')),1)
  self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'lunch',**choices},status=409)
  self.post(f"/api/food/thread/messages/{review['id']}/undo");self.assertEqual(self.rows('food_entries'),[]);self.assertEqual(len(self.rows('dishes')),1)
  r=self.a.post(f"/api/food/thread/reviews/{review['id']}/confirm",json={'confirm':True,'meal':'dinner',**choices});self.assertIn(r.status_code,(200,404,409));self.assertEqual(self.rows('food_entries'),[])
 def test_one_off_uses_the_given_amounts_without_creating_a_recipe(self):
  items=[{'day':str(dt.date.today()),'meal':'snacks','name':name,'amount':amount,'unit':'g','kcal':kcal} for name,amount,kcal in [('Fictional oats',100,200),('Fictional milk',200,100)]]
  m,_=self.stage(items);r=self.prepare([m]);self.confirm(r,meal='lunch')
  self.assertEqual([(e['name'],e['amount'],e['kcal'],e['meal']) for e in self.rows('food_entries')],[('Fictional oats',100,200,'lunch'),('Fictional milk',200,100,'lunch')]);self.assertEqual(self.rows('dishes'),[])
 def test_save_without_log_and_by_weight_portion(self):
  m,_=self.stage();r=self.prepare([m]);self.confirm(r,save_recipe=True,log_today=False,name='Fictional prep',basis='weight',total_g=800)
  self.assertEqual(self.rows('food_entries'),[]);self.assertEqual(self.rows('dishes')[0]['cooked_g'],800)
  m,_=self.stage();r=self.prepare([m]);self.confirm(r,save_recipe=True,name='Fictional prep two',basis='weight',total_g=800,whole=False,portion=200)
  self.assertEqual(self.rows('food_entries')[0]['kcal'],100);self.assertEqual(self.rows('food_entries')[0]['amount'],200)
 def test_source_changes_require_another_review(self):
  f=self.food('Fictional rice');m,result=self.send('1 serving fictional rice');self.assertEqual(self.rows('food_entries'),[])
  review=self.prepare([m]);self.assertEqual(review['review']['totals']['kcal'],100)
  self.assertEqual(self.a.put('/api/food/foods/'+str(f['id']),json={'name':'Fictional rice','serving_g':100,'kcal':200,'protein_g':5,'carbs_g':20,'fat_g':3}).status_code,200)
  changed=self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'lunch'},status=409);self.assertTrue(changed['changed']);self.assertEqual(changed['review']['totals']['kcal'],200);self.assertEqual(self.rows('food_entries'),[])
  self.confirm(review,meal='lunch');self.assertEqual(self.rows('food_entries')[0]['kcal'],200)
 def test_questions_keep_other_ready_ingredients_and_resume_by_draft(self):
  self.food('Rice');self.food('Chicken taco',200)
  m,r=self.send('1 serving rice and taco');self.assertEqual(self.rows('food_entries'),[])
  following,r=self.send('2 chicken tacos',m['client_id']);review=self.prepare([m,following]);self.assertEqual(review['review']['totals']['kcal'],500)
  resumed=self.a.get('/api/food/thread/reviews/draft/'+self.draft).json();self.assertTrue(any(x['id']==m['id'] for x in resumed['messages']))
  self.assertEqual(self.b.get('/api/food/thread/reviews/draft/'+self.draft).json()['messages'],[])
  self.confirm(review);self.assertEqual(sum(e['kcal'] for e in self.rows('food_entries')),500)
 def test_exact_saved_food_still_requires_missing_amount(self):
  self.food('Rice');m,r=self.send('rice');reply=next(x for x in r['messages'] if x.get('reply_to')==m['id'])
  self.assertEqual(reply['result']['parts'][0]['status'],'quantity');self.assertEqual(self.rows('food_entries'),[])
  m2,r=self.send('2 servings',m['client_id']);review=self.prepare([m,m2]);self.assertEqual(review['review']['totals']['kcal'],200)
 def test_recipe_pick_uses_current_owned_source_and_preserves_weight(self):
  d=self.post('/api/dishes',{'name':'Fictional stew'})
  self.assertEqual(self.a.patch('/api/dishes/'+str(d['id']),json={'known_kcal':800,'cooked_g':1000,'yield_servings':4}).status_code,200)
  request={'client_id':str(uuid.uuid4()),'draft_id':self.draft,'did':d['id'],'portion':{'grams':250,'meal':'dinner'}}
  held=self.post('/api/food/thread/reviews/dish',request);m=next(x for x in held['messages'] if x['kind']=='user');review=self.prepare([m]);self.assertEqual(review['review']['totals']['kcal'],200);self.assertEqual(review['review']['known_weight_g'],250)
  self.post('/api/food/thread/reviews/dish',{**request,'client_id':str(uuid.uuid4())},client=self.b,status=404)
  self.assertEqual(self.rows('food_entries'),[])
  self.assertEqual(self.a.delete('/api/dishes/'+str(d['id']),headers={'Content-Type':'application/json'}).status_code,200)
  self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'dinner'},status=404);self.assertEqual(self.rows('food_entries'),[])
 def test_draft_identity_cancel_and_expiry(self):
  m,body=self.stage();self.post('/api/food/thread/reviews/items',{**body,'draft_id':str(uuid.uuid4())},status=409)
  self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':str(uuid.uuid4()),'messages':[m['id']]},status=409)
  r=self.prepare([m])
  with db.connect() as c:c.execute("UPDATE food_chat_messages SET result=jsonb_set(result,'{expires}',to_jsonb(%s::text)) WHERE user_id=%s AND reply_to=%s",((dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=2)).isoformat(),self.ids[0],r['id']))
  self.post(f"/api/food/thread/reviews/{r['id']}/confirm",{'confirm':True,'meal':'dinner'},status=409);self.assertEqual(self.rows('food_entries'),[])
 def test_copied_meals_wait_for_final_review_with_either_old_preference(self):
  self.post('/api/food/entries',[{'day':str(dt.date.today()-dt.timedelta(days=1)),'meal':'lunch','name':'Fictional leftovers','amount':200,'unit':'g','kcal':300}])
  for auto in (True,False):
   self.draft=str(uuid.uuid4());self.assertEqual(self.a.put('/api/food/thread/preferences',json={'auto_log':auto}).status_code,200)
   m,result=self.send('same as yesterday lunch');self.assertEqual(len(self.rows('food_entries')),1)
   review=self.prepare([m]);self.assertEqual(review['review']['totals']['kcal'],300);self.assertNotIn('id',review['review']['foods'][0])
   logged=self.confirm(review,meal='dinner');self.assertEqual(len(self.rows('food_entries')),2)
   self.post(f"/api/food/thread/messages/{review['id']}/undo");self.assertEqual(len(self.rows('food_entries')),1)
 def test_legacy_commit_and_force_helpers_cannot_auto_log_new_drafts(self):
  from app import food_thread_log as engine,food_thread_compose as compose
  self.food('Fictional porridge');m=self.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':'1 serving fictional porridge','review_only':True,'draft_id':self.draft},status=201)['message']
  with db.connect() as c:
   message=T.locked_message(c,self.ids[0],m['id']);resolution=engine.resolve(c,self.ids[0],message)
   engine.commit_log(c,self.ids[0],message,engine.make_result(c,self.ids[0],message,resolution))
   message=T.locked_message(c,self.ids[0],m['id']);compose.write(c,self.ids[0],message,compose.card(c,self.ids[0],message),force=True)
  self.assertEqual(self.rows('food_entries'),[]);self.post(f"/api/food/thread/messages/{m['id']}/log",{'confirm':True},status=409)
  review=self.prepare([m]);self.confirm(review);self.assertEqual(len(self.rows('food_entries')),1)
 def test_foreign_and_unsupported_confirmation_never_write(self):
  m,_=self.stage();r=self.prepare([m]);self.post(f"/api/food/thread/reviews/{r['id']}/confirm",{'confirm':True,'meal':'dinner'},client=self.b,status=404)
  self.post(f"/api/food/thread/reviews/{r['id']}/confirm",{'confirm':False,'meal':'dinner'},status=400)
  for choices in ({'confirm':True},{'confirm':True,'meal':'dinner','save_recipe':True},{'confirm':True,'meal':'dinner','basis':'weight','whole':False,'portion':100}):self.post(f"/api/food/thread/reviews/{r['id']}/confirm",choices,status=422)
  self.assertEqual(self.rows('food_entries'),[]);self.assertEqual(self.rows('dishes'),[])
  self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[m['id']]},client=self.b,status=404)
 def test_failure_rolls_back_recipe_food_and_source_consumption(self):
  m,_=self.stage();r=self.prepare([m]);original=T.finish_reply
  def fail(c,uid,message,result):
   if result.get('confirmed'):raise RuntimeError('Fictional final-receipt failure')
   return original(c,uid,message,result)
  choices={'save_recipe':True,'name':'Fictional atomic recipe','basis':'servings','servings':4}
  with patch.object(T,'finish_reply',side_effect=fail):
   with self.assertRaises(RuntimeError):self.confirm(r,**choices)
  self.assertEqual(self.rows('food_entries'),[]);self.assertEqual(self.rows('dishes'),[])
  self.confirm(r,**choices);self.assertEqual(len(self.rows('dishes')),1);self.assertEqual(len(self.rows('food_entries')),1)
 def test_two_reviews_and_concurrent_confirmation_cannot_duplicate(self):
  m,_=self.stage();r=self.prepare([m]);other=self.prepare([m])
  with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(lambda _:self.confirm(r),range(2)))
  self.assertEqual(len(self.rows('food_entries')),1);self.assertEqual(sum(bool(x.get('replayed')) for x in results),1)
  self.post(f"/api/food/thread/reviews/{other['id']}/confirm",{'confirm':True,'meal':'dinner'},status=409)
 def test_old_client_auto_log_preference_still_works(self):
  self.food('Fictional rice');self.send('1 serving fictional rice',review=False);self.assertEqual(len(self.rows('food_entries')),1)

unittest.main()
