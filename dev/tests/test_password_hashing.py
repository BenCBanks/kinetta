"""Bound expensive password work, retaining Argon2 costs and transactional retry safety."""
import datetime as dt
import os
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from contextlib import contextmanager
from unittest.mock import patch
from argon2 import PasswordHasher, extract_parameters
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import auth, db, account_email, admin_auth, admin_passwords
from app.main import app

PW = 'fictional maple kettle password'
NEW = 'a different fictional kettle sentence'


@contextmanager
def full_queue():
    acquired = 0
    try:
        for _ in range(10):
            if not auth._PASSWORD_JOBS.acquire(timeout=1): raise AssertionError('queue place leaked')
            acquired += 1
        yield
    finally:
        for _ in range(acquired): auth._PASSWORD_JOBS.release()


class PasswordWork(unittest.TestCase):
    def test_cost_and_correct_wrong_unknown_passwords_are_unchanged(self):
        stored = auth.hash_pw(PW)
        self.assertEqual(extract_parameters(stored), extract_parameters(PasswordHasher().hash(PW)))
        self.assertTrue(auth.check_pw(stored, PW))
        for stored, password in [(stored, 'wrong'), (None, PW), ('invalid', PW)]:
            self.assertFalse(auth.check_pw(stored, password))

    def test_parallel_work_is_bounded_and_overflow_gets_retry(self):
        release = threading.Event(); entered = threading.Event(); lock = threading.Lock()
        active = peak = 0
        def work(_):
            nonlocal active, peak
            with lock:
                active += 1; peak = max(peak, active)
                if active == 2: entered.set()
            try:
                self.assertTrue(release.wait(2))
                return 'hashed'
            finally:
                with lock: active -= 1
        def call(_):
            try: return auth.hash_pw(PW)
            except HTTPException as error: return error.status_code
        with patch.object(PasswordHasher, 'hash', side_effect=work), ThreadPoolExecutor(max_workers=32) as pool:
            jobs = [pool.submit(call, i) for i in range(32)]
            try:
                self.assertTrue(entered.wait(1))
                done, _ = wait(jobs, timeout=1, return_when=FIRST_COMPLETED)
                self.assertTrue(done)
                self.assertTrue(any(f.result() == 503 for f in done))
            finally: release.set()
            results = [f.result(timeout=2) for f in jobs]
        self.assertEqual(peak, 2)
        self.assertIn('hashed', results); self.assertIn(503, results)
        self.assertTrue(auth.check_pw(auth.hash_pw(PW), PW), 'all permits are returned')

    def test_queue_timeout_is_bounded_and_releases_its_reservation(self):
        for _ in range(2): auth._PASSWORD_ACTIVE.acquire()
        try:
            with patch.object(auth, '_PASSWORD_WAIT', .02), patch.object(PasswordHasher, 'hash') as work:
                start = time.monotonic()
                with self.assertRaises(HTTPException) as caught: auth.hash_pw(PW)
                self.assertEqual(caught.exception.status_code, 503)
                self.assertEqual(caught.exception.headers['Retry-After'], '2')
                self.assertLess(time.monotonic() - start, 1)
                work.assert_not_called()
        finally:
            for _ in range(2): auth._PASSWORD_ACTIVE.release()
        with full_queue(): pass  # A timed-out request did not leak a queue place.
        self.assertTrue(auth.check_pw(auth.hash_pw(PW), PW))

    def test_known_unknown_and_generation_share_the_same_full_queue(self):
        with full_queue(), patch.object(PasswordHasher, 'verify') as verify, patch.object(PasswordHasher, 'hash') as create:
            errors = []
            for call in [lambda: auth.hash_pw(PW), lambda: auth.check_pw(auth._DUMMY, PW), lambda: auth.check_pw(None, PW)]:
                with self.assertRaises(HTTPException) as caught: call()
                errors.append((caught.exception.status_code, caught.exception.detail))
            self.assertEqual(errors, [errors[0]] * 3)
            verify.assert_not_called(); create.assert_not_called()

    def test_work_exception_releases_active_and_queue_places(self):
        with patch.object(PasswordHasher, 'hash', side_effect=RuntimeError('fictional failure')):
            with self.assertRaises(RuntimeError): auth.hash_pw(PW)
        with full_queue(): pass
        self.assertTrue(auth.check_pw(auth.hash_pw(PW), PW))


class PasswordRoutes(unittest.TestCase):
    def setUp(self):
        self.ids = []; self.clients = []
        self.addCleanup(self.cleanup)
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {'KINETTA_SIGNUP':'open', 'KINETTA_MAX_ACCOUNTS':'250', 'KINETTA_PUBLIC_URL':'https://example.test'}).start()
        patch.object(account_email, 'mail_ready', return_value=True).start()
        patch.object(account_email, 'send', return_value=True).start()
        patch.object(account_email, 'send_confirmation', return_value=True).start()
        stored = auth.hash_pw(PW)
        with db.connect() as c:
            c.execute('DELETE FROM auth_attempts')
            for kind in ['member', 'admin', 'temporary']:
                login = 'zz_test_hashguard_' + kind
                uid = c.execute('''INSERT INTO users(login,name,pw_hash,is_admin,email,email_verified_at)
                  VALUES(%s,'Fictional Runner',%s,%s,%s,CASE WHEN %s THEN now() ELSE NULL END) RETURNING id''',
                  (login,stored,kind=='admin',login+'@example.test' if kind=='member' else None,kind=='member')).fetchone()['id']
                self.ids.append(uid); c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
            self.member,self.admin,self.temporary = self.ids
            self.session = auth.new_session(c,self.member,'fictional keeper')
            self.other_session = auth.new_session(c,self.member,'fictional other')
            self.portal = admin_auth.issue_session(c,self.admin)
            self.reset = account_email._token(c,self.member,'reset_password',60,'zz_test_hashguard_member@example.test')
            expires = dt.datetime.now(dt.timezone.utc)+dt.timedelta(hours=1)
            c.execute('UPDATE users SET password_change_expires=%s WHERE id=%s',(expires,self.temporary))
            self.change = admin_passwords.challenge(c,self.temporary,expires)['change_token']
        self.client = self.make_client();self.client.cookies.set(auth.COOKIE,self.session)
        self.anon = self.make_client();self.operator = self.make_client()
        self.operator.cookies.set(admin_auth.COOKIE,self.portal,path='/api')
        self.operator.headers['X-Admin-CSRF'] = admin_auth.csrf(self.portal)

    def make_client(self):
        client=TestClient(app);client.headers['Origin']='http://testserver';self.clients.append(client);return client

    def cleanup(self):
        for client in self.clients: client.close()
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_hashguard\\_%' OR login='hashguardnew'")
            c.execute('DELETE FROM auth_attempts')

    def retry(self,response):
        self.assertEqual(response.status_code,503,response.text)
        self.assertEqual(response.headers['Retry-After'],'2')
        self.assertEqual(response.json(),{'detail':'Kinetta is busy. Please try again in a few seconds.'})

    def snapshot(self):
        with db.connect() as c:
            return (c.execute('SELECT id,pw_hash,password_change_expires FROM users WHERE id=ANY(%s) ORDER BY id',(self.ids,)).fetchall(),
                    c.execute('SELECT token_hash FROM sessions WHERE user_id=ANY(%s) ORDER BY token_hash',(self.ids,)).fetchall())

    def test_all_password_entry_points_return_plain_retry_without_mutation(self):
        before=self.snapshot()
        signup={'login':'hashguardnew','first_name':'Fictional','last_name':'Runner','email':'hashguardnew@example.test','password':PW,'age_ok':True}
        action={'request_key':str(uuid.uuid4()),'requested_at':dt.datetime.now(dt.timezone.utc).isoformat(),'password':NEW,'confirm':'zz_test_hashguard_temporary'}
        cases=[(self.anon,'/api/login',{'login':'zz_test_hashguard_member','password':PW}),
          (self.anon,'/api/login',{'login':'zz_test_hashguard_missing','password':PW}),
          (self.anon,'/api/signup',signup),
          (self.client,'/api/account/password',{'current':PW,'new':NEW}),
          (self.anon,'/api/password/reset',{'token':self.reset,'password':NEW}),
          (self.anon,'/api/password/temporary',{'change_token':self.change,'password':NEW,'password_confirm':NEW}),
          (self.anon,'/api/admin/login',{'login':'zz_test_hashguard_admin','password':PW}),
          (self.operator,f'/api/admin/people/{self.temporary}/temporary-password',action)]
        with full_queue():
            for client,path,body in cases:
                with self.subTest(path=path):self.retry(client.post(path,json=body))
        self.assertEqual(self.snapshot(),before)
        with db.connect() as c:
            self.assertFalse(c.execute("SELECT 1 FROM users WHERE login='hashguardnew'").fetchone())
            self.assertFalse(c.execute("SELECT 1 FROM auth_attempts WHERE key LIKE 'fail:%'").fetchone())
            self.assertIsNone(c.execute('SELECT used_at FROM account_tokens WHERE token_hash=%s',(auth.token_hash(self.reset),)).fetchone()['used_at'])
        self.assertEqual(self.anon.post('/api/login',json={'login':'zz_test_hashguard_member','password':PW}).status_code,200)

    def test_reset_can_retry_without_consuming_token_or_revoking_sessions_early(self):
        body={'token':self.reset,'password':NEW}
        with full_queue():self.retry(self.anon.post('/api/password/reset',json=body))
        self.assertEqual(self.client.get('/api/me').status_code,200)
        self.assertEqual(self.anon.post('/api/password/reset',json=body).status_code,200)
        self.assertEqual(self.client.get('/api/me').status_code,401)
        self.assertEqual(self.anon.post('/api/password/reset',json=body).status_code,404)

    def test_password_change_rolls_back_if_new_hash_is_busy_after_verification(self):
        before=self.snapshot();body={'current':PW,'new':NEW}
        with patch.object(auth,'hash_pw',side_effect=HTTPException(503,'Kinetta is busy. Please try again in a few seconds.',headers={'Retry-After':'2'})):
            self.retry(self.client.post('/api/account/password',json=body))
        self.assertEqual(self.snapshot(),before)
        self.assertEqual(self.client.post('/api/account/password',json=body).status_code,200)
        other=self.make_client();other.cookies.set(auth.COOKIE,self.other_session)
        self.assertEqual(other.get('/api/me').status_code,401)
        self.assertEqual(self.client.get('/api/me').status_code,200)

    def test_temporary_password_change_retries_and_remains_single_use(self):
        body={'change_token':self.change,'password':NEW,'password_confirm':NEW}
        with full_queue():self.retry(self.anon.post('/api/password/temporary',json=body))
        response=self.anon.post('/api/password/temporary',json=body)
        self.assertEqual(response.status_code,200,response.text)
        self.assertNotIn('set-cookie',response.headers)
        self.assertEqual(self.anon.post('/api/password/temporary',json=body).status_code,401)


if __name__=='__main__':unittest.main()
