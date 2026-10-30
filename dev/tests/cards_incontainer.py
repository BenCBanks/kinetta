"""Public-card field allowlists, revocation, explicit friendship and signup boundaries using fictional SQL."""
import io,json,uuid,unittest
from unittest.mock import patch
from PIL import Image,ImageDraw
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
 def test_on_by_default_selected_metrics_owner_preview_and_strict_settings(self):
  self.assertTrue(self.settings['enabled']);self.assertEqual(self.settings['stats'],['distance_year','activity_weeks']);self.assertTrue(self.settings['photo']);self.assertTrue(self.settings['sports']);self.assertTrue(self.settings['allow_requests']);self.assertEqual(self.clients[0].get('/api/card/image.png').status_code,200)
  for path in ('/api/cards/','/card/'):
   self.assertEqual(self.guest.get(path+self.code).status_code,200)
  preview=self.settings['preview'];self.assertEqual([s['key'] for s in preview['stats']],['distance_year','activity_weeks']);self.assertAlmostEqual(preview['stats'][0]['value'],6.2);self.assertEqual(preview['stats'][1]['value'],1)
  for stats in [['weight'],['distance_year']*2,['distance_year','activities_year','active_days_year']]:self.assertEqual(self.clients[0].put('/api/card',json={'enabled':True,'stats':stats}).status_code,422)
  self.assertEqual(self.guest.put('/api/card',json={'enabled':True}).status_code,401)
  self.assertEqual(self.clients[0].put('/api/card',json={'enabled':True,'user_id':self.ids[1]}).status_code,422)
 def test_anonymous_preview_and_png_never_disclose_unselected_private_fields(self):
  self.enable();d=self.guest.get('/api/cards/'+self.code).json();self.assertEqual(set(d),{'username','sports','stats','garmin_sources','allow_requests','url'});self.assertEqual(d['stats'],[]);self.assertEqual(d['sports'],[{'sport':'run','activities':1}])
  page=self.guest.get('/card/'+self.code);self.assertEqual(page.status_code,200);self.assertIn('noindex',page.headers['x-robots-tag']);self.assertIn('og:image',page.text);self.assertIn('/image.png',page.text)
  for secret in ('SECRET REAL','SECRET ACTIVITY','SECRET NOTE','avg_hr','calories','weight','bio'):self.assertNotIn(secret,page.text+json.dumps(d))
  pic=self.guest.get('/card/'+self.code+'/image.png');self.assertEqual(pic.status_code,200);self.assertEqual(Image.open(io.BytesIO(pic.content)).size,(1080,1350));self.assertEqual(pic.headers['cache-control'],'no-store')
 def test_stats_allowlist_owner_only_and_private_totals_are_deliberate(self):
  d=self.enable(stats=['distance_year','activities_year'])['preview'];self.assertEqual(len(d['stats']),2);self.assertEqual(d['stats'][1]['value'],1);self.assertAlmostEqual(d['stats'][0]['value'],6.2);self.assertNotIn('health',str(d));self.assertEqual([s['value'] for s in self.clients[1].get('/api/card').json()['preview']['stats']],[0,0])
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
  preview=self.enable(stats=['activities_year'])['preview'];self.assertEqual(preview['stats'][0]['value'],1);self.assertEqual(preview['sports'],[{'sport':'run','activities':1}])
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
  chosen={'enabled':False,'photo':False,'sports':False,'stats':['food_days_month'],'allow_requests':False}
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
   self.assertIn('Sports · all time',[call.args[2] for call in text.call_args_list]);self.assertIn('1',[call.args[2] for call in text.call_args_list])
 def test_photo_and_every_sport_fit_the_exported_picture(self):
  photo=io.BytesIO();Image.new('RGB',(80,80),'#1F55D0').save(photo,format='JPEG')
  with db.connect() as c:
   c.execute('INSERT INTO profile_photos(user_id,img) VALUES(%s,%s)',(self.ids[0],photo.getvalue()));c.execute("UPDATE users SET photo_v='fictional-grid-photo' WHERE id=%s",(self.ids[0],))
   for sport in cards.SPORTS:
    c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,visibility) VALUES(%s,%s,'Fictional sport grid',now(),'manual','me')",(self.ids[0],sport))
  self.enable(photo=True,stats=['distance_year','activity_weeks']);bounds=[];original=ImageDraw.ImageDraw.text
  def record(draw,xy,value,*args,**kwargs):
   bounds.append((str(value),draw.textbbox(xy,value,font=kwargs.get('font'))));return original(draw,xy,value,*args,**kwargs)
  with patch('app.cards.ImageDraw.ImageDraw.text',new=record):
   self.assertEqual(self.clients[0].get('/api/card/image.png').status_code,200)
  for value,(left,top,right,bottom) in bounds:self.assertTrue(0<=left<right<=1080 and 0<=top<bottom<=1350,(value,(left,top,right,bottom)))
  for sport in cards.SPORTS:self.assertIn(cards.SPORTS[sport],[v for v,b in bounds])
  # Each headline value and its label must also fit before the following headline/footer.
  stats=[(v,b) for v,b in bounds if b[1]>850 and b[1]<1060]
  for (_,a),(_,b) in zip(stats,stats[1:]):self.assertLessEqual(a[3],b[1],stats)
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
