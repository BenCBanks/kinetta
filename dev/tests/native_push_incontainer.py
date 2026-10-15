"""Real APNs request/JWT with a generated test key and mocked HTTP (never Apple's servers)."""
import json
import os
import time
from unittest.mock import patch
import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from app import apns, db, notify
from app.auth import new_session, token_hash
key = ec.generate_private_key(ec.SECP256R1())
pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
device = {'token': 'ab' * 32, 'environment': 'production'}
payload = {'title': 'Nice work! Test run saved', 'body': '5.00 km · 30 min', 'url': '/activity/1', 'badge': 1, 'tag': 'activity_ready-1'}
requests = []
def accept(request):
    requests.append(request)
    assert request.url.host == 'api.push.apple.com'
    assert request.headers['apns-topic'] == 'com.kinetta.app'
    assert request.headers['apns-push-type'] == 'alert'
    token = request.headers['authorization'].removeprefix('bearer ')
    claims = jwt.decode(token, key.public_key(), algorithms=['ES256'])
    assert claims['iss'] == 'TESTTEAM01' and abs(claims['iat'] - time.time()) < 60
    data = json.loads(request.content)
    assert data['aps']['alert']['title'] == payload['title'] and data['url'] == '/activity/1'
    return httpx.Response(200)
with patch.dict(os.environ, {'KINETTA_APNS_TEAM_ID': 'TESTTEAM01', 'KINETTA_APNS_KEY_ID': 'TESTKEY001', 'KINETTA_APNS_PRIVATE_KEY': pem}):
    apns._cached = None
    assert apns.deliver(device, payload, httpx.MockTransport(accept))
    assert apns.deliver(device, payload, httpx.MockTransport(lambda r: httpx.Response(410, json={'reason': 'Unregistered'}))) is False
    try:
        apns.deliver(device, payload, httpx.MockTransport(lambda r: httpx.Response(403, json={'reason': 'InvalidProviderToken'})))
        raise AssertionError('Provider rejection must remain visible')
    except RuntimeError as e:
        assert device['token'] not in str(e)
    sandbox = {**device, 'environment': 'sandbox'}
    def accept_sandbox(request):
        assert request.url.host == 'api.sandbox.push.apple.com'
        return httpx.Response(200)
    assert apns.deliver(sandbox, payload, httpx.MockTransport(accept_sandbox))
# Transferring an installation and removing an invalid token must not notify its previous owner.
with db.connect() as c:
    users = c.execute("SELECT id FROM users WHERE login IN ('alex', 'jordan') ORDER BY login").fetchall()
    owner, other = [r['id'] for r in users]
    first = new_session(c, owner, 'zz_test_native_transport')
    second = new_session(c, other, 'zz_test_native_transport')
    c.execute("INSERT INTO native_push_devices (token, environment, user_id, session_hash) VALUES (%s, 'production', %s, %s)", (device['token'], other, token_hash(second)))
    aid = c.execute('SELECT id FROM activities WHERE user_id = %s LIMIT 1', (owner,)).fetchone()['id']
    nid = c.execute("INSERT INTO notifications (user_id, kind, actor_id, activity_id) VALUES (%s, 'activity_ready', %s, %s) RETURNING id", (owner, owner, aid)).fetchone()['id']
assert notify.push(nid, send=lambda d, p: (_ for _ in ()).throw(AssertionError('wrong owner'))) == 0
with db.connect() as c:
    c.execute('UPDATE native_push_devices SET user_id = %s, session_hash = %s WHERE token = %s', (owner, token_hash(first), device['token']))
assert notify.push(nid, send=lambda d, p: False) == 0
with db.connect() as c:
    assert not c.execute('SELECT 1 FROM native_push_devices WHERE token = %s', (device['token'],)).fetchone()
    c.execute('DELETE FROM notifications WHERE id = %s', (nid,))
    c.execute('DELETE FROM sessions WHERE token_hash IN (%s, %s)', (token_hash(first), token_hash(second)))
print('Native APNs: JWT, payload, environment, invalid device, provider errors, account transfer isolation passed')

# The new personal table uses real SQL-login RLS, including read-only permissions.
import secrets
import psycopg
from psycopg import sql
role, password = 'zz_test_native_push_reader', secrets.token_urlsafe(24)
reader_uid = None
other_session = None
try:
    with db.connect() as c:
        reader_uid = c.execute("INSERT INTO users (login,name,sql_role) VALUES ('zz_test_native_push_reader','Push Reader Test',%s) RETURNING id", (role,)).fetchone()['id']
        c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role), sql.Literal(password)))
        c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
        reader_session = new_session(c, reader_uid, 'zz_test_native_rls')
        other_session = new_session(c, owner, 'zz_test_native_rls')
        c.execute("INSERT INTO native_push_devices (token,environment,user_id,session_hash) VALUES (%s,'sandbox',%s,%s),(%s,'sandbox',%s,%s)",
                  ('cd'*32, reader_uid, token_hash(reader_session), 'ef'*32, owner, token_hash(other_session)))
    with psycopg.connect(db._conninfo(role,password)) as reader:
        rows = reader.execute('SELECT user_id FROM native_push_devices').fetchall()
        assert rows == [(reader_uid,)], 'SQL reader must not see another account device'
        try:
            with reader.transaction(): reader.execute('DELETE FROM native_push_devices')
        except psycopg.errors.InsufficientPrivilege: pass
        else: raise AssertionError('SQL reader could revoke device registrations')
finally:
    with db.connect() as c:
        if reader_uid: c.execute('DELETE FROM users WHERE id = %s', (reader_uid,))
        if other_session: c.execute('DELETE FROM sessions WHERE token_hash = %s', (token_hash(other_session),))
        c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
print('Native push SQL reader: per-account RLS and read-only access passed')
