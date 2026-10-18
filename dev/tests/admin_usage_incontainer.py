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
  for path in ('logins','usage'):
   self.assertEqual(guest.get('/api/admin/'+path).status_code,401)
  self.assertEqual(guest.post('/api/login',json={'login':'zz_test_usage_admin','password':PW}).status_code,200)
  for path in ('logins','usage'):self.assertEqual(guest.get('/api/admin/'+path).status_code,403)
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
