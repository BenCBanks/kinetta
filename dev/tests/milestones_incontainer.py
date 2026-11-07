"""Fictional owner records, silent imports, once-only offers, invalidation and opt-in private push."""
import datetime as dt,json,unittest,uuid,threading,time
from unittest.mock import patch
from fastapi.testclient import TestClient
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from app import db,auth,milestones as M,notify,api_mydata,api_achievements
from app.main import app

class Milestones(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.pw=auth.hash_pw('fictional milestone testing phrase')
 def setUp(self):
  self.ids=[];self.clients=[];self.now=dt.datetime.now(dt.timezone.utc)
  with db.connect() as c:
   for _ in range(2):
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_milestone_'+uuid.uuid4().hex[:12],'PRIVATE REAL NAME',self.pw)).fetchone()['id'];self.ids.append(uid);c.execute("INSERT INTO profile(user_id,tz,units) VALUES(%s,'America/New_York','metric')",(uid,));token=auth.new_session(c,uid,'fictional milestones');client=TestClient(app);client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'});client.cookies.set(auth.COOKIE,token);self.clients.append(client)
 def tearDown(self):
  from app.api_account import erase,erase_files
  with db.connect() as c:
   for uid in self.ids:erase(c,{'id':uid,'sql_role':None})
  for uid in self.ids:erase_files(uid)
 def activity(self,days=0,sport='run',distance=10000,uid=None,source='manual',device=None):
  at=(self.now-dt.timedelta(hours=2)).astimezone(M.ZoneInfo('America/New_York'))-dt.timedelta(days=days)
  with db.connect() as c:return c.execute("INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source,device,visibility) VALUES(%s,%s,'PRIVATE WORKOUT TITLE',%s,%s,3600,3600,%s,%s,'me') RETURNING id",(uid or self.ids[0],sport,at,distance,source,device)).fetchone()['id']
 def lifted_activity(self,days,kg):
  aid=self.activity(days=days,sport='workout',distance=0)
  with db.connect() as c:
   exercise=c.execute("INSERT INTO exercises(user_id,name,kind) VALUES(%s,'Fictional achievement lift','weight') ON CONFLICT(user_id,name) DO UPDATE SET kind=excluded.kind RETURNING id",(self.ids[0],)).fetchone()['id']
   c.execute('INSERT INTO lift_sets(user_id,activity_id,exercise_id,pos,n,reps,kg,done,warmup) VALUES(%s,%s,%s,0,1,100,%s,true,false)',(self.ids[0],aid,exercise,kg))
  return aid
 def process(self,uid=None):
  with patch('app.notify._push_later'):
   until=time.monotonic()+5
   while time.monotonic()<until:
    with db.connect() as c:done=M.process(c,uid or self.ids[0],self.now)
    if done:return
    # The running app can already own this coalesced job; keep the real worker claim intact.
    time.sleep(.02)
   self.fail('Milestone work did not settle within five seconds')
 def seed_showcase_track(self,uid,code,rank,occurred):
  level=api_achievements._level_catalog()['tracks'][code]['levels'][rank-1]
  value=api_achievements._canonical_threshold(level)
  zone=M.ZoneInfo('America/New_York')
  details={'track':code,'value':value}
  with db.connect() as c:
   c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details)
                VALUES(%s,%s,'track_state',%s,0,%s,%s,%s)''',
             (uid,f'zz-showcase:{uuid.uuid4().hex}:{code}:state',code,occurred.astimezone(zone).date(),occurred,
              psycopg.types.json.Jsonb(details)))
 def items(self,**params):
  r=self.clients[0].get('/api/milestones',params=params);self.assertEqual(r.status_code,200,r.text);return r.json()['items']
 def test_fixed_firsts_priorities_private_warning_and_once_only(self):
  aid=self.activity(distance=42200);self.process();items=self.items(activity_id=aid);self.assertEqual(items[0]['title'],'First marathon');self.assertTrue(items[0]['private_activity']);self.assertNotIn('PRIVATE',json.dumps(items));ids=[x['id'] for x in items]
  self.process();self.assertEqual(ids,[x['id'] for x in self.items(activity_id=aid)])
  for item in items:self.assertEqual(self.clients[0].post('/api/milestones/'+item['id']+'/seen',json={'action':'dismiss'}).status_code,200)
  self.process();self.assertEqual(self.items(),[])
 def test_celebration_claim_is_once_owner_scoped_and_recent_only(self):
  prior=self.activity(distance=5000);aid=self.activity(distance=10000)
  with db.connect() as c:
   c.execute("INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) SELECT user_id,id,sport,5000,'5K',1500,start_time FROM activities WHERE id=%s AND user_id=%s",(prior,self.ids[0]))
   c.execute("INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) SELECT user_id,id,sport,5000,'5K',1400,start_time FROM activities WHERE id=%s AND user_id=%s",(aid,self.ids[0]))
  self.process();claim=self.clients[0].post('/api/milestones/celebrate',json={'activity_id':aid});self.assertEqual(claim.status_code,200,claim.text)
  data=claim.json();self.assertFalse(data['pending'],json.dumps(data));items=data['items'];self.assertTrue(any(row['kind']=='best' for row in items),json.dumps(items));self.assertTrue(any(row['kind'] in ('track','sport','first_distance') for row in items),json.dumps(items))
  self.assertTrue(items);self.assertNotIn('_celebrated_at',json.dumps(items))
  self.assertEqual(self.clients[0].post('/api/milestones/celebrate',json={'activity_id':aid}).json()['items'],[],'reopen cannot replay the same celebration')
  self.assertEqual(self.clients[1].post('/api/milestones/celebrate',json={'activity_id':aid}).json()['items'],[],'another owner cannot claim these rows')
  visible=self.items(activity_id=aid);self.assertTrue(visible,'celebrating does not dismiss the share/review offer')
  self.assertNotIn('_celebrated_at',json.dumps(visible),'the server-only claim marker is omitted from milestone details')
  with db.connect() as c:
   self.assertGreater(c.execute("SELECT count(*) AS n FROM milestones WHERE user_id=%s AND activity_id=%s AND details ? '_celebrated_at' AND seen_at IS NULL",(self.ids[0],aid)).fetchone()['n'],0)
   imported=self.activity(sport='ride',distance=20000,uid=self.ids[0])
   c.execute("UPDATE activities SET created=now()-interval '49 hours',updated=now() WHERE id=%s AND user_id=%s",(imported,self.ids[0]))
  self.process()
  with db.connect() as c:c.execute('UPDATE milestones SET silent=false WHERE user_id=%s AND activity_id=%s',(self.ids[0],imported))
  self.assertEqual(self.clients[0].post('/api/milestones/celebrate',json={'activity_id':imported}).json()['items'],[],'an import received over 48 hours ago cannot celebrate')
  old=self.activity(days=3,sport='swim',distance=1000);self.process()
  with db.connect() as c:c.execute('UPDATE milestones SET silent=false WHERE user_id=%s AND activity_id=%s',(self.ids[0],old))
  self.assertEqual(self.clients[0].post('/api/milestones/celebrate',json={'activity_id':old}).json()['items'],[],'an activity over 48 hours old cannot celebrate')
 def test_500_old_arrivals_are_silent_and_a_current_arrival_can_celebrate(self):
  with db.connect() as c:
   c.execute("INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source) SELECT %s,'run','Fictional old import',now()-make_interval(days=>20+n),1000,600,600,'manual' FROM generate_series(1,500) n",(self.ids[0],))
  self.process();self.assertEqual(self.items(),[])
  with db.connect() as c:self.assertGreater(c.execute('SELECT count(*) AS n FROM milestones WHERE user_id=%s AND silent',(self.ids[0],)).fetchone()['n'],0)
  aid=self.activity(distance=11000);self.process();self.assertTrue(self.items(activity_id=aid));self.assertTrue(all(x['activity_id']==aid for x in self.items()))
 def test_existing_history_is_silent_when_feature_is_first_enabled(self):
  with db.connect() as c:c.execute("INSERT INTO milestone_state(user_id,baseline_at) VALUES(%s,now()+interval '1 second')",(self.ids[0],))
  self.activity()
  self.process();self.assertEqual(self.items(),[])
 def test_edit_and_delete_hide_unshared_offers_without_reopening_seen_history(self):
  aid=self.activity();self.process();offer=next(x for x in self.items() if x['kind']=='first_distance')
  with db.connect() as c:c.execute('UPDATE activities SET distance_m=1000,updated=now() WHERE id=%s AND user_id=%s',(aid,self.ids[0]))
  self.assertEqual(self.items(),[]);self.process();self.assertFalse(any(x['kind']=='first_distance' for x in self.items()))
  with db.connect() as c:c.execute('DELETE FROM activities WHERE id=%s AND user_id=%s',(aid,self.ids[0]))
  self.assertEqual(self.items(),[]);self.process();self.assertEqual(self.items(),[])
  with db.connect() as c:self.assertFalse(c.execute('SELECT valid FROM milestones WHERE id=%s',(offer['id'],)).fetchone()['valid'])
 def test_shared_snapshot_is_kept_when_source_deleted_or_replaced(self):
  aid=self.activity();self.process();offer=self.items()[0];self.clients[0].post('/api/milestones/'+offer['id']+'/seen',json={'action':'shared'})
  with db.connect() as c:c.execute('DELETE FROM activities WHERE id=%s AND user_id=%s',(aid,self.ids[0]))
  self.activity(distance=12000);self.process()
  with db.connect() as c:
   row=c.execute('SELECT shared_at,activity_id,details FROM milestones WHERE id=%s',(offer['id'],)).fetchone();self.assertIsNotNone(row['shared_at']);self.assertEqual(row['activity_id'],aid);self.assertEqual(row['details']['distance_m'],10000)
 def test_food_days_are_cumulative_not_a_streak_and_future_days_wait(self):
  today=self.now.astimezone(M.ZoneInfo('America/New_York')).date()
  with db.connect() as c:
   for n in range(7):c.execute("INSERT INTO food_entries(user_id,day,name,kcal) VALUES(%s,%s,'Fictional food',50)",(self.ids[0],today-dt.timedelta(days=n*3)))
   c.execute("INSERT INTO food_entries(user_id,day,name,kcal) VALUES(%s,%s,'Fictional future food',50)",(self.ids[0],today+dt.timedelta(days=1)))
  self.process();items=self.items(day=str(today));self.assertEqual(len(items),1);self.assertEqual(items[0]['title'],'Logged food on 7 days');self.assertEqual(items[0]['details']['amount'],7);self.assertNotIn('streak',json.dumps(items).lower());self.assertEqual(self.items(day=str(today-dt.timedelta(days=1))),[])
 def test_personal_best_only_offers_best_standard_effort_for_the_same_local_day(self):
  old=self.activity(days=20,distance=5000);a=self.activity(distance=5000);b=self.activity(distance=5000)
  with db.connect() as c:
   for aid,seconds in [(old,1800),(a,1500),(b,1400)]:c.execute("INSERT INTO best_efforts(activity_id,user_id,sport,distance_m,label,elapsed_s,start_time) SELECT id,user_id,sport,5000,'PRIVATE MALFORMED LABEL',%s,start_time FROM activities WHERE id=%s",(seconds,aid))
  self.process();items=[x for x in self.items() if x['kind']=='best'];self.assertEqual(len(items),1);self.assertEqual(items[0]['activity_id'],b);self.assertEqual(items[0]['title'],'New 5K best');self.assertEqual(items[0]['details']['seconds'],1400)
 def test_year_credits_include_earlier_garmin_sources(self):
  self.activity(days=3,distance=90000,source='garmin_connect',device='Forerunner 965');aid=self.activity(distance=11000);self.process();year=[x for x in self.items(activity_id=aid) if x['kind']=='year_distance'];self.assertEqual(year[0]['details']['amount'],100);self.assertEqual(year[0]['details']['garmin_sources'],['Garmin Forerunner 965'])
 def test_notifications_default_off_and_daily_cap_with_private_words(self):
  self.assertFalse(notify._prefs({})['milestones']);self.activity();self.process()
  with db.connect() as c:self.assertEqual(c.execute("SELECT count(*) AS n FROM notifications WHERE user_id=%s AND kind='milestone'",(self.ids[0],)).fetchone()['n'],0)
  self.assertEqual(self.clients[0].put('/api/notifications/settings',json={'milestones':True}).status_code,200)
  self.activity(sport='ride');self.process();self.activity(sport='swim');self.process()
  with db.connect() as c:
   rows=c.execute("SELECT n.id,n.kind,NULL::text AS name,NULL::text AS activity FROM notifications n WHERE n.user_id=%s AND n.kind='milestone'",(self.ids[0],)).fetchall();self.assertEqual(len(rows),1);self.assertEqual(notify._words(rows[0]),('A milestone is ready to review','/me/milestones'))
 def test_private_push_transport_and_live_opt_out_use_native_stand_ins(self):
  self.clients[0].put('/api/notifications/settings',json={'milestones':True});self.activity();self.process();sent=[]
  with db.connect() as c:
   nid=c.execute("SELECT id FROM notifications WHERE user_id=%s AND kind='milestone'",(self.ids[0],)).fetchone()['id'];token=auth.new_session(c,self.ids[0],'fictional native milestones',channel='app')
   c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s)",('0'*64,self.ids[0],auth.token_hash(token)))
  self.assertEqual(notify.push(nid,send=lambda device,payload:sent.append(payload) or True),1);self.assertEqual(sent[0]['url'],'/me/milestones');self.assertNotIn('PRIVATE',json.dumps(sent));self.assertEqual(sent[0]['title'],'Milestone')
  self.clients[0].put('/api/notifications/settings',json={'milestones':False});self.assertEqual(notify.push(nid,send=lambda *_:self.fail('Disabled push sent')),0)
 def test_activity_weeks_require_consecutive_weeks_but_are_never_food_streaks(self):
  # Import history first, then record the current workout. Reverse arrival order correctly stays silent.
  for weeks in (3,2,1,0):self.activity(days=weeks*7,distance=1000)
  self.process();items=[x for x in self.items() if x['kind']=='activity_weeks'];self.assertEqual(len(items),1);self.assertEqual(items[0]['details']['amount'],4)
  with db.connect() as c:c.execute("DELETE FROM activities WHERE user_id=%s AND start_time<%s AND start_time>%s",(self.ids[0],self.now-dt.timedelta(days=6),self.now-dt.timedelta(days=9)))
  self.process();self.assertFalse(any(x['kind']=='activity_weeks' for x in self.items()))
 def test_achievement_tracks_backfill_once_owner_and_keep_best_state(self):
  activity_ids=[self.activity(days=30,distance=5_000_000) for _ in range(10)]
  self.process()
  response=self.clients[0].get('/api/achievements');self.assertEqual(response.status_code,200,response.text)
  self.assertFalse(response.json()['pending'])
  states={row['code']:row for row in response.json()['tracks']}
  self.assertEqual(states['journey']['level'],10)
  self.assertEqual(states['journey']['value_m'],50_000_000)
  self.assertEqual(states['journey']['next']['label'],'To the Moon')
  self.assertEqual(states['workouts']['value'],10)
  self.assertEqual(states['workouts']['next']['threshold'],50)
  self.assertEqual(next(tier['rank'] for tier in states['workouts']['history'] if tier['threshold']==1),1)
  self.assertEqual(states['active_time']['value_s'],36_000)
  self.assertEqual(states['active_time']['next']['threshold'],24*3600)
  self.assertNotIn('personal_bests',states,'No personal-best event means that track has not started')
  with db.connect() as c:
   tiers=c.execute('''SELECT id,code,activity_id,silent FROM milestones
                      WHERE user_id=%s AND kind='track' AND valid ORDER BY code''',(self.ids[0],)).fetchall()
  self.assertTrue(tiers)
  self.assertTrue(all(row['silent'] for row in tiers),'Imported history must backfill without a bell')
  self.assertEqual(len(tiers),len({row['code'] for row in tiers}))
  first_ids={row['code']:row['id'] for row in tiers}
  self.process()
  with db.connect() as c:
   after=c.execute('''SELECT id,code FROM milestones WHERE user_id=%s AND kind='track' AND valid ORDER BY code''',(self.ids[0],)).fetchall()
  self.assertEqual(first_ids,{row['code']:row['id'] for row in after},'Reprocessing must not duplicate or replace a tier')
  self.assertEqual(self.clients[1].get('/api/achievements').json()['tracks'],[],
                   'A second account must not see the first owner’s track rows')
  with db.connect() as c:
   c.execute('DELETE FROM activities WHERE user_id=%s AND id=ANY(%s)',(self.ids[0],activity_ids[:5]))
  self.process()
  updated=self.clients[0].get('/api/achievements').json()
  workout=next(row for row in updated['tracks'] if row['code']=='workouts')
  self.assertEqual(workout['value'],10,'A later edit or deletion must not reduce lifetime progress')
  self.assertEqual(workout['level'],3)
  self.assertIn('trackt:workouts:1.0',[tier['code'] for tier in workout['history']])

 def test_threshold_keys_dedupe_legacy_rank_rows_and_quietly_backfill_early_levels(self):
  for _ in range(10):self.activity(days=20,distance=0)
  legacy_details={'track':'workouts','rank':1,'threshold':10,'label':'Seed','unit':'workouts','big':False}
  state_details={'track':'workouts','label':'Workouts','value':10,'unit':'workouts','level':1,'big':False}
  with db.connect() as c:
   c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details,silent)
                VALUES(%s,'track:workouts:1','track','Seed',1001,%s,%s,%s,true)''',
             (self.ids[0],self.now.date(),self.now,json.dumps(legacy_details)))
   c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details,silent)
                VALUES(%s,'track-state:workouts','track_state','Workouts',0,%s,%s,%s,true)''',
             (self.ids[0],self.now.date(),self.now,json.dumps(state_details)))
  self.clients[0].put('/api/notifications/settings',json={'milestones':True})
  self.process()
  with db.connect() as c:
   rows=c.execute('''SELECT code,details,silent FROM milestones WHERE user_id=%s AND kind='track'
                     AND details->>'track'='workouts' ORDER BY (details->>'threshold')::double precision''',
                  (self.ids[0],)).fetchall()
   pushes=c.execute("SELECT count(*) AS n FROM notifications WHERE user_id=%s AND kind='milestone'",(self.ids[0],)).fetchone()['n']
  self.assertEqual([float(row['details']['threshold']) for row in rows],[1,5,10])
  self.assertEqual(rows[0]['code'],'trackt:workouts:1.0')
  self.assertEqual(rows[1]['code'],'trackt:workouts:5.0')
  self.assertEqual(rows[2]['code'],'track:workouts:1','the legacy row is preserved instead of duplicated')
  self.assertTrue(all(row['details']['quiet'] for row in rows[:2]))
  self.assertTrue(all(row['silent'] for row in rows[:2]),'existing users backfill early levels silently')
  self.assertFalse(rows[2]['details'].get('quiet',False),'the existing Seed level remains loud')
  self.assertEqual(pushes,0,'quiet early levels do not enqueue pushes')
  self.process()
  result=self.clients[0].get('/api/achievements').json()
  workouts=next(track for track in result['tracks'] if track['code']=='workouts')
  self.assertEqual({tier['threshold']:tier['rank'] for tier in workouts['tiers']},{1.0:1,5.0:2,10.0:3})
  with db.connect() as c:
   replay=c.execute("SELECT details->>'threshold' AS threshold FROM milestones WHERE user_id=%s AND kind='track' AND details->>'track'='workouts'",(self.ids[0],)).fetchall()
  self.assertEqual(sorted(float(row['threshold']) for row in replay),[1,5,10],'rerunning the worker never duplicates an early threshold')

 def test_deleted_early_source_activity_does_not_create_a_recent_non_silent_medal(self):
  deleted=self.activity(days=20,distance=0)
  for _ in range(5):self.activity(distance=0)
  zone=M.ZoneInfo('America/New_York');old_day=(self.now-dt.timedelta(days=20)).astimezone(zone).date()
  state_details={'track':'workouts','label':'Workouts','value':10,'unit':'workouts','level':1,'big':False}
  legacy_details={'track':'workouts','rank':1,'threshold':10,'label':'Seed','unit':'workouts','big':False}
  with db.connect() as c:
   c.execute('DELETE FROM activities WHERE user_id=%s AND id=%s',(self.ids[0],deleted))
   c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details,silent)
                VALUES(%s,'track-state:workouts','track_state','Workouts',0,%s,%s,%s,true)''',
             (self.ids[0],old_day,self.now-dt.timedelta(days=20),json.dumps(state_details)))
   c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details,silent)
                VALUES(%s,'track:workouts:1','track','Seed',1001,%s,%s,%s,true)''',
             (self.ids[0],old_day,self.now-dt.timedelta(days=20),json.dumps(legacy_details)))
  self.process()
  with db.connect() as c:
   early=c.execute('''SELECT details->>'threshold' AS threshold,silent,occurred FROM milestones
                      WHERE user_id=%s AND kind='track' AND details->>'track'='workouts'
                        AND (details->>'threshold')::double precision IN (1,5)''',(self.ids[0],)).fetchall()
  self.assertEqual(len(early),2,'the legacy user receives both newly backfilled levels')
  self.assertTrue(all(row['occurred']>=self.now-dt.timedelta(days=7) for row in early),'missing source dates fall back to the only recent activity')
  self.assertTrue(all(row['silent'] for row in early),'deleted-source fallback never becomes a recent non-silent early medal')

 def test_new_first_levels_stay_visible_to_owner_without_friend_or_push_moments(self):
  with db.connect() as c:c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(self.ids[0],self.ids[1]))
  self.clients[0].put('/api/sharing',json={'share_achievements':True})
  self.clients[0].put('/api/notifications/settings',json={'milestones':True})
  self.activity(distance=0);self.process()
  result=self.clients[0].get('/api/achievements');self.assertEqual(result.status_code,200,result.text)
  tracks={row['code']:row for row in result.json()['tracks']}
  for code in ('workouts','consistency','active_time','sport:run'):
   with self.subTest(code=code):
    tier=next(item for item in tracks[code]['tiers'] if item['rank']==1)
    self.assertTrue(tier['quiet'])
  self.assertEqual(next(item for item in tracks['sport:run']['tiers'] if item['rank']==1)['trigger'],'first_activity')
  with db.connect() as c:
   rows=c.execute("""SELECT kind,details,silent FROM milestones WHERE user_id=%s
                     AND ((kind='track' AND details->>'track'=ANY(%s)) OR kind='sport')""",
                  (self.ids[0],['workouts','consistency','active_time','sport:run'])).fetchall()
   pushes=c.execute("SELECT count(*) AS n FROM notifications WHERE user_id=%s AND kind='milestone'",(self.ids[0],)).fetchone()['n']
  quiet_rows=[row for row in rows if row['details'].get('quiet')]
  self.assertGreaterEqual(len(quiet_rows),4,'threshold tiers and the zero-distance First run are stored')
  self.assertTrue(all(not row['silent'] for row in quiet_rows),'fresh quiet awards remain available in app')
  self.assertEqual(pushes,0,'quiet awards do not enqueue pushes')
  feed=self.clients[1].get('/api/feed/friends').json()
  self.assertFalse(any(row.get('kind')=='achievement_moment' for row in feed),'quiet early awards stay out of the friend feed even when sharing is on')

 def test_showcase_pins_owner_scope_friend_sharing_and_live_day_streak(self):
  owner_id,viewer_id=self.ids
  owner,viewer=self.clients
  base=self.now-dt.timedelta(days=2)
  # Higher levels rank first; equal levels use their most recent reached date.
  for code,rank,hours in (('climbing',6,1),('sport:run',5,4),('journey',5,3),('workouts',5,2),('consistency',1,5)):
   self.seed_showcase_track(owner_id,code,rank,base+dt.timedelta(hours=hours))
  zone=M.ZoneInfo('America/New_York');last=self.now.astimezone(zone)-dt.timedelta(hours=1)
  with db.connect() as c:
   for day in range(3):
    at=last-dt.timedelta(days=day)
    c.execute('''INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source)
                 VALUES(%s,'run','Fictional Showcase streak',%s,1000,60,60,'manual')''',(owner_id,at))
   login=c.execute('SELECT login::text AS login FROM users WHERE id=%s',(owner_id,)).fetchone()['login']
  path=f'/api/achievements/showcase?login={login}'
  own=owner.get('/api/achievements/showcase');self.assertEqual(own.status_code,200,own.text)
  self.assertEqual([item['code'] for item in own.json()['items']],['climbing','sport:run','journey','workouts'])
  self.assertEqual(own.json()['available'],[{'code':code,'rank':rank} for code,rank in
                                             (('climbing',6),('consistency',1),('journey',5),('sport:run',5),('workouts',5))],
                   'the owner editor receives exactly the server-computed earned set')
  self.assertEqual(own.json()['day_streak'],3)
  self.assertEqual(viewer.get(path).json(),{'items':[],'pinned':[],'day_streak':0},'sharing starts off for friends')
  self.assertEqual(viewer.post('/api/achievements/showcase/pin',json={'code':'workouts','pinned':True}).status_code,409,
                   'another owner cannot pin the first owner’s medal')
  self.assertEqual(owner.post('/api/achievements/showcase/pin',json={'code':'not-a-track','pinned':True}).status_code,400)
  for code in ('workouts','journey','sport:run','climbing'):
   response=owner.post('/api/achievements/showcase/pin',json={'code':code,'pinned':True})
   self.assertEqual(response.status_code,200,response.text)
  replaced=owner.post('/api/achievements/showcase/pin',json={'code':'consistency','pinned':True})
  self.assertEqual(replaced.json(),{'pinned':['journey','sport:run','climbing','consistency'],'replaced':True})
  replay=owner.post('/api/achievements/showcase/pin',json={'code':'consistency','pinned':True})
  self.assertEqual(replay.json(),{'pinned':['journey','sport:run','climbing','consistency'],'replaced':False},'rerunning a pin never duplicates it')
  reordered=['consistency','climbing','sport:run','journey']
  response=owner.put('/api/achievements/showcase/pins',json={'pinned':reordered})
  self.assertEqual(response.status_code,200,response.text);self.assertEqual(response.json(),{'pinned':reordered})
  self.assertEqual(owner.put('/api/achievements/showcase/pins',json={'pinned':reordered+['workouts']}).status_code,422,
                   'the request model rejects five pins before business validation')
  self.assertEqual(owner.put('/api/achievements/showcase/pins',json={'pinned':['x'*81]}).status_code,422,
                   'the request model rejects oversized achievement codes')
  self.assertEqual(owner.put('/api/achievements/showcase/pins',json={'pinned':['journey','journey']}).status_code,400,
                   'the ordered editor rejects duplicates')
  self.assertEqual(viewer.put('/api/achievements/showcase/pins',json={'pinned':['journey']}).status_code,409,
                   'another owner cannot feature achievements they have not earned')
  self.assertEqual([item['code'] for item in owner.get('/api/achievements/showcase').json()['items']],reordered)
  self.assertEqual(viewer.get('/api/achievements/showcase').json(),{'items':[],'pinned':[],'day_streak':0,'available':[]},
                   'the viewer’s own profile never inherits another user’s pins or streak')
  with db.connect() as c:
   c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(owner_id,viewer_id))
  self.assertEqual(owner.put('/api/sharing',json={'share_achievements':True}).status_code,200)
  shared=viewer.get(path);self.assertEqual(shared.status_code,200,shared.text)
  self.assertEqual(shared.json(),{'items':[{'code':'consistency','rank':1},{'code':'climbing','rank':6},
                                           {'code':'sport:run','rank':5},{'code':'journey','rank':5}],
                                  'pinned':reordered,'day_streak':3})
  self.assertNotIn('available',shared.json(),'friend responses do not expose the full earned set')
  self.assertNotIn('activity_id',shared.text);self.assertNotIn('user_id',shared.text)
  for code in ('journey','sport:run','climbing','consistency'):
   response=owner.post('/api/achievements/showcase/pin',json={'code':code,'pinned':False})
   self.assertEqual(response.status_code,200,response.text)
  automatic=owner.get('/api/achievements/showcase').json()
  self.assertEqual(automatic['pinned'],[],'removing the last pin restores automatic selection')
  self.assertEqual([item['code'] for item in automatic['items']],['climbing','sport:run','journey','workouts'])
  self.assertEqual(viewer.get(path).json()['pinned'],[],'friends see the same unpinned automatic Showcase')
  with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(viewer_id,owner_id))
  self.assertEqual(viewer.get(path).json(),{'items':[],'pinned':[],'day_streak':0},'blocking hides the friend Showcase')
  with db.connect() as c:c.execute('DELETE FROM blocks WHERE user_id=%s AND blocked=%s',(viewer_id,owner_id))
  self.assertEqual(owner.put('/api/sharing',json={'share_achievements':False}).status_code,200)
  self.assertEqual(viewer.get(path).json(),{'items':[],'pinned':[],'day_streak':0},'turning sharing off hides pins and streak')
  with db.connect() as c:
   c.execute('DELETE FROM activities WHERE user_id=%s',(owner_id,))
   c.execute('''INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source)
                VALUES(%s,'run','Fictional stale streak',%s,1000,60,60,'manual')''',(owner_id,self.now-dt.timedelta(days=3)))
  self.assertEqual(owner.get('/api/achievements/showcase').json()['day_streak'],0,'a streak older than yesterday is no longer current')

 def test_catalog_history_uses_exact_crossing_dates_and_legacy_dates_after_deletion(self):
  activities=[self.lifted_activity(days,kg) for days,kg in ((8,1000),(5,1000),(2,50),(1,1000))]
  self.process()
  response=self.clients[0].get('/api/achievement-history/lifted');self.assertEqual(response.status_code,200,response.text)
  tiers=response.json()['tiers'];names=[row['name'] for row in tiers]
  self.assertEqual(names,['A grand piano','A car','An elephant','A school bus','A loaded semi truck','A blue whale','Statue of Liberty'])
  statue=next(row for row in tiers if row['name']=='Statue of Liberty')
  expected=(self.now-dt.timedelta(hours=2)-dt.timedelta(days=2)).astimezone(M.ZoneInfo('America/New_York')).date().isoformat()
  self.assertEqual(statue['day'],expected,'the catalog level date is when the cumulative total first passed 204,117 kg')
  self.assertEqual(statue['activity_id'],activities[2])
  self.assertEqual(statue['date_source'],'activity')
  self.assertEqual(self.clients[1].get('/api/achievement-history/lifted').json()['tiers'],[],'history remains private to its owner')
  with db.connect() as c:
   saved=c.execute("SELECT day FROM milestones WHERE user_id=%s AND kind='track' AND details->>'track'='lifted' AND (details->>'threshold')::double precision=204117",(self.ids[0],)).fetchone()
   self.assertIsNotNone(saved,'the worker keeps the legacy crossing date')
   c.execute('DELETE FROM activities WHERE user_id=%s AND id=ANY(%s)',(self.ids[0],activities))
  fallback=self.clients[0].get('/api/achievement-history/lifted');self.assertEqual(fallback.status_code,200,fallback.text)
  statue=next(row for row in fallback.json()['tiers'] if row['name']=='Statue of Liberty')
  self.assertEqual(statue['day'],saved['day'].isoformat(),'a durable legacy milestone supplies the date after source deletion')
  self.assertEqual(statue['date_source'],'legacy')
  self.assertIsNone(statue['activity_id'],'a deleted activity does not leave a dead history link')
 def test_units_are_the_account_units_and_nonstandard_efforts_are_excluded(self):
  with db.connect() as c:c.execute("UPDATE profile SET units='imperial' WHERE user_id=%s",(self.ids[0],))
  aid=self.activity(distance=161000);self.process();items=self.items();year=[x for x in items if x['kind']=='year_distance'];self.assertEqual(year[0]['details']['unit'],'mi');self.assertIn('100 miles',year[0]['title'])
  with db.connect() as c:c.execute("INSERT INTO best_efforts(activity_id,user_id,sport,distance_m,label,elapsed_s,start_time) SELECT id,user_id,sport,123,'Custom private label',100,start_time FROM activities WHERE id=%s",(aid,))
  self.process();self.assertFalse(any(x['kind']=='best' for x in self.items()))
 def test_old_history_arriving_after_a_current_workout_keeps_new_totals_silent(self):
  self.activity(distance=1000);self.process()
  for weeks in (3,2,1):self.activity(days=weeks*7,distance=1000)
  self.process()
  with db.connect() as c:
   row=c.execute("SELECT valid,silent FROM milestones WHERE user_id=%s AND code='weeks:4'",(self.ids[0],)).fetchone();self.assertEqual(row,{'valid':True,'silent':True})
  self.assertFalse(any(x['kind']=='activity_weeks' for x in self.items()),'Old imports must not create a new celebration after the current workout was already processed')
 def test_ownership_export_and_real_reader_rows(self):
  self.activity();self.activity(uid=self.ids[1]);self.process();self.process(self.ids[1]);offer=self.items()[0]
  self.assertEqual(self.clients[1].get('/api/milestones',params={'milestone_id':offer['id']}).json()['items'],[]);self.assertEqual(self.clients[1].post('/api/milestones/'+offer['id']+'/seen',json={'action':'dismiss'}).status_code,404)
  role='zz_test_milestone_reader_'+uuid.uuid4().hex[:8];password='fictional reader testing phrase'
  try:
   with db.connect() as c:
    c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids[0]))
    for table in ('milestones','milestone_state'):
     self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s',(table,)).fetchone()['relrowsecurity']);self.assertTrue(c.execute(api_mydata.TABLES[table],(self.ids[0],)).fetchall())
   with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as reader:
    for table in ('milestones','milestone_state'):
     rows=reader.execute(sql.SQL('SELECT user_id FROM {}').format(sql.Identifier(table))).fetchall();self.assertTrue(rows);self.assertTrue(all(r['user_id']==self.ids[0] for r in rows))
     with self.assertRaises(psycopg.errors.InsufficientPrivilege):
      with reader.transaction():reader.execute(sql.SQL('DELETE FROM {}').format(sql.Identifier(table)))
  finally:
   with db.connect() as c:c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids[0],));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
 def test_worker_and_erasure_follow_the_same_account_first_lock_order(self):
  aid=self.activity();entered=threading.Event();release=threading.Event();done=threading.Event();failures=[];pids={}
  original=M.candidates
  def paused(*args):
   entered.set();self.assertTrue(release.wait(5));return original(*args)
  def worker():
   try:
    with db.connect() as c:
     pids['worker']=c.execute('SELECT pg_backend_pid() AS pid').fetchone()['pid'];M.process(c,self.ids[0],self.now)
   except Exception as e:failures.append(e)
  def erase():
   try:
    from app.api_account import erase
    with db.connect() as c:
     c.execute("SET statement_timeout='6s'");pids['erase']=c.execute('SELECT pg_backend_pid() AS pid').fetchone()['pid'];erase(c,{'id':self.ids[0],'sql_role':None})
   except Exception as e:failures.append(e)
   finally:done.set()
  with patch('app.milestones.candidates',side_effect=paused),patch('app.notify._push_later'):
   t=threading.Thread(target=worker);t.start();self.assertTrue(entered.wait(3));e=threading.Thread(target=erase);e.start()
   try:
    blocked=False;end=time.monotonic()+3
    while time.monotonic()<end and not done.is_set():
     if 'erase' in pids:
      with db.connect() as c:blocked=pids['worker'] in c.execute('SELECT pg_blocking_pids(%s) AS ids',(pids['erase'],)).fetchone()['ids']
      if blocked:break
     time.sleep(.02)
    self.assertTrue(blocked,'Erasure must wait on the account before touching milestone/activity rows')
   finally:release.set();t.join(6);e.join(6)
  self.assertFalse(t.is_alive());self.assertFalse(e.is_alive());self.assertEqual(failures,[])
  with db.connect() as c:
   for table in ('users','milestone_state','milestones','activities','notifications'):
    key='id' if table=='users' else 'user_id';self.assertEqual(c.execute(f'SELECT count(*) AS n FROM {table} WHERE {key}=%s',(self.ids[0],)).fetchone()['n'],0)
 def test_history_scan_does_not_block_saves_and_retries_a_changed_generation(self):
  aid=self.activity();entered=threading.Event();release=threading.Event();saved=threading.Event();failures=[];results=[];original=M.candidates
  def paused(*args):
   result=original(*args);entered.set();self.assertTrue(release.wait(5));return result
  def scan():
   try:
    with db.connect() as c:results.append(M.process(c,self.ids[0],self.now))
   except Exception as e:failures.append(e)
  def save():
   try:
    with db.connect() as c:
     c.execute("SET statement_timeout='2s'");c.execute('UPDATE activities SET distance_m=2000,updated=now() WHERE id=%s',(aid,))
    saved.set()
   except Exception as e:failures.append(e)
  with patch('app.milestones.candidates',side_effect=paused):
   t=threading.Thread(target=scan);t.start();self.assertTrue(entered.wait(3));s=threading.Thread(target=save);s.start()
   try:
    self.assertTrue(saved.wait(2.5),'An activity save must commit while milestone history is still being scanned')
    with db.connect() as c:self.assertFalse(M.process(c,self.ids[0],self.now),'A second worker skips the claimed account')
   finally:release.set();t.join(6);s.join(6)
  self.assertEqual(failures,[]);self.assertEqual(results,[False],'Changed history must remain pending rather than publish stale milestones')
  with db.connect() as c:self.assertTrue(c.execute('SELECT generation>processed AS pending FROM milestone_state WHERE user_id=%s',(self.ids[0],)).fetchone()['pending'])
  self.process();self.assertFalse(any(x['kind']=='first_distance' for x in self.items()))
 def test_quiet_history_sleeps_until_a_real_future_entry_becomes_eligible(self):
  self.activity();self.process()
  with db.connect() as c:self.assertEqual(c.execute('SELECT next_check FROM milestone_state WHERE user_id=%s',(self.ids[0],)).fetchone()['next_check'],M.IDLE_CHECK)
  today=self.now.astimezone(M.ZoneInfo('America/New_York')).date();future=today+dt.timedelta(days=2)
  with db.connect() as c:c.execute("INSERT INTO food_entries(user_id,day,name,kcal) VALUES(%s,%s,'Fictional future meal',50)",(self.ids[0],future))
  self.process()
  with db.connect() as c:self.assertEqual(c.execute('SELECT next_check FROM milestone_state WHERE user_id=%s',(self.ids[0],)).fetchone()['next_check'],dt.datetime.combine(future,dt.time.min,M.ZoneInfo('America/New_York')))
 def test_push_is_dispatched_only_after_a_successful_commit(self):
  self.clients[0].put('/api/notifications/settings',json={'milestones':True});self.activity();seen=[]
  class ImmediateThread:
   def __init__(self,target,args,daemon):self.target=target;self.args=args
   def start(self):self.target(*self.args)
  def delivered(nid):
   with db.connect() as c:seen.append(bool(c.execute('SELECT id FROM notifications WHERE id=%s',(nid,)).fetchone()))
  original=M.process
  def rolled_back(*args,**kw):original(*args,**kw);raise RuntimeError('Fictional commit failure')
  with patch('app.milestones.threading.Thread',ImmediateThread),patch('app.notify._push_later',side_effect=delivered):
   with patch('app.milestones.process',side_effect=rolled_back):
    with self.assertRaises(RuntimeError):M.process_committed(self.ids[0],self.now)
   self.assertEqual(seen,[],'A rolled-back notification must never reach push dispatch')
   self.assertTrue(M.process_committed(self.ids[0],self.now));self.assertEqual(seen,[True],'Push can immediately read the committed notification')
 def test_calendar_year_uses_the_persons_local_day_across_dst(self):
  self.now=dt.datetime(2026,1,1,5,30,tzinfo=dt.timezone.utc)
  with db.connect() as c:
   for at,distance in [('2026-01-01T04:30:00+00:00',99000),('2026-01-01T05:00:00+00:00',2000)]:
    c.execute("INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source) VALUES(%s,'run','Fictional boundary',%s,%s,60,60,'manual')",(self.ids[0],at,distance))
   facts,_=M.candidates(c,self.ids[0],self.now,M.ZoneInfo('America/New_York'),'metric')
  self.assertFalse(any(x['kind']=='year_distance' for x in facts.values()),'Previous local year cannot contribute to this year')
  zone=M.ZoneInfo('America/New_York');self.assertEqual(dt.datetime(2026,11,1,5,30,tzinfo=dt.timezone.utc).astimezone(zone).date(),dt.datetime(2026,11,1,6,30,tzinfo=dt.timezone.utc).astimezone(zone).date())
 def test_future_and_open_workouts_do_not_fire_early(self):
  aid=self.activity()
  with db.connect() as c:c.execute("UPDATE activities SET start_time=now()+interval '1 day' WHERE id=%s",(aid,))
  self.process();self.assertEqual(self.items(),[])
  with db.connect() as c:c.execute("UPDATE activities SET start_time=now()-interval '2 hours',lift_open=true WHERE id=%s",(aid,))
  self.process();self.assertEqual(self.items(),[])
 def test_achievement_moments_are_private_weekly_and_reaction_safe(self):
  owner,friend=self.clients;owner_id,friend_id=self.ids
  with db.connect() as c:
   people=c.execute('SELECT id,login::text AS login FROM users WHERE id=ANY(%s)',(self.ids,)).fetchall();logins={r['id']:r['login'] for r in people}
   c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(owner_id,friend_id))
  owner_login=logins[owner_id]
  self.assertFalse(owner.get('/api/sharing').json()['share_achievements'],'achievement sharing starts off')
  self.assertFalse(any(row.get('kind')=='achievement_moment' for row in friend.get('/api/feed/friends').json()),'off state hides moments from the friend feed')
  response=owner.put('/api/sharing',json={'share_achievements':True});self.assertEqual(response.status_code,200,response.text)
  with db.connect() as c:since=c.execute('SELECT share_achievements_since FROM profile WHERE user_id=%s',(owner_id,)).fetchone()['share_achievements_since']
  base=since-dt.timedelta(days=10);zone=M.ZoneInfo('America/New_York')
  with db.connect() as c:c.execute('UPDATE profile SET share_achievements_since=%s WHERE user_id=%s',(since-dt.timedelta(days=12),owner_id))
  events=[
   ('track:journey:test:marathon', 'track', 'Marathon', 3, base+dt.timedelta(minutes=2), {'track':'journey','rank':3,'threshold':42195,'label':'Marathon','unit':'km','big':True}),
   ('sport:run:test:first', 'sport', 'First run', 1, base+dt.timedelta(minutes=4), {'sport':'run','rank':1,'label':'First run','unit':'count'}),
   ('track:journey:test:ironman', 'track', 'Ironman 70.3', 4, base+dt.timedelta(minutes=6), {'track':'journey','rank':4,'threshold':113137,'label':'Ironman 70.3','unit':'km','big':True}),
   ('track:journey:test:us', 'track', 'Across the US', 7, base+dt.timedelta(minutes=8), {'track':'journey','rank':7,'threshold':4506163,'label':'Across the US','unit':'km','big':True}),
   ('track:journey:test:small', 'track', 'Small tier', 8, base+dt.timedelta(minutes=9), {'track':'journey','rank':8,'threshold':5000000,'label':'Small tier','unit':'km','big':False}),
   ('track:journey:test:moon', 'track', 'To the Moon', 11, base+dt.timedelta(days=8), {'track':'journey','rank':11,'threshold':384399861,'label':'To the Moon','unit':'km','big':True}),
  ]
  with db.connect() as c:
   c.execute("INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES(%s,'track:journey:test:state','track_state','Journey',0,%s,%s,%s)",
             (owner_id,base.astimezone(zone).date(),base,psycopg.types.json.Jsonb({'track':'journey','value_m':4506163,'label':'Journey','unit':'km'})))
   for code,kind,title,rank,occurred,details in events:
    c.execute('INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES(%s,%s,%s,%s,%s,%s,%s,%s)',
              (owner_id,code,kind,title,rank,occurred.astimezone(zone).date(),occurred,psycopg.types.json.Jsonb(details)))
  achievements=owner.get('/api/achievements').json();journey=next(t for t in achievements['tracks'] if t['code']=='journey')
  self.assertTrue(next(t for t in journey['tiers'] if t['title']=='Across the US')['big'],'the owner API exposes the worker big flag')
  feed=friend.get('/api/feed/friends').json();moments=[row for row in feed if row.get('kind')=='achievement_moment']
  self.assertEqual(len(moments),2,'multiple big tiers fold into one moment per owner per local week')
  first_week=next(m for m in moments if m['week_start']==(base.astimezone(zone).date()-dt.timedelta(days=base.astimezone(zone).date().weekday())).isoformat())
  self.assertEqual(first_week['title'],'Across the US');self.assertEqual(first_week['extra_count'],2,'three loud catalog tiers fold together; the quiet First and small tier do not')
  self.assertTrue(first_week['is_track'],'the leading journey tier is identified for its feed icon')
  for moment in moments:
   self.assertLess(moment['id'],0)
   for private_key in ('activity_id','distance_m','line','calories','route_id','food','user_id'):
    self.assertNotIn(private_key,moment,f'moment has no {private_key}')
  path=f"/api/achievement-moments/{owner_login}/{first_week['week_start']}"
  reacted=friend.post(path+'/reaction',json={'kind':'clap'});self.assertEqual(reacted.status_code,200,reacted.text);self.assertEqual(reacted.json()['my_reaction'],'clap')
  profile_response=friend.get(f'/api/people/{owner_login}/profile');self.assertEqual(profile_response.status_code,200,profile_response.text);profile=profile_response.json();profile_text=json.dumps(profile)
  self.assertNotIn('Across the US',profile_text,'friend profile JSON does not expose achievement history before its separate build')
  response=owner.put('/api/sharing',json={'share_achievements':False});self.assertEqual(response.status_code,200,response.text)
  self.assertFalse(any(row.get('kind')=='achievement_moment' for row in friend.get('/api/feed/friends').json()),'turning sharing off removes prior moments')
  self.assertEqual(friend.get(path+'/reactions').status_code,404,'off moments cannot be read directly')
  with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM achievement_moment_reactions WHERE owner_id=%s',(owner_id,)).fetchone()['n'],0)
  response=owner.put('/api/sharing',json={'share_achievements':True});self.assertEqual(response.status_code,200,response.text)
  self.assertFalse(any(row.get('kind')=='achievement_moment' for row in friend.get('/api/feed/friends').json()),'re-enabling does not republish past moments')
if __name__=='__main__':unittest.main(verbosity=2)
