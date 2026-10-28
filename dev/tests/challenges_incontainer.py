"""Fictional participants: aggregate privacy, explicit joining, dates, limits, lifecycle and retention."""
import datetime as dt,json,unittest,uuid,os,threading,time,io
from PIL import Image
from concurrent.futures import ThreadPoolExecutor
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,auth,challenges as C,notify,api_mydata,api_account
from app.main import app

class Challenges(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.pw=auth.hash_pw('fictional challenge testing phrase')
 def setUp(self):
  self.ids=[];self.clients=[];self.now=dt.datetime.now(dt.timezone.utc)
  with db.connect() as c:
   for n in range(3):
    uid=c.execute('INSERT INTO users(login,name,pw_hash,created) VALUES(%s,%s,%s,now()-interval \'1 year\') RETURNING id',('zz_test_ch_'+uuid.uuid4().hex[:12],'PRIVATE REAL NAME',self.pw)).fetchone()['id'];self.ids.append(uid)
    c.execute("INSERT INTO profile(user_id,tz,units,protein_target) VALUES(%s,'America/New_York','metric',123)",(uid,));token=auth.new_session(c,uid,'fictional challenge');client=TestClient(app);client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'});client.cookies.set(auth.COOKIE,token);self.clients.append(client)
  self.anon=TestClient(app)
 def tearDown(self):
  with db.connect() as c:
   for uid in self.ids:api_account.erase(c,{'id':uid,'sql_role':None})
  for uid in self.ids:api_account.erase_files(uid)
 def make(self,kind='distance',who=0,**fields):
  today=self.now.astimezone(C.ZoneInfo('America/New_York')).date()
  body={'kind':kind,'period':'custom','start':str(today-dt.timedelta(days=10)),'end':str(today+dt.timedelta(days=3)),'target':80 if kind=='distance' else 4,'unit':'km','sports':['run','walk'],'request_id':uuid.uuid4().hex,**fields}
  r=self.clients[who].post('/api/challenges',json=body);self.assertEqual(r.status_code,200,r.text);return r.json(),body
 def get(self,code,who=0):
  r=self.clients[who].get('/api/challenges/'+code);self.assertEqual(r.status_code,200,r.text);return r.json()
 def activity(self,who=0,at=None,sport='run',seconds=600,distance=10000,source='manual',device=None):
  with db.connect() as c:return c.execute("INSERT INTO activities(user_id,sport,name,description,private_note,start_time,distance_m,moving_s,elapsed_s,source,device,visibility) VALUES(%s,%s,'PRIVATE WORKOUT','PRIVATE DESCRIPTION','PRIVATE NOTE',%s,%s,%s,%s,%s,%s,'me') RETURNING id",(self.ids[who],sport,at or self.now-dt.timedelta(hours=2),distance,seconds,seconds,source,device)).fetchone()['id']
 def food(self,who=0,day=None,protein=150,unknown=False):
  with db.connect() as c:return c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES(%s,%s,'PRIVATE MEAL',9999,%s,%s) RETURNING id",(self.ids[who],day or self.now.astimezone(C.ZoneInfo('America/New_York')).date(),protein,json.dumps({'unknown_nutrients':['protein_g']} if unknown else {}))).fetchone()['id']
 def join(self,code,who=1):
  with patch('app.notify._push_later'):r=self.clients[who].post('/api/challenges/'+code+'/join',json={})
  self.assertEqual(r.status_code,200,r.text);return r.json()
 def test_explicit_join_and_strict_aggregate_allowlist_never_friend(self):
  self.activity(0,source='garmin_connect',device='Forerunner 965');self.activity(1);self.food(0);q,_=self.make();code=q['code']
  before=self.clients[1].get('/api/challenges/'+code).json();self.assertFalse(before['member']);self.assertNotIn('people',before);self.assertNotIn('self',before)
  public=self.anon.get('/api/challenges/'+code).json();self.assertNotIn('people',public);self.assertNotIn('self',public)
  result=self.join(code);self.assertEqual(len(result['people']),2);self.assertEqual(set(result['people'][0]),{'username','photo','value','complete'});self.assertTrue(result['manual']);self.assertEqual(result['garmin_sources'],['Garmin Forerunner 965']);self.assertEqual(result['self']['value'],10)
  for word in ('PRIVATE','9999','protein_target','distance_m','start_time','activity_id'):self.assertNotIn(word,json.dumps(result))
  with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM friendships WHERE requester=ANY(%s) OR addressee=ANY(%s)',(self.ids,self.ids)).fetchone()['n'],0)
  page=self.anon.get('/challenge/'+code);self.assertEqual(page.status_code,200);self.assertIn('noindex',page.text);self.assertNotIn('PRIVATE',page.text);self.assertIn('invite-only',page.text)
 def test_fixed_templates_and_create_replay_are_validated(self):
  q,body=self.make();again=self.clients[0].post('/api/challenges',json=body);self.assertEqual(again.status_code,200);self.assertEqual(again.json()['code'],q['code']);body['target']=99;self.assertEqual(self.clients[0].post('/api/challenges',json=body).status_code,409)
  for body in [{'kind':'weight','target':1},{'kind':'distance','target':1,'name':'arbitrary name'},{'kind':'distance','target':1,'sports':[]}]:
   body['request_id']=uuid.uuid4().hex;self.assertIn(self.clients[0].post('/api/challenges',json=body).status_code,(400,422))
  for period in ('this_week','next_week','this_month','next_month'):
   b=C.Create(kind='distance',period=period,target=80,request_id=uuid.uuid4().hex)
   start,end=C.dates(b,dt.date(2026,10,28));self.assertGreaterEqual((end-start).days+1,3);self.assertLessEqual((end-start).days+1,62)
  for start,end in [(dt.date.today(),dt.date.today()+dt.timedelta(days=1)),(dt.date.today()+dt.timedelta(days=31),dt.date.today()+dt.timedelta(days=35))]:
   body={'kind':'distance','period':'custom','target':1,'start':str(start),'end':str(end),'request_id':uuid.uuid4().hex};self.assertEqual(self.clients[0].post('/api/challenges',json=body).status_code,400)
 def test_activity_thresholds_and_edits_deletion_update_immediately(self):
  short=self.activity(seconds=599);long=self.activity(seconds=600);q,_=self.make('activities');self.assertEqual(self.get(q['code'])['self']['value'],1)
  with db.connect() as c:c.execute('UPDATE activities SET moving_s=601,elapsed_s=601 WHERE id=%s',(short,))
  self.assertEqual(self.get(q['code'])['self']['value'],2)
  with db.connect() as c:c.execute('DELETE FROM activities WHERE id=%s',(long,))
  self.assertEqual(self.get(q['code'])['self']['value'],1)
  days,_=self.make('active_days');self.assertEqual(self.get(days['code'])['self']['value'],1)
 def test_distance_sports_manual_note_and_unit_conversion(self):
  self.activity(distance=1609.344,sport='walk');self.activity(distance=50000,sport='ride');q,_=self.make(unit='mi',sports=['walk']);self.assertAlmostEqual(self.get(q['code'])['self']['value'],1,places=3);self.assertTrue(self.get(q['code'])['manual'])
 def test_food_and_protein_only_share_days_with_private_target_and_unknowns(self):
  today=self.now.astimezone(C.ZoneInfo('America/New_York')).date();self.food(day=today);self.food(day=today-dt.timedelta(days=2));self.food(day=today-dt.timedelta(days=3),protein=0)
  food,_=self.make('food_days');self.assertEqual(self.get(food['code'])['self']['value'],3)
  protein,_=self.make('protein_days');self.assertEqual(self.get(protein['code'])['self']['value'],2)
  self.food(day=today,unknown=True);self.assertEqual(self.get(protein['code'])['self']['value'],1)
  with db.connect() as c:c.execute('UPDATE profile SET protein_target=NULL WHERE user_id=%s',(self.ids[1],))
  r=self.clients[1].post('/api/challenges/'+protein['code']+'/join',json={});self.assertEqual(r.status_code,409);self.assertIn('your own protein target',r.text)
  joined=self.join(food['code']);self.assertNotIn('protein_target',json.dumps(joined));self.assertNotIn('PRIVATE',json.dumps(joined));self.assertNotIn('9999',json.dumps(joined))
 def test_per_participant_local_days_cover_month_boundary_and_fall_dst(self):
  # A first-November UTC workout can still belong to October in New York.
  start=dt.date(2026,11,1);end=dt.date(2026,11,3);q,_=self.make('active_days',target=3);self.join(q['code'])
  with db.connect() as c:c.execute('UPDATE challenges SET start_day=%s,end_day=%s WHERE code=%s',(start,end,q['code']))
  with db.connect() as c:c.execute("UPDATE profile SET tz='Europe/London' WHERE user_id=%s",(self.ids[1],))
  for who in (0,1):
   for at in ('2026-11-01T03:30:00+00:00','2026-11-01T05:30:00+00:00','2026-11-01T06:30:00+00:00'):self.activity(who,dt.datetime.fromisoformat(at))
  later=dt.datetime(2026,11,5,tzinfo=dt.timezone.utc)
  with db.connect() as c:
   row=c.execute('SELECT * FROM challenges WHERE code=%s',(q['code'],)).fetchone();self.assertEqual(C.progress(c,row,self.ids[0],later)['value'],1);self.assertEqual(C.progress(c,row,self.ids[1],later)['value'],1)
   c.execute("UPDATE challenges SET kind='activities' WHERE id=%s",(row['id'],));row=c.execute('SELECT * FROM challenges WHERE code=%s',(q['code'],)).fetchone();self.assertEqual(C.progress(c,row,self.ids[0],later)['value'],2);self.assertEqual(C.progress(c,row,self.ids[1],later)['value'],3)
   c.execute("UPDATE profile SET tz='Invalid/Stored' WHERE user_id=%s",(self.ids[1],));fallback=C.progress(c,row,self.ids[1],later);c.execute('UPDATE profile SET tz=%s WHERE user_id=%s',(db.DEFAULT_TZ,self.ids[1]));self.assertEqual(fallback,C.progress(c,row,self.ids[1],later))
 def test_completed_workout_crossing_midnight_counts_on_its_start_day(self):
  q,_=self.make('activities');aid=self.activity(at=dt.datetime(2026,11,4,4,55,tzinfo=dt.timezone.utc),seconds=1200)
  with db.connect() as c:
   c.execute("UPDATE challenges SET start_day='2026-11-01',end_day='2026-11-03' WHERE code=%s",(q['code'],));row=c.execute('SELECT * FROM challenges WHERE code=%s',(q['code'],)).fetchone();later=dt.datetime(2026,11,4,6,tzinfo=dt.timezone.utc)
   self.assertEqual(C.progress(c,row,self.ids[0],later)['value'],1,'A completed workout belongs to its local start day even if it ends after the period')
   c.execute('UPDATE challenges SET ended_at=%s WHERE id=%s',(dt.datetime(2026,11,4,5,tzinfo=dt.timezone.utc),row['id']));row=c.execute('SELECT * FROM challenges WHERE code=%s',(q['code'],)).fetchone();self.assertEqual(C.progress(c,row,self.ids[0],later)['value'],0,'Ending early does not add a workout completed after that stop')
 def test_leave_remove_and_blocks_hide_people_without_raw_record_access(self):
  q,_=self.make();code=q['code'];self.join(code,1);self.join(code,2)
  with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[1],self.ids[2]))
  self.assertEqual(len(self.get(code,1)['people']),2);self.assertEqual(len(self.get(code,2)['people']),2)
  self.assertEqual(self.clients[1].post('/api/challenges/'+code+'/leave',json={}).status_code,200);self.assertEqual(len(self.get(code)['people']),2)
  self.assertEqual(self.clients[1].post('/api/challenges/'+code+'/join',json={}).status_code,404)
  self.assertEqual(self.clients[2].post('/api/challenges/'+code+'/remove',json={'username':self.get(code)['creator']}).status_code,404)
  login=self.clients[2].get('/api/me').json()['login'];self.assertEqual(self.clients[0].post('/api/challenges/'+code+'/remove',json={'username':login}).status_code,200);self.assertEqual(len(self.get(code)['people']),1);self.assertEqual(self.clients[2].post('/api/challenges/'+code+'/join',json={}).status_code,404)
 def test_active_caps_include_upcoming_and_enforce_50_member_limit(self):
  first=None
  for n in range(5):q,_=self.make(period='next_week' if n==4 else 'custom');first=first or q
  r=self.clients[0].post('/api/challenges',json={'kind':'distance','target':80,'request_id':uuid.uuid4().hex});self.assertEqual(r.status_code,409)
  with db.connect() as c:
   for n in range(49):
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_ch_'+uuid.uuid4().hex[:12],'Fictional member',self.pw)).fetchone()['id'];self.ids.append(uid);c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,));c.execute('INSERT INTO challenge_members(challenge_id,user_id) SELECT id,%s FROM challenges WHERE code=%s',(uid,first['code']))
  self.assertEqual(self.clients[1].post('/api/challenges/'+first['code']+'/join',json={}).status_code,409)
 def test_end_early_closes_joins_and_retention_purges_relations(self):
  q,_=self.make();code=q['code'];self.join(code);self.assertEqual(self.clients[1].post('/api/challenges/'+code+'/end',json={}).status_code,404)
  self.assertEqual(self.clients[0].post('/api/challenges/'+code+'/end',json={}).status_code,200);self.assertTrue(self.get(code)['self']['finished']);self.assertEqual(self.clients[2].post('/api/challenges/'+code+'/join',json={}).status_code,409)
  with db.connect() as c:
   cid=C.accessible(c,code)['id'];self.assertEqual(C.purge(c,self.now+dt.timedelta(days=89)),0);self.assertEqual(C.purge(c,self.now+dt.timedelta(days=91)),1);self.assertEqual(c.execute('SELECT count(*) AS n FROM challenge_members WHERE challenge_id=%s',(cid,)).fetchone()['n'],0)
  self.assertEqual(self.anon.get('/challenge/'+code).status_code,404)
 def test_notifications_are_opt_in_once_only_and_never_include_private_names(self):
  q,_=self.make();code=q['code'];self.join(code)
  with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM notifications WHERE challenge_id=(SELECT id FROM challenges WHERE code=%s)',(code,)).fetchone()['n'],0)
  self.clients[0].put('/api/notifications/settings',json={'challenge_joins':True,'challenge_reminders':True,'challenge_finished':True});self.join(code,2)
  with patch('app.notify._push_later'):
   with db.connect() as c:
    row=C.accessible(c,code);c.execute('UPDATE challenges SET end_day=%s WHERE id=%s',(self.now.astimezone(C.ZoneInfo('America/New_York')).date()+dt.timedelta(days=3),row['id']));C.process(c,row['id'],self.now);C.process(c,row['id'],self.now)
   notes=self.clients[0].get('/api/notifications').json()['items'];challenge=[x for x in notes if x['kind'].startswith('challenge_')];self.assertEqual(len(challenge),2);self.assertNotIn('PRIVATE',json.dumps(challenge))
   with db.connect() as c:c.execute('UPDATE challenges SET ended_at=now() WHERE id=%s',(row['id'],));C.process(c,row['id'],self.now+dt.timedelta(seconds=5));C.process(c,row['id'],self.now+dt.timedelta(seconds=5))
  with db.connect() as c:self.assertEqual(c.execute("SELECT count(*) AS n FROM notifications WHERE challenge_id=%s AND kind='challenge_finished'",(row['id'],)).fetchone()['n'],1)
 def test_native_push_uses_stand_in_and_respects_live_opt_out_and_leave(self):
  q,_=self.make();code=q['code'];self.clients[0].put('/api/notifications/settings',json={'challenge_joins':True})
  self.join(code);sent=[]
  with db.connect() as c:
   row=C.accessible(c,code);nid=c.execute("SELECT id FROM notifications WHERE challenge_id=%s AND kind='challenge_join'",(row['id'],)).fetchone()['id'];token=auth.new_session(c,self.ids[0],'fictional challenge push',channel='app')
   c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s)",('a'*64,self.ids[0],auth.token_hash(token)))
  self.assertEqual(notify.push(nid,send=lambda device,payload:sent.append(payload) or True),1);self.assertEqual(sent[0]['url'],'/me/challenges/'+code);self.assertNotIn('PRIVATE',json.dumps(sent))
  self.clients[0].put('/api/notifications/settings',json={'challenge_joins':False});self.assertEqual(notify.push(nid,send=lambda *_:self.fail('Disabled challenge push sent')),0)
  self.clients[0].put('/api/notifications/settings',json={'challenge_joins':True});self.clients[1].post('/api/challenges/'+code+'/leave',json={});self.assertFalse(notify.push(nid,send=lambda *_:self.fail('Departed participant push sent')))
 def test_unconfirmed_and_suspended_creators_are_inactive(self):
  q,_=self.make();code=q['code']
  for sql in ("UPDATE users SET needs_email_confirm=true WHERE id=%s","UPDATE users SET needs_email_confirm=false,suspended_at=now() WHERE id=%s"):
   with db.connect() as c:c.execute(sql,(self.ids[0],))
   self.assertEqual(self.anon.get('/api/challenges/'+code).status_code,404);self.assertEqual(self.anon.get('/challenge/'+code).status_code,404)
 def test_permitted_photos_need_membership_and_disappear_after_block_or_leave(self):
  q,_=self.make();code=q['code'];self.join(code);image=io.BytesIO();Image.new('RGB',(8,8),'#82AAF6').save(image,format='JPEG')
  with db.connect() as c:
   c.execute('INSERT INTO profile_photos(user_id,img) VALUES(%s,%s)',(self.ids[1],image.getvalue()));c.execute("UPDATE users SET photo_v='fictional-v1' WHERE id=%s",(self.ids[1],));login=c.execute('SELECT login::text AS login FROM users WHERE id=%s',(self.ids[1],)).fetchone()['login']
  path='/api/challenges/'+code+'/photo/'+login
  self.assertEqual(self.clients[0].get(path).status_code,200);self.assertEqual(self.clients[2].get(path).status_code,404);self.assertEqual(self.anon.get(path).status_code,401)
  row=next(p for p in self.get(code)['people'] if p['username']==login);self.assertEqual(row['photo'],'fictional-v1')
  with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[0],self.ids[1]))
  self.assertEqual(self.clients[0].get(path).status_code,404);self.assertFalse(any(p['username']==login for p in self.get(code)['people']))
  self.clients[1].post('/api/challenges/'+code+'/leave',json={});self.assertEqual(self.clients[1].get(path).status_code,404)
 def test_own_export_excludes_links_and_contains_no_other_participant(self):
  q,_=self.make();self.join(q['code'])
  with db.connect() as c:
   rows=c.execute(api_mydata.TABLES['challenges'],(self.ids[0],)).fetchall();self.assertTrue(rows);self.assertNotIn(q['code'],json.dumps(rows,default=str));members=c.execute(api_mydata.TABLES['challenge_members'],(self.ids[1],)).fetchall();self.assertEqual(len(members),1)
   for table in ('challenges','challenge_members'):self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s',(table,)).fetchone()['relrowsecurity'])
 def test_actual_reader_sees_only_own_membership_and_cannot_read_invitation_codes(self):
  q,_=self.make();self.join(q['code']);role='zz_test_ch_reader_'+uuid.uuid4().hex[:8];password='fictional reader testing phrase'
  try:
   with db.connect() as c:
    c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids[1]))
   with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as reader:
    members=reader.execute('SELECT user_id FROM challenge_members').fetchall();self.assertEqual(members,[{'user_id':self.ids[1]}]);self.assertEqual(reader.execute('SELECT id,user_id FROM challenges').fetchall(),[])
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
     with reader.transaction():reader.execute('SELECT code FROM challenges')
    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
     with reader.transaction():reader.execute('DELETE FROM challenge_members')
  finally:
   with db.connect() as c:c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids[1],));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
 def test_simultaneous_creates_cannot_overrun_the_five_challenge_cap(self):
  body=None
  for _ in range(4):_,body=self.make()
  barrier=threading.Barrier(3)
  def attempt():
   candidate={**body,'request_id':uuid.uuid4().hex};barrier.wait();return self.clients[0].post('/api/challenges',json=candidate).status_code
  with ThreadPoolExecutor(max_workers=2) as pool:
   a=pool.submit(attempt);b=pool.submit(attempt);barrier.wait();self.assertEqual(sorted([a.result(5),b.result(5)]),[200,409])
 def test_real_signup_confirmation_preserves_yes_no_choice_and_expired_links(self):
  from app import account_email
  q,_=self.make();tokens={};mail={'KINETTA_SIGNUP':'open','KINETTA_MAX_ACCOUNTS':'','KINETTA_RESEND_KEY':'fictional-mail','KINETTA_MAIL_FROM':'Kinetta <mail@example.test>','KINETTA_MAIL_REPLY_TO':'help@example.test','KINETTA_PUBLIC_URL':'https://example.test','KINETTA_MAIL_WEBHOOK_SECRET':'fictional-webhook'}
  def confirmation(background,c,uid,name,email,**kw):tokens[uid]=account_email._token(c,uid,'verify_email',30,email)
  with patch.dict(os.environ,mail),patch('app.account_email.confirmation',side_effect=confirmation),patch('app.auth.client_ip',return_value='fictional-ch-signup-'+uuid.uuid4().hex):
   for want in (True,False):
    client=TestClient(app);login='zz_test_ch_signup_'+uuid.uuid4().hex[:8]
    r=client.post('/api/signup',json={'name':'PRIVATE SIGNUP NAME','login':login,'email':login+'@example.test','password':'fictional challenge signup phrase','age_ok':True,'challenge_code':q['code'],'challenge_join':want});self.assertEqual(r.status_code,200,r.text)
    with db.connect() as c:
     uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];self.ids.append(uid);self.assertFalse(C.member(c,C.accessible(c,q['code'])['id'],uid))
    r=client.post('/api/account/email/confirm',json={'token':tokens[uid]});self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['challenge_joined'],q['code'] if want else None)
    with db.connect() as c:self.assertEqual(bool(C.member(c,C.accessible(c,q['code'])['id'],uid)),want)
    self.assertEqual(client.post('/api/challenges/signup/continue',json={}).json(),{'joined':None})
   self.assertIn('/signup?challenge=',self.anon.get('/challenge/'+q['code']).text)
   with patch.dict(os.environ,{'KINETTA_MAX_ACCOUNTS':'0'}):self.assertIn('/beta?challenge=',self.anon.get('/challenge/'+q['code']).text)
  # A stale intent cannot undo successful confirmation or create a friendship.
  with db.connect() as c:
   c.execute("INSERT INTO signup_join_intents(user_id,kind,code) VALUES(%s,'challenge','fictional-revoked-code')",(self.ids[2],));self.assertIsNone(C.consume_signup(c,self.ids[2]));self.assertFalse(c.execute('SELECT 1 FROM signup_join_intents WHERE user_id=%s',(self.ids[2],)).fetchone())
 def test_waitlist_and_invitation_retain_explicit_challenge_choice(self):
  from app import account_email,api_beta
  q,_=self.make();tokens={};email='zz_test_ch_wait_'+uuid.uuid4().hex[:8]+'@example.test';mail={'KINETTA_SIGNUP':'waitlist','KINETTA_BETA_SIGNUP':'1','KINETTA_RESEND_KEY':'fictional-mail','KINETTA_MAIL_FROM':'Kinetta <mail@example.test>','KINETTA_MAIL_REPLY_TO':'help@example.test','KINETTA_PUBLIC_URL':'https://example.test','KINETTA_MAIL_WEBHOOK_SECRET':'fictional-webhook'}
  def confirmation(background,c,uid,name,email,**kw):tokens[uid]=account_email._token(c,uid,'verify_email',30,email)
  with patch.dict(os.environ,mail),patch('app.account_email.confirmation',side_effect=confirmation),patch('app.auth.client_ip',return_value='fictional-ch-wait-'+uuid.uuid4().hex):
   r=self.anon.post('/api/beta',json={'name':'PRIVATE WAITLIST NAME','email':email,'phone':'iphone','challenge_code':q['code'],'challenge_join':True});self.assertEqual(r.status_code,200,r.text)
   with db.connect() as c:
    row=c.execute('SELECT id,challenge_code,challenge_join FROM beta_requests WHERE lower(email)=lower(%s)',(email,)).fetchone();self.assertEqual((row['challenge_code'],row['challenge_join']),(q['code'],True));c.execute('UPDATE users SET is_admin=true WHERE id=%s',(self.ids[0],))
   invitation=api_beta.beta_invite(row['id'],{'id':self.ids[0],'login':'fictional_admin','is_admin':True});token=invitation['url'].rsplit('/',1)[-1];info=self.anon.get('/api/join/'+token);self.assertEqual(info.status_code,200,info.text);self.assertEqual(info.json()['challenge'],{'code':q['code'],'title':q['title'],'join_default':True});self.assertNotIn('PRIVATE',info.text)
   client=TestClient(app);login='zz_test_ch_invited_'+uuid.uuid4().hex[:8];r=client.post('/api/join',json={'token':token,'name':'Fictional member','login':login,'email':email,'password':'fictional invited challenge phrase','challenge_code':q['code'],'challenge_join':True});self.assertEqual(r.status_code,200,r.text)
   with db.connect() as c:uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];self.ids.append(uid);self.assertFalse(C.member(c,C.accessible(c,q['code'])['id'],uid))
   self.assertEqual(client.post('/api/account/email/confirm',json={'token':tokens[uid]}).status_code,200)
   with db.connect() as c:self.assertTrue(C.member(c,C.accessible(c,q['code'])['id'],uid))
  with patch.dict(os.environ,{'KINETTA_SIGNUP':'invite','KINETTA_BETA_SIGNUP':'0'}):
   page=self.anon.get('/challenge/'+q['code']).text;self.assertIn('Ask the server owner',page);self.assertNotIn('/beta?challenge=',page)
 def test_worker_retries_when_a_join_commits_during_account_lock_acquisition(self):
  q,_=self.make();code=q['code']
  with db.connect() as c:cid=C.accessible(c,code)['id']
  class JoinedWhileWaiting:
   def __init__(proxy,connection):proxy.connection=connection;proxy.joined=False
   def execute(proxy,statement,params=()):
    if 'ORDER BY id FOR KEY SHARE' in statement and not proxy.joined:
     proxy.joined=True
     with db.connect() as other:C.join_challenge(other,self.ids[1],code)
    return proxy.connection.execute(statement,params)
  with db.connect() as c:
   C.process(JoinedWhileWaiting(c),cid)
   self.assertEqual(c.execute('SELECT checked_at FROM challenges WHERE id=%s',(cid,)).fetchone()['checked_at'].timestamp(),0)
  with db.connect() as c:
   C.process(c,cid)
   self.assertGreater(c.execute('SELECT checked_at FROM challenges WHERE id=%s',(cid,)).fetchone()['checked_at'].timestamp(),0)
 def test_worker_and_account_erasure_do_not_invert_locks(self):
  q,_=self.make();self.join(q['code']);entered=threading.Event();release=threading.Event();finished=threading.Event();pids={};failures=[];original=C.zone_of
  def paused(*args):entered.set();self.assertTrue(release.wait(5));return original(*args)
  def worker():
   try:
    with db.connect() as c:pids['worker']=c.execute('SELECT pg_backend_pid() AS pid').fetchone()['pid'];C.process(c,C.accessible(c,q['code'])['id'])
   except Exception as e:failures.append(e)
  def erase():
   try:
    with db.connect() as c:c.execute("SET statement_timeout='6s'");pids['erase']=c.execute('SELECT pg_backend_pid() AS pid').fetchone()['pid'];api_account.erase(c,{'id':self.ids[0],'sql_role':None})
   except Exception as e:failures.append(e)
   finally:finished.set()
  with patch('app.challenges.zone_of',side_effect=paused),patch('app.notify._push_later'):
   a=threading.Thread(target=worker);a.start();self.assertTrue(entered.wait(3));b=threading.Thread(target=erase);b.start()
   try:
    blocked=False;until=time.monotonic()+3
    while time.monotonic()<until and not finished.is_set():
     if 'erase' in pids:
      with db.connect() as c:blocked=pids['worker'] in c.execute('SELECT pg_blocking_pids(%s) AS ids',(pids['erase'],)).fetchone()['ids']
      if blocked:break
     time.sleep(.02)
    self.assertTrue(blocked)
   finally:release.set();a.join(6);b.join(6)
  self.assertFalse(a.is_alive());self.assertFalse(b.is_alive());self.assertEqual(failures,[])
  with db.connect() as c:self.assertFalse(c.execute('SELECT 1 FROM challenges WHERE code=%s',(q['code'],)).fetchone())

if __name__=='__main__':unittest.main(verbosity=2)
