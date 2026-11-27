"""Real fictional limiter contention and transaction safety; no external services."""
import concurrent.futures
import os
import threading
import time
import unittest
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request
from app import account_email as E, admin_auth as A, auth, db, password_work, rate_limits as R


def request():
    return Request({'type':'http','method':'GET','path':'/','headers':[], 'client':('fictional-limits',1)})


class Limits(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'KINETTA_ADMIN_KEY':'fictional-limiter-key'});self.env.start();self.addCleanup(self.env.stop)
        self.addCleanup(self.clean)
        # Other serial suites may leave expired counters behind. Isolate the
        # retention fixtures without resetting anyone's still-live allowance.
        with db.connect() as c:
            c.execute("DELETE FROM auth_attempts WHERE created<now()-interval '1 day'")
            c.execute("DELETE FROM admin_attempts WHERE created<now()-interval '15 minutes'")

    def clean(self):
        with db.connect() as c:
            c.execute("DELETE FROM auth_attempts WHERE key LIKE 'zz_limit:%' OR key LIKE 'fail:%%fictional-limits%%' OR key='username-ip:testclient'")
            c.execute("DELETE FROM admin_attempts WHERE key=%s OR key LIKE 'zz_limit:%%'",(A.attempt_key(request(),'fixture'),))

    def hold(self,key,legacy=False):
        c=db.pool().getconn()
        c.execute('SELECT pg_advisory_xact_lock('+('hashtext(%s)' if legacy else 'hashtextextended(%s,0)')+')',(key,))
        self.addCleanup(lambda:(c.rollback(),db.pool().putconn(c)))
        return c

    def test_rate_lock_is_immediate_retry_not_database_queue(self):
        self.hold('rate:zz_limit:held');started=time.monotonic()
        with self.assertRaises(HTTPException) as error:
            with db.connect() as c:E.limited(c,'zz_limit:held',3,15)
        self.assertEqual(error.exception.status_code,503)
        self.assertEqual(error.exception.headers['Retry-After'],'2')
        self.assertLess(time.monotonic()-started,.5)
        with db.connect() as c:self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key='zz_limit:held'").fetchone()['n'],0)

    def test_reservation_survives_helper_until_outer_commit(self):
        with db.connect() as c:
            E.reservation_lock(c);E.reservation_lock(c)
            def other():
                with db.connect() as other:
                    return other.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('kinetta-email-reservations',0)) AS ok").fetchone()['ok']
            with concurrent.futures.ThreadPoolExecutor(1) as pool:self.assertFalse(pool.submit(other).result(1))
        with db.connect() as c:self.assertTrue(c.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('kinetta-email-reservations',0)) AS ok").fetchone()['ok'])

    def test_busy_reservation_rolls_back_earlier_work(self):
        self.hold('kinetta-email-reservations')
        with self.assertRaises(HTTPException):
            with db.connect() as c:
                c.execute("INSERT INTO auth_attempts(key) VALUES('zz_limit:rollback')")
                E.reservation_lock(c)
        with db.connect() as c:self.assertIsNone(c.execute("SELECT 1 FROM auth_attempts WHERE key='zz_limit:rollback'").fetchone())

    def test_success_counts_every_try_and_ignores_expired_without_deleting(self):
        with db.connect() as c:
            c.execute("INSERT INTO auth_attempts(key,created) VALUES('zz_limit:counter',now()-interval '2 days')")
            self.assertEqual([E.limited(c,'zz_limit:counter',2,15) for _ in range(4)],[False,False,True,True])
            self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key='zz_limit:counter'").fetchone()['n'],5)

    def test_admin_window_and_legacy_lock_namespace(self):
        digest=A.attempt_key(request(),'fixture')
        with db.connect() as c:c.execute("INSERT INTO admin_attempts(key,created)VALUES(%s,now()-interval '16 minutes')",(digest,))
        A.attempt(request(),'fixture',2);A.attempt(request(),'fixture',2)
        with self.assertRaises(HTTPException) as limited:A.attempt(request(),'fixture',2)
        self.assertEqual(limited.exception.status_code,429)
        self.hold('admin-attempt:'+digest,legacy=True)
        with self.assertRaises(HTTPException) as busy:A.attempt(request(),'fixture',2)
        self.assertEqual(busy.exception.status_code,503)

    def test_existing_timeouts_restored_and_tighter_ones_preserved(self):
        with db.connect() as c:
            c.execute("SET LOCAL statement_timeout='2s'");c.execute("SET LOCAL lock_timeout='3s'")
            E.limited(c,'zz_limit:settings',1,1);E.reservation_lock(c)
            self.assertEqual(c.execute('SHOW statement_timeout').fetchone()['statement_timeout'],'2s')
            self.assertEqual(c.execute('SHOW lock_timeout').fetchone()['lock_timeout'],'3s')
            c.execute("SET LOCAL statement_timeout='10ms'")
            with self.assertRaises(HTTPException) as error:
                with R.bounded(c):c.execute('SELECT pg_sleep(.1)')
            self.assertEqual(error.exception.status_code,503)
            self.assertEqual(c.execute('SHOW statement_timeout').fetchone()['statement_timeout'],'10ms')

    def test_statement_and_row_lock_timeouts_restore_usable_transaction(self):
        with db.connect() as c:
            with self.assertRaises(HTTPException):
                with R.bounded(c):c.execute('SELECT pg_sleep(1)')
            self.assertEqual(c.execute('SELECT 1 AS n').fetchone()['n'],1)
        with db.connect() as c:c.execute("INSERT INTO auth_attempts(key)VALUES('zz_limit:row')")
        holder=db.pool().getconn();holder.execute("SELECT 1 FROM auth_attempts WHERE key='zz_limit:row' FOR UPDATE")
        try:
            with db.connect() as c:
                with self.assertRaises(HTTPException):
                    with R.bounded(c):c.execute("DELETE FROM auth_attempts WHERE key='zz_limit:row'")
                self.assertEqual(c.execute('SELECT 1 AS n').fetchone()['n'],1)
        finally:holder.rollback();db.pool().putconn(holder)

    def test_pool_borrow_is_bounded_and_failed_work_is_not_admitted(self):
        with patch.object(db,'pool') as pool:
            pool.return_value.connection.side_effect=R.PoolTimeout('fictional')
            with self.assertRaises(HTTPException) as error:A.attempt(request(),'fixture',2)
            self.assertEqual(error.exception.status_code,503)
            pool.return_value.connection.assert_called_once_with(timeout=.1)

    def test_expired_cleanup_is_batched_skips_locked_and_retains_live(self):
        with db.connect() as c:
            c.execute("INSERT INTO auth_attempts(key,created) SELECT 'zz_limit:expired',now()-interval '2 days' FROM generate_series(1,501)")
            c.execute("INSERT INTO auth_attempts(key)VALUES('zz_limit:live')")
        holder=db.pool().getconn();holder.execute("SELECT 1 FROM auth_attempts WHERE key='zz_limit:expired' LIMIT 1 FOR UPDATE")
        try:
            self.assertGreaterEqual(R.cleanup(),500)
            with db.connect() as c:
                self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key='zz_limit:expired'").fetchone()['n'],1)
                self.assertTrue(c.execute("SELECT 1 FROM auth_attempts WHERE key='zz_limit:live'").fetchone())
        finally:holder.rollback();db.pool().putconn(holder)
        R.cleanup()
        with db.connect() as c:self.assertIsNone(c.execute("SELECT 1 FROM auth_attempts WHERE key='zz_limit:expired'").fetchone())

    def test_connection_honors_tighter_operator_timeouts(self):
        from contextlib import contextmanager
        from types import SimpleNamespace
        with db.connect() as c:
            c.execute("SET LOCAL statement_timeout='10ms'")
            c.execute("SET LOCAL lock_timeout='5ms'")
            @contextmanager
            def connection(timeout):
                self.assertEqual(timeout,.1)
                yield c
            with patch.object(R.db,'pool',return_value=SimpleNamespace(connection=connection)):
                with R.connection() as bounded:
                    self.assertEqual(bounded.execute('SHOW statement_timeout').fetchone()['statement_timeout'],'10ms')
                    self.assertEqual(bounded.execute('SHOW lock_timeout').fetchone()['lock_timeout'],'5ms')

    def test_admin_cleanup_bounded_and_login_keeps_expired_rows_off_request_path(self):
        with db.connect() as c:
            c.execute("INSERT INTO admin_attempts(key,created) SELECT 'zz_limit:expired-admin',now()-interval '16 minutes' FROM generate_series(1,501)")
            c.execute("INSERT INTO auth_attempts(key,created) VALUES('zz_limit:expired-signin',now()-interval '2 days')")
        reservation=password_work.source_attempt(request(),'public')
        self.assertIsNotNone(reservation)
        password_work.source_success(reservation)
        auth.failed('fictional-limits','fixture')
        with db.connect() as c:
            self.assertTrue(c.execute("SELECT 1 FROM auth_attempts WHERE key='zz_limit:expired-signin'").fetchone())
        R.cleanup()
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM admin_attempts WHERE key='zz_limit:expired-admin'").fetchone()['n'],1)
            self.assertIsNone(c.execute("SELECT 1 FROM auth_attempts WHERE key='zz_limit:expired-signin'").fetchone())

    def test_real_username_route_contention_keeps_other_endpoints_responsive(self):
        from app.main import app
        holder=self.hold('rate:username-ip:testclient');client=TestClient(app)
        started=time.monotonic()
        def check(_):return client.get('/api/account/username-availability',params={'login':'fictional_runner'}).status_code
        with concurrent.futures.ThreadPoolExecutor(4) as pool:
            futures=[pool.submit(check,i) for i in range(8)]
            self.assertEqual(client.get('/api/health').status_code,200)
            self.assertEqual([f.result(2) for f in futures],[503]*8)
        self.assertLess(time.monotonic()-started,2)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory'").fetchone()['n'],0)
        holder.rollback()
        self.assertEqual(check(0),200)

    def test_concurrent_counter_cannot_exceed_allowance(self):
        barrier=threading.Barrier(4)
        def run():
            barrier.wait()
            try:
                with db.connect() as c:return E.limited(c,'zz_limit:race',1,15)
            except HTTPException as error:
                self.assertEqual(error.status_code,503);return 'busy'
        with concurrent.futures.ThreadPoolExecutor(4) as pool:results=list(pool.map(lambda _:run(),range(4)))
        self.assertEqual(results.count(False),1)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key='zz_limit:race'").fetchone()['n'],sum(x!='busy' for x in results))

    def test_contended_optional_signup_notice_does_not_block_enrollment(self):
        from app import signup
        self.hold('signup-admin-notice')
        with patch.dict(os.environ,{'KINETTA_MAX_ACCOUNTS':'1'}),self.assertLogs('uvicorn.error',level='WARNING'):
            signup.capacity_notice(waitlist_new=True)

    def test_background_worker_stops_and_maintenance_failure_is_sanitized(self):
        called=threading.Event()
        def fail():called.set();raise RuntimeError('fictional private row detail')
        with patch.object(R,'cleanup',fail),self.assertLogs(R.__name__,level='WARNING') as logs:
            stop,worker=R.start_cleanup();self.assertTrue(called.wait(1));stop.set();worker.join(1)
        self.assertFalse(worker.is_alive());self.assertNotIn('private row',str(logs.output))


if __name__=='__main__':unittest.main()
