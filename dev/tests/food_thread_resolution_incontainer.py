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

class Resolution(unittest.TestCase):
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
  self.estimate=patch('app.food_photo.estimate',return_value=ESTIMATE);self.model=self.estimate.start()
 def tearDown(self):
  self.estimate.stop();self.lookup.stop();self.no_network.stop()
  with db.connect() as c:
   rows=c.execute('DELETE FROM ai_food_attempts WHERE user_id=ANY(%s) RETURNING day,charged_micros',(self.uids,)).fetchall()
   for r in rows:c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(r['charged_micros'],r['day']))
   c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.uids,))
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
 def test_household_amount_preview_log_reuse_and_undo(self):
  from app import food_thread_sources as sources
  for name,amount,count,label in [('Redgrain','½ cup',.5,'1 cup'),('Bluegrain','¾ cup',.75,'1 cup'),('Goldwater','20 fl oz',20,'1 fl oz')]:
   with self.subTest(amount=amount):
    estimate={**ESTIMATE,'items':[{**ESTIMATE['items'][0],'name':name,'amount':amount}]}
    draft=sources.model_drafts(estimate)[0];preview=sources.draft_entries([draft])[0]
    self.assertEqual(preview['amount'],count);self.assertEqual(preview['ref']['serving']['label'],label)
    self.assertEqual(preview['kcal'],540)
    self.model.return_value=estimate
    m=self.root(name+' '+amount);r=self.resolve(m)
    entry=r['messages'][-1]['entries'][0]
    self.assertEqual(entry['amount'],count);self.assertEqual(entry['ref']['serving']['label'],label)
    self.assertEqual(entry['kcal'],540)
    calls=self.model.call_count;_,again=self.send(m['body'])
    self.assertEqual(self.model.call_count,calls)
    repeated=again['messages'][-1]['entries'][0]
    self.assertEqual(repeated['amount'],count);self.assertEqual(repeated['ref']['serving']['label'],label)
    self.assertEqual(repeated['kcal'],540)
    self.post(f"/api/food/thread/messages/{m['id']}/undo")
 def test_01_partial_ready_failure_retry(self):
  self.own_food();m,r=self.send('rice and two bowls of mysterious curry')
  self.assertEqual(sum(e['kcal'] for e in self.entries()),130);self.assertEqual(self.result(r)['pending_count'],1)
  self.model.side_effect=HTTPException(503,'Fictional provider unavailable')
  r=self.resolve(m);self.assertEqual(sum(e['kcal'] for e in self.entries()),130);self.assertIn('error',self.result(r))
  calls=self.model.call_count;self.resolve(m);self.assertEqual(self.model.call_count,calls)
  self.model.side_effect=None;r=self.resolve(m,retry=True)
  self.assertEqual(sorted(e['kcal'] for e in self.entries()),[130,540]);self.assertEqual(self.result(r)['pending_count'],0)
  self.resolve(m);self.assertEqual(len(self.entries()),2);self.assertEqual(self.model.call_count,calls+1)
 def test_02_learn_once_current_library_values(self):
  m=self.root();r=self.resolve(m);self.assertEqual(self.result(r)['kind'],'log');self.assertEqual(self.entries()[0]['kcal'],540)
  foods=self.a.get('/api/food/foods').json();self.assertEqual(len(foods),1);f=foods[0]
  self.assertEqual(f['origin'],'ai');self.assertEqual(f['per_serving']['kcal'],270);self.assertEqual(f['serving']['g'],300)
  self.assertIn('Assumed',f['origin_notes']);self.assertFalse(f['origin_edited'])
  self.assertEqual(self.post('/api/food/thread/messages',{'client_id':str(m['client_id']),'body':m['body']})['created'],False)
  self.own_food('Unrelated food',50)
  r=self.a.put('/api/food/foods/'+str(f['id']),json={'name':f['name'],'serving_label':f['serving']['label'],'serving_g':300,
      'kcal':300,'protein_g':12,'carbs_g':30,'fat_g':11});self.assertEqual(r.status_code,200)
  calls=self.model.call_count;lookups=self.look.call_count;_,again=self.send(m['body'])
  self.assertEqual(self.result(again)['kind'],'log');self.assertEqual(self.model.call_count,calls);self.assertEqual(self.look.call_count,lookups)
  self.assertEqual(sorted(e['kcal'] for e in self.entries()),[540,600]);self.assertTrue(next(x for x in self.a.get('/api/food/foods').json() if x['id']==f['id'])['origin_edited'])
 def test_03_require_tap_and_source_stale(self):
  fid=self.own_food();self.a.put('/api/food/thread/preferences',json={'auto_log':False})
  m=self.root('rice and two bowls of mysterious curry');r=self.resolve(m);self.assertEqual(self.result(r)['kind'],'preview');self.assertEqual(self.entries(),[])
  self.assertEqual(len(self.a.get('/api/food/foods').json()),1,'AI food learned only after logging')
  self.a.put('/api/food/foods/'+str(fid),json={'name':'Rice','serving_g':100,'kcal':150,'protein_g':3,'carbs_g':28,'fat_g':.3})
  r=self.post(f"/api/food/thread/messages/{m['id']}/log",{'confirm':True},status=409);self.assertTrue(r['changed']);self.assertEqual(self.entries(),[])
  self.post(f"/api/food/thread/messages/{m['id']}/log",{'confirm':True});self.assertEqual(sorted(e['kcal'] for e in self.entries()),[150,540])
  self.post(f"/api/food/thread/messages/{m['id']}/undo");self.assertEqual(self.entries(),[])
  self.post(f"/api/food/thread/messages/{m['id']}/undo");self.assertEqual(self.entries(),[])
 def test_04_catalog_first_portions_and_brand_choice(self):
  self.look.side_effect=lambda text:{'kind':'plain','foods':[PLAIN]}
  m=self.root('2 cups plain grain');r=self.resolve(m);self.assertEqual(self.entries()[0]['kcal'],400);self.model.assert_not_called()
  self.assertEqual(self.entries()[0]['source'],'usda');self.assertEqual(self.entries()[0]['ref']['origin'],'catalog')
  brand={**PLAIN,'name':'Fictional Brand crackers','brand':'Fictional Brand','serving':{'label':'1 package','g':30}}
  self.look.side_effect=lambda text:{'kind':'brand','foods':[brand]}
  m=self.root('1 serving Fictional Brand crackers');r=self.resolve(m);self.assertEqual(self.result(r)['pending_count'],1);self.model.assert_not_called()
  self.post(f"/api/food/thread/messages/{m['id']}/choose",{'catalog':0,'portion':{'count':1,'unit':'serving'}})
  self.assertEqual(sorted(e['kcal'] for e in self.entries()),[30,400]);self.model.assert_not_called()
 def test_05_portion_question_and_half_does_not_change_alias_basis(self):
  uncertain={**ESTIMATE,'notes':'Portion is uncertain; assumed two bowls.'};self.model.return_value=uncertain
  m=self.root();r=self.resolve(m);self.assertEqual(self.result(r)['kind'],'needs');self.assertEqual(self.entries(),[])
  self.assertEqual(self.result(r)['text'].count('?'),1)
  self.post(f"/api/food/thread/messages/{m['id']}/choose",{'factor':.5});self.assertEqual(self.entries()[0]['kcal'],270)
  calls=self.model.call_count;self.send(m['body']);self.assertEqual(self.model.call_count,calls)
  self.assertEqual(sorted(e['kcal'] for e in self.entries()),[270,540],'a later two-bowl message retains the original two-bowl basis')
 def test_06_cancellation_deletion_and_other_account(self):
  m=self.root();self.post(f"/api/food/thread/messages/{m['id']}/resolve",client=self.b,status=404);self.model.assert_not_called()
  def cancel(*args,**kwargs):
   self.post('/api/food/thread/cancel',{'client_id':str(m['client_id'])});return ESTIMATE
  self.model.side_effect=cancel;r=self.resolve(m);self.assertTrue(r.get('cancelled'),json.dumps(r,default=str)[:1800]);self.assertEqual(self.entries(),[])
  self.post('/api/food/thread/cancel',{'client_id':str(m['client_id'])})
  r=self.post('/api/food/thread/messages',{'client_id':str(m['client_id']),'body':m['body']},status=409);self.assertEqual(r['detail']['code'],'message_cancelled')
  m=self.root('two bowls of another mysterious food')
  def delete(*args,**kwargs):
   r=self.a.delete(f"/api/food/thread/messages/{m['id']}",headers={'Content-Type':'application/json'});self.assertEqual(r.status_code,200,r.text[:500]);return ESTIMATE
  self.model.side_effect=delete;r=self.resolve(m);self.assertTrue(r.get('cancelled'),json.dumps(r,default=str)[:1800]);self.assertEqual(self.entries(),[])
  self.post('/api/food/thread/messages',{'client_id':str(m['client_id']),'body':m['body']},status=409)
  key=str(uuid.uuid4());self.post('/api/food/thread/cancel',{'client_id':key})
  self.post('/api/food/thread/messages',{'client_id':key,'body':'Cancelled offline food'},status=409)
  self.post('/api/food/thread/messages',{'client_id':key,'body':'Other private food'},client=self.b,status=201)
 def test_07_manual_missing_macros_and_no_implicit_save(self):
  m=self.root();path=f"/api/food/thread/messages/{m['id']}/manual"
  self.post(path,{'items':[{'name':'Manual lunch','kcal':400}],'confirm':False},status=400);self.assertEqual(self.entries(),[])
  self.post(path,{'items':[{'name':'Manual lunch','kcal':400}],'confirm':True});self.assertEqual(self.entries()[0]['kcal'],400)
  self.assertIn('protein_g',self.entries()[0]['ref']['unknown_nutrients']);self.model.assert_not_called()
  _,r=self.send('protein left?');self.assertIn('incomplete',self.result(r)['text']);self.assertIsNone(self.result(r)['facts']['logged'])
  eid=self.entries()[0]['id'];self.assertEqual(self.a.patch('/api/food/entries/'+str(eid),json={'protein_g':25}).status_code,200)
  _,r=self.send('protein left?');self.assertEqual(self.result(r)['facts']['logged'],25)
  self.assertNotIn('protein_g',self.entries()[0]['ref']['unknown_nutrients'])
  self.assertEqual(self.a.patch('/api/food/entries/'+str(eid),json={'protein_g':None}).status_code,200)
  _,r=self.send('protein left?');self.assertIsNone(self.result(r)['facts']['logged'])
  self.assertEqual(self.a.patch('/api/food/entries/'+str(eid),json={'kcal':None}).status_code,422)
  self.assertEqual(self.entries()[0]['kcal'],400)
 def test_08_reply_failure_retries_saved_source_without_provider(self):
  m=self.root();original=food_thread.finish_reply;calls=0
  def fail_fourth(*args,**kwargs):
   nonlocal calls
   calls+=1
   if calls==3:raise RuntimeError('Fictional food/reply commit failure')
   return original(*args,**kwargs)
  # claim, persist source result, then atomic food/reply save.
  with patch('app.food_thread.finish_reply',side_effect=fail_fourth):
   with self.assertRaises(RuntimeError):self.resolve(m)
  self.assertEqual(self.entries(),[]);self.assertEqual(self.a.get('/api/food/foods').json(),[])
  self.assertEqual(self.model.call_count,1);r=self.resolve(m)
  self.assertEqual(self.model.call_count,1);self.assertEqual(len(self.entries()),1);self.assertEqual(self.result(r)['kind'],'log')
 def test_09_concurrent_resolution_and_midflight_portion(self):
  m=self.root();began=threading.Event();release=threading.Event()
  def slow(*args,**kwargs):began.set();self.assertTrue(release.wait(10));return ESTIMATE
  self.model.side_effect=slow
  with ThreadPoolExecutor(max_workers=1) as pool:
   first=pool.submit(self.resolve,m);self.assertTrue(began.wait(5))
   r=self.resolve(m);self.assertTrue(r['processing']);self.assertEqual(self.model.call_count,1)
   self.post(f"/api/food/thread/messages/{m['id']}/choose",{'portion':{'share':.5}})
   release.set();first.result(timeout=10)
  self.assertEqual(self.entries()[0]['kcal'],270);self.assertEqual(self.model.call_count,1)
 def test_10_invalid_estimate_keeps_words(self):
  self.model.return_value={**ESTIMATE,'items':[{'name':'Bad','amount':'1 bowl','kcal':float('nan'),'protein_g':0,'carbs_g':0,'fat_g':0}]}
  m=self.root('one messy sentence with a strange food');r=self.resolve(m)
  self.assertIn('error',self.result(r));self.assertEqual(self.entries(),[]);self.assertEqual(self.a.get('/api/food/foods').json(),[])
  history=self.a.get('/api/food/thread').json()['messages'];self.assertTrue(any(x['body']==m['body'] for x in history))
 def test_11_photo_transport_no_image_retention(self):
  self.estimate.stop()
  output={k:v for k,v in ESTIMATE.items() if k!='model'}
  def transport(req,timeout=None):
   payload=json.loads(req.data);self.assertEqual(len([p for p in payload['contents'][0]['parts'] if 'inline_data' in p]),1)
   self.assertNotIn('weight_kg',json.dumps(payload));self.assertNotIn('user_id',json.dumps(payload))
   return io.BytesIO(json.dumps({'candidates':[{'content':{'parts':[{'text':json.dumps(output)}]}}],
             'usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':50,'thoughtsTokenCount':0}}).encode())
  m=self.root('Photo of food',media='photo')
  with patch('urllib.request.urlopen',side_effect=transport) as network:r=self.resolve(m,images=[JPEG,JPEG])
  self.assertEqual(network.call_count,1);self.assertEqual(len(self.entries()),1)
  self.assertNotIn(JPEG,json.dumps(self.a.get('/api/food/thread').json()))
  with db.connect() as c:
   row=c.execute('SELECT request_id,state FROM ai_food_attempts WHERE user_id=%s',(self.uid,)).fetchone()
   self.assertEqual(str(row['request_id']),str(m['client_id']));self.assertEqual(row['state'],'measured')
  self.estimate.start()

 def test_12_barcode_saved_food_repeats_without_network(self):
  code='0012345678905';food={**PLAIN,'source':'off','id':code,'name':'Fictional packaged food','serving':{'label':'1 bar','g':30}}
  m=self.root('Barcode '+code,media='barcode',barcode=code)
  with patch('app.api_food.barcode',return_value=food):self.resolve(m)
  self.model.assert_not_called();self.assertEqual(self.entries()[0]['kcal'],30)
  m=self.root('Barcode '+code,media='barcode',barcode=code);self.resolve(m)
  self.assertEqual([e['kcal'] for e in self.entries()],[30,30]);self.model.assert_not_called();self.look.assert_not_called()
 def test_13_photo_uses_owned_nutrition_with_estimated_portion(self):
  self.own_food('Fictional curry',130)
  m=self.root('Photo of food',media='photo');r=self.resolve(m,images=[JPEG])
  self.assertEqual(self.model.call_count,1);self.assertEqual(self.entries()[0]['kcal'],780)
  self.assertEqual(self.entries()[0]['source'],'custom');self.assertTrue(self.entries()[0]['ref']['estimated_portion'])
  self.assertEqual(len(self.a.get('/api/food/foods').json()),1)
  with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM food_chat_aliases WHERE user_id=%s',(self.uid,)).fetchone()['n'],0)
 def test_14_learned_alias_preview_changes_need_another_tap(self):
  m=self.root();self.resolve(m);food=self.a.get('/api/food/foods').json()[0]
  self.a.put('/api/food/thread/preferences',json={'auto_log':False})
  again,_=self.send(m['body'])
  self.a.put('/api/food/foods/'+str(food['id']),json={'name':food['name'],'serving_g':300,'kcal':300,'protein_g':12,'carbs_g':30,'fat_g':11})
  self.post(f"/api/food/thread/messages/{again['id']}/log",{'confirm':True},status=409);self.assertEqual(len(self.entries()),1)
  self.post(f"/api/food/thread/messages/{again['id']}/log",{'confirm':True})
  self.assertEqual(sorted(e['kcal'] for e in self.entries()),[540,600]);self.assertEqual(self.model.call_count,1)
 def test_15_catalog_result_survives_model_failure(self):
  self.look.side_effect=lambda text:{'kind':'plain','foods':[PLAIN]} if 'grain' in text else {'kind':'none','foods':[]}
  self.model.side_effect=HTTPException(503,'Fictional model failure')
  m=self.root('200 g plain grain and two bowls of mysterious curry');self.resolve(m)
  self.assertEqual([e['kcal'] for e in self.entries()],[200])
  self.model.side_effect=None;self.resolve(m,retry=True)
  self.assertEqual(sorted(e['kcal'] for e in self.entries()),[200,540])
 def test_16_long_message_and_deleted_text_not_kept_in_aliases(self):
  text='x'*4000;m=self.root(text);self.resolve(m)
  self.assertEqual(self.model.call_args.args[0].note,text)
  self.assertEqual(self.a.delete(f"/api/food/thread/messages/{m['id']}",headers={'Content-Type':'application/json'}).status_code,200)
  with db.connect() as c:
   columns={r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name='food_chat_aliases'").fetchall()}
   self.assertFalse(columns&{'phrase','body','text','photo','image'})
   self.assertNotIn(text,json.dumps(c.execute('SELECT * FROM food_chat_aliases WHERE user_id=%s',(self.uid,)).fetchall(),default=str))
  self.assertEqual(len(self.entries()),1,'Deleting text deliberately keeps the food')
 def test_17_strict_provider_missing_macros_do_not_turn_into_zero(self):
  self.estimate.stop();m=self.root()
  out={'items':[{'name':'Incomplete estimate','amount':'1 bowl','kcal':400,'carbs_g':30,'fat_g':20}]}
  with patch('app.food_photo.ask',return_value=(out,{},'stand-in')):r=self.resolve(m)
  self.assertIn('error',self.result(r));self.assertEqual(self.entries(),[])
  self.estimate.start()
 def test_18_consent_revoked_during_request_drops_late_estimate(self):
  self.own_food();m=self.root('rice and two bowls of mysterious curry')
  def revoke(*args,**kwargs):
   self.assertEqual(self.a.put('/api/profile',json={'ai_ok':False}).status_code,200);return ESTIMATE
  self.model.side_effect=revoke;r=self.resolve(m)
  self.assertIn('consent changed',self.result(r)['error']['message'])
  self.assertEqual([e['kcal'] for e in self.entries()],[130]);self.assertEqual(len(self.a.get('/api/food/foods').json()),1)

 def test_19_invalid_photo_preserves_message_without_provider_or_job(self):
  m=self.root('Photo of food',media='photo')
  self.post(f"/api/food/thread/messages/{m['id']}/resolve",{'images':['not-base64']},status=400)
  self.model.assert_not_called();self.assertEqual(self.entries(),[])
  with db.connect() as c:self.assertFalse(c.execute('SELECT 1 FROM food_chat_jobs WHERE user_id=%s AND message_id=%s',(self.uid,m['id'])).fetchone())
  self.assertTrue(any(x['body']=='Photo of food' for x in self.a.get('/api/food/thread').json()['messages']))

 def test_20_photo_intent_cannot_relog_a_partial_text_meal(self):
  self.own_food();m=self.root('rice and two bowls of mysterious curry')
  self.post(f"/api/food/thread/messages/{m['id']}/resolve",{'images':[JPEG]},status=409)
  self.model.assert_not_called();self.assertEqual([e['kcal'] for e in self.entries()],[130])


 def test_21_review_link_never_catalogued(self):
  m=self.root('https://recipe.example/private?token=fictional')
  r=self.resolve(m);self.look.assert_not_called();self.model.assert_not_called()
  self.assertTrue(self.result(r)['parts'][0]['recipe_url'])
 def test_22_review_ambiguous_followup_kept(self):
  brand={**PLAIN,'brand':'Fictional Brand','name':'Fictional Brand crackers'}
  self.look.side_effect=lambda text:{'kind':'brand','foods':[brand]}
  m=self.root('1 serving Fictional Brand crackers');self.resolve(m)
  second,r=self.send('2');self.assertEqual(r['messages'][-1]['reply_to'],second['id'])
  self.assertEqual(self.a.get('/api/food/thread').status_code,200)
 def test_23_review_paid_estimate_survives_grounding_conflict(self):
  m=self.root()
  with patch('app.food_thread_compose.ground_estimates',side_effect=HTTPException(409,'changed')):r=self.resolve(m)
  result=self.result(r);self.assertFalse(result['processing']);self.assertTrue(result['parts'][0]['drafts'])
  with db.connect() as c:self.assertEqual(c.execute('SELECT state FROM food_chat_jobs WHERE user_id=%s AND message_id=%s',(self.uid,m['id'])).fetchone()['state'],'done')
  self.resolve(m);self.assertEqual(self.model.call_count,1)
 def test_24_review_manual_only_selected_part(self):
  self.own_food();self.a.put('/api/food/thread/preferences',json={'auto_log':False})
  m=self.root('rice and two bowls of mysterious curry');self.resolve(m)
  r=self.post(f"/api/food/thread/messages/{m['id']}/manual",{'part':0,'items':[{'name':'Reviewed rice','kcal':140}], 'confirm':True})
  self.assertEqual([e['name'] for e in self.entries()],['Reviewed rice'])
  self.assertTrue(any(p.get('drafts') and not p.get('logged') for p in self.result(r)['parts']))
 def test_25_review_pending_manual_preserves_known_foods(self):
  self.own_food('Eggs',140)
  m=self.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':"2 eggs and a slice of grandma's cake"},status=201)['message']
  r=self.post(f"/api/food/thread/messages/{m['id']}/manual",{'part':1,'items':[{'name':"Grandma's cake",'kcal':300}],'confirm':True})
  self.assertEqual(sorted(e['name'] for e in self.entries()),['Eggs',"Grandma's cake"])
 def test_26_review_catalog_failure_is_per_part(self):
  bad={**PLAIN,'per100':{**PLAIN['per100'],'protein_g':None}}
  self.look.side_effect=lambda text:{'kind':'plain','foods':[bad if 'rice' in text else PLAIN]}
  m=self.root('200 g rice, 1 medium banana');r=self.resolve(m)
  self.assertTrue(self.entries());self.assertEqual(self.result(r)['pending_count'],1)
 def test_27_review_catalog_switch_and_retry_new(self):
  self.a.put('/api/food/thread/preferences',json={'auto_log':False})
  foods=[{**PLAIN,'name':'First grain'},{**PLAIN,'name':'Second grain'}]
  self.look.side_effect=lambda text:{'kind':'brand','foods':foods}
  m=self.root('1 serving Fictional grain');self.resolve(m)
  self.post(f"/api/food/thread/messages/{m['id']}/choose",{'catalog':0,'portion':{'count':1,'unit':'serving'}})
  r=self.post(f"/api/food/thread/messages/{m['id']}/choose",{'catalog':1,'portion':{'count':1,'unit':'serving'}})
  self.assertEqual(self.result(r)['parts'][0]['entries'][0]['name'],'Second grain')
 def test_28_review_answer_and_edit_cannot_cancel(self):
  m,r=self.send('How many calories have I logged today?')
  self.post('/api/food/thread/cancel',{'client_id':str(m['client_id'])},status=409)
  self.own_food();m,r=self.send('rice');changed,r=self.send('make it half')
  self.post('/api/food/thread/cancel',{'client_id':str(changed['client_id'])},status=409)

 def test_29_explicit_destination_and_replay(self):
  self.own_food();day=(dt.date.today()-dt.timedelta(days=1)).isoformat()
  m,r=self.send('rice',day=day,meal='dinner')
  rows=self.a.get('/api/food/day?d='+day).json()['entries'];self.assertEqual(len(rows),1);self.assertEqual(rows[0]['meal'],'dinner')
  self.assertEqual(self.post('/api/food/thread/messages',{'client_id':m['client_id'],'body':'rice','day':day,'meal':'dinner'})['created'],False)
  self.post('/api/food/thread/messages',{'client_id':m['client_id'],'body':'rice','day':day,'meal':'lunch'},status=409)
  m,r=self.send('Photo of food',media='photo',day=day,meal='dinner')
  self.resolve(m,images=[JPEG]);rows=self.a.get('/api/food/day?d='+day).json()['entries'];self.assertEqual(len(rows),2);self.assertTrue(all(e['meal']=='dinner' for e in rows))

 def test_missing_amount_asks_before_catalog_or_model(self):
  day=(dt.date.today()-dt.timedelta(days=1)).isoformat()
  m,r=self.send('banana',day=day,meal='lunch')
  self.assertIn('How much banana',self.result(r)['text']);self.assertFalse(self.result(r)['can_resolve'])
  self.resolve(m);self.look.assert_not_called();self.model.assert_not_called();self.assertEqual(self.entries(),[])
  following,r=self.send('120 g');self.assertEqual(self.result(r)['day'],day);self.assertEqual(self.result(r)['meal'],'lunch')
  self.assertTrue(self.result(r)['can_resolve']);self.assertIn('banana',self.result(r)['parts'][0]['text'])
  replay=self.post('/api/food/thread/messages',{'client_id':following['client_id'],'body':'120 g'})
  self.assertFalse(replay['created'])
  self.assertEqual(next(x['result'] for x in r['messages'] if x.get('reply_to')==m['id'])['kind'],'continued')

 def test_partial_clarification_keeps_already_logged_food(self):
  self.own_food();original,r=self.send('rice and taco',meal='lunch')
  self.assertEqual(len(self.entries()),1);self.assertIn('What kind of taco',self.result(r)['text'])
  self.own_food('Chicken taco',200)
  _,r=self.send('2 chicken tacos')
  self.assertEqual(sorted(e['kcal'] for e in self.entries()),[130,400])
  self.assertTrue(all(e['meal']=='lunch' for e in self.entries()))
  self.look.assert_not_called();self.model.assert_not_called()

 def test_30_taco_clarifies_before_any_source_guess(self):
  m,r=self.send('taco');result=self.result(r)
  self.assertIn('What kind of taco',result['text']);self.assertIn('how many',result['text'])
  self.assertFalse(result['can_resolve']);self.assertEqual(self.entries(),[])
  self.resolve(m);self.look.assert_not_called();self.model.assert_not_called()
  self.post(f"/api/food/thread/messages/{m['id']}/process",client=self.b,status=404)
  self.look.side_effect=lambda text:{'kind':'plain','foods':[{**PLAIN,'name':'Chicken taco','serving':{'label':'1 taco','g':100}}]}
  follow,r=self.send('2 chicken tacos');self.assertTrue(self.result(r)['can_resolve'])
  self.assertEqual(next(x['result'] for x in r['messages'] if x.get('reply_to')==m['id'])['kind'],'continued')
  r=self.resolve(follow);self.assertEqual(self.result(r)['kind'],'log')
  self.assertEqual(len(self.entries()),1);self.assertEqual(self.entries()[0]['kcal'],200)
  self.resolve(follow);self.assertEqual(len(self.entries()),1);self.model.assert_not_called()

 def test_31_taco_short_answers_keep_count_and_destination(self):
  day=(dt.date.today()-dt.timedelta(days=1)).isoformat()
  self.send('taco',day=day,meal='dinner')
  _,r=self.send('2');self.assertIn('What kind of taco',self.result(r)['text'])
  self.assertNotIn('how many',self.result(r)['text']);self.assertEqual(self.entries(),[])
  m,r=self.send('chicken',day=dt.date.today().isoformat());self.assertEqual(self.result(r)['day'],day);self.assertEqual(self.result(r)['meal'],'dinner')
  replay=self.post('/api/food/thread/messages',{'client_id':m['client_id'],'body':'chicken','day':dt.date.today().isoformat()})
  self.assertFalse(replay['created'],'resolved day must not change immutable request metadata')
  self.look.side_effect=lambda text:{'kind':'plain','foods':[{**PLAIN,'name':'Chicken taco','serving':{'label':'1 taco','g':100}}]}
  self.resolve(m);rows=self.a.get('/api/food/day?d='+day).json()['entries']
  self.assertEqual(len(rows),1);self.assertEqual(rows[0]['kcal'],200);self.assertEqual(rows[0]['meal'],'dinner')
  self.look.assert_called_once();self.assertIn('2',self.look.call_args.args[0]);self.model.assert_not_called()

 def test_32_taco_question_does_not_capture_unrelated_food(self):
  original,_=self.send('taco');_,r=self.send('banana')
  self.assertFalse(self.result(r)['can_resolve'])
  self.assertIn('How much banana',self.result(r)['text'])
  current=self.a.get('/api/food/thread').json()
  original_reply=next(x for x in current['messages'] if x.get('reply_to')==original['id'])
  self.assertEqual(original_reply['result']['parts'][0]['status'],'description')
  self.assertEqual(self.result(r)['parts'][0]['text'],'banana')

 def test_33_taco_filling_first_does_not_assume_one(self):
  self.send('taco');_,r=self.send('chicken')
  self.assertIn('How many tacos',self.result(r)['text']);self.assertFalse(self.result(r)['can_resolve'])
  self.assertEqual(self.entries(),[]);self.look.assert_not_called();self.model.assert_not_called()
  m,r=self.send('2');self.assertTrue(self.result(r)['can_resolve'])
  self.look.side_effect=lambda text:{'kind':'plain','foods':[{**PLAIN,'name':'Chicken taco','serving':{'label':'1 taco','g':100}}]}
  self.resolve(m);self.assertEqual(self.entries()[0]['kcal'],200)
  self.assertIn('chicken',self.look.call_args.args[0]);self.assertIn('2',self.look.call_args.args[0])

 def test_34_taco_revised_filling_keeps_natural_question_history(self):
  original,r=self.send('taco');question=self.result(r)['text']
  self.send('chicken');_,r=self.send('beef')
  self.assertIn('How many',self.result(r)['text']);self.assertEqual(self.entries(),[])
  m,_=self.send('2')
  self.look.side_effect=lambda text:{'kind':'plain','foods':[{**PLAIN,'name':'Beef taco','serving':{'label':'1 taco','g':100}}]}
  self.resolve(m);text=self.look.call_args.args[0]
  self.assertIn('beef',text);self.assertNotIn('chicken',text)
  history=self.a.get('/api/food/thread').json()['messages']
  old=next(x for x in history if x.get('reply_to')==original['id'])
  self.assertEqual(old['result']['kind'],'continued');self.assertEqual(old['result']['text'],question)
  self.assertEqual(old['result']['pending_count'],0)

 def test_35_taco_question_does_not_change_partial_multi_food_flow(self):
  self.own_food();_,r=self.send('taco and rice')
  result=self.result(r)
  self.assertEqual(len(result['parts']),2)
  self.assertFalse(result['can_resolve'])
  self.assertTrue(any(p.get('description') for p in result['parts']),'ready rice logs while the taco question stays pending')
  self.assertEqual(sum(e['kcal'] for e in self.entries()),130)

 def review_send(self,text,draft,context=None):
  return self.send(text,review_only=True,draft_id=draft,**({'context':context} if context else {}))
 def taco_estimate(self):
  return {'items':[{'name':'Chicken tacos','amount':'2 tacos','grams':200,'kcal':400,'protein_g':24,'carbs_g':40,'fat_g':16,'fiber_g':4}],
          'notes':'Typical medium taco size; fictional stand-in, not real inference.','model':'stand-in'}
 def mass_catalog(self):
  return {'kind':'plain','foods':[{**PLAIN,'name':'Taco, corn tortilla, chicken, cheese','serving':{'label':'100 g','g':100}}]}
 def test_36_review_taco_count_then_filling_uses_existing_estimator_when_mass_catalog_cannot_convert(self):
  draft=str(uuid.uuid4());first,_=self.review_send('taco',draft);second,_=self.review_send('2',draft,first['client_id']);third,r=self.review_send('chicken',draft,second['client_id'])
  self.assertEqual(self.entries(),[]);self.assertTrue(self.result(r)['can_resolve'])
  self.look.return_value=self.mass_catalog();self.look.side_effect=None;self.model.return_value=self.taco_estimate()
  r=self.resolve(third);result=self.result(r);self.assertEqual(result['kind'],'preview');self.assertEqual(result['parts'][0]['entries'][0]['kcal'],400);self.assertEqual(self.entries(),[])
  self.model.assert_called_once();self.assertRegex(self.model.call_args.args[0].note,r'2(?:\.0)? chicken taco');self.assertNotIn('Which food and portion',result['text'])
  self.resolve(third);self.model.assert_called_once()
  review=self.post('/api/food/thread/reviews',{'client_id':str(uuid.uuid4()),'draft_id':draft,'messages':[third['id']]})
  self.post(f"/api/food/thread/reviews/{review['id']}/confirm",{'confirm':True,'meal':'dinner'})
  self.assertEqual([e['kcal'] for e in self.entries()],[400]);self.assertIn('AI',str(self.entries()[0]['ref']).upper())
 def test_37_confusion_is_help_not_food_and_explicit_estimate_retains_known_description(self):
  draft=str(uuid.uuid4());self.a.put('/api/profile',json={'ai_ok':False})
  first,_=self.review_send('taco',draft);second,_=self.review_send('2',draft,first['client_id']);third,_=self.review_send('chicken',draft,second['client_id'])
  self.look.return_value=self.mass_catalog();self.look.side_effect=None;r=self.resolve(third);self.assertEqual(self.result(r)['parts'][0]['status'],'quantity');self.model.assert_not_called()
  for phrase in ['No idea what you mean',"I don't understand",'What does that mean?']:
   _,r=self.review_send(phrase,draft,third['client_id']);self.assertEqual(self.result(r)['intent'],'clarification_help');self.assertNotIn('How much idea',self.result(r)['text']);self.assertFalse(self.result(r).get('can_resolve'));self.assertEqual(self.entries(),[])
  self.a.put('/api/profile',json={'ai_ok':True});self.model.return_value=self.taco_estimate();estimate,r=self.review_send('estimate it',draft,third['client_id']);self.assertTrue(self.result(r)['can_resolve'])
  self.look.reset_mock();r=self.resolve(estimate);self.look.assert_not_called();self.model.assert_called_once();self.assertRegex(self.model.call_args.args[0].note,r'2(?:\.0)? chicken taco');self.assertEqual(self.entries(),[])
 def test_38_explicit_ai_button_respects_consent_and_product_choice_without_replacing_known_food(self):
  draft=str(uuid.uuid4());self.look.return_value={'kind':'brand','foods':[{**PLAIN,'name':'Fictional brand taco'}]};self.look.side_effect=None
  m,_=self.review_send('2 fictional brand tacos',draft);r=self.resolve(m);self.model.assert_not_called();self.assertEqual(self.result(r)['parts'][0]['status'],'choose')
  self.post(f"/api/food/thread/messages/{m['id']}/resolve",{'allow_brand_estimate':True,'part':0},client=self.b,status=404)
  self.a.put('/api/profile',json={'ai_ok':False});self.post(f"/api/food/thread/messages/{m['id']}/resolve",{'allow_brand_estimate':True,'part':0},status=403);self.model.assert_not_called()
  self.a.put('/api/profile',json={'ai_ok':True});self.model.return_value=self.taco_estimate();r=self.resolve(m,allow_brand_estimate=True,part=0);self.model.assert_called_once();self.assertEqual(self.entries(),[])
  self.post(f"/api/food/thread/messages/{m['id']}/resolve",{'allow_brand_estimate':True,'part':0},status=409)
 def test_39_failed_estimate_keeps_weight_catalog_and_no_duplicate_ai_work(self):
  draft=str(uuid.uuid4());m,_=self.review_send('2 chicken tacos',draft);self.look.return_value=self.mass_catalog();self.look.side_effect=None;self.model.side_effect=HTTPException(503,'Fictional estimate unavailable')
  r=self.resolve(m);result=self.result(r);self.assertEqual(result['parts'][0]['status'],'quantity');self.assertIn('weight',result['text']);self.assertIn('error',result);self.assertEqual(self.entries(),[])
  self.resolve(m);self.model.assert_called_once()
 def test_40_confusion_without_food_never_looks_up_or_estimates_the_sentence(self):
  _,r=self.send('No idea what you mean');self.assertEqual(self.result(r)['intent'],'clarification_help');self.look.assert_not_called();self.model.assert_not_called();self.assertEqual(self.entries(),[])

# review regressions use the production API and fictional provider/catalog stand-ins
unittest.main()
