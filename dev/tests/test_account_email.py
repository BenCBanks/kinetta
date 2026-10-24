"""Email on accounts and Forgot password (#232 A–C) against a disposable database; the mail provider is a stand-in."""
import base64, os, re, unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth
from app.main import app

PW = 'test account private password'
BASE = 'http://testserver'
ENV = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.test>',
       'KINETTA_MAIL_REPLY_TO': 'support@example.test', 'KINETTA_PUBLIC_URL': 'https://example.test',
       'KINETTA_MAIL_WEBHOOK_SECRET': 'whsec_' + base64.b64encode(b'fictional-webhook-key').decode()}


def receipt(*a, **k):
    return httpx.Response(200, json={'id': 'fictional'}, request=httpx.Request('POST', 'https://api.resend.com/emails'))


class AccountEmail(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tearDownClass()
        with db.connect() as c:
            for login in ('zz_test_mail_a', 'zz_test_mail_b'):
                uid = c.execute('INSERT INTO users (login, name, pw_hash) VALUES (%s, %s, %s) RETURNING id', (login, 'Mail Test', auth.hash_pw(PW))).fetchone()['id']
                c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))

    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_mail%%'")
            c.execute('DELETE FROM auth_attempts')

    def setUp(self):
        with db.connect() as c: c.execute('DELETE FROM auth_attempts')
        self.addCleanup(self.restore)
        self.env = patch.dict(os.environ, ENV); self.env.start(); self.addCleanup(self.env.stop)
        self.sent = patch('app.account_email.httpx.post', side_effect=receipt); self.mail = self.sent.start(); self.addCleanup(self.sent.stop)

    def restore(self):      # each test starts from the same known passwords, even after a failure
        with db.connect() as c: c.execute("UPDATE users SET pw_hash = %s WHERE login LIKE 'zz\\_test\\_mail%%'", (auth.hash_pw(PW),))

    def client(self, login='zz_test_mail_a', password=PW):
        c = TestClient(app); c.headers['Origin'] = BASE
        r = c.post('/api/login', json={'login': login, 'password': password}); self.assertEqual(r.status_code, 200, r.text)
        return c

    def messages(self):
        return [k.kwargs['json'] for k in self.mail.call_args_list]

    def link(self, kind):
        text = self.messages()[-1]['text']
        return re.search(rf'https://example\.test/{kind}/([\w-]+)', text).group(1)

    def confirm(self, c, email):
        self.assertEqual(c.put('/api/account/email', json={'email': email, 'password': PW}).status_code, 200)
        return TestClient(app).post('/api/account/email/confirm', json={'token': self.link('confirm-email')}, headers={'Origin': BASE})

    def test_add_confirm_and_log_in_with_email(self):
        a = self.client()
        self.assertEqual(a.put('/api/account/email', json={'email': 'zz_a@example.test', 'password': 'wrong'}).status_code, 400)
        self.assertEqual(a.put('/api/account/email', json={'email': 'not an email', 'password': PW}).status_code, 400)
        r = a.put('/api/account/email', json={'email': 'zz_a@example.test', 'password': PW}); self.assertEqual(r.json()['pending'], 'zz_a@example.test')
        m = self.messages()[-1]
        self.assertEqual(m['to'], ['zz_a@example.test']); self.assertEqual(m['from'], 'Kinetta <hello@example.test>')
        self.assertNotIn(PW, m['text'])
        self.assertIsNone(a.get('/api/me').json()['email'], 'not used before the link is opened')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_a@example.test', 'password': PW}).status_code, 401)
        token = self.link('confirm-email')
        r = anon.post('/api/account/email/confirm', json={'token': token}); self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(anon.post('/api/account/email/confirm', json={'token': token}).status_code, 404, 'single use')
        me = a.get('/api/me').json(); self.assertEqual(me['email'], 'zz_a@example.test'); self.assertTrue(me['email_confirmed'])
        r = anon.post('/api/login', json={'login': 'ZZ_A@example.test', 'password': PW, 'app': True})
        self.assertEqual(r.status_code, 200); self.assertTrue(r.json()['token'])
        # someone else can't take a confirmed address; the change notice goes to the old one
        b = self.client('zz_test_mail_b')
        self.assertEqual(self.confirm(b, 'zz_a@example.test').status_code, 409)
        self.mail.reset_mock()
        self.assertEqual(self.confirm(a, 'zz_a2@example.test').status_code, 200)
        self.assertIn(['zz_a@example.test'], [x['to'] for x in self.messages()], 'old address told about the change')
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_a@example.test', 'password': PW}).status_code, 401)

    def test_forgot_and_reset(self):
        a = self.client(); self.confirm(a, 'zz_reset@example.test'); other = self.client()
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        for who in ('nobody_here', 'nobody@example.test', 'zz_test_mail_b'):     # unknown, or no confirmed email
            r = anon.post('/api/password/forgot', json={'login': who}); self.assertEqual(r.status_code, 200)
        self.assertEqual(self.mail.call_count, 0)
        same = anon.post('/api/password/forgot', json={'login': 'zz_test_mail_a'}).json()
        self.assertEqual(same['message'], r.json()['message'], 'the answer never says whether an account matched')
        self.assertEqual(self.messages()[-1]['to'], ['zz_reset@example.test'])
        anon.post('/api/password/forgot', json={'login': 'zz_reset@example.test'})
        token = self.link('reset-password')
        self.assertEqual(anon.get('/api/password/reset/' + token).json()['login'], 'zz_test_mail_a')
        self.assertEqual(anon.post('/api/password/reset', json={'token': token, 'password': 'password123'}).status_code, 400)
        new = 'a brand new reset sentence'
        self.assertEqual(anon.post('/api/password/reset', json={'token': token, 'password': new}).status_code, 200)
        self.assertEqual(anon.post('/api/password/reset', json={'token': token, 'password': new + '!'}).status_code, 404, 'single use')
        self.assertEqual(other.get('/api/me').status_code, 401, 'every old session signed out')
        self.assertIn('was just changed', self.messages()[-1]['text'])
        self.client('zz_test_mail_a', new)

    def test_limits_and_unconfigured_mail(self):
        a = self.client(); self.confirm(a, 'zz_limit@example.test')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        for _ in range(5): anon.post('/api/password/forgot', json={'login': 'zz_test_mail_a'})
        self.assertEqual(self.mail.call_count, 3, 'at most three reset links an hour per account')
        with patch.dict(os.environ, {'KINETTA_RESEND_KEY': ''}):
            self.assertEqual(a.put('/api/account/email', json={'email': 'zz_x@example.test', 'password': PW}).status_code, 503)
            self.assertFalse(a.get('/api/me').json()['mail_ready'])

    def test_password_change_notice_and_privacy(self):
        a = self.client(); self.confirm(a, 'zz_notice@example.test'); self.mail.reset_mock()
        self.assertEqual(a.post('/api/account/password', json={'current': PW, 'new': 'another fine sentence'}).status_code, 200)
        self.assertEqual(self.messages()[-1]['to'], ['zz_notice@example.test'])
        with db.connect() as c:
            self.assertFalse(c.execute("SELECT has_column_privilege('fit_readers', 'users', 'email', 'SELECT') AS ok").fetchone()['ok'])
            for t in ('account_tokens', 'auth_attempts'):
                self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers', %s, 'SELECT') AS ok", (t,)).fetchone()['ok'])
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname = %s', (t,)).fetchone()['relrowsecurity'])
            self.assertFalse(c.execute("SELECT count(*) AS n FROM account_tokens WHERE token_hash LIKE '%%-%%'").fetchone()['n'], 'only hashes stored')


if __name__ == '__main__': unittest.main()
