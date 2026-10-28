"""People you may know and invite links (2026-10-25). Fictional zz_test accounts; the mail provider is a stand-in."""
import base64, os, re, unittest
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, signup
from app.main import app

PW = 'test account private password'
ENV = {'KINETTA_RESEND_KEY': 'stand-in-not-a-key', 'KINETTA_MAIL_FROM': 'Kinetta <hello@example.test>', 'KINETTA_MAIL_REPLY_TO': 'support@example.test', 'KINETTA_PUBLIC_URL': 'https://example.test',
       'KINETTA_MAIL_WEBHOOK_SECRET': 'whsec_' + base64.b64encode(b'fictional-webhook-key').decode(), 'KINETTA_SIGNUP': 'open', 'KINETTA_MAX_ACCOUNTS': ''}


def client():
    c = TestClient(app); c.headers['Origin'] = 'http://testserver'; return c


def receipt(*a, **k):
    return httpx.Response(200, json={'id': 'fictional'}, request=httpx.Request('POST', 'https://api.resend.com/emails'))


class FriendLinks(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        with db.connect() as c: c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_fl%%'"); c.execute('DELETE FROM auth_attempts')

    def setUp(self):
        self.tearDownClass()
        p = patch.dict(os.environ, ENV); p.start(); self.addCleanup(p.stop)
        self.mail = patch('app.account_email.httpx.post', side_effect=receipt).start(); self.addCleanup(patch.stopall)
        patch.object(signup, 'TEST_ACCOUNTS', 'no such account prefix%').start()

    def person(self, login, confirmed=True, **form):
        c = client()
        with db.connect() as d: d.execute('DELETE FROM auth_attempts')     # five signups an hour from one address
        r = c.post('/api/signup', json={'name': login.replace('zz_test_fl_', '').title(), 'login': login, 'email': login + '@example.test',
                                        'password': PW, 'age_ok': True, 'tz': 'UTC', **form})
        self.assertEqual(r.status_code, 200, r.text)
        if confirmed:
            with db.connect() as d: d.execute('UPDATE users SET needs_email_confirm = false WHERE login = %s', (login,))
        return c

    def friends(self, c): return {p['login'] for p in c.get('/api/friends').json()['friends']}

    def test_invite_link(self):
        ann, bo, cy = self.person('zz_test_fl_ann'), self.person('zz_test_fl_bo'), self.person('zz_test_fl_cy')
        link = ann.get('/api/friends/link').json(); code = link['url'].rsplit('/', 1)[1]
        self.assertTrue(link['url'].startswith('https://example.test/add/'))
        self.assertEqual(ann.get('/api/friends/link').json()['url'], link['url'], 'the same link until it is replaced')
        self.assertEqual(client().get('/api/friend-links/' + code).json(), {'name': '@zz_test_fl_ann'}, 'signed-out preview: username only')
        self.assertEqual(ann.post('/api/friend-links/' + code, json={}).status_code, 400, 'not your own link')
        r = bo.post('/api/friend-links/' + code, json={}).json(); self.assertEqual((r['status'], r['new']), ('friends', True))
        self.assertIn('zz_test_fl_bo', self.friends(ann)); self.assertFalse(bo.post('/api/friend-links/' + code, json={}).json()['new'])
        notes = ann.get('/api/notifications').json()
        self.assertTrue(any(n.get('kind') == 'friend_accepted' for n in (notes.get('items', notes) if isinstance(notes, dict) else notes)), 'owner is told')
        # a pending request either way becomes a friendship, with no request left behind
        cy.post('/api/friends', json={'login': 'zz_test_fl_ann'})
        cy.post('/api/friend-links/' + code, json={}); self.assertIn('zz_test_fl_cy', self.friends(ann)); self.assertEqual(ann.get('/api/friends').json()['incoming'], [])
        # a new link retires the old; blocked people and expired links get the same 404
        new = ann.post('/api/friends/link/new', json={}).json()['url'].rsplit('/', 1)[1]
        self.assertEqual(client().get('/api/friend-links/' + code).status_code, 404)
        dee = self.person('zz_test_fl_dee'); dee.post('/api/people/zz_test_fl_ann/block', json={})
        self.assertEqual(dee.post('/api/friend-links/' + new, json={}).status_code, 404)
        with db.connect() as d: d.execute("UPDATE friend_links SET expires = now() - interval '1 minute' WHERE code = %s", (new,))
        self.assertEqual(self.person('zz_test_fl_eve').post('/api/friend-links/' + new, json={}).status_code, 404)
        self.assertNotEqual(ann.get('/api/friends/link').json()['url'].rsplit('/', 1)[1], new, 'an expired link is replaced')

    def test_signup_through_link_waits_for_email(self):
        ann = self.person('zz_test_fl_ann'); code = ann.get('/api/friends/link').json()['url'].rsplit('/', 1)[1]
        self.mail.reset_mock()
        new = self.person('zz_test_fl_new', confirmed=False, friend_link=code)
        self.assertEqual(new.post('/api/friend-links/' + code, json={}).status_code, 403, 'unconfirmed accounts cannot use links yet')
        self.assertNotIn('zz_test_fl_new', self.friends(ann), 'not friends before the email is confirmed')
        token = re.search(r'/confirm-email/([\w-]+)', self.mail.call_args_list[0].kwargs['json']['text']).group(1)
        self.assertEqual(client().post('/api/account/email/confirm', json={'token': token}).status_code, 200)
        self.assertIn('zz_test_fl_new', self.friends(ann))
        with db.connect() as d: self.assertIsNone(d.execute("SELECT p.friend_link FROM profile p JOIN users u ON u.id = p.user_id WHERE u.login = 'zz_test_fl_new'").fetchone()['friend_link'])
        # a bad link at signup never blocks the account
        self.mail.reset_mock(); self.person('zz_test_fl_odd', confirmed=False, friend_link='no-such-link')
        token = re.search(r'/confirm-email/([\w-]+)', self.mail.call_args_list[0].kwargs['json']['text']).group(1)
        self.assertEqual(client().post('/api/account/email/confirm', json={'token': token}).status_code, 200)

    def test_app_links_and_preview(self):
        with patch.dict(os.environ, {'KINETTA_APNS_TEAM_ID': ''}): self.assertEqual(client().get('/.well-known/apple-app-site-association').status_code, 404)
        with patch.dict(os.environ, {'KINETTA_APNS_TEAM_ID': 'TEAMFICT01', 'KINETTA_APNS_TOPIC': 'com.kinetta.app'}):
            r = client().get('/.well-known/apple-app-site-association')
            self.assertEqual(r.status_code, 200); self.assertEqual(r.headers['content-type'], 'application/json')
            self.assertEqual(r.json()['applinks']['details'][0], {'appIDs': ['TEAMFICT01.com.kinetta.app'], 'components': [
                {'/': '/add/*', 'comment': 'friend invite links'},
                {'/': '/card/*', 'comment': 'revocable public cards'},
                {'/': '/challenge/*', 'comment': 'explicit challenge previews'},
                {'/': '/routes/shared/*', 'comment': 'signed-in shared route links'}]})
        ann = self.person('zz_test_fl_ann'); code = ann.get('/api/friends/link').json()['url'].rsplit('/', 1)[1]
        with db.connect() as d: d.execute("UPDATE users SET name = 'Ann <b>&' WHERE login = 'zz_test_fl_ann'")
        page = client().get('/add/' + code).text
        self.assertIn('<meta property="og:title" content="Join @zz_test_fl_ann on Kinetta">', page, 'public preview uses the username'); self.assertNotIn('Ann &lt;b&gt;&amp;',page,'real names stay private')
        self.assertIn('<meta property="og:title" content="Kinetta">', client().get('/add/no-such-code').text, 'unknown links get the plain page')

    def test_people_you_may_know(self):
        ann, bo, cy, hid, blk = (self.person('zz_test_fl_' + n) for n in ('ann', 'bo', 'cy', 'hid', 'blk'))
        self.person('zz_test_fl_unc', confirmed=False)
        for a, b in [(ann, 'zz_test_fl_bo'), (cy, 'zz_test_fl_bo'), (hid, 'zz_test_fl_bo'), (blk, 'zz_test_fl_bo')]:
            a.post('/api/friends', json={'login': b})
        for who in ('ann', 'cy', 'hid', 'blk'): bo.post(f'/api/friends/zz_test_fl_{who}/accept', json={})
        hid.put('/api/sharing', json={'findable': False}); ann.post('/api/people/zz_test_fl_blk/block', json={})
        got = {p['login']: p['why'] for p in ann.get('/api/people/suggested').json() if p['login'].startswith('zz_test_fl')}
        self.assertEqual(got.get('zz_test_fl_cy'), '1 mutual friend')
        for gone in ('zz_test_fl_bo', 'zz_test_fl_hid', 'zz_test_fl_blk', 'zz_test_fl_unc', 'zz_test_fl_ann'): self.assertNotIn(gone, got, gone)
        self.assertTrue(set(ann.get('/api/people/suggested').json()[0]) == {'login', 'name', 'photo', 'why'}, 'nothing else about anyone')


unittest.main()
