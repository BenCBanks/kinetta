"""Email on accounts and Forgot password (#232 A–C) against a disposable database; the mail provider is a stand-in."""
import base64, datetime, hmac, json, os, re, time, unittest
from unittest.mock import Mock, patch
import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import db, auth, account_email, admin_mail, api_account, signup, community_terms
from app.main import app

PW = 'test account private password'
BASE = 'http://testserver'
ENV = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.com>',
       'KINETTA_MAIL_REPLY_TO': 'support@example.com', 'KINETTA_PUBLIC_URL': 'https://example.test',
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

    def test_reset_greeting_without_selected_first_name(self):
        from fastapi import BackgroundTasks
        for by_admin in (False, True):
            for first in (None, '', '  ', 'Riley'):
                background = BackgroundTasks()
                person = {'id': 1, 'login': 'zz_test_mail_a', 'email': 'fictional@example.com'}
                if first is not None:
                    person['first_name'] = first
                with patch.object(account_email, '_token', return_value='fictional-reset-token'):
                    account_email.send_reset(background, None, person, by_admin=by_admin)
                text = background.tasks[0].args[2]
                self.assertTrue(text.startswith('Hi Riley,\n\n' if first == 'Riley' else 'Hello,\n\n'))
                self.assertNotIn('Hi ,', text)

    def test_deletion_deadlines_and_email_dates_use_utc(self):
        cases = [
            ('2026-11-15T20:30:00-05:00', '2026-11-30T01:30:00+00:00'),
            ('2026-11-16T01:30:00+14:00', '2026-11-29T11:30:00+00:00'),
        ]
        user = {'id': 1, 'first_name': 'Fictional', 'email': 'fictional@example.com'}
        for created_text, expected_text in cases:
            with self.subTest(created=created_text):
                created = datetime.datetime.fromisoformat(created_text)
                deadline = account_email.unconfirmed_account_delete_at(created)
                self.assertEqual(deadline, datetime.datetime.fromisoformat(expected_text))
                self.assertEqual(deadline.tzinfo, datetime.timezone.utc)
                self.assertEqual(deadline - created, datetime.timedelta(days=14))
                date = datetime.datetime.fromisoformat(expected_text).strftime('%d %B %Y (UTC)')
                _, subject, text, _ = account_email._confirmation_reminder_message(Mock(), user, 'second', deadline)
                self.assertEqual(subject, f'Confirm your Kinetta email by {date}')
                self.assertIn(f'deleted on {date}.', text)
        old = datetime.datetime(2026, 10, 1, tzinfo=datetime.timezone.utc)
        for sent_text, expected_text in [
            ('2026-11-25T20:30:00-05:00', '2026-11-30T01:30:00+00:00'),
            ('2026-11-26T01:30:00+14:00', '2026-11-29T11:30:00+00:00'),
        ]:
            with self.subTest(sent=sent_text):
                sent = datetime.datetime.fromisoformat(sent_text)
                deadline = account_email._unconfirmed_delete_on(old, sent)
                self.assertEqual(deadline, datetime.datetime.fromisoformat(expected_text))
                self.assertEqual(deadline.tzinfo, datetime.timezone.utc)
                self.assertEqual(deadline - sent, datetime.timedelta(days=4))
                date = datetime.datetime.fromisoformat(expected_text).strftime('%d %B %Y (UTC)')
                _, subject, text, _ = account_email._confirmation_reminder_message(Mock(), user, 'final', deadline)
                self.assertEqual(subject, f'Your Kinetta account will be deleted on {date}')
                self.assertIn(f'Open this link before {date}', text)

    def test_shared_plain_text_email_formatter(self):
        created = datetime.datetime(2030, 1, 2, 18, 30, tzinfo=datetime.timezone.utc)
        self.assertEqual(account_email.UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS, 14)
        self.assertEqual(account_email.unconfirmed_account_delete_at(created), created + datetime.timedelta(days=14))
        text = admin_mail.format_plain_text_email(
            "Hi Fictional Member,\n\nSomeone signed in to your Kinetta account (zz_fixture) from a new device. "
            "Reply to this email and we'll help.")
        self.assertTrue(text.startswith('Hi Fictional Member,\n\nSomeone signed in to your Kinetta account (@zz_fixture)'))
        self.assertIn('Hi Fictional Member', text)
        self.assertIn('For help, email feedback@kinetta.app.', text)
        self.assertEqual(text.count("You're getting this because this address was used for a Kinetta account."), 1)
        admin_reply = admin_mail.format_plain_text_email('A fictional response.', greeting='Hello,')
        self.assertTrue(admin_reply.startswith('Hello,\n\nA fictional response.'))
        self.assertIn('\n\nThe Kinetta team\n\n', admin_reply)
        self.assertEqual(admin_mail.format_plain_text_email(admin_reply, greeting='Hello,'), admin_reply)

    def test_unrelated_subject_words_do_not_replace_message_body(self):
        self.assertTrue(account_email.send('fictional@example.com', 'Back up your Kinetta account',
                                           'Your backup is ready in Settings.'))
        message = self.messages()[-1]
        self.assertEqual(message['subject'], 'Back up your Kinetta account')
        self.assertTrue(message['text'].startswith('Your backup is ready in Settings.'))

    def restore(self):      # each test starts from the same known passwords, even after a failure
        with db.connect() as c:
            ids = [r['id'] for r in c.execute("SELECT id FROM users WHERE login LIKE 'zz\\_test\\_mail%%'").fetchall()]
            if not ids: return
            for table in ('sessions', 'admin_sessions', 'admin_challenges', 'account_password_changes', 'account_tokens'):
                c.execute(f'DELETE FROM {table} WHERE user_id = ANY(%s)', (ids,))
            c.execute('DELETE FROM signup_join_intents WHERE user_id = ANY(%s)', (ids,))
            c.execute('UPDATE profile SET friend_link=NULL WHERE user_id = ANY(%s)', (ids,))
            c.execute('''UPDATE users SET pw_hash=%s, email=NULL, email_verified_at=NULL,
                         needs_email_confirm=false, signup_guard=false, signup_confirmed_at=NULL,
                         password_change_expires=NULL, email_confirmation_reminder_count=0,
                         email_confirmation_reminder_at=NULL,unconfirmed_final_warning_at=NULL,
                         unconfirmed_final_warning_sent_at=NULL WHERE id=ANY(%s)''', (auth.hash_pw(PW), ids))

    def client(self, login='zz_test_mail_a', password=PW):
        c = TestClient(app); c.headers['Origin'] = BASE
        r = c.post('/api/login', json={'login': login, 'password': password}); self.assertEqual(r.status_code, 200, r.text)
        return c

    def messages(self):
        return [k.kwargs['json'] for k in self.mail.call_args_list]

    def link(self, kind):
        text = self.messages()[-1]['text']
        route = r'confirm-email#' if kind == 'confirm-email' else re.escape(kind) + r'#'
        return re.search(rf'https://example\.test/{route}([\w-]+)', text).group(1)

    def confirm(self, c, email):
        self.assertEqual(c.put('/api/account/email', json={'email': email, 'password': PW}).status_code, 200)
        return TestClient(app).post('/api/account/email/confirm', json={'token': self.link('confirm-email')}, headers={'Origin': BASE})

    def pending_account(self, email, login='zz_test_mail_a'):
        with db.connect() as c:
            user = c.execute('SELECT id, name, login::text AS login FROM users WHERE login=%s', (login,)).fetchone()
            c.execute('UPDATE users SET email=%s, email_verified_at=NULL, needs_email_confirm=true WHERE id=%s', (email, user['id']))
            account_email._token(c, user['id'], 'verify_email', account_email.VERIFY_HOURS * 60, email)
        return user

    def temporary_pending_account(self, login, email):
        with db.connect() as c:
            uid = c.execute('INSERT INTO users (login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',
                            (login, 'Temporary Mail Fixture', auth.hash_pw(PW))).fetchone()['id']
            c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))
            c.execute('UPDATE users SET email=%s,needs_email_confirm=true WHERE id=%s', (email, uid))
        return {'id': uid, 'login': login}

    def delete_temporary_account(self, login):
        with db.connect() as c: c.execute('DELETE FROM users WHERE login=%s', (login,))

    def test_add_confirm_and_log_in_with_email(self):
        a = self.client()
        self.assertEqual(a.put('/api/account/email', json={'email': 'zz_a@example.com', 'password': 'wrong'}).status_code, 400)
        self.assertEqual(a.put('/api/account/email', json={'email': 'not an email', 'password': PW}).status_code, 400)
        r = a.put('/api/account/email', json={'email': 'zz_a@example.com', 'password': PW}); self.assertEqual(r.json()['pending'], 'zz_a@example.com')
        m = self.messages()[-1]
        self.assertEqual(m['to'], ['zz_a@example.com']); self.assertEqual(m['from'], 'Kinetta <hello@example.com>')
        self.assertNotIn(PW, m['text'])
        self.assertTrue(m['text'].startswith('Hi Mail,\n\nOpen this link to confirm zz_a@example.com as your email for Kinetta:'))
        self.assertIn("You're getting this because this address was used for a Kinetta account.", m['text'])
        self.assertIsNone(a.get('/api/me').json()['email'], 'not used before the link is opened')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_a@example.com', 'password': PW}).status_code, 401)
        token = self.link('confirm-email')
        r = anon.post('/api/account/email/confirm', json={'token': token}); self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(anon.post('/api/account/email/confirm', json={'token': token}).status_code, 404, 'single use')
        me = a.get('/api/me').json(); self.assertEqual(me['email'], 'zz_a@example.com'); self.assertTrue(me['email_confirmed'])
        r = anon.post('/api/login', json={'login': 'ZZ_A@example.com', 'password': PW, 'app': True})
        self.assertEqual(r.status_code, 200); self.assertTrue(r.json()['token'])
        # someone else can't take a confirmed address; the change notice goes to the old one
        b = self.client('zz_test_mail_b')
        self.assertEqual(b.put('/api/account/email',json={'email':'zz_a@example.com','password':PW}).status_code,409,'duplicate rejected before sending another confirmation')
        self.mail.reset_mock()
        self.assertEqual(self.confirm(a, 'zz_a2@example.com').status_code, 200)
        self.assertIn(['zz_a@example.com'], [x['to'] for x in self.messages()], 'old address told about the change')
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_a@example.com', 'password': PW}).status_code, 401)

    def test_forgot_and_reset(self):
        a = self.client(); self.confirm(a, 'zz_reset@example.com'); other = self.client()
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        for who in ('nobody_here', 'nobody@example.com', 'zz_test_mail_b'):     # unknown, or no confirmed email
            r = anon.post('/api/password/forgot', json={'login': who}); self.assertEqual(r.status_code, 200)
        self.assertEqual(self.mail.call_count, 0)
        same = anon.post('/api/password/forgot', json={'login': 'zz_test_mail_a'}).json()
        self.assertEqual(same['message'], r.json()['message'], 'the answer never says whether an account matched')
        self.assertEqual(self.messages()[-1]['to'], ['zz_reset@example.com'])
        page = anon.get('/reset-password')
        self.assertEqual(page.status_code, 200)
        self.assertIn('<title>', page.text)
        self.assertIn('/reset-password#', self.messages()[-1]['text'])
        self.assertNotIn('/reset-password/', self.messages()[-1]['text'])
        anon.post('/api/password/forgot', json={'login': 'zz_reset@example.com'})
        token = self.link('reset-password')
        legacy = anon.get('/api/password/reset/' + token)
        self.assertEqual(legacy.status_code, 200)
        self.assertEqual(legacy.json()['login'], 'zz_test_mail_a')
        self.assertEqual(anon.post('/api/password/reset/check', json={'token': token}).json()['login'], 'zz_test_mail_a')
        self.assertEqual(anon.post('/api/password/reset', json={'token': token, 'password': 'password123'}).status_code, 400)
        new = 'a brand new reset sentence'
        self.assertEqual(anon.post('/api/password/reset', json={'token': token, 'password': new}).status_code, 200)
        self.assertEqual(anon.post('/api/password/reset', json={'token': token, 'password': new + '!'}).status_code, 404, 'single use')
        self.assertEqual(other.get('/api/me').status_code, 401, 'every old session signed out')
        self.assertIn('was just changed', self.messages()[-1]['text'])
        self.client('zz_test_mail_a', new)

    def test_pending_email_can_reset_password_and_confirms_address(self):
        a = self.client(); user = self.pending_account('zz_pending@example.com')
        with db.connect() as c:
            c.execute("UPDATE profile SET friend_link='fictional_friend_link' WHERE user_id=%s", (user['id'],))
            c.execute("""INSERT INTO signup_join_intents(user_id,kind,code,want_request)
                         VALUES(%s,'card','fictional_card',true),(%s,'challenge','fictional_challenge',true)""",
                      (user['id'], user['id']))
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        unknown = anon.post('/api/password/forgot', json={'login': 'nobody@example.com'}).json()
        response = anon.post('/api/password/forgot', json={'login': 'zz_pending@example.com'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['message'], unknown['message'], 'unknown and pending accounts get the same response')
        self.assertEqual(self.messages()[-1]['to'], ['zz_pending@example.com'])
        token = self.link('reset-password')
        self.assertEqual(anon.post('/api/password/reset/check', json={'token': token}).json()['login'], user['login'])
        new = 'a brand new pending reset sentence'
        with patch('app.account_email._join_signup_friend') as join_friend, patch('app.account_email._consume_signup') as consume_signup:
            response = anon.post('/api/password/reset', json={'token': token, 'password': new})
            join_friend.assert_not_called()
            consume_signup.assert_not_called()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['email_confirmed'])
        changed = self.messages()[-1]['text']
        self.assertTrue(changed.startswith('Hi Mail,\n\nThe password for your Kinetta account (@zz_test_mail_a) was just changed'))
        self.assertIn("If you didn't do this, reset your password now at https://example.test/forgot-password and email feedback@kinetta.app.", changed)
        self.assertIn("You're getting this because this address was used for a Kinetta account.", changed)
        with db.connect() as c:
            row = c.execute('SELECT email::text AS email, email_verified_at, needs_email_confirm FROM users WHERE id=%s', (user['id'],)).fetchone()
            self.assertEqual(row['email'], 'zz_pending@example.com')
            self.assertIsNotNone(row['email_verified_at'])
            self.assertFalse(row['needs_email_confirm'])
            self.assertIsNone(c.execute("SELECT 1 FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL", (user['id'],)).fetchone(), 'the old confirmation link is invalidated')
            self.assertIsNone(c.execute('SELECT friend_link FROM profile WHERE user_id=%s', (user['id'],)).fetchone()['friend_link'], 'signup friend link is discarded')
            self.assertEqual(c.execute('SELECT count(*) AS n FROM signup_join_intents WHERE user_id=%s', (user['id'],)).fetchone()['n'], 0, 'card and challenge choices cannot be applied by the background worker')
        self.assertEqual(a.get('/api/me').status_code, 401, 'reset signs out the signup session')
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_pending@example.com', 'password': new}).status_code, 200)

    def signup_pending(self):
        login, email = 'zz_test_mail_signup', 'zz_signup_pending@example.com'
        self.addCleanup(self.delete_temporary_account, login)
        anon = TestClient(app); anon.headers['Origin'] = BASE
        with patch.dict(os.environ, {'KINETTA_SIGNUP': 'open', 'KINETTA_MAX_ACCOUNTS': '10000'}), \
                patch.object(api_account, 'reserved_login', return_value=False):
            response = anon.post('/api/signup', json={'first_name': 'Riley', 'last_name': 'Example',
                'login': login, 'email': email, 'password': PW, 'age_ok': True,
                'terms_version': community_terms.active_version()})
        self.assertEqual(response.status_code, 200, response.text)
        with db.connect() as c:
            user = c.execute('SELECT id,created,email,needs_email_confirm FROM users WHERE login=%s', (login,)).fetchone()
        self.assertIsNone(user['email'], 'real signup stores the address only in its confirmation token')
        self.assertTrue(user['needs_email_confirm'])
        return anon, user, login, email

    def test_real_signup_reset_resolves_pending_address_and_preserves_guards(self):
        session, user, login, email = self.signup_pending()
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        unknown = anon.post('/api/password/forgot', json={'login': 'unknown@example.com'}).json()
        for who in (login, email.upper()):
            response = anon.post('/api/password/forgot', json={'login': who})
            self.assertEqual(response.json(), unknown)
            self.assertEqual(self.messages()[-1]['to'], [email])
        token = self.link('reset-password')
        # Issuing a reset is not confirmation and must not move the purge deadline.
        with db.connect() as c:
            row = c.execute('SELECT created,email,email_verified_at,needs_email_confirm FROM users WHERE id=%s', (user['id'],)).fetchone()
            self.assertEqual(row['created'], user['created']); self.assertIsNone(row['email'])
            self.assertIsNone(row['email_verified_at']); self.assertTrue(row['needs_email_confirm'])
            c.execute("UPDATE profile SET friend_link='fictional_friend_link' WHERE user_id=%s", (user['id'],))
            c.execute("INSERT INTO signup_join_intents(user_id,kind,code,want_request) VALUES(%s,'card','fictional_card',true)", (user['id'],))
            c.execute("UPDATE account_tokens SET expires=now()-interval '1 day' WHERE user_id=%s AND kind='verify_email'", (user['id'],))
        new = 'a brand new real signup password'
        bad = anon.post('/api/password/reset', json={'token': token, 'password': 'short'})
        self.assertEqual(bad.status_code, 422)
        self.assertTrue(session.get('/api/me').json()['needs_email_confirm'])
        with patch.object(account_email, '_join_signup_friend') as join, patch.object(account_email, '_consume_signup') as consume:
            result = anon.post('/api/password/reset', json={'token': token, 'password': new})
            join.assert_not_called(); consume.assert_not_called()
        self.assertEqual(result.status_code, 200, result.text); self.assertTrue(result.json()['email_confirmed'])
        self.assertEqual(session.get('/api/me').status_code, 401)
        self.assertEqual(anon.post('/api/password/reset', json={'token': token, 'password': new}).status_code, 404)
        with db.connect() as c:
            row = c.execute('SELECT email::text,email_verified_at,needs_email_confirm,created,signup_confirmed_at FROM users WHERE id=%s', (user['id'],)).fetchone()
            self.assertEqual(row['email'], email); self.assertIsNotNone(row['email_verified_at'])
            self.assertFalse(row['needs_email_confirm']); self.assertEqual(row['created'], user['created'])
            self.assertIsNotNone(row['signup_confirmed_at'])
            self.assertIsNone(c.execute('SELECT friend_link FROM profile WHERE user_id=%s', (user['id'],)).fetchone()['friend_link'])
            self.assertFalse(c.execute('SELECT 1 FROM signup_join_intents WHERE user_id=%s', (user['id'],)).fetchone())
            self.assertFalse(c.execute("SELECT 1 FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL", (user['id'],)).fetchone())
        self.assertEqual(anon.post('/api/login', json={'login': email, 'password': new}).status_code, 200)
        self.assertEqual(self.messages()[-1]['to'], [email])

    def test_real_signup_reset_stale_address_isolation_and_shared_budget(self):
        _, user, login, email = self.signup_pending()
        other = self.pending_account('zz_other_pending@example.com', login='zz_test_mail_b')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        for who in (email, login):
            self.assertEqual(anon.post('/api/password/forgot', json={'login': who}).status_code, 200)
            self.assertEqual(self.messages()[-1]['to'], [email])
        stale = self.link('reset-password')
        self.assertEqual(anon.post('/api/account/email/resend', json={'login': email}).status_code, 200)
        self.assertEqual(self.mail.call_count, 3)
        generic = anon.post('/api/password/forgot', json={'login': email}).json()
        self.assertEqual(generic, anon.post('/api/password/forgot', json={'login': 'unknown@example.com'}).json())
        self.assertEqual(self.mail.call_count, 3, 'resend and reset still share three links per hour')
        with db.connect() as c:
            before = c.execute('SELECT pw_hash FROM users WHERE id=%s', (user['id'],)).fetchone()['pw_hash']
            other_before = c.execute('SELECT pw_hash,email::text,email_verified_at FROM users WHERE id=%s', (other['id'],)).fetchone()
            account_email._token(c, user['id'], 'verify_email', 1440, 'zz_replacement@example.com')
        response = anon.post('/api/password/reset', json={'token': stale, 'password': 'another secure reset sentence'})
        self.assertEqual(response.status_code, 404, response.text)
        with db.connect() as c:
            row = c.execute('SELECT pw_hash,email,email_verified_at,needs_email_confirm FROM users WHERE id=%s', (user['id'],)).fetchone()
            self.assertEqual(row['pw_hash'], before); self.assertIsNone(row['email'])
            self.assertIsNone(row['email_verified_at']); self.assertTrue(row['needs_email_confirm'])
            self.assertEqual(c.execute('SELECT pw_hash,email::text,email_verified_at FROM users WHERE id=%s', (other['id'],)).fetchone(), other_before)

    def test_pending_reset_link_expires_if_account_email_changes(self):
        user = self.pending_account('zz_stale@example.com')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        self.assertEqual(anon.post('/api/password/forgot', json={'login': 'zz_stale@example.com'}).status_code, 200)
        token = self.link('reset-password')
        with db.connect() as c:
            before = c.execute('SELECT pw_hash FROM users WHERE id=%s', (user['id'],)).fetchone()['pw_hash']
            c.execute('UPDATE users SET email=%s WHERE id=%s', ('zz_replacement@example.com', user['id']))
        response = anon.post('/api/password/reset', json={'token': token, 'password': 'a brand new reset sentence'})
        self.assertEqual(response.status_code, 404, response.text)
        self.assertEqual(response.json()['detail'], 'This link has expired. Request a new one from the sign-in page.')
        with db.connect() as c:
            row = c.execute('SELECT email::text AS email,email_verified_at,needs_email_confirm,pw_hash FROM users WHERE id=%s', (user['id'],)).fetchone()
            self.assertEqual(row['email'], 'zz_replacement@example.com')
            self.assertIsNone(row['email_verified_at'])
            self.assertTrue(row['needs_email_confirm'])
            self.assertEqual(row['pw_hash'], before, 'a stale inbox link cannot reset the password')

    def test_login_offer_is_only_returned_after_valid_pending_password(self):
        self.pending_account('zz_login_pending@example.com')
        self.pending_account('zz_unflagged_pending@example.com', login='zz_test_mail_b')
        with db.connect() as c:
            c.execute("UPDATE users SET needs_email_confirm=false WHERE login='zz_test_mail_b'")
        anon = TestClient(app); anon.headers['Origin'] = BASE
        response = anon.post('/api/login', json={'login': 'zz_login_pending@example.com', 'password': PW})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['detail']['code'], 'email_waiting_for_confirmation')
        username_client = TestClient(app); username_client.headers['Origin'] = BASE
        response = username_client.post('/api/login', json={'login': 'zz_test_mail_a', 'password': PW})
        self.assertEqual(response.status_code, 200, f'correct username login keeps working before confirmation: {response.text}')
        self.assertTrue(username_client.get('/api/me').json()['needs_email_confirm'])
        self.assertEqual(anon.post('/api/login', json={'login': 'zz_unflagged_pending@example.com', 'password': PW}).status_code, 401,
                         'email sign-in stays unavailable until verified when this is not a new-signup confirmation')
        wrong = anon.post('/api/login', json={'login': 'zz_login_pending@example.com', 'password': 'wrong password'})
        unknown = anon.post('/api/login', json={'login': 'nobody@example.com', 'password': 'wrong password'})
        self.assertEqual(wrong.status_code, 401)
        self.assertEqual(wrong.json(), unknown.json(), 'wrong password does not reveal a pending account')

    def test_pending_email_login_explains_when_mail_is_unavailable(self):
        self.pending_account('zz_mail_unavailable@example.com')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        with patch('app.account_email.mail_ready', return_value=False):
            response = anon.post('/api/login', json={'login': 'zz_mail_unavailable@example.com', 'password': PW})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['detail']['code'], 'email_confirmation_unavailable')
        self.assertIn('email is not available', response.json()['detail']['message'].lower())
        self.assertIn('@username', response.json()['detail']['message'])
        username_client = TestClient(app); username_client.headers['Origin'] = BASE
        self.assertEqual(username_client.post('/api/login', json={'login': 'zz_test_mail_a', 'password': PW}).status_code, 200)

    def test_resend_confirmation_is_generic_and_rate_limited(self):
        self.pending_account('zz_resend@example.com')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        unknown = anon.post('/api/account/email/resend', json={'login': 'nobody@example.com'})
        forgot_unknown = anon.post('/api/password/forgot', json={'login': 'nobody@example.com'}).json()
        forgot_pending = anon.post('/api/password/forgot', json={'login': 'zz_resend@example.com'}).json()
        self.assertEqual(forgot_pending['message'], forgot_unknown['message'])
        messages = []
        for _ in range(5):
            response = anon.post('/api/account/email/resend', json={'login': 'zz_resend@example.com'})
            self.assertEqual(response.status_code, 200)
            messages.append(response.json()['message'])
        self.assertEqual(len(set(messages + [unknown.json()['message']])), 1, 'unknown and pending accounts get the same response')
        self.assertEqual(self.mail.call_count, 3, 'resend and reset share a three-link per-account hourly limit')
        self.assertEqual(self.messages()[-1]['to'], ['zz_resend@example.com'])

    def test_open_signup_resend_sends_pending_email_without_enumeration(self):
        login, email = 'zz_test_mail_resend', 'zz_resend_signup@example.com'
        payload = {'name': 'Fictional Resend', 'login': login, 'email': email,
                   'password': 'fictional long passphrase', 'age_ok': True, 'tz': 'UTC'}
        creator = TestClient(app); creator.headers['Origin'] = BASE
        original_reserved = api_account.reserved_login
        self.mail.reset_mock()
        with patch.dict(os.environ, {**ENV, 'KINETTA_SIGNUP': 'open', 'KINETTA_MAX_ACCOUNTS': ''}), \
             patch.object(api_account, 'reserved_login', side_effect=lambda value, **kw: original_reserved(value, allow_test=True)):
            created = creator.post('/api/signup', json=payload)
        self.assertEqual(created.status_code, 200, created.text)
        account = creator.get('/api/me').json()
        self.assertTrue(account['needs_email_confirm'])
        self.assertIsNone(account['email'], 'open signup keeps the address pending until the link is opened')
        self.assertEqual(account['pending_email'], email)
        self.assertEqual(self.mail.call_count, 1, 'signup sends the initial welcome message through the stub')
        welcome = self.messages()[0]
        first_link = re.search(r'https://example\.test/confirm-email#([\w-]+)', welcome['text']).group(1)

        anon = TestClient(app); anon.headers['Origin'] = BASE
        unknown_email = anon.post('/api/account/email/resend', json={'login': 'nobody@example.com'})
        unknown_login = anon.post('/api/account/email/resend', json={'login': 'nobody_fixture'})
        self.assertEqual(unknown_email.status_code, 200)
        self.assertEqual(unknown_login.status_code, 200)
        self.assertEqual(unknown_email.json(), unknown_login.json())
        self.assertEqual(self.mail.call_count, 1, 'unknown accounts never receive mail')

        known_username = anon.post('/api/account/email/resend', json={'login': login})
        self.assertEqual(known_username.status_code, 200)
        self.assertEqual(known_username.json(), unknown_email.json(), 'known and unknown accounts get the same response')
        self.assertEqual(self.mail.call_count, 2, 'the pending token address receives a second message')
        second_link = re.search(r'https://example\.test/confirm-email#([\w-]+)', self.messages()[1]['text']).group(1)
        self.assertNotEqual(first_link, second_link, 'resend creates a fresh confirmation link')
        self.assertEqual(self.messages()[1]['to'], [email])
        stale = anon.post('/api/account/email/confirm', json={'token': first_link})
        self.assertEqual(stale.status_code, 404, 'resending invalidates the earlier unused link')
        with db.connect() as c:
            token_row = c.execute('SELECT expires-created AS lifetime FROM account_tokens WHERE token_hash=%s',
                                   (auth.token_hash(second_link),)).fetchone()
        self.assertEqual(token_row['lifetime'], datetime.timedelta(hours=account_email.VERIFY_HOURS),
                         'replacement confirmation links retain the 24-hour expiry')

        known_email = anon.post('/api/account/email/resend', json={'login': email.upper()})
        third_by_username = anon.post('/api/account/email/resend', json={'login': login})
        limited = anon.post('/api/account/email/resend', json={'login': email})
        self.assertEqual(known_email.json(), unknown_email.json())
        self.assertEqual(third_by_username.json(), unknown_email.json())
        self.assertEqual(limited.status_code, 200)
        self.assertEqual(limited.json(), unknown_email.json(), 'rate-limited and unknown accounts stay indistinguishable')
        self.assertEqual(self.mail.call_count, 4, 'signup plus three per-account recovery messages; later resends are limited')
        self.assertEqual([m['to'] for m in self.messages()], [[email]] * 4)

        latest_link = re.search(r'https://example\.test/confirm-email#([\w-]+)', self.messages()[-1]['text']).group(1)
        confirmed = anon.post('/api/account/email/confirm', json={'token': latest_link})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(anon.post('/api/account/email/confirm', json={'token': latest_link}).status_code, 404,
                         'the newest confirmation link is single-use')

    def test_signup_conflict_for_pending_email_offers_recovery_code(self):
        user = self.pending_account('zz_signup_pending@example.com')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        payload = {'name': 'Fictional Casey', 'email': 'zz_signup_pending@example.com',
                   'password': 'fictional long passphrase', 'age_ok': True, 'share_default': 'everyone'}
        with patch.dict(os.environ, {'KINETTA_SIGNUP': 'open'}):
            response = anon.post('/api/signup', json=payload)
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['detail']['code'], 'email_waiting_for_confirmation')
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM users WHERE email=%s', ('zz_signup_pending@example.com',)).fetchone()['n'], 1)
            self.assertIsNone(c.execute("SELECT id FROM users WHERE login='fictional' AND id<>%s", (user['id'],)).fetchone())

    def test_limits_and_unconfigured_mail(self):
        a = self.client(); self.confirm(a, 'zz_limit@example.com')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.mail.reset_mock()
        for _ in range(5): anon.post('/api/password/forgot', json={'login': 'zz_test_mail_a'})
        self.assertEqual(self.mail.call_count, 3, 'at most three reset links an hour per account')
        with patch.dict(os.environ, {'KINETTA_RESEND_KEY': ''}):
            unavailable = a.put('/api/account/email', json={'email': 'zz_x@example.com', 'password': PW})
            self.assertEqual(unavailable.status_code, 503)
            self.assertIn('feedback@kinetta.app', unavailable.json()['detail'])
            self.assertFalse(a.get('/api/me').json()['mail_ready'])
            unknown = anon.post('/api/password/forgot', json={'login': 'nobody@example.com'})
            known = anon.post('/api/password/forgot', json={'login': 'zz_limit@example.com'})
            self.assertEqual(unknown.status_code, 200); self.assertEqual(known.status_code, 200)
            self.assertEqual(known.json(), unknown.json(), 'unavailable-mail response does not reveal whether an account matched')
            self.assertFalse(known.json()['email_available'])
            self.assertIn('Email recovery isn’t available', known.json()['message'])
            self.assertIn('feedback@kinetta.app', known.json()['message'])
            self.assertNotIn('sent a link', known.json()['message'].lower())
            self.assertEqual(self.mail.call_count, 3, 'unavailable mail does not send a reset message')

    def test_password_change_notice_and_privacy(self):
        a = self.client(); self.confirm(a, 'zz_notice@example.com'); self.mail.reset_mock()
        self.assertEqual(a.post('/api/account/password', json={'current': PW, 'new': 'another fine sentence'}).status_code, 200)
        self.assertEqual(self.messages()[-1]['to'], ['zz_notice@example.com'])
        with db.connect() as c:
            self.assertFalse(c.execute("SELECT has_column_privilege('fit_readers', 'users', 'email', 'SELECT') AS ok").fetchone()['ok'])
            for t in ('account_tokens', 'auth_attempts'):
                self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers', %s, 'SELECT') AS ok", (t,)).fetchone()['ok'])
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname = %s', (t,)).fetchone()['relrowsecurity'])
            self.assertFalse(c.execute("SELECT count(*) AS n FROM account_tokens WHERE token_hash LIKE '%%-%%'").fetchone()['n'], 'only hashes stored')


    def test_change_email_rejects_common_domain_typos(self):
        a = self.client()
        r = a.put('/api/account/email', json={'email': 'fictional@gmial.com', 'password': PW})
        self.assertEqual(r.status_code, 400)
        self.assertIn('Did you mean gmail.com?', r.json()['detail'])
        self.assertIn('Keep my address', r.json()['detail'])
        for ending in ('con', 'cmo', 'vom'):
            r = a.put('/api/account/email', json={'email': f'fictional@example.{ending}', 'password': PW})
            self.assertEqual(r.status_code, 400, ending)
        for ending in ('fr', 'dev', 'ninja', 'family', 'international', 'xn--p1ai'):
            self.assertEqual(account_email.check_new_email(f'fictional@example.{ending}'), f'fictional@example.{ending}')
        for address in ('fictional@mailinator.com', 'fictional@sub.mailinator.com', 'fictional@yopmail.com'):
            with self.subTest(address=address), self.assertRaises(HTTPException):
                account_email.check_new_email(address)
        with self.assertRaises(HTTPException):
            account_email.check_new_email('fictional@-bad.ninja')
        disposable = a.put('/api/account/email', json={'email': 'fictional@mailinator.com', 'password': PW})
        self.assertEqual(disposable.status_code, 400)
        self.assertIn('email address that can receive', disposable.json()['detail'])
        self.assertEqual(self.mail.call_count, 0, 'rejected addresses never receive a confirmation message')
        r = a.put('/api/account/email', json={'email': 'fictional@gmial.com', 'password': PW, 'confirm_typo': True})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()['pending'], 'fictional@gmial.com', 'the server keeps the address the person explicitly chose')
        self.assertEqual(self.mail.call_count, 1)

    def test_stored_typo_email_can_confirm_resend_and_reset_without_enumeration(self):
        anon = TestClient(app); anon.headers['Origin'] = BASE
        self.pending_account('zz_stored@gmai.com')
        unknown = anon.post('/api/account/email/resend', json={'login': 'nobody@example.com'})
        pending = anon.post('/api/account/email/resend', json={'login': 'zz_stored@gmai.com'})
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json(), unknown.json(), 'resend does not disclose a stored typo address')
        self.assertEqual(self.messages()[-1]['to'], ['zz_stored@gmai.com'])
        token = self.link('confirm-email')
        confirmed = anon.post('/api/account/email/confirm', json={'token': token})
        self.assertEqual(confirmed.status_code, 200, confirmed.text)
        self.assertEqual(confirmed.json()['email'], 'zz_stored@gmai.com')

        self.pending_account('zz_reset_stored@gmai.com', login='zz_test_mail_b')
        unknown = anon.post('/api/password/forgot', json={'login': 'nobody@example.com'})
        pending = anon.post('/api/password/forgot', json={'login': 'zz_reset_stored@gmai.com'})
        self.assertEqual(unknown.status_code, 200)
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json(), unknown.json(), 'forgot does not disclose a stored typo address')
        self.assertEqual(self.messages()[-1]['to'], ['zz_reset_stored@gmai.com'])
        token = self.link('reset-password')
        self.assertEqual(anon.post('/api/password/reset/check', json={'token': token}).status_code, 200)
        reset = anon.post('/api/password/reset', json={'token': token, 'password': 'new stored typo passphrase'})
        self.assertEqual(reset.status_code, 200, reset.text)
        self.assertTrue(reset.json()['email_confirmed'])

    def test_confirmation_reminders_are_spaced_and_capped_at_two(self):
        self.client()
        user = self.pending_account('zz_reminders@example.com')
        typo_user = self.pending_account('zz_reminder@gmai.com', login='zz_test_mail_b')
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '4 days' WHERE version=109")
            c.execute("""UPDATE users SET created=now()-interval '5 days', email_confirmation_reminder_count=0,
                         email_confirmation_reminder_at=NULL WHERE id=ANY(%s)""", ([user['id'], typo_user['id']],))
        self.addCleanup(self.restore_reminder_migration_date, applied)
        self.mail.reset_mock()
        self.assertEqual(account_email.send_due_confirmation_reminders(), 0, 'accounts predating migration 109 are skipped')
        with db.connect() as c:
            c.execute("""UPDATE users SET created=now()-interval '3 days', email_confirmation_reminder_count=0,
                         email_confirmation_reminder_at=NULL WHERE id=ANY(%s)""", ([user['id'], typo_user['id']],))
        self.assertEqual(account_email.send_due_confirmation_reminders(), 1)
        first = self.messages()[-1]
        self.assertEqual(first['to'], ['zz_reminders@example.com'])
        self.assertEqual(first['subject'], 'Your Kinetta account needs one more step')
        self.assertRegex(first['text'], r'Hi Mail,\n\nConfirm your email to keep your account: https://example\.test/confirm-email#[\w-]+\. This link')
        self.assertIn('This link replaces earlier ones and works for 24 hours.', first['text'])
        self.assertTrue(first['text'].startswith('Hi Mail,\n\n'))
        self.assertIn("You're getting this because this address was used for a Kinetta account.", first['text'])
        with db.connect() as c:
            typo = c.execute('SELECT email_confirmation_reminder_count,email_confirmation_reminder_at FROM users WHERE id=%s', (typo_user['id'],)).fetchone()
            self.assertEqual(typo['email_confirmation_reminder_count'], 0, 'addresses with a recognized typo get no reminder')
            self.assertIsNone(typo['email_confirmation_reminder_at'])
        self.assertEqual(account_email.send_due_confirmation_reminders(), 0, 'the second reminder waits two days')
        with db.connect() as c:
            c.execute("UPDATE users SET email_confirmation_reminder_at=now()-interval '2 days' WHERE id=%s", (user['id'],))
        self.assertEqual(account_email.send_due_confirmation_reminders(), 1)
        second = self.messages()[-1]
        with db.connect() as c:
            created = c.execute('SELECT created FROM users WHERE id=%s', (user['id'],)).fetchone()['created']
        deadline = account_email.unconfirmed_account_delete_at(created)
        self.assertEqual(deadline - created, datetime.timedelta(days=account_email.UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS))
        deletion_date = f"{deadline.day} {deadline.strftime('%B %Y')} (UTC)"
        self.assertEqual(second['subject'], f'Confirm your Kinetta email by {deletion_date}')
        self.assertRegex(second['text'], r'Confirm your email to keep your account: https://example\.test/confirm-email#[\w-]+\. This link')
        self.assertIn(f"Accounts that aren't confirmed within {account_email.UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS} days are deleted on {deletion_date}.", second['text'])
        self.assertIn('This link replaces earlier ones', second['text'])
        with db.connect() as c:
            c.execute("UPDATE users SET email_confirmation_reminder_at=now()-interval '10 days' WHERE id=%s", (user['id'],))
            count = c.execute('SELECT email_confirmation_reminder_count FROM users WHERE id=%s', (user['id'],)).fetchone()['email_confirmation_reminder_count']
        self.assertEqual(count, 2)
        self.assertEqual(account_email.send_due_confirmation_reminders(), 0, 'there is no third reminder')
        self.assertEqual(self.mail.call_count, 2)

    def test_final_warning_is_once_and_only_unconfirmed_accounts_are_purged_after_14_days(self):
        old = self.temporary_pending_account('zz_test_mail_purge', 'zz_purge@example.com')
        self.addCleanup(self.delete_temporary_account, old['login'])
        confirmed = self.pending_account('zz_confirmed@example.com', login='zz_test_mail_b')
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '30 days' WHERE version=109")
            c.execute("""UPDATE users SET created=now()-interval '30 days',email_confirmation_reminder_count=2,
                         email_confirmation_reminder_at=now()-interval '27 days' WHERE id=%s""", (old['id'],))
            c.execute("""UPDATE users SET email_verified_at=now(),needs_email_confirm=false,
                         email_confirmation_reminder_count=0,email_confirmation_reminder_at=NULL WHERE id=%s""",
                      (confirmed['id'],))
        self.addCleanup(self.restore_reminder_migration_date, applied)
        self.mail.reset_mock()

        self.assertEqual(account_email.send_due_confirmation_reminders(), 1)
        final = self.messages()[-1]
        with db.connect() as c:
            created = c.execute('SELECT created FROM users WHERE id=%s', (old['id'],)).fetchone()['created']
            reminder = c.execute('SELECT email_confirmation_reminder_at FROM users WHERE id=%s', (old['id'],)).fetchone()['email_confirmation_reminder_at']
            warning = c.execute('''SELECT unconfirmed_final_warning_at AS claimed_at,
                                          unconfirmed_final_warning_sent_at AS sent_at
                                   FROM users WHERE id=%s''', (old['id'],)).fetchone()
            warned_at, sent_at = warning['claimed_at'], warning['sent_at']
        deadline = account_email.unconfirmed_account_delete_at(created)
        delete_on = account_email._unconfirmed_delete_on(created, sent_at)
        deletion_date = f'{delete_on.day} {delete_on.strftime("%B %Y")} (UTC)'
        self.assertEqual(final['subject'], f'Your Kinetta account will be deleted on {deletion_date}')
        self.assertIn(f'Open this link before {deletion_date} to keep your account:', final['text'])
        self.assertIn('If you didn\'t sign up, do nothing and it will be removed.', final['text'])
        self.assertLess(abs((datetime.datetime.now(datetime.timezone.utc) - reminder).total_seconds()), 60)
        self.assertIn('(UTC)', final['subject'])
        self.assertGreater(account_email._unconfirmed_delete_on(created, sent_at),
                           datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3),
                           'overdue accounts get a future deletion date at least four days away')
        token = self.link('confirm-email')
        with db.connect() as c:
            expiry = c.execute('SELECT expires FROM account_tokens WHERE token_hash=%s',
                               (auth.token_hash(token),)).fetchone()['expires']
        self.assertGreaterEqual(expiry, delete_on, 'final confirmation link remains valid through the deletion date')
        self.assertEqual(account_email.send_due_confirmation_reminders(), 0, 'the final warning is sent once')
        self.assertEqual(self.mail.call_count, 1)

        # A warning does not make an account eligible before the shared 14-day deadline.
        with db.connect() as c:
            c.execute("UPDATE users SET created=now()-interval '13 days',unconfirmed_final_warning_at=now()-interval '3 days',unconfirmed_final_warning_sent_at=now()-interval '3 days' WHERE id=%s",
                      (old['id'],))
        with patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'on'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 0)
        with db.connect() as c:
            self.assertTrue(c.execute('SELECT 1 FROM users WHERE id=%s', (old['id'],)).fetchone())

        # Four days start after a successful send, not when the initial claim was stored.
        with db.connect() as c:
            c.execute("""UPDATE users SET created=now()-interval '30 days',
                         unconfirmed_final_warning_at=now()-interval '8 days',
                         unconfirmed_final_warning_sent_at=now()-interval '3 days' WHERE id=%s""", (old['id'],))
        with patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'on'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 0)
        with db.connect() as c:
            self.assertTrue(c.execute('SELECT 1 FROM users WHERE id=%s', (old['id'],)).fetchone())

        # After both the account deadline and four-day post-send window, default LOG preserves it.
        with db.connect() as c:
            c.execute("UPDATE users SET unconfirmed_final_warning_sent_at=now()-interval '5 days' WHERE id=%s",
                      (old['id'],))
            before = signup.accounts(c)
        with patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'off'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 0)
        with patch('app.account_email.mail_ready', return_value=False), patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'on'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 0, 'purge is disabled when email is unavailable')
        self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 1, 'default LOG mode reports but does not delete')
        with db.connect() as c:
            self.assertEqual(signup.accounts(c), before, 'LOG mode leaves the account count unchanged')
        with patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'on'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 1)
        with db.connect() as c:
            after = signup.accounts(c)
            self.assertEqual(after, before - 1, 'purging reduces the real sign-up cap count')
            self.assertTrue(c.execute('SELECT 1 FROM users WHERE id=%s AND email_verified_at IS NOT NULL',
                                      (confirmed['id'],)).fetchone(), 'confirmed accounts are never deleted')
            self.assertTrue(c.execute("SELECT 1 FROM admin_audit WHERE action='account.purge_unconfirmed' AND target=%s",
                                      (str(old['id']),)).fetchone(), 'purge is audited by account id only')

    def test_purge_excludes_admin_suspended_pre_migration_and_typo_accounts(self):
        fixture_logins = ('zz_test_purge_admin','zz_test_purge_suspended','zz_test_purge_legacy_warning',
                          'zz_test_purge_legacy_due','zz_test_purge_typo','zz_test_purge_email_change')
        fixtures = [self.temporary_pending_account(login, f'{login}@example.com') for login in fixture_logins]
        for login in fixture_logins: self.addCleanup(self.delete_temporary_account, login)
        self.assertEqual(account_email.email_suggestion('zz_test_purge_typo@gmai.com'),
                         'zz_test_purge_typo@gmail.com')
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '30 days' WHERE version=109")
            ids = [row['id'] for row in fixtures]
            c.execute("""UPDATE users SET created=now()-interval '20 days',email_confirmation_reminder_count=2,
                         unconfirmed_final_warning_at=now()-interval '8 days',
                         unconfirmed_final_warning_sent_at=now()-interval '8 days' WHERE id=ANY(%s)""", (ids,))
            c.execute("UPDATE users SET is_admin=true WHERE id=%s", (fixtures[0]['id'],))
            c.execute("UPDATE users SET suspended_at=now() WHERE id=%s", (fixtures[1]['id'],))
            c.execute("UPDATE users SET created=now()-interval '31 days',unconfirmed_final_warning_at=NULL WHERE id=%s", (fixtures[2]['id'],))
            c.execute("UPDATE users SET created=now()-interval '31 days' WHERE id=%s", (fixtures[3]['id'],))
            c.execute("UPDATE users SET email='zz_test_purge_typo@gmai.com' WHERE id=%s", (fixtures[4]['id'],))
            account_email._token(c, fixtures[5]['id'], 'verify_email', account_email.VERIFY_HOURS * 60,
                                 'zz_test_purge_email_change_new@example.com')
            c.execute('''UPDATE users SET unconfirmed_final_warning_at=NULL,
                         unconfirmed_final_warning_sent_at=NULL WHERE id=%s''', (fixtures[5]['id'],))
        self.addCleanup(self.restore_reminder_migration_date, applied)
        self.assertEqual(account_email.send_due_confirmation_reminders(), 0,
                         'a live pending email change is not warned at the old address')
        with db.connect() as c:
            c.execute("UPDATE users SET unconfirmed_final_warning_at=now()-interval '8 days',unconfirmed_final_warning_sent_at=now()-interval '8 days' WHERE id=%s",
                      (fixtures[4]['id'],))
        with patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'on'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 0)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM users WHERE id=ANY(%s)', ([row['id'] for row in fixtures],)).fetchone()['n'], 6)

    def test_failed_final_warning_keeps_previous_link_and_releases_claim(self):
        user = self.temporary_pending_account('zz_test_warning_failure', 'zz_warning_failure@example.com')
        self.addCleanup(self.delete_temporary_account, user['login'])
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '35 days' WHERE version=109")
            c.execute("""UPDATE users SET created=now()-interval '30 days',email_confirmation_reminder_count=2,
                         email_confirmation_reminder_at=now()-interval '27 days' WHERE id=%s""", (user['id'],))
            old_token = account_email._token(c, user['id'], 'verify_email', account_email.VERIFY_HOURS * 60,
                                             'zz_warning_failure@example.com')
        self.addCleanup(self.restore_reminder_migration_date, applied)
        old_hash = auth.token_hash(old_token)
        with patch('app.account_email.send_confirmation', side_effect=RuntimeError('fictional mail failure')):
            self.assertEqual(account_email.send_due_confirmation_reminders(), 0)
        with db.connect() as c:
            row = c.execute('''SELECT unconfirmed_final_warning_at,unconfirmed_final_warning_sent_at,
                                      email_confirmation_reminder_count FROM users WHERE id=%s''',
                            (user['id'],)).fetchone()
            tokens = c.execute("SELECT token_hash FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL",
                               (user['id'],)).fetchall()
        self.assertIsNone(row['unconfirmed_final_warning_at'], 'failed send releases the warning claim')
        self.assertIsNone(row['unconfirmed_final_warning_sent_at'], 'failed send never records a successful warning')
        self.assertEqual(row['email_confirmation_reminder_count'], 2)
        self.assertEqual([t['token_hash'] for t in tokens], [old_hash], 'failed mail keeps the old link active')


    def test_abandoned_final_warning_claim_retries_after_one_hour(self):
        user = self.temporary_pending_account('zz_test_warning_restart', 'zz_warning_restart@example.com')
        self.addCleanup(self.delete_temporary_account, user['login'])
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '35 days' WHERE version=109")
            c.execute("""UPDATE users SET created=now()-interval '30 days',email_confirmation_reminder_count=2,
                         email_confirmation_reminder_at=now()-interval '27 days',
                         unconfirmed_final_warning_at=now()-interval '2 hours',
                         unconfirmed_final_warning_sent_at=NULL WHERE id=%s""", (user['id'],))
        self.addCleanup(self.restore_reminder_migration_date, applied)
        self.mail.reset_mock()
        self.assertEqual(account_email.send_due_confirmation_reminders(), 1)
        with db.connect() as c:
            sent_at = c.execute('SELECT unconfirmed_final_warning_sent_at FROM users WHERE id=%s',
                                (user['id'],)).fetchone()['unconfirmed_final_warning_sent_at']
        self.assertIsNotNone(sent_at, 'retry records successful delivery time')
        self.assertEqual(account_email.send_due_confirmation_reminders(), 0,
                         'a successfully sent warning is not resent')
        self.assertEqual(self.mail.call_count, 1)

    def test_pending_email_change_during_send_keeps_its_confirmation_link(self):
        user = self.temporary_pending_account('zz_test_warning_email_race', 'zz_warning_email_race@example.com')
        self.addCleanup(self.delete_temporary_account, user['login'])
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '35 days' WHERE version=109")
            c.execute("""UPDATE users SET created=now()-interval '30 days',email_confirmation_reminder_count=2,
                         email_confirmation_reminder_at=now()-interval '27 days' WHERE id=%s""", (user['id'],))
        self.addCleanup(self.restore_reminder_migration_date, applied)

        def change_pending_email(*_args):
            with db.connect() as c:
                account_email.reservation_lock(c)
                return account_email._token(c, user['id'], 'verify_email', account_email.VERIFY_HOURS * 60,
                                            'zz_warning_email_race_new@example.com')

        with patch('app.account_email.send_confirmation', side_effect=change_pending_email):
            self.assertEqual(account_email.send_due_confirmation_reminders(), 0)
        with db.connect() as c:
            row = c.execute('SELECT unconfirmed_final_warning_at FROM users WHERE id=%s', (user['id'],)).fetchone()
            tokens = c.execute("SELECT email::text AS email FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL",
                               (user['id'],)).fetchall()
        self.assertIsNone(row['unconfirmed_final_warning_at'], 'the superseded final-warning claim is released')
        self.assertEqual([token['email'] for token in tokens], ['zz_warning_email_race_new@example.com'])

    def test_confirmation_after_final_warning_spares_account_from_purge(self):
        user = self.temporary_pending_account('zz_test_warning_confirm', 'zz_warning_confirm@example.com')
        self.addCleanup(self.delete_temporary_account, user['login'])
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '35 days' WHERE version=109")
            c.execute("""UPDATE users SET created=now()-interval '30 days',email_confirmation_reminder_count=2,
                         email_confirmation_reminder_at=now()-interval '27 days' WHERE id=%s""", (user['id'],))
        self.addCleanup(self.restore_reminder_migration_date, applied)
        self.assertEqual(account_email.send_due_confirmation_reminders(), 1)
        token = self.link('confirm-email')
        anon = TestClient(app); anon.headers['Origin'] = BASE
        response = anon.post('/api/account/email/confirm', json={'token': token})
        self.assertEqual(response.status_code, 200, response.text)
        with db.connect() as c:
            c.execute("UPDATE users SET unconfirmed_final_warning_at=now()-interval '5 days',unconfirmed_final_warning_sent_at=now()-interval '5 days' WHERE id=%s", (user['id'],))
        with patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'on'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(), 0)
        with db.connect() as c:
            self.assertTrue(c.execute('SELECT 1 FROM users WHERE id=%s AND email_verified_at IS NOT NULL',
                                      (user['id'],)).fetchone())

    def test_purge_limit_never_exceeds_100_per_run(self):
        self.addCleanup(self.delete_temporary_prefix, 'zz_purge_cap_%')
        with db.connect() as c:
            applied = c.execute('SELECT applied FROM schema_version WHERE version=109').fetchone()['applied']
            c.execute("UPDATE schema_version SET applied=now()-interval '30 days' WHERE version=109")
            c.execute("""INSERT INTO users(login,name,pw_hash,email,needs_email_confirm,created,
                         email_confirmation_reminder_count,unconfirmed_final_warning_at,unconfirmed_final_warning_sent_at)
                         SELECT 'zz_purge_cap_'||n,'Cap fixture','fixture','zz_purge_cap_'||n||'@example.com',true,
                           now()-interval '15 days',2,now()-interval '5 days',now()-interval '5 days'
                         FROM generate_series(1,101) n""")
        self.addCleanup(self.restore_reminder_migration_date, applied)
        with patch.dict(os.environ, {'KINETTA_PURGE_UNCONFIRMED':'on'}):
            self.assertEqual(account_email.purge_due_unconfirmed_accounts(limit=500), 100)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM users WHERE login LIKE 'zz_purge_cap_%'").fetchone()['n'], 1)

    def delete_temporary_prefix(self, pattern):
        with db.connect() as c: c.execute('DELETE FROM users WHERE login LIKE %s', (pattern,))

    def restore_reminder_migration_date(self, applied):
        with db.connect() as c:
            c.execute('UPDATE schema_version SET applied=%s WHERE version=109', (applied,))


class ConfirmedEmailGate(unittest.TestCase):
    """Authenticated fixture requests, with provider calls forbidden."""
    def setUp(self):
        from app import ai_access, ai_release, food_photo, coach, food_coach, coach_chat
        from contextlib import ExitStack
        self.stack=ExitStack();self.addCleanup(self.stack.close);self.providers=[]
        for module,name in ((food_photo,'ask'),(coach,'_gemini'),(coach,'_claude'),(food_coach,'_ask'),(coach_chat,'_gemini_turn'),(coach_chat,'_claude_turn')):
            self.providers.append(self.stack.enter_context(patch.object(module,name,side_effect=AssertionError('Provider called'))))
        self.stack.enter_context(patch.object(ai_release,'enabled',return_value=True))
        self.stack.enter_context(patch.dict(os.environ,{'KINETTA_AI_ACCESS_MODE':'open'}))
        self.ids=[];self.addCleanup(self.clean);self.addCleanup(self.check_providers)
        with db.connect() as c:
            for suffix in ('pending','other'):
                login='zz_test_gate_'+suffix
                uid=c.execute('INSERT INTO users(login,name,pw_hash,needs_email_confirm) VALUES(%s,%s,%s,true) RETURNING id',
                              (login,'Fictional Member',auth.hash_pw(PW))).fetchone()['id']
                self.ids.append(uid)
                c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(uid,))
        self.client=TestClient(app);self.client.headers['Origin']=BASE
        self.assertEqual(self.client.post('/api/login',json={'login':'zz_test_gate_pending','password':PW}).status_code,200)

    def clean(self):
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))

    def check_providers(self):
        for provider in self.providers:provider.assert_not_called()

    def test_server_gate_and_account_matrix(self):
        from app import ai_access, api_photos, email_confirmation, food_thread_understand
        from uuid import uuid4
        uid,other=self.ids
        me=self.client.get('/api/me').json()
        self.assertTrue(me['needs_email_confirm']);self.assertFalse(me['email_confirmed'])
        for feature in ai_access.FEATURES:
            self.assertFalse(me['ai_access'][feature]['entitled'])
            self.assertEqual(me['ai_access'][feature]['reason'],email_confirmation.KIT_BLOCK)
        generation=self.client.get('/api/coach/conversation').json()['generation']
        for path,body in (
            ('/api/food/photo',{'note':'Fictional lunch'}),
            ('/api/food/label',{'image':'not-an-image'}),
            ('/api/recipe-links/photo',{'client_id':str(uuid4()),'image':'not-an-image'}),
            (f'/api/recipe-links/{uuid4()}/estimate',{'candidate':0,'index':0,'client_id':str(uuid4()),'confirmed':True}),
            ('/api/coach/ask',{'question':'Review my week'}),
            ('/api/coach/week',{}),('/api/activities/999999/coach',{}),('/api/food/review',{}),
            ('/api/coach/conversation/messages',{'client_id':str(uuid4()),'generation':generation,'question':'Review my week'}),
        ):
            r=self.client.post(path,json=body)
            self.assertEqual((r.status_code,r.json().get('detail')),(403,email_confirmation.KIT_BLOCK),path)
        # Fresh database state, never a supplied user object or another account's status.
        with db.connect() as c:
            c.execute('UPDATE users SET email_verified_at=now() WHERE id=%s',(other,))
            self.assertTrue(email_confirmation.required(uid,c));self.assertFalse(email_confirmation.required(other,c))
            with patch.object(food_thread_understand,'enabled',return_value=True),patch.dict(os.environ,{'GEMINI_API_KEY':'fictional'}):
                self.assertFalse(food_thread_understand.allowed(c,uid))
        spoof={'id':uid,'needs_email_confirm':False,'email_verified_at':'verified'}
        for endpoint,args in ((api_photos.set_profile_photo,()),(api_photos.add_activity_photo,(999999,))):
            with self.assertRaises(HTTPException) as err:endpoint(*args,api_photos.PhotoIn(image='not-a-valid-image'),user=spoof)
            self.assertEqual(err.exception.status_code,403)
        # Shared insertion covers recorded activities, before any SQL insert or partial save.
        with db.connect() as c:
            with self.assertRaises(HTTPException):api_photos.insert_activity_photo(c,999999,uid,None)
        for method,path in (('PUT','/api/me/photo'),('POST','/api/activities/999999/photos')):
            r=self.client.request(method,path,json={'image':'not-a-valid-image'})
            self.assertEqual((r.status_code,r.json().get('detail')),(403,email_confirmation.PHOTO_BLOCK))
        from PIL import Image
        from io import BytesIO
        image=BytesIO();Image.new('RGB',(32,32),'gray').save(image,format='JPEG')
        jpeg='data:image/jpeg;base64,'+base64.b64encode(image.getvalue()).decode()
        recording=str(uuid4())
        track={'client_id':recording,'sport':'run','name':'Fictional run','start':'2026-11-20T08:00:00Z',
               'elapsed_s':120,'moving_s':120,'review_version':1,'photos':[jpeg]}
        with patch.object(api_photos,'prepare_activity_photo',side_effect=AssertionError('Unconfirmed image decoded')) as decode:
            r=self.client.post('/api/activities/track',json=track)
            decode.assert_not_called()
        self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(r.json()['warning'],'Activity saved without photos. Confirm your email to upload photos.')
        aid=r.json()['id']
        saved=self.client.get(f'/api/activities/{aid}').json()
        self.assertEqual((saved['name'],saved['moving_s'],saved['elapsed_s']),('Fictional run',120,120))
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT activity_id FROM track_recording_receipts WHERE user_id=%s AND client_id=%s',(uid,recording)).fetchone()['activity_id'],aid)
            self.assertFalse(c.execute('SELECT 1 FROM activity_photos WHERE user_id=%s AND activity_id=%s',(uid,aid)).fetchone())
        retry=self.client.post('/api/activities/track',json=track).json()
        self.assertEqual(retry['id'],aid);self.assertTrue(retry['duplicate']);self.assertEqual(retry['warning'],r.json()['warning'])
        track['photos']=[]
        self.assertEqual(self.client.post('/api/activities/track',json=track).json()['id'],aid,'retry without photos retains recording')
        for path in ('/api/food/day','/api/dishes','/api/plans/options','/api/plans/current'):
            self.assertEqual(self.client.get(path).status_code,200,path)
        self.assertEqual(self.client.request('DELETE','/api/me/photo',json={}).status_code,200,'removal stays available')
        run=self.client.post('/api/activities/manual',json={'sport':'run','start':'2026-11-20T07:00','duration_s':1800,'distance_m':5000})
        self.assertEqual(run.status_code,200,run.text)
        self.assertEqual(self.client.post('/api/dishes',json={'name':'Manual meal'}).status_code,200)
        # Both confirmed-signup and legacy/invited accounts keep their former permissions.
        for needs,verified in ((True,True),(False,False)):
            with db.connect() as c:
                c.execute('UPDATE users SET needs_email_confirm=%s,email_verified_at=CASE WHEN %s THEN now() ELSE NULL END WHERE id=%s',(needs,verified,uid))
            for feature in ai_access.FEATURES:self.assertTrue(ai_access.has(uid,feature))
            self.assertEqual(self.client.put('/api/me/photo',json={'image':'not-a-valid-image'}).status_code,400,'passes gate to image validation')
            self.assertEqual(self.client.post('/api/activities/999999/photos',json={'image':'not-a-valid-image'}).status_code,400)
            self.assertEqual(self.client.put('/api/me/photo',json={'image':jpeg}).status_code,200)
            added=self.client.post(f"/api/activities/{run.json()['id']}/photos",json={'image':jpeg})
            self.assertEqual(added.status_code,200,added.text)
        with db.connect() as c:c.execute('UPDATE users SET needs_email_confirm=true,email_verified_at=NULL WHERE id=%s',(uid,))
        self.assertEqual(self.client.get(f"/api/activity-photos/{added.json()['id']}").status_code,200)
        self.assertEqual(self.client.request('DELETE',f"/api/activity-photos/{added.json()['id']}",json={}).status_code,200)
        self.assertEqual(self.client.request('DELETE','/api/me/photo',json={}).status_code,200)


    def test_background_and_non_photo_food_paths(self):
        from app import coach, ai_budget, cook_chat, food_thread_understand as U, food_memory_understand as M
        from app import recipe_fetch, recipe_import
        from uuid import uuid4
        uid=self.ids[0]
        with patch.object(coach.threading,'Thread',side_effect=AssertionError('Unconfirmed import spawned AI')):
            coach.after_import(uid,[999999])
        for run in (lambda:coach.note(uid,999999),lambda:coach.week_review(uid)):
            with self.assertRaises(HTTPException) as denied:run()
            self.assertEqual(denied.exception.status_code,403)
        # Drive exactly one scheduler iteration; only fixture accounts use the real review.
        review=coach.week_review;visited=[]
        def scheduled(account):
            if account in self.ids:
                visited.append(account)
                with self.assertRaises(HTTPException):review(account)
        with patch.object(coach,'enabled',return_value=True),patch.object(coach,'week_review',side_effect=scheduled),patch('time.sleep',side_effect=[None,StopIteration]):
            with self.assertRaises(StopIteration):coach.weekly_scheduler()
        self.assertCountEqual(visited,self.ids)
        with patch.dict(os.environ,{'GEMINI_API_KEY':'fictional'}),patch.object(cook_chat,'ai_actions',side_effect=AssertionError('Cook AI called')):
            dish=self.client.post('/api/dishes',json={'name':'Fictional pot'}).json()
            cooked=self.client.post(f"/api/dishes/{dish['id']}/say",json={'text':'100 g fictional aubergine'})
            self.assertEqual(cooked.status_code,200,cooked.text);self.assertTrue(cooked.json()['fallback'])
        with patch.dict(os.environ,{'GEMINI_API_KEY':'fictional'}),patch.object(U,'enabled',return_value=True),patch.object(M,'enabled',return_value=True),patch.object(U,'ask_model',side_effect=AssertionError('Understanding called')) as understanding,patch.object(M,'ask_model',side_effect=AssertionError('Memory AI called')) as memory:
            msg=self.client.post('/api/food/thread/messages',json={'client_id':str(uuid4()),'body':'How much protein today?','review_only':True})
            self.assertEqual(msg.status_code,201,msg.text)
            mid=msg.json()['message']['id']
            result=self.client.post(f'/api/food/thread/messages/{mid}/process',json={})
            self.assertEqual(result.status_code,200,result.text)
            understanding.assert_not_called();memory.assert_not_called()
        # Recipe links parse structured data, with no AI; unmatched ingredient estimates are gated separately.
        page={'url':'https://recipes.example.test/soup','html':'<script type="application/ld+json">'+json.dumps({'@context':'https://schema.org','@type':'Recipe','name':'Fictional Soup','recipeIngredient':['100 g carrots'],'recipeYield':'2 servings'})+'</script>'}
        with patch.object(recipe_fetch,'fetch',return_value=page),patch.object(recipe_import,'_match',side_effect=lambda c,u,rows:rows):
            result=self.client.post('/api/recipe-links/read',json={'client_id':str(uuid4()),'url':page['url']})
            self.assertEqual(result.status_code,200,result.text);self.assertEqual(result.json()['state'],'ready')
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM ai_food_attempts WHERE user_id=%s',(uid,)).fetchone()['n'],0)

    def test_creation_defaults_and_deleted_background_account(self):
        from app import email_confirmation, coach, ai_access, api_photos
        uid=self.ids[0]
        # Setup and invite share _create; the reviewer harness uses admin add_person.
        with db.connect() as c:
            first=c.execute('SELECT id,needs_email_confirm FROM users WHERE is_admin ORDER BY id LIMIT 1').fetchone()
            self.assertFalse(first['needs_email_confirm'],'seeded first-run admin is unaffected')
            created=api_account._create(c,api_account.NewAccountIn(name='Fictional Admin',login='gate_first_admin',password=PW),is_admin=True)
            self.ids.append(created)
        admin={'id':created,'is_admin':True}
        for login in ('zz_test_gate_added','zz_test_gate_reviewer'):
            api_account.add_person(api_account.PersonIn(login=login,name='Fictional Member',password=PW),user=admin)
            with db.connect() as c:self.ids.append(c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'])
        invite=api_account.create_invite(api_account.InviteIn(),user=admin)
        self.addCleanup(self.delete_invite,invite['id'])
        response=TestClient(app).post('/api/join',headers={'Origin':BASE},json={'token':invite['path'].split('/')[-1],'login':'gate_invited','name':'Fictional Friend','password':PW,'age_ok':True})
        self.assertEqual(response.status_code,200,response.text)
        with db.connect() as c:
            invited=c.execute("SELECT id FROM users WHERE login='gate_invited'").fetchone()['id'];self.ids.append(invited)
            rows=c.execute('SELECT needs_email_confirm FROM users WHERE id=ANY(%s)',(self.ids[2:],)).fetchall()
            self.assertTrue(all(not row['needs_email_confirm'] for row in rows))
            api_photos.lock_activity_photos(c,uid)  # lock alone must not prevent removal-only edits
            c.execute('DELETE FROM users WHERE id=%s',(uid,))
        self.assertIs(email_confirmation.required(uid),False)
        self.assertFalse(coach.allowed(uid));coach.after_import(uid,[999999])
        self.assertFalse(ai_access.has(uid,'coach'),'missing account has no AI access')

    def delete_invite(self,identity):
        with db.connect() as c:c.execute('DELETE FROM invites WHERE id=%s',(identity,))


if __name__ == '__main__': unittest.main()
