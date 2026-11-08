"""Email on accounts and Forgot password (#232 A–C) against a disposable database; the mail provider is a stand-in."""
import base64, os, re, unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth, account_email
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
        with db.connect() as c:
            ids = [r['id'] for r in c.execute("SELECT id FROM users WHERE login LIKE 'zz\\_test\\_mail%%'").fetchall()]
            if not ids: return
            for table in ('sessions', 'admin_sessions', 'admin_challenges', 'account_password_changes', 'account_tokens'):
                c.execute(f'DELETE FROM {table} WHERE user_id = ANY(%s)', (ids,))
            c.execute('''UPDATE users SET pw_hash=%s, email=NULL, email_verified_at=NULL,
                         needs_email_confirm=false, signup_guard=false, signup_confirmed_at=NULL,
                         password_change_expires=NULL WHERE id=ANY(%s)''', (auth.hash_pw(PW), ids))

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

    def pending_account(self, email, login='zz_test_mail_a'):
        with db.connect() as c:
            user = c.execute('SELECT id, name, login::text AS login FROM users WHERE login=%s', (login,)).fetchone()
            c.execute('UPDATE users SET email=%s, email_verified_at=NULL, needs_email_confirm=true WHERE id=%s', (email, user['id']))
            account_email._token(c, user['id'], 'verify_email', account_email.VERIFY_HOURS * 60, email)
        return user

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
        self.assertEqual(b.put('/api/account/email',json={'email':'zz_a@example.test','password':PW}).status_code,409,'duplicate rejected before sending another confirmation')
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

    def test_pending_email_can_reset_password_and_confirms_address(self):
        a = self.client(); user = self.pending_account('zz_pending@example.test')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        unknown = anon.post('/api/password/forgot', json={'login': 'nobody@example.test'}).json()
        response = anon.post('/api/password/forgot', json={'login': 'zz_pending@example.test'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['message'], unknown['message'], 'unknown and pending accounts get the same response')
        self.assertEqual(self.messages()[-1]['to'], ['zz_pending@example.test'])
        token = self.link('reset-password')
        self.assertEqual(anon.get('/api/password/reset/' + token).json()['login'], user['login'])
        new = 'a brand new pending reset sentence'
        response = anon.post('/api/password/reset', json={'token': token, 'password': new})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['email_confirmed'])
        with db.connect() as c:
            row = c.execute('SELECT email::text AS email, email_verified_at, needs_email_confirm FROM users WHERE id=%s', (user['id'],)).fetchone()
            self.assertEqual(row['email'], 'zz_pending@example.test')
            self.assertIsNotNone(row['email_verified_at'])
            self.assertFalse(row['needs_email_confirm'])
            self.assertIsNone(c.execute("SELECT 1 FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL", (user['id'],)).fetchone(), 'the old confirmation link is invalidated')
        self.assertEqual(a.get('/api/me').status_code, 401, 'reset signs out the signup session')
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_pending@example.test', 'password': new}).status_code, 200)

    def test_login_offer_is_only_returned_after_valid_pending_password(self):
        self.pending_account('zz_login_pending@example.test')
        self.pending_account('zz_unflagged_pending@example.test', login='zz_test_mail_b')
        with db.connect() as c:
            c.execute("UPDATE users SET needs_email_confirm=false WHERE login='zz_test_mail_b'")
        anon = TestClient(app); anon.headers['Origin'] = BASE
        for login in ('zz_login_pending@example.test', 'zz_test_mail_a'):
            response = anon.post('/api/login', json={'login': login, 'password': PW})
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['detail']['code'], 'email_waiting_for_confirmation')
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_unflagged_pending@example.test', 'password': PW}).status_code, 401,
                         'email sign-in stays unavailable until verified when this is not a new-signup confirmation')
        wrong = anon.post('/api/login', json={'login': 'zz_login_pending@example.test', 'password': 'wrong password'})
        unknown = anon.post('/api/login', json={'login': 'nobody@example.test', 'password': 'wrong password'})
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json(), 'wrong password does not reveal a pending account')

    def test_resend_confirmation_is_generic_and_rate_limited(self):
        self.pending_account('zz_resend@example.test')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        unknown = anon.post('/api/account/email/resend', json={'login': 'nobody@example.test'})
        messages = []
        for _ in range(5):
            response = anon.post('/api/account/email/resend', json={'login': 'zz_resend@example.test'})
            self.assertEqual(response.status_code, 200)
            messages.append(response.json()['message'])
        self.assertEqual(len(set(messages + [unknown.json()['message']])), 1, 'unknown and pending accounts get the same response')
        self.assertEqual(self.mail.call_count, 3, 'resend remains limited to three per account per hour')
        self.assertEqual(self.messages()[-1]['to'], ['zz_resend@example.test'])

    def test_signup_conflict_for_pending_email_offers_recovery_code(self):
        user = self.pending_account('zz_signup_pending@example.test')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        payload = {'name': 'Fictional Casey', 'email': 'zz_signup_pending@example.test',
                   'password': 'fictional long passphrase', 'age_ok': True, 'share_default': 'everyone'}
        with patch.dict(os.environ, {'KINETTA_SIGNUP': 'open'}):
            response = anon.post('/api/signup', json=payload)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['detail']['code'], 'email_waiting_for_confirmation')
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM users WHERE email=%s', ('zz_signup_pending@example.test',)).fetchone()['n'], 1)
            self.assertIsNone(c.execute("SELECT id FROM users WHERE login='fictional' AND id<>%s", (user['id'],)).fetchone())

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
