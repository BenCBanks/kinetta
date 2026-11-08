"""Public-card field allowlists, revocation, explicit friendship and signup boundaries using fictional SQL."""
import datetime as dt,io,json,uuid,unittest
from unittest.mock import patch
from PIL import Image,ImageDraw
from fastapi.testclient import TestClient
from app import db,auth,cards,api_account
from app.main import app
class Cards(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.pw=auth.hash_pw('fictional card testing phrase')
 def setUp(self):
  original=api_account.reserved_login
  names=patch.object(api_account,'reserved_login',side_effect=lambda v,**kw:original(v,allow_test=True));names.start();self.addCleanup(names.stop)
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
  if 'stats' in kw and 'period' not in kw:kw.pop('stats');kw['period']='all_time'
  body={'enabled':True,'photo':False,'sports':True,'period':'this_week','allow_requests':True}|kw;r=self.clients[0].put('/api/card',json=body);self.assertEqual(r.status_code,200,r.text);return r.json()
 def test_on_by_default_selected_metrics_owner_preview_and_strict_settings(self):
  self.assertTrue(self.settings['enabled']);self.assertEqual(self.settings['period'],'this_week');self.assertTrue(self.settings['photo']);self.assertTrue(self.settings['sports']);self.assertTrue(self.settings['allow_requests']);self.assertEqual(self.clients[0].get('/api/card/image.png').status_code,200)
  for path in ('/api/cards/','/card/'):
   self.assertEqual(self.guest.get(path+self.code).status_code,200)
  preview=self.settings['preview'];self.assertEqual(preview['period'],'this_week');self.assertAlmostEqual(preview['weekly']['distance_m'],10000);self.assertEqual(preview['weekly']['activities'],1);self.assertEqual(len(preview['weekly']['weeks']),12)
  for stats in [['weight'],['distance_year']*2,['distance_year','activities_year','active_days_year']]:self.assertEqual(self.clients[0].put('/api/card',json={'enabled':True,'stats':stats}).status_code,422)
  self.assertEqual(self.guest.put('/api/card',json={'enabled':True}).status_code,401)
  self.assertEqual(self.clients[0].put('/api/card',json={'enabled':True,'user_id':self.ids[1]}).status_code,422)
 def test_anonymous_preview_and_png_never_disclose_unselected_private_fields(self):
  self.enable();d=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(set(d),{'username','period','weekly','sports','stats','garmin_sources','allow_requests','url'});self.assertEqual(d['period'],'this_week');self.assertEqual(d['sports'],[{'sport':'run','activities':1}])
  page=self.guest.get('/card/'+self.code);self.assertEqual(page.status_code,200);self.assertIn('noindex',page.headers['x-robots-tag']);self.assertIn('og:image',page.text);self.assertIn('/image.png',page.text)
  for secret in ('SECRET REAL','SECRET ACTIVITY','SECRET NOTE','avg_hr','calories','weight','bio'):self.assertNotIn(secret,page.text+json.dumps(d))
  pic=self.guest.get('/card/'+self.code+'/image.png');self.assertEqual(pic.status_code,200);self.assertEqual(Image.open(io.BytesIO(pic.content)).size,(1080,1350));self.assertEqual(pic.headers['cache-control'],'no-store')
 def test_public_achievements_are_only_pinned_and_revocable(self):
  self.enable()
  run_state={'track':'sport:run','label':'Run','value_m':1609344,'unit':'m'}
  journey_state={'track':'journey','label':'Journey','value_m':2000000,'unit':'m'}
  with db.connect() as c:
   c.execute('UPDATE profile SET share_achievements=true,share_achievements_since=now(),showcase_pins=%s WHERE user_id=%s',(['sport:run'],self.ids[0]))
   for code,title,details in [('sport:run','Run',run_state),('journey','Journey',journey_state)]:
    c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details)
                 VALUES(%s,%s,'track_state',%s,0,current_date,now(),%s)''',(self.ids[0],'track-state:'+code,title,json.dumps(details)))
  public=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(public['achievements'],[{'code':'sport:run','value':'1,000 mi','context':'Total running distance'}]);self.assertNotIn('rank',public['achievements'][0])
  on_image=self.guest.get('/card/'+self.code+'/image.png').content
  with db.connect() as c:c.execute('UPDATE profile SET share_achievements_since=NULL WHERE user_id=%s',(self.ids[0],))
  missing_since=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(missing_since['achievements'],[],'the public card needs both the switch and its opt-in timestamp')
  with db.connect() as c:c.execute('UPDATE profile SET share_achievements_since=now() WHERE user_id=%s',(self.ids[0],))
  with db.connect() as c:c.execute('UPDATE profile SET showcase_pins=%s WHERE user_id=%s',([],self.ids[0]))
  no_pins=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(no_pins['achievements'],[],'un-pinned earned tracks never become public defaults')
  unpinned_image=self.guest.get('/card/'+self.code+'/image.png').content;self.assertNotEqual(on_image,unpinned_image)
  with db.connect() as c:c.execute('UPDATE profile SET showcase_pins=%s,share_achievements=false WHERE user_id=%s',(['sport:run'],self.ids[0]))
  revoked=self.guest.get('/api/cards/'+self.code).json();self.assertNotIn('achievements',revoked)
  off_image=self.guest.get('/card/'+self.code+'/image.png').content;self.assertNotEqual(on_image,off_image,'turning sharing off immediately removes featured items from the PNG')
 def test_week_and_all_time_choices_are_persisted_in_owner_and_public_preview(self):
  weekly=self.enable()['preview'];self.assertEqual(weekly['period'],'this_week');self.assertEqual(weekly['weekly']['activities'],1)
  all_time=self.enable(period='all_time')['preview'];self.assertEqual(all_time['period'],'all_time');self.assertEqual(all_time['all_time']['activities'],1);self.assertAlmostEqual(all_time['all_time']['distance_m'],10000)
  public=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(public['period'],'all_time');self.assertEqual(public['all_time']['activities'],1)
  self.assertEqual(self.clients[1].get('/api/card').json()['period'],'this_week');self.assertEqual(self.clients[1].get('/api/card').json()['preview']['weekly']['activities'],0)
  self.assertEqual(self.guest.get('/card/'+self.code+'/photo').status_code,404)
 def test_none_choice_and_legacy_empty_stats_hide_public_totals(self):
  selected=self.enable(period='none');self.assertEqual(selected['period'],'none');self.assertEqual(selected['stats'],[])
  self.assertNotIn('weekly',selected['preview']);self.assertNotIn('all_time',selected['preview'])
  public=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(public['period'],'none');self.assertEqual(public['stats'],[])
  self.assertNotIn('weekly',public);self.assertNotIn('all_time',public)
  none_image=self.guest.get('/card/'+self.code+'/image.png');self.assertEqual(none_image.status_code,200)
  self.enable(period='this_week');weekly_image=self.guest.get('/card/'+self.code+'/image.png')
  self.assertNotEqual(none_image.content,weekly_image.content)
  with db.connect() as c:c.execute("UPDATE public_cards SET stats='[]'::jsonb,updated=now() WHERE user_id=%s",(self.ids[0],))
  legacy=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(legacy['period'],'none')
  self.assertNotIn('weekly',legacy);self.assertNotIn('all_time',legacy);self.assertEqual(legacy['stats'],[])
 def test_garmin_attribution_matches_selected_period(self):
  with db.connect() as c:
   c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,device,visibility,distance_m,moving_s,elapsed_s) VALUES(%s,'run','Fictional Garmin this week',now(),'garmin_connect','Forerunner 265','me',5000,1800,1800)",(self.ids[0],))
   c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,device,visibility,distance_m,moving_s,elapsed_s) VALUES(%s,'ride','Fictional Garmin history',now()-interval '2 years','garmin_connect','Edge 540','me',10000,2400,2400)",(self.ids[0],))
  weekly=self.enable(period='this_week')['preview'];self.assertEqual(weekly['garmin_sources'],['Garmin Forerunner 265'])
  all_time=self.enable(period='all_time')['preview'];self.assertEqual(all_time['garmin_sources'],['Garmin Edge 540','Garmin Forerunner 265'])
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
   login='zz_test_card_invited_'+uuid.uuid4().hex[:8];new=TestClient(app);r=new.post('/api/join',json={'age_ok':True,'token':token,'name':'Fictional invited member','login':login,'email':email,'password':'fictional invited card phrase','card_code':self.code,'card_request':True});self.assertEqual(r.status_code,200,r.text)
   with db.connect() as c:
    uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];self.ids.append(uid);self.assertFalse(c.execute('SELECT 1 FROM friendships WHERE requester=%s',(uid,)).fetchone())
   self.assertEqual(new.post('/api/account/email/confirm',json={'token':tokens[uid]}).status_code,200)
   with db.connect() as c:self.assertEqual(c.execute('SELECT status FROM friendships WHERE requester=%s AND addressee=%s',(uid,self.ids[0])).fetchone()['status'],'pending')
  with patch.dict(os.environ,{'KINETTA_SIGNUP':'invite','KINETTA_BETA_SIGNUP':'0'}):
   page=self.guest.get('/card/'+self.code).text;self.assertIn('Ask the server owner for an invitation',page);self.assertNotIn('/beta?card=',page)

 def test_confirmation_commits_before_consuming_card_relationships(self):
  import os
  self.enable();tokens={}
  def confirmation(background,c,uid,name,email,**kw):tokens[uid]=cards.account_email._token(c,uid,'verify_email',30,email)
  env={'KINETTA_SIGNUP':'open','KINETTA_MAX_ACCOUNTS':'','KINETTA_RESEND_KEY':'fictional-mail-key','KINETTA_MAIL_FROM':'Kinetta <mail@example.test>','KINETTA_MAIL_REPLY_TO':'help@example.test','KINETTA_PUBLIC_URL':'https://example.test','KINETTA_MAIL_WEBHOOK_SECRET':'fictional-webhook'}
  original=cards.consume_signup;checked=[]
  def after_commit(c,uid):
   with db.connect() as other:
    other.execute('SELECT id FROM users WHERE id=%s FOR UPDATE NOWAIT',(uid,));checked.append(uid)
   return original(c,uid)
  with patch.dict(os.environ,env),patch('app.account_email.confirmation',side_effect=confirmation),patch('app.auth.client_ip',return_value='fictional-card-lock-'+uuid.uuid4().hex):
   client=TestClient(app);login='zz_test_card_lock_'+uuid.uuid4().hex[:8]
   r=client.post('/api/signup',json={'name':'Fictional new person','email':login+'@example.test','login':login,'password':'fictional new card phrase','age_ok':True,'card_code':self.code,'card_request':True});self.assertEqual(r.status_code,200,r.text)
   with db.connect() as c:uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];self.ids.append(uid)
   with patch('app.cards.consume_signup',side_effect=after_commit):r=client.post('/api/account/email/confirm',json={'token':tokens[uid]})
   self.assertEqual(r.status_code,200,r.text);self.assertEqual(checked,[uid])
   with db.connect() as c:self.assertEqual(c.execute('SELECT status FROM friendships WHERE requester=%s AND addressee=%s',(uid,self.ids[0])).fetchone()['status'],'pending')
 def test_twenty_pending_limit_and_viewer_rate_limit(self):
  self.enable()
  with db.connect() as c:
   for n in range(20):
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_card_cap_'+uuid.uuid4().hex[:10],'Fictional member',self.pw)).fetchone()['id'];self.ids.append(uid);c.execute('INSERT INTO friendships(requester,addressee) VALUES(%s,%s)',(uid,self.ids[0]));c.execute('INSERT INTO card_connections(user_id,member_id) VALUES(%s,%s)',(self.ids[0],uid))
  self.assertEqual(self.clients[1].post('/api/cards/'+self.code+'/request').status_code,429)
 def test_real_reader_can_read_only_own_metadata_and_never_codes(self):
  import psycopg
  from psycopg import sql
  from psycopg.rows import dict_row
  self.clients[1].get('/api/card');role='zz_test_card_reader_'+uuid.uuid4().hex[:8];password='fictional reader card phrase'
  try:
   with db.connect() as c:
    c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids[0]))
    c.execute('UPDATE users SET needs_email_confirm=true WHERE id=ANY(%s)',(self.ids[:2],))
    for uid in self.ids[:2]:c.execute("INSERT INTO signup_join_intents(user_id,kind,code,want_request) VALUES(%s,'card','fictional-private-code',false)",(uid,))
   with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as reader:
    self.assertEqual(reader.execute('SELECT user_id,enabled FROM public_cards').fetchall(),[{'user_id':self.ids[0],'enabled':True}])
    self.assertEqual(reader.execute('SELECT user_id,kind FROM signup_join_intents').fetchall(),[{'user_id':self.ids[0],'kind':'card'}])
    for table in ('public_cards','signup_join_intents'):
     with self.assertRaises(psycopg.errors.InsufficientPrivilege):
      with reader.transaction():reader.execute('SELECT code FROM '+table)
  finally:
   with db.connect() as c:c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids[0],));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
 def test_picture_cache_reuses_work_but_updates_and_revocation_are_immediate(self):
  self.enable(stats=['activities_year']);path='/card/'+self.code+'/image.png';original=cards.image
  with patch('app.cards.image',wraps=original) as render:
   first=self.guest.get(path);self.assertEqual(first.status_code,200);self.assertEqual(self.guest.get(path).content,first.content);self.assertEqual(render.call_count,1)
   with db.connect() as c:c.execute("INSERT INTO activities(user_id,sport,name,start_time,source) VALUES(%s,'walk','Fictional update',now(),'manual')",(self.ids[0],))
   changed=self.guest.get(path);self.assertEqual(changed.status_code,200);self.assertNotEqual(changed.content,first.content);self.assertEqual(render.call_count,2)
   self.enable(enabled=False);self.assertEqual(self.guest.get(path).status_code,404);self.assertEqual(render.call_count,2)
   self.enable();self.assertEqual(self.guest.get(path).status_code,200)
   with db.connect() as c:c.execute('UPDATE users SET suspended_at=now() WHERE id=%s',(self.ids[0],))
   self.assertEqual(self.guest.get(path).status_code,404)
 def test_cached_preview_keeps_relationships_separate_and_blocks_current(self):
  self.enable();path='/api/cards/'+self.code;original=cards.payload
  with patch('app.cards.payload',wraps=original) as render:
   self.assertEqual(self.guest.get(path).status_code,200);self.assertEqual(self.clients[0].get(path).json()['relationship'],'self')
   self.assertNotIn('relationship',self.guest.get(path).json());self.assertEqual(render.call_count,1)
   self.assertEqual(self.clients[1].get('/card/'+self.code+'/image.png').status_code,200)
   with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[0],self.ids[1]))
   self.assertEqual(self.clients[1].get(path).status_code,404);self.assertEqual(self.clients[1].get('/card/'+self.code+'/image.png').status_code,404)
 def test_public_html_does_not_compute_stats_or_render_the_picture(self):
  self.enable(stats=['distance_year','food_days_month'])
  with patch('app.cards.payload',side_effect=AssertionError('HTML must not scan history')),patch('app.cards.image',side_effect=AssertionError('HTML must not render PNG')):
   self.assertEqual(self.guest.get('/card/'+self.code).status_code,200)
 def test_unfinished_lifting_is_excluded_from_card_totals_and_sports(self):
  with db.connect() as c:c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,lift_open) VALUES(%s,'workout','Fictional unfinished set',now(),'manual',true)",(self.ids[0],))
  preview=self.enable(period='this_week')['preview'];self.assertEqual(preview['weekly']['activities'],1);self.assertEqual(preview['sports'],[{'sport':'run','activities':1}])
 def test_sports_are_owned_all_time_completed_counts_and_can_be_hidden(self):
  with db.connect() as c:
   for uid,sport,when,unfinished in [(self.ids[0],'run',"now()-interval '2 years'",False),(self.ids[0],'ride',"now()-interval '1 year'",False),(self.ids[0],'swim','now()',True),(self.ids[1],'hike','now()',False)]:
    c.execute(f"INSERT INTO activities(user_id,sport,name,start_time,source,visibility,lift_open) VALUES(%s,%s,'Fictional private sport',{when},'manual','me',%s)",(uid,sport,unfinished))
  expected=[{'sport':'run','activities':2},{'sport':'ride','activities':1}]
  self.assertEqual(self.clients[0].get('/api/card').json()['preview']['sports'],expected)
  self.assertEqual(self.guest.get('/api/cards/'+self.code).json()['sports'],expected)
  self.assertEqual(self.enable(sports=False)['preview']['sports'],[])
  self.assertEqual(self.guest.get('/api/cards/'+self.code).json()['sports'],[])
 def test_later_choices_and_off_switch_survive_reads_rotation_and_migration(self):
  chosen={'enabled':False,'photo':False,'sports':False,'period':'all_time','allow_requests':False}
  self.enable(**chosen);db.migrate()
  for answer in (self.clients[0].get('/api/card').json(),self.clients[0].post('/api/card/new').json()):
   self.assertEqual({k:answer[k] for k in chosen},chosen)
   self.assertEqual(self.guest.get('/card/'+answer['url'].rsplit('/',1)[-1]).status_code,404)
 def test_empty_card_has_no_sports_or_placeholder_activities(self):
  self.assertEqual(self.clients[1].get('/api/card').json()['preview']['sports'],[])
 def test_exported_picture_draws_each_actual_sport_with_its_count(self):
  self.enable();original=cards.sport_icon
  with patch('app.cards.sport_icon',wraps=original) as icon,patch('app.cards.ImageDraw.ImageDraw.text',autospec=True) as text:
   self.assertEqual(self.clients[0].get('/api/card/image.png').status_code,200)
   self.assertEqual([call.args[1] for call in icon.call_args_list],['run'])
   self.assertIn('Sports · all time',[call.args[2] for call in text.call_args_list]);self.assertIn('This week',[call.args[2] for call in text.call_args_list]);self.assertIn('6.2 mi',[call.args[2] for call in text.call_args_list])
 def test_photo_and_every_sport_fit_the_exported_picture(self):
  photo=io.BytesIO();Image.new('RGB',(80,80),'#1F55D0').save(photo,format='JPEG')
  with db.connect() as c:
   c.execute('INSERT INTO profile_photos(user_id,img) VALUES(%s,%s)',(self.ids[0],photo.getvalue()));c.execute("UPDATE users SET photo_v='fictional-grid-photo' WHERE id=%s",(self.ids[0],))
   for sport in cards.SPORTS:
    c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,visibility) VALUES(%s,%s,'Fictional sport grid',now(),'manual','me')",(self.ids[0],sport))
  self.enable(photo=True,period='all_time');bounds=[];original=ImageDraw.ImageDraw.text
  def record(draw,xy,value,*args,**kwargs):
   bounds.append((str(value),draw.textbbox(xy,value,font=kwargs.get('font'))));return original(draw,xy,value,*args,**kwargs)
  with patch('app.cards.ImageDraw.ImageDraw.text',new=record):
   self.assertEqual(self.clients[0].get('/api/card/image.png').status_code,200)
  for value,(left,top,right,bottom) in bounds:self.assertTrue(0<=left<right<=1080 and 0<=top<bottom<=1350,(value,(left,top,right,bottom)))
  for sport in cards.SPORTS:self.assertIn(cards.SPORTS[sport],[v for v,b in bounds])
  # Totals stay above the fixed footer in both selected views.
  for value,box in bounds:
   if value in ('All time','distance','workouts','time'):self.assertLess(box[3],1135,(value,box))
 def test_shared_image_medals_are_prominent_and_centered_for_one_or_two_items(self):
  original=cards.achievement_medal
  for count,expected_centers in ((1,[540]),(2,[306,774])):
   items=[{'code':'sport:run','value':'1,000 mi','context':'Total running distance'} for _ in range(count)]
   data={'username':'fictional runner','period':'none','sports':[],'achievements':items,
         'garmin_sources':[],'url':'https://example.test/card/fictional'}
   with patch('app.cards.payload',return_value=data),patch('app.cards.achievement_medal',wraps=original) as medal:
    cards.image(None,{'user_id':self.ids[0]},None)
   self.assertEqual([call.args[1] for call in medal.call_args_list],expected_centers)
   self.assertEqual([call.args[3] for call in medal.call_args_list],[cards.CARD_FEATURED_MEDAL_SIZE]*count)
  self.assertEqual(cards.CARD_FEATURED_SLOT_GUTTER,24)
 def test_shared_image_wraps_long_values_without_shrinking_the_font(self):
  items=[{'code':'journey','value':'767,124.9 mi','context':'All-sport distance'},
         {'code':'sport:run','value':'613,699.9 mi','context':'Total running distance'},
         {'code':'workouts','value':'12,345,678 workouts','context':'Workouts completed'},
         {'code':'climbing','value':'405,041,971.6 ft','context':'Elevation climbed'}]
  data={'username':'fictional runner','period':'none','sports':[],'achievements':items,
        'garmin_sources':[],'url':'https://example.test/card/fictional'}
  drawn=[];original=ImageDraw.ImageDraw.text
  def record(draw,xy,value,*args,**kwargs):
   font=kwargs.get('font')
   drawn.append((str(value),font.size,draw.textlength(str(value),font=font),xy[1]))
   return original(draw,xy,value,*args,**kwargs)
  with patch('app.cards.payload',return_value=data),patch('app.cards.ImageDraw.ImageDraw.text',new=record):
   cards.image(None,{'user_id':self.ids[0]},None)
  expected_sizes={'12,345,678':31,'workouts':cards.CARD_FEATURED_UNIT_SIZE,
                  '405,041,971.6':31,'ft':cards.CARD_FEATURED_UNIT_SIZE}
  for value,size in expected_sizes.items():
   match=[entry for entry in drawn if entry[0]==value]
   self.assertTrue(match,(value,drawn))
   self.assertEqual(match[0][1],size,(value,match))
   self.assertLessEqual(match[0][2],936/2-cards.CARD_FEATURED_SLOT_GUTTER,(value,match))
  unit_y=[entry[3] for entry in drawn if entry[0]=='ft']
  self.assertEqual(unit_y,[305+cards.CARD_FEATURED_HEADER_HEIGHT+cards.CARD_FEATURED_VALUE_OFFSET+cards.CARD_FEATURED_UNIT_OFFSET])
  context_y=305+cards.CARD_FEATURED_HEADER_HEIGHT+cards.CARD_FEATURED_CONTEXT_OFFSET
  self.assertLess(unit_y[0]+cards.CARD_FEATURED_UNIT_SIZE,context_y)
 def test_two_line_label_fits_the_reserved_featured_row(self):
  items=[{'code':'journey','value':'1 mi','context':'All-sport distance'},
         {'code':'sport:walk-hike','value':'1 mi','context':'Walking & hiking distance'},
         {'code':'workouts','value':'1 workout','context':'Workouts completed'},
         {'code':'climbing','value':'1 ft','context':'Elevation climbed'}]
  data={'username':'fictional runner','period':'none','sports':[],'achievements':items,
        'garmin_sources':[],'url':'https://example.test/card/fictional'}
  label_boxes=[];original=ImageDraw.ImageDraw.text;row_top=305
  def record(draw,xy,value,*args,**kwargs):
   if str(value) in ('Walking & hiking','distance'):
    label_boxes.append((str(value),draw.textbbox(xy,str(value),font=kwargs.get('font'),anchor=kwargs.get('anchor'))))
   return original(draw,xy,value,*args,**kwargs)
  with patch('app.cards.payload',return_value=data),patch('app.cards.ImageDraw.ImageDraw.text',new=record):
   cards.image(None,{'user_id':self.ids[0]},None)
  self.assertEqual([label for label,_ in label_boxes],['Walking & hiking','distance'])
  drawn_bottom=max(box[3] for _,box in label_boxes)
  self.assertGreater(drawn_bottom-row_top,230)
  self.assertLessEqual(drawn_bottom-row_top,cards.CARD_FEATURED_ROW_HEIGHT)
  self.assertEqual(cards.CARD_FEATURED_ROW_HEIGHT,256)
  self.assertEqual(cards.featured_row_bounds(794,4),(794,cards.CARD_FOOTER_TOP))
  self.assertIsNone(cards.featured_row_bounds(795,4))
 def test_worst_case_featured_row_is_dropped_before_the_fixed_footer(self):
  photo=io.BytesIO();Image.new('RGB',(80,80),'#1F55D0').save(photo,format='JPEG')
  weeks=[{'week':(dt.date(2026,1,5)+dt.timedelta(weeks=i)).isoformat(),'distance_m':10000,'activities':1,'time_s':3600} for i in range(12)]
  data={'username':'fictional runner','photo':'/photo','sports':[{'sport':sport,'activities':9} for sport in cards.SPORTS],
        'period':'this_week','weekly':{'unit':'mi','streak_weeks':4,'distance_m':10000,'activities':9,'time_s':3600,'weeks':weeks},
        'achievements':[{'code':'sport:run','value':'1,000 mi','context':'Total running distance'} for _ in range(4)],
        'garmin_sources':['Garmin Forerunner 265'],'url':'https://example.test/card/fictional'}
  class Cursor:
   def fetchone(self):return {'img':photo.getvalue()}
  class Connection:
   def execute(self,*args):return Cursor()
  decisions=[];labels=[];layout=cards.featured_row_bounds;draw_text=ImageDraw.ImageDraw.text
  def measure(top,count):
   result=layout(top,count);decisions.append((top,count,result));return result
  def record(draw,xy,value,*args,**kwargs):
   labels.append(str(value));return draw_text(draw,xy,value,*args,**kwargs)
  with patch('app.cards.payload',return_value=data),patch('app.cards.featured_row_bounds',side_effect=measure),patch('app.cards.achievement_medal') as medal,patch('app.cards.ImageDraw.ImageDraw.text',new=record):
   png=cards.image(Connection(),{'user_id':self.ids[0]},None)
  self.assertEqual(Image.open(io.BytesIO(png)).size,(1080,1350))
  self.assertEqual(len(data['sports']),9);self.assertEqual(decisions[0][1],4)
  self.assertGreater(decisions[0][0],cards.CARD_FOOTER_TOP);self.assertIsNone(decisions[0][2])
  self.assertEqual(cards.featured_row_bounds(794,4),(794,cards.CARD_FOOTER_TOP))
  self.assertIsNone(cards.featured_row_bounds(795,4))
  self.assertEqual(medal.call_count,0);self.assertNotIn('Featured achievements',labels)
 def test_single_long_words_are_clipped_inside_each_featured_slot(self):
  def render(value,context):
   items=[{'code':'sport:run','value':value,'context':context}]+[{'code':'sport:run','value':'','context':''} for _ in range(3)]
   data={'username':'fictional runner','period':'none','sports':[],'achievements':items,
         'garmin_sources':[],'url':'https://example.test/card/fictional'}
   with patch('app.cards.payload',return_value=data):png=cards.image(None,{'user_id':self.ids[0]},None)
   return Image.open(io.BytesIO(png)).convert('RGB')
  baseline=render('1 mi','Run');long=render('9'*100,'W'*100);top=305
  slot_left=72+cards.CARD_FEATURED_SLOT_GUTTER//2
  slot_right=72+936//4-cards.CARD_FEATURED_SLOT_GUTTER//2
  value_top=top+cards.CARD_FEATURED_HEADER_HEIGHT+cards.CARD_FEATURED_VALUE_OFFSET
  context_top=top+cards.CARD_FEATURED_HEADER_HEIGHT+cards.CARD_FEATURED_CONTEXT_OFFSET
  for y0,y1 in ((value_top,value_top+55),(context_top,context_top+55)):
   changes=[(x,y) for y in range(y0,y1) for x in range(1080) if baseline.getpixel((x,y))!=long.getpixel((x,y))]
   self.assertTrue(changes,(y0,y1))
   self.assertGreaterEqual(min(x for x,y in changes),slot_left)
   self.assertLess(max(x for x,y in changes),slot_right)
 def test_picture_cache_has_bounded_entries_and_render_concurrency(self):
  import threading,time
  from concurrent.futures import ThreadPoolExecutor
  self.enable();path='/card/'+self.code+'/image.png';active=0;peak=0;lock=threading.Lock()
  def render(*args):
   nonlocal active,peak
   with lock:active+=1;peak=max(active,peak)
   time.sleep(.15)
   with lock:active-=1
   return b'fictional-png'
  with patch('app.cards.image',side_effect=render) as renderer:
   with ThreadPoolExecutor(max_workers=8) as pool:answers=list(pool.map(lambda _:TestClient(app).get(path),range(8)))
   self.assertTrue(all(x.status_code==200 for x in answers));self.assertLessEqual(peak,2);self.assertLessEqual(renderer.call_count,2)
  with patch('app.cards.PICTURE_LIMIT',2),patch('app.cards.image',return_value=b'fictional-png'):
   for _ in range(3):
    new=self.clients[0].post('/api/card/new').json()['url'];self.assertEqual(self.guest.get('/card/'+new.rsplit('/',1)[-1]+'/image.png').status_code,200)
   self.assertLessEqual(len(cards._pictures),2)
 def test_codes_have_no_reader_grant_and_exports_exclude_codes(self):
  from app.api_mydata import TABLES
  with db.connect() as c:
   for table in ('public_cards','signup_join_intents'):
    self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers',%s,'SELECT') AS yes",(table,)).fetchone()['yes']);self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s',(table,)).fetchone()['relrowsecurity'])
   exported=c.execute(TABLES['public_card'],(self.ids[0],)).fetchone();self.assertNotIn(self.code,str(exported))
if __name__=='__main__':unittest.main(verbosity=2)
