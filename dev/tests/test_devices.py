"""Signed-in devices (#232 I) and the welcome steps' inviter suggestion (#232 F5), with fictional zz_test accounts."""
import unittest
from fastapi.testclient import TestClient
from app import db, auth
from app.main import app

PW = 'test account private password'
IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
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


if __name__ == '__main__': unittest.main()
