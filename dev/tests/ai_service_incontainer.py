"""All-provider budget/concurrency failures use stand-ins, never paid AI."""
import io,json,os,unittest
from types import SimpleNamespace as NS
from unittest.mock import patch,Mock
from fastapi import HTTPException
from app import db,ai_budget as B,coach,coach_chat,food_photo,food_coach,cook_chat

class Service(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with db.connect() as c:
   cls.uids=[c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',(f'zz_test_service_budget_{i}','Fictional budget')).fetchone()['id'] for i in range(3)]
   for uid in cls.uids:c.execute('INSERT INTO profile(user_id,ai_ok) VALUES (%s,true)',(uid,))
 @classmethod
 def tearDownClass(cls):
  with db.connect() as c:
   rows=c.execute('DELETE FROM ai_food_attempts WHERE user_id=ANY(%s) RETURNING day,charged_micros',(cls.uids,)).fetchall()
   for r in rows:c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(r['charged_micros'],r['day']))
   c.execute('DELETE FROM users WHERE id=ANY(%s)',(cls.uids,))
 def setUp(self):
  self.env=patch.dict(os.environ,{'KINETTA_AI_DAILY_USD':'100','KINETTA_AI_USER_DAILY_MICROUSD':'100000000'});self.env.start()
 def tearDown(self):
  with db.connect() as c:c.execute("UPDATE ai_food_attempts SET state='failed' WHERE user_id=ANY(%s) AND state='reserved'",(self.uids,))
  self.env.stop()
 def reserve(self,uid=None):
  with B.scope(uid or self.uids[0]):return B.reserve('gemini-3.1-flash-lite','service-test')
 def refused(self,fn,status=429):
  with self.assertRaises(HTTPException) as e:fn()
  self.assertEqual(e.exception.status_code,status)
 def test_01_concurrency_and_failure_hold(self):
  with patch.dict(os.environ,{'KINETTA_AI_USER_CONCURRENT':'1'}):
   rid=self.reserve();self.refused(self.reserve)
   other=self.reserve(self.uids[1]);B.finish(other)
   with db.connect() as c:before=c.execute('SELECT charged_micros FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()['charged_micros']
   B.finish(rid);again=self.reserve();B.finish(again)
   with db.connect() as c:self.assertEqual(c.execute('SELECT charged_micros FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()['charged_micros'],before)
  with patch.dict(os.environ,{'KINETTA_AI_CONCURRENT':'1'}):
   rid=self.reserve();self.refused(lambda:self.reserve(self.uids[1]));B.finish(rid)
 def test_02_crash_lease_and_late_usage(self):
  with patch.dict(os.environ,{'KINETTA_AI_USER_CONCURRENT':'1'}):
   rid=self.reserve()
   with db.connect() as c:c.execute("UPDATE ai_food_attempts SET lease_until=now()-interval '1 second' WHERE id=%s",(rid,))
   again=self.reserve();B.finish(again)
   B.settle(rid,{'usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':50}})
   B.finish(rid)
   with db.connect() as c:self.assertEqual(c.execute('SELECT state FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()['state'],'measured')
 def test_03_attempt_and_spend_controls(self):
  for name in ('KINETTA_AI_DAILY_ATTEMPTS','KINETTA_AI_USER_DAILY_ATTEMPTS','KINETTA_AI_USER_DAILY_MICROUSD','KINETTA_AI_CONCURRENT'):
   with patch.dict(os.environ,{name:'0'}):self.refused(self.reserve)
   with patch.dict(os.environ,{name:'bad'}):self.refused(self.reserve,503)
 def test_04_gemini_coach_and_question_usage(self):
  def transport(req,timeout=None):
   return io.BytesIO(json.dumps({'candidates':[{'content':{'role':'model','parts':[{'text':'Fictional note'}]}}],
      'usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':20,'thoughtsTokenCount':30}}).encode())
  with B.scope(self.uids[0]),patch('urllib.request.urlopen',side_effect=transport):
   self.assertEqual(coach._gemini({'fictional':'numbers'}),'Fictional note')
   calls,text,usage=coach_chat._gemini_turn([{'role':'user','parts':[{'text':'Fictional question'}]}],[])
   self.assertEqual(text,'Fictional note');self.assertEqual(calls,[])
   with B.scope(self.uids[0],feature='food review'):self.assertEqual(coach._gemini({'fictional':'numbers'}),'Fictional note')
  with db.connect() as c:
   rows=c.execute("SELECT state,input_tokens,thinking_tokens FROM ai_food_attempts WHERE user_id=%s AND kind IN ('coach note','Kit question')",(self.uids[0],)).fetchall()
   self.assertEqual(len(rows),2);self.assertTrue(all(r['state']=='measured' and r['input_tokens']==100 and r['thinking_tokens']==30 for r in rows))
   self.assertEqual(c.execute("SELECT count(*) AS n FROM ai_food_attempts WHERE user_id=%s AND kind='food review' AND state='measured'",(self.uids[0],)).fetchone()['n'],1)
 def test_05_claude_no_hidden_retry_or_fallback(self):
  usage=NS(input_tokens=100,output_tokens=30,cache_creation_input_tokens=0,cache_read_input_tokens=0)
  response=NS(usage=usage,stop_reason='end_turn',content=[NS(type='text',text='Fictional Claude note')])
  create=Mock(return_value=response);client=NS(beta=NS(messages=NS(create=create)))
  with B.scope(self.uids[1]),patch('app.coach.client',return_value=client):self.assertEqual(coach._claude({'fictional':1}),'Fictional Claude note')
  self.assertNotIn('fallbacks',create.call_args.kwargs);self.assertNotIn('betas',create.call_args.kwargs)
  with db.connect() as c:
   row=c.execute("SELECT * FROM ai_food_attempts WHERE user_id=%s AND model='claude-opus-5-5'",(self.uids[1],)).fetchone()
   self.assertEqual(row['state'],'measured');self.assertEqual(row['charged_micros'],1000)
 def test_06_kill_before_provider_and_usda_fallback(self):
  with patch.dict(os.environ,{'KINETTA_AI_ENABLED':'0'}),patch('urllib.request.urlopen') as net:
   self.assertFalse(coach.allowed(self.uids[0]));self.refused(lambda:food_photo.photo(food_photo.PhotoIn(note='fictional soup'),user={'id':self.uids[0]}),503)
   with B.scope(self.uids[0]):self.refused(lambda:coach._gemini({'fictional':1}),503)
   net.assert_not_called()
  with patch('app.cook_chat._usda_products',return_value=[]) as usda:
   cook_chat.product_refs('one box of fictional pasta',self.uids[0]);self.assertEqual(usda.call_count,1)
 def test_07_unpriced_model_and_expired_review(self):
  with patch.dict(os.environ,{'GEMINI_MODEL':'unpriced-model'}),B.scope(self.uids[0]),patch('urllib.request.urlopen') as net:
   self.refused(lambda:coach._gemini({'fictional':1}),503);net.assert_not_called()
  import datetime as dt
  with patch('app.ai_budget.REVIEW_BY',dt.date(2000,1,1)):self.refused(self.reserve,503)

 def test_08_linked_food_metrics_and_nested_scope(self):
  import datetime as dt,uuid
  month=dt.date(1999,1,1);ids=[]
  try:
   with db.connect() as c:
    c.execute('INSERT INTO ai_service_budget(day) VALUES (%s) ON CONFLICT DO NOTHING',(month,))
    for i in range(4):
     key=uuid.uuid4()
     mid=c.execute("""INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state,created)
                       VALUES (%s,%s,'user','Fictional food','1999-01-02T12:00Z','1999-01-02','answered','1999-01-02T12:00Z') RETURNING id""",(self.uids[0],key)).fetchone()['id'];ids.append(mid)
     eid=c.execute("""INSERT INTO food_entries(user_id,day,meal,name,kcal,created) VALUES (%s,'1999-01-02','lunch','Fictional food',100,'1999-01-02T12:00Z') RETURNING id""",(self.uids[0],)).fetchone()['id']
     c.execute('INSERT INTO food_chat_entries VALUES (%s,%s,%s)',(self.uids[0],mid,eid))
     if i==0:
      c.execute("""INSERT INTO ai_food_attempts(id,user_id,day,model,kind,reserved_micros,charged_micros,state,input_tokens,output_tokens,thinking_tokens,request_id)
                    VALUES (%s,%s,%s,'gemini-3.1-flash-lite','food photo',100,100,'measured',100,50,0,%s)""",(uuid.uuid4(),self.uids[0],month,key))
      c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros+100 WHERE day=%s',(month,))
   r=B.report(month);self.assertEqual(r['tracked_items'],4);self.assertEqual(r['items_needing_ai'],1)
   self.assertEqual(r['no_ai_share_of_tracked_items'],.75);self.assertEqual(r['median_tokens_per_tracked_item'],0)
   self.assertEqual(r['recorded_tokens_per_logged_item'],37.5);self.assertEqual(r['cost_per_logging_active_user_usd'],.0001)
   self.assertEqual(r['unattributed_items'],0);self.assertTrue(r['usage_complete'])
   key=uuid.uuid4()
   with B.scope(self.uids[0],key):
    with B.scope(self.uids[0]):rid=B.reserve('gemini-3.1-flash-lite','nested-scope')
    with B.scope(self.uids[1]):other=B.reserve('gemini-3.1-flash-lite','cross-scope')
   B.finish(rid);B.finish(other)
   with db.connect() as c:
    self.assertEqual(c.execute('SELECT request_id FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()['request_id'],key)
    self.assertIsNone(c.execute('SELECT request_id FROM ai_food_attempts WHERE id=%s',(other,)).fetchone()['request_id'])
  finally:
   with db.connect() as c:
    c.execute('DELETE FROM food_entries WHERE user_id=%s AND day=%s',(self.uids[0],dt.date(1999,1,2)))
    c.execute('DELETE FROM food_chat_messages WHERE user_id=%s AND id=ANY(%s)',(self.uids[0],ids))
    c.execute('DELETE FROM ai_food_attempts WHERE user_id=%s AND day=%s',(self.uids[0],month))
    c.execute('DELETE FROM ai_service_budget WHERE day=%s',(month,))
 def test_09_warning_once(self):
  with db.connect() as c:
   before=c.execute("SELECT charged_micros FROM ai_service_budget WHERE day=(now() AT TIME ZONE 'UTC')::date").fetchone()['charged_micros']
   c.execute("UPDATE ai_service_budget SET warned_at=NULL WHERE day=(now() AT TIME ZONE 'UTC')::date")
  cap=before+B.price('gemini-3.1-flash-lite',*B.request_tokens())*2
  output=io.StringIO()
  with patch.dict(os.environ,{'KINETTA_AI_DAILY_USD':str(cap/1_000_000)}),patch('sys.stdout',output):
   rid=self.reserve();B.finish(rid);other=self.reserve();B.finish(other)
  self.assertEqual(output.getvalue().count('AI budget warning'),1)

 def test_10_gemini_retry_refunds_request_sized_holds(self):
  import urllib.error
  seen=[]
  def fail(req,timeout=None):
   seen.append(json.loads(req.data))
   raise urllib.error.HTTPError(req.full_url,503,'busy',{},io.BytesIO())
  with B.scope(self.uids[2]),patch('urllib.request.urlopen',side_effect=fail),patch('time.sleep'):
   with self.assertRaises(ValueError):coach._gemini({'fictional':'short note'})
  self.assertEqual(len(seen),3)
  with db.connect() as c:
   rows=c.execute('SELECT * FROM ai_food_attempts WHERE user_id=%s',(self.uids[2],)).fetchall()
   self.assertEqual(len(rows),3)
   self.assertTrue(all(r['charged_micros']==0 and r['state']=='measured' and r['reserved_micros']<30000 for r in rows))
  self.assertEqual([x['generationConfig']['maxOutputTokens'] for x in seen],[2000]*3)
 def test_11_fraction_default_and_lease_renewal(self):
  with patch.dict(os.environ,{'KINETTA_AI_DAILY_USD':'5','KINETTA_AI_USER_DAILY_MICROUSD':''}):
   with db.connect() as c:
    c.execute("INSERT INTO ai_food_attempts(id,user_id,day,model,kind,reserved_micros,charged_micros,state) VALUES (gen_random_uuid(),%s,current_date,'gemini-3.1-flash-lite','fraction-test',1000000,1000000,'failed')",(self.uids[2],))
    c.execute("UPDATE ai_service_budget SET charged_micros=charged_micros+1000000 WHERE day=current_date")
   self.refused(lambda:self.reserve(self.uids[2]))
  rid=self.reserve()
  with db.connect() as c:c.execute("UPDATE ai_food_attempts SET lease_until=now()+interval '1 second' WHERE id=%s",(rid,))
  B.renew_lease(rid)
  with db.connect() as c:self.assertTrue(c.execute("SELECT lease_until>now()+interval '110 seconds' AS renewed FROM ai_food_attempts WHERE id=%s",(rid,)).fetchone()['renewed'])
  B.finish(rid)
  with db.connect() as c:c.execute("UPDATE ai_food_attempts SET lease_until=now()-interval '1 second' WHERE id=%s",(rid,))
  B.renew_lease(rid)
  with db.connect() as c:self.assertFalse(c.execute('SELECT lease_until>now() AS live FROM ai_food_attempts WHERE id=%s',(rid,)).fetchone()['live'])

unittest.main()
