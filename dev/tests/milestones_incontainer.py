"""Fictional owner records, silent imports, once-only offers, invalidation and opt-in private push."""
import datetime as dt,json,unittest,uuid,threading,time
from unittest.mock import patch
from fastapi.testclient import TestClient
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from app import db,auth,milestones as M,notify,api_mydata
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
  at=self.now-dt.timedelta(days=days,hours=2)
  with db.connect() as c:return c.execute("INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source,device,visibility) VALUES(%s,%s,'PRIVATE WORKOUT TITLE',%s,%s,3600,3600,%s,%s,'me') RETURNING id",(uid or self.ids[0],sport,at,distance,source,device)).fetchone()['id']
 def process(self,uid=None):
  with patch('app.notify._push_later'):
   with db.connect() as c:M.process(c,uid or self.ids[0],self.now)
 def items(self,**params):
  r=self.clients[0].get('/api/milestones',params=params);self.assertEqual(r.status_code,200,r.text);return r.json()['items']
 def test_fixed_firsts_priorities_private_warning_and_once_only(self):
  aid=self.activity(distance=42200);self.process();items=self.items(activity_id=aid);self.assertEqual(items[0]['title'],'First marathon');self.assertTrue(items[0]['private_activity']);self.assertNotIn('PRIVATE',json.dumps(items));ids=[x['id'] for x in items]
  self.process();self.assertEqual(ids,[x['id'] for x in self.items(activity_id=aid)])
  for item in items:self.assertEqual(self.clients[0].post('/api/milestones/'+item['id']+'/seen',json={'action':'dismiss'}).status_code,200)
  self.process();self.assertEqual(self.items(),[])
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
  for weeks in (0,1,2,3):self.activity(days=weeks*7,distance=1000)
  self.process();items=[x for x in self.items() if x['kind']=='activity_weeks'];self.assertEqual(len(items),1);self.assertEqual(items[0]['details']['amount'],4)
  with db.connect() as c:c.execute("DELETE FROM activities WHERE user_id=%s AND start_time<%s AND start_time>%s",(self.ids[0],self.now-dt.timedelta(days=6),self.now-dt.timedelta(days=9)))
  self.process();self.assertFalse(any(x['kind']=='activity_weeks' for x in self.items()))
 def test_units_are_the_account_units_and_nonstandard_efforts_are_excluded(self):
  with db.connect() as c:c.execute("UPDATE profile SET units='imperial' WHERE user_id=%s",(self.ids[0],))
  aid=self.activity(distance=161000);self.process();items=self.items();year=[x for x in items if x['kind']=='year_distance'];self.assertEqual(year[0]['details']['unit'],'mi');self.assertIn('100 miles',year[0]['title'])
  with db.connect() as c:c.execute("INSERT INTO best_efforts(activity_id,user_id,sport,distance_m,label,elapsed_s,start_time) SELECT id,user_id,sport,123,'Custom private label',100,start_time FROM activities WHERE id=%s",(aid,))
  self.process();self.assertFalse(any(x['kind']=='best' for x in self.items()))
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
if __name__=='__main__':unittest.main(verbosity=2)
