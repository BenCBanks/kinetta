"""Open signup with an email, the account cap and new-account restrictions (#232 D); the mail provider is a stand-in."""
import base64, os, re, threading, unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth, signup, admin_auth, api_account, account_email
from app.main import app

PW = 'test account private password'
BASE = 'http://testserver'
MAIL = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.test>',
        'KINETTA_MAIL_REPLY_TO': 'support@example.test', 'KINETTA_PUBLIC_URL': 'https://example.test',
        'KINETTA_MAIL_WEBHOOK_SECRET': 'whsec_' + base64.b64encode(b'fictional-webhook-key').decode()}


def receipt(*a, **k):
    return httpx.Response(200, json={'id': 'fictional'}, request=httpx.Request('POST', 'https://api.resend.com/emails'))


def client():
    c = TestClient(app); c.headers.update({'Origin':BASE,'Content-Type':'application/json'}); return c


def form(login, **extra):
    return {'name': 'Signup Test', 'login': login, 'email': login + '@example.test', 'password': PW, 'age_ok': True, 'tz': 'UTC', **extra}


class Signup(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_su%%' OR login LIKE 'zzsutest%%'"); c.execute('DELETE FROM auth_attempts')
            c.execute("DELETE FROM beta_requests WHERE email LIKE 'zz_test_su%%@example.test'")

    def setUp(self):
        self.tearDownClass()
        self.mail = patch('app.account_email.httpx.post', side_effect=receipt).start(); self.addCleanup(patch.stopall)
        # Trusted fixtures may use reserved test handles; cap counting remains the real production query.
        original = api_account.reserved_login
        self.fixture_names = patch.object(api_account, 'reserved_login', side_effect=lambda v, **kw: original(v, allow_test=True))
        self.fixture_names.start()

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
        self.assertTrue(me['needs_email_confirm']); self.assertEqual(me['pending_email'], 'zz_test_su_new@example.test'); self.assertIsNone(me['email'])
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
        self.assertEqual({k: v for k, v in client().get('/api/signup').json().items() if k != 'iphone_app'}, {'open': False, 'full': True})
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
        r1 = a.post('/api/signup', json={**body, 'name': 'Zzsutest Person', 'email': 'zz_test_su_n1@example.test'}).json()
        r2 = b.post('/api/signup', json={**body, 'name': 'Zzsütest Other', 'email': 'zz_test_su_n2@example.test'}).json()
        self.assertEqual((r1['login'], r2['login']), ('zzsutest', 'zzsutest2'), 'from the first name, accents dropped, then numbered')
        # confirm, then the email is the login and the username can change freely
        token = re.search(r'/confirm-email/([\w-]+)', self.mail.call_args_list[0].kwargs['json']['text']).group(1)
        client().post('/api/account/email/confirm', json={'token': token})
        self.assertEqual(a.put('/api/account', json={'login': 'zz_test_su_gamertag'}).json()['login'], 'zz_test_su_gamertag')
        self.assertEqual(a.put('/api/account', json={'login': 'zz_test_su_gamertag2'}).status_code, 200, 'again, whenever they like')
        self.assertEqual(b.put('/api/account', json={'login': 'zz_test_su_gamertag2'}).status_code, 409, 'but not to a taken one')
        self.assertEqual(client().post('/api/login', json={'login': 'zz_test_su_n1@example.test', 'password': PW}).status_code, 200)
        with db.connect() as c: c.execute("DELETE FROM users WHERE login LIKE 'zzsutest%%'")

    def test_invite_join_with_email(self):
        self.env()
        import secrets
        token = secrets.token_urlsafe(24)
        with db.connect() as c: c.execute("INSERT INTO invites (token_hash, note, expires) VALUES (%s, 'zz', now() + interval '1 day')", (auth.token_hash(token),))
        self.assertTrue(client().get('/api/join/' + token).json()['email'], 'the join page can ask for an email')
        j = client()
        r = j.post('/api/join', json={'name': 'Zz_test_su_joiner Invited', 'email': 'zz_test_su_joiner@example.test', 'password': PW, 'token': token})
        self.assertEqual(r.status_code, 200, r.text); self.assertTrue(r.json()['login'].startswith('zz_test_su_joiner'))
        self.assertEqual(self.mail.call_args.kwargs['json']['to'], ['zz_test_su_joiner@example.test'])
        me = j.get('/api/me').json()
        self.assertFalse(me['needs_email_confirm'], 'invited people are not held back'); self.assertEqual(me['pending_email'], 'zz_test_su_joiner@example.test')

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
        self.assertIn('Welcome', mail['subject']); self.assertIn('beta', mail['text']); self.assertIn('https://testflight.apple.com/join/zzFICTION', mail['text'])
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
        token=re.search(r'/confirm-email/([\w-]+)',self.mail.call_args.kwargs['json']['text']).group(1)
        self.assertEqual(client().post('/api/account/email/confirm',json={'token':token}).status_code,200)
        return person,person.get('/api/me').json()['id']

    def race(self, *calls):
        barrier=threading.Barrier(len(calls))
        def run(call):barrier.wait();return call()
        with ThreadPoolExecutor(max_workers=len(calls))as pool:return[f.result(timeout=20)for f in[pool.submit(run,call)for call in calls]]

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
            r=client().post('/api/join',json={'token':invitation,'login':'zz_test_su_invited_public','name':'Fixture Member','password':PW,'allow_test':True,'is_admin':True})
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
        self.assertEqual(admin.put('/api/account',json={'name':'Kinetta Official','login':'zz_test_su_admin_renamed'}).status_code,200)
        with db.connect()as c:
            c.execute("UPDATE users SET login='zz_test_su_legacy' WHERE id=%s",(uid,));token=admin_auth.issue_session(c,aid)
        admin.cookies.set(admin_auth.COOKIE,token,path='/api');admin.headers['X-Admin-CSRF']=admin_auth.csrf(token)
        r=admin.post('/api/admin/people',json={'name':'Fixture Member','login':'zz_test_su_created','password':PW})
        self.assertEqual(r.status_code,200,r.text)

    def test_failed_token_paths_keep_durable_shared_counters(self):
        self.env();person,uid=self.member('tokens')
        with db.connect()as c:
            used=account_email._token(c,uid,'reset_password',60)
            c.execute('UPDATE account_tokens SET used_at=now() WHERE token_hash=%s',(auth.token_hash(used),))
            expired=account_email._token(c,uid,'reset_password',-1)
        for token in ('missing',expired,used):self.assertEqual(client().get('/api/password/reset/'+token).status_code,404)
        for i in range(27):
            r=client().post('/api/password/reset',json={'token':'missing','password':PW})if i%2 else client().get('/api/password/reset/missing')
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
        replies=self.race(*[lambda:client().get('/api/password/reset/missing')for _ in range(4)])
        self.assertEqual([r.status_code for r in replies],[404]*4)
        with db.connect()as c:self.assertEqual(c.execute("SELECT count(*)AS n FROM auth_attempts WHERE key LIKE 'reset-ip:%%'").fetchone()['n'],4)

    def test_waitlist_budgets_do_not_block_unrelated_sources(self):
        self.env(KINETTA_SIGNUP='waitlist')
        with db.connect()as c:c.execute("INSERT INTO auth_attempts(key) SELECT 'fail:login:beta' FROM generate_series(1,50)")
        with patch.object(auth,'client_ip',side_effect=lambda r:r.headers.get('x-fixture-source','network-a')):
            body=lambda i:{'name':'Waitlist Fixture','email':f'zz_test_su_wait{i}@example.test','phone':'iphone'}
            for i in range(10):self.assertEqual(client().post('/api/beta',json=body(i)).status_code,200)
            self.assertEqual(client().post('/api/beta',json=body(10)).status_code,429)
            self.assertEqual(client().post('/api/beta',json=body(10),headers={'x-fixture-source':'network-b'}).status_code,200)
            for i in range(3):self.assertEqual(client().post('/api/beta',json=body(11),headers={'x-fixture-source':str(i)}).status_code,200)
            self.assertEqual(client().post('/api/beta',json=body(11),headers={'x-fixture-source':'fresh'}).status_code,429,'email budget crosses sources')

    def test_new_social_budgets_survive_cancel_delete_and_concurrency(self):
        from app import cards
        actor,uid=self.actor();target,tid=self.member('recipient');_,other=self.member('recipient2')
        for _ in range(9):
            self.assertEqual(actor.post('/api/friends',json={'login':'zz_test_su_recipient'}).status_code,200)
            self.assertEqual(actor.delete('/api/friends/zz_test_su_recipient').status_code,200)
        with db.connect()as c:code=cards.own(c,tid)['code']
        self.assertEqual(actor.post('/api/cards/'+code+'/request').status_code,200)
        self.assertEqual(actor.post('/api/friends',json={'login':'zz_test_su_recipient'}).status_code,200,'existing request does not consume budget')
        self.assertEqual(actor.delete('/api/friends/zz_test_su_recipient').status_code,200)
        self.assertEqual(actor.post('/api/cards/'+code+'/request').status_code,429)
        self.assertEqual(actor.post('/api/friends',json={'login':'zz_test_su_recipient'}).status_code,429)
        key=f'new-social:request:{uid}'
        with db.connect()as c:
            c.execute('DELETE FROM auth_attempts WHERE key=%s',(key,));c.execute('INSERT INTO auth_attempts(key)SELECT %s FROM generate_series(1,9)',(key,))
        replies=self.race(lambda:actor.post('/api/cards/'+code+'/request'),lambda:actor.post('/api/friends',json={'login':'zz_test_su_recipient2'}))
        self.assertEqual(sorted(r.status_code for r in replies),[200,429],[r.text for r in replies])
        aid=target.post('/api/activities/manual',json={'sport':'walk','start':'2026-10-01T08:00:00Z','duration_s':60,'distance_m':100}).json()['id']
        target.put(f'/api/activities/{aid}/sharing',json={'visibility':'everyone'})
        for _ in range(20):
            self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'Fixture comment'}).status_code,200)
            with db.connect()as c:cid=c.execute('SELECT id FROM comments WHERE user_id=%s',(uid,)).fetchone()['id']
            self.assertEqual(actor.delete(f'/api/comments/{cid}').status_code,200)
        self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'Over budget'}).status_code,429)
        key=f'new-social:comment:{uid}'
        with db.connect()as c:
            c.execute('DELETE FROM auth_attempts WHERE key=%s',(key,));c.execute('INSERT INTO auth_attempts(key)SELECT %s FROM generate_series(1,19)',(key,))
        replies=self.race(*[lambda:actor.post(f'/api/activities/{aid}/comments',json={'text':'Concurrent comment'})for _ in range(2)])
        self.assertEqual(sorted(r.status_code for r in replies),[200,429])
        with db.connect()as c:c.execute("UPDATE auth_attempts SET created=now()-interval '25 hours' WHERE key=%s",(key,))
        self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'Next rolling day'}).status_code,200)
        with db.connect()as c:
            c.execute('INSERT INTO auth_attempts(key)SELECT %s FROM generate_series(1,20)',(key,))
            c.execute("UPDATE users SET signup_confirmed_at=now()-interval '8 days' WHERE id=%s",(uid,));stamp=c.execute('SELECT signup_confirmed_at FROM users WHERE id=%s',(uid,)).fetchone()['signup_confirmed_at']
            token=account_email._token(c,uid,'verify_email',60,'zz_test_su_replacement@example.test')
        self.assertEqual(client().post('/api/account/email/confirm',json={'token':token}).status_code,200)
        with db.connect()as c:self.assertEqual(c.execute('SELECT signup_confirmed_at FROM users WHERE id=%s',(uid,)).fetchone()['signup_confirmed_at'],stamp)
        self.assertEqual(actor.post(f'/api/activities/{aid}/comments',json={'text':'After seven days'}).status_code,200)
        self.assertNotIn('signup_confirmed_at',actor.get('/api/me').json())
        with db.connect()as c:token=account_email._token(c,tid,'verify_email',60,'zz_test_su_old@example.test')
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
