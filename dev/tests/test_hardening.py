"""Fixes from the 2026-10-12 server review: faked visitor addresses, gear renames, Apple Health upload limits."""
import json, sys, urllib.error, urllib.request
from kc import BASE, PW, Client, person

n = 0
def ck(cond, what):
    global n
    if not cond: print('FAIL', what); sys.exit(1)
    n += 1

def raw(path, body, headers):
    r = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method='POST',
                               headers={'Content-Type': 'application/json', 'Origin': BASE, **headers})
    try:
        with urllib.request.urlopen(r) as resp: return resp.status
    except urllib.error.HTTPError as e: return e.code

# password guessing: a made-up CF-Connecting-IP or X-Forwarded-For on each try no longer looks like a new visitor
g = person('zz_test_guess')
codes = [raw('/api/login', {'login': 'zz_test_guess', 'password': f'wrong guess {i}'},
             {'CF-Connecting-IP': f'203.0.113.{i}', 'X-Forwarded-For': f'198.51.100.{i}'}) for i in range(9)]
ck(codes[:8] == [401] * 8 or all(c in (400, 401) for c in codes[:8]), f'wrong passwords refused {codes}')
ck(codes[8] == 429, f'the 9th guess is braked even with a new fake address each time {codes}')

# renaming gear to a name you already use: a clear message, not a server error
s, a = g.post('/api/gear', {'kind': 'shoe', 'name': 'Test shoe A'}); s, b = g.post('/api/gear', {'kind': 'shoe', 'name': 'Test shoe B'})
ck(g.post('/api/gear', {'kind': 'shoe', 'name': 'Test shoe A'})[0] == 409, 'adding a duplicate')
s, r = g.put(f"/api/gear/{b['id']}", {'kind': 'shoe', 'name': 'Test shoe A'})
ck(s == 409 and 'already' in r['detail'], f'renaming to a duplicate {s} {r}')
ck(g.put(f"/api/gear/{b['id']}", {'kind': 'shoe', 'name': 'Test shoe B', 'notes': 'same name is fine'})[0] == 200, 'saving with its own name')

# Apple Health uploads: limited in number, still fine for a normal one
tok = g.post('/api/connections/apple')[1]['token']
ck(raw('/api/ingest/apple', {'data': {'workouts': [{}] * 501}}, {'Authorization': 'Bearer ' + tok}) == 413, '501 workouts -> 413')
ck(raw('/api/ingest/apple', {'data': {'workouts': [], 'metrics': []}}, {'Authorization': 'Bearer ' + tok}) == 200, 'an empty upload is fine')
ck(raw('/api/ingest/apple', {'data': {}}, {'Authorization': 'Bearer nope'}) == 401, 'wrong token')
g.post('/api/account/delete', {'password': PW})
print(f'hardening: {n} checks passed')
