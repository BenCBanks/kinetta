"""Fictional DB + real HTTP fences. No providers, production or migrations."""
import threading
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from fastapi import FastAPI, Depends, Request
from fastapi.testclient import TestClient
from app import auth, db, privacy_save
from app.main import app as real_app


class PrivacySaves(unittest.TestCase):
    def setUp(self):
        self.clients = []
        self.uids = []
        for label in ('a', 'b'):
            with db.connect() as c:
                uid = c.execute("INSERT INTO users(login,name,pw_hash,email_verified_at) VALUES(%s,'Fictional Fixture','unused',now()) RETURNING id",
                                ('zz_test_privacy_fence_'+label,)).fetchone()['id']
                c.execute("INSERT INTO profile(user_id,share_default) VALUES(%s,'me')", (uid,))
                token = auth.new_session(c, uid, 'fictional offline test')
            self.uids.append(uid)
            client = TestClient(real_app)
            client.headers.update({'Authorization': 'Bearer '+token, 'X-Kinetta-Account': str(uid)})
            self.clients.append(client)
        self.a, self.b = self.clients

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=ANY(%s)', (self.uids,))

    def reserve(self, client=None, path='/api/sharing'):
        r = (client or self.a).post('/api/privacy-save', json={'path': path, 'method': 'PUT'})
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()['ticket']

    def status(self, ticket, client=None):
        return (client or self.a).get('/api/privacy-save', params={'ticket': ticket})

    def write(self, ticket, value, client=None):
        return (client or self.a).put('/api/sharing', json={'default': value}, headers={privacy_save.HEADER: ticket})

    def saved(self):
        return self.a.get('/api/sharing').json()['default']

    def test_delayed_older_public_after_new_private_and_get_only_retry(self):
        old = self.reserve()
        for _ in range(3):
            self.assertEqual(self.status(old).status_code, 409, 'unused request could still arrive')
        new = self.reserve()  # a new helper/navigation supersedes the never-arrived request
        self.assertEqual(self.write(new, 'me').status_code, 200)
        for _ in range(3):
            self.assertEqual(self.status(new).json(), {'settled': True})
        self.assertEqual(self.write(old, 'everyone').status_code, 409)
        self.assertEqual(self.saved(), 'me', 'older public cannot undo newer private')
        self.assertEqual(self.write(new, 'everyone').status_code, 409, 'a ticket applies at most once')

    def test_expired_never_arrived_write_is_settled_and_can_never_apply(self):
        ticket = self.reserve()
        with patch.object(privacy_save, 'time', SimpleNamespace(time=lambda: time.time()+60)):
            self.assertEqual(self.status(ticket).json(), {'settled': True})
            self.assertEqual(self.write(ticket, 'everyone').status_code, 409)
        self.assertEqual(self.saved(), 'me')

    def test_account_path_method_and_signature_cannot_be_reused(self):
        ticket = self.reserve()
        self.assertEqual(self.status(ticket, self.b).status_code, 409)
        self.assertEqual(self.write(ticket, 'everyone', self.b).status_code, 409)
        self.assertEqual(self.a.post('/api/sharing', json={}, headers={privacy_save.HEADER: ticket}).status_code, 409)
        self.assertEqual(self.a.put('/api/account', json={'name': 'Changed'}, headers={privacy_save.HEADER: ticket}).status_code, 409)
        self.assertEqual(self.write(ticket+'x', 'everyone').status_code, 409)
        # A cookie change in another tab must fence identity discovery/readback too.
        self.b.headers['X-Kinetta-Account'] = str(self.uids[0])
        self.assertEqual(self.b.get('/api/me').status_code, 409)
        self.assertEqual(self.saved(), 'me')

    def test_oversized_body_never_occupies_or_consumes_a_write_ticket(self):
        ticket = self.reserve()
        r = self.a.put('/api/sharing', content=b'x'*65537,
                       headers={privacy_save.HEADER: ticket, 'Content-Type': 'application/json'})
        self.assertEqual(r.status_code, 413)
        self.assertEqual(self.status(ticket).status_code, 409)
        self.assertEqual(self.write(ticket, 'me').status_code, 200)
        self.assertEqual(self.saved(), 'me')

    def test_real_outstanding_transaction_blocks_status_and_new_helper(self):
        isolated = FastAPI()
        isolated.include_router(privacy_save.router)
        started, release = threading.Event(), threading.Event()

        @isolated.middleware('http')
        async def guard(request: Request, call_next):
            return await privacy_save.guarded(request, call_next) if privacy_save.HEADER in request.headers else await call_next(request)

        @isolated.put('/api/fixture-sharing')
        def delayed(user=Depends(auth.current_user)):
            started.set()
            if not release.wait(10):
                raise RuntimeError('fixture release missing')
            with db.connect() as c:
                c.execute("UPDATE profile SET share_default='everyone' WHERE user_id=%s", (user['id'],))
            return {'ok': True}

        c = TestClient(isolated)
        c.headers.update(self.a.headers)
        ticket = self.reserve(c, '/api/fixture-sharing')
        responses = []
        thread = threading.Thread(target=lambda: responses.append(c.put('/api/fixture-sharing', json={}, headers={privacy_save.HEADER: ticket})))
        thread.start()
        try:
            self.assertTrue(started.wait(5))
            self.assertEqual(self.status(ticket).status_code, 409)
            # Even after ticket expiry, an accepted endpoint may still be running.
            with patch.object(privacy_save, 'time', SimpleNamespace(time=lambda: time.time()+60)):
                self.assertEqual(self.status(ticket).status_code, 409)
            self.assertEqual(self.a.post('/api/privacy-save', json={'path': '/api/sharing', 'method': 'PUT'}).status_code, 409)
            self.assertEqual(self.status(self.reserve(self.b), self.b).status_code, 409, 'other account remains independent')
        finally:
            release.set()
            thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertEqual(responses[0].status_code, 200)
        self.assertEqual(self.status(ticket).json(), {'settled': True})
        self.assertEqual(self.saved(), 'everyone', 'readback happens after the late commit')
        latest = self.reserve()
        self.assertEqual(self.write(latest, 'me').status_code, 200)
        self.assertEqual(self.write(ticket, 'everyone').status_code, 409)
        self.assertEqual(self.saved(), 'me')


unittest.main()
