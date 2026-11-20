"""Restore the photo-free browser-validation account after screenshot-only staging."""
import http.cookiejar
import json
import os
import urllib.request

B = os.environ.get('KINETTA_URL', 'http://localhost:8798').rstrip('/')
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(B + path, data=data, method=method,
                                 headers={'Origin': B, 'Content-Type': 'application/json'})
    with op.open(req) as response:
        return json.loads(response.read() or b'null')


request('POST', '/api/login', {'login': 'nia', 'password': 'blue kettle morning run'})
request('DELETE', '/api/me/photo')
request('PUT', '/api/account', {'login': 'alex', 'name': 'Alex Rivera', 'bio': 'Runs, rides and good food.'})
me = request('GET', '/api/me')
if me.get('login') != 'alex' or me.get('name') != 'Alex Rivera' or me.get('photo'):
    raise SystemExit('Screenshot browser-test owner was not restored to the photo-free Alex fixture.')
print('Restored the photo-free Alex browser-test owner after screenshot capture.')
