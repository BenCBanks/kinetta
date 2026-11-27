"""Open signup with an email, the account cap and new-account restrictions (#232 D); the mail provider is a stand-in."""
import ast, base64, json, os, re, threading, unittest, uuid
from pathlib import Path
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth, signup, admin_auth, api_account, account_email, enrollment_requests, password_work
from app.main import app

PW = 'test account private password'
BASE = 'http://testserver'
MAIL = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.com>',
        'KINETTA_MAIL_REPLY_TO': 'support@example.com', 'KINETTA_PUBLIC_URL': 'https://example.test',
        'KINETTA_MAIL_WEBHOOK_SECRET': 'whsec_' + base64.b64encode(b'fictional-webhook-key').decode()}


def receipt(*a, **k):
    return httpx.Response(200, json={'id': 'fictional'}, request=httpx.Request('POST', 'https://api.resend.com/emails'))


def client():
    c = TestClient(app); c.headers.update({'Origin':BASE,'Content-Type':'application/json'}); return c


def form(login, **extra):
    return {'name': 'Signup Test', 'login': login, 'email': login + '@example.com', 'password': PW, 'age_ok': True, 'tz': 'UTC', **extra}


def check_name_upgrade(test):
    # This runs only with the disposable suite's superuser secret, never through an app endpoint.
    suffix = uuid.uuid4().hex[:12]
    database = 'zz_test_names_' + suffix
    roles = ['zz_test_names_member_' + suffix, 'zz_test_names_owner_' + suffix]
    password = 'fictional SQL reader password'
    baseline = db.MIGRATIONS[:116]
    if source := os.environ.get('KINETTA_NAME_UPGRADE_MAIN'):
        tree = ast.parse(Path(source).read_text())
        baseline = next(ast.literal_eval(node.value) for node in tree.body
                        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'MIGRATIONS' for t in node.targets))
        test.assertEqual(baseline, db.MIGRATIONS[:len(baseline)], 'Historical main migrations stay identical')
        test.assertLess(len(baseline), len(db.MIGRATIONS), 'Upgrade starts before the branch migration')
    super_dsn = db._conninfo('postgres', db.secret('POSTGRES_PASSWORD'))
    with psycopg.connect(super_dsn, autocommit=True) as root:
        try:
            root.execute(sql.SQL('CREATE DATABASE {} OWNER fit_app').format(sql.Identifier(database)))
            for role, group in zip(roles, ('fit_readers', 'fit_all_readers')):
                root.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role), sql.Literal(password)))
                root.execute(sql.SQL('GRANT {} TO {}').format(sql.Identifier(group), sql.Identifier(role)))
            with psycopg.connect(make_conninfo(super_dsn, dbname=database), autocommit=True) as setup:
                setup.execute('ALTER SCHEMA public OWNER TO fit_app')
                setup.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
                setup.execute('GRANT USAGE ON SCHEMA public TO fit_readers')
                setup.execute('CREATE EXTENSION postgis')
                setup.execute('CREATE EXTENSION citext')
            app_dsn = make_conninfo(db.CONNINFO, dbname=database)
            with psycopg.connect(app_dsn, row_factory=dict_row) as c:
                c.execute('CREATE TABLE schema_version(version int PRIMARY KEY)')
                for version, migration in enumerate(baseline, 1):
                    c.execute(migration)
                    c.execute('INSERT INTO schema_version VALUES(%s)', (version,))
                for login, name in [('zz_test_one', 'Fictional'), ('zz_test_full', 'Fictional Three Word Name')]:
                    c.execute('INSERT INTO users(login,name) VALUES(%s,%s)', (login, name))
                test.assertEqual(c.execute("SELECT has_column_privilege('fit_readers','users','name','SELECT') AS allowed").fetchone()['allowed'], len(baseline)<117)
            # A committed main database exists before branch migration is applied.
            with psycopg.connect(app_dsn, row_factory=dict_row) as c:
                test.assertEqual(c.execute('SELECT max(version) AS v FROM schema_version').fetchone()['v'], len(baseline))
                for version,migration in enumerate(db.MIGRATIONS[len(baseline):],len(baseline)+1):
                    c.execute(migration)
                    c.execute('INSERT INTO schema_version VALUES(%s)',(version,))
                rows = c.execute('SELECT name,first_name,last_name FROM users ORDER BY login').fetchall()
                test.assertEqual([(r['first_name'], r['last_name']) for r in rows],
                                 [('Fictional', 'Three Word Name'), ('Fictional', None)])
                c.execute("INSERT INTO users(login,name) VALUES('zz_test_legacy','Legacy SQL Person')")
                test.assertEqual(c.execute("SELECT first_name,last_name FROM users WHERE login='zz_test_legacy'").fetchone(),
                                 {'first_name': 'Legacy', 'last_name': 'SQL Person'})
                c.execute("UPDATE users SET first_name='Updated',last_name='Surname' WHERE login='zz_test_legacy'")
                test.assertEqual(c.execute("SELECT name FROM users WHERE login='zz_test_legacy'").fetchone()['name'],'Updated Surname')
                c.execute("UPDATE users SET last_name='Changed' WHERE login='zz_test_legacy'")
                test.assertEqual(c.execute("SELECT name FROM users WHERE login='zz_test_legacy'").fetchone()['name'],'Updated Changed')
                c.execute("UPDATE users SET name='Legacy SQL Person' WHERE login='zz_test_legacy'")
                test.assertEqual(c.execute("SELECT first_name,last_name FROM users WHERE login='zz_test_legacy'").fetchone(),{'first_name':'Legacy','last_name':'SQL Person'})
                c.execute("INSERT INTO users(login,name,first_name,last_name,needs_email_confirm) VALUES('zz_test_hidden_unconfirmed','Stale Name','Hidden','Unconfirmed',true)")
                test.assertEqual(c.execute("SELECT name FROM users WHERE login='zz_test_hidden_unconfirmed'").fetchone()['name'],'Hidden Unconfirmed')
                c.execute("INSERT INTO users(login,name,suspended_at) VALUES('zz_test_hidden_suspended','Hidden Suspended',now())")
            for role, owner in zip(roles, (False, True)):
                dsn = make_conninfo(db._conninfo(role, password), dbname=database)
                with psycopg.connect(dsn, row_factory=dict_row) as reader:
                    directory = reader.execute('SELECT * FROM public_people ORDER BY login').fetchall()
                    test.assertEqual(len(directory), 3)
                    test.assertFalse(any(row['login'].startswith('zz_test_hidden') for row in directory),'directory excludes unavailable accounts for members and owners')
                    test.assertEqual(set(directory[0]), {'user_id', 'login', 'first_name', 'created'})
                    test.assertEqual(reader.execute("SELECT first_name FROM users WHERE login='zz_test_full'").fetchone()['first_name'], 'Fictional')
                    if owner:
                        test.assertEqual(reader.execute("SELECT name,last_name FROM users WHERE login='zz_test_full'").fetchone(),
                                         {'name': 'Fictional Three Word Name', 'last_name': 'Three Word Name'})
                        test.assertEqual(reader.execute('SELECT count(*) AS n FROM owner_people').fetchone()['n'],5,'owners retain unavailable accounts in their private view')
                        test.assertEqual(reader.execute("SELECT name FROM owner_people WHERE login='zz_test_full'").fetchone()['name'], 'Fictional Three Word Name')
                    else:
                        for statement in ('SELECT name FROM users', 'SELECT last_name FROM users',
                                          'SELECT * FROM users', 'SELECT suspended_at,needs_email_confirm FROM users', 'SELECT name FROM owner_people'):
                            with test.assertRaises(psycopg.errors.InsufficientPrivilege):
                                with reader.transaction():
                                    reader.execute(statement)
        finally:
            root.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
            for role in roles:
                root.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))


class Signup(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_su%%' OR login LIKE 'zzsutest%%' OR email LIKE 'zz_test_su%%@example.com'")
            c.execute("DELETE FROM account_tokens WHERE email LIKE 'zz_test_su%%@example.com'")
            c.execute('DELETE FROM auth_attempts')
            c.execute("DELETE FROM beta_requests WHERE email LIKE 'zz_test_su%%@example.com'")

    def setUp(self):
        self.tearDownClass()
        self.mail = patch('app.account_email.httpx.post', side_effect=receipt).start(); self.addCleanup(patch.stopall)
        # Trusted fixtures may use reserved test handles; cap counting remains the real production query.
        original = api_account.reserved_login
        self.fixture_names = patch.object(api_account, 'reserved_login', side_effect=lambda v, **kw: original(v, allow_test=True))
        self.fixture_names.start()

    def test_real_names_are_required_normalized_and_legacy_payloads_split(self):
        self.env(KINETTA_SIGNUP='open')
        for login, payload, message in (
            ('zz_test_su_name_missing', {'first_name': 'Riley'}, 'Please add your last name.'),
            ('zz_test_su_first_blank', {'first_name': '  ', 'last_name': 'Example'}, 'Please add your first name.'),
            ('zz_test_su_last_blank', {'first_name': 'Riley', 'last_name': ' \t '}, 'Please add your last name.'),
            ('zz_test_su_legacy_one', {'name': 'Riley'}, 'Please add your last name.'),
        ):
            response = client().post('/api/signup', json={**form(login), **payload})
            self.assertEqual(response.status_code, 400, response.text)
            self.assertEqual(response.json()['detail'], message)
        for index, first in enumerate(('علی\u200cرضا', 'क्\u200dष')):
            response = client().post('/api/signup', json={**form('zz_test_su_joiner_' + str(index)),
                                                         'first_name': first, 'last_name': 'Example'})
            self.assertEqual(response.status_code, 200, response.text)
        for first in ('\u200cRiley', 'Riley\u200d', 'Ri\u202eley', 'Ri\u200bley'):
            response = client().post('/api/signup', json={**form('zz_test_su_bad_joiner'),
                                                         'first_name': first, 'last_name': 'Example'})
            self.assertEqual(response.status_code, 400, response.text)
        legacy = form('zz_test_su_name_legacy')
        legacy['name'] = '  Zoë   van  Example  '
        response = client().post('/api/signup', json=legacy)
        self.assertEqual(response.status_code, 200, response.text)
        owner = client()
        self.assertEqual(owner.post('/api/login', json={'login':'zz_test_su_name_legacy','password':PW}).status_code,200)
        me = owner.get('/api/me').json()
        self.assertEqual((me['first_name'],me['last_name'],me['name']),('Zoë','van Example','Zoë van Example'))
        self.assertEqual(self.mail.call_args.kwargs['json']['text'].splitlines()[0], 'Hi Zoë,')
        self.assertEqual(owner.put('/api/account',json={'first_name':'Élodie','last_name':'O’Neil'}).status_code,200)
        self.assertEqual(owner.get('/api/me').json()['name'], 'Élodie O’Neil')
        with db.connect() as c:
            stored=c.execute("SELECT name,first_name,last_name FROM users WHERE login='zz_test_su_name_legacy'").fetchone()
        self.assertEqual((stored['name'],stored['first_name'],stored['last_name']),('Élodie O’Neil','Élodie','O’Neil'))

    def test_first_run_setup_rejects_missing_last_name(self):
        class EmptySetupDb:
            def execute(self, query, *args):
                self.asserted_query = query
                return self
            def fetchone(self): return None
        @contextmanager
        def empty_db(): yield EmptySetupDb()
        # This fixture models setup validation, not the separate pre-route source budget.
        with patch('app.api_account.db.connect', empty_db), patch('app.password_work.source_attempt', return_value=True):
            response = client().post('/api/setup', json={'first_name':'Riley','last_name':'  ','password':PW})
        self.assertEqual(response.status_code,400,response.text)
        self.assertEqual(response.json()['detail'],'Please add your last name.')

    def test_name_validation_rejects_symbols_controls_and_reserved_words(self):
        for first,last in (('Zoë','Smith'),('李','小龍'),('Jean-Luc','O’Neil'),('Mary.Jane','de La Cruz'),('علی\u200cرضا','نمونه'),('क्\u200dष','उदाहरण')):
            self.assertEqual(api_account._clean_person_names(first,last)[2],f'{first} {last}')
        for first,last in (('Riley2','Smith'),('Riley','🏃'),('Riley\u202e','Smith'),('Kinetta','Support'),('\u200dRiley','Smith'),('Riley\u200c','Smith'),('Ri\u200c ley','Smith'),('Ri\u200b ley','Smith')):
            with self.assertRaises(Exception, msg=(first,last)):
                api_account._clean_person_names(first,last)

    def test_name_migrations_upgrade_legacy_names_in_place(self):
        check_name_upgrade(self)

    def env(self, **kw):
        # start from known settings, whatever the server running the tests was started with
        p = patch.dict(os.environ, {**MAIL, 'KINETTA_SIGNUP': 'invite', 'KINETTA_MAX_ACCOUNTS': '', **{k: str(v) for k, v in kw.items()}}); p.start(); self.addCleanup(p.stop)

    def real_accounts(self):
        with db.connect() as c: return signup.accounts(c)

    def test_invite_only_by_default(self):
        self.env()
        self.assertEqual({k: v for k, v in client().get('/api/signup').json().items() if k != 'iphone_app'}, {'open': False, 'full': False})
        self.assertEqual(client().post('/api/signup', json=form('zz_test_su_closed')).status_code, 404)
        self.env(KINETTA_SIGNUP='open', KINETTA_RESEND_KEY='')
        self.assertFalse(client().get('/api/signup').json()['open'], 'open signup needs email to confirm addresses')

    def test_open_signup_confirm_and_restrictions(self):
        self.env(KINETTA_SIGNUP='open')
        new = client()
        self.assertEqual(new.post('/api/signup', json=form('zz_test_su_new', age_ok=False)).status_code, 400, '16+ required')
        r = new.post('/api/signup', json=form('zz_test_su_new')); self.assertEqual(r.status_code, 200, r.text)
        me = new.get('/api/me').json()
        self.assertTrue(me['needs_email_confirm']); self.assertEqual(me['pending_email'], 'zz_test_su_new@example.com'); self.assertIsNone(me['email'])
        self.assertFalse(me.get('ai_ok'), 'Kit waits for a yes (the welcome steps ask)'); self.assertFalse(me['health_ai_ok'] or me['garmin_ai_ok'], 'Health and Garmin still need their own yes')
        # Kit is 18+ although sign-up is 16+: its yes needs the age confirmation, which is recorded once
        self.assertEqual(new.put('/api/profile', json={'ai_ok': True}).status_code, 400, 'Kit needs the 18+ confirmation')
        self.assertFalse(new.get('/api/me').json().get('ai_ok'))
        self.assertEqual(new.put('/api/profile', json={'ai_ok': True, 'ai_adult': True}).status_code, 200)
        self.assertTrue(new.get('/api/me').json()['ai_ok'])
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT ai_adult_by FROM profile p JOIN users u ON u.id = p.user_id WHERE u.login = 'zz_test_su_new'").fetchone()['ai_adult_by'], 'self', 'their own tick is recorded as theirs')
        new.put('/api/profile', json={'ai_ok': False}); self.assertEqual(new.put('/api/profile', json={'ai_ok': True}).status_code, 200, 'asked once')
        # a yes from before the age rule (existing Kit users) counts for nothing until they confirm
        with db.connect() as c:
            uid = c.execute("SELECT id FROM users WHERE login = 'zz_test_su_new'").fetchone()['id']
            c.execute('UPDATE profile SET ai_adult_at = NULL WHERE user_id = %s', (uid,))
            from app import coach
            self.assertFalse(c.execute(coach.ADULT_OK, (uid,)).fetchone()['ai_ok'], 'no AI call without the confirmation')
        self.assertFalse(new.get('/api/me').json()['ai_ok'], 'the app asks again')
        new.put('/api/profile', json={'ai_ok': False})
        self.assertEqual(self.mail.call_args.kwargs['json']['to'], ['zz_test_su_new@example.com'])
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
        token = re.search(r'/confirm-email#([\w-]+)', self.mail.call_args_list[0].kwargs['json']['text']).group(1)
        self.assertEqual(client().post('/api/account/email/confirm', json={'token': token}).status_code, 200)
        self.assertFalse(new.get('/api/me').json()['needs_email_confirm'])
        self.assertEqual(old.get(f'/api/shared/{aid}').status_code, 200)
        self.assertEqual(new.post('/api/friends', json={'login': 'zz_test_su_old'}).status_code, 200)
        self.assertEqual(new.post(f'/api/activities/{oid}/comments', json={'text': 'hello'}).status_code, 200)

    def test_signup_rejects_common_email_domain_typos(self):
        self.env(KINETTA_SIGNUP='open')
        before = self.real_accounts()
        payload = form('zz_test_su_typo')
        payload['email'] = 'casey@example.con'
        response = client().post('/api/signup', json=payload)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('Did you mean .com?', response.json()['detail'])
        self.assertEqual(self.real_accounts(), before, 'a correction is required before account creation')
        payload['email'] = 'zz_test_su_typo@gmial.com'
        response = client().post('/api/signup', json=payload)
        self.assertEqual(response.status_code, 400, response.text)
        self.assertIn('Keep my address', response.json()['detail'])
        response = client().post('/api/signup', json={**payload, 'confirm_typo': True})
        self.assertEqual(response.status_code, 200, response.text)

    def test_beta_waitlist_requires_explicit_choice_for_domain_typos(self):
        self.env(KINETTA_SIGNUP='waitlist', KINETTA_BETA_SIGNUP='1')
        email = 'zz_test_su_waitlist@gmial.com'
        unfamiliar = 'zz_test_su_waitlist@example.ninja'
        malformed = 'zz_test_su_waitlist@-example.ninja'
        self.addCleanup(self.delete_beta_typo_request, email)
        self.addCleanup(self.delete_beta_typo_request, unfamiliar)
        payload = {'name': 'Fictional Waitlist Member', 'email': email, 'phone': 'iphone'}
        self.assertEqual(client().post('/api/beta', json=payload).status_code, 400)
        accepted = client().post('/api/beta', json={**payload, 'email': unfamiliar})
        self.assertEqual(accepted.status_code, 200, 'valid unlisted TLDs are accepted')
        self.assertEqual(client().post('/api/beta', json={**payload, 'email': malformed}).status_code, 400,
                         'malformed domain labels remain invalid')
        response = client().post('/api/beta', json={**payload, 'confirm_typo': True})
        self.assertEqual(response.status_code, 200, response.text)

    def delete_beta_typo_request(self, email):
        with db.connect() as c:
            c.execute('DELETE FROM beta_requests WHERE email=%s', (email,))

    def test_new_profiles_use_public_sharing_defaults_without_changing_saved_choices(self):
        self.env(KINETTA_SIGNUP='open')
        existing = client()
        self.assertEqual(existing.post('/api/signup', json=form('zz_test_su_defaults_existing')).status_code, 200)
        with db.connect() as c:
            existing_id = c.execute("SELECT id FROM users WHERE login='zz_test_su_defaults_existing'").fetchone()['id']
            c.execute("UPDATE profile SET share_default='friends',share_details=jsonb_build_object('heart_rate',false),share_achievements=false,share_achievements_since=NULL,findable=false WHERE user_id=%s", (existing_id,))
        existing_choices = existing.get('/api/sharing').json()
        self.assertEqual(existing_choices['default'], 'friends')
        self.assertFalse(existing_choices['details']['heart_rate'] or existing_choices['share_achievements'] or existing_choices['findable'])

        import secrets
        token = secrets.token_urlsafe(24)
        token_hash = auth.token_hash(token)
        with db.connect() as c:
            c.execute("INSERT INTO invites (token_hash, expires) VALUES (%s, now() + interval '1 day')", (token_hash,))
        def delete_invite():
            with db.connect() as c: c.execute('DELETE FROM invites WHERE token_hash=%s', (token_hash,))
        self.addCleanup(delete_invite)

        accounts = (
            ('/api/signup', 'zz_test_su_defaults_email', form('zz_test_su_defaults_email')),
            ('/api/join', 'zz_test_su_defaults_invite', form('zz_test_su_defaults_invite', token=token)),
        )
        for endpoint, login, body in accounts:
            account = client(); response = account.post(endpoint, json=body)
            self.assertEqual(response.status_code, 200, (endpoint, response.text))
            sharing = account.get('/api/sharing').json()
            self.assertEqual(sharing['default'], 'everyone', (endpoint, sharing))
            self.assertTrue(sharing['details']['heart_rate'], (endpoint, sharing['details']))
            self.assertFalse(sharing['details']['calories'], (endpoint, sharing['details']))
            self.assertTrue(sharing['share_achievements'] and sharing['findable'], (endpoint, sharing))
            with db.connect() as c:
                stored = c.execute('''SELECT p.share_details,p.share_achievements_since IS NOT NULL AS since_set,u.needs_email_confirm
                                      FROM profile p JOIN users u ON u.id=p.user_id WHERE u.login=%s''', (login,)).fetchone()
            self.assertTrue(stored['share_details']['heart_rate'] and stored['since_set'], (endpoint, stored))
            if endpoint == '/api/signup':
                self.assertTrue(stored['needs_email_confirm'], 'sharing defaults do not bypass email confirmation')

        self.assertEqual(existing.get('/api/sharing').json(), existing_choices, 'new accounts do not change saved choices on existing profiles')

    def test_migration_107_preserves_existing_heart_rate_choices(self):
        logins = ('zz_test_su_migration_missing', 'zz_test_su_migration_true', 'zz_test_su_migration_false')
        try:
            with db.connect() as c:
                ids = []
                for login in logins:
                    uid = c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                                    (login, 'Fictional migration test')).fetchone()['id']
                    ids.append(uid)
                choices = [
                    ({'pace': True}, False, None, False, 'friends'),
                    ({'heart_rate': True, 'pace': False}, True, 'now()', True, 'everyone'),
                    ({'heart_rate': False}, False, None, True, 'me'),
                ]
                for uid, (details, achievements, since, findable, audience) in zip(ids, choices):
                    if since == 'now()':
                        c.execute('''INSERT INTO profile(user_id,share_details,share_achievements,share_achievements_since,findable,share_default)
                                     VALUES(%s,%s::jsonb,%s,now(),%s,%s)''',
                                  (uid, json.dumps(details), achievements, findable, audience))
                    else:
                        c.execute('''INSERT INTO profile(user_id,share_details,share_achievements,share_achievements_since,findable,share_default)
                                     VALUES(%s,%s::jsonb,%s,%s,%s,%s)''',
                                  (uid, json.dumps(details), achievements, since, findable, audience))
                before = {row['user_id']: row for row in c.execute(
                    'SELECT user_id,share_details,share_achievements,share_achievements_since,findable,share_default FROM profile WHERE user_id=ANY(%s)',
                    (ids,)).fetchall()}
                c.execute('SAVEPOINT migration_107_fixture')
                try:
                    for statement in db.MIGRATIONS[106].split(';'):
                        if statement.strip():
                            c.execute(statement)
                    after = {row['user_id']: row for row in c.execute(
                        'SELECT user_id,share_details,share_achievements,share_achievements_since,findable,share_default FROM profile WHERE user_id=ANY(%s)',
                        (ids,)).fetchall()}
                    self.assertEqual([after[uid]['share_details']['heart_rate'] for uid in ids], [False, True, False])
                    for uid in ids:
                        for field in ('share_achievements', 'share_achievements_since', 'findable', 'share_default'):
                            self.assertEqual(after[uid][field], before[uid][field], (uid, field))
                        self.assertEqual(after[uid]['share_details'].get('pace'), before[uid]['share_details'].get('pace'))
                finally:
                    c.execute('ROLLBACK TO SAVEPOINT migration_107_fixture')
        finally:
            with db.connect() as c:
                c.execute('DELETE FROM users WHERE login::text=ANY(%s)', (list(logins),))

    def test_shared_strict_age_confirmation(self):
        self.env(KINETTA_SIGNUP='open')
        with db.connect() as c:
            import secrets
            token = secrets.token_urlsafe(24)
            iid = c.execute("INSERT INTO invites (token_hash, expires) VALUES (%s, now() + interval '1 day') RETURNING id", (auth.token_hash(token),)).fetchone()['id']
        for endpoint in ('/api/signup', '/api/join'):
            body = form('zz_test_su_age' + ('public' if endpoint.endswith('signup') else 'invite'), token=token)
            for value, expected in ((False, 400), (None, 422), (1, 422), ('true', 422), ('missing', 400)):
                invalid = {**body, 'age_ok': value}
                if value == 'missing': invalid.pop('age_ok')
                new = client(); response = new.post(endpoint, json=invalid)
                self.assertEqual(response.status_code, expected, (endpoint, value, response.text))
                self.assertNotIn('set-cookie', response.headers)
            with db.connect() as c:
                self.assertIsNone(c.execute('SELECT id FROM users WHERE login = %s', (body['login'],)).fetchone())
                self.assertIsNone(c.execute('SELECT used_at FROM invites WHERE id = %s', (iid,)).fetchone()['used_at'])
        self.assertEqual(self.mail.call_count, 0, 'refused age confirmations send no mail')
        new = client(); body = form('zz_test_su_ageinvite', token=token); body.pop('email')
        self.assertEqual(new.post('/api/join', json=body).status_code, 200, 'same invite survives rejected attempts')
        self.assertFalse(new.get('/api/me').json().get('ai_ok'), '16+ confirmation does not enable 18+ Kit')

    def test_cap_waitlist_and_invites(self):
        n = self.real_accounts()
        self.env(KINETTA_SIGNUP='open', KINETTA_MAX_ACCOUNTS=n + 1)
        self.assertTrue(client().get('/api/signup').json()['open'])
        self.assertFalse(client().get('/api/beta').json()['open'], 'no waitlist while there is room')
        self.assertEqual(client().post('/api/signup', json=form('zz_test_su_last')).status_code, 200)
        self.assertEqual({k: v for k, v in client().get('/api/signup').json().items() if k != 'iphone_app'}, {'open': False, 'full': True})
        r = client().post('/api/signup', json=form('zz_test_su_late')); self.assertEqual(r.status_code, 409); self.assertEqual(r.json()['detail']['code'], 'full')
        self.assertTrue(client().get('/api/beta').json()['open'], 'the waitlist takes over when full')
        with db.connect() as c:      # an administrator's invite still works above the cap
            import secrets
            token = secrets.token_urlsafe(24)
            c.execute("INSERT INTO invites (token_hash, note, expires) VALUES (%s, 'zz', now() + interval '1 day')", (auth.token_hash(token),))
        old_build=client().post('/api/join',json={'age_ok':True,'name':'Invited','login':'zz_test_su_invited','password':PW,'token':token})
        self.assertEqual(old_build.status_code,400,old_build.text)
        self.assertEqual(old_build.json()['detail'],'Please add your last name.')
        with db.connect() as c:self.assertIsNone(c.execute('SELECT used_at FROM invites WHERE token_hash=%s',(auth.token_hash(token),)).fetchone()['used_at'])
        self.assertEqual(client().post('/api/join', json={'age_ok':True,'name': 'Invited Person', 'login': 'zz_test_su_invited', 'password': PW, 'token': token}).status_code, 200)
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
        # The two already-distinct proxy sources must reach the account-cap race,
        # rather than contend on the new earlier same-source admission lock.
        with patch.object(auth,'TRUST_CF',True):
            [t.start() for t in ts]; [t.join() for t in ts]
        self.assertEqual(sorted(codes), [200, 409], 'exactly one person gets the last place')

    def test_bots_and_limits(self):
        self.env(KINETTA_SIGNUP='open')
        self.assertEqual(client().post('/api/signup', json=form('zz_test_su_bot', website='https://spam.example')).json(), {'ok': True})
        with db.connect() as c: self.assertIsNone(c.execute("SELECT 1 FROM users WHERE login = 'zz_test_su_bot'").fetchone(), 'honeypot makes nothing')
        codes = [client().post('/api/signup', json=form(f'zz_test_su_rate{i}')).status_code for i in range(20)]
        self.assertEqual(codes[:-1], [200]*19)
        self.assertEqual(codes[-1], 429, '20 source attempts including the honeypot')

    def test_admin_overview_shows_cap(self):
        self.env(KINETTA_SIGNUP='open', KINETTA_MAX_ACCOUNTS=100)
        with db.connect() as c:
            uid = c.execute("INSERT INTO users (login, name, pw_hash, is_admin) VALUES ('zz_test_su_admin', 'Admin', %s, true) RETURNING id", (auth.hash_pw(PW),)).fetchone()['id']
            token = admin_auth.issue_session(c, uid)
        a = client(); a.cookies.set(admin_auth.COOKIE, token, path='/api'); a.headers['X-Admin-CSRF'] = admin_auth.csrf(token)
        s = a.get('/api/admin/overview').json()['signup']
        self.assertEqual((s['mode'], s['cap']), ('open', 100)); self.assertEqual(s['accounts'], self.real_accounts())


    def test_username_made_from_name_and_changeable(self):
        self.env(KINETTA_SIGNUP='open')
        body = {k: v for k, v in form('zz_test_su_x').items() if k != 'login'}
        with db.connect() as c: c.execute("DELETE FROM users WHERE login LIKE 'zzsutest%%'")
        a, b = client(), client()
        r1 = a.post('/api/signup', json={**body, 'name': 'Zzsutest Person', 'email': 'zz_test_su_n1@example.com'}).json()
        r2 = b.post('/api/signup', json={**body, 'name': 'Zzsütest Person', 'email': 'zz_test_su_n2@example.com'}).json()
        self.assertEqual((r1['login'], r2['login']), ('zzsutestp', 'zzsutest_p'), 'first name plus last initial, then underscore fallback')
        with db.connect() as c:
            suggestion = api_account.suggest_login(c, 'Zzsutest', 'Person', taken={r1['login'], r2['login']})
        self.assertEqual(suggestion, 'zzsutestp2', 'after the underscore choice is taken, append a number to the base')
        # confirm, then the email is the login and the username can change freely
        token = re.search(r'/confirm-email#([\w-]+)', self.mail.call_args_list[0].kwargs['json']['text']).group(1)
        client().post('/api/account/email/confirm', json={'token': token})
        self.assertEqual(a.put('/api/account', json={'login': 'zz_test_su_gamertag'}).json()['login'], 'zz_test_su_gamertag')
        self.assertEqual(a.put('/api/account', json={'login': 'zz_test_su_gamertag2'}).status_code, 200, 'again, whenever they like')
        self.assertEqual(b.put('/api/account', json={'login': 'zz_test_su_gamertag2'}).status_code, 409, 'but not to a taken one')
        self.assertEqual(client().post('/api/login', json={'login': 'zz_test_su_n1@example.com', 'password': PW}).status_code, 200)
        with db.connect() as c: c.execute("DELETE FROM users WHERE login LIKE 'zzsutest%%'")

    def test_invite_join_with_email(self):
        self.env()
        import secrets
        token = secrets.token_urlsafe(24)
        with db.connect() as c: c.execute("INSERT INTO invites (token_hash, note, expires) VALUES (%s, 'zz', now() + interval '1 day')", (auth.token_hash(token),))
        self.assertTrue(client().get('/api/join/' + token).json()['email'], 'the join page can ask for an email')
        j = client()
        r = j.post('/api/join', json={'age_ok':True,'name': 'Zz test su joiner Invited', 'login': 'zz_test_su_joiner', 'email': 'zz_test_su_joiner@example.com', 'password': PW, 'token': token})
        self.assertEqual(r.status_code, 200, r.text); self.assertTrue(r.json()['login'].startswith('zz_test_su_joiner'))
        self.assertEqual(self.mail.call_args.kwargs['json']['to'], ['zz_test_su_joiner@example.com'])
        me = j.get('/api/me').json()
        self.assertFalse(me['needs_email_confirm'], 'invited people are not held back'); self.assertEqual(me['pending_email'], 'zz_test_su_joiner@example.com')

    def test_iphone_app_signup_gets_a_token(self):
        # the iPhone app (#232 E) signs up in the app: a login token in the answer, no cookie, an "iPhone app" session
        self.env(KINETTA_SIGNUP='open')
        app_client = client(); app_client.headers['Origin'] = 'capacitor://localhost'
        r = app_client.post('/api/signup', json=form('zz_test_su_app', app=True)); self.assertEqual(r.status_code, 200, r.text)
        token = r.json()['token']; self.assertNotIn('set-cookie', r.headers)
        me = client().get('/api/me', headers={'Authorization': 'Bearer ' + token}).json()
        self.assertEqual(me['login'], r.json()['login']); self.assertTrue(me['needs_email_confirm'])
        self.assertNotIn('token', client().post('/api/signup', json=form('zz_test_su_web')).json(), 'the web never gets a token')

    def test_welcome_email_points_to_the_iphone_app(self):
        # 2026-10-24: a new account learns Kinetta is in beta and how to get the iPhone app (TestFlight)
        self.env(KINETTA_SIGNUP='open', KINETTA_TESTFLIGHT_URL='https://testflight.apple.com/join/zzFICTION')
        self.assertEqual(client().get('/api/signup').json()['iphone_app'], 'https://testflight.apple.com/join/zzFICTION')
        self.assertEqual(client().post('/api/signup', json=form('zz_test_su_beta')).status_code, 200)
        mail = self.mail.call_args.kwargs['json']
        self.assertEqual(mail['subject'], 'Confirm your email for Kinetta')
        self.assertTrue(mail['text'].startswith('Hi Signup,\n\nOpen this link to confirm your email and finish setting up Kinetta:'))
        self.assertIn('beta', mail['text']); self.assertIn('https://testflight.apple.com/join/zzFICTION', mail['text'])
        self.assertIn("You're getting this because this address was used for a Kinetta account.", mail['text'])
        self.env(KINETTA_SIGNUP='open', KINETTA_TESTFLIGHT_URL='https://example.test/not-testflight')
        self.assertIsNone(client().get('/api/signup').json()['iphone_app'], 'only an Apple TestFlight address is published')

    def remove_member(self, uid):
        with db.connect()as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))

    def member(self, suffix, admin=False):
        with db.connect() as c:
            uid=c.execute('INSERT INTO users(login,name,pw_hash,is_admin) VALUES(%s,%s,%s,%s) RETURNING id',('zz_test_su_'+suffix,'Fixture Member',auth.hash_pw(PW),admin)).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,));token=auth.new_session(c,uid,'signup-safety-fixture')
        self.addCleanup(self.remove_member,uid)
        person=client();person.cookies.set(auth.COOKIE,token);return person,uid

    def actor(self):
        self.env(KINETTA_SIGNUP='open');person=client()
        r=person.post('/api/signup',json=form('zz_test_su_guard'));self.assertEqual(r.status_code,200,r.text)
        token=re.search(r'/confirm-email#([\w-]+)',self.mail.call_args.kwargs['json']['text']).group(1)
        self.assertEqual(client().post('/api/account/email/confirm',json={'token':token}).status_code,200)
        return person,person.get('/api/me').json()['id']

    def race(self, *calls):
        barrier=threading.Barrier(len(calls))
        def run(call):barrier.wait();return call()
        with ThreadPoolExecutor(max_workers=len(calls))as pool:return[f.result(timeout=20)for f in[pool.submit(run,call)for call in calls]]

    def source_rows(self, source='testclient'):
        key='enrollment-source:'+auth.token_hash(source)
        with db.connect() as c:return c.execute('SELECT key,created FROM auth_attempts WHERE key=%s ORDER BY created',(key,)).fetchall()

    def test_early_enrollment_counts_invalid_models_json_email_and_age(self):
        self.env(KINETTA_SIGNUP='open')
        cases=[({},422),(form('zz_test_su_early',password='x'*201),422),
               (form('zz_test_su_early',age_ok='true'),422),
               (form('zz_test_su_early',email='not an email'),400),
               (form('zz_test_su_early',email='fictional@gmial.com'),400),
               (form('zz_test_su_early',age_ok=False),400)]
        with patch.object(auth,'TRUST_CF',False),patch.object(signup,'_create',side_effect=AssertionError('Invalid request reached creation')) as create,patch.object(auth,'hash_pw',side_effect=AssertionError('Invalid request hashed a password')):
            for body,status in cases:
                r=client().post('/api/signup',json=body);self.assertEqual(r.status_code,status,r.text)
            self.assertEqual(client().post('/api/signup',content='{').status_code,422)
            create.assert_not_called()
        rows=self.source_rows();self.assertEqual(len(rows),len(cases)+1)
        self.assertTrue(all(row['key']=='enrollment-source:'+auth.token_hash('testclient') for row in rows))
        self.assertNotIn('gmial',str(rows));self.assertNotIn('password',str(rows));self.assertNotIn('not an email',str(rows))
        self.mail.assert_not_called()

    def test_early_enrollment_exhaustion_precedes_body_validation_and_has_retry_time(self):
        self.env(KINETTA_SIGNUP='open')
        with patch.object(auth,'TRUST_CF',False):
            # Both routes share enrollment allowance. Alternate them so the
            # separate 60/min public password brake is not exhausted first.
            for i in range(enrollment_requests.BURST):
                path='/api/signup' if i%2 else '/api/beta'
                self.assertEqual(client().post(path,json={}).status_code,422)
            before=self.source_rows()
            # Main's body/password middleware may receive bounded bytes first;
            # enrollment must still reject before framework JSON validation.
            with patch.object(account_email,'check_new_email',side_effect=AssertionError('Throttled validation')),patch.object(signup,'_create',side_effect=AssertionError('Throttled creation')),patch.object(auth,'hash_pw',side_effect=AssertionError('Throttled hashing')):
                r=client().post('/api/signup',content='{')
                self.assertEqual(r.status_code,429,r.text)
                self.assertGreater(int(r.headers['retry-after']),0);self.assertLessEqual(int(r.headers['retry-after']),300)
                for _ in range(5):self.assertEqual(client().post('/api/signup',json={}).status_code,429)
            self.assertEqual(self.source_rows(),before,'rejected retries neither insert nor refresh the window')
            self.assertEqual(client().get('/api/signup').status_code,200,'GET status is unaffected')
            self.assertEqual(client().get('/api/health').status_code,200)
            self.assertEqual(client().post('/api/login',json={}).status_code,422,'sign-in has its own limits')
        self.mail.assert_not_called()

    def test_early_enrollment_preserves_independent_password_source_protection(self):
        self.env(KINETTA_SIGNUP='open')
        with patch.object(auth,'TRUST_CF',False),patch.object(password_work,'SOURCE_LIMIT',2):
            for _ in range(2):
                self.assertEqual(client().post('/api/signup',json={}).status_code,422)
            # Main's public password budget intentionally includes signup/login;
            # exhausted password admission must not be mistaken for enrollment.
            for path in ('/api/signup','/api/login'):
                r=client().post(path,json={})
                self.assertEqual(r.status_code,429,r.text)
                self.assertEqual(r.json()['detail'],'Too many tries. Wait a minute and try again.')
                self.assertEqual(r.headers['retry-after'],'60')
            self.assertEqual(len(self.source_rows()),2,'password rejection precedes enrollment')
            self.assertEqual(client().post('/api/beta',json={}).status_code,422)
            self.assertEqual(len(self.source_rows()),3,'waitlist has no password work')
            with db.connect() as c:
                c.execute("UPDATE auth_attempts SET created=now()-interval '61 seconds' WHERE key LIKE 'password-work:%%'")
            self.assertEqual(client().post('/api/login',json={}).status_code,422)
            self.assertEqual(len(self.source_rows()),3,'sign-in never spends enrollment allowance')
            self.assertEqual(client().post('/api/signup',json={}).status_code,422)
            self.assertEqual(len(self.source_rows()),4,'enrollment window survives password expiry')
        self.mail.assert_not_called()

    def test_early_enrollment_shared_network_typo_headroom(self):
        self.env(KINETTA_SIGNUP='open')
        with patch.object(auth,'TRUST_CF',False):
            for i in range(10):
                body=form('zz_test_su_early_nat'+str(i))
                for bad,status in (({},422),({**body,'password':'x'*201},422),
                                   ({**body,'email':'not an email'},400),({**body,'age_ok':False},400)):
                    r=client().post('/api/signup',json=bad);self.assertEqual(r.status_code,status,r.text)
                r=client().post('/api/signup',json=body);self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(len(self.source_rows()),50)
            self.assertEqual(self.mail.call_count,10,'one confirmation per successful account, none for typos')

    def test_early_enrollment_sources_follow_existing_proxy_trust_and_share_waitlist_budget(self):
        self.env(KINETTA_SIGNUP='waitlist')
        with patch.object(auth,'TRUST_CF',False):
            for i in range(3):
                self.assertEqual(client().post('/api/signup',json={},headers={'cf-connecting-ip':f'198.51.100.{i}',
                    'x-forwarded-for':f'203.0.113.{i}'}).status_code,422)
            self.assertEqual(len(self.source_rows()),3,'untrusted headers cannot rotate sources')
        with patch.object(auth,'TRUST_CF',True),patch.object(enrollment_requests,'BURST',2):
            headers={'cf-connecting-ip':'198.51.100.7'}
            self.assertEqual(client().post('/api/signup',json={},headers=headers).status_code,422)
            self.assertEqual(client().post('/api/beta',json={},headers=headers).status_code,422)
            self.assertEqual(client().post('/api/signup',json={},headers=headers).status_code,429)
            self.assertEqual(client().post('/api/beta',json={},headers=headers).status_code,429)
            self.assertEqual(len(self.source_rows('198.51.100.7')),2)
            self.assertEqual(client().post('/api/signup',json={},headers={'cf-connecting-ip':'198.51.100.8'}).status_code,422)
            self.assertEqual(len(self.source_rows('198.51.100.8')),1,'unrelated source remains usable')

    def test_early_enrollment_hour_cap_expiry_and_atomic_admission(self):
        self.env(KINETTA_SIGNUP='open');key='enrollment-source:'+auth.token_hash('testclient')
        with patch.object(auth,'TRUST_CF',False):
            with db.connect() as c:
                c.execute("INSERT INTO auth_attempts(key,created) SELECT %s,now()-interval '6 minutes' FROM generate_series(1,%s)",
                          (key,enrollment_requests.HOUR))
            r=client().post('/api/signup',json={});self.assertEqual(r.status_code,429,r.text)
            self.assertGreater(int(r.headers['retry-after']),300)
            self.assertLessEqual(int(r.headers['retry-after']),3600)
            before=self.source_rows()
            for _ in range(3):self.assertEqual(client().post('/api/signup',json={}).status_code,429)
            self.assertEqual(self.source_rows(),before)
            with db.connect() as c:c.execute("UPDATE auth_attempts SET created=now()-interval '1 hour 1 second' WHERE key=%s",(key,))
            self.assertEqual(client().post('/api/signup',json={}).status_code,422,'hour expires despite denied retries')
            self.assertEqual(len(self.source_rows()),1,'expired rows are removed per source')
            with db.connect() as c:c.execute('DELETE FROM auth_attempts WHERE key=%s',(key,))
            with patch.object(enrollment_requests,'BURST',3):
                # Waitlist reaches the two enrollment workers directly; signup also
                # has main's one-at-a-time public password admission in front.
                replies=self.race(*[lambda:client().post('/api/beta',json={}) for _ in range(8)])
                self.assertTrue(all(r.status_code in (422,429) for r in replies))
                self.assertLessEqual(sum(r.status_code==422 for r in replies),3)
                # Concurrent contention may reject early instead of waiting.
                # Complete the remaining allowance sequentially, then refuse.
                for _ in range(3-len(self.source_rows())):
                    self.assertEqual(client().post('/api/signup',json={}).status_code,422)
                self.assertEqual(client().post('/api/signup',json={}).status_code,429)
            self.assertEqual(len(self.source_rows()),3,'workers share an atomic persisted allowance')
            with db.connect() as c:c.execute("UPDATE auth_attempts SET created=now()-interval '5 minutes 1 second' WHERE key=%s",(key,))
            self.assertEqual(client().post('/api/signup',json={}).status_code,422,'burst expires independently of the hour')
        self.mail.assert_not_called()

    def test_early_enrollment_locked_source_flood_leaves_database_endpoints_responsive(self):
        self.env(KINETTA_SIGNUP='open')
        member,_=self.member('admission_responsive')
        key='enrollment-source:'+auth.token_hash('testclient')
        # Hold the real source lock throughout every response, not a timed sleep.
        with ThreadPoolExecutor(max_workers=12) as pool:
            with db.connect() as held:
                held.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',(key,))
                # Exercise enrollment contention without first flooding the
                # independent public password queue in front of signup.
                flood=[pool.submit(lambda:client().post('/api/beta',json={})) for _ in range(24)]
                for future in flood:
                    r=future.result(timeout=3)
                    self.assertEqual(r.status_code,429,r.text)
                    self.assertEqual(r.headers['retry-after'],'1')
                signup_reply=client().post('/api/signup',json={})
                self.assertEqual(signup_reply.status_code,429,signup_reply.text)
                self.assertEqual(signup_reply.headers['retry-after'],'1')
                # /me needs the same eight-connection pool; a health-only probe
                # would not prove that the flood left connections available.
                self.assertEqual(pool.submit(lambda:member.get('/api/me')).result(timeout=3).status_code,200)
                self.assertEqual(pool.submit(lambda:client().get('/api/signup')).result(timeout=3).status_code,200)
        self.assertEqual(self.source_rows(),[])
        self.assertEqual(client().post('/api/signup',json={}).status_code,422)

    def test_early_enrollment_worker_admission_does_not_queue_the_flood(self):
        started=threading.Barrier(3);release=threading.Event()
        def held_check(request):
            started.wait(timeout=3)
            self.assertTrue(release.wait(5))
        with patch.object(enrollment_requests,'check',side_effect=held_check):
            with ThreadPoolExecutor(max_workers=4) as pool:
                # One signup plus one waitlist can reach both enrollment workers;
                # two signups intentionally serialize in main's password lane.
                pending=[pool.submit(lambda path=path:client().post(path,json={}))
                         for path in ('/api/signup','/api/beta')]
                try:
                    started.wait(timeout=3)
                    # Both admitted workers are held. Excess work must finish
                    # before release, rather than queue behind either worker.
                    for _ in range(12):
                        r=pool.submit(lambda:client().post('/api/beta',json={})).result(timeout=2)
                        self.assertEqual(r.status_code,429,r.text)
                    self.assertEqual(client().get('/api/health').status_code,200)
                finally:release.set()
                self.assertEqual([f.result(timeout=3).status_code for f in pending],[422,422])

    def test_early_enrollment_only_public_posts_are_wrapped(self):
        with patch.object(enrollment_requests,'check',side_effect=AssertionError('Unexpected enrollment guard')):
            for path in ('/api/signup','/api/beta'):
                self.assertEqual(client().get(path).status_code,200)
            for path in ('/api/login','/api/join/fictional','/api/admin/invites',
                         '/api/admin/people','/api/admin/beta/1/delete'):
                self.assertNotEqual(client().post(path,json={}).status_code,429,path)
            # Future POST routes added to a router using this route class must
            # not silently acquire a public source brake.
            from fastapi import FastAPI,APIRouter
            router=APIRouter(route_class=enrollment_requests.EnrollmentRoute)
            router.add_api_route('/api/admin/fixture',lambda:{'ok':True},methods=['POST'])
            fixture=FastAPI();fixture.include_router(router)
            self.assertEqual(TestClient(fixture).post('/api/admin/fixture',json={}).json(),{'ok':True})
        self.assertEqual(self.source_rows(),[])

    def test_early_enrollment_scheduled_cleanup_removes_absent_sources_using_expiry_index(self):
        with db.connect() as c:
            c.execute("INSERT INTO auth_attempts(key,created) VALUES('enrollment-source:never-returns',now()-interval '2 hours'),('unrelated-old-counter',now()-interval '2 hours'),('enrollment-source:still-current',now())")
            c.execute('SET LOCAL enable_seqscan=off')
            plan=c.execute("EXPLAIN SELECT ctid FROM auth_attempts WHERE key LIKE 'enrollment-source:%' AND created<=now()-interval '1 hour' ORDER BY created LIMIT 2000").fetchall()
            self.assertIn('auth_attempts_enrollment_expiry',str(plan))
        stop=threading.Event();real_cleanup=enrollment_requests.cleanup;removed=[]
        def sweep():
            try:removed.append(real_cleanup())
            finally:stop.set()
        with patch.object(enrollment_requests,'threading') as threads,patch.object(enrollment_requests,'cleanup',side_effect=sweep) as cleanup:
            threads.Event.return_value=stop;threads.Thread.side_effect=threading.Thread
            _,worker=enrollment_requests.start_cleanup();worker.join(timeout=3)
            self.assertFalse(worker.is_alive());cleanup.assert_called_once();self.assertEqual(removed,[1])
        with db.connect() as c:
            keys={r['key'] for r in c.execute('SELECT key FROM auth_attempts').fetchall()}
            self.assertNotIn('enrollment-source:never-returns',keys)
            self.assertIn('unrelated-old-counter',keys);self.assertIn('enrollment-source:still-current',keys)

    def test_public_prefix_official_names_and_legacy_identities(self):
        self.env(KINETTA_SIGNUP='open');self.fixture_names.stop()
        for name in ('zz_test_su_public','kinetta_','k1netta_support','supp0rt','adm1n','he1p','off1c1a1','staff'):
            r=client().post('/api/signup',json=form(name,is_admin=True,allow_test=True,fixture=True));self.assertEqual(r.status_code,400,(name,r.text))
            self.assertFalse(client().get('/api/account/username-availability',params={'login':name}).json()['available'])
        # A public bootstrap result being administrator does not grant the fixture allowance.
        from fastapi import HTTPException
        with db.connect()as c:
            with self.assertRaises(HTTPException)as denied:api_account._create(c,api_account.NewAccountIn(name='Fixture Owner',login='zz_test_su_boot',password=PW),is_admin=True)
            self.assertIn('reserved',denied.exception.detail)
            import secrets
            invitation=secrets.token_urlsafe(24)
            iid=c.execute("INSERT INTO invites(token_hash,expires)VALUES(%s,now()+interval '1 day')RETURNING id",(auth.token_hash(invitation),)).fetchone()['id']
        try:
            r=client().post('/api/join',json={'age_ok':True,'token':invitation,'login':'zz_test_su_invited_public','name':'Fixture Member','password':PW,'allow_test':True,'is_admin':True})
            self.assertEqual(r.status_code,400,r.text)
            with db.connect()as c:self.assertIsNone(c.execute('SELECT used_at FROM invites WHERE id=%s',(iid,)).fetchone()['used_at'])
        finally:
            with db.connect()as c:c.execute('DELETE FROM invites WHERE id=%s',(iid,))
        for i,name in enumerate(('Kinetta','kinetta Support','Kinetta Team','Kinetta Official')):
            self.assertEqual(client().post('/api/signup',json=form('zzsutestofficial'+str(i),name=name)).status_code,400)
        person,uid=self.member('legacy');admin,aid=self.member('official_admin',True)
        self.assertEqual(person.put('/api/account',json={'login':'zz_test_su_changed','is_admin':True,'allow_test':True,'current':'zz_test_su_changed'}).status_code,400)
        self.assertEqual(person.put('/api/account',json={'name':'Kinetta'}).status_code,400)
        with db.connect()as c:c.execute("UPDATE users SET name='Kinetta',login='kinetta' WHERE id=%s",(uid,))
        self.assertEqual(person.put('/api/account',json={'name':'Kinetta','login':'kinetta'}).status_code,200,'unchanged legacy identity remains')
        self.assertEqual(admin.put('/api/account',json={'name':'Admin Fixture Person','login':'zz_test_su_admin_renamed'}).status_code,200)
        with db.connect()as c:
            c.execute("UPDATE users SET login='zz_test_su_legacy' WHERE id=%s",(uid,));token=admin_auth.issue_session(c,aid)
        admin.cookies.set(admin_auth.COOKIE,token,path='/api');admin.headers['X-Admin-CSRF']=admin_auth.csrf(token)
        missing_surname=admin.post('/api/admin/people',json={'name':'Fixture','login':'zz_test_su_bad_admin_create','password':PW})
        self.assertEqual(missing_surname.status_code,400,missing_surname.text)
        self.assertEqual(missing_surname.json()['detail'],'Please add your last name.')
        r=admin.post('/api/admin/people',json={'name':'Fixture Member','login':'zz_test_su_created','password':PW})
        self.assertEqual(r.status_code,200,r.text)
        with db.connect() as c:
            created=c.execute('''SELECT p.share_default,p.share_details,p.share_achievements,
                                         p.share_achievements_since IS NOT NULL AS since_set
                                  FROM profile p JOIN users u ON u.id=p.user_id WHERE u.login='zz_test_su_created' ''').fetchone()
        self.assertEqual(created['share_default'],'everyone')
        self.assertTrue(created['share_details']['heart_rate'] and created['share_achievements'] and created['since_set'],created)

    def test_failed_token_paths_keep_durable_shared_counters(self):
        self.env();person,uid=self.member('tokens')
        with db.connect()as c:
            used=account_email._token(c,uid,'reset_password',60)
            c.execute('UPDATE account_tokens SET used_at=now() WHERE token_hash=%s',(auth.token_hash(used),))
            expired=account_email._token(c,uid,'reset_password',-1)
        for token in ('missing',expired,used):self.assertEqual(client().post('/api/password/reset/check',json={'token':token}).status_code,404)
        for i in range(27):
            r=client().post('/api/password/reset',json={'token':'missing','password':PW})if i%2 else client().post('/api/password/reset/check',json={'token':'missing'})
            self.assertEqual(r.status_code,404,r.text)
        self.assertEqual(client().post('/api/password/reset',json={'token':'missing','password':PW}).status_code,429)
        for i in range(20):self.assertEqual(client().post('/api/account/email/confirm',json={'token':'missing'}).status_code,404)
        self.assertEqual(client().post('/api/account/email/confirm',json={'token':'missing'}).status_code,429)
        with db.connect()as c:
            c.execute('DELETE FROM auth_attempts');valid=account_email._token(c,uid,'reset_password',60)
        for i in range(30):self.assertEqual(client().post('/api/password/reset',json={'token':valid,'password':'abcdefgh'}).status_code,400)
        self.assertEqual(client().post('/api/password/reset',json={'token':valid,'password':PW}).status_code,429)
        with db.connect()as c:
            self.assertIsNone(c.execute('SELECT used_at FROM account_tokens WHERE token_hash=%s',(auth.token_hash(valid),)).fetchone()['used_at'])
            c.execute('DELETE FROM auth_attempts')
        calls=[lambda:client().post('/api/password/reset/check',json={'token':'missing'})for _ in range(4)]
        replies=self.race(*calls)
        for call,reply in zip(calls,replies):
            # Contention is no longer a blocking DB queue. Retry only an explicit
            # busy response, then retain the original exact durable-count guard.
            self.assertIn(reply.status_code,(404,503),reply.text)
            if reply.status_code==503:
                self.assertEqual(reply.headers['Retry-After'],'2')
                reply=call()
            self.assertEqual(reply.status_code,404,reply.text)
        with db.connect()as c:self.assertEqual(c.execute("SELECT count(*)AS n FROM auth_attempts WHERE key LIKE 'reset-ip:%%'").fetchone()['n'],4)

    def test_waitlist_budgets_do_not_block_unrelated_sources(self):
        self.env(KINETTA_SIGNUP='waitlist')
        with db.connect()as c:c.execute("INSERT INTO auth_attempts(key) SELECT 'fail:login:beta' FROM generate_series(1,50)")
        with patch.object(auth,'client_ip',side_effect=lambda r:r.headers.get('x-fixture-source','network-a')):
            body=lambda i:{'name':'Waitlist Fixture','email':f'zz_test_su_wait{i}@example.com','phone':'iphone'}
            for i in range(10):self.assertEqual(client().post('/api/beta',json=body(i)).status_code,200)
            self.assertEqual(client().post('/api/beta',json=body(10)).status_code,429)
            self.assertEqual(client().post('/api/beta',json=body(10),headers={'x-fixture-source':'network-b'}).status_code,200)
            for i in range(3):self.assertEqual(client().post('/api/beta',json=body(11),headers={'x-fixture-source':str(i)}).status_code,200)
            self.assertEqual(client().post('/api/beta',json=body(11),headers={'x-fixture-source':'fresh'}).status_code,429,'email budget crosses sources')

    def test_new_social_budgets_survive_cancel_delete_and_concurrency(self):
        from app import cards
        actor,uid=self.actor();target,tid=self.member('recipient');_,other=self.member('recipient2')
        def earlier_actions():
            # Isolate the pre-existing first-week daily cap from the new burst,
            # duplicate and resend windows. Their live boundaries have their own tests.
            with db.connect() as c:
                c.execute("UPDATE member_action_events SET created=now()-interval '2 days' WHERE user_id=%s",(uid,))
                c.execute('DELETE FROM member_pair_cooldowns WHERE user_id=%s',(uid,))
        def admitted(calls):
            replies=self.race(*calls)
            for index,response in enumerate(replies):
                if response.status_code==503:
                    self.assertEqual(response.json()['detail'],'Kinetta is busy. Please try again shortly.')
                    self.assertEqual(response.headers['Retry-After'],'2');replies[index]=calls[index]()
            return replies
        for _ in range(9):
            earlier_actions()
            self.assertEqual(actor.post('/api/friends',json={'login':'zz_test_su_recipient'}).status_code,200)
            self.assertEqual(actor.delete('/api/friends/zz_test_su_recipient').status_code,200)
        earlier_actions()
        with db.connect()as c:code=cards.own(c,tid)['code']
        self.assertEqual(actor.post('/api/cards/'+code+'/request').status_code,200)
        self.assertEqual(actor.post('/api/friends',json={'login':'zz_test_su_recipient'}).status_code,200,'existing request does not consume budget')
        self.assertEqual(actor.delete('/api/friends/zz_test_su_recipient').status_code,200)
        self.assertEqual(actor.post('/api/cards/'+code+'/request').status_code,429)
        self.assertEqual(actor.post('/api/friends',json={'login':'zz_test_su_recipient'}).status_code,429)
        key=f'new-social:request:{uid}'
        with db.connect()as c:
            c.execute('DELETE FROM auth_attempts WHERE key=%s',(key,));c.execute('INSERT INTO auth_attempts(key)SELECT %s FROM generate_series(1,9)',(key,))
        earlier_actions()
        replies=admitted([lambda:actor.post('/api/cards/'+code+'/request'),lambda:actor.post('/api/friends',json={'login':'zz_test_su_recipient2'})])
        self.assertEqual(sorted(r.status_code for r in replies),[200,429],[r.text for r in replies])
        aid=target.post('/api/activities/manual',json={'sport':'walk','start':'2026-10-01T08:00:00Z','duration_s':60,'distance_m':100}).json()['id']
        target.put(f'/api/activities/{aid}/sharing',json={'visibility':'everyone'})
        for _ in range(20):
            earlier_actions()
            self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'Fixture comment'}).status_code,200)
            with db.connect()as c:cid=c.execute('SELECT id FROM comments WHERE user_id=%s',(uid,)).fetchone()['id']
            self.assertEqual(actor.delete(f'/api/comments/{cid}').status_code,200)
        self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'Over budget'}).status_code,429)
        key=f'new-social:comment:{uid}'
        with db.connect()as c:
            c.execute('DELETE FROM auth_attempts WHERE key=%s',(key,));c.execute('INSERT INTO auth_attempts(key)SELECT %s FROM generate_series(1,19)',(key,))
        earlier_actions()
        replies=admitted([lambda index=index:actor.post(f'/api/activities/{aid}/comments',json={'text':'Concurrent comment '+str(index)})for index in range(2)])
        self.assertEqual(sorted(r.status_code for r in replies),[200,429])
        with db.connect()as c:c.execute("UPDATE auth_attempts SET created=now()-interval '25 hours' WHERE key=%s",(key,))
        self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'Next rolling day'}).status_code,200)
        with db.connect()as c:
            c.execute('INSERT INTO auth_attempts(key)SELECT %s FROM generate_series(1,20)',(key,))
            c.execute("UPDATE users SET signup_confirmed_at=now()-interval '8 days' WHERE id=%s",(uid,));stamp=c.execute('SELECT signup_confirmed_at FROM users WHERE id=%s',(uid,)).fetchone()['signup_confirmed_at']
            token=account_email._token(c,uid,'verify_email',60,'zz_test_su_replacement@example.com')
        self.assertEqual(client().post('/api/account/email/confirm',json={'token':token}).status_code,200)
        with db.connect()as c:self.assertEqual(c.execute('SELECT signup_confirmed_at FROM users WHERE id=%s',(uid,)).fetchone()['signup_confirmed_at'],stamp)
        self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'After seven days'}).status_code,200)
        self.assertNotIn('signup_confirmed_at',actor.get('/api/me').json())
        with db.connect()as c:token=account_email._token(c,tid,'verify_email',60,'zz_test_su_old@example.com')
        self.assertEqual(client().post('/api/account/email/confirm',json={'token':token}).status_code,200)
        with db.connect()as c:self.assertIsNone(c.execute('SELECT signup_confirmed_at FROM users WHERE id=%s',(tid,)).fetchone()['signup_confirmed_at'])

    def test_capacity_notices_run_after_account_write_locks(self):
        self.env(KINETTA_SIGNUP='open',KINETTA_MAX_ACCOUNTS=self.real_accounts()+1)
        original=signup.admin_notice;held=[]
        def inspect(c,**kw):
            held.append(c.execute("SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND relation='users'::regclass AND mode IN('RowExclusiveLock','ShareRowExclusiveLock'))AS x").fetchone()['x'])
            return original(c,**kw)
        with patch.object(signup,'admin_notice',side_effect=inspect):
            self.assertEqual(client().post('/api/signup',json=form('zz_test_su_notice_order')).status_code,200)
        self.assertTrue(held);self.assertFalse(any(held),'notice recipient locks cannot reverse the account/cap order')
        self.env(KINETTA_SIGNUP='open',KINETTA_MAX_ACCOUNTS='')
        with patch.object(signup,'admin_notice',side_effect=signup.DatabaseError('fixture notice outage')),self.assertLogs('uvicorn.error',level='WARNING'):
            self.assertEqual(client().post('/api/signup',json=form('zz_test_su_notice_outage')).status_code,200,'an auxiliary notice cannot fail a committed signup')

    def test_admin_bell_notice_is_aggregate_daily_and_role_guarded(self):
        admin,uid=self.member('notice_admin',True);member,mid=self.member('notice_member')
        while self.real_accounts()%9:self.member('notice_padding'+str(self.real_accounts()))
        self.env(KINETTA_MAX_ACCOUNTS=self.real_accounts()*10//9)
        with patch('app.notify.add')as ordinary_push,patch('app.account_email.send')as email:
            with db.connect()as c:
                signup.admin_notice(c);signup.admin_notice(c,waitlist_new=True)
                self.assertEqual(c.execute("SELECT count(*)AS n FROM notifications WHERE user_id=%s AND kind='signup_admin'",(uid,)).fetchone()['n'],1)
                c.execute("UPDATE notifications SET read_at=now() WHERE user_id=%s AND kind='signup_admin'",(uid,));signup.admin_notice(c)
            ordinary_push.assert_not_called();email.assert_not_called()
        items=admin.get('/api/notifications').json()['items'];notice=next(n for n in items if n['kind']=='signup_admin')
        self.assertEqual(notice['who']['name'],'Kinetta');self.assertNotIn('example.test',notice['text'])
        self.assertFalse(any(n['kind']=='signup_admin'for n in member.get('/api/notifications').json()['items']))
        with db.connect()as c:
            c.execute("UPDATE notifications SET created=now()-interval '25 hours' WHERE user_id=%s AND kind='signup_admin'",(uid,));signup.admin_notice(c,waitlist_new=True)
            self.assertEqual(c.execute("SELECT count(*)AS n FROM notifications WHERE user_id=%s AND kind='signup_admin'",(uid,)).fetchone()['n'],2)
            c.execute('UPDATE users SET is_admin=false WHERE id=%s',(uid,))
        self.assertFalse(any(n['kind']=='signup_admin'for n in admin.get('/api/notifications').json()['items']))

if __name__ == '__main__': unittest.main()
