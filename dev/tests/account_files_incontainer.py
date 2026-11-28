"""Fictional disk/SQL recovery; no provider, mail or production access."""
import asyncio
from pathlib import Path
import os
import secrets
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from psycopg.errors import LockNotAvailable
from app import account_files as F, api_account as A, api_mydata as E, db


class Recovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.ids = []
        with db.connect() as c:
            for _ in range(2):
                uid = c.execute("INSERT INTO users(login,name) VALUES(%s,'Fictional Recovery Person') RETURNING id",
                                ('zz_test_files_'+secrets.token_hex(5),)).fetchone()['id']
                c.execute('INSERT INTO profile(user_id) VALUES(%s)', (uid,))
                self.ids.append(uid)
        for uid in self.ids:
            for kind in ('files', 'uploads'):
                path = self.root / kind / str(uid)
                path.mkdir(parents=True)
                (path / 'fictional.txt').write_text(str(uid))

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=ANY(%s)', (self.ids,))
        for uid in self.ids:
            E.forget_exports(uid)
        self.temp.cleanup()

    def sweep(self):
        # Never scan the container's unrelated /tmp exports during this fixture.
        with patch.object(F.tempfile, 'gettempdir', return_value=str(self.root)):
            F.sweep(self.root)

    def test_failed_removal_and_restart_without_after_commit_callback(self):
        uid, peer = self.ids
        with db.connect() as c:
            A.erase(c, {'id':uid})
        E._links['departed'] = (uid, 'fictional', 9999999999)
        E._links['peer'] = (peer, 'other', 9999999999)
        with patch.object(A, 'DATA', str(self.root)), patch.object(F.shutil, 'rmtree', side_effect=PermissionError), self.assertLogs('uvicorn.error', 'WARNING'):
            A.erase_files(uid)
        self.assertNotIn('departed', E._links)
        self.assertIn('peer', E._links)
        with patch.object(F.shutil, 'rmtree', side_effect=OSError), self.assertLogs('uvicorn.error', 'WARNING'):
            self.sweep()
        self.assertTrue((self.root/'files'/str(uid)).exists())
        # No in-memory queued task is needed; a new sweep rediscovers leftovers.
        self.sweep()
        self.assertFalse((self.root/'files'/str(uid)).exists())
        self.assertFalse((self.root/'uploads'/str(uid)).exists())
        self.assertEqual((self.root/'files'/str(peer)/'fictional.txt').read_text(), str(peer))
        # Also recover the commit->callback crash window and late legacy writes.
        late = self.root/'uploads'/str(uid)
        late.mkdir(); (late/'late.txt').write_text('fictional late upload')
        self.sweep(); self.assertFalse(late.exists())

    def test_rollback_database_failure_and_path_boundaries(self):
        uid, _ = self.ids
        with self.assertRaises(RuntimeError):
            with db.connect() as c:
                A.erase(c, {'id':uid})
                raise RuntimeError('fictional rollback')
        F.erase_user(uid, self.root)
        self.sweep()
        self.assertTrue((self.root/'files'/str(uid)).exists())
        with patch.object(F.db, 'connect', side_effect=RuntimeError), self.assertLogs('uvicorn.error', 'WARNING'):
            self.sweep()
        self.assertTrue((self.root/'files'/str(uid)).exists())
        for name in ('001', '-2', 'not-an-owner'):
            path = self.root/'files'/name; path.mkdir(); (path/'keep').touch()
        outside = self.root/'outside'; outside.mkdir(); (outside/'keep').touch()
        with db.connect() as c:
            A.erase(c, {'id':uid})
        target = self.root/'files'/str(uid)
        F.shutil.rmtree(target); target.symlink_to(outside, target_is_directory=True)
        self.sweep()
        self.assertTrue((outside/'keep').exists())
        self.assertFalse(target.is_symlink())
        self.assertTrue((self.root/'files'/'001'/'keep').exists())

    def test_export_crash_active_download_and_failed_unlink(self):
        uid = self.ids[0]
        active = F.ExportFile(uid, self.root)
        active.path.write_bytes(b'fictional active export')
        try:
            child = subprocess.check_output([sys.executable, '-c',
                'import os,sys; from app.account_files import ExportFile; x=ExportFile(int(sys.argv[1]),sys.argv[2]); x.path.write_bytes(b"fictional crash"); print(x.path,flush=True); os._exit(0)',
                str(uid), str(self.root)], text=True).strip()
            abandoned = Path(child)
            self.assertTrue(abandoned.exists())
            self.sweep()
            self.assertFalse(abandoned.exists())
            self.assertTrue(active.path.exists())
            with patch.object(Path, 'unlink', side_effect=PermissionError), self.assertLogs('uvicorn.error', 'WARNING'):
                active.close()
            self.assertTrue(active.path.exists())
            self.sweep(); self.assertFalse(active.path.exists())
        finally:
            active.close()

    def test_export_send_success_failure_cancel_and_no_deferred_pathsend(self):
        async def exercise(mode):
            lease = F.ExportFile(self.ids[0], self.root)
            lease.path.write_bytes(b'fictional streamed data')
            response = E.ExportResponse(lease)
            messages = []
            async def receive():
                return {'type':'http.disconnect'}
            async def send(message):
                messages.append(message)
                if message['type'] == 'http.response.body':
                    self.sweep(); self.assertTrue(lease.path.exists())
                    if mode == 'error': raise OSError('fictional disconnect')
                    if mode == 'cancel': raise asyncio.CancelledError()
            scope = {'type':'http','method':'GET','headers':[], 'asgi':{'spec_version':'2.4'}, 'extensions':{'http.response.pathsend':{}}}
            try:
                await response(scope, receive, send)
            except BaseException as error:
                if mode == 'success': raise
                self.assertIsInstance(error, OSError if mode == 'error' else asyncio.CancelledError)
            else:
                self.assertEqual(mode, 'success')
            self.assertFalse(lease.path.exists())
            self.assertIn('http.response.body', [m['type'] for m in messages])
            self.assertNotIn('http.response.pathsend', [m['type'] for m in messages])
        for mode in ('success', 'error', 'cancel'):
            asyncio.run(exercise(mode))

    def test_export_build_failure_and_deleted_owner_link(self):
        uid, _ = self.ids
        user = {'id':uid, 'login':'fictional'}
        with patch.object(E, 'DATA', str(self.root)), patch.object(E, '_write_export', side_effect=OSError):
            with self.assertRaises(OSError): E._send_export(user)
        self.assertEqual(list((self.root/'exports'/str(uid)).glob('*.zip')), [])
        E._links['stale'] = (uid, 'fictional', 9999999999)
        with db.connect() as c: A.erase(c, {'id':uid})
        with patch.object(E, 'DATA', str(self.root)):
            with self.assertRaises(HTTPException) as error: E.export_by_link('stale')
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(list((self.root/'exports'/str(uid)).glob('*.zip')), [])


    def test_deletion_waits_for_original_file_copy(self):
        entered, release = threading.Event(), threading.Event()
        errors = []
        write = E.zipfile.ZipFile.write
        def paused_write(archive, *args, **kwargs):
            entered.set()
            if not release.wait(5): raise RuntimeError('Fixture copy timed out')
            return write(archive, *args, **kwargs)
        def build():
            try: E._write_export(self.ids[0], self.root/'copy.zip')
            except Exception as error: errors.append(error)
        with patch.object(E, 'DATA', str(self.root)), patch.object(E.zipfile.ZipFile, 'write', paused_write):
            worker = threading.Thread(target=build); worker.start()
            try:
                self.assertTrue(entered.wait(5))
                with self.assertRaises(LockNotAvailable), db.connect() as c:
                    c.execute("SET LOCAL lock_timeout='100ms'")
                    c.execute('DELETE FROM users WHERE id=%s', (self.ids[0],))
            finally:
                release.set(); worker.join(5)
        self.assertFalse(worker.is_alive()); self.assertEqual(errors, [])

    def test_legacy_exports_are_cleaned_after_grace_without_following_symlinks(self):
        stale = self.root/'kinetta-export-old.zip'; stale.write_bytes(b'fictional old')
        os.utime(stale, (0, 0))
        fresh = self.root/'kinetta-export-new.zip'; fresh.write_bytes(b'fictional new')
        link = self.root/'kinetta-export-link.zip'; link.symlink_to(fresh)
        self.sweep()
        self.assertFalse(stale.exists())
        self.assertTrue(fresh.exists()); self.assertTrue(link.is_symlink())


class PreparedExport(unittest.TestCase):
    """Real routes/file leases, fictional ZIP writer; no database/provider needed."""
    def setUp(self):
        import httpx
        from fastapi import FastAPI, Request
        self.httpx = httpx
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.app = FastAPI()
        self.app.include_router(E.router)
        async def own_user(request: Request):
            uid = request.headers.get('X-Fictional-User')
            if not uid: raise HTTPException(401, 'Sign in')
            return {'id':int(uid), 'login':'fictional_'+uid}
        self.app.dependency_overrides[E.current_user] = own_user
        self.writes = []
        def write(uid, path):
            self.writes.append(uid)
            with E.zipfile.ZipFile(path, 'w') as z:
                z.writestr(E.zipfile.ZipInfo('fictional.txt', (2026,1,1,0,0,0)), 'own fixture '+str(uid))
        self.patches = [patch.object(E, 'DATA', str(self.root)),
                        patch.object(E, '_write_export', side_effect=write),
                        patch.dict(E._last_export, {}, clear=True)]
        for item in self.patches: item.start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
        self.addCleanup(lambda: [E.expire_prepared_exports(uid) for uid in [101,102]])

    def request(self, method, path, uid=101):
        async def send():
            async with self.httpx.AsyncClient(transport=self.httpx.ASGITransport(app=self.app, raise_app_exceptions=True), base_url='http://fixture') as client:
                return await client.request(method, path, headers={} if uid is None else {'X-Fictional-User':str(uid)})
        return asyncio.run(send())

    def test_prepare_retry_download_owner_and_replay(self):
        self.assertEqual(self.request('POST', '/api/account/export-ready', None).status_code, 401)
        path = self.request('POST', '/api/account/export-ready').json()['path']
        # A lost preparation reply can be retried without building a second ZIP.
        self.assertEqual(self.request('POST', '/api/account/export-ready').json()['path'], path)
        self.assertEqual(self.writes, [101])
        self.assertEqual(self.request('GET', path, None).status_code, 401)
        self.assertEqual(self.request('GET', path, 102).status_code, 404)
        self.assertEqual(len(list((self.root/'exports'/'101').glob('*.zip'))), 1)
        reply = self.request('GET', path)
        self.assertEqual(reply.status_code, 200)
        self.assertEqual(reply.headers['content-type'], 'application/zip')
        import io
        with E.zipfile.ZipFile(io.BytesIO(reply.content)) as z:
            self.assertEqual(z.read('fictional.txt'), b'own fixture 101')
        self.assertEqual(self.request('GET', path).status_code, 404)
        self.assertEqual(list((self.root/'exports'/'101').glob('*.zip')), [])
        self.assertEqual(self.request('POST', '/api/account/export-ready').status_code, 429)

    def test_concurrent_preparations_keep_one_file_per_account(self):
        entered, release = threading.Event(), threading.Event()
        original = E._write_export
        replies = []
        def held(*args):
            entered.set()
            if not release.wait(3): raise RuntimeError('Fixture did not release preparation')
            return original(*args)
        with patch.object(E, '_write_export', side_effect=held):
            worker = threading.Thread(target=lambda: replies.append(self.request('POST', '/api/account/export-ready')))
            worker.start()
            try:
                self.assertTrue(entered.wait(3))
                self.assertEqual(self.request('POST', '/api/account/export-ready').status_code, 429)
            finally:
                release.set(); worker.join(3)
        self.assertFalse(worker.is_alive())
        self.assertEqual(replies[0].status_code, 200)
        self.assertEqual(self.writes, [101])
        self.assertEqual(len(list((self.root/'exports'/'101').glob('*.zip'))), 1)

    def test_failed_preparation_is_json_and_can_retry(self):
        with patch.object(E, '_write_export', side_effect=HTTPException(503, 'Fictional busy')):
            reply = self.request('POST', '/api/account/export-ready')
        self.assertEqual(reply.status_code, 503)
        self.assertEqual(reply.json()['detail'], 'Fictional busy')
        self.assertNotIn(101, E._last_export)
        self.assertEqual(list((self.root/'exports'/'101').glob('*.zip')), [])
        self.assertEqual(self.request('POST', '/api/account/export-ready').status_code, 200)

    def test_expiry_and_deletion_release_only_owned_leases(self):
        with patch.object(E.time, 'time', return_value=1000):
            path = self.request('POST', '/api/account/export-ready').json()['path']
        with patch.object(E.time, 'time', return_value=1301):
            with patch.object(F, '_absent', return_value=False), patch.object(F.tempfile, 'gettempdir', return_value=str(self.root)):
                F.sweep(self.root)  # The existing background cleanup also retires abandoned preparations.
        self.assertFalse(E._prepared_exports)
        self.assertEqual(list((self.root/'exports'/'101').glob('*.zip')), [])
        self.assertEqual(self.request('GET', path).status_code, 404)
        self.request('POST', '/api/account/export-ready')
        peer = self.request('POST', '/api/account/export-ready', 102).json()['path']
        E.forget_exports(101)
        self.assertEqual(list((self.root/'exports'/'101').glob('*.zip')), [])
        self.assertEqual(self.request('GET', peer, 102).status_code, 200)


if __name__ == '__main__':
    unittest.main()
