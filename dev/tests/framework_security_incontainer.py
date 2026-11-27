"""Bounded framework security regressions; no external requests, provider calls or private data."""
import asyncio
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


if __name__ == '__main__':
    unittest.main()
