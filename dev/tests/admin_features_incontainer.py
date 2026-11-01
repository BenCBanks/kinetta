"""Real SQL/API checks on a disposable fictional database; no devices/providers."""
import concurrent.futures
import datetime as dt
import json
import os
import time
import unittest
from unittest.mock import patch
import psycopg
from fastapi.testclient import TestClient
from app import admin_auth,admin_features as F,food_entry_methods as M,auth,db
from app.main import app

DAY=dt.date(2038,6,20)


class Features(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.users=[]
  with db.connect() as c:
   for n in range(6):
    uid=c.execute("INSERT INTO users(login,name,pw_hash,is_admin,created) VALUES(%s,'Fictional feature person',%s,%s,%s) RETURNING id",
      (f'zz_test_features_{n}',auth.hash_pw('fictional feature password'),n==0,DAY-dt.timedelta(days=20))).fetchone()['id']
    cls.users.append(uid);c.execute("INSERT INTO profile(user_id) VALUES(%s)",(uid,))
 @classmethod
 def tearDownClass(cls):
  with db.connect() as c:
   c.execute('DELETE FROM users WHERE id=ANY(%s)',(cls.users,))
   for table in ('admin_feature_keys','admin_feature_salts','admin_feature_counts','admin_feature_state'):c.execute('DELETE FROM '+table)
 def setUp(self):
  self.client=TestClient(app);self.client.headers['Origin']='http://testserver'
  with db.connect() as c:
   token=admin_auth.issue_session(c,self.users[0]);member_token=auth.new_session(c,self.users[1],'fictional feature tests')
   for table in ('admin_feature_keys','admin_feature_salts','admin_feature_counts','admin_feature_state'):c.execute('DELETE FROM '+table)
   c.execute('DELETE FROM activities WHERE user_id=ANY(%s)',(self.users,))
   c.execute('DELETE FROM food_entries WHERE user_id=ANY(%s)',(self.users,))
   c.execute('DELETE FROM food_chat_messages WHERE user_id=ANY(%s)',(self.users,))
   c.execute('UPDATE users SET created=%s WHERE id=ANY(%s)',(DAY-dt.timedelta(days=20),self.users))
   c.execute('UPDATE profile SET welcome_completed_day=NULL,health_setup_day=NULL WHERE user_id=ANY(%s)',(self.users,))
  self.client.cookies.set(admin_auth.COOKIE,token,path='/api')
  self.member=TestClient(app);self.member.headers['Origin']='http://testserver';self.member.cookies.set(auth.COOKIE,member_token)
 def report(self,**params):
  with patch.object(F,'cleanup',return_value=DAY):
   response=self.client.get('/api/admin/features',params=params)
  self.assertEqual(response.status_code,200,response.text);return response.json()
 def test_access_and_fixed_parameters(self):
  self.assertEqual(TestClient(app).get('/api/admin/features').status_code,401)
  self.assertEqual(self.member.get('/api/admin/features').status_code,403)
  for query in ('period=365','period=1','bucket=quarter','period=7%3Bdelete'):
   self.assertEqual(self.client.get('/api/admin/features?'+query).status_code,422)
  for payload in ({'feature':'unknown'},{'feature':'kit','user_id':123},{'feature':'kit','text':'PRIVATE_SENTINEL'}):
   self.assertEqual(self.member.post('/api/features/open',json=payload).status_code,422)
 def test_collection_off_does_not_write(self):
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'0'}):
   self.assertFalse(self.member.get('/api/features/state').json()['enabled'])
   for feature in ('kit','welcome_complete','health_setup'):
    self.assertEqual(self.member.post('/api/features/open',json={'feature':feature}).status_code,204)
  with db.connect() as c:
   for table in ('admin_feature_keys','admin_feature_salts','admin_feature_counts','admin_feature_state'):
    self.assertEqual(c.execute('SELECT count(*) AS n FROM '+table).fetchone()['n'],0)
   self.assertIsNone(c.execute('SELECT welcome_completed_day FROM profile WHERE user_id=%s',(self.users[1],)).fetchone()['welcome_completed_day'])
 def test_concurrent_duplicate_opens_and_identifiers(self):
  def opened(_):
   with db.connect() as c:F.collect(c,self.users[1],'kit')
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(opened,range(8)))
   with db.connect() as c:
    row=c.execute("SELECT people,opens FROM admin_feature_counts WHERE feature='kit'").fetchone();self.assertEqual(row,{'people':1,'opens':1})
    for uid in self.users[2:4]:F.collect(c,uid,'kit')
    row=c.execute("SELECT people,opens FROM admin_feature_counts WHERE feature='kit'").fetchone();self.assertEqual(row,{'people':3,'opens':3})
    key1=c.execute("SELECT digest FROM admin_feature_keys WHERE feature='kit' ORDER BY digest LIMIT 1").fetchone()['digest']
    F.collect(c,self.users[1],'settings')
    key2=c.execute("SELECT digest FROM admin_feature_keys WHERE feature='settings'").fetchone()['digest'];self.assertNotEqual(key1,key2)
    cols={r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name='admin_feature_counts'")}
    self.assertEqual(cols,{'feature','day','people','opens'})
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
     with c.transaction():
      c.execute('SET LOCAL ROLE fit_readers')
      c.execute('SELECT * FROM admin_feature_counts')
 def test_rotation_and_thirteen_calendar_month_retention(self):
  with db.connect() as c:
   today=c.execute("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS d").fetchone()['d'];limit=F.month_before(today,13)
   c.execute("INSERT INTO admin_feature_salts VALUES(%s,%s)",(today-dt.timedelta(days=1),b'x'*32))
   c.execute("INSERT INTO admin_feature_keys(day,feature,digest) VALUES(%s,'kit',%s)",(today-dt.timedelta(days=1),b'y'*32))
   for day in (limit,limit-dt.timedelta(days=1)):c.execute("INSERT INTO admin_feature_counts VALUES('kit',%s,3,5)",(day,))
   F.cleanup(c)
   self.assertEqual(c.execute('SELECT count(*) AS n FROM admin_feature_keys').fetchone()['n'],0)
   self.assertEqual(c.execute('SELECT count(*) AS n FROM admin_feature_salts').fetchone()['n'],0)
   self.assertEqual(c.execute('SELECT day FROM admin_feature_counts').fetchone()['day'],limit)
  self.assertEqual(F.month_before(dt.date(2028,3,31),13),dt.date(2027,2,28))
 def test_one_person_three_days_stays_hidden(self):
  with db.connect() as c:
   for ago in range(3):c.execute("INSERT INTO admin_feature_counts VALUES('kit',%s,1,20)",(DAY-dt.timedelta(days=ago),))
   rows=F.view_rows(c,DAY-dt.timedelta(days=6),DAY+dt.timedelta(days=1),DAY-dt.timedelta(days=13),DAY-dt.timedelta(days=30),DAY)
  row=next(r for r in rows if r['feature']=='view_kit');self.assertIsNone(row['people']);self.assertIsNone(row['uses']);self.assertEqual(row['trend'],[])
 def test_visible_days_only_and_unavailable_12_month_comparison(self):
  with db.connect() as c:
   c.execute("INSERT INTO admin_feature_counts VALUES('kit',%s,3,9),('kit',%s,2,70)",(DAY,DAY-dt.timedelta(days=1)))
   start,end,previous=F.periods(DAY,'12m');row=next(r for r in F.view_rows(c,start,end,previous,F.month_before(DAY,13),DAY) if r['feature']=='view_kit')
  self.assertEqual((row['people'],row['uses'],row['metric']),(3,9,'user-days'));self.assertIsNone(row['change']);self.assertEqual(len(row['trend']),1)
 def add_activities(self,n):
  with db.connect() as c:
   for uid in self.users[:n]:c.execute("INSERT INTO activities(user_id,name,sport,source,start_time,created) VALUES(%s,'PRIVATE_TITLE_SENTINEL','run','track',%s,%s)",(uid,DAY,DAY))
 def test_small_cells_then_three_and_hidden_trend_remainder(self):
  for n in (0,1,2,3):
   with db.connect() as c:c.execute('DELETE FROM activities WHERE user_id=ANY(%s)',(self.users,))
   self.add_activities(n);report=self.report(period='7',bucket='day');row=next(r for r in report['rows'] if r['feature']=='activity_source_track')
   self.assertEqual(row['uses'],3 if n==3 else None);self.assertEqual(row['people'],3 if n==3 else None)
   self.assertTrue(all(x['uses'] is None for x in row['trend']));self.assertIsNone(row['change'])
   serialized=json.dumps(report)
   for forbidden in ('PRIVATE_TITLE_SENTINEL','zz_test_features','Fictional feature person','user_id','login','pw_hash','token','question_text'):
    self.assertNotIn(forbidden,serialized)
 def test_setup_first_date_and_funnel_coverage_maturity(self):
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}),patch.object(F,'cleanup',return_value=DAY):
   for feature in ('welcome_complete','health_setup'):
    for _ in range(2):self.assertEqual(self.member.post('/api/features/open',json={'feature':feature}).status_code,204)
  with db.connect() as c:
   self.assertEqual(c.execute('SELECT welcome_completed_day,health_setup_day FROM profile WHERE user_id=%s',(self.users[1],)).fetchone(),{'welcome_completed_day':DAY,'health_setup_day':DAY})
   c.execute('UPDATE admin_feature_state SET started=%s',(DAY-dt.timedelta(days=30),))
   c.execute('UPDATE profile SET welcome_completed_day=%s WHERE user_id=ANY(%s)',(DAY,self.users[:3]))
   c.execute('UPDATE users SET created=%s WHERE id=%s',(DAY-dt.timedelta(days=4),self.users[-1]))
  report=self.report(period='30');welcome=next(s for s in report['funnel'] if s['key']=='welcome');self.assertEqual(welcome['count'],3)
  week2=next(s for s in report['funnel'] if s['key']=='week2');self.assertIsNone(week2['count'])
  with db.connect() as c:
   c.execute('UPDATE admin_feature_state SET started=%s',(DAY,))
  self.assertEqual(next(s for s in self.report(period='30')['funnel'] if s['key']=='welcome')['state'],'unavailable history')
 def test_all_range_bucket_combinations(self):
  for period in ('7','30','90','12m'):
   for bucket in ('day','week','month'):
    report=self.report(period=period,bucket=bucket);self.assertEqual(report['period'],period)
 def test_forward_methods_off_then_exact_action_and_retry(self):
  entry={'day':str(DAY),'name':'PRIVATE_FOOD_SENTINEL','kcal':100,'source':'off','client_id':'features-method-001','entry_method':'barcode'}
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'0'}):
   r=self.member.post('/api/food/entries',json=[entry]);self.assertEqual(r.status_code,200,r.text);old=r.json()['ids'][0]
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):
   r=self.member.post('/api/food/entries',json=[{**entry,'client_id':'features-method-002','entry_method':'search'}]);self.assertEqual(r.status_code,200,r.text);eid=r.json()['ids'][0]
   r=self.member.post('/api/food/entries',json=[{**entry,'client_id':'features-method-002','entry_method':'barcode'}]);self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['ids'],[eid])
  with db.connect() as c:
   rows={r['id']:r['entry_method'] for r in c.execute('SELECT id,entry_method FROM food_entries WHERE id=ANY(%s)',([old,eid],))}
  self.assertEqual(rows,{old:None,eid:'search'})
  self.assertEqual(self.member.post('/api/food/entries',json=[{**entry,'entry_method':'PRIVATE_ARBITRARY_VALUE'}]).status_code,422)
 def test_copy_method_is_action_not_original_provenance(self):
  with db.connect() as c:
   c.execute("INSERT INTO food_entries(user_id,day,name,kcal,source,entry_method) VALUES(%s,%s,'Fictional meal',100,'dish','recipe')",(self.users[1],DAY-dt.timedelta(days=1)))
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):
   r=self.member.post('/api/food/copy',json={'from_day':str(DAY-dt.timedelta(days=1)),'to_day':str(DAY)});self.assertEqual(r.status_code,200,r.text)
  with db.connect() as c:
   row=c.execute('SELECT source,entry_method FROM food_entries WHERE user_id=%s AND day=%s',(self.users[1],DAY)).fetchone()
  self.assertEqual(row,{'source':'dish','entry_method':'copy_yesterday'})
 def test_mixed_review_preserves_each_new_entry_method(self):
  with db.connect() as c:
   ids=[c.execute("INSERT INTO food_entries(user_id,day,name,kcal) VALUES(%s,%s,'Fictional review',100) RETURNING id",(self.users[1],DAY)).fetchone()['id'] for _ in range(4)]
   sources=[({'result':{'input':{'kind':'photo'}}},{'parts':[{'entries':[{}]}]}),
            ({'result':{'review_request':{'items':[{}]}}},{'parts':[{'entries':[{'entry_method':'barcode'}]}]}),
            ({'result':{'receipt':True}},{'parts':[{'entries':[{}]}]}),
            ({'result':{'review_request':{'did':12}}},{'parts':[{'entries':[{}]}]})]
   with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):M.review(c,self.users[1],ids,sources)
   self.assertEqual([r['entry_method'] for r in c.execute('SELECT entry_method FROM food_entries WHERE id=ANY(%s) ORDER BY id',(ids,))],['photo','barcode','unknown','recipe'])
   with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):M.stamp(c,self.users[2],ids,'manual')
   self.assertEqual(c.execute('SELECT entry_method FROM food_entries WHERE id=%s',(ids[0],)).fetchone()['entry_method'],'photo')
   unstamped=c.execute("INSERT INTO food_entries(user_id,day,name,kcal) VALUES(%s,%s,'Fictional unstamped food',100) RETURNING id",(self.users[1],DAY)).fetchone()['id']
   with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):
    M.stamp(c,self.users[2],[unstamped],'manual')
    self.assertIsNone(c.execute('SELECT entry_method FROM food_entries WHERE id=%s',(unstamped,)).fetchone()['entry_method'])
    M.stamp(c,self.users[1],[unstamped],'barcode')
    self.assertEqual(c.execute('SELECT entry_method FROM food_entries WHERE id=%s',(unstamped,)).fetchone()['entry_method'],'barcode')
 def test_complementary_activity_and_food_suppression(self):
  self.add_activities(3)
  with db.connect() as c:
   c.execute("INSERT INTO activities(user_id,name,sport,source,start_time,created) VALUES(%s,'Fictional manual run','run','manual',%s,%s)",(self.users[3],DAY,DAY))
   for n,uid in enumerate(self.users[:4]):c.execute("INSERT INTO food_entries(user_id,day,name,kcal,created,entry_method) VALUES(%s,%s,'Fictional food',100,%s,%s)",(uid,DAY,DAY,'barcode' if n==3 else 'search'))
  report=self.report(period='7');rows={r['feature']:r for r in report['rows']}
  for key in ('activity_source_track','activity_source_manual','activity_sport_run','food'):
   self.assertIsNone(rows[key]['uses']);self.assertIsNone(rows[key]['people']);self.assertIsNone(rows[key]['change'])
  self.assertEqual(rows['food_method_search']['uses'],3);self.assertIsNone(rows['food_method_barcode']['uses'])
 def test_stage_off_strips_metadata_and_toggle_replay_identity(self):
  import uuid
  body={'client_id':str(uuid.uuid4()),'draft_id':str(uuid.uuid4()),'items':[{'day':str(DAY),'name':'Fictional staged food','kcal':100,'entry_method':'barcode'}]}
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'0'}):
   r=self.member.post('/api/food/thread/reviews/items',json=body);self.assertEqual(r.status_code,200,r.text)
  with db.connect() as c:
   values=c.execute('SELECT result FROM food_chat_messages WHERE user_id=%s AND client_id=%s',(self.users[1],body['client_id'])).fetchone()['result']
   self.assertNotIn('entry_method',json.dumps(values))
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):
   r=self.member.post('/api/food/thread/reviews/items',json=body);self.assertEqual(r.status_code,200,r.text)
   body['client_id']=str(uuid.uuid4());r=self.member.post('/api/food/thread/reviews/items',json=body);self.assertEqual(r.status_code,200,r.text)
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'0'}):
   r=self.member.post('/api/food/thread/reviews/items',json=body);self.assertEqual(r.status_code,200,r.text)
 def test_every_signed_in_account_uses_the_operator_switch_without_preferences(self):
  anonymous=TestClient(app);anonymous.headers['Origin']='http://testserver'
  self.assertEqual(anonymous.get('/api/features/state').status_code,401)
  self.assertEqual(anonymous.post('/api/features/open',json={'feature':'kit'}).status_code,401)
  self.assertNotIn('/api/features/preferences',app.openapi()['paths'])
  self.assertIn(self.member.put('/api/features/preferences',json={'enabled':True}).status_code,(404,405))
  with db.connect() as c:
   columns={r['column_name'] for r in c.execute("SELECT column_name FROM information_schema.columns WHERE table_name='profile'")}
   self.assertFalse({'feature_metrics_ok','feature_metrics_at','feature_metrics_version'}&columns)
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):
   self.assertEqual(self.member.get('/api/features/state').json(),{'enabled':True})
   for feature in ('kit','welcome_complete'):
    self.assertEqual(self.member.post('/api/features/open',json={'feature':feature}).status_code,204)
  with db.connect() as c:
   self.assertEqual(c.execute("SELECT people,opens FROM admin_feature_counts WHERE feature='kit'").fetchone(),{'people':1,'opens':1})
   self.assertIsNotNone(c.execute('SELECT welcome_completed_day FROM profile WHERE user_id=%s',(self.users[1],)).fetchone()['welcome_completed_day'])
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'0'}):
   self.assertEqual(self.member.get('/api/features/state').json(),{'enabled':False})
   self.assertEqual(self.member.post('/api/features/open',json={'feature':'heatmap'}).status_code,204)
  with db.connect() as c:
   self.assertIsNone(c.execute("SELECT 1 FROM admin_feature_counts WHERE feature='heatmap'").fetchone())
 def test_records_current_state_and_signup_cohort_include_ordinary_accounts(self):
  self.add_activities(3)
  with db.connect() as c:
   c.execute('UPDATE profile SET segment_boards=true WHERE user_id=ANY(%s)',(self.users[:3],))
  report=self.report(period='30');rows={r['feature']:r for r in report['rows']}
  self.assertEqual(rows['activity_source_track']['uses'],3)
  self.assertGreaterEqual(rows['leaderboards']['people'],3)
  accounts=next(r for r in report['funnel'] if r['key']=='accounts')
  self.assertEqual(accounts['count'],len(self.users));self.assertEqual(accounts['eligible'],len(self.users))
 def test_successful_counters_have_no_account_linked_request_row(self):
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}),patch('app.request_log._write') as writer:
   self.assertEqual(self.member.post('/api/features/open',json={'feature':'kit'}).status_code,204)
   time.sleep(.05);self.assertEqual(writer.call_count,0,'Counter calls must not create a second per-person usage history')
   self.assertEqual(self.member.get('/api/features/state').status_code,200)
   time.sleep(.05);self.assertTrue(any(call.args[0]['route']=='/api/features/state' for call in writer.call_args_list))
 def test_concurrent_setup_and_view_collection_finishes(self):
  def opened(n):
   client=TestClient(app);client.headers['Origin']='http://testserver';client.cookies.set(auth.COOKIE,self.member.cookies.get(auth.COOKIE))
   return client.post('/api/features/open',json={'feature':'welcome_complete' if n%2 else 'kit'}).status_code
  with patch.dict(os.environ,{'KINETTA_FEATURE_METRICS':'1'}):
   with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    futures=[pool.submit(opened,n) for n in range(12)]
    self.assertEqual([f.result(timeout=5) for f in futures],[204]*12)
 def test_daily_view_trends_follow_calendar_order(self):
  with db.connect() as c:
   for ago in (0,2,1):c.execute("INSERT INTO admin_feature_counts VALUES('kit',%s,3,6)",(DAY-dt.timedelta(days=ago),))
   row=next(r for r in F.view_rows(c,DAY-dt.timedelta(days=6),DAY+dt.timedelta(days=1),DAY-dt.timedelta(days=13),DAY-dt.timedelta(days=30),DAY) if r['feature']=='view_kit')
  self.assertEqual([r['day'] for r in row['trend']],[DAY-dt.timedelta(days=2),DAY-dt.timedelta(days=1),DAY])



if __name__=='__main__':unittest.main(verbosity=2)
