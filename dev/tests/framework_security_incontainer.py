"""Bounded framework security regressions; no external requests, provider calls or private data."""
import asyncio
import datetime as dt
import uuid
import httpx
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from starlette.applications import Starlette
from starlette.datastructures import UploadFile, URL
from starlette.responses import FileResponse
from starlette.routing import Route
from app.main import app
from app import auth, db, api_activities


class FrameworkSecurity(unittest.TestCase):
    def test_malformed_host_cannot_hide_api_path_from_write_guards(self):
        # /api/me is GET-only: 405 proves that a permitted write reached routing,
        # without mutating anything or requiring a fictional authenticated account.
        with TestClient(app) as client:
            for method in ('POST', 'PUT', 'PATCH', 'DELETE'):
                for host in ('testserver/public?ignored=', 'testserver#ignored',
                             'testserver?ignored=', 'testserver/public'):
                    with self.subTest(method=method, host=host):
                        r = client.request(method, '/api/me', content='{}', headers={
                            'Host': host, 'Origin': 'https://elsewhere.invalid',
                            'Content-Type': 'application/json'})
                        self.assertEqual(r.status_code, 403, r.text)
                        self.assertEqual(r.json()['detail'], 'Bad origin')
                        r = client.request(method, '/api/me', content='not json', headers={
                            'Host': host, 'Content-Type': 'text/plain'})
                        self.assertEqual(r.status_code, 415, r.text)
                        self.assertEqual(r.json()['detail'], 'JSON only')
            for host in ('testserver', 'testserver:80', '[::1]:8000'):
                for origin in ('http://' + host, 'capacitor://localhost'):
                    with self.subTest(host=host, origin=origin):
                        r = client.post('/api/me', json={}, headers={'Host': host, 'Origin': origin})
                        self.assertEqual(r.status_code, 405, r.text)
            self.assertEqual(client.get('/api/me').status_code, 401, 'read authentication remains required')

    def test_url_path_uses_asgi_path_when_host_contains_url_delimiters(self):
        for host in ('example.test/ignored?x=', 'example.test?x=', 'example.test#fragment'):
            scope = {'type': 'http', 'scheme': 'http', 'server': ('testserver', 80),
                     'path': '/api/me', 'query_string': b'x=1', 'headers': [(b'host', host.encode())]}
            self.assertEqual(URL(scope=scope).path, '/api/me')

    def test_multipart_rollover_runs_off_event_loop(self):
        async def exercise():
            import starlette.datastructures as data
            with tempfile.SpooledTemporaryFile(max_size=8) as raw:
                upload = UploadFile(file=raw, size=0)
                with patch.object(data, 'run_in_threadpool', wraps=data.run_in_threadpool) as offload:
                    await upload.write(b'abcd')
                    self.assertEqual(offload.call_count, 0, 'small in-memory write stays cheap')
                    await upload.write(b'efghijkl')
                    self.assertEqual(offload.call_count, 1, 'the rollover write itself must be offloaded')
                    self.assertTrue(raw._rolled)
                    await upload.write(b'mnop')
                    self.assertEqual(offload.call_count, 2)
                    self.assertEqual(upload.size, 16)
                await upload.seek(0)
                self.assertEqual(await upload.read(), b'abcdefghijklmnop')
        asyncio.run(exercise())

    def test_file_ranges_remain_correct_after_security_upgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'fictional.txt'
            path.write_bytes(b'abcdefghijklmnopqrstuvwxyz')
            async def file(request):
                return FileResponse(path)
            with TestClient(Starlette(routes=[Route('/file', file)])) as client:
                r = client.get('/file', headers={'Range': 'bytes=2-5'})
                self.assertEqual(r.status_code, 206)
                self.assertEqual(r.content, b'cdef')
                self.assertEqual(r.headers['content-range'], 'bytes 2-5/26')
                r = client.get('/file', headers={'Range': 'bytes=0-1,8-9'})
                self.assertEqual(r.status_code, 206)
                self.assertIn(b'Content-Range: bytes 0-1/26', r.content)
                self.assertIn(b'Content-Range: bytes 8-9/26', r.content)
                self.assertEqual(client.get('/file', headers={'Range': 'bytes=100-101'}).status_code, 416)
                self.assertEqual(client.get('/file', headers={'Range': 'invalid'}).status_code, 400)
                self.assertEqual(client.head('/file').content, b'')


class AppCompatibility(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Real sessions/current_user and committed fictional rows; no auth override.
        with db.connect() as c:
            cls.uid = c.execute("INSERT INTO users(login,name) VALUES(%s,'Fictional Framework Tester') RETURNING id",
                                ('zz_test_framework_' + uuid.uuid4().hex[:12],)).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (cls.uid,))
            cls.token = auth.new_session(c, cls.uid, 'fictional framework regression')
        cls.client = TestClient(app, base_url='https://testserver')

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=%s', (cls.uid,))

    def headers(self, native=False):
        return {'Authorization': 'Bearer ' + self.token,
                'Origin': 'capacitor://localhost' if native else 'https://testserver',
                'X-Kinetta-Account': str(self.uid)}

    def security_headers(self, response):
        expected = {'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
                    'referrer-policy': 'same-origin', 'cross-origin-opener-policy': 'same-origin',
                    'strict-transport-security': 'max-age=31536000'}
        for name, value in expected.items():
            self.assertEqual(response.headers[name], value)
        self.assertIn("frame-ancestors 'none'", response.headers['content-security-policy'])
        self.assertIn('geolocation=(self)', response.headers['permissions-policy'])

    def test_authenticated_web_and_iphone_writes_and_middleware_order(self):
        # Origin/type guards precede auth and model validation, then CORS wraps
        # both permitted writes and rejected responses for the native client.
        self.assertEqual(self.client.put('/api/profile', content='broken', headers={
            'Origin': 'https://elsewhere.invalid', 'Content-Type': 'text/plain'}).status_code, 403)
        self.assertEqual(self.client.put('/api/profile', content='broken', headers={
            'Origin': 'https://testserver', 'Content-Type': 'text/plain'}).status_code, 415)
        self.assertEqual(self.client.put('/api/profile', json={}).status_code, 401)
        preflight = self.client.options('/api/profile', headers={
            'Origin': 'capacitor://localhost', 'Access-Control-Request-Method': 'PUT',
            'Access-Control-Request-Headers': 'Authorization,Content-Type,X-Kinetta-Account'})
        self.assertEqual(preflight.status_code, 200)
        self.assertEqual(preflight.headers['access-control-allow-origin'], 'capacitor://localhost')
        self.assertNotIn('access-control-allow-credentials', preflight.headers)
        for native in (False, True):
            # Web authenticates via the actual cookie, iPhone via Bearer.
            headers = self.headers(native)
            if not native:
                del headers['Authorization']
                self.client.cookies.set(auth.COOKIE, self.token)
            r = self.client.put('/api/profile', json={'units': 'metric'}, headers=headers)
            self.assertEqual(r.status_code, 200, r.text)
            self.security_headers(r)
            self.assertEqual(r.headers['cache-control'], 'no-store')
            self.assertTrue(r.headers['x-request-id'])
            if native:
                self.assertEqual(r.headers['access-control-allow-origin'], 'capacitor://localhost')
            with db.connect() as c:
                self.assertEqual(c.execute('SELECT units FROM profile WHERE user_id=%s', (self.uid,)).fetchone()['units'], 'metric')
            r = self.client.post('/api/activities/manual', json={'sport': 'walk', 'name': 'Fictional framework walk',
                'start': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=2, seconds=int(native))).isoformat(),
                'duration_s': 600, 'distance_m': 800}, headers=headers)
            self.assertEqual(r.status_code, 200, r.text)
            aid = r.json()['id']
            r = self.client.patch(f'/api/activities/{aid}', json={'name': 'Fictional checked walk'}, headers=headers)
            self.assertEqual(r.status_code, 200, r.text)
            with db.connect() as c:
                self.assertEqual(c.execute('SELECT name FROM activities WHERE id=%s AND user_id=%s', (aid, self.uid)).fetchone()['name'], 'Fictional checked walk')
            self.assertEqual(self.client.request('DELETE', f'/api/activities/{aid}', json={}, headers=headers).status_code, 200)
            self.client.cookies.clear()
        r = self.client.put('/api/profile', json={}, headers={**self.headers(True), 'X-Kinetta-Account': str(self.uid+1)})
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json()['detail']['code'], 'account_changed')

    def test_validation_json_contract_for_shared_web_and_iphone_client(self):
        for native in (False, True):
            for body, location in [({'max_hr': 'FictionalPrivateSentinel'}, ['body', 'max_hr']),
                                   ({'setup_hidden': 'FictionalPrivateSentinel'}, ['body', 'setup_hidden'])]:
                r = self.client.put('/api/profile', json=body, headers=self.headers(native))
                self.assertEqual(r.status_code, 422, r.text)
                detail = r.json()['detail']
                self.assertIsInstance(detail, list)
                self.assertEqual(len(detail), 1)
                self.assertEqual(set(detail[0]), {'type', 'loc', 'msg'})
                self.assertEqual(detail[0]['loc'], location)
                self.assertTrue(isinstance(detail[0]['msg'], str) and detail[0]['msg'])
                self.assertNotIn('FictionalPrivateSentinel', r.text)
                self.security_headers(r)
                if native:
                    self.assertEqual(r.headers['access-control-allow-origin'], 'capacitor://localhost')
            r = self.client.put('/api/profile', content='{"max_hr":NaN}', headers={
                **self.headers(native), 'Content-Type': 'application/json'})
            self.assertEqual(r.status_code, 422)
            self.assertEqual(set(r.json()['detail'][0]), {'type', 'loc', 'msg'})
            r = self.client.put('/api/profile', content='{', headers={
                **self.headers(native), 'Content-Type': 'application/json'})
            self.assertEqual(r.status_code, 422)
            self.assertEqual(r.json()['detail'][0]['type'], 'json_invalid')

    def test_real_app_rejects_oversized_buffered_and_streamed_multipart(self):
        # Lower only the endpoint's byte threshold: exercise real parser/spool,
        # auth, streaming reads, failed-job journal and partial-file cleanup.
        cap = 2 * 1024 * 1024
        prefix = b'--fictional-boundary\r\nContent-Disposition: form-data; name="files"; filename="fictional.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n'
        suffix = b'\r\n--fictional-boundary--\r\n'
        content = prefix + b'x' * (cap + 1) + suffix
        headers = {**self.headers(True), 'Content-Type': 'multipart/form-data; boundary=fictional-boundary'}
        with tempfile.TemporaryDirectory() as directory, patch.object(api_activities, 'DATA', directory), \
                patch.object(api_activities, 'UPLOAD_MAX', cap), patch.object(api_activities.importer, 'submit') as submit:
            for streamed in (False, True):
                async def request():
                    async def chunks():
                        for offset in range(0, len(content), 65536):
                            yield content[offset:offset+65536]
                            await asyncio.sleep(0)
                    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://testserver') as client:
                        response = await client.post('/api/import', headers=headers, content=chunks() if streamed else content)
                        self.assertEqual('content-length' not in response.request.headers, streamed)
                        return response
                r = asyncio.run(request())
                self.assertEqual(r.status_code, 413, r.text)
                self.assertIn('This upload is too large', r.json()['detail'])
                self.security_headers(r)
                self.assertEqual(list(Path(directory).rglob('fictional.gpx')), [])
            submit.assert_not_called()
        with db.connect() as c:
            jobs = c.execute('SELECT status,finished,messages FROM imports WHERE user_id=%s', (self.uid,)).fetchall()
        self.assertEqual(len(jobs), 2)
        for job in jobs:
            self.assertEqual(job['status'], 'failed')
            self.assertIsNotNone(job['finished'])
            self.assertIn('This upload is too large', str(job['messages']))

    def test_static_mount_cache_conditional_ranges_and_security_headers(self):
        r = self.client.get('/static/app.js?v=fictional-security-check', headers={'Accept-Encoding': 'gzip'})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers['content-encoding'], 'gzip')
        self.assertEqual(r.headers['cache-control'], 'public, max-age=31536000, immutable')
        self.assertIn('javascript', r.headers['content-type'])
        self.security_headers(r)
        for validator, value in [('If-None-Match', r.headers['etag']), ('If-Modified-Since', r.headers['last-modified'])]:
            cached = self.client.get('/static/app.js?v=fictional-security-check', headers={validator: value})
            self.assertEqual(cached.status_code, 304)
            self.assertEqual(cached.content, b'')
            self.security_headers(cached)
        plain = self.client.get('/static/app.js', headers={'Accept-Encoding': 'identity'})
        self.assertEqual(plain.status_code, 200)
        self.assertNotIn('immutable', plain.headers.get('cache-control', ''))
        partial = self.client.get('/static/app.js', headers={'Range': 'bytes=0-15', 'Accept-Encoding': 'identity'})
        self.assertEqual(partial.status_code, 206)
        self.assertEqual(partial.content, plain.content[:16])
        self.security_headers(partial)
        worker = self.client.get('/sw.js')
        self.assertEqual(worker.headers['cache-control'], 'no-cache')
        self.security_headers(worker)


if __name__ == '__main__':
    unittest.main()
