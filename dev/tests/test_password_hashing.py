"""Bound expensive password work, retaining Argon2 costs and transactional retry safety."""
import asyncio
import json
import contextvars
import httpx
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
from app import auth, db, account_email, admin_auth, admin_passwords, password_work
from app.main import app

PW = 'fictional maple kettle password'
NEW = 'a different fictional kettle sentence'


@contextmanager
def full_queue():
    with password_work.admission.lock:
        old = (password_work.admission.active, password_work.admission.waiting, password_work.admission.public_waiting)
        password_work.admission.active = 2
        password_work.admission.waiting = 8
        password_work.admission.public_waiting = 7
    for _ in range(2): auth._PASSWORD_ACTIVE.acquire()
    try: yield
    finally:
        for _ in range(2): auth._PASSWORD_ACTIVE.release()
        with password_work.admission.lock:
            password_work.admission.active, password_work.admission.waiting, password_work.admission.public_waiting = old


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

    def test_direct_helper_fails_immediately_instead_of_waiting_with_a_database_lease(self):
        for _ in range(2): auth._PASSWORD_ACTIVE.acquire()
        try:
            with patch.object(PasswordHasher, 'hash') as work:
                start = time.monotonic()
                with self.assertRaises(HTTPException) as caught: auth.hash_pw(PW)
                self.assertEqual(caught.exception.status_code, 503)
                self.assertEqual(caught.exception.headers['Retry-After'], '2')
                self.assertLess(time.monotonic() - start, 1)
                work.assert_not_called()
        finally:
            for _ in range(2): auth._PASSWORD_ACTIVE.release()
        with full_queue(): pass  # A rejected direct call did not leak a hash place.
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

    def test_busy_unknown_and_known_traffic_spends_only_source_budget_before_hashing(self):
        with db.connect() as c: c.execute('DELETE FROM auth_attempts')
        with full_queue(), patch.object(password_work, 'SOURCE_LIMIT', 3), patch.object(PasswordHasher, 'verify') as verify:
            for login in ['zz_test_hashguard_member', 'zz_test_hashguard_missing', 'zz_test_hashguard_member']:
                self.retry(self.anon.post('/api/login', json={'login':login,'password':PW}))
            self.assertEqual(self.anon.post('/api/login',json={'login':'another_unknown','password':PW}).status_code,429)
            verify.assert_not_called()
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'password-work:public:%%'").fetchone()['n'],3)
            self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'fail:%%'").fetchone()['n'],0)
        # The congestion budget is tied to the source, never to an account name.
        self.assertFalse(auth.too_many('a different fictional source','zz_test_hashguard_member'))
        with db.connect() as c: c.execute('DELETE FROM auth_attempts')
        with full_queue(), patch.object(password_work,'SOURCE_LIMIT',3), patch.object(PasswordHasher,'verify') as verify:
            def burst(_):
                return self.make_client().post('/api/login',json={'login':'unknown_fictional','password':PW}).status_code
            with ThreadPoolExecutor(max_workers=8) as pool: results=list(pool.map(burst,range(8)))
            self.assertEqual(results.count(503),3)
            self.assertEqual(results.count(429),5,'source reservations are atomic across simultaneous requests')
            verify.assert_not_called()

    def test_real_queued_routes_release_database_and_keep_loop_and_recovery_responsive(self):
        async def scenario():
            started = threading.Event(); release = threading.Event(); first = True
            original_verify = PasswordHasher.verify; original_connect = db.connect
            owner = contextvars.ContextVar('test_password_request', default='other')
            opened = {}; lock = threading.Lock()
            @contextmanager
            def connect():
                name = owner.get()
                with original_connect() as c:
                    with lock: opened[name] = opened.get(name,0)+1
                    try: yield c
                    finally:
                        with lock: opened[name] -= 1
            def verify(hasher, *args, **kwargs):
                nonlocal first
                if first:
                    first = False; started.set()
                    if not release.wait(4): raise AssertionError('blocked test hash not released')
                return original_verify(hasher,*args,**kwargs)
            async def until(predicate):
                for _ in range(300):
                    if predicate(): return
                    await asyncio.sleep(.005)
                self.fail('request did not reach its expected queued state')
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
                async def login(name):
                    owner.set(name)
                    return await client.post('/api/login',json={'login':'zz_test_hashguard_admin','password':PW})
                jobs=[]
                with patch.object(PasswordHasher,'verify',verify), patch.object(db,'connect',connect):
                    try:
                        jobs.append(asyncio.create_task(login('active'))); await until(started.is_set)
                        jobs.extend(asyncio.create_task(login('queued'+str(i))) for i in range(7))
                        await until(lambda: password_work.admission.waiting==7)
                        with lock:
                            self.assertEqual(opened.get('active'),1)
                            self.assertTrue(all(opened.get('queued'+str(i),0)==0 for i in range(7)),opened)
                        # These requests share the actual ASGI loop and real connection pool.
                        measured = {}; at = time.monotonic()
                        health=await asyncio.wait_for(client.get('/api/health'),1)
                        measured['health_ms'] = round((time.monotonic()-at)*1000,1)
                        self.assertEqual(health.status_code,200)
                        client.cookies.set(auth.COOKIE,self.session)
                        at = time.monotonic()
                        me=await asyncio.wait_for(client.get('/api/me'),1)
                        measured['me_ms'] = round((time.monotonic()-at)*1000,1)
                        self.assertEqual(me.status_code,200)
                        at = time.monotonic()
                        reset=await asyncio.wait_for(client.post('/api/password/reset',json={'token':self.reset,'password':NEW}),2)
                        measured['reset_ms'] = round((time.monotonic()-at)*1000,1)
                        self.assertEqual(reset.status_code,200,reset.text)
                        self.assertFalse(release.is_set(),'recovery finished while login was still held')
                        print('Queued-route evidence:',json.dumps(dict(queued=7,queued_database_leases=0,**measured)),flush=True)
                    finally:
                        release.set()
                        results=await asyncio.gather(*jobs)
                self.assertTrue(all(r.status_code==200 for r in results),[r.text for r in results])
                self.assertEqual(password_work.admission.waiting,0)
        asyncio.run(scenario())

    def test_route_timeout_and_disconnect_do_not_hash_or_leak_queue_places(self):
        async def scenario():
            self.assertTrue(password_work.admission.enter('public'))
            source = '192.0.2.37'
            transport=httpx.ASGITransport(app=app,client=(source,1234))
            try:
                with patch.object(password_work,'WAIT_SECONDS',.05), patch.object(PasswordHasher,'verify') as verify:
                    async with httpx.AsyncClient(transport=transport,base_url='http://testserver') as client:
                        self.retry(await client.post('/api/login',json={'login':'zz_test_hashguard_missing','password':PW}))
                    verify.assert_not_called()
                self.assertEqual(password_work.admission.waiting,0)
                incoming=asyncio.Queue(); sent=[]
                await incoming.put({'type':'http.request','body':json.dumps({'login':'zz_test_hashguard_member','password':PW}).encode(),'more_body':False})
                scope={'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':'POST','scheme':'http',
                       'path':'/api/login','raw_path':b'/api/login','query_string':b'',
                       'headers':[(b'host',b'testserver'),(b'content-type',b'application/json')],
                       'client':(source,1234),'server':('testserver',80)}
                async def send(message): sent.append(message)
                with patch.object(PasswordHasher,'verify') as verify:
                    task=asyncio.create_task(app(scope,incoming.get,send))
                    for _ in range(300):
                        if password_work.admission.waiting: break
                        await asyncio.sleep(.005)
                    self.assertEqual(password_work.admission.waiting,1)
                    await incoming.put({'type':'http.disconnect'})
                    await asyncio.wait_for(task,1)
                    verify.assert_not_called()
                self.assertEqual(password_work.admission.waiting,0)
                self.assertFalse(any(m.get('status')==200 for m in sent))
                with db.connect() as c:
                    self.assertEqual(c.execute('SELECT count(*) AS n FROM auth_attempts WHERE key=%s',('password-work:public:'+source,)).fetchone()['n'],2)
            finally: password_work.admission.leave('public')
            self.assertEqual(password_work.admission.active,0)
        asyncio.run(scenario())

    def test_fragmented_body_and_immediate_admission_preserve_validation(self):
        async def scenario():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
                for raw,status in [(json.dumps({'login':'zz_test_hashguard_member','password':PW}).encode(),200),(b'{broken',422)]:
                    async def body():
                        for offset in range(0,len(raw),3):
                            await asyncio.sleep(0)
                            yield raw[offset:offset+3]
                    with patch.object(password_work,'source_attempt',return_value=True):
                        response=await asyncio.wait_for(client.post('/api/login',content=body(),headers={'Content-Type':'application/json'}),2)
                    self.assertEqual(response.status_code,status,response.text)
                self.assertEqual(password_work.admission.active,0)
        asyncio.run(scenario())

    def test_background_device_email_does_not_keep_the_login_place(self):
        from app import api_devices
        async def scenario():
            started=threading.Event();release=threading.Event();first=True
            def remember(c,background,*args,**kwargs):
                nonlocal first
                if first:
                    first=False
                    def delivery():
                        started.set()
                        self.assertTrue(release.wait(4))
                    background.add_task(delivery)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
                with patch.object(api_devices,'remember',remember):
                    pending=asyncio.create_task(client.post('/api/login',json={'login':'zz_test_hashguard_member','password':PW}))
                    try:
                        for _ in range(300):
                            if started.is_set(): break
                            await asyncio.sleep(.005)
                        self.assertTrue(started.is_set())
                        self.assertEqual(password_work.admission.active,0)
                        response=await asyncio.wait_for(client.post('/api/login',json={'login':'zz_test_hashguard_member','password':PW}),2)
                        self.assertEqual(response.status_code,200,response.text)
                    finally:
                        release.set();await pending
        asyncio.run(scenario())


if __name__=='__main__':unittest.main()
