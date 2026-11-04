"""Typed reactions, compatibility, privacy, cancelled queues and native delivery stand-ins."""
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch,Mock
from fastapi.testclient import TestClient
from app import db,auth,notify,reactions
from psycopg import errors
from app.main import app

class Reactions(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.ids=[];cls.clients=[];cls.tokens=[]
  with db.connect() as c:
   for suffix in ('owner','actor','other'):
    uid=c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',('zz_test_reaction_'+suffix,'Reaction '+suffix)).fetchone()['id'];cls.ids.append(uid)
    c.execute('INSERT INTO profile(user_id) VALUES (%s)',(uid,));token=auth.new_session(c,uid,'fictional reaction test');cls.tokens.append(token)
    client=TestClient(app);client.headers['Content-Type']='application/json';client.cookies.set(auth.COOKIE,token);cls.clients.append(client)
   cls.aid=c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,visibility) VALUES (%s,'run','Fictional park run',now(),'manual','everyone') RETURNING id",(cls.ids[0],)).fetchone()['id']
   c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES (%s,'sandbox',%s,%s)",('ab'*32,cls.ids[0],auth.token_hash(cls.tokens[0])))
 @classmethod
 def tearDownClass(cls):
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(cls.ids,))
 def setUp(self):
  self.owner,self.actor,self.other=self.clients;self.path=f'/api/activities/{self.aid}'
  self.push=patch('app.notify._push_later',return_value=None);self.push.start();self.addCleanup(self.push.stop)
  with db.connect() as c:
   c.execute('DELETE FROM cheers WHERE activity_id=%s',(self.aid,));c.execute('DELETE FROM notifications WHERE activity_id=%s',(self.aid,));c.execute('DELETE FROM blocks WHERE user_id=ANY(%s)',(self.ids,));c.execute("UPDATE activities SET visibility='everyone' WHERE id=%s",(self.aid,));c.execute("UPDATE profile SET notify='{}' WHERE user_id=ANY(%s)",(self.ids,))
 def notes(self):
  with db.connect() as c:return c.execute('SELECT id,reaction_kind,cancelled FROM notifications WHERE activity_id=%s ORDER BY id',(self.aid,)).fetchall()
 def test_catalog_and_all_approved_choices(self):
  catalog=self.actor.get('/api/me').json()['reaction_choices']
  expected={'👏','💪','🔥','❤️','🎉','🙌','😮','⚡','🥇','💯','🏃','🚴','🏊','🥾',None,'⛰️'}
  self.assertEqual(len(catalog),16);self.assertEqual({row[2] for row in catalog},expected)
  self.assertEqual(len({row[0] for row in catalog}),16);self.assertTrue(all(row[1] for row in catalog))
  self.assertEqual(dict((kind,label) for kind,label,_ in catalog)['bolt'],'fast')
  self.assertEqual(dict((kind,label) for kind,label,_ in catalog)['lift'],'barbell')
  self.assertNotIn('laugh',{row[0] for row in catalog});self.assertEqual(reactions.LEGACY['laugh'],'clap')
  self.assertEqual(reactions.canonical('laugh'),'clap');self.assertIsNone(reactions.canonical(None))
  for kind,label,emoji in catalog:
   for value in ((kind,emoji) if emoji is not None else (kind,)):
    with self.subTest(kind=kind,input=value):
     r=self.actor.post(self.path+'/reaction',json={'kind':value});self.assertEqual(r.status_code,200,r.text)
     data=r.json();self.assertEqual(data['my_reaction'],kind);self.assertEqual(data['cheers'][0]['kind'],kind)
     self.assertEqual(set(data['reactions']),{row[0] for row in catalog});self.assertEqual(data['reactions'][kind],1)
     self.assertEqual(sum(data['reactions'].values()),1);self.assertEqual(len(data['cheers']),1)
  self.assertEqual(len(self.notes()),1,'changing emoji retains the existing daily notice')
  with db.connect() as c:
   stored=c.execute('SELECT kind FROM cheers WHERE activity_id=%s AND user_id=%s',(self.aid,self.ids[1])).fetchone()
  self.assertEqual(stored['kind'],catalog[-1][0])
 def test_lift_notification_uses_barbell_word(self):
  text,link=notify._words({'kind':'cheer','name':'Alex','activity':'workout','activity_id':7,'reaction_kind':'lift'})
  self.assertEqual(text,'Alex reacted with a barbell to your workout');self.assertEqual(link,'/activity/7')
 def test_replace_retry_and_legacy(self):
  self.assertEqual(self.actor.post(self.path+'/cheer').json()['my_reaction'],'clap')
  for legacy,kind in [('cheer','clap'),('strong','muscle'),('applause','fire'),('laugh','clap')]:
   r=self.actor.post(self.path+'/reaction',json={'kind':legacy});self.assertEqual(r.status_code,200,r.text);data=r.json()
   self.assertEqual(data['my_reaction'],kind);self.assertTrue(data['cheered']);self.assertEqual(len(data['cheers']),1)
   self.assertEqual(data['reactions'][kind],1);self.assertEqual(sum(data['reactions'].values()),1)
   self.assertEqual(self.actor.post(self.path+'/reaction',json={'kind':legacy}).json()['my_reaction'],kind)
  self.assertEqual(len(self.notes()),1);self.assertEqual(self.notes()[0]['reaction_kind'],'clap')
  shared=self.actor.get('/api/shared/'+str(self.aid)).json();self.assertEqual(shared['my_reaction'],'clap');self.assertEqual(shared['reactions']['clap'],1)
  self.actor.post(self.path+'/cheer');self.assertEqual(self.actor.get(self.path+'/social').json()['my_reaction'],'clap')
  self.assertEqual(self.actor.post(self.path+'/reaction',json={}).json()['my_reaction'],'clap')
 def test_unlisted_input_rejected_without_changing_state(self):
  self.actor.post(self.path+'/reaction',json={'kind':'heart'})
  for value in ['unknown','✨','👍','😂','🔥🔥','clap; DROP TABLE cheers','',None,42,[],{}]:
   with self.subTest(value=value):
    self.assertEqual(self.actor.post(self.path+'/reaction',json={'kind':value}).status_code,422)
  state=self.actor.get(self.path+'/social').json();self.assertEqual(state['my_reaction'],'heart')
  self.assertEqual(state['reactions']['heart'],1);self.assertEqual(sum(state['reactions'].values()),1)
  self.assertEqual(self.notes()[0]['reaction_kind'],'heart');self.assertEqual(len(self.notes()),1)
 def test_each_person_changes_only_their_reaction(self):
  self.actor.post(self.path+'/reaction',json={'kind':'fire'});self.other.post(self.path+'/reaction',json={'kind':'heart'})
  self.actor.post(self.path+'/reaction',json={'kind':'gold'})
  state=self.other.get(self.path+'/social').json();self.assertEqual(state['my_reaction'],'heart')
  self.assertEqual(state['reactions']['gold'],1);self.assertEqual(state['reactions']['heart'],1);self.assertEqual(state['reactions']['fire'],0)
  self.other.delete(self.path+'/reaction');state=self.actor.get(self.path+'/social').json()
  self.assertEqual(state['my_reaction'],'gold');self.assertEqual(sum(state['reactions'].values()),1)
 def test_remove_cancels_and_reactivation_throttles(self):
  self.actor.post(self.path+'/reaction',json={'kind':'strong'});nid=self.notes()[0]['id']
  self.assertEqual(len(self.owner.get('/api/notifications').json()['items']),1)
  r=self.actor.delete(self.path+'/reaction');self.assertEqual(r.status_code,200);self.assertIsNone(r.json()['my_reaction']);self.assertEqual(sum(r.json()['reactions'].values()),0)
  self.assertTrue(self.notes()[0]['cancelled']);self.assertEqual(self.owner.get('/api/notifications').json()['items'],[])
  self.assertIsNone(notify.push(nid,send=lambda *_:self.fail('removed reaction delivered')))
  self.actor.post(self.path+'/reaction',json={'kind':'applause'});self.assertEqual(self.notes()[0]['id'],nid);self.assertFalse(self.notes()[0]['cancelled']);self.assertEqual(len(self.notes()),1)
 def test_self_no_alert_and_own_feed(self):
  self.owner.post(self.path+'/reaction',json={'kind':'strong'});self.assertEqual(self.notes(),[])
  row=next(r for r in self.owner.get('/api/activities').json() if r['id']==self.aid);self.assertEqual(row['my_reaction'],'muscle');self.assertEqual(row['reactions']['muscle'],1)
 def test_privacy_blocks_and_removal_after_access_loss(self):
  self.actor.post(self.path+'/reaction',json={'kind':'strong'})
  with db.connect() as c:c.execute("UPDATE activities SET visibility='me' WHERE id=%s",(self.aid,))
  self.assertEqual(self.other.post(self.path+'/reaction',json={'kind':'applause'}).status_code,404)
  self.assertEqual(self.actor.get(self.path+'/social').status_code,404)
  self.assertEqual(self.actor.delete(self.path+'/reaction').json(),{'ok':True})
  with db.connect() as c:
   c.execute("UPDATE activities SET visibility='everyone' WHERE id=%s",(self.aid,));c.execute("INSERT INTO cheers(activity_id,user_id,kind) VALUES(%s,%s,'muscle')",(self.aid,self.ids[1]))
  for blocker,blocked in [(self.ids[0],self.ids[1]),(self.ids[1],self.ids[0])]:
   with self.subTest(blocker=blocker):
    with db.connect() as c:
     c.execute('DELETE FROM blocks WHERE user_id=ANY(%s)',(self.ids,));c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(blocker,blocked))
    self.assertEqual(self.actor.post(self.path+'/reaction',json={'kind':'cheer'}).status_code,404)
    self.assertEqual(self.owner.get(self.path+'/social').json()['cheers'],[])
    own=next(r for r in self.owner.get('/api/activities').json() if r['id']==self.aid);self.assertEqual(own['cheers'],0);self.assertEqual(sum(own['reactions'].values()),0)
 def test_native_words_preferences_revocation_and_final_recheck(self):
  self.actor.post(self.path+'/reaction',json={'kind':'applause'});nid=self.notes()[0]['id'];sent=[]
  self.assertEqual(notify.push(nid,send=lambda d,p:sent.append(p) or True),1);self.assertIn('reacted 🔥 to your',sent[-1]['body']);self.assertEqual(sent[-1]['url'],f'/activity/{self.aid}')
  with db.connect() as c:c.execute("UPDATE profile SET notify='{"+'"cheers":false'+"}' WHERE user_id=%s",(self.ids[0],))
  self.assertEqual(notify.push(nid,send=lambda *_:self.fail('preference ignored')),0)
  with db.connect() as c:c.execute("UPDATE profile SET notify='{}' WHERE user_id=%s",(self.ids[0],))
  original=notify._deliver_native
  def cancel_before_device(uid,payload,prepare,send):
   self.actor.delete(self.path+'/reaction');return original(uid,payload,prepare,send)
  sender=Mock(return_value=True)
  with patch('app.notify._deliver_native',side_effect=cancel_before_device):self.assertEqual(notify.push(nid,send=sender),0)
  sender.assert_not_called()
  self.actor.post(self.path+'/reaction',json={'kind':'strong'})
  def change_before_device(uid,payload,prepare,send):
   self.actor.post(self.path+'/reaction',json={'kind':'applause'});return original(uid,payload,prepare,send)
  with patch('app.notify._deliver_native',side_effect=change_before_device):self.assertEqual(notify.push(nid,send=lambda d,p:sent.append(p) or True),1)
  self.assertIn('reacted 🔥 to your',sent[-1]['body'])
  self.owner.post('/api/logout')
  try:
   sender=Mock(return_value=True);self.assertEqual(notify.push(nid,send=sender),0);sender.assert_not_called()
  finally:
   # Restore only this fictional session for later tests.
   with db.connect() as c:
    token=auth.new_session(c,self.ids[0],'fictional reaction test');self.tokens[0]=token
    c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES (%s,'sandbox',%s,%s) ON CONFLICT(token,environment) DO UPDATE SET session_hash=excluded.session_hash",('ab'*32,self.ids[0],auth.token_hash(token)))
   self.owner.cookies.clear();self.owner.cookies.set(auth.COOKIE,token)
 def test_concurrent_replacement_is_one_row_and_one_notice(self):
  def change(kind):
   client=TestClient(app);client.headers['Content-Type']='application/json';client.cookies.set(auth.COOKIE,self.tokens[1]);return client.post(self.path+'/reaction',json={'kind':kind}).status_code
  with ThreadPoolExecutor(max_workers=4) as pool:self.assertEqual(list(pool.map(change,['cheer','strong','applause','strong'])),[200]*4)
  state=self.owner.get(self.path+'/social').json();self.assertEqual(len(state['cheers']),1);self.assertEqual(sum(state['reactions'].values()),1);self.assertEqual(len(self.notes()),1)

 def test_atomic_rollback(self):
  with patch('app.api_social._social',side_effect=RuntimeError('fictional read failure')):
   with self.assertRaises(RuntimeError):self.actor.post(self.path+'/reaction',json={'kind':'strong'})
  self.assertEqual(self.notes(),[]);self.assertEqual(self.owner.get(self.path+'/social').json()['cheers'],[])

 def test_upgrade_preserves_rows_and_notification_state(self):
  # Temporary tables shadow only this connection's real names and disappear at commit.
  # Execute the actual migration SQL, rather than reproducing its transformations.
  migration=next(stmt for stmt in db.MIGRATIONS if "ALTER TABLE cheers ALTER COLUMN kind SET DEFAULT 'clap'" in stmt)
  with db.connect() as c:
   c.execute("""CREATE TEMP TABLE cheers(activity_id bigint,user_id bigint,
     kind text NOT NULL DEFAULT 'cheer' CONSTRAINT cheers_kind_check CHECK(kind IN ('cheer','strong','applause')),
     created timestamptz NOT NULL,PRIMARY KEY(activity_id,user_id)) ON COMMIT DROP;
     ALTER TABLE cheers ENABLE ROW LEVEL SECURITY;
     CREATE POLICY own_rows ON cheers USING(user_id=1);
     CREATE TEMP TABLE notifications(id bigint PRIMARY KEY,reaction_kind text
       CONSTRAINT notifications_reaction_kind_check CHECK(reaction_kind IN ('cheer','strong','applause')),
       created timestamptz NOT NULL,read_at timestamptz,cancelled boolean NOT NULL) ON COMMIT DROP;""")
   self.assertEqual(c.execute("SELECT 'cheers'::regclass::oid='pg_temp.cheers'::regclass::oid AS safe").fetchone()['safe'],True)
   self.assertEqual(c.execute("SELECT 'notifications'::regclass::oid='pg_temp.notifications'::regclass::oid AS safe").fetchone()['safe'],True)
   c.execute("""INSERT INTO cheers(activity_id,user_id,kind,created) VALUES
     (1,1,'cheer','2026-01-01T01:00Z'),(1,2,'strong','2026-01-02T01:00Z'),(1,3,'applause','2026-01-03T01:00Z');
     INSERT INTO notifications VALUES
     (11,'cheer','2026-01-01T01:00Z',NULL,false),
     (12,'strong','2026-01-02T01:00Z','2026-01-02T02:00Z',true),
     (13,'applause','2026-01-03T01:00Z',NULL,true),
     (14,NULL,'2026-01-04T01:00Z',NULL,false);""")
   old_rows=c.execute('SELECT * FROM pg_temp.cheers ORDER BY user_id').fetchall()
   old_notes=c.execute('SELECT * FROM pg_temp.notifications ORDER BY id').fetchall()
   policy=c.execute("SELECT relrowsecurity,pg_get_expr(polqual,polrelid) AS rule FROM pg_class JOIN pg_policy ON polrelid=pg_class.oid WHERE pg_class.oid='pg_temp.cheers'::regclass AND polname='own_rows'").fetchone()
   c.execute(migration)
   self.assertEqual(c.execute('SELECT * FROM pg_temp.cheers ORDER BY user_id').fetchall(),[{**row,'kind':reactions.LEGACY[row['kind']]} for row in old_rows])
   self.assertEqual(c.execute('SELECT * FROM pg_temp.notifications ORDER BY id').fetchall(),[{**row,'reaction_kind':reactions.LEGACY.get(row['reaction_kind'],row['reaction_kind'])} for row in old_notes])
   self.assertEqual(c.execute("SELECT relrowsecurity,pg_get_expr(polqual,polrelid) AS rule FROM pg_class JOIN pg_policy ON polrelid=pg_class.oid WHERE pg_class.oid='pg_temp.cheers'::regclass AND polname='own_rows'").fetchone(),policy)
   self.assertEqual(c.execute("INSERT INTO pg_temp.cheers(activity_id,user_id,created) VALUES(2,1,now()) RETURNING kind").fetchone()['kind'],'clap')
   with self.assertRaises(errors.UniqueViolation):
    with c.transaction():c.execute("INSERT INTO pg_temp.cheers(activity_id,user_id,kind,created) VALUES(1,1,'heart',now())")

 def test_laugh_migration_preserves_reaction_and_notice_state(self):
  migration=next(stmt for stmt in db.MIGRATIONS if "UPDATE cheers SET kind='clap' WHERE kind='laugh'" in stmt)
  with db.connect() as c:
   c.execute("""CREATE TEMP TABLE cheers(activity_id bigint,user_id bigint,kind text NOT NULL,created timestamptz NOT NULL,
       PRIMARY KEY(activity_id,user_id)) ON COMMIT DROP;
     ALTER TABLE cheers ENABLE ROW LEVEL SECURITY;
     CREATE POLICY own_rows ON cheers USING(user_id=1);
     CREATE TEMP TABLE notifications(id bigint PRIMARY KEY,reaction_kind text,created timestamptz NOT NULL,
       read_at timestamptz,cancelled boolean NOT NULL) ON COMMIT DROP;""")
   c.execute("""INSERT INTO cheers VALUES
       (1,1,'laugh','2026-02-01T01:00Z'),(2,2,'bolt','2026-02-02T01:00Z');
     INSERT INTO notifications VALUES
       (11,'laugh','2026-02-01T01:00Z',NULL,true),
       (12,'fire','2026-02-02T01:00Z','2026-02-02T02:00Z',false),
       (13,NULL,'2026-02-03T01:00Z',NULL,false);""")
   policy=c.execute("SELECT relrowsecurity,pg_get_expr(polqual,polrelid) AS rule FROM pg_class JOIN pg_policy ON polrelid=pg_class.oid WHERE pg_class.oid='pg_temp.cheers'::regclass AND polname='own_rows'").fetchone()
   c.execute(migration)
   self.assertEqual(c.execute('SELECT activity_id,user_id,kind,created FROM pg_temp.cheers ORDER BY activity_id').fetchall(),
       [{'activity_id':1,'user_id':1,'kind':'clap','created':c.execute("SELECT '2026-02-01T01:00Z'::timestamptz AS created").fetchone()['created']},
        {'activity_id':2,'user_id':2,'kind':'bolt','created':c.execute("SELECT '2026-02-02T01:00Z'::timestamptz AS created").fetchone()['created']}])
   notices=c.execute('SELECT id,reaction_kind,created,read_at,cancelled FROM pg_temp.notifications ORDER BY id').fetchall()
   self.assertEqual([(n['id'],n['reaction_kind'],n['cancelled']) for n in notices],[(11,'clap',True),(12,'fire',False),(13,None,False)])
   self.assertEqual(notices[0]['read_at'],None);self.assertIsNotNone(notices[1]['read_at'])
   self.assertEqual(c.execute("SELECT relrowsecurity,pg_get_expr(polqual,polrelid) AS rule FROM pg_class JOIN pg_policy ON polrelid=pg_class.oid WHERE pg_class.oid='pg_temp.cheers'::regclass AND polname='own_rows'").fetchone(),policy)


unittest.main()
