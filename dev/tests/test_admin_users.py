"""Admin user management (#233 A–D) and database-backed sign-in limits; the mail provider is a stand-in."""
import base64, datetime as dt, os, unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth, admin_auth
from app.main import app

PW = 'test account private password'
BASE = 'http://testserver'
MAIL = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.test>',
        'KINETTA_MAIL_REPLY_TO': 'support@example.test', 'KINETTA_PUBLIC_URL': 'https://example.test',
        'KINETTA_MAIL_WEBHOOK_SECRET': 'whsec_' + base64.b64encode(b'fictional-webhook-key').decode()}
# Fields an account page may contain. Anything else (routes, food, weight, messages...) would be a privacy bug.
PAGE = {'id', 'login', 'name', 'email', 'email_confirmed', 'is_admin', 'created', 'status', 'suspended_at', 'suspended_reason',
        'password_change_expires', 'mfa_enabled', 'last_active', 'active_days_30', 'devices', 'connections', 'imports', 'counts', 'reports', 'invited', 'audit'}


def receipt(*a, **k):
    return httpx.Response(200, json={'id': 'fictional'}, request=httpx.Request('POST', 'https://api.resend.com/emails'))


def client():
    c = TestClient(app); c.headers['Origin'] = BASE; return c


class AdminUsers(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tearDownClass()
        with db.connect() as c:
            add = lambda login, admin=False, email=None: c.execute(
                'INSERT INTO users (login, name, pw_hash, is_admin, email, email_verified_at) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id',
                (login, login.replace('zz_test_au_', '').title() + ' Test', auth.hash_pw(PW), admin, email, email and dt.datetime.now(dt.timezone.utc))).fetchone()['id']
            cls.admin, cls.member, cls.plain = add('zz_test_au_admin', True), add('zz_test_au_member', email='zz_au_member@example.test'), add('zz_test_au_plain')
            cls.other = add('zz_test_au_other')
            for uid in (cls.admin, cls.member, cls.plain, cls.other): c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))

    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_au%%'"); c.execute("DELETE FROM auth_attempts")

    def setUp(self):
        with db.connect() as c:
            c.execute('DELETE FROM auth_attempts'); token = admin_auth.issue_session(c, self.admin)
            c.execute('UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE login LIKE %s', ('zz\\_test\\_au%',))
        self.a = client(); self.a.cookies.set(admin_auth.COOKIE, token, path='/api'); self.a.headers['X-Admin-CSRF'] = admin_auth.csrf(token)
        p = patch.dict(os.environ, MAIL); p.start(); self.addCleanup(p.stop)
        self.mail = patch('app.account_email.httpx.post', side_effect=receipt).start(); self.addCleanup(patch.stopall)

    def login(self, who='zz_test_au_member', pw=PW):
        c = client(); r = c.post('/api/login', json={'login': who, 'password': pw}); return c, r

    def test_sign_in_limits_are_in_the_database(self):
        for _ in range(8): self.assertEqual(self.login(pw='wrong')[1].status_code, 401)
        self.assertEqual(self.login()[1].status_code, 429, 'a fresh client from the same place is still limited')
        with db.connect() as c:
            self.assertGreaterEqual(c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE 'fail:%%'").fetchone()['n'], 24)

    def test_search_filters_and_pages(self):
        r = self.a.get('/api/admin/people?q=zz_au_member@example&tests=true').json()
        self.assertEqual([x['login'] for x in r['rows']], ['zz_test_au_member'], 'search by email')
        self.assertEqual(r['total'], 1); self.assertEqual(r['pages'], 1)
        self.assertNotIn('zz_test_au_member', [x['login'] for x in self.a.get('/api/admin/people?q=zz_test_au').json()['rows']], 'test accounts hidden by default')
        admins = self.a.get('/api/admin/people?role=admin&tests=true&q=zz_test_au').json()['rows']
        self.assertEqual([x['login'] for x in admins], ['zz_test_au_admin'])
        self.assertEqual(self.a.get('/api/admin/people?status=bogus').status_code, 422)
        member, _ = self.login(); self.assertEqual(member.get('/api/admin/people').status_code, 403, 'an app login is not a portal session')

    def test_account_page_has_support_information_only(self):
        c, _ = self.login()
        c.post('/api/activities/manual', json={'sport': 'run', 'start': '2026-10-01T08:00:00+00:00', 'duration_s': 600, 'distance_m': 2000, 'name': 'Secret route name'})
        page = self.a.get(f'/api/admin/people/{self.member}').json()
        self.assertEqual(set(page), PAGE)
        self.assertEqual(page['counts']['activities'], 1)
        self.assertNotIn('Secret route name', str(page), 'activity contents never appear')
        self.assertTrue(page['devices']); self.assertNotIn('ip', str(page['devices'][0]).lower().replace('iphone', ''))
        self.assertEqual(self.a.get('/api/admin/people/999999999').status_code, 404)

    def test_sign_out_everywhere_and_reset_email(self):
        c, _ = self.login()
        self.assertEqual(self.a.post(f'/api/admin/people/{self.member}/signout', json={'confirm': 'wrong'}).status_code, 400)
        self.assertEqual(self.a.post(f'/api/admin/people/{self.member}/signout', json={'confirm': 'zz_test_au_member'}).status_code, 200)
        self.assertEqual(c.get('/api/me').status_code, 401)
        self.assertEqual(self.a.post(f'/api/admin/people/{self.member}/reset-email', json={'confirm': 'zz_test_au_member'}).status_code, 200)
        m = self.mail.call_args.kwargs['json']
        self.assertEqual(m['to'], ['zz_au_member@example.test']); self.assertIn('/reset-password/', m['text']); self.assertIn("We're sending you a link", m['text'])
        self.assertEqual(self.a.post(f'/api/admin/people/{self.plain}/reset-email', json={'confirm': 'zz_test_au_plain'}).status_code, 409, 'needs a confirmed email')
        self.assertEqual(self.a.post(f'/api/admin/people/{self.admin}/reset-email', json={'confirm': 'zz_test_au_admin'}).status_code, 409, 'not for administrators')
        with db.connect() as c2:
            actions = [r['action'] for r in c2.execute('SELECT action FROM admin_audit WHERE target = %s', (str(self.member),)).fetchall()]
        self.assertIn('account.sign_out_everywhere', actions); self.assertIn('account.reset_email', actions)

    def test_suspend_and_restore(self):
        member, _ = self.login(); other, _ = self.login('zz_test_au_other')
        aid = member.post('/api/activities/manual', json={'sport': 'run', 'start': '2026-10-03T08:00:00+00:00', 'duration_s': 600, 'distance_m': 2000}).json()['id']
        member.put(f'/api/activities/{aid}/sharing', json={'visibility': 'everyone'})
        self.assertEqual(other.get(f'/api/shared/{aid}').status_code, 200)
        url = f'/api/admin/people/{self.member}/suspend'
        self.assertEqual(self.a.post(url, json={'confirm': 'zz_test_au_member'}).status_code, 400, 'reason required')
        self.assertEqual(self.a.post(f'/api/admin/people/{self.admin}/suspend', json={'confirm': 'zz_test_au_admin', 'reason': 'x'}).status_code, 409)
        self.assertEqual(self.a.post(url, json={'confirm': 'zz_test_au_member', 'reason': 'Reported spam, checking'}).status_code, 200)
        self.assertEqual(member.get('/api/me').status_code, 401, 'sessions ended')
        r = self.login()[1]; self.assertEqual(r.status_code, 403); self.assertIn('suspended', r.json()['detail'])
        self.assertEqual(self.login(pw='wrong')[1].status_code, 401, 'a wrong password never reveals the suspension')
        self.assertEqual(other.get(f'/api/shared/{aid}').status_code, 404)
        self.assertEqual(other.get('/api/people/zz_test_au_member/profile').status_code, 404)
        self.assertNotIn('zz_test_au_member', [p['login'] for p in other.get('/api/people/search?q=zz_test_au_member').json()])
        self.assertIn('suspended', self.mail.call_args.kwargs['json']['subject'])
        self.assertEqual(self.a.get(f'/api/admin/people/{self.member}').json()['status'], 'suspended')
        self.assertEqual(self.a.post(f'/api/admin/people/{self.member}/restore', json={'confirm': 'zz_test_au_member'}).status_code, 200)
        member, r = self.login(); self.assertEqual(r.status_code, 200)
        self.assertEqual(other.get(f'/api/shared/{aid}').status_code, 200)
        self.assertTrue(self.a.get('/api/admin/overview').json()['mfa'] in (True, False))


if __name__ == '__main__': unittest.main()
