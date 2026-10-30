"""Real SQL and authenticated registrations, with APNs replaced; never contacts a phone."""
import datetime as dt
import io
import logging
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth, db, notify
from app.main import app

TOKEN = 'ec' * 32
PRIVATE = 'PRIVATE notification text / token URL / zz_test_push_repair_owner'

class PushRepair(unittest.TestCase):
    def setUp(self):
        self.ids = []
        with db.connect() as c:
            for suffix in ('owner', 'actor', 'other'):
                uid = c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                                ('zz_test_push_repair_'+suffix, 'Fictional '+suffix)).fetchone()['id']
                self.ids.append(uid)
                c.execute('INSERT INTO profile(user_id) VALUES(%s)', (uid,))
            self.session = auth.new_session(c, self.ids[0], 'fictional push repair')
            self.other_session = auth.new_session(c, self.ids[2], 'fictional push repair')
            self.aid = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,visibility) VALUES(%s,'run',%s,now(),'manual','everyone') RETURNING id", (self.ids[0],PRIVATE)).fetchone()['id']
        self.client = TestClient(app)
        self.client.headers['Authorization'] = 'Bearer '+self.session
        self.addCleanup(self.client.close)
        self.addCleanup(self.clean)
        self.logs = io.StringIO()
        handler = logging.StreamHandler(self.logs)
        notify.log.addHandler(handler)
        previous = notify.log.level
        notify.log.setLevel(logging.INFO)
        self.addCleanup(lambda: notify.log.setLevel(previous))
        self.addCleanup(lambda: notify.log.removeHandler(handler))

    def clean(self):
        with db.connect() as c: c.execute('DELETE FROM users WHERE id=ANY(%s)', (self.ids,))

    def device(self, token=TOKEN, session=None):
        with db.connect() as c:
            c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s) ON CONFLICT(token,environment) DO UPDATE SET user_id=excluded.user_id,session_hash=excluded.session_hash", (token,self.ids[0],auth.token_hash(session or self.session)))

    def notice(self, kind='friend_accepted', age=0, read=False, cancelled=False):
        with db.connect() as c:
            comment = c.execute('INSERT INTO comments(activity_id,user_id,text) VALUES(%s,%s,%s) RETURNING id', (self.aid,self.ids[1],PRIVATE)).fetchone()['id'] if kind=='comment' else None
            return c.execute("INSERT INTO notifications(user_id,actor_id,kind,activity_id,comment_id,created,read_at,cancelled) VALUES(%s,%s,%s,%s,%s,now()-make_interval(secs=>%s),CASE WHEN %s THEN now() END,%s) RETURNING id", (self.ids[0],self.ids[1],kind,self.aid if kind in ('cheer','comment') else None,comment,age,read,cancelled)).fetchone()['id']

    def pending(self, nid):
        with db.connect() as c: return c.execute('SELECT push_pending FROM notifications WHERE id=%s', (nid,)).fetchone()['push_pending']

    def register(self, token='ed'*32, client=None):
        r = (client or self.client).post('/api/push/ios', json={'token':token,'environment':'sandbox'})
        self.assertEqual(r.status_code, 200, r.text)

    def test_all_log_reasons_are_minimal(self):
        nid=self.notice()
        self.assertEqual(notify.push(nid, send=lambda *_:True),0)
        self.device()
        with patch('app.apns.ready', return_value=False): self.assertEqual(notify.push(nid),0)
        with db.connect() as c: c.execute('UPDATE profile SET notify=\'{"friends":false}\' WHERE user_id=%s',(self.ids[0],))
        self.assertEqual(notify.push(nid,send=lambda *_:True),0)
        with db.connect() as c:
            c.execute("UPDATE profile SET notify='{}' WHERE user_id=%s",(self.ids[0],))
            c.execute("UPDATE sessions SET last_seen=now()-interval '1000 days' WHERE token_hash=%s",(auth.token_hash(self.session),))
        self.assertEqual(notify.push(nid,send=lambda *_:True),0)
        with db.connect() as c: c.execute('UPDATE sessions SET last_seen=now() WHERE token_hash=%s',(auth.token_hash(self.session),))
        self.assertIsNone(notify.push(self.notice(cancelled=True),send=lambda *_:True))
        def fail(*_): raise ValueError(PRIVATE+' '+TOKEN)
        self.assertEqual(notify.push(nid,send=fail),0)
        self.assertEqual(notify.push(nid,send=lambda *_:True),1)
        self.assertEqual(notify.push(nid,send=lambda *_:False),0)
        lines=self.logs.getvalue().splitlines()
        self.assertEqual(len(lines),8,lines)
        for reason in ('apns_not_configured','preference_off','no_device','no_current_session','not_visible','token_retired','send_error:ValueError'):
            self.assertTrue(any('reason='+reason+' devices=' in line for line in lines),reason)
        self.assertIn('push accepted: kind=friend_accepted devices=1 accepted=1',lines)
        for secret in (TOKEN,PRIVATE,self.session,'Fictional','user_id','zz_test'):
            self.assertNotIn(secret,self.logs.getvalue())

    def test_each_social_kind_catches_up_once(self):
        for kind in notify.CATCH_UP_KINDS:
            with self.subTest(kind=kind):
                self.device();nid=self.notice(kind)
                self.assertEqual(notify.push(nid,send=lambda *_:False),0)
                self.assertTrue(self.pending(nid))
                sent=[]
                with patch('app.apns.ready',return_value=True),patch('app.apns.deliver',side_effect=lambda d,p:sent.append(p) or True):
                    self.register();self.register();self.register('ee'*32)
                self.assertEqual(len(sent),1)
                self.assertEqual(sent[0]['tag'],f'{kind}-{nid}')
                self.assertFalse(self.pending(nid))
                with db.connect() as c: c.execute('DELETE FROM native_push_devices WHERE user_id=%s',(self.ids[0],))

    def test_old_read_cancelled_and_changed_preference_do_not_catch_up(self):
        for change in ('old','read','cancelled','preference','block'):
            with self.subTest(change=change):
                self.device();nid=self.notice();notify.push(nid,send=lambda *_:False)
                with db.connect() as c:
                    if change=='old': c.execute("UPDATE notifications SET created=now()-interval '11 minutes' WHERE id=%s",(nid,))
                    if change=='read': c.execute('UPDATE notifications SET read_at=now() WHERE id=%s',(nid,))
                    if change=='cancelled': c.execute('UPDATE notifications SET cancelled=true WHERE id=%s',(nid,))
                    if change=='preference': c.execute('UPDATE profile SET notify=\'{"friends":false}\' WHERE user_id=%s',(self.ids[0],))
                if change=='block':
                    self.assertEqual(self.client.post('/api/people/zz_test_push_repair_actor/block',json={}).status_code,200)
                sent=[]
                with patch('app.apns.ready',return_value=True),patch('app.apns.deliver',side_effect=lambda *_:sent.append(True) or True):self.register()
                self.assertEqual(sent,[])
                with db.connect() as c:
                    self.assertFalse(c.execute('SELECT 1 FROM notifications WHERE id=%s AND push_pending',(nid,)).fetchone())
                    c.execute("UPDATE profile SET notify='{}' WHERE user_id=%s",(self.ids[0],))
                    c.execute('DELETE FROM blocks WHERE user_id=ANY(%s) OR blocked=ANY(%s)',(self.ids,self.ids))
                    c.execute('DELETE FROM native_push_devices WHERE user_id=%s',(self.ids[0],))

    def test_mixed_results_and_other_kinds_are_not_pending(self):
        for other in ('accepted','error','stale'):
            self.device();self.device('ef'*32, self.other_session if other=='stale' else None)
            nid=self.notice()
            def send(d,p):
                if d['token']==TOKEN:return False
                if other=='error':raise RuntimeError(PRIVATE)
                return True
            notify.push(nid,send=send)
            self.assertFalse(self.pending(nid),other)
            with db.connect() as c:c.execute('DELETE FROM native_push_devices WHERE user_id=%s',(self.ids[0],))
        self.device();nid=self.notice('activity_ready');notify.push(nid,send=lambda *_:False)
        self.assertFalse(self.pending(nid))

    def test_concurrent_registration_claims_once_and_never_for_other_account(self):
        self.device();nid=self.notice();notify.push(nid,send=lambda *_:False)
        other=TestClient(app);other.headers['Authorization']='Bearer '+self.other_session
        self.addCleanup(other.close);sent=[]
        with patch('app.apns.ready',return_value=True),patch('app.apns.deliver',side_effect=lambda d,p:sent.append(p) or True):
            self.register(client=other)
            self.assertTrue(self.pending(nid));self.assertEqual(sent,[])
            with ThreadPoolExecutor(2) as pool:list(pool.map(lambda _:self.register(),range(2)))
        self.assertEqual(len(sent),1);self.assertFalse(self.pending(nid))

    def test_registration_racing_retirement_sees_pending_mark(self):
        self.device();nid=self.notice();entered=threading.Event();release=threading.Event();sent=[]
        def retire(*_):entered.set();self.assertTrue(release.wait(10));return False
        with patch('app.apns.ready',return_value=True),patch('app.apns.deliver',side_effect=lambda d,p:sent.append(p) or True):
            with ThreadPoolExecutor(2) as pool:
                delivery=pool.submit(notify.push,nid,retire);self.assertTrue(entered.wait(10))
                registration=pool.submit(self.register)
                release.set();self.assertEqual(delivery.result(10),0);registration.result(10)
        self.assertEqual(len(sent),1);self.assertFalse(self.pending(nid))

    def test_later_accepted_attempt_clears_a_prior_retirement_mark(self):
        self.device();nid=self.notice();notify.push(nid,send=lambda *_:False)
        self.device();self.assertEqual(notify.push(nid,send=lambda *_:True),1)
        self.assertFalse(self.pending(nid))
        notify._catch_up(self.ids[0],send=lambda *_:self.fail('Accepted notice retried'))

    def test_final_per_device_recheck(self):
        self.device();nid=self.notice();original=notify._deliver_native
        def read_before_send(uid,payload,prepare,send):
            with db.connect() as c:c.execute('UPDATE notifications SET read_at=now() WHERE id=%s',(nid,))
            return original(uid,payload,prepare,send)
        notify.push(nid,send=lambda *_:False)
        with patch('app.notify._deliver_native',side_effect=read_before_send):
            notify._catch_up(self.ids[0],send=lambda *_:self.fail('Read notice sent'))
        self.assertFalse(self.pending(nid))

unittest.main()
