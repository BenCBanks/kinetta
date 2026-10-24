"""Typed reactions, compatibility, privacy, cancelled queues and native delivery stand-ins."""
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch,Mock
from fastapi.testclient import TestClient
from app import db,auth,notify
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
 def test_replace_retry_and_legacy(self):
  self.assertEqual(self.actor.post(self.path+'/cheer').status_code,200)
  for kind in ('cheer','strong','applause'):
   r=self.actor.post(self.path+'/reaction',json={'kind':kind});self.assertEqual(r.status_code,200,r.text);data=r.json();self.assertEqual(data['my_reaction'],kind);self.assertTrue(data['cheered']);self.assertEqual(len(data['cheers']),1);self.assertEqual(data['reactions'][kind],1);self.assertEqual(sum(data['reactions'].values()),1)
   self.actor.post(self.path+'/reaction',json={'kind':kind})
  self.assertEqual(len(self.notes()),1);self.assertEqual(self.notes()[0]['reaction_kind'],'applause')
  feed=self.actor.get('/api/feed/friends').json() # public shared endpoint below provides the same typed fields
  shared=self.actor.get('/api/shared/'+str(self.aid)).json();self.assertEqual(shared['my_reaction'],'applause');self.assertEqual(shared['reactions']['applause'],1)
  self.actor.post(self.path+'/cheer');self.assertEqual(self.actor.get(self.path+'/social').json()['my_reaction'],'cheer')
  self.assertEqual(self.actor.post(self.path+'/reaction',json={'kind':'unknown'}).status_code,422)
 def test_remove_cancels_and_reactivation_throttles(self):
  self.actor.post(self.path+'/reaction',json={'kind':'strong'});nid=self.notes()[0]['id']
  self.assertEqual(len(self.owner.get('/api/notifications').json()['items']),1)
  r=self.actor.delete(self.path+'/reaction');self.assertEqual(r.status_code,200);self.assertIsNone(r.json()['my_reaction']);self.assertEqual(sum(r.json()['reactions'].values()),0)
  self.assertTrue(self.notes()[0]['cancelled']);self.assertEqual(self.owner.get('/api/notifications').json()['items'],[])
  self.assertIsNone(notify.push(nid,send=lambda *_:self.fail('removed reaction delivered')))
  self.actor.post(self.path+'/reaction',json={'kind':'applause'});self.assertEqual(self.notes()[0]['id'],nid);self.assertFalse(self.notes()[0]['cancelled']);self.assertEqual(len(self.notes()),1)
 def test_self_no_alert_and_own_feed(self):
  self.owner.post(self.path+'/reaction',json={'kind':'strong'});self.assertEqual(self.notes(),[])
  row=next(r for r in self.owner.get('/api/activities').json() if r['id']==self.aid);self.assertEqual(row['my_reaction'],'strong');self.assertEqual(row['reactions']['strong'],1)
 def test_privacy_blocks_and_removal_after_access_loss(self):
  self.actor.post(self.path+'/reaction',json={'kind':'strong'})
  with db.connect() as c:c.execute("UPDATE activities SET visibility='me' WHERE id=%s",(self.aid,))
  self.assertEqual(self.other.post(self.path+'/reaction',json={'kind':'applause'}).status_code,404)
  self.assertEqual(self.actor.get(self.path+'/social').status_code,404)
  self.assertEqual(self.actor.delete(self.path+'/reaction').json(),{'ok':True})
  with db.connect() as c:
   c.execute("UPDATE activities SET visibility='everyone' WHERE id=%s",(self.aid,));c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[0],self.ids[1]));c.execute("INSERT INTO cheers(activity_id,user_id,kind) VALUES(%s,%s,'strong')",(self.aid,self.ids[1]))
  self.assertEqual(self.actor.post(self.path+'/reaction',json={'kind':'cheer'}).status_code,404)
  self.assertEqual(self.owner.get(self.path+'/social').json()['cheers'],[])
  own=next(r for r in self.owner.get('/api/activities').json() if r['id']==self.aid);self.assertEqual(own['cheers'],0);self.assertEqual(sum(own['reactions'].values()),0)
 def test_native_words_preferences_revocation_and_final_recheck(self):
  self.actor.post(self.path+'/reaction',json={'kind':'applause'});nid=self.notes()[0]['id'];sent=[]
  self.assertEqual(notify.push(nid,send=lambda d,p:sent.append(p) or True),1);self.assertIn('Applause',sent[-1]['body']);self.assertEqual(sent[-1]['url'],f'/activity/{self.aid}')
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
  self.assertIn('Applause',sent[-1]['body'])
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

unittest.main()
