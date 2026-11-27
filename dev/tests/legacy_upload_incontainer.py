"""Legacy multipart limits on fictional data; no providers, mail or public server."""
import asyncio
import errno
import io
import zipfile
from concurrent.futures import Future
import os
from pathlib import Path
import secrets
import shutil
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request, ClientDisconnect
from app import auth, db, coach, activities, importer, import_upload as U, api_activities as A
from app.main import app

BOUNDARY = 'fictional-upload-boundary'
CTYPE = 'multipart/form-data; boundary=' + BOUNDARY
PREFIX = (f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="files"; filename="fictional.gpx"\r\n\r\n').encode()
SUFFIX = f'\r\n--{BOUNDARY}--\r\n'.encode()
GPX = b'''<?xml version="1.0"?><gpx version="1.1" creator="fictional fixture" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Fictional run</name><trkseg><trkpt lat="40" lon="-75"><time>2026-10-01T10:00:00Z</time></trkpt><trkpt lat="40.001" lon="-75"><time>2026-10-01T10:01:00Z</time></trkpt></trkseg></trk></gpx>'''


def drained():
    until = time.monotonic() + 5
    while U._active and time.monotonic() < until: time.sleep(.005)
    if U._active: raise AssertionError('upload admission leaked')


class Capacity(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.addCleanup(self.release)

    def release(self):
        for lease in list(U._active): lease.release()

    def test_two_global_one_per_account_hold_through_queued_work(self):
        one = U.reserve(1, self.tmp.name, 100)
        for uid in (1,):
            with self.assertRaises(HTTPException) as error: U.reserve(uid, self.tmp.name, 100)
            self.assertEqual(error.exception.status_code, 503)
        two = U.reserve(2, self.tmp.name, 100)
        with self.assertRaises(HTTPException): U.reserve(3, self.tmp.name, 100)
        one.release(); three = U.reserve(3, self.tmp.name, 100)
        self.assertEqual(len(U._active), 2)
        two.release(); three.release(); three.release()
        self.assertFalse(U._active)

    def test_disk_reservations_include_spool_and_copy_across_accounts(self):
        usage = shutil._ntuple_diskusage(8*1024**3, 0, 3*1024**3)
        with patch.object(U.shutil, 'disk_usage', return_value=usage):
            one = U.reserve(1, self.tmp.name, 400*1024**2)
            self.assertEqual(one.remaining, 800*1024**2)
            with self.assertRaises(HTTPException) as error: U.reserve(2, self.tmp.name, 200*1024**2)
            self.assertEqual(error.exception.status_code, 507)
            one.written(800*1024**2)
            two = U.reserve(2, self.tmp.name, 200*1024**2)
            self.assertEqual(two.remaining, 400*1024**2)
            # Pressure after admission is checked again before each spool/copy.
            with patch.object(U.shutil, 'disk_usage', return_value=usage._replace(free=2*1024**3)):
                with self.assertRaises(HTTPException): two.check()

    def test_staging_reuses_spool_budget_for_actual_files(self):
        floor = 2*1024**3
        usage = shutil._ntuple_diskusage(8*1024**3, 0, floor+200)
        path = Path(self.tmp.name)/'small.gpx';path.write_bytes(b'x'*80)
        with patch.object(U.shutil, 'disk_usage', return_value=usage):
            lease = U.reserve(1, self.tmp.name, 100)
            lease.written(200)
            lease.staged([path])
            self.assertEqual(lease.remaining, 80)
            with patch.object(U.shutil, 'disk_usage', return_value=usage._replace(free=floor+80)):
                lease.storing(80)  # exactly enough; no second full-file charge
                self.assertEqual(lease.remaining, 80)
            with patch.object(U.shutil, 'disk_usage', return_value=usage._replace(free=floor+79)):
                with self.assertRaises(HTTPException): lease.storing(80)
            # A compressed entry needs its actual expanded bytes, not MAX_FILE.
            lease.storing(200)
            self.assertEqual(lease.remaining, 200)
            with self.assertRaises(HTTPException): lease.storing(201)
            lease.written(200)
            self.assertEqual(lease.remaining, 0)

    def test_bare_file_read_is_capped_before_parser(self):
        path = Path(self.tmp.name)/'fictional.gpx';path.write_bytes(b'x'*101)
        with patch.object(importer.parsers, 'MAX_FILE', 100):
            with self.assertRaises(importer.parsers.ParseError): importer._file_read(path)
            path.write_bytes(b'x'*100)
            self.assertEqual(len(importer._file_read(path)), 100)

    def test_declared_and_actual_body_limits(self):
        request = lambda headers: Request({'type':'http', 'headers':headers})
        self.assertEqual(U.body_limit(request([]), 100), 100+U.OVERHEAD)
        for value, status in ((b'-1',400),(b'100000000000000',400),(str(101+U.OVERHEAD).encode(),413)):
            with self.assertRaises(HTTPException) as error: U.body_limit(request([(b'content-length',value)]),100)
            self.assertEqual(error.exception.status_code,status)

    def test_cancel_does_not_release_while_disk_worker_runs(self):
        entered = threading.Event(); release = threading.Event(); done = threading.Event()
        def slow():
            entered.set();release.wait(2);done.set();return 4
        async def exercise():
            cleaned=[]
            task=asyncio.create_task(U.offload(slow,cancelled=lambda value:cleaned.append(value)))
            for _ in range(100):
                if entered.is_set():break
                await asyncio.sleep(.005)
            self.assertTrue(entered.is_set());task.cancel();await asyncio.sleep(.02)
            self.assertFalse(task.done());self.assertFalse(done.is_set());self.assertFalse(cleaned)
            task.cancel();release.set()
            with self.assertRaises(asyncio.CancelledError):await task
            self.assertTrue(done.is_set());self.assertEqual(cleaned,[4])
        try:asyncio.run(exercise())
        finally:release.set()


class Routes(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.users=[];cls.tokens=[]
        for _ in range(3):
            login='zz_test_legacy_'+secrets.token_hex(5)
            with db.connect() as c:
                uid=c.execute("INSERT INTO users(login,name,pw_hash,email,email_verified_at) VALUES(%s,'Fictional Import',%s,%s,now()) RETURNING id",
                    (login,auth.hash_pw('fictional import password'),login+'@example.test')).fetchone()['id']
                c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
                token=auth.new_session(c,uid,'fictional import fixture')
            cls.users.append(uid);cls.tokens.append(token)

    @classmethod
    def tearDownClass(cls):
        drained()
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(cls.users,))
        from app.api_account import erase_files
        for uid in cls.users:erase_files(uid)

    def setUp(self):
        drained();self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.data=patch.object(A,'DATA',self.tmp.name);self.data.start();self.addCleanup(self.data.stop)
        self.ai=patch.object(coach,'after_import',return_value=None);self.ai.start();self.addCleanup(self.ai.stop)
        self.client=TestClient(app);self.client.headers.update(self.headers());self.addCleanup(self.client.close)

    def headers(self, index=0):
        return {'Origin':'http://testserver','Authorization':'Bearer '+self.tokens[index]}

    def empty(self):
        self.assertEqual(list(Path(self.tmp.name).rglob('*.*')),[])
        self.assertFalse(U._active)

    def direct(self, parts):
        async def receive():
            part=parts.pop(0)
            if isinstance(part,BaseException):raise part
            return part
        return Request({'type':'http','method':'POST','path':'/api/import','headers':[(b'content-type',CTYPE.encode())]},receive)

    def test_real_import_works_and_releases_only_after_cleanup(self):
        result=self.client.post('/api/import',files={'files':('fictional.gpx',GPX,'application/gpx+xml')})
        self.assertEqual(result.status_code,200,result.text)
        drained()
        with db.connect() as c:
            row=c.execute('SELECT status,added,failed,label FROM imports WHERE user_id=%s AND id=%s',
                (self.users[0],result.json()['job'])).fetchone()
            self.assertEqual((row['status'],row['added'],row['failed'],row['label']),('done',1,0,'fictional.gpx'))
        self.empty()

    def test_small_import_succeeds_at_admission_floor(self):
        floor = 2*1024**3
        # Real request length drives admission. Charge actual staged bytes as
        # they appear, leaving only its admitted budget above the floor.
        raw = GPX.replace(b'2026-10-01',b'2026-10-08')
        length = len(PREFIX+raw+SUFFIX)
        def usage(directory):
            staged = sum(p.stat().st_size for p in Path(self.tmp.name).rglob('*') if p.is_file())
            return shutil._ntuple_diskusage(8*1024**3, 0, floor+2*length-staged)
        with patch.object(U.shutil, 'disk_usage', side_effect=usage):
            response = self.client.post('/api/import', headers={'Content-Type':CTYPE}, content=PREFIX+raw+SUFFIX)
            self.assertEqual(response.status_code,200,response.text)
            drained()
        with db.connect() as c:
            row=c.execute('SELECT status,added,failed FROM imports WHERE id=%s',(response.json()['job'],)).fetchone()
        self.assertEqual((row['status'],row['added'],row['failed']),('done',1,0))
        self.empty()

    def test_real_storage_write_failure_is_atomic_and_retains_staged_upload(self):
        raw=GPX.replace(b'2026-10-01',b'2026-10-09')
        native=activities.tempfile.NamedTemporaryFile
        def partial(**kwargs):
            file=native(**kwargs)
            write=file.write
            def full(data):
                write(data[:12])
                raise OSError(errno.ENOSPC,'fictional disk full')
            file.write=full
            return file
        with patch.object(activities.tempfile,'NamedTemporaryFile',side_effect=partial):
            response=self.client.post('/api/import',files={'files':('fictional.gpx',raw)})
            self.assertEqual(response.status_code,200,response.text);drained()
        job=response.json()['job']
        paths=list((Path(self.tmp.name)/'uploads'/str(self.users[0])/str(job)).glob('*'))
        self.assertEqual(len(paths),1);self.assertEqual(paths[0].read_bytes(),raw)
        # No truncated durable file survives, and the same staged bytes import
        # successfully once actual disk writes work again.
        import hashlib
        final=Path(activities.DATA)/'files'/str(self.users[0])/(hashlib.sha256(raw).hexdigest()+'.gpx')
        self.assertFalse(final.exists())
        self.assertFalse(list(final.parent.glob('tmp*')))
        retry=importer.new_job(self.users[0],'retry after disk full')
        importer._run(retry,self.users[0],[str(p) for p in paths])
        self.assertEqual(final.read_bytes(),raw)
        self.empty()

    def test_worker_storage_pressure_keeps_complete_staging_and_can_retry(self):
        for error in (HTTPException(507,'temporary storage'),OSError(errno.ENOSPC,'full'),OSError(errno.EDQUOT,'quota')):
            # A storage failure after one successful activity must preserve the
            # whole export, stop remaining work, and retain accurate progress.
            with patch.object(importer.activities,'store',side_effect=[('added',99),error]) as store:
                response=self.client.post('/api/import',files=[('files',('one.gpx',GPX)),('files',('two.gpx',GPX)),('files',('three.gpx',GPX))])
                self.assertEqual(response.status_code,200,response.text);drained()
            self.assertEqual(store.call_count,2)
            self.assertEqual(coach.after_import.call_args.args[1],[99])
            job=response.json()['job']
            with db.connect() as c:
                row=c.execute('SELECT status,done,added,failed,messages FROM imports WHERE id=%s',(job,)).fetchone()
            self.assertEqual((row['status'],row['done'],row['added'],row['failed']),('failed',1,1,0))
            self.assertIn('uploaded files are kept',row['messages'][-1])
            paths=sorted((Path(self.tmp.name)/'uploads'/str(self.users[0])/str(job)).glob('*'))
            self.assertEqual(len(paths),3)
            self.assertTrue(all(p.read_bytes()==GPX for p in paths))
            self.assertFalse(U._active)
            # Operator retry uses the existing importer after freeing space.
            retry=importer.new_job(self.users[0],'operator retry')
            importer._run(retry,self.users[0],[str(p) for p in paths])
            with db.connect() as c:
                row=c.execute('SELECT status,failed FROM imports WHERE id=%s',(retry,)).fetchone()
            self.assertEqual((row['status'],row['failed']),('done',0))
            self.empty()

    def test_zip_expansion_uses_actual_entry_size_and_retains_on_pressure(self):
        archive=io.BytesIO()
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            z.writestr('fictional.gpx',GPX+b' '*100000)
        original=U.Capacity.storing;sizes=[]
        def pressure(lease,size):
            sizes.append(size)
            self.assertLess(lease.remaining,size)  # expansion exceeds compressed staging
            raise HTTPException(507,'temporary storage')
        with patch.object(U.Capacity,'storing',pressure):
            response=self.client.post('/api/import',files={'files':('fictional.zip',archive.getvalue())})
            self.assertEqual(response.status_code,200,response.text);drained()
        self.assertEqual(sizes,[len(GPX)+100000])
        job=response.json()['job']
        path=next((Path(self.tmp.name)/'uploads'/str(self.users[0])/str(job)).glob('*'))
        self.assertEqual(path.read_bytes(),archive.getvalue())
        # Successful retry consumes precisely the expanded size, then cleans up.
        lease=U.reserve(self.users[0],str(path.parent),path.stat().st_size)
        lease.staged([path]);retry=importer.new_job(self.users[0],'ZIP retry')
        with patch.object(U.Capacity,'storing',autospec=True,side_effect=original) as storing:
            try:importer._run(retry,self.users[0],[str(path)],capacity=lease)
            finally:lease.release()
        self.assertEqual(storing.call_args.args[1],len(GPX)+100000)
        self.empty()

    def test_anonymous_rejected_before_spooling_or_job(self):
        with patch.object(U.tempfile,'SpooledTemporaryFile') as spool:
            response=TestClient(app).post('/api/import',files={'files':('fictional.gpx',GPX)})
        self.assertEqual(response.status_code,401,response.text);spool.assert_not_called();self.empty()

    def test_bounded_worker_queue_rejects_before_read_and_health_stays_responsive(self):
        release=threading.Event();entered=threading.Event();peak=active=0
        def held(job,uid,paths,capacity):
            nonlocal peak,active
            active+=1;peak=max(active,peak);entered.set()
            try:
                release.wait(5)
                self.assertIn(capacity,U._active)
                for path in paths:os.remove(path)
            finally:active-=1
        with patch.object(importer,'_run',side_effect=held):
            try:
                for index in (0,1):
                    r=self.client.post('/api/import',headers=self.headers(index),files={'files':('fictional.gpx',GPX)})
                    self.assertEqual(r.status_code,200,r.text)
                self.assertTrue(entered.wait(1));self.assertEqual(len(U._active),2)
                async def exercise():
                    read=[]
                    async def body():read.append(True);yield PREFIX+GPX+SUFFIX
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
                        for index in (0,2):
                            r=await client.post('/api/import',headers={**self.headers(index),'Content-Type':CTYPE},content=body())
                            self.assertEqual(r.status_code,503,r.text);self.assertEqual(r.headers['Retry-After'],'5')
                        start=time.monotonic();r=await client.get('/api/health')
                        self.assertEqual(r.status_code,200);self.assertLess(time.monotonic()-start,.5)
                    self.assertEqual(read,[])
                asyncio.run(exercise());self.assertEqual(peak,1)
            finally:release.set();drained()
        self.empty()

    def test_size_limits_spooled_and_chunked_and_close_all_files(self):
        original=U.tempfile.SpooledTemporaryFile
        for chunked in (False,True):
            spools=[]
            def tracked(**kw):
                file=original(**kw);spools.append(file);return file
            async def exercise():
                async def pieces():
                    for piece in (PREFIX,b'x'*65536,b'x'*65536,SUFFIX):yield piece
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
                    return await client.post('/api/import',headers={**self.headers(),'Content-Type':CTYPE},
                        content=pieces() if chunked else PREFIX+b'x'*131072+SUFFIX)
            with patch.object(A,'UPLOAD_MAX',100000),patch.object(U.tempfile,'SpooledTemporaryFile',side_effect=tracked):
                r=asyncio.run(exercise())
            self.assertEqual(r.status_code,413,r.text)
            self.assertTrue(spools);self.assertTrue(all(file.closed for file in spools));self.empty()

    def test_bare_file_cap_and_zip_keeps_aggregate_allowance(self):
        with patch.object(U.parsers,'MAX_FILE',100):
            r=self.client.post('/api/import',files={'files':('fictional.gpx',b'x'*101)})
            self.assertEqual(r.status_code,413,r.text)
            future=Future()
            with patch.object(importer,'submit',return_value=future) as submit:
                r=self.client.post('/api/import',files={'files':('fictional.zip',b'x'*101)})
                self.assertEqual(r.status_code,200,r.text)
                paths=submit.call_args.args[2]
                for path in paths:os.remove(path)
                future.set_result(None)
        self.empty()

    def test_timeout_disconnect_incomplete_and_cancellation_cleanup(self):
        original=U.tempfile.SpooledTemporaryFile
        for reason in ('idle','total','disconnect','incomplete','cancel'):
            spools=[]
            def tracked(**kw):
                file=original(**kw);spools.append(file);return file
            async def exercise():
                first=True;block=asyncio.Event()
                async def receive():
                    nonlocal first
                    if first:first=False;return {'type':'http.request','body':PREFIX+b'x'*70000,'more_body':True}
                    if reason=='disconnect':return {'type':'http.disconnect'}
                    if reason=='incomplete':return {'type':'http.request','body':b'','more_body':False}
                    if reason=='total':await asyncio.sleep(.01);return {'type':'http.request','body':b'x','more_body':True}
                    await block.wait()
                request=Request({'type':'http','method':'POST','path':'/api/import','headers':[(b'content-type',CTYPE.encode())]},receive)
                task=asyncio.create_task(A.upload(request,user={'id':self.users[0]}))
                if reason=='cancel':
                    for _ in range(100):
                        if spools and spools[-1]._rolled:break
                        await asyncio.sleep(.005)
                    self.assertTrue(spools and spools[-1]._rolled);task.cancel()
                with self.assertRaises((HTTPException,ClientDisconnect,asyncio.CancelledError)) as error:await task
                if reason in ('idle','total'):self.assertEqual(error.exception.status_code,408)
                if reason=='incomplete':self.assertEqual(error.exception.status_code,400)
            with patch.object(U,'IDLE_SECONDS',.1),patch.object(U,'RECEIVE_SECONDS',.2),patch.object(U.tempfile,'SpooledTemporaryFile',side_effect=tracked):
                asyncio.run(exercise())
            self.assertTrue(spools);self.assertTrue(all(file.closed for file in spools));self.empty()

    def test_disconnect_waits_for_spool_write_before_releasing_capacity(self):
        original=U.tempfile.SpooledTemporaryFile
        entered=threading.Event();release=threading.Event();spools=[]
        def tracked(**kw):
            file=original(**kw);spools.append(file);write=file.write
            def blocked(data):
                entered.set();release.wait(3);return write(data)
            file.write=blocked
            return file
        async def exercise():
            request=self.direct([{'type':'http.request','body':PREFIX+GPX+SUFFIX,'more_body':False}])
            task=asyncio.create_task(A.upload(request,user={'id':self.users[0]}))
            for _ in range(100):
                if entered.is_set():break
                await asyncio.sleep(.005)
            self.assertTrue(entered.is_set());task.cancel();await asyncio.sleep(.02)
            self.assertFalse(task.done());self.assertEqual(len(U._active),1)
            self.assertFalse(spools[0].closed)
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
                self.assertEqual((await client.get('/api/health')).status_code,200)
            release.set()
            with self.assertRaises(asyncio.CancelledError):await task
        try:
            with patch.object(U.tempfile,'SpooledTemporaryFile',side_effect=tracked):asyncio.run(exercise())
        finally:release.set()
        self.assertTrue(spools[0].closed);self.empty()

    def test_submit_failure_cleans_paths_and_capacity(self):
        with patch.object(importer,'submit',side_effect=RuntimeError('fictional submit failure')):
            with self.assertRaises(RuntimeError):self.client.post('/api/import',files={'files':('fictional.gpx',GPX)})
        self.empty()
        with db.connect() as c:
            row=c.execute('SELECT status FROM imports WHERE user_id=%s ORDER BY id DESC LIMIT 1',(self.users[0],)).fetchone()
            self.assertEqual(row['status'],'failed')

    def test_disk_pressure_after_headers_closes_spool(self):
        original=U.Capacity.check;calls=[]
        def pressure(lease,extra=0):
            calls.append(True)
            if len(calls)>1:raise HTTPException(507,'Not enough storage')
            return original(lease,extra)
        async def exercise():
            async def pieces():
                yield PREFIX+b'x'*70000
                yield b'x'*70000+SUFFIX
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://testserver') as client:
                return await client.post('/api/import',headers={**self.headers(),'Content-Type':CTYPE},content=pieces())
        with patch.object(U.Capacity,'check',pressure):r=asyncio.run(exercise())
        self.assertEqual(r.status_code,507,r.text);self.empty()

    def test_copy_failure_closes_spools_and_removes_partial_staging(self):
        spools=[]
        def interrupted(files,directory,lease,extensions):
            spools.extend(file.file for file in files)
            Path(directory).mkdir(parents=True)
            (Path(directory)/'partial.gpx').write_bytes(b'partial')
            raise HTTPException(507,'Not enough storage')
        with patch.object(U,'save',side_effect=interrupted):
            r=self.client.post('/api/import',files={'files':('fictional.gpx',GPX)})
        self.assertEqual(r.status_code,507,r.text)
        self.assertTrue(all(file.closed for file in spools));self.empty()

    def test_worker_failure_frees_place_and_next_import_succeeds(self):
        bad=self.client.post('/api/import',files={'files':('fictional.zip',b'not an archive')})
        self.assertEqual(bad.status_code,200,bad.text);drained()
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT status FROM imports WHERE id=%s',(bad.json()['job'],)).fetchone()['status'],'failed')
        good=self.client.post('/api/import',files={'files':('fictional.gpx',GPX.replace(b'2026-10-01',b'2026-10-02'))})
        self.assertEqual(good.status_code,200,good.text);drained()
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT status FROM imports WHERE id=%s',(good.json()['job'],)).fetchone()['status'],'done')
        own=self.client.get('/api/imports').json()
        peer=self.client.get('/api/imports',headers=self.headers(1)).json()
        self.assertIn(good.json()['job'],[row['id'] for row in own])
        self.assertNotIn(good.json()['job'],[row['id'] for row in peer])
        self.empty()

    def test_part_header_and_field_bounds(self):
        bad_header=PREFIX.replace(b'fictional.gpx',b'x'*17000+b'.gpx')+b'hello'+SUFFIX
        fields=b''.join((f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="ignored{i}"\r\n\r\nx\r\n').encode() for i in range(17))+SUFFIX
        for raw,status in ((bad_header,400),(fields,400)):
            r=self.client.post('/api/import',content=raw,headers={'Content-Type':CTYPE})
            self.assertEqual(r.status_code,status,r.text);self.empty()


if __name__=='__main__':unittest.main()
