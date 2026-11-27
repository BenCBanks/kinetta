"""Fictional PostgreSQL17+HTTP: all clients get bounded writes; GETs never gated."""
import threading
import time
import unittest
from unittest.mock import patch
from fastapi import FastAPI, Depends, Request
from fastapi.testclient import TestClient
from app import auth, db, privacy_save
from app.main import app as real_app


class PrivacySaves(unittest.TestCase):
    def setUp(self):
        with db.connect() as c:
            self.uid = c.execute("INSERT INTO users(login,name,pw_hash,email_verified_at) VALUES('zz_test_privacy_bounds','Fictional Fixture','unused',now()) RETURNING id").fetchone()['id']
            c.execute("INSERT INTO profile(user_id,share_default) VALUES(%s,'me')", (self.uid,))
            token = auth.new_session(c, self.uid, 'fictional bounds test')
        self.client = TestClient(real_app, raise_server_exceptions=False)
        self.client.headers.update({'Authorization': 'Bearer '+token, 'X-Kinetta-Account': str(self.uid)})

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=%s', (self.uid,))

    def saved(self):
        r = self.client.get('/api/sharing')
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['default']

    def fixture(self, action):
        app = FastAPI()
        @app.middleware('http')
        async def guard(request: Request, call_next):
            return await privacy_save.guarded(request, call_next) if privacy_save.applies(request) else await call_next(request)
        @app.put('/api/sharing')
        def setting(user=Depends(auth.current_user)):
            action(user['id'])
            return {'ok': True}
        return TestClient(app, headers=self.client.headers, raise_server_exceptions=False)

    def test_plain_old_client_and_removed_protocol(self):
        self.assertEqual(self.client.put('/api/sharing', json={'default':'everyone'}).status_code, 200)
        self.assertEqual(self.saved(), 'everyone')
        self.assertIn(self.client.post('/api/privacy-save', json={'path':'/api/sharing','method':'PUT'}).status_code, (404,405))
        self.assertFalse(any(getattr(route,'path','')=='/api/privacy-save' for route in real_app.routes))

    def test_body_limit_and_every_setting_surface_without_ticket(self):
        self.assertEqual(self.client.put('/api/sharing', content=b'x'*65537, headers={'Content-Type':'application/json'}).status_code, 413)
        paths=['/api/sharing','/api/profile','/api/account','/api/contacts/settings','/api/card','/api/card/new',
               '/api/activities/12/sharing','/api/groups/abc/sharing','/api/groups/abc/recap-consent',
               '/api/groups/abc/challenges/def/sharing','/api/achievements/showcase/pins','/api/segment-settings',
               '/api/coach/conversation/memory','/api/coach/conversation/memory/1','/api/activities/12/segment-assistance','/api/dishes/1/share/alex','/api/group-friend-invites/abc/accept',
               '/api/friend-links/code','/api/challenges/code/join']
        from types import SimpleNamespace
        for path in paths:
            self.assertTrue(privacy_save.applies(SimpleNamespace(method='PUT',url=SimpleNamespace(path=path))), path)
            self.assertFalse(privacy_save.applies(SimpleNamespace(method='GET',url=SimpleNamespace(path=path))), path)
        self.assertEqual(self.saved(), 'me')

    def test_statement_timeout_rolls_back_public_and_does_not_gate_get(self):
        entered = threading.Event()
        def write(uid):
            with db.connect() as c:
                c.execute("UPDATE profile SET share_default='everyone' WHERE user_id=%s", (uid,))
                entered.set()
                c.execute('SELECT pg_sleep(4)')
        client=self.fixture(write);responses=[]
        thread=threading.Thread(target=lambda: responses.append(client.put('/api/sharing',json={})))
        started=time.monotonic();thread.start()
        self.assertTrue(entered.wait(3))
        self.assertEqual(self.saved(),'me','GET sees committed value without waiting on another request')
        thread.join(5);self.assertFalse(thread.is_alive())
        self.assertLess(time.monotonic()-started,4)
        self.assertGreaterEqual(responses[0].status_code,400)
        self.assertEqual(self.saved(),'me')
        self.assertEqual(self.client.put('/api/sharing',json={'default':'friends'}).status_code,200)
        self.assertEqual(self.saved(),'friends','pool connection settings do not leak')

    def test_lock_timeout_for_unheadered_client(self):
        with db.connect() as c:
            c.execute('SELECT * FROM profile WHERE user_id=%s FOR UPDATE',(self.uid,))
            started=time.monotonic()
            r=self.client.put('/api/sharing',json={'default':'everyone'})
            self.assertGreaterEqual(r.status_code,400)
            self.assertLess(time.monotonic()-started,3)
        self.assertEqual(self.saved(),'me')

    def test_request_deadline_blocks_late_worker_and_older_public_commit(self):
        entered, release, finished = threading.Event(),threading.Event(),threading.Event()
        def write(uid):
            try:
                entered.set();release.wait(5)
                with db.connect() as c:
                    c.execute("UPDATE profile SET share_default='everyone' WHERE user_id=%s",(uid,))
            finally: finished.set()
        client=self.fixture(write);responses=[]
        with patch.object(privacy_save,'REQUEST_SECONDS',0.3):
            thread=threading.Thread(target=lambda: responses.append(client.put('/api/sharing',json={})))
            thread.start();self.assertTrue(entered.wait(3));time.sleep(0.5)
            # A new request can save private; an older expired worker must not undo it.
            self.assertEqual(self.client.put('/api/sharing',json={'default':'me'}).status_code,200)
            self.assertEqual(self.saved(),'me')
            release.set();thread.join(5);self.assertTrue(finished.wait(2))
        self.assertFalse(thread.is_alive());self.assertEqual(responses[0].status_code,504)
        self.assertEqual(self.saved(),'me')

    def test_transaction_deadline_rolls_back_even_when_worker_sleeps_between_statements(self):
        def write(uid):
            with db.connect() as c:
                c.execute("UPDATE profile SET share_default='everyone' WHERE user_id=%s",(uid,))
                time.sleep(0.6)
        with patch.object(privacy_save,'REQUEST_SECONDS',0.3):
            r=self.fixture(write).put('/api/sharing',json={})
        self.assertEqual(r.status_code,504)
        self.assertEqual(self.saved(),'me')

unittest.main()
