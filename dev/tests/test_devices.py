"""Signed-in devices (#232 I) and the welcome steps' inviter suggestion (#232 F5), with fictional zz_test accounts."""
import base64, datetime as dt, os, unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth
from app.main import app

PW = 'test account private password'
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
MAIL = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.test>',
        'KINETTA_MAIL_REPLY_TO': 'support@example.test', 'KINETTA_PUBLIC_URL': 'https://example.test',
        'KINETTA_MAIL_WEBHOOK_SECRET': 'whsec_' + base64.b64encode(b'fictional-webhook-key').decode()}
WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'


def client(agent=MAC):
    c = TestClient(app); c.headers['Origin'] = 'http://testserver'; c.headers['User-Agent'] = agent; return c


class Devices(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tearDownClass()
        with db.connect() as c:
            add = lambda login: c.execute('INSERT INTO users (login, name, pw_hash) VALUES (%s, %s, %s) RETURNING id',
                                          (login, login[11:].title() + ' Test', auth.hash_pw(PW))).fetchone()['id']
            cls.me, cls.other, cls.host = add('zz_test_dv_me'), add('zz_test_dv_other'), add('zz_test_dv_host')
            for uid in (cls.me, cls.other, cls.host): c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))

    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_dv%%'"); c.execute('DELETE FROM auth_attempts')

    def login(self, who='zz_test_dv_me', agent=MAC):
        c = client(agent); self.assertEqual(c.post('/api/login', json={'login': who, 'password': PW}).status_code, 200); return c

    def test_list_and_sign_out(self):
        with db.connect() as c: c.execute('DELETE FROM sessions WHERE user_id IN (%s, %s)', (self.me, self.other))
        mac, phone, three, theirs = self.login(), self.login(agent=IPHONE), self.login(), self.login('zz_test_dv_other')
        rows = mac.get('/api/account/devices').json()
        self.assertEqual(len(rows), 3, 'only this account’s logins')
        self.assertEqual(sum(r['this'] for r in rows), 1)
        self.assertEqual({r['device'] for r in rows}, {'Mac · Safari', 'iPhone · Safari'})
        self.assertEqual(set(rows[0]), {'id', 'device', 'signed_in', 'last_used', 'this'}, 'no tokens, hashes or addresses')
        with db.connect() as c:
            hashes = {r['token_hash'] for r in c.execute('SELECT token_hash FROM sessions WHERE user_id = %s', (self.me,)).fetchall()}
        self.assertFalse(any(r['id'] in hashes for r in rows), 'the id is a short slice, never the stored hash')
        this = next(r for r in rows if r['this'])
        self.assertEqual(mac.post('/api/account/devices/signout', json={'id': this['id']}).status_code, 400, 'this device uses Log out')
        their = theirs.get('/api/account/devices').json()[0]
        self.assertEqual(mac.post('/api/account/devices/signout', json={'id': their['id']}).status_code, 404, 'cannot sign out someone else')
        self.assertEqual(theirs.get('/api/me').status_code, 200)
        iphone = next(r for r in rows if r['device'].startswith('iPhone'))
        self.assertEqual(mac.post('/api/account/devices/signout', json={'id': iphone['id']}).status_code, 200)
        self.assertEqual(phone.get('/api/me').status_code, 401, 'that phone is signed out')
        self.assertEqual(three.get('/api/me').status_code, 200)
        r = mac.post('/api/account/devices/signout-others', json={}).json()
        self.assertEqual(r['signed_out'], 1)
        self.assertEqual(three.get('/api/me').status_code, 401)
        self.assertEqual(mac.get('/api/me').status_code, 200, 'this device stays signed in')
        self.assertEqual(theirs.get('/api/me').status_code, 200, 'other accounts are untouched')
        self.assertEqual(client().get('/api/account/devices').status_code, 401)

    def test_inviter_suggestion(self):
        me = self.login()
        self.assertIsNone(me.get('/api/account/inviter').json()['inviter'], 'no invite, no suggestion')
        with db.connect() as c:
            c.execute("INSERT INTO invites (token_hash, created_by, used_by, used_at, expires) VALUES ('zz_test_dv_invite', %s, %s, now(), now() + interval '1 day')", (self.host, self.me))
        who = me.get('/api/account/inviter').json()['inviter']
        self.assertEqual(who['login'], 'zz_test_dv_host'); self.assertEqual(set(who), {'login', 'name', 'photo'})
        self.assertIsNone(self.login('zz_test_dv_other').get('/api/account/inviter').json()['inviter'], 'only the person invited')
        with db.connect() as c: c.execute('INSERT INTO blocks (user_id, blocked) VALUES (%s, %s)', (self.host, self.me))
        self.assertIsNone(me.get('/api/account/inviter').json()['inviter'], 'hidden after a block')
        with db.connect() as c:
            c.execute('DELETE FROM blocks WHERE user_id = %s', (self.host,))
            c.execute("INSERT INTO friendships (requester, addressee, status, accepted) VALUES (%s, %s, 'accepted', now())", (self.me, self.host))
        self.assertIsNone(me.get('/api/account/inviter').json()['inviter'], 'nothing once you are friends')

    def test_new_device_email(self):
        p = patch.dict(os.environ, MAIL); p.start(); self.addCleanup(p.stop)
        sent = []
        def receipt(*a, **k):
            sent.append(k['json']); return httpx.Response(200, json={'id': 'fictional'}, request=httpx.Request('POST', 'https://api.resend.com/emails'))
        q = patch('app.account_email.httpx.post', side_effect=receipt); q.start(); self.addCleanup(q.stop)
        with db.connect() as c:
            c.execute('DELETE FROM known_devices WHERE user_id = %s', (self.other,))
            c.execute("UPDATE users SET email = 'zz_test_dv_other@example.test', email_verified_at = now() WHERE id = %s", (self.other,))
        self.login('zz_test_dv_other'); self.assertEqual(sent, [], 'the first device is only remembered')
        self.login('zz_test_dv_other'); self.assertEqual(sent, [], 'same device again')
        self.login('zz_test_dv_other', agent=IPHONE)
        self.assertEqual(len(sent), 1); self.assertEqual(sent[0]['to'], ['zz_test_dv_other@example.test'])
        self.assertIn('iPhone · Safari', sent[0]['text']); self.assertNotIn(PW, sent[0]['text'])
        c2 = self.login('zz_test_dv_other')
        self.assertEqual(c2.put('/api/account/signin-email', json={'on': False}).json(), {'on': False})
        self.login('zz_test_dv_other', agent=WINDOWS); self.assertEqual(len(sent), 1, 'switched off')
        c2.put('/api/account/signin-email', json={'on': True})
        with db.connect() as c: c.execute('UPDATE users SET email_verified_at = NULL WHERE id = %s', (self.other,))
        self.login('zz_test_dv_other', agent='Mozilla/5.0 (Linux; Android 15) Chrome/130.0 Mobile Safari/537.36')
        self.assertEqual(len(sent), 1, 'never to an unconfirmed email')
        self.assertEqual(client().get('/api/account/signin-email').status_code, 401)


if __name__ == '__main__': unittest.main()
