"""Fictional pre-parser bounds, real sessions, uploads and cancellation; no providers."""
import asyncio
import threading
import unittest
from unittest.mock import patch
from fastapi import FastAPI, Request, UploadFile, Depends, HTTPException
from fastapi.testclient import TestClient
from app import request_bodies as B, auth, db


def fixture():
    app = FastAPI()
    app.add_middleware(B.BodyLimits)
    @app.post('/api/json')
    async def json_body(data:dict): return data
    @app.post('/api/bytes')
    async def body(request:Request): return {'size':len(await request.body())}
    @app.post('/api/import')
    async def upload(files:list[UploadFile], user=Depends(auth.current_user)):
        return {'size':sum([len(await f.read()) for f in files])}
    @app.post('/api/garmin/push/{secret}')
    async def secret(secret:str,request:Request):
        if secret != 'fictional': raise HTTPException(404)
        return {'body':(await request.body()).decode()}
    return app


class Bodies(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with db.connect() as c:
            cls.uid=c.execute("INSERT INTO users(login,name) VALUES('zz_test_body_bounds','Fictional Body') RETURNING id").fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES(%s)',(cls.uid,))
            cls.token=auth.new_session(c,cls.uid,'fictional body test')
    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(cls.uid,))

    def test_small_json_adds_no_session_lookup(self):
        with TestClient(fixture()) as client, patch.object(B,'session_exists',side_effect=AssertionError('extra session query')):
            for headers in ({},{'authorization':'Bearer '+self.token},{'cookie':auth.COOKIE+'='+self.token}):
                self.assertEqual(client.post('/api/json',json={'ok':True},headers=headers).json(),{'ok':True})

    def test_oversized_and_invalid_session_fail_before_json_parser(self):
        with TestClient(fixture()) as client:
            for headers in ({},{'authorization':'Bearer fake'},{'cookie':auth.COOKIE+'=fake'}):
                r=client.post('/api/json',content=b'['*(B.ANONYMOUS_BYTES+1),headers={'content-type':'application/json',**headers})
                self.assertEqual(r.status_code,413)
                self.assertEqual(r.headers['connection'],'close')

    def test_web_and_bridge_keep_large_json_and_uploads(self):
        data=b'x'*(B.ANONYMOUS_BYTES+1)
        with TestClient(fixture()) as client:
            for headers in ({'authorization':'Bearer '+self.token},{'cookie':auth.COOKIE+'='+self.token}):
                self.assertEqual(client.post('/api/bytes',content=data,headers={'content-type':'application/json',**headers}).json(),{'size':len(data)})
                self.assertEqual(client.post('/api/import',files={'files':('fictional.fit',b'x'*(2*1024**2))},headers=headers).json(),{'size':2*1024**2})
                r=client.post('/api/import',files={'files':('fictional.fit',b'x')},headers={**headers,'x-kinetta-account':'999999'})
                self.assertEqual(r.status_code,409)

    def test_anonymous_multipart_never_spools(self):
        with TestClient(fixture()) as client, patch('starlette.formparsers.SpooledTemporaryFile',side_effect=AssertionError('anonymous parser ran')):
            for headers in ({},{'authorization':'Bearer fake'}):
                self.assertEqual(client.post('/api/import',files={'files':('fictional.fit',b'x'*100)},headers=headers).status_code,401)

    def test_expired_revoked_suspended_and_temporary_sessions_cannot_bypass(self):
        with db.connect() as c:token=auth.new_session(c,self.uid,'fictional expired')
        headers={'authorization':'Bearer '+token,'content-type':'application/json'}
        with TestClient(fixture()) as client:
            for sql in ("UPDATE sessions SET last_seen=now()-interval '181 days' WHERE user_id=%s",
                        "UPDATE sessions SET last_seen=now() WHERE user_id=%s; UPDATE users SET suspended_at=now() WHERE id=%s",
                        "UPDATE users SET suspended_at=NULL,password_change_expires=now()+interval '1 day' WHERE id=%s",
                        "UPDATE users SET password_change_expires=NULL WHERE id=%s; DELETE FROM sessions WHERE user_id=%s"):
                try:
                    with db.connect() as c:
                        for statement in sql.split(';'):c.execute(statement,(self.uid,))
                    self.assertEqual(client.post('/api/bytes',content=b'x'*(B.ANONYMOUS_BYTES+1),headers=headers).status_code,413)
                finally:
                    with db.connect() as c:
                        c.execute('UPDATE users SET suspended_at=NULL,password_change_expires=NULL WHERE id=%s',(self.uid,))
            with db.connect() as c:
                c.execute('UPDATE sessions SET last_seen=now() WHERE user_id=%s',(self.uid,))
                type(self).token=auth.new_session(c,self.uid,'fictional restored')

    def test_webhook_exact_bytes_and_secret_check_remain_route_owned(self):
        text=' { "activityDetails" : [] }\n'
        with TestClient(fixture()) as client, patch.object(B,'signed_in',side_effect=AssertionError('webhook session lookup')):
            self.assertEqual(client.post('/api/garmin/push/fictional',content=text,headers={'content-type':'application/json'}).json(),{'body':text})
            self.assertEqual(client.post('/api/garmin/push/wrong',content=b'x',headers={'content-type':'application/json'}).status_code,404)


class Streams(unittest.IsolatedAsyncioTestCase):
    async def request(self, receive, *, path='/api/json', headers=None, endpoint=None):
        sent=[]
        scope={'type':'http','method':'POST','path':path,'headers':headers if headers is not None else [(b'content-type',b'application/json')],
               'query_string':b'', 'server':('test',80),'client':('test',1),'scheme':'http','http_version':'1.1'}
        async def send(message):sent.append(message)
        if endpoint is None:
            async def endpoint(scope, receive, send):
                await receive()
                await B.JSONResponse({'ok':True})(scope,receive,send)
        await B.BodyLimits(endpoint)(scope,receive,send)
        return next((m['status'] for m in sent if m['type']=='http.response.start'),None)

    async def test_chunked_overflow_before_parser_for_all_json_content_types(self):
        for content in ('application/json','application/problem+json',''):
            chunks=iter([b'x'*B.ANONYMOUS_BYTES,b'x'])
            async def receive():return {'type':'http.request','body':next(chunks),'more_body':True}
            self.assertEqual(await self.request(receive,headers=[(b'content-type',content.encode())]),413)

    async def test_authenticated_chunked_upload_replays_exact_prefix_and_continues(self):
        chunks=[b'a'*B.ANONYMOUS_BYTES,b'b'*100,b'c'*50];received=[];remaining=iter(chunks)
        async def receive():
            part=next(remaining)
            return {'type':'http.request','body':part,'more_body':part!=chunks[-1]}
        async def endpoint(scope,receive,send):
            while True:
                m=await receive();received.append(m['body'])
                if not m['more_body']:break
            await B.JSONResponse({'ok':True})(scope,receive,send)
        with patch.object(B,'signed_in',return_value=True):self.assertEqual(await self.request(receive,endpoint=endpoint),200)
        self.assertEqual(b''.join(received),b''.join(chunks))

    async def test_idle_and_total_deadlines_before_endpoint(self):
        async def idle():await asyncio.sleep(1)
        with patch.object(B,'IDLE_SECONDS',.02):self.assertEqual(await self.request(idle),408)
        async def drip():
            await asyncio.sleep(.005)
            return {'type':'http.request','body':b' ', 'more_body':True}
        with patch.object(B,'BODY_SECONDS',.03):self.assertEqual(await self.request(drip),408)

    async def test_slow_phone_progress_within_budgets(self):
        calls=0
        async def receive():
            nonlocal calls
            await asyncio.sleep(.02);calls+=1
            return {'type':'http.request','body':b' ', 'more_body':calls<4}
        with patch.object(B,'BODY_SECONDS',.2),patch.object(B,'IDLE_SECONDS',.05):
            self.assertEqual(await self.request(receive),200)

    async def test_empty_fragment_flood_bounded(self):
        async def receive():return {'type':'http.request','body':b'', 'more_body':True}
        self.assertEqual(await self.request(receive),413)

    async def test_saturation_cancellation_disconnect_and_recovery(self):
        readers=threading.BoundedSemaphore(2);entered=asyncio.Event();count=0
        async def slow():
            nonlocal count
            count+=1
            if count==2:entered.set()
            await asyncio.sleep(10)
        async def body():return {'type':'http.request','body':b'{}','more_body':False}
        with patch.object(B,'_readers',readers):
            tasks=[asyncio.create_task(self.request(slow)) for _ in range(2)]
            try:
                await asyncio.wait_for(entered.wait(),1)
                self.assertEqual(await self.request(body),503)
            finally:
                for t in tasks:t.cancel()
                await asyncio.gather(*tasks,return_exceptions=True)
            self.assertEqual(await self.request(body),200)
            async def gone():return {'type':'http.disconnect'}
            self.assertIsNone(await self.request(gone))
            self.assertTrue(readers.acquire(False));self.assertTrue(readers.acquire(False));readers.release();readers.release()

    async def test_recovery_keeps_reserved_reader_when_public_readers_full(self):
        public=threading.BoundedSemaphore(1);reserve=threading.BoundedSemaphore(1)
        public.acquire()
        async def receive():return {'type':'http.request','body':b'{}','more_body':False}
        with patch.object(B,'_readers',public),patch.object(B,'_recovery_reader',reserve):
            self.assertEqual(await self.request(receive),503)
            self.assertEqual(await self.request(receive,path='/api/password/reset'),200)
            reserve.acquire()
            self.assertEqual(await self.request(receive,path='/api/password/reset'),503)
            reserve.release()
        public.release()

    async def test_webhook_and_chunk_receivers_keep_original_stream(self):
        paths=['/api/garmin/notify','/api/garmin/push/fictional','/api/ingest/apple','/api/admin/email-events',
               '/api/strava-import/uploads/00000000-0000-0000-0000-000000000000/pieces/0']
        for path in paths:
            async def receive():raise AssertionError('middleware read before route authentication')
            async def endpoint(scope,raw,send):
                self.assertIs(raw,receive)
                await B.JSONResponse({'ok':True})(scope,raw,send)
            self.assertEqual(await self.request(receive,path=path,endpoint=endpoint),200)

    async def test_session_worker_keeps_capacity_after_cancellation(self):
        entered=threading.Event();finish=threading.Event();slots=threading.BoundedSemaphore(1)
        def lookup(token):entered.set();finish.wait(2);return True
        request=Request({'type':'http','headers':[(b'authorization',b'Bearer fictional')]})
        with patch.object(B,'_session_slots',slots),patch.object(B,'session_exists',lookup):
            task=asyncio.create_task(B.signed_in(request))
            while not entered.is_set():await asyncio.sleep(.001)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):await task
            self.assertFalse(slots.acquire(False))
            with self.assertRaises(HTTPException) as error:await B.signed_in(request)
            self.assertEqual(error.exception.status_code,503)
            finish.set()
            for _ in range(100):
                if slots.acquire(False):slots.release();break
                await asyncio.sleep(.005)
            else:self.fail('session slot not returned')

    async def test_session_pool_timeout_is_plain_retry(self):
        with patch.object(B,'session_exists',side_effect=B.PoolTimeout('fictional')):
            async def receive():raise AssertionError('body read while session pool busy')
            self.assertEqual(await self.request(receive,headers=[(b'content-type',b'multipart/form-data'),(b'authorization',b'Bearer fictional')]),503)


if __name__=='__main__':unittest.main()
