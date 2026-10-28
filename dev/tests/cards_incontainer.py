"""Public-card field allowlists, revocation, explicit friendship and signup boundaries using fictional SQL."""
import io,json,uuid,unittest
from unittest.mock import patch
from PIL import Image
from fastapi.testclient import TestClient
from app import db,auth,cards
from app.main import app
class Cards(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.pw=auth.hash_pw('fictional card testing phrase')
 def setUp(self):
  self.ids=[];self.clients=[]
  with db.connect() as c:
   for _ in range(3):
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_card_'+uuid.uuid4().hex[:10],'SECRET REAL NAME NEVER PUBLIC',self.pw)).fetchone()['id'];self.ids.append(uid);c.execute("INSERT INTO profile(user_id,tz,units) VALUES(%s,'America/New_York','imperial')",(uid,));t=auth.new_session(c,uid,'fictional test');client=TestClient(app);client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'});client.cookies.set(auth.COOKIE,t);self.clients.append(client)
   c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,visibility,distance_m,moving_s,elapsed_s,avg_hr,calories,private_note) VALUES(%s,'run','SECRET ACTIVITY TITLE',now(),'manual','me',10000,3600,3600,155,900,'SECRET NOTE')",(self.ids[0],))
  self.guest=TestClient(app);self.settings=self.clients[0].get('/api/card').json();self.code=self.settings['url'].rsplit('/',1)[-1]
 def tearDown(self):
  from app.api_account import erase,erase_files
  with db.connect() as c:
   for uid in self.ids:erase(c,{'id':uid,'sql_role':None})
  for uid in self.ids:erase_files(uid)
 def enable(self,**kw):
  body={'enabled':True,'photo':False,'sports':True,'stats':[],'allow_requests':True}|kw;r=self.clients[0].put('/api/card',json=body);self.assertEqual(r.status_code,200,r.text);return r.json()
 def test_off_by_default_owner_preview_public_revoked_and_strict_settings(self):
  self.assertFalse(self.settings['enabled']);self.assertEqual(self.settings['stats'],[]);self.assertFalse(self.settings['photo']);self.assertEqual(self.clients[0].get('/api/card/image.png').status_code,200)
  for path in ('/api/cards/','/card/'):
   self.assertEqual(self.guest.get(path+self.code).status_code,404)
  for stats in [['weight'],['distance_year']*2,['distance_year','activities_year','active_days_year']]:self.assertEqual(self.clients[0].put('/api/card',json={'enabled':True,'stats':stats}).status_code,422)
  self.assertEqual(self.guest.put('/api/card',json={'enabled':True}).status_code,401)
  self.assertEqual(self.clients[0].put('/api/card',json={'enabled':True,'user_id':self.ids[1]}).status_code,422)
 def test_anonymous_preview_and_png_never_disclose_unselected_private_fields(self):
  self.enable();d=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(set(d),{'username','sports','stats','garmin_sources','allow_requests','url'});self.assertEqual(d['stats'],[]);self.assertEqual(d['sports'],['run'])
  page=self.guest.get('/card/'+self.code);self.assertEqual(page.status_code,200);self.assertIn('noindex',page.headers['x-robots-tag']);self.assertIn('og:image',page.text);self.assertIn('/image.png',page.text)
  for secret in ('SECRET REAL','SECRET ACTIVITY','SECRET NOTE','avg_hr','calories','weight','bio'):self.assertNotIn(secret,page.text+json.dumps(d))
  pic=self.guest.get('/card/'+self.code+'/image.png');self.assertEqual(pic.status_code,200);self.assertEqual(Image.open(io.BytesIO(pic.content)).size,(1080,1350));self.assertEqual(pic.headers['cache-control'],'no-store')
 def test_stats_allowlist_owner_only_and_private_totals_are_deliberate(self):
  d=self.enable(stats=['distance_year','activities_year'])['preview'];self.assertEqual(len(d['stats']),2);self.assertEqual(d['stats'][1]['value'],1);self.assertAlmostEqual(d['stats'][0]['value'],6.2);self.assertNotIn('health',str(d));self.assertEqual(self.clients[1].get('/api/card').json()['preview']['stats'],[])
  self.assertEqual(self.guest.get('/card/'+self.code+'/photo').status_code,404)
 def test_photo_is_deliberately_selected_and_public_relationship_is_current(self):
  out=io.BytesIO();Image.new('RGB',(40,40),'#1F55D0').save(out,format='JPEG')
  with db.connect() as c:
   c.execute('INSERT INTO profile_photos(user_id,img) VALUES(%s,%s)',(self.ids[0],out.getvalue()));c.execute("UPDATE users SET photo_v='fictional-photo' WHERE id=%s",(self.ids[0],))
  self.enable();self.assertNotIn('photo',self.guest.get('/api/cards/'+self.code).json());self.assertEqual(self.guest.get('/card/'+self.code+'/photo').status_code,404)
  self.enable(photo=True);self.assertIn('photo',self.guest.get('/api/cards/'+self.code).json());self.assertEqual(self.guest.get('/card/'+self.code+'/photo').status_code,200)
  self.assertEqual(self.guest.get('/card/'+self.code+'/image.png').status_code,200)
  self.clients[1].post('/api/cards/'+self.code+'/request');page=self.clients[1].get('/card/'+self.code).text;self.assertIn('Request sent',page);self.assertNotIn('id="public-card-request"',page)
  self.enable(photo=False);self.assertEqual(self.guest.get('/card/'+self.code+'/photo').status_code,404)
 def test_rotate_disable_and_suspension_immediately_stop_all_public_surfaces(self):
  self.enable();old=self.code;new=self.clients[0].post('/api/card/new').json()['url'].rsplit('/',1)[-1];self.assertNotEqual(old,new)
  for suffix in ('','/image.png','/photo'):self.assertEqual(self.guest.get('/card/'+old+suffix).status_code,404)
  self.code=new;self.enable(enabled=False);self.assertEqual(self.guest.get('/api/cards/'+new).status_code,404);self.enable()
  with db.connect() as c:c.execute('UPDATE users SET suspended_at=now() WHERE id=%s',(self.ids[0],))
  self.assertEqual(self.guest.get('/api/cards/'+new).status_code,404)
 def test_card_requests_stay_pending_even_if_the_owner_requested_first(self):
  self.enable();r=self.clients[1].post('/api/cards/'+self.code+'/request');self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['status'],'request_sent');self.assertEqual(self.clients[1].post('/api/cards/'+self.code+'/request').json()['status'],'request_sent');self.assertEqual(self.clients[0].get('/api/card').json()['waiting'],1)
  with db.connect() as c:
   row=c.execute('SELECT status FROM friendships WHERE requester=%s AND addressee=%s',(self.ids[1],self.ids[0])).fetchone();self.assertEqual(row['status'],'pending');c.execute('INSERT INTO friendships(requester,addressee) VALUES(%s,%s)',(self.ids[0],self.ids[2]))
  self.assertEqual(self.clients[2].post('/api/cards/'+self.code+'/request').json()['status'],'incoming')
  with db.connect() as c:self.assertEqual(c.execute('SELECT status FROM friendships WHERE requester=%s AND addressee=%s',(self.ids[0],self.ids[2])).fetchone()['status'],'pending')
 def test_block_both_directions_and_unconfirmed_visibility(self):
  self.enable()
  with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[0],self.ids[1]))
  self.assertEqual(self.clients[1].get('/api/cards/'+self.code).status_code,404);self.assertEqual(self.clients[1].post('/api/cards/'+self.code+'/request').status_code,404)
  with db.connect() as c:c.execute('UPDATE users SET needs_email_confirm=true WHERE id=%s',(self.ids[0],))
  self.assertEqual(self.guest.get('/api/cards/'+self.code).status_code,404)
 def test_signup_confirmation_respects_request_choice_revocation_and_no_duplicates(self):
  self.enable()
  with db.connect() as c:
   for uid,want in [(self.ids[1],True),(self.ids[2],False)]:c.execute("INSERT INTO signup_join_intents(user_id,kind,code,want_request) VALUES(%s,'card',%s,%s)",(uid,self.code,want));cards.consume_signup(c,uid);cards.consume_signup(c,uid)
  d=self.clients[0].get('/api/card').json();self.assertEqual((d['joined'],d['waiting']),(2,1))
  with db.connect() as c:
   self.assertFalse(c.execute('SELECT 1 FROM friendships WHERE requester=%s AND addressee=%s',(self.ids[2],self.ids[0])).fetchone());c.execute('DELETE FROM friendships WHERE requester=%s',(self.ids[1],));c.execute('UPDATE public_cards SET enabled=false WHERE user_id=%s',(self.ids[0],));c.execute("INSERT INTO signup_join_intents(user_id,kind,code) VALUES(%s,'card',%s)",(self.ids[1],self.code));cards.consume_signup(c,self.ids[1]);self.assertFalse(c.execute('SELECT 1 FROM friendships WHERE requester=%s',(self.ids[1],)).fetchone())
 def test_real_signup_waitlist_closed_and_email_confirmation(self):
  import os
  self.enable();tokens={}
  def confirmation(background,c,uid,name,email,**kw):tokens[uid]=cards.account_email._token(c,uid,'verify_email',30,email)
  env={'KINETTA_SIGNUP':'open','KINETTA_MAX_ACCOUNTS':'','KINETTA_RESEND_KEY':'fictional-mail-key','KINETTA_MAIL_FROM':'Kinetta <mail@example.test>','KINETTA_MAIL_REPLY_TO':'help@example.test','KINETTA_PUBLIC_URL':'https://example.test','KINETTA_MAIL_WEBHOOK_SECRET':'fictional-card-webhook'}
  with patch.dict(os.environ,env),patch('app.account_email.confirmation',side_effect=confirmation),patch('app.auth.client_ip',return_value='fictional-card-signup-'+uuid.uuid4().hex):
   for want in (True,False):
    login='zz_test_card_join_'+uuid.uuid4().hex[:8];guest=TestClient(app)
    r=guest.post('/api/signup',json={'name':'Fictional new member','login':login,'email':login+'@example.test','password':'fictional card signup phrase','age_ok':True,'card_code':self.code,'card_request':want});self.assertEqual(r.status_code,200,r.text)
    with db.connect() as c:
     uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];self.ids.append(uid);self.assertFalse(c.execute('SELECT 1 FROM friendships WHERE requester=%s',(uid,)).fetchone())
    r=guest.post('/api/account/email/confirm',json={'token':tokens[uid]});self.assertEqual(r.status_code,200,r.text)
    with db.connect() as c:
     f=c.execute('SELECT status FROM friendships WHERE requester=%s AND addressee=%s',(uid,self.ids[0])).fetchone();self.assertEqual(f['status'] if f else None,'pending' if want else None);self.assertFalse(c.execute('SELECT 1 FROM signup_join_intents WHERE user_id=%s',(uid,)).fetchone())
   self.assertEqual(self.clients[0].get('/api/card').json()['joined'],2)
   self.assertIn('/signup?card=',self.guest.get('/card/'+self.code).text)
   with patch.dict(os.environ,{'KINETTA_MAX_ACCOUNTS':'0'}):self.assertIn('/beta?card=',self.guest.get('/card/'+self.code).text)
   with patch.dict(os.environ,{'KINETTA_SIGNUP':'invite'}):self.assertIn('invite-only right now',self.guest.get('/card/'+self.code).text)

 def test_waitlist_invitation_retains_card_origin_and_confirmation_choice(self):
  import os
  from app import api_beta,api_account,account_email
  self.enable();mail={'KINETTA_SIGNUP':'waitlist','KINETTA_BETA_SIGNUP':'1','KINETTA_RESEND_KEY':'fictional-key','KINETTA_MAIL_FROM':'Kinetta <mail@example.test>','KINETTA_MAIL_REPLY_TO':'help@example.test','KINETTA_PUBLIC_URL':'https://example.test','KINETTA_MAIL_WEBHOOK_SECRET':'fictional-webhook'}
  email='zz_test_card_wait_'+uuid.uuid4().hex[:8]+'@example.test';tokens={}
  def confirmation(background,c,uid,name,email,**kw):tokens[uid]=account_email._token(c,uid,'verify_email',30,email)
  with patch.dict(os.environ,mail),patch('app.account_email.confirmation',side_effect=confirmation),patch('app.auth.client_ip',return_value='fictional-card-wait-'+uuid.uuid4().hex):
   response=self.guest.post('/api/beta',json={'name':'PRIVATE WAITLIST NAME','email':email,'phone':'iphone','card_code':self.code,'card_request':True});self.assertEqual(response.status_code,200,response.text)
   with db.connect() as c:
    r=c.execute('SELECT id,card_code,card_request FROM beta_requests WHERE lower(email)=lower(%s)',(email,)).fetchone();self.assertEqual((r['card_code'],r['card_request']),(self.code,True));c.execute('UPDATE users SET is_admin=true WHERE id=%s',(self.ids[0],))
   invitation=api_beta.beta_invite(r['id'],{'id':self.ids[0],'login':'fictional_admin','is_admin':True});token=invitation['url'].rsplit('/',1)[-1]
   info=self.guest.get('/api/join/'+token);self.assertEqual(info.status_code,200,info.text);self.assertEqual(info.json()['card']['code'],self.code);self.assertNotIn('SECRET REAL',info.text);self.assertNotIn('PRIVATE WAITLIST NAME',info.text)
   login='zz_test_card_invited_'+uuid.uuid4().hex[:8];new=TestClient(app);r=new.post('/api/join',json={'token':token,'name':'Fictional invited member','login':login,'email':email,'password':'fictional invited card phrase','card_code':self.code,'card_request':True});self.assertEqual(r.status_code,200,r.text)
   with db.connect() as c:
    uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];self.ids.append(uid);self.assertFalse(c.execute('SELECT 1 FROM friendships WHERE requester=%s',(uid,)).fetchone())
   self.assertEqual(new.post('/api/account/email/confirm',json={'token':tokens[uid]}).status_code,200)
   with db.connect() as c:self.assertEqual(c.execute('SELECT status FROM friendships WHERE requester=%s AND addressee=%s',(uid,self.ids[0])).fetchone()['status'],'pending')
  with patch.dict(os.environ,{'KINETTA_SIGNUP':'invite','KINETTA_BETA_SIGNUP':'0'}):
   page=self.guest.get('/card/'+self.code).text;self.assertIn('Ask the server owner for an invitation',page);self.assertNotIn('/beta?card=',page)

 def test_twenty_pending_limit_and_viewer_rate_limit(self):
  self.enable()
  with db.connect() as c:
   for n in range(20):
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_card_cap_'+uuid.uuid4().hex[:10],'Fictional member',self.pw)).fetchone()['id'];self.ids.append(uid);c.execute('INSERT INTO friendships(requester,addressee) VALUES(%s,%s)',(uid,self.ids[0]));c.execute('INSERT INTO card_connections(user_id,member_id) VALUES(%s,%s)',(self.ids[0],uid))
  self.assertEqual(self.clients[1].post('/api/cards/'+self.code+'/request').status_code,429)
 def test_codes_have_no_reader_grant_and_exports_exclude_codes(self):
  from app.api_mydata import TABLES
  with db.connect() as c:
   for table in ('public_cards','signup_join_intents'):
    self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers',%s,'SELECT') AS yes",(table,)).fetchone()['yes']);self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s',(table,)).fetchone()['relrowsecurity'])
   exported=c.execute(TABLES['public_card'],(self.ids[0],)).fetchone();self.assertNotIn(self.code,str(exported))
if __name__=='__main__':unittest.main(verbosity=2)
