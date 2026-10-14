"""Future paywall contracts with real isolated Postgres and HTTP, no provider calls."""
import os
import secrets
import subprocess
import sys
import time
import json
import urllib.request
import urllib.error
import http.cookiejar
from unittest.mock import patch
import psycopg
from psycopg import sql
from app import ai_access, api_dishes, coach, db, food_photo, main
from app.auth import hash_pw

role = 'zz_test_ai_access_reader'
password = secrets.token_urlsafe(24)
ids = []
server = None
class Response:
    def __init__(self, code, raw): self.status_code, self.text = code, raw.decode()
    def json(self): return json.loads(self.text)
class Client:
    def __init__(self): self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def req(self, method, path, body=None):
        request = urllib.request.Request('http://127.0.0.1:18001'+path, data=json.dumps(body).encode() if body is not None else None, method=method,
            headers={'Content-Type':'application/json', 'Origin':'http://127.0.0.1:18001'})
        try:
            with self.op.open(request,timeout=10) as r: return Response(r.status,r.read())
        except urllib.error.HTTPError as e: return Response(e.code,e.read())
    def get(self,path): return self.req('GET',path)
    def post(self,path,json): return self.req('POST',path,json)
    def put(self,path,json): return self.req('PUT',path,json)
    def patch(self,path,json): return self.req('PATCH',path,json)
try:
    with db.connect() as c:
        for login in ('zz_test_ai_access_a', 'zz_test_ai_access_b'):
            uid = c.execute('INSERT INTO users (login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id', (login, 'Access Test', hash_pw(password))).fetchone()['id']
            ids.append(uid)
            c.execute('INSERT INTO profile (user_id,ai_ok) VALUES (%s,true)', (uid,))
        c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role), sql.Literal(password)))
        c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
        c.execute('UPDATE users SET sql_role = %s WHERE id = %s', (role, ids[0]))
        c.execute("INSERT INTO ai_entitlements (user_id,feature) VALUES (%s,'food')", (ids[0],))
        c.execute("INSERT INTO ai_entitlements (user_id,feature,expires_at) VALUES (%s,'coach',now()-interval '1 minute')", (ids[0],))
        c.execute("INSERT INTO ai_entitlements (user_id,feature) VALUES (%s,'coach')", (ids[1],))
    with patch.dict(os.environ, {'KINETTA_AI_ACCESS_MODE':'open'}):
        assert ai_access.has(ids[1], 'food'), 'existing access remains open by default'
    with patch.dict(os.environ, {'KINETTA_AI_ACCESS_MODE':'entitled'}):
        assert ai_access.has(ids[0], 'food') and not ai_access.has(ids[0], 'coach'), 'feature split and expiry'
        assert not ai_access.has(ids[1], 'food') and ai_access.has(ids[1], 'coach'), 'account isolation'
        assert not coach.allowed(ids[0]), 'consent alone does not grant product access'
        assert coach.allowed(ids[0], 'food'), 'food access is independent of coach access'
        with db.connect() as c:
            with patch.object(db, 'connect', side_effect=AssertionError('Nested access connection')):
                assert coach.allowed(ids[1], connection=c), 'existing transaction checks access and consent without borrowing another connection'
        with db.connect() as c:
            c.execute("UPDATE ai_entitlements SET enabled=false WHERE user_id=%s AND feature='food'", (ids[0],))
        assert not ai_access.has(ids[0], 'food'), 'revocation takes effect immediately'
        # Real local HTTP with actual authentication, no extra test dependency.
        child = """from app import food_photo,coach,food_coach,main
import uvicorn
def unexpected(*args,**kwargs): raise AssertionError('Unentitled provider work')
food_photo.ask=unexpected
coach._gemini=unexpected
coach._claude=unexpected
food_coach._ask=unexpected
uvicorn.run(main.app,host='127.0.0.1',port=18001,log_level='critical',access_log=False)
"""
        server = subprocess.Popen([sys.executable,'-c',child],env={**os.environ,'KINETTA_AI_ACCESS_MODE':'entitled'},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        client=Client()
        for attempt in range(100):
            try:
                if client.get('/api/health').status_code==200: break
            except OSError: time.sleep(.05)
        else: raise AssertionError('Isolated entitlement HTTP process did not start')
        assert client.post('/api/login',{'login':'zz_test_ai_access_a','password':password}).status_code==200
        def denied(path, body):
            r = client.post(path, json=body)
            assert r.status_code == 402, (path, r.status_code, r.text)
        with patch.object(food_photo, 'ask', side_effect=AssertionError('Unentitled model call')):
            denied('/api/food/photo', {'note':'Two eggs'})
            denied('/api/food/label', {'image':'not-an-image'})
            denied('/api/activities/999999/coach', {})
            denied('/api/coach/week', {})
            denied('/api/food/review', {})
        for path in ('/api/food/day', '/api/dishes', '/api/plans/options', '/api/plans/current'):
            r = client.get(path)
            assert r.status_code == 200, (path, r.status_code, r.text)
        me = client.get('/api/me').json()
        assert not me['ai_access']['food']['entitled'] and not me['ai_access']['coach']['entitled']
        # Profile input cannot grant product access.
        client.put('/api/profile', json={'ai_access':{'food':{'entitled':True}}, 'ai_ok':True})
        assert not client.get('/api/me').json()['ai_access']['food']['entitled']
        created = client.post('/api/dishes', json={'name':'Manual meal'})
        assert created.status_code == 200, created.text
        did = created.json()['id']
        assert client.patch(f'/api/dishes/{did}',json={'known_kcal':400,'known_protein_g':30}).status_code==200
        logged = client.post(f'/api/dishes/{did}/portion',json={'day':'2026-10-14','meal':'dinner','count':1})
        assert logged.status_code == 200, logged.text
        assert client.get('/api/food/day?d=2026-10-14').json()['entries'], 'manual meal logging survives loss of AI access'
    with psycopg.connect(db._conninfo(role,password)) as reader:
        rows=reader.execute('SELECT user_id,feature FROM ai_entitlements').fetchall()
        assert len(rows)==2 and all(r[0]==ids[0] for r in rows), 'SQL reader sees only own access records'
        try:
            with reader.transaction():
                reader.execute("UPDATE ai_entitlements SET enabled=true WHERE feature='food'")
        except psycopg.errors.InsufficientPrivilege: pass
        else: raise AssertionError('SQL reader could grant access')
    with patch.dict(os.environ, {'KINETTA_AI_ACCESS_MODE':'invalid'}):
        assert not ai_access.has(ids[0],'food'), 'unknown mode fails closed'
    for uid, feature in [(True,'food'),(0,'food'),(ids[0],'arbitrary')]:
        try: ai_access.has(uid,feature)
        except ValueError: pass
        else: raise AssertionError('invalid account or feature accepted')
    print('AI access: default-open, expiry/revocation, per-feature/account isolation, HTTP denial before providers, manual tools, consent separation and read-only RLS passed')
finally:
    if server is not None:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill(); server.wait()
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id = ANY(%s)', (ids,))
        c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
