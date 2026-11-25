"""Authentication audit, admin-only metrics and retention on a disposable database."""
import datetime as dt
import os
import secrets
import time
import unittest
from unittest.mock import patch
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from app import auth,db,admin_auth,admin_usage
from app.main import app
PW='fictional password for usage tests'

class Usage(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  with db.connect() as c:
   cls.uid=c.execute("INSERT INTO users(login,name,pw_hash,is_admin) VALUES ('zz_test_usage_admin','Usage Admin',%s,true) RETURNING id",(auth.hash_pw(PW),)).fetchone()['id']
   cls.member=c.execute("INSERT INTO users(login,name,pw_hash) VALUES ('zz_test_usage_member','Usage Member',%s) RETURNING id",(auth.hash_pw(PW),)).fetchone()['id']
   for uid in (cls.uid,cls.member):c.execute('INSERT INTO profile(user_id) VALUES (%s)',(uid,))
 @classmethod
 def tearDownClass(cls):
  with db.connect() as c:c.execute("DELETE FROM users WHERE login LIKE 'zz_test_usage%%'")
 def setUp(self):
  self.client=TestClient(app);self.client.headers['Origin']='http://testserver'
  with db.connect() as c:
   c.execute('DELETE FROM admin_attempts');c.execute('DELETE FROM admin_login_events WHERE user_id=ANY(%s)',([self.uid,self.member],));c.execute('DELETE FROM admin_account_days WHERE user_id=ANY(%s)',([self.uid,self.member],))
   token=admin_auth.issue_session(c,self.uid)
  self.client.cookies.set(admin_auth.COOKIE,token,path='/api')
 def events(self,uid=None):
  with db.connect() as c:return c.execute('SELECT channel,outcome,stage FROM admin_login_events WHERE user_id=%s ORDER BY id',(uid or self.member,)).fetchall()
 def test_access_and_bounds(self):
  guest=TestClient(app)
  for path in ('logins','usage','readiness'):
   self.assertEqual(guest.get('/api/admin/'+path).status_code,401)
  self.assertEqual(guest.post('/api/login',json={'login':'zz_test_usage_admin','password':PW}).status_code,200)
  for path in ('logins','usage','readiness'):self.assertEqual(guest.get('/api/admin/'+path).status_code,403)
  for query in ('days=0','days=91','before=0','account=-1','outcome=unknown'):
   self.assertEqual(self.client.get('/api/admin/logins?'+query).status_code,422)
  self.assertEqual(self.client.get('/api/admin/usage?days=91').status_code,422)
 def test_web_app_failures_and_limits(self):
  c=TestClient(app);payload={'login':'zz_test_usage_member','password':PW}
  self.assertEqual(c.post('/api/login',json={**payload,'password':'incorrect'}).status_code,401)
  self.assertEqual(c.post('/api/login',json=payload).status_code,200)
  self.assertEqual(c.post('/api/login',json={**payload,'app':True}).status_code,200)
  with patch('app.auth.too_many',return_value=True):self.assertEqual(c.post('/api/login',json=payload).status_code,429)
  self.assertEqual([(e['channel'],e['outcome']) for e in self.events()],[('web','failure'),('web','success'),('app','success'),('web','limited')])
  # Failed passwords survive the authentication transaction rollback, but never store the supplied text.
  with db.connect() as con:
   cols={r['column_name'] for r in con.execute("SELECT column_name FROM information_schema.columns WHERE table_name='admin_login_events'")}
  self.assertEqual(cols,{'id','user_id','channel','outcome','stage','created'})
 def test_admin_mfa_results(self):
  c=TestClient(app);c.headers['Origin']='http://testserver'
  with patch.dict(os.environ,{'KINETTA_ADMIN_MFA':'on'}):
   r=c.post('/api/admin/login',json={'login':'zz_test_usage_admin','password':PW});self.assertEqual(r.status_code,200,r.text)
   seed=r.json()['setup_key'];self.assertTrue(seed)
   self.assertEqual(c.post('/api/admin/verify',json={'code':'invalid-code'}).status_code,401)
   r=c.post('/api/admin/verify',json={'code':admin_auth.totp(seed,int(time.time()//30))});self.assertEqual(r.status_code,200,r.text)
  events=self.events(self.uid)
  self.assertEqual([(e['outcome'],e['stage']) for e in events],[('success','session'),('challenge','password'),('failure','verification'),('success','session')])
 def test_unknown_username_and_pagination(self):
  c=TestClient(app);self.assertEqual(c.post('/api/login',json={'login':'zz_test_usage_unknown_secret','password':'incorrect'}).status_code,401)
  with db.connect() as con:
   row=con.execute('SELECT user_id FROM admin_login_events ORDER BY id DESC LIMIT 1').fetchone();self.assertIsNone(row['user_id'])
   for i in range(56):admin_usage.record_login(con,self.member,outcome='failure')
   con.execute("INSERT INTO admin_login_events(user_id,channel,outcome,stage,created) VALUES (%s,'web','failure','password',now()-interval '91 days')",(self.member,))
  path=f'/api/admin/logins?account={self.member}&outcome=failure'
  first=self.client.get(path).json();self.assertEqual(len(first['items']),50);self.assertTrue(first['before'])
  second=self.client.get(path+'&before='+str(first['before'])).json();self.assertEqual(len(second['items']),6);self.assertIsNone(second['before'])
  self.assertFalse({x['id'] for x in first['items']}&{x['id'] for x in second['items']})
  self.assertTrue(all(x['login']=='zz_test_usage_member' for x in first['items']))
  with db.connect() as con:self.assertEqual(con.execute("SELECT count(*) AS n FROM admin_login_events WHERE created<now()-interval '90 days'").fetchone()['n'],0)
 def test_active_days_and_metric_deltas(self):
  before=self.client.get('/api/admin/usage?days=7');self.assertEqual(before.status_code,200,before.text);before=before.json()
  c=TestClient(app);self.assertEqual(c.post('/api/login',json={'login':'zz_test_usage_member','password':PW}).status_code,200)
  self.assertEqual(c.get('/api/me').status_code,200);self.assertEqual(c.get('/api/me').status_code,200)
  with db.connect() as con:
   self.assertEqual(con.execute('SELECT count(*) AS n FROM admin_account_days WHERE user_id=%s',(self.member,)).fetchone()['n'],1)
   # Historic workout / food dates still count as records added today. No contents reach the portal.
   aid=con.execute("INSERT INTO activities(user_id,source,source_id,sport,name,start_time) VALUES (%s,'manual','zz_usage','run','private workout title',now()-interval '400 days') RETURNING id",(self.member,)).fetchone()['id']
   fid=con.execute("INSERT INTO food_entries(user_id,day,meal,name,amount,unit,kcal,source) VALUES (%s,current_date-400,'lunch','private food title',1,'serving',100,'quick') RETURNING id",(self.member,)).fetchone()['id']
   job=con.execute("INSERT INTO imports(user_id,label,status) VALUES (%s,'private file name','failed') RETURNING id",(self.member,)).fetchone()['id']
  try:
   after=self.client.get('/api/admin/usage?days=7');self.assertEqual(after.status_code,200,after.text);after=after.json()
   for key in ('active_accounts','signins','workouts','food_entries'):self.assertEqual(after['counts'][key],before['counts'][key]+1,key)
   self.assertEqual(after['imports']['failed'],before['imports']['failed']+1)
   self.assertEqual(len(after['daily']),7);self.assertTrue(any(row['active'] is None for row in after['daily'][:-1]))
   self.assertNotIn('private',str(after));self.assertEqual(after['zone'],'UTC')
  finally:
   with db.connect() as con:
    con.execute('DELETE FROM activities WHERE id=%s',(aid,));con.execute('DELETE FROM food_entries WHERE id=%s',(fid,));con.execute('DELETE FROM imports WHERE id=%s',(job,))
 def test_signup_funnel_counts_only_matured_cohort_and_returns_no_account_data(self):
  before=self.client.get('/api/admin/usage?days=30');self.assertEqual(before.status_code,200,before.text)
  ids=[]
  with db.connect() as con:
   for suffix,age,verified in [('activity',10,9),('boundary-food',12,None),('late-activity',11,None),('recent-food',2,1)]:
    row=con.execute("""INSERT INTO users(login,name,pw_hash,created,email,email_verified_at)
      VALUES (%s,%s,%s,now()-(%s*interval '1 day'),%s,
        CASE WHEN %s::int IS NULL THEN NULL ELSE now()-(%s*interval '1 day') END) RETURNING id""",
      ('zz_test_usage_funnel_'+suffix,'PRIVATE_SIGNUP_NAME_SENTINEL',auth.hash_pw(PW),age,
       'private-'+suffix+'@example.invalid',verified,verified)).fetchone()
    ids.append(row['id'])
   con.execute("""INSERT INTO activities(user_id,source,source_id,sport,name,start_time,created)
      SELECT id,'manual','funnel-activity','run','PRIVATE_ACTIVITY_SENTINEL',created+interval '3 days',created+interval '3 days'
      FROM users WHERE id=%s""",(ids[0],))
   con.execute("""INSERT INTO food_entries(user_id,day,meal,name,amount,unit,kcal,source,created)
      SELECT id,(created+interval '7 days')::date,'lunch','PRIVATE_FOOD_SENTINEL',1,'serving',100,'quick',created+interval '7 days'
      FROM users WHERE id=%s""",(ids[1],))
   con.execute("""INSERT INTO activities(user_id,source,source_id,sport,name,start_time,created)
      SELECT id,'manual','funnel-late','run','PRIVATE_LATE_SENTINEL',created+interval '8 days',created+interval '8 days'
      FROM users WHERE id=%s""",(ids[2],))
   con.execute("""INSERT INTO food_entries(user_id,day,meal,name,amount,unit,kcal,source,created)
      SELECT id,(created+interval '1 day')::date,'lunch','PRIVATE_RECENT_SENTINEL',1,'serving',100,'quick',created+interval '1 day'
      FROM users WHERE id=%s""",(ids[3],))
  after=self.client.get('/api/admin/usage?days=30');self.assertEqual(after.status_code,200,after.text)
  funnel=after.json()['signup_funnel'];baseline=before.json()['signup_funnel']
  self.assertEqual(funnel['signed_up']-baseline['signed_up'],4)
  self.assertEqual(funnel['email_confirmed']-baseline['email_confirmed'],2)
  self.assertEqual(funnel['first_workout_or_food_7d']-baseline['first_workout_or_food_7d'],2)
  for key in ('signed_up','email_confirmed','first_workout_or_food_7d'):self.assertIsInstance(funnel[key],int)
  self.assertNotIn('PRIVATE_',str(after.json()))
 def test_overview_email_health_and_kit_spend_are_aggregate_only(self):
  before_mail=self.client.get('/api/admin/readiness').json()['email_health']
  before_spend=self.client.get('/api/admin/usage?days=1').json()['kit_spend']
  marker=secrets.token_hex(8);event_ids=[];attempt_ids=[]
  with db.connect() as con:
   today=con.execute("SELECT (now() AT TIME ZONE 'UTC')::date AS day").fetchone()['day']
   month_start=today.replace(day=1);last_month=month_start-dt.timedelta(days=1)
   for day in {today,month_start,last_month}:
    con.execute('INSERT INTO ai_service_budget(day) VALUES (%s) ON CONFLICT DO NOTHING',(day,))
   for state in ('sent','delivered','bounced','failed'):
    eid='zz_test_signup7_'+marker+'_'+state;event_ids.append(eid)
    con.execute('INSERT INTO admin_mail_events(id,provider_id,state) VALUES (%s,%s,%s)',(eid,'fictional-'+marker+'-'+state,state))
   old='zz_test_signup7_'+marker+'_old';event_ids.append(old)
   con.execute("INSERT INTO admin_mail_events(id,provider_id,state,created) VALUES (%s,%s,'delivered',now()-interval '8 days')",(old,'fictional-'+marker+'-old'))
   rows=[(today,'Kit conversation',100_000),(today,'food chat daily note',200_000),
         (today,'food chat',800_000),
         (month_start,'weekly review',300_000),(today,'recipe review',900_000),
         (last_month,'Kit conversation',700_000)]
   for day,kind,charge in rows:
    aid=secrets.token_hex(16);attempt_ids.append(aid)
    con.execute("""INSERT INTO ai_food_attempts(id,user_id,day,model,kind,reserved_micros,charged_micros)
                   VALUES (%s,%s,%s,'gemini-3.8-flash',%s,%s,%s)""",(aid,self.member,day,kind,charge,charge))
  try:
   mail=self.client.get('/api/admin/readiness').json()['email_health']
   spend=self.client.get('/api/admin/usage?days=1').json()['kit_spend']
   for state in ('sent','delivered','bounced','failed'):self.assertEqual(mail[state],before_mail[state]+1,state)
   self.assertAlmostEqual(spend['today_usd']-before_spend['today_usd'],.3 if today!=month_start else .6,places=6)
   self.assertAlmostEqual(spend['month_usd']-before_spend['month_usd'],.6,places=6)
   self.assertEqual(spend['zone'],'UTC')
   self.assertEqual(set(mail),{'sent','delivered','bounced','failed'})
   self.assertEqual(set(spend),{'today_usd','month_usd','zone'})
   self.assertNotIn(marker,str(mail)+str(spend))
  finally:
   with db.connect() as con:
    con.execute('DELETE FROM admin_mail_events WHERE id=ANY(%s)',(event_ids,))
    con.execute('DELETE FROM ai_food_attempts WHERE id=ANY(%s)',(attempt_ids,))
 def test_sql_denial_and_account_deletion(self):
  role='zz_test_usage_reader';password=secrets.token_urlsafe(24)
  with db.connect() as c:
   c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
   uid=c.execute("INSERT INTO users(login,name,pw_hash) VALUES ('zz_test_usage_delete','Delete Test',%s) RETURNING id",(auth.hash_pw(PW),)).fetchone()['id']
   admin_usage.record_login(c,uid);admin_usage.opened(c,uid)
  try:
   with psycopg.connect(db._conninfo(role,password),autocommit=True) as reader:
    for table in ('admin_login_events','admin_account_days','admin_metrics_state'):
     with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute('SELECT * FROM '+table)
   with db.connect() as c:
    c.execute('DELETE FROM users WHERE id=%s',(uid,))
    for table in ('admin_login_events','admin_account_days'):self.assertEqual(c.execute('SELECT count(*) AS n FROM '+table+' WHERE user_id=%s',(uid,)).fetchone()['n'],0)
  finally:
   with db.connect() as c:c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))

unittest.main()
