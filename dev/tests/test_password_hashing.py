"""Bound expensive password work, retaining Argon2 costs and transactional retry safety."""
import asyncio
import json
import socket
import http.client
import uvicorn
import contextvars
import httpx
import datetime as dt
import os
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from contextlib import contextmanager, ExitStack
from unittest.mock import patch
from argon2 import PasswordHasher, extract_parameters
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request
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


@contextmanager
def real_http():
    # Real Uvicorn/TCP, ephemeral loopback only; the surrounding fixture owns the DB.
    listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(64)
    port=listener.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,log_config=None,access_log=False,log_level='critical',lifespan='off',proxy_headers=False))
    worker=threading.Thread(target=lambda:server.run(sockets=[listener]),daemon=True)
    worker.start()
    try:
        for _ in range(300):
            if server.started: break
            time.sleep(.01)
        if not server.started: raise AssertionError('fictional loopback server did not start')
        yield port
    finally:
        server.should_exit=True; worker.join(2)
        if worker.is_alive(): server.force_exit=True; worker.join(2)
        listener.close()
        if worker.is_alive(): raise AssertionError('fictional loopback server did not stop')


def wire_request(port,path,body=None,token=None,timeout=2):
    client=http.client.HTTPConnection('127.0.0.1',port,timeout=timeout)
    headers={'Origin':f'http://127.0.0.1:{port}','Content-Type':'application/json','Connection':'close'}
    if token: headers['Cookie']=auth.COOKIE+'='+token
    try:
        client.request('POST' if body is not None else 'GET',path,json.dumps(body) if body is not None else None,headers)
        response=client.getresponse(); raw=response.read()
        return response.status,json.loads(raw) if raw else None
    finally: client.close()


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
            self.assertTrue(all(s in (503,429) for s in results),results)
            with db.connect() as c:
                n=c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'password-work:public:%%'").fetchone()['n']
            self.assertLessEqual(n,3,'contended counters must not overrun their budget')
            for _ in range(3-n): self.retry(self.anon.post('/api/login',json={'login':'unknown_fictional','password':PW}))
            self.assertEqual(self.anon.post('/api/login',json={'login':'unknown_fictional','password':PW}).status_code,429)
            verify.assert_not_called()

    def test_successful_family_signins_do_not_exhaust_shared_source_budget(self):
        # More successful sign-ins than the production limit, alternating household members.
        with patch.object(PasswordHasher, 'verify', return_value=True) as verify:
            for i in range(password_work.SOURCE_LIMIT + 5):
                login = 'zz_test_hashguard_' + ('member' if i % 2 else 'admin')
                response = self.anon.post('/api/login', json={'login':login,'password':PW})
                self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(verify.call_count,65)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'password-work:%%'").fetchone()['n'],0)

    def test_success_refunds_only_itself_and_preserves_failed_and_busy_attempts(self):
        body = {'login':'zz_test_hashguard_member','password':PW}
        with patch.object(password_work, 'SOURCE_LIMIT', 3):
            self.assertEqual(self.anon.post('/api/login',json={**body,'password':'wrong'}).status_code,401)
            with full_queue(): self.retry(self.anon.post('/api/login',json=body))
            with db.connect() as c:
                retained = c.execute('SELECT key FROM auth_attempts ORDER BY key').fetchall()
            # Each success leaves room for the next, but refunds neither the wrong password nor 503.
            for _ in range(4):
                self.assertEqual(self.anon.post('/api/login',json=body).status_code,200)
            with db.connect() as c:
                self.assertEqual(c.execute('SELECT key FROM auth_attempts ORDER BY key').fetchall(),retained)
            self.assertEqual(self.anon.post('/api/login',content='{broken',headers={'Content-Type':'application/json'}).status_code,422)
            self.assertEqual(self.anon.post('/api/login',json=body).status_code,429)
            # A different household/source and the recovery category have independent budgets.
            self.assertIsNotNone(password_work.source_attempt(Request({'type':'http','headers':[], 'client':('192.0.2.99',1)}),'public'))
            self.assertEqual(self.anon.post('/api/password/reset',json={'token':self.reset,'password':NEW}).status_code,200)
        self.assertFalse(auth.too_many('testclient','zz_test_hashguard_member'))

    def test_success_budget_cleanup_failure_does_not_fail_committed_login(self):
        helper = password_work.source_success
        def failing_cleanup(reservation):
            with patch.object(password_work,'source_connection',side_effect=RuntimeError('fictional sensitive diagnostic')):
                with self.assertLogs('app.password_work',level='WARNING') as logs: helper(reservation)
            self.assertNotIn('sensitive',str(logs.output))
        with patch.object(password_work,'source_success',side_effect=failing_cleanup):
            response = self.anon.post('/api/login',json={'login':'zz_test_hashguard_member','password':PW})
        self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(self.anon.get('/api/me').status_code,200)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'password-work:%%'").fetchone()['n'],1)
            c.execute("UPDATE auth_attempts SET created=now()-interval '61 seconds' WHERE key LIKE 'password-work:%%'")
        with patch.object(password_work,'SOURCE_LIMIT',1):
            self.assertEqual(self.anon.post('/api/login',json={'login':'zz_test_hashguard_member','password':PW}).status_code,200)

    def test_atomic_counter_across_independent_workers_never_overruns_source(self):
        request=Request({'type':'http','headers':[],'client':('192.0.2.164',1)})
        begin=threading.Barrier(8)
        def attempt(_):
            begin.wait()
            try: return password_work.source_attempt(request,'public')
            except password_work.SourceBusy: return None
        with patch.object(password_work,'SOURCE_LIMIT',3), ThreadPoolExecutor(max_workers=8) as workers:
            results=list(workers.map(attempt,range(8)))
            self.assertLessEqual(sum(result is not None for result in results),3)
            for _ in range(3): password_work.source_attempt(request,'public')
            self.assertIsNone(password_work.source_attempt(request,'public'))
        prefix=password_work.source_prefix(request,'public')
        with db.connect() as c:
            keys=c.execute('SELECT key FROM auth_attempts WHERE key LIKE %s',(prefix+'%',)).fetchall()
        self.assertEqual(len(keys),3)
        self.assertEqual(len({row['key'] for row in keys}),3)

    def test_real_slow_unfinished_bodies_never_take_password_places_and_expire(self):
        sockets=[]; drippers=[]; stop=threading.Event(); leases=0; lease_lock=threading.Lock()
        original=db.pool().connection
        @contextmanager
        def connection(*args,**kwargs):
            nonlocal leases
            with original(*args,**kwargs) as c:
                with lease_lock: leases+=1
                try: yield c
                finally:
                    with lease_lock: leases-=1
        def drip(sock):
            while not stop.wait(.1):
                try: sock.sendall(b' ')
                except OSError: return
        with real_http() as port, patch.object(db.pool(),'connection',connection), patch.object(PasswordHasher,'verify',autospec=True,side_effect=PasswordHasher.verify) as verify:
            started=time.monotonic()
            try:
                for path in ['/api/login','/api/password/reset']:
                    sock=socket.create_connection(('127.0.0.1',port),timeout=8); sockets.append(sock)
                    sock.sendall(f'POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{{'.encode())
                    thread=threading.Thread(target=drip,args=(sock,),daemon=True);thread.start();drippers.append(thread)
                for _ in range(300):
                    if password_work.body_readers.active==2: break
                    time.sleep(.005)
                self.assertEqual(password_work.body_readers.active,2)
                self.assertEqual(password_work.admission.active,0)
                self.assertEqual(password_work.counter_workers.active,0)
                with lease_lock: self.assertEqual(leases,0,'slow body readers retain no DB lease')
                at=time.monotonic();self.assertEqual(wire_request(port,'/api/health')[0],200);health_ms=round((time.monotonic()-at)*1000,1)
                at=time.monotonic();self.assertEqual(wire_request(port,'/api/me',token=self.session)[0],200);me_ms=round((time.monotonic()-at)*1000,1)
                # Both public/recovery bodies are unfinished, yet a complete login can hash now.
                self.assertEqual(wire_request(port,'/api/login',{'login':'zz_test_hashguard_member','password':PW})[0],200)
                statuses=[]
                for sock in sockets:
                    response=http.client.HTTPResponse(sock);response.begin();statuses.append(response.status);response.read();response.close()
                self.assertEqual(statuses,[408,408])
                self.assertLess(time.monotonic()-started,8)
                self.assertEqual(verify.call_count,1,'only the complete login reached verification')
                print('Slow TCP evidence:',json.dumps(dict(health_ms=health_ms,me_ms=me_ms,body_statuses=statuses,password_places_while_reading=0,db_leases_while_reading=0)),flush=True)
            finally:
                stop.set()
                for sock in sockets: sock.close()
                for thread in drippers: thread.join(1)
        self.assertEqual(password_work.body_readers.active,0)
        self.assertEqual(password_work.admission.active,0)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'password-work:%%'").fetchone()['n'],2)

    def test_real_oversized_and_disconnected_bodies_never_take_password_places(self):
        with real_http() as port, patch.object(PasswordHasher,'verify') as verify:
            client=http.client.HTTPConnection('127.0.0.1',port,timeout=2)
            try:
                client.request('POST','/api/login',b'x'*(password_work.BODY_LIMIT+1),{'Content-Type':'application/json'})
                response=client.getresponse();self.assertEqual(response.status,413);response.read()
            finally: client.close()
            sock=socket.create_connection(('127.0.0.1',port),timeout=2)
            sock.sendall(f'POST /api/login HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n{{'.encode())
            try:
                for _ in range(200):
                    if password_work.body_readers.active: break
                    time.sleep(.005)
                self.assertEqual(password_work.body_readers.active,1)
                self.assertEqual(password_work.admission.active,0)
            finally: sock.close()
            for _ in range(200):
                if not password_work.body_readers.active: break
                time.sleep(.005)
            verify.assert_not_called()
            self.assertEqual(password_work.admission.active,0)
            self.assertEqual(password_work.body_readers.active,0)

    def test_real_same_source_lock_flood_keeps_database_and_endpoints_responsive(self):
        request=Request({'type':'http','headers':[],'client':('127.0.0.1',1)})
        prefix=password_work.source_prefix(request,'public')
        leases=peak=counter_leases=counter_peak=0; lock=threading.Lock(); original=db.pool().connection
        @contextmanager
        def connection(*args,**kwargs):
            nonlocal leases,peak,counter_leases,counter_peak
            counter=threading.current_thread().name.startswith('password-source')
            with original(*args,**kwargs) as c:
                with lock:
                    leases+=1;peak=max(peak,leases)
                    counter_leases+=int(counter);counter_peak=max(counter_peak,counter_leases)
                try: yield c
                finally:
                    with lock: leases-=1;counter_leases-=int(counter)
        with real_http() as port, ThreadPoolExecutor(max_workers=24) as clients, db.connect() as holder:
            holder.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(prefix,))
            with patch.object(db.pool(),'connection',connection), patch.object(PasswordHasher,'verify') as verify:
                begin=threading.Barrier(25)
                def flood(_):
                    begin.wait();return wire_request(port,'/api/login',{'login':'zz_test_hashguard_missing','password':PW})[0]
                jobs=[clients.submit(flood,i) for i in range(24)];begin.wait()
                at=time.monotonic();self.assertEqual(wire_request(port,'/api/health',timeout=1)[0],200);health_ms=round((time.monotonic()-at)*1000,1)
                at=time.monotonic();self.assertEqual(wire_request(port,'/api/me',token=self.session,timeout=1)[0],200);me_ms=round((time.monotonic()-at)*1000,1)
                results=[job.result(timeout=2) for job in jobs]
                self.assertEqual(results,[503]*24)
                verify.assert_not_called()
                self.assertEqual(counter_peak,1,'the public counter flood uses only one DB connection')
                # Existing per-request audit logging also borrows briefly after responses.
                for _ in range(200):
                    if not leases: break
                    time.sleep(.005)
                self.assertEqual(leases,0)
                self.assertEqual(password_work.counter_workers.active,0)
                self.assertEqual(password_work.admission.active,0)
                print('Counter-lock TCP evidence:',json.dumps(dict(rejected=len(results),counter_peak_db_leases=counter_peak,total_peak_including_audit_and_me=peak,health_ms=health_ms,me_ms=me_ms)),flush=True)
        # The advisory lock and SET LOCAL bounds leave no permanent throttle or pool settings.
        self.assertEqual(self.anon.post('/api/login',json={'login':'zz_test_hashguard_member','password':PW}).status_code,200)

    def test_counter_pool_table_and_statement_waits_are_bounded(self):
        from psycopg.errors import QueryCanceled
        with real_http() as port, patch.object(PasswordHasher,'verify') as verify:
            with db.connect() as holder:
                holder.execute('LOCK TABLE auth_attempts IN ACCESS EXCLUSIVE MODE')
                at=time.monotonic();status,body=wire_request(port,'/api/login',{'login':'unknown','password':PW})
                self.assertEqual((status,body),(503,{'detail':password_work.BUSY}))
                self.assertLess(time.monotonic()-at,1)
                self.assertEqual(wire_request(port,'/api/me',token=self.session,timeout=1)[0],200)
            with ExitStack() as held:
                for _ in range(8): held.enter_context(db.connect())
                at=time.monotonic();status,_=wire_request(port,'/api/login',{'login':'unknown','password':PW})
                self.assertEqual(status,503);self.assertLess(time.monotonic()-at,1)
                # All eight leases are deliberately held by this fixture; health also needs the DB.
            verify.assert_not_called()
        at=time.monotonic()
        with self.assertRaises(QueryCanceled):
            with password_work.source_connection() as c: c.execute('SELECT pg_sleep(2)')
        self.assertLess(time.monotonic()-at,1)
        with db.connect() as c:
            self.assertEqual(c.execute('SHOW statement_timeout').fetchone()['statement_timeout'],'0')
            self.assertEqual(c.execute('SHOW lock_timeout').fetchone()['lock_timeout'],'0')
        self.assertEqual(password_work.counter_workers.active,0)

    def test_cancelled_counter_wait_keeps_worker_bound_until_actual_completion(self):
        async def scenario():
            started=threading.Event();release=threading.Event()
            def check(*args): started.set();release.wait(2);return None
            with patch.object(password_work,'source_attempt',side_effect=check) as work:
                job=asyncio.create_task(password_work.source_check(None,'public'))
                try:
                    for _ in range(300):
                        if started.is_set(): break
                        await asyncio.sleep(.005)
                    self.assertTrue(started.is_set())
                    queued=asyncio.create_task(password_work.source_check(None,'public'))
                    for _ in range(200):
                        if password_work.counter_workers.waiting: break
                        await asyncio.sleep(.005)
                    self.assertEqual(password_work.counter_workers.waiting,1)
                    queued.cancel()
                    with self.assertRaises(asyncio.CancelledError): await queued
                    self.assertEqual(password_work.counter_workers.waiting,0)
                    job.cancel()
                    with self.assertRaises(asyncio.CancelledError): await job
                    self.assertEqual(password_work.counter_workers.active,1)
                    with self.assertRaises(password_work.SourceBusy): await password_work.source_check(None,'public')
                    self.assertEqual(work.call_count,1)
                finally: release.set()
                for _ in range(300):
                    if not password_work.counter_workers.active: break
                    await asyncio.sleep(.005)
                self.assertEqual(password_work.counter_workers.active,0)
        asyncio.run(scenario())

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
                    prefix = password_work.source_prefix(Request(scope), 'public')
                    self.assertEqual(c.execute('SELECT count(*) AS n FROM auth_attempts WHERE key LIKE %s',(prefix+'%',)).fetchone()['n'],2)
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
