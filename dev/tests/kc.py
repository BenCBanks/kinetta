"""Tiny API client for the throwaway test server (one cookie jar per person). Made-up accounts only.
The tests run after dev/demo/seed.py and dev/screenshots/stage.py: "alex" is the admin and makes the zz_test people."""
import http.cookiejar, json, os, urllib.request, urllib.error, sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from portal_fixture import admin_headers, is_admin_path

BASE = os.environ.get('KINETTA_URL', 'http://localhost:8798')
ALEX = ('alex', 'blue kettle morning run')          # dev/demo/seed.py
PW = 'green teapot on the hill'                     # every zz_test person


class Client:
    def __init__(self):
        self.login_name = None
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def req(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else (b'{}' if method in ('POST', 'PATCH', 'PUT', 'DELETE') else None)
        headers={'Content-Type': 'application/json', 'Origin': BASE}
        if self.login_name == 'alex' and is_admin_path(path): headers.update(admin_headers(BASE))
        r = urllib.request.Request(BASE + path, data=data, method=method, headers=headers)
        try:
            with self.op.open(r) as resp: return resp.status, json.loads(resp.read() or b'null')
        except urllib.error.HTTPError as e:
            raw = e.read()
            try: return e.code, json.loads(raw)
            except Exception: return e.code, raw.decode(errors='replace')

    def get(self, p): return self.req('GET', p)
    def post(self, p, b=None): return self.req('POST', p, b)
    def patch(self, p, b=None): return self.req('PATCH', p, b)
    def put(self, p, b=None): return self.req('PUT', p, b)
    def delete(self, p): return self.req('DELETE', p)


def login(name, pw=PW):
    c = Client(); s, r = c.post('/api/login', {'login': name, 'password': pw})
    assert s == 200, f'login {name}: {s} {r}'
    c.login_name = name
    return c


def person(name, full_name=None):
    """A zz_test person, made by alex (the admin) the first time; logged in."""
    s, r = login(*ALEX).post('/api/admin/people', {'login': name, 'name': full_name or name.split('_')[-1].title() + ' Test', 'password': PW})
    assert s in (200, 409), f'make {name}: {s} {r}'
    return login(name)
