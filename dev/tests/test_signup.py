"""Open signup with an email, the account cap and new-account restrictions (#232 D); the mail provider is a stand-in."""
import base64, os, re, threading, unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth, signup, admin_auth
from app.main import app

PW = 'test account private password'
BASE = 'http://testserver'
MAIL = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.test>',
        'KINETTA_MAIL_REPLY_TO': 'support@example.test', 'KINETTA_PUBLIC_URL': 'https://example.test',
        'KINETTA_MAIL_WEBHOOK_SECRET': 'whsec_' + base64.b64encode(b'fictional-webhook-key').decode()}
# In these tests zz_test signups must count toward the cap, so "test accounts" means an impossible prefix here.
NO_TEST_PREFIX = 'no such account prefix%'


def receipt(*a, **k):
    return httpx.Response(200, json={'id': 'fictional'}, request=httpx.Request('POST', 'https://api.resend.com/emails'))


def client():
    c = TestClient(app); c.headers['Origin'] = BASE; return c


def form(login, **extra):
    return {'name': 'Signup Test', 'login': login, 'email': login + '@example.test', 'password': PW, 'age_ok': True, 'tz': 'UTC', **extra}


class Signup(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_su%%'"); c.execute('DELETE FROM auth_attempts')

    def setUp(self):
        self.tearDownClass()
        self.mail = patch('app.account_email.httpx.post', side_effect=receipt).start(); self.addCleanup(patch.stopall)
        patch.object(signup, 'TEST_ACCOUNTS', NO_TEST_PREFIX).start()

    def env(self, **kw):
        # start from known settings, whatever the server running the tests was started with
        p = patch.dict(os.environ, {**MAIL, 'KINETTA_SIGNUP': 'invite', 'KINETTA_MAX_ACCOUNTS': '', **{k: str(v) for k, v in kw.items()}}); p.start(); self.addCleanup(p.stop)

    def real_accounts(self):
        with db.connect() as c: return signup.accounts(c)

    def test_invite_only_by_default(self):
        self.env()
        self.assertEqual(client().get('/api/signup').json(), {'open': False, 'full': False})
        self.assertEqual(client().post('/api/signup', json=form('zz_test_su_closed')).status_code, 404)
        self.env(KINETTA_SIGNUP='open', KINETTA_RESEND_KEY='')
        self.assertFalse(client().get('/api/signup').json()['open'], 'open signup needs email to confirm addresses')

    def test_open_signup_confirm_and_restrictions(self):
        self.env(KINETTA_SIGNUP='open')
        new = client()
        self.assertEqual(new.post('/api/signup', json=form('zz_test_su_new', age_ok=False)).status_code, 400, '16+ required')
        r = new.post('/api/signup', json=form('zz_test_su_new')); self.assertEqual(r.status_code, 200, r.text)
        me = new.get('/api/me').json()
        self.assertTrue(me['needs_email_confirm']); self.assertEqual(me['pending_email'], 'zz_test_su_new@example.test'); self.assertIsNone(me['email'])
        self.assertEqual(self.mail.call_args.kwargs['json']['to'], ['zz_test_su_new@example.test'])
        # a member who would otherwise see "everyone" activities
        old = client(); self.assertEqual(old.post('/api/signup', json=form('zz_test_su_old')).status_code, 200)
        with db.connect() as c: c.execute("UPDATE users SET needs_email_confirm = false WHERE login = 'zz_test_su_old'")
        aid = new.post('/api/activities/manual', json={'sport': 'run', 'start': '2026-10-01T08:00:00+00:00', 'duration_s': 600, 'distance_m': 2000}).json()['id']
        new.put(f'/api/activities/{aid}/sharing', json={'visibility': 'everyone'})
        self.assertEqual(old.get(f'/api/shared/{aid}').status_code, 404, 'unconfirmed activity hidden')
        self.assertEqual(old.get('/api/people/zz_test_su_new/profile').status_code, 404, 'unconfirmed profile hidden')
        self.assertNotIn('zz_test_su_new', [p['login'] for p in old.get('/api/people/search?q=zz_test_su').json()])
        self.assertEqual(new.get('/api/people/zz_test_su_new/profile').status_code, 200, 'own profile still works')
        self.assertEqual(new.post('/api/friends', json={'login': 'zz_test_su_old'}).status_code, 403)
        self.assertEqual(old.post('/api/friends', json={'login': 'zz_test_su_new'}).status_code, 404)
        oid = old.post('/api/activities/manual', json={'sport': 'run', 'start': '2026-10-02T08:00:00+00:00', 'duration_s': 600, 'distance_m': 2000}).json()['id']
        old.put(f'/api/activities/{oid}/sharing', json={'visibility': 'everyone'})
        self.assertEqual(new.post(f'/api/activities/{oid}/comments', json={'text': 'hello'}).status_code, 403)
        self.assertEqual(new.post(f'/api/activities/{oid}/reaction', json={'kind': 'cheer'}).status_code, 403)
        # opening the link lifts every restriction
        token = re.search(r'/confirm-email/([\w-]+)', self.mail.call_args_list[0].kwargs['json']['text']).group(1)
        self.assertEqual(client().post('/api/account/email/confirm', json={'token': token}).status_code, 200)
        self.assertFalse(new.get('/api/me').json()['needs_email_confirm'])
        self.assertEqual(old.get(f'/api/shared/{aid}').status_code, 200)
        self.assertEqual(new.post('/api/friends', json={'login': 'zz_test_su_old'}).status_code, 200)
        self.assertEqual(new.post(f'/api/activities/{oid}/comments', json={'text': 'hello'}).status_code, 200)

    def test_cap_waitlist_and_invites(self):
        n = self.real_accounts()
        self.env(KINETTA_SIGNUP='open', KINETTA_MAX_ACCOUNTS=n + 1)
        self.assertTrue(client().get('/api/signup').json()['open'])
        self.assertFalse(client().get('/api/beta').json()['open'], 'no waitlist while there is room')
        self.assertEqual(client().post('/api/signup', json=form('zz_test_su_last')).status_code, 200)
        self.assertEqual(client().get('/api/signup').json(), {'open': False, 'full': True})
        r = client().post('/api/signup', json=form('zz_test_su_late')); self.assertEqual(r.status_code, 409); self.assertEqual(r.json()['detail']['code'], 'full')
        self.assertTrue(client().get('/api/beta').json()['open'], 'the waitlist takes over when full')
        with db.connect() as c:      # an administrator's invite still works above the cap
            import secrets
            token = secrets.token_urlsafe(24)
            c.execute("INSERT INTO invites (token_hash, note, expires) VALUES (%s, 'zz', now() + interval '1 day')", (auth.token_hash(token),))
        self.assertEqual(client().post('/api/join', json={'name': 'Invited', 'login': 'zz_test_su_invited', 'password': PW, 'token': token}).status_code, 200)
        with db.connect() as c: c.execute("DELETE FROM users WHERE login = 'zz_test_su_last'")
        self.assertTrue(client().get('/api/signup').json()['open'] is False, 'the invited account took the freed place')
        with db.connect() as c: c.execute("DELETE FROM users WHERE login = 'zz_test_su_invited'")
        self.assertTrue(client().get('/api/signup').json()['open'], 'removing an account reopens signup')

    def test_last_place_race(self):
        self.env(KINETTA_SIGNUP='open', KINETTA_MAX_ACCOUNTS=self.real_accounts() + 1)
        codes, go = [], threading.Barrier(2)
        def attempt(i):
            c = client(); go.wait(); codes.append(c.post('/api/signup', json=form(f'zz_test_su_race{i}'), headers={'CF-Connecting-IP': f'198.51.100.{i}'}).status_code)
        ts = [threading.Thread(target=attempt, args=(i,)) for i in (1, 2)]
        [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual(sorted(codes), [200, 409], 'exactly one person gets the last place')

    def test_bots_and_limits(self):
        self.env(KINETTA_SIGNUP='open')
        self.assertEqual(client().post('/api/signup', json=form('zz_test_su_bot', website='https://spam.example')).json(), {'ok': True})
        with db.connect() as c: self.assertIsNone(c.execute("SELECT 1 FROM users WHERE login = 'zz_test_su_bot'").fetchone(), 'honeypot makes nothing')
        codes = [client().post('/api/signup', json=form(f'zz_test_su_rate{i}')).status_code for i in range(6)]
        self.assertEqual(codes[-1], 429, 'at most five signups an hour from one address')

    def test_admin_overview_shows_cap(self):
        self.env(KINETTA_SIGNUP='open', KINETTA_MAX_ACCOUNTS=100)
        with db.connect() as c:
            uid = c.execute("INSERT INTO users (login, name, pw_hash, is_admin) VALUES ('zz_test_su_admin', 'Admin', %s, true) RETURNING id", (auth.hash_pw(PW),)).fetchone()['id']
            token = admin_auth.issue_session(c, uid)
        a = client(); a.cookies.set(admin_auth.COOKIE, token, path='/api'); a.headers['X-Admin-CSRF'] = admin_auth.csrf(token)
        s = a.get('/api/admin/overview').json()['signup']
        self.assertEqual((s['mode'], s['cap']), ('open', 100)); self.assertEqual(s['accounts'], self.real_accounts())


if __name__ == '__main__': unittest.main()
