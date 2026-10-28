"""Pending food correction/confirmation contracts; fictional accounts and providers only."""
import copy,datetime as dt,unittest,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,api_food as F,food_thread as T,food_thread_compose as C,food_thread_sources as S
from app.main import app

class PendingNutrition(unittest.TestCase):
 def setUp(self):
  self.ids=[];self.clients=[];self.draft=str(uuid.uuid4())
  for _ in range(2):
   login='zz_test_pending_'+uuid.uuid4().hex[:12]
   with db.connect() as c:
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional reviewer',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];self.ids.append(uid)
    c.execute('INSERT INTO profile(user_id,ai_ok) VALUES(%s,false)',(uid,))
   client=TestClient(app);client.headers['Origin']='http://testserver';self.assertEqual(client.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code,200);self.clients.append(client)
  self.a,self.b=self.clients;self.network=patch('urllib.request.urlopen',side_effect=AssertionError('No external provider request'));self.network.start()
 def tearDown(self):
  self.network.stop()
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))
 def post(self,path,body,client=None,status=200):
  r=(client or self.a).post(path,json=body);self.assertEqual(r.status_code,status,r.text[:1400]);return r.json()
 def result(self,data,mid):return next(m['result'] for m in data['messages'] if m.get('reply_to')==mid)
 def staged(self,items=None):
  e={'day':str(dt.date.today()),'meal':'dinner','name':'Fictional penne','amount':1,'unit':'serving','kcal':200,'protein_g':7,'carbs_g':42,'fat_g':1,'fiber_g':3,'sodium_mg':10}
  data=self.post('/api/food/thread/reviews/items',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'items':items or [e]});m=next(m for m in data['messages'] if m['kind']=='user');return m,self.result(data,m['id'])
 def edit(self,m,p,entry=0,**body):return {'part':p['index'],'entry':entry,'expected':p['remove_token'],**body}
 def review(self,m):return self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'messages':[m['id']]})
 def entries(self):return self.a.get('/api/food/day').json()['entries']
 def test_scanned_metadata_missing_macros_amount_and_exact_confirmed_values(self):
  product={'code':'9990000000019','product_name':'Fictional penne','brands':'Fictional Pantry','quantity':'16 oz (454 g)','serving_size':'1 cup (50 g)','serving_quantity':50,
           'nutriments':{'energy-kcal_100g':400,'energy-kcal_serving':200,'proteins_100g':14,'proteins_serving':7,'carbohydrates_100g':84,'carbohydrates_serving':42,'fiber_100g':6}}
  food=F._off_food(product);self.assertEqual(food['package_size'],'16 oz (454 g)');self.assertEqual(food['per_serving']['protein_g'],7);self.assertIsNone(food['per100']['fat_g'])
  m,_=self.staged();draft=S.catalog_draft(food,{'grams':50},partial=True)
  with db.connect() as c:
   data=C.write(c,self.ids[0],T.locked_message(c,self.ids[0],m['id']),{'composed':True,'day':str(dt.date.today()),'meal':'dinner','parts':[{'index':0,'status':'ready','drafts':[draft],'entries':S.draft_entries([draft])}]})
  p=self.result(data,m['id'])['parts'][0];self.assertIsNone(p['entries'][0]['fat_g']);self.assertEqual(self.entries(),[])
  data=self.post(f"/api/food/thread/messages/{m['id']}/edit-food",self.edit(m,p,amount=100));p=self.result(data,m['id'])['parts'][0]
  e=p['entries'][0];self.assertEqual((e['kcal'],e['protein_g'],e['carbs_g']),(400,14,84));self.assertIsNone(e['fat_g']);self.assertEqual(e['ref']['origin_ref']['serving']['label'],'1 cup (50 g)')
  prepared=self.review(m);self.assertEqual(prepared['review']['foods'][0],e)
  data=self.post(f"/api/food/thread/reviews/{prepared['id']}/confirm",{'confirm':True,'meal':'dinner'})
  saved=self.entries()[0];self.assertEqual((saved['kcal'],saved['protein_g'],saved['carbs_g']),(e['kcal'],e['protein_g'],e['carbs_g']));self.assertIn('fat_g',saved['ref']['unknown_nutrients'])
  self.post(f"/api/food/thread/messages/{m['id']}/edit-food",self.edit(m,p,amount=150),status=409)
 def test_label_correction_preserves_other_foods_and_does_not_log(self):
  items=[{'day':str(dt.date.today()),'meal':'dinner','name':name,'amount':amount,'unit':'g','kcal':kcal,'protein_g':protein,'carbs_g':20,'fat_g':0,'source':'off','ref':{'source':'off'}} for name,amount,kcal,protein in [('Fictional penne',100,400,14),('Fictional sauce',50,40,1)]]
  m,r=self.staged(items);p=r['parts'][0];other=copy.deepcopy(p['entries'][1]);path=f"/api/food/thread/messages/{m['id']}/edit-food"
  body=self.edit(m,p,item={'name':'Fictional penne corrected','kcal':210,'protein_g':8,'carbs_g':41,'fat_g':None},basis_amount=50,basis_label='1 cup (50 g)',basis_g=50)
  self.post(path,body,client=self.b,status=404);data=self.post(path,body);p=self.result(data,m['id'])['parts'][0]
  self.assertEqual(p['entries'][1],other);e=p['entries'][0];self.assertEqual((e['amount'],e['kcal'],e['protein_g'],e['carbs_g']),(100,420,16,82));self.assertIsNone(e['fat_g']);self.assertEqual(e['ref']['origin'],'label');self.assertEqual(self.entries(),[])
  self.post(path,body,status=409)
  data=self.post(path,self.edit(m,p,amount=150));p=self.result(data,m['id'])['parts'][0];self.assertEqual(p['entries'][0]['protein_g'],24);self.assertEqual(p['entries'][1],other)
  data=self.post(f"/api/food/thread/messages/{m['id']}/remove-food",self.edit(m,p,entry=1));self.assertEqual(len(self.result(data,m['id'])['parts'][0]['entries']),1);self.assertEqual(self.entries(),[])
 def test_estimate_correction_is_one_food_only_without_ai_work(self):
  m,_=self.staged();drafts=S.model_drafts({'items':[{'name':'Fictional toast','amount':'1 slice','kcal':100,'protein_g':4,'carbs_g':18,'fat_g':1},{'name':'Fictional spread','amount':'1 spoon','kcal':80,'protein_g':0,'carbs_g':0,'fat_g':9}]})
  with db.connect() as c:
   data=C.write(c,self.ids[0],T.locked_message(c,self.ids[0],m['id']),{'composed':True,'day':str(dt.date.today()),'meal':'dinner','parts':[{'index':0,'status':'ready','estimated':True,'drafts':drafts,'entries':S.draft_entries(drafts)}]})
  p=self.result(data,m['id'])['parts'][0];other=copy.deepcopy(p['entries'][1]);data=self.post(f"/api/food/thread/messages/{m['id']}/edit-food",self.edit(m,p,item={'name':'Fictional toast','kcal':120,'protein_g':5,'carbs_g':20,'fat_g':2}))
  rows=self.result(data,m['id'])['parts'][0]['entries'];self.assertEqual(rows[0]['kcal'],120);self.assertEqual(rows[1],other);self.assertEqual(self.entries(),[])
 def test_stale_source_invalid_input_and_ownership_do_not_change_foods(self):
  f=self.post('/api/food/foods',{'name':'Fictional rice','serving_label':'1 bowl','serving_g':100,'kcal':100,'protein_g':4,'carbs_g':20,'fat_g':1})
  m=self.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'review_only':True,'body':'1 serving fictional rice'},status=201)['message']
  data=self.post(f"/api/food/thread/messages/{m['id']}/process",{});p=self.result(data,m['id'])['parts'][0];path=f"/api/food/thread/messages/{m['id']}/edit-food"
  self.post(path,self.edit(m,p,amount=2),client=self.b,status=404)
  for extra in ({'amount':0},{'amount':-1},{'amount':2,'item':{'name':'Food','kcal':1}},{'item':{'name':'Food','kcal':1},'basis_amount':0}):self.post(path,self.edit(m,p,**extra),status=422)
  self.assertEqual(self.a.put('/api/food/foods/'+str(f['id']),json={'name':'Fictional rice','serving_label':'1 bowl','serving_g':100,'kcal':200,'protein_g':8,'carbs_g':40,'fat_g':2}).status_code,200)
  data=self.post(path,self.edit(m,p,amount=2),status=409);self.assertTrue(data['changed']);self.assertEqual(self.result(data,m['id'])['parts'][0]['entries'][0]['kcal'],200);self.assertEqual(self.entries(),[])
 def test_source_fallback_is_not_a_made_up_serving_and_zero_remains_known(self):
  f=F._off_food({'product_name':'Fictional drink','serving_size':'1 bottle','nutriments':{'energy-kcal_100g':0,'proteins_100g':0,'carbohydrates_100g':0,'fat_100g':0}})
  self.assertTrue(f['serving']['is_default']);self.assertIsNone(S.catalog_draft(f));self.assertEqual(S.catalog_draft(f,{'grams':100})['food']['kcal'],0)
 def test_barcode_http_flow_keeps_incomplete_macros_ready_for_explicit_review(self):
  code='999'+str(uuid.uuid4().int%10000000000).zfill(10)
  product={'code':code,'product_name':'Fictional scanned grain','brands':'Fictional Pantry','quantity':'500 g','serving_size':'1 cup','serving_quantity':50,
   'nutriments':{'energy-kcal_100g':400,'proteins_100g':14,'carbohydrates_100g':84}}
  m=self.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'draft_id':self.draft,'review_only':True,'body':'Scanned product '+code,'media':'barcode','barcode':code},status=201)['message']
  self.post(f"/api/food/thread/messages/{m['id']}/process",{})
  with patch('app.api_food._get',return_value={'status':1,'product':product}) as provider:
   data=self.post(f"/api/food/thread/messages/{m['id']}/resolve",{})
   self.assertIn('quantity',provider.call_args.args[0])
  p=self.result(data,m['id'])['parts'][0];self.assertEqual(p['status'],'ready');e=p['entries'][0]
  self.assertIsNone(e['fat_g']);self.assertEqual(e['protein_g'],7);self.assertEqual(e['ref']['origin_ref']['package_size'],'500 g');self.assertEqual(self.entries(),[])
  prepared=self.review(m);self.post(f"/api/food/thread/reviews/{prepared['id']}/confirm",{'confirm':True,'meal':'dinner'})
  self.assertIn('fat_g',self.entries()[0]['ref']['unknown_nutrients'])

if __name__=='__main__':unittest.main(verbosity=2)
