"""Thread source/portion/replay tests: fictional accounts and provider stand-ins only."""
import base64,datetime as dt,io,json,threading,unittest,uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import db,auth,food_photo,food_thread,meal_chat
from app.main import app

PW='green teapot on the hill'
JPEG=base64.b64encode(b'\xff\xd8'+b'fictional-image-stand-in').decode()
ESTIMATE={'items':[{'name':'Fictional curry','amount':'2 bowls','grams':600,'kcal':540,'protein_g':24,'carbs_g':60,'fat_g':22,'fiber_g':None}],
          'notes':'Assumed two home-size bowls.','model':'stand-in, not real inference'}
PLAIN={'source':'usda','id':'fictional-plain','name':'Plain grain','brand':None,'per100':{'kcal':100,'protein_g':10,'carbs_g':10,'fat_g':2.2,'fiber_g':2},
       'serving':{'label':'1 cup','g':200}}

class PhotoContext(unittest.TestCase):
 def setUp(self):
  self.uids=[];self.clients=[];accounts=[]
  with db.connect() as c:
   for _ in range(2):
    login='zz_test_resolution_'+uuid.uuid4().hex[:12]
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(login,'Fictional food log',auth.hash_pw(PW))).fetchone()['id']
    c.execute("INSERT INTO profile(user_id,tz,ai_ok,weight_kg,kcal_target,protein_target) VALUES (%s,'UTC',true,75,2000,110)",(uid,));self.uids.append(uid)
    accounts.append(login)
  for login in accounts:
   client=TestClient(app);client.headers['Origin']='http://testserver';self.assertEqual(client.post('/api/login',json={'login':login,'password':PW}).status_code,200);self.clients.append(client)
  self.a,self.b=self.clients;self.uid=self.uids[0]
  self.no_network=patch('urllib.request.urlopen',side_effect=AssertionError('Unexpected external provider request'));self.no_network.start()
  self.lookup=patch('app.meal_chat.lookup',side_effect=lambda text:{'kind':'none','foods':[],'text':text});self.look=self.lookup.start()
  self.estimate=patch('app.food_photo.ask',return_value=(ESTIMATE,{},'stand-in'));self.model=self.estimate.start()
 def tearDown(self):
  self.estimate.stop();self.lookup.stop();self.no_network.stop()
  with db.connect() as c:
   rows=c.execute('DELETE FROM ai_food_attempts WHERE user_id=ANY(%s) RETURNING day,charged_micros',(self.uids,)).fetchall()
   for r in rows:c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(r['charged_micros'],r['day']))
   c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.uids,))
 def no_ai(self):
  with db.connect() as c:c.execute('UPDATE profile SET ai_ok=false WHERE user_id=%s',(self.uid,))
 def post(self,path,body=None,client=None,status=200):
  r=(client or self.a).post(path,json=body or {});self.assertEqual(r.status_code,status,r.text[:800]);return r.json()
 def send(self,text,media='text',**extra):
  key=str(uuid.uuid4());m=self.post('/api/food/thread/messages',{'client_id':key,'body':text,'media':media,**extra},status=201)['message']
  r=self.post(f"/api/food/thread/messages/{m['id']}/process");return m,r
 def root(self,text='two bowls of mysterious curry',**extra):return self.send(text,**extra)[0]
 def resolve(self,m,**body):return self.post(f"/api/food/thread/messages/{m['id']}/resolve",body)
 def result(self,response):return response['messages'][-1]['result']
 def entries(self):return self.a.get('/api/food/day').json()['entries']
 def own_food(self,name='Rice',kcal=130):return self.post('/api/food/foods',{'name':name,'serving_label':'1 serving','serving_g':100,'kcal':kcal,'protein_g':3,'carbs_g':28,'fat_g':.3})['id']
 def photo(self,itemize=False):
  draft=str(uuid.uuid4())
  m=self.root('A 6-inch turkey sub with cheese and mayo; I ate half.',media='photo',itemize=itemize,review_only=True,draft_id=draft)
  return m,draft
 def ingredients(self):
  return {'items':[{'name':name,'amount':amount,'grams':grams,'kcal':kcal,'protein_g':10,'carbs_g':20,'fat_g':5,'fiber_g':None} for name,amount,grams,kcal in [('Bread','1 roll',90,250),('Turkey','3 slices',60,100),('Cheese','1 slice',20,80),('Mayo','1 tbsp',15,90)]], 'notes':'Fictional stand-in: assumed one tablespoon of hidden mayo; amounts are estimates.'}
 def itemized(self):self.model.return_value=(self.ingredients(),{},'stand-in')
 def test_description_itemization_followup_replay_ownership(self):
  self.itemized();m,draft=self.photo(True);r=self.resolve(m,images=[JPEG],itemize=True)
  part=self.result(r)['parts'][0];self.assertTrue(part['photo_itemized']);self.assertEqual(len(part['entries']),4);self.assertEqual(sum(e['kcal'] for e in part['entries']),520)
  prompt=str(self.model.call_args.args[0]);self.assertIn('I ate half',prompt);self.assertIn('Do not also include the whole sandwich',prompt)
  self.assertEqual(self.entries(),[])
  n=self.model.call_count;self.resolve(m,images=[JPEG],itemize=True);self.assertEqual(self.model.call_count,n)
  _,reply=self.send('Can you give me an itemized list of the calories in that picture?',context=m['client_id'],review_only=True,draft_id=draft)
  answer=self.result(reply);self.assertEqual(answer['intent'],'photo_breakdown');self.assertEqual(answer['breakdown_total'],520,str(answer));self.assertEqual(len(answer['breakdown']),4);self.assertEqual(self.model.call_count,n);self.assertEqual(self.entries(),[])
  self.post(f"/api/food/thread/messages/{m['id']}/resolve",{'images':[JPEG],'itemize':True},client=self.b,status=404)
  self.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':'Itemize this','media':'text','itemize':True},status=422)
  self.post('/api/food/photo',{'note':'a sub','itemize':True},status=422)
 def test_replace_existing_photo_without_duplicate_food(self):
  m,draft=self.photo();self.resolve(m,images=[JPEG]);_,reply=self.send('Break down the calories by ingredient',context=m['client_id'],review_only=True,draft_id=draft)
  answer=self.result(reply);self.assertEqual(answer['photo_itemize'],m['id']);self.assertIn('not estimated separately',answer['text']);self.assertEqual(len(answer['breakdown']),1)
  self.itemized();r=self.resolve(m,images=[JPEG],itemize=True,note='Half a turkey sub, no mayo')
  self.assertEqual(len(self.result(r)['parts']),1);self.assertEqual(len(self.result(r)['parts'][0]['entries']),4);self.assertIn('no mayo',str(self.model.call_args.args[0]));self.assertEqual(self.entries(),[])
 def test_failed_replacement_keeps_original_estimate_and_retry(self):
  m,_=self.photo();original=self.result(self.resolve(m,images=[JPEG]))['parts']
  self.model.side_effect=HTTPException(502,'Fictional provider unavailable')
  failed=self.result(self.resolve(m,images=[JPEG],itemize=True,note='Half a turkey sub, no cheese'));self.assertEqual(failed['parts'],original);self.assertIn('error',failed);self.assertEqual(failed['photo_request_note'],'Half a turkey sub, no cheese')
  self.model.side_effect=None;self.itemized();self.assertEqual(len(self.result(self.resolve(m,images=[JPEG],itemize=True,retry=True))['parts'][0]['entries']),4)
 def test_consent_revocation_during_replacement_keeps_original(self):
  m,_=self.photo();original=self.result(self.resolve(m,images=[JPEG]))['parts']
  def revoke(*args,**kwargs):
   self.no_ai();return self.ingredients(),{},'stand-in'
  self.model.side_effect=revoke
  r=self.result(self.resolve(m,images=[JPEG],itemize=True));self.assertEqual(r['parts'],original);self.assertIn('error',r);self.assertEqual(self.entries(),[])
 def test_late_replacement_cannot_overwrite_newer_portion(self):
  from app import food_thread_resolve as resolver
  from app.food_thread_models import ResolveIn
  m,_=self.photo();self.resolve(m,images=[JPEG]);work=resolver.claim(self.uid,m['id'],ResolveIn(images=[JPEG],itemize=True));self.itemized()
  updates,error=resolver.resolve_outside(self.uid,work,ResolveIn(images=[JPEG],itemize=True))
  with db.connect() as c:
   row=food_thread.locked_message(c,self.uid,m['id']);card=resolver._stored(c,self.uid,row);card['parts'][0]['entries'][0]['name']='Newer user portion';food_thread.finish_reply(c,self.uid,row,card)
  r=resolver.complete(self.uid,m['id'],work,updates,error);self.assertEqual(self.result(r)['parts'][0]['entries'][0]['name'],'Newer user portion');self.assertFalse(self.result(r)['error']['retryable'])
 def test_missing_calories_are_unknown_and_foreign_draft_is_not_selected(self):
  m,draft=self.photo(True);self.itemized();self.resolve(m,images=[JPEG],itemize=True)
  with db.connect() as c:
   from app import food_thread_resolve as resolver
   row=food_thread.locked_message(c,self.uid,m['id']);card=resolver._stored(c,self.uid,row);card['parts'][0]['entries'][0]['kcal']=None;food_thread.finish_reply(c,self.uid,row,card)
  _,reply=self.send('Itemized calories please',context=m['client_id'],review_only=True,draft_id=draft);self.assertIsNone(self.result(reply)['breakdown_total']);self.assertIsNone(self.result(reply)['breakdown'][0]['kcal'])
  _,other=self.send('Itemized calories please',context=m['client_id'],review_only=True,draft_id=str(uuid.uuid4()));self.assertNotEqual(self.result(other).get('intent'),'photo_breakdown')
 def test_explicit_review_confirmation_logs_components_once(self):
  self.itemized();m,draft=self.photo(True);self.resolve(m,images=[JPEG],itemize=True)
  review=self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':draft,'messages':[m['id']]})
  self.assertEqual(self.entries(),[]);self.assertEqual(review['review']['totals']['kcal'],520)
  self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'dinner'})
  self.assertEqual(len(self.entries()),4);self.assertEqual(sum(e['kcal'] for e in self.entries()),520)
  self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'dinner'})
  self.assertEqual(len(self.entries()),4)
  self.post(f"/api/food/thread/messages/{m['id']}/resolve",{'images':[JPEG],'itemize':True},status=409)
 def test_request_phrases_do_not_turn_ordinary_food_into_questions(self):
  from app.food_thread_photo import requested
  for text in ['Please itemize this sub','Give me a list of calories in that picture','Can you break down the calories?','Calories per ingredient','Each ingredient and its calories']:
   self.assertTrue(requested(text),text)
  for text in ['A turkey sub with mayo','200 g rice','Make it two','Remove cheese']:
   self.assertFalse(requested(text),text)
 def test_ingredient_does_not_become_a_similarly_named_saved_dish(self):
  self.own_food(name='Turkey sub sandwich',kcal=900)
  self.itemized();m,_=self.photo(True);part=self.result(self.resolve(m,images=[JPEG],itemize=True))['parts'][0]
  turkey=next(e for e in part['entries'] if e['name']=='Turkey');self.assertEqual(turkey['kcal'],100)

if __name__=='__main__':unittest.main()
