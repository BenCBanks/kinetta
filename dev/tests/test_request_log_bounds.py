"""Bound diagnostics without recording personal payloads or slowing API responses."""
import asyncio
import threading
import time
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from app import db, request_log as L
from app.main import app


def row():
    return dict(user_id=None,method='GET',route='unmatched',status=404,duration_ms=1,channel='web',request_id=L.new_id())


def drained():
    until=time.monotonic()+3
    while L.stats()['pending'] and time.monotonic()<until:time.sleep(.005)
    if L.stats()['pending']:raise AssertionError('diagnostic work did not drain')


class Admission(unittest.TestCase):
    def tearDown(self):drained()

    def test_burst_bounds_running_and_waiting_without_default_executor(self):
        release=threading.Event();entered=threading.Event();active=peak=0;lock=threading.Lock()
        def blocked(_):
            nonlocal active,peak
            with lock:active+=1;peak=max(peak,active)
            entered.set();release.wait(3)
            with lock:active-=1
            return True
        before=L.stats()
        with patch.object(L,'_write',side_effect=blocked):
            try:
                with ThreadPoolExecutor(max_workers=8) as callers:
                    accepted=list(callers.map(lambda _:L.enqueue(row()),range(400)))
                self.assertTrue(entered.wait(1))
                self.assertEqual(sum(accepted),L.PENDING)
                self.assertEqual(L.stats()['pending'],L.PENDING)
                self.assertEqual(L.stats()['dropped']-before['dropped'],400-L.PENDING)
                # A full diagnostic queue still permits an unrelated real route.
                started=time.monotonic()
                client=TestClient(app)
                try:self.assertEqual(client.get('/api/health').status_code,200)
                finally:client.close()
                self.assertLess(time.monotonic()-started,.5)
            finally:release.set();drained()
        self.assertEqual(peak,1)
        self.assertEqual(L.stats()['written']-before['written'],L.PENDING)

    def test_failed_write_returns_capacity_and_counts_drop(self):
        before=L.stats()
        with patch.object(L,'_write',side_effect=RuntimeError('fictional private error')):
            self.assertTrue(L.enqueue(row()));drained()
        self.assertEqual(L.stats()['dropped'],before['dropped']+1)
        with patch.object(L,'_write',return_value=True):
            self.assertTrue(L.enqueue(row()));drained()

    def test_submission_failure_returns_capacity(self):
        before=L.stats()
        with patch.object(L._executor,'submit',side_effect=RuntimeError('stopped worker')):
            self.assertFalse(L.enqueue(row()))
        self.assertEqual(L.stats()['pending'],0)
        self.assertEqual(L.stats()['dropped'],before['dropped']+1)
        with patch.object(L,'_write',return_value=True):
            self.assertTrue(L.enqueue(row()));drained()

    def test_record_only_metadata_and_bypasses_successful_optional_counter(self):
        req=SimpleNamespace(scope={'route':SimpleNamespace(path='/api/things/{id}')},
            url=SimpleNamespace(path='/api/things/secret-value'),state=SimpleNamespace(user_id=123),
            method='GET',headers={'authorization':'Bearer secret-token'},body='private text')
        with patch.object(L,'enqueue') as enqueue:
            L.record(req,200,2**40,L.new_id())
            saved=enqueue.call_args.args[0]
            self.assertEqual(set(saved),set(row()))
            self.assertEqual(saved['route'],'/api/things/{id}')
            self.assertEqual(saved['duration_ms'],2**31-1)
            self.assertNotIn('secret',str(saved));self.assertNotIn('private',str(saved))
            req.scope['route'].path='/api/features/open'
            enqueue.reset_mock();L.record(req,204,1,L.new_id());enqueue.assert_not_called()


class Storage(unittest.TestCase):
    def setUp(self):
        drained()
        self.c=psycopg.connect(db.CONNINFO)
        self.schema='zz_test_diagnostics_'+uuid.uuid4().hex[:12]
        self.c.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(self.schema)))
        self.c.execute(sql.SQL('CREATE TABLE {}.api_requests (LIKE public.api_requests INCLUDING ALL)').format(sql.Identifier(self.schema)))
        self.c.execute(sql.SQL('SET search_path TO {},public').format(sql.Identifier(self.schema)));self.c.commit()
        @contextmanager
        def connection(timeout):
            self.assertEqual(timeout,.1)
            from psycopg.rows import dict_row
            before=self.c.row_factory
            try:
                self.c.row_factory=dict_row
                with self.c.transaction():yield self.c
            finally:self.c.row_factory=before
        self.pool=patch.object(L.db,'pool',return_value=SimpleNamespace(connection=connection))
        self.pool.start();self.addCleanup(self.pool.stop)
        self.cap=patch.object(L,'MAX_ROWS',4);self.cap.start();self.addCleanup(self.cap.stop)
        self.batch=patch.object(L,'PRUNE_BATCH',2);self.batch.start();self.addCleanup(self.batch.stop)
        self.cleanup=patch.object(L,'_cleanup_after',0);self.cleanup.start();self.addCleanup(self.cleanup.stop)

    def tearDown(self):
        self.c.rollback()
        self.c.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(self.schema)));self.c.commit();self.c.close()

    def insert(self,n,old=False):
        for _ in range(n):
            self.c.execute("INSERT INTO api_requests(created,method,route,status,duration_ms,channel,request_id) VALUES(now()-%s*interval '1 day','GET','unmatched',404,1,'web',%s)",(100 if old else 0,L.new_id()))
        self.c.commit()

    def count(self):
        value=self.c.execute('SELECT count(*) FROM api_requests').fetchone()[0];self.c.commit();return value

    def test_cap_preserves_newest_and_survives_writer_restart(self):
        for _ in range(9):self.assertTrue(L._write(row()))
        self.assertEqual(self.count(),4)
        with patch.object(L,'_cleanup_after',0):self.assertTrue(L._write(row()))
        self.assertEqual(self.count(),4)
        ids=self.c.execute('SELECT id FROM api_requests ORDER BY id').fetchall();self.c.commit()
        self.assertEqual([x[0] for x in ids],[7,8,9,10])

    def test_oversized_existing_table_shrinks_before_accepting_more(self):
        self.insert(10)
        self.assertFalse(L._write(row()));self.assertEqual(self.count(),8)
        self.assertFalse(L._write(row()));self.assertEqual(self.count(),6)
        self.assertFalse(L._write(row()));self.assertEqual(self.count(),4)
        self.assertTrue(L._write(row()));self.assertEqual(self.count(),4)

    def test_expiry_cleanup_is_batched_and_not_random(self):
        self.insert(3,old=True)
        with patch.object(L,'MAX_ROWS',100):self.assertTrue(L._write(row()))
        self.assertEqual(self.count(),2)
        old=self.c.execute("SELECT count(*) FROM api_requests WHERE created<now()-interval '90 days'").fetchone()[0]
        self.c.commit();self.assertEqual(old,1)

    def test_lock_and_statement_timeouts_are_local(self):
        before=self.c.execute("SELECT current_setting('statement_timeout'),current_setting('lock_timeout')").fetchone();self.c.commit()
        self.assertTrue(L._write(row()))
        after=self.c.execute("SELECT current_setting('statement_timeout'),current_setting('lock_timeout')").fetchone();self.c.commit()
        self.assertEqual(after,before)

    def test_sql_contention_drops_diagnostic_instead_of_holding_pool(self):
        with psycopg.connect(db.CONNINFO) as holder:
            holder.execute(sql.SQL('LOCK TABLE {}.api_requests IN ACCESS EXCLUSIVE MODE').format(sql.Identifier(self.schema)))
            started=time.monotonic();self.assertFalse(L._write(row()))
            self.assertLess(time.monotonic()-started,.5)
        self.assertTrue(L._write(row()))

    def test_other_writer_lock_is_nonblocking(self):
        with psycopg.connect(db.CONNINFO) as holder:
            holder.execute("SELECT pg_advisory_xact_lock(hashtextextended('request-diagnostics',0))")
            started=time.monotonic();self.assertFalse(L._write(row()))
            self.assertLess(time.monotonic()-started,.1)
        self.assertTrue(L._write(row()))

    def test_full_pool_drops_only_diagnostic(self):
        with patch.object(L.db,'pool',return_value=SimpleNamespace(connection=lambda **kw:(_ for _ in ()).throw(TimeoutError('pool unavailable')))):
            self.assertFalse(L._write(row()))
        self.assertTrue(L._write(row()))


if __name__=='__main__':unittest.main()
