"""Community publication boundaries and private agreement records; fictional accounts, no providers."""
import datetime as dt
import os
import unittest
import uuid
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import auth, db, community_filter as filtering, community_terms as terms, route_providers
from app.main import app
from app.admin_auth import admin_user

PW = 'fictional community test password'


class Matching(unittest.TestCase):
    def test_matching_copy_never_changes_input(self):
        for text in ('FUCK!', '@fuck', 'fuck@', 'f4gg0t@', '$f.u.c.k$', 'f.u.c.k', 'f_u_c_k', 'f u c k', 'fück', 'f\u200buck', 'f4gg0t', 'a$$hole', 'fucker', 'fucking'):
            with self.subTest(text=text), self.assertRaises(HTTPException): filtering.check(text, 'comment')
        for text in ('Scunthorpe', 'Class hill', 'Bass fishing', 'Dickens trail', 'Fuchsia flowers', 'suffering', 'ordinary route'):
            filtering.check(text)
        original = '  ordinary route  '; filtering.check(original); self.assertEqual(original, '  ordinary route  ')

    def test_draft_and_unmatched_configuration_fail_closed(self):
        with patch.dict(os.environ, {'KINETTA_TERMS_VERSION': terms.DOCUMENT['version']}):
            with self.assertRaises(ValueError): terms.active_version()
        with patch.dict(os.environ, {'KINETTA_TERMS_VERSION': ''}): self.assertIsNone(terms.active_version())
        with patch.dict(os.environ, {'KINETTA_TERMS_VERSION': 'wrong'}), patch.dict(terms.DOCUMENT, {'draft': False}):
            with self.assertRaises(ValueError): terms.active_version()


class Publication(unittest.TestCase):
    sequence = 0
    @classmethod
    def setUpClass(cls):
        cls.tag = uuid.uuid4().hex[:8]; cls.ids = {}; cls.clients = {}
        with db.connect() as c:
            for key in ('owner', 'friend', 'stranger', 'admin'):
                name = 'zz_test_cm_' + cls.tag + '_' + key
                uid = c.execute('INSERT INTO users(login,name,pw_hash,is_admin) VALUES(%s,%s,%s,%s) RETURNING id',
                                (name, key.title()+' Example', auth.hash_pw(PW), key=='admin')).fetchone()['id']
                c.execute('INSERT INTO profile(user_id,share_default) VALUES(%s,\'me\')', (uid,))
                client = TestClient(app); client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'})
                client.cookies.set(auth.COOKIE, auth.new_session(c,uid,'community-fixture'))
                cls.ids[key] = uid; cls.clients[key] = client
            c.execute("INSERT INTO friendships(requester,addressee,status) VALUES(%s,%s,'accepted')",(cls.ids['owner'],cls.ids['friend']))
        cls.names = {k:'zz_test_cm_'+cls.tag+'_'+k for k in cls.ids}
        cls.admin_patch = patch.dict(app.dependency_overrides, {admin_user: lambda:{'id':cls.ids['admin'],'login':cls.names['admin'],'is_admin':True}})
        cls.admin_patch.start()

    @classmethod
    def tearDownClass(cls):
        cls.admin_patch.stop()
        from app.api_account import erase, erase_files
        with db.connect() as c:
            for uid in cls.ids.values(): erase(c, {'id':uid,'sql_role':None})
        for uid in cls.ids.values(): erase_files(uid)

    def q(self, who, method, path, body=None, status=200):
        r = self.clients[who].request(method,path,json=body if body is not None else ({} if method!='GET' else None))
        self.assertEqual(r.status_code,status, (method,path,r.text[:350]))
        return r.json()

    def activity(self, name='Fictional walk', description=None):
        type(self).sequence += 1
        return self.q('owner','POST','/api/activities/manual',{'name':name,'sport':'walk','start':(dt.datetime(2026,1,1,tzinfo=dt.timezone.utc)+dt.timedelta(days=self.sequence)).isoformat(), 'duration_s':600,'distance_m':900,'description':description})['id']

    def test_public_identity_and_both_bio_writers(self):
        self.q('owner','PUT','/api/account',{'login':'fucker2'},400)
        for field in ('name','login','bio'):
            self.q('owner','PUT','/api/account',{field:'asshole'},400)
        self.q('owner','PUT','/api/profile',{'bio':'asshole'},400)
        self.q('owner','PUT','/api/profile',{'bio':'Scunthorpe walker'})

    def test_private_activity_then_public_or_hidden_description(self):
        aid=self.activity('asshole','fuck')
        self.q('owner','PATCH',f'/api/activities/{aid}',{'private_note':'fuck'})
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'visibility':'friends'},400)
        self.q('owner','PATCH',f'/api/activities/{aid}',{'name':'Ordinary walk'})
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'visibility':'friends','details':{'description':False}})
        self.q('owner','PATCH',f'/api/activities/{aid}',{'description':'fuck'})
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'details':{'description':True}},400)
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'usual_details':True},400)
        self.q('owner','PATCH',f'/api/activities/{aid}',{'name':'asshole'},400)
        self.q('owner','PATCH',f'/api/activities/{aid}',{'sport_label':'asshole'},400)
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'visibility':'me'})
        self.q('owner','PATCH',f'/api/activities/{aid}',{'name':'asshole'})
        self.q('stranger','PUT',f'/api/activities/{aid}/sharing',{'visibility':'everyone'},404)

    def test_global_description_exposure_and_comments(self):
        aid=self.activity(description='fuck')
        self.q('owner','PUT','/api/sharing',{'details':{'description':False}})
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'visibility':'friends','usual_details':True})
        self.q('owner','PUT','/api/sharing',{'details':{'description':True}},400)
        self.q('friend','POST',f'/api/activities/{aid}/comments',{'text':'fuck'},400)
        self.q('friend','POST',f'/api/activities/{aid}/comments',{'text':'Well done'})
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'details':{'description':False}})
        self.q('owner','PUT','/api/sharing',{'details':{'description':True}})
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'usual_details':True},400)

    def test_track_only_me_uses_explicit_audience(self):
        self.q('owner','PUT','/api/sharing',{'default':'everyone'})
        payload={'client_id':str(uuid.uuid4()),'name':'asshole','sport':'walk','start':(dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=10)).isoformat(),'elapsed_s':300,'moving_s':300,'points':[],'visibility':'me'}
        self.q('owner','POST','/api/activities/track',payload)
        payload.update(client_id=str(uuid.uuid4()),visibility='everyone')
        self.q('owner','POST','/api/activities/track',payload,400)
        self.q('owner','PUT','/api/sharing',{'default':'me'})

    def test_shared_recipe_name_and_scoped_reporting(self):
        dish=self.q('owner','POST','/api/dishes',{'name':'asshole'})
        did=dish['id']
        self.q('owner','POST',f'/api/dishes/{did}/share',{'login':self.names['friend']},400)
        self.q('owner','PATCH',f'/api/dishes/{did}',{'name':'Fictional soup'})
        self.q('owner','POST',f'/api/dishes/{did}/share',{'login':self.names['friend']})
        self.q('owner','PATCH',f'/api/dishes/{did}',{'name':'asshole'},400)
        body={'login':self.names['owner'],'dish_id':did,'reason':'abuse'}
        rid=self.q('friend','POST','/api/reports',body)['id']
        self.q('stranger','POST','/api/reports',body,404)
        self.q('friend','POST','/api/reports',{**body,'login':self.names['stranger']},404)
        self.q('friend','POST','/api/reports',{**body,'activity_id':123},400)
        review=self.q('admin','GET',f'/api/admin/review/{rid}')
        self.assertEqual(set(review['item']),{'name'})
        self.assertIn('unshare_dish',[x['value']for x in review['actions']])
        decision={'request_key':str(uuid.uuid4()),'requested_at':dt.datetime.now(dt.timezone.utc).isoformat(),'action':'unshare_dish','version':review['version'],'confirm':self.names['owner']}
        self.q('admin','POST',f'/api/admin/review/{rid}',decision)
        self.q('admin','POST',f'/api/admin/review/{rid}',decision)
        self.q('friend','GET',f'/api/dishes/{did}',status=404)
        self.q('owner','GET',f'/api/dishes/{did}')

    def test_existing_rls_and_report_privileges_are_preserved(self):
        with db.connect() as c:
            self.assertTrue(c.execute("SELECT relrowsecurity FROM pg_class WHERE oid='profile'::regclass").fetchone()['relrowsecurity'])
            self.assertTrue(c.execute("SELECT 1 FROM pg_policies WHERE tablename='profile' AND policyname='own_rows'").fetchone())
            for column in ('terms_version','terms_accepted_at'):
                self.assertTrue(c.execute("SELECT has_column_privilege('fit_readers','profile',%s,'SELECT') AS allowed",(column,)).fetchone()['allowed'])
            for column in ('dish_id','challenge_id'):
                self.assertFalse(c.execute("SELECT has_column_privilege('fit_readers','reports',%s,'SELECT') AS allowed",(column,)).fetchone()['allowed'])

    def test_private_comments_are_checked_when_activity_is_published(self):
        aid=self.activity()
        self.q('owner','POST',f'/api/activities/{aid}/comments',{'text':'fuck'})
        self.q('owner','PUT',f'/api/activities/{aid}/sharing',{'visibility':'friends'},400)

    def test_recipe_report_never_exposes_a_later_private_name(self):
        did=self.q('owner','POST','/api/dishes',{'name':'Shared example'})['id']
        self.q('owner','POST',f'/api/dishes/{did}/share',{'login':self.names['friend']})
        rid=self.q('friend','POST','/api/reports',{'login':self.names['owner'],'dish_id':did,'reason':'other'})['id']
        self.q('owner','DELETE',f'/api/dishes/{did}/share/{self.names["friend"]}')
        self.q('owner','PATCH',f'/api/dishes/{did}',{'name':'Private unrevealed name'})
        review=self.q('admin','GET',f'/api/admin/review/{rid}')
        self.assertNotIn('Private unrevealed name',str(review))
        self.assertIn('Shared example',str(review['item']))
        self.assertEqual([x['value']for x in review['actions']],['dismiss'])

    def test_segments_private_creation_and_publication(self):
        from app import route_geo
        body={'client_id':str(uuid.uuid4()),'name':'asshole','description':'fuck','sport':'walk',
              'line':route_geo.encode([[45.3,10.2],[45.304,10.2]]),'source':'map','audience':'me','understood_fixed':True}
        with patch.object(route_providers,'elevation',return_value=None):
            sid=self.q('owner','POST','/api/segments',body)['id']
            self.q('owner','POST',f'/api/segments/{sid}/publish',{'understood_public':True},400)
            body.update(client_id=str(uuid.uuid4()),audience='everyone')
            self.q('owner','POST','/api/segments',body,400)
            body.update(client_id=str(uuid.uuid4()),name='Fictional path',description='Ordinary public description')
            self.q('owner','POST','/api/segments',body)

    def test_challenge_report_and_admin_target_are_public_only(self):
        challenge=self.q('owner','POST','/api/challenges',{'kind':'distance','target':10,'unit':'km','sports':['walk'],'period':'next_week','request_id':uuid.uuid4().hex})
        body={'login':self.names['owner'],'challenge_code':challenge['code'],'reason':'other'}
        rid=self.q('friend','POST','/api/reports',body)['id']
        self.q('friend','POST','/api/reports',{**body,'login':self.names['stranger']},404)
        review=self.q('admin','GET',f'/api/admin/review/{rid}')
        self.assertEqual(set(review['item']),{'name'})
        self.assertNotIn('people',str(review['item'])); self.assertNotIn('protein_target',str(review))
        self.q('admin','POST',f'/api/admin/review/{rid}',{'request_key':str(uuid.uuid4()),'requested_at':dt.datetime.now(dt.timezone.utc).isoformat(),'action':'remove_challenge','version':review['version'],'confirm':self.names['owner']})
        self.q('friend','GET','/api/challenges/'+challenge['code'],status=404)

    def test_invite_signup_require_exact_published_version(self):
        from app import account_email
        document={**terms.DOCUMENT,'draft':False,'version':'fixture-approved-signup'}
        guest=TestClient(app); guest.headers.update({'Origin':'http://testserver','Content-Type':'application/json'})
        prefix='zz_test_cms_'+self.tag
        try:
            with patch.dict(terms.DOCUMENT,document),patch.dict(os.environ,{'KINETTA_TERMS_VERSION':document['version'],'KINETTA_SIGNUP':'open'}),patch.object(auth,'client_ip',return_value='community-'+self.tag),patch.object(account_email,'mail_ready',return_value=True),patch.object(account_email,'confirmation',return_value=None):
                self.assertEqual(guest.post('/api/terms/accept',json={'version':document['version']}).status_code,401)
                invite=self.q('admin','POST','/api/admin/invites',{})
                body={'token':invite['path'].split('/')[-1],'name':'Invite Example','login':prefix+'i','password':PW}
                self.assertEqual(guest.post('/api/join',json=body).status_code,428)
                self.assertEqual(guest.post('/api/join',json={**body,'terms_version':document['version']}).status_code,200)
                response=guest.get('/api/me'); self.assertEqual(response.status_code,200)
                self.assertEqual(response.json()['terms']['accepted_version'],document['version'])
                self.assertTrue(response.json()['terms']['accepted_at'])
                body={'name':'Signup Example','login':prefix+'s','password':PW,'email':'fictional-'+self.tag+'@example.invalid','age_ok':True}
                self.assertEqual(guest.post('/api/signup',json=body).status_code,428)
                self.assertEqual(guest.post('/api/signup',json={**body,'terms_version':document['version']}).status_code,200)
                self.assertFalse(guest.get('/api/me').json()['terms']['required'])
        finally:
            from app.api_account import erase
            with db.connect() as c:
                for row in c.execute('SELECT id FROM users WHERE login=ANY(%s)',([prefix+'i',prefix+'s'],)).fetchall(): erase(c,{'id':row['id'],'sql_role':None})

    def test_terms_version_owner_idempotency_and_export_escape(self):
        document={**terms.DOCUMENT,'draft':False,'version':'fixture-approved-v1'}
        with patch.dict(terms.DOCUMENT,document),patch.dict(os.environ,{'KINETTA_TERMS_VERSION':document['version']}):
            self.assertTrue(self.q('owner','GET','/api/me')['terms']['required'])
            self.q('owner','POST','/api/terms/accept',{'version':'old'},428)
            self.q('owner','POST','/api/terms/accept',{'version':document['version'],'user_id':self.ids['friend']},422)
            self.q('owner','PUT','/api/profile',{'weight_kg':70})
            self.q('owner','PUT','/api/account',{'name':'Casey Example'},428)
            self.q('owner','POST','/api/account/export-link')
            before=self.q('owner','POST','/api/terms/accept',{'version':document['version']})
            again=self.q('owner','POST','/api/terms/accept',{'version':document['version']})
            self.assertEqual(before['accepted_at'],again['accepted_at'])
            self.assertFalse(self.q('owner','GET','/api/me')['terms']['required'])
            self.assertTrue(self.q('friend','GET','/api/me')['terms']['required'])
            self.q('stranger','POST','/api/account/delete',{'password':PW})
            self.q('stranger','GET','/api/me',status=401)
            self.q('friend','GET','/api/me')
            self.q('owner','PUT','/api/account',{'name':'Casey Example'})
            with patch.dict(terms.DOCUMENT,{'version':'fixture-approved-v2'}),patch.dict(os.environ,{'KINETTA_TERMS_VERSION':'fixture-approved-v2'}):
                self.assertTrue(self.q('owner','GET','/api/me')['terms']['required'])
        with patch.dict(os.environ,{'KINETTA_TERMS_VERSION':''}):
            self.q('owner','POST','/api/terms/accept',{'version':document['version']},409)


if __name__ == '__main__': unittest.main()
