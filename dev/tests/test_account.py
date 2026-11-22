"""Your data (api_mydata.py): download my data (browser and the iPhone app's one-time link) and delete my account."""
import io, sys, urllib.error, urllib.request, zipfile
from kc import BASE, PW, Client, login, person

n = 0
def ck(cond, what):
    global n
    if not cond: print('FAIL', what); sys.exit(1)
    n += 1

def raw(c, path, headers=None):      # a download: bytes, not JSON
    try:
        with c.op.open(urllib.request.Request(BASE + path, headers=headers or {})) as r: return r.status, r.read(), r.headers
    except urllib.error.HTTPError as e: return e.code, e.read(), e.headers

def session_token(c):
    return next(cookie.value for handler in c.op.handlers for cookie in getattr(handler, 'cookiejar', ())
                if cookie.name == 'fit_session')

a, b = person('zz_test_export'), person('zz_test_other2')
a.post('/api/food/entries', [{'day': '2026-10-01', 'meal': 'lunch', 'name': 'Test soup', 'amount': 1, 'unit': 'serving', 'kcal': 300}])
s, body, h = raw(a, '/api/account/export')
ck(s == 200 and 'zip' in h.get('Content-Type', '') and 'zz_test_export' in h.get('Content-Disposition', ''), f'export {s}')
z = zipfile.ZipFile(io.BytesIO(body)); names = z.namelist()
ck(any('food' in x for x in names), f'food in the zip {names}')
ck(b'Test soup' in b''.join(z.read(x) for x in names if x.endswith('.csv') or x.endswith('.json')), 'my food is in it')
ck(raw(a, '/api/account/export')[0] == 429, 'not again within 5 minutes')
ck(raw(Client(), '/api/account/export')[0] == 401, 'not logged in -> 401')

# the iPhone app: a one-time link, for whoever asked, opened without a login (Safari)
s, r = b.post('/api/account/export-link'); path = r['path']
ck(s == 200 and path.startswith('/api/account/export/') and len(path) > 50, f'link {r}')
s, body, h = raw(Client(), path)
ck(s == 200 and 'zz_test_other2' in h.get('Content-Disposition', '') and b'Test soup' not in body, 'link downloads their own data only')
ck(raw(Client(), path)[0] == 404, 'the link works once')
ck(raw(Client(), '/api/account/export/not-a-real-key')[0] == 404, 'made-up link -> 404')
ck(Client().post('/api/account/export-link')[0] == 401, 'asking for a link needs a login')

# delete my account: the password, then everything goes and the login stops working
ck(a.post('/api/account/delete', {'password': 'wrong one'})[0] == 400, 'wrong password -> 400')
ck(a.get('/api/me')[0] == 200, 'still there after a wrong password')
old_token = session_token(a)
a_again = login('zz_test_export')
aid = a.post('/api/activities/manual', {'sport': 'run', 'start': '2026-10-02T07:00', 'duration_s': 600, 'distance_m': 1000})[1]['id']
ck(a.put(f'/api/activities/{aid}/sharing', {'visibility': 'everyone'})[0] == 200, 'activity is shareable before deletion')
ck(b.get(f'/api/shared/{aid}')[0] == 200, 'another account can read the shared activity before deletion')
friend_code = a.get('/api/friends/link')[1]['url'].rsplit('/', 1)[1]
ck(raw(Client(), f'/api/friend-links/{friend_code}')[0] == 200, 'invite token works before deletion')
s, r = a.post('/api/account/delete', {'password': PW})
ck(s == 200, f'deleted {s} {r}')
ck(a.get('/api/me')[0] == 401, 'logged out')
ck(a_again.get('/api/me')[0] == 401, 'second session is revoked')
ck(raw(Client(), '/api/me', {'Authorization': f'Bearer {old_token}'})[0] == 401, 'old bearer session token is revoked')
ck(raw(Client(), f'/api/friend-links/{friend_code}')[0] == 404, 'invite token is revoked')
ck(b.get(f'/api/shared/{aid}')[0] == 404, 'shared activity is no longer readable')
ck(Client().post('/api/login', {'login': 'zz_test_export', 'password': PW})[0] in (400, 401), 'cannot log in again')
ck(b.get('/api/me')[0] == 200, 'other people untouched')
b.post('/api/account/delete', {'password': PW})
print(f'your data: {n} checks passed')
