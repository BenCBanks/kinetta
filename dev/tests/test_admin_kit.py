"""Private admin age/Kit controls and real generation gates, using fictional isolated accounts only."""
import datetime as dt
import io
import json
import os
import unittest
import uuid
import zipfile
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import ai_access, auth, admin_auth, db, coach
from app.main import app

PW='fictional account settings phrase'
YEAR=dt.datetime.now(dt.timezone.utc).year


def client():
    c=TestClient(app);c.headers['Origin']='http://testserver';return c


class AdminKit(unittest.TestCase):
    def setUp(self):
        self.ids={}
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_kitadmin%%'")
            c.execute('DELETE FROM auth_attempts')
            for name in ('admin','member','other'):
                uid=c.execute('INSERT INTO users(login,name,pw_hash,is_admin) VALUES(%s,%s,%s,%s) RETURNING id',
                    ('zz_test_kitadmin_'+name,'Fictional '+name,auth.hash_pw(PW),name=='admin')).fetchone()['id']
                self.ids[name]=uid;c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
            self.token=admin_auth.issue_session(c,self.ids['admin'])
        self.a=client();self.a.cookies.set(admin_auth.COOKIE,self.token,path='/api');self.a.headers['X-Admin-CSRF']=admin_auth.csrf(self.token)
        self.member=client();self.assertEqual(self.member.post('/api/login',json={'login':'zz_test_kitadmin_member','password':PW}).status_code,200)
        self.env=patch.dict(os.environ,{'KINETTA_AI_ACCESS_MODE':'open'});self.env.start();self.addCleanup(self.env.stop)

    def tearDown(self):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_kitadmin%%'")
            c.execute('DELETE FROM auth_attempts')

    def body(self,**extra):
        return {'request_key':str(uuid.uuid4()),'requested_at':dt.datetime.now(dt.timezone.utc).isoformat(),
                'confirm':'zz_test_kitadmin_member','birth_year':YEAR-26,'allowed':True,**extra}

    def save(self,body=None):
        return self.a.post(f"/api/admin/people/{self.ids['member']}/kit",json=body or self.body())

    def detail(self):return self.a.get(f"/api/admin/people/{self.ids['member']}").json()

    def consent(self):
        with db.connect() as c:
            c.execute("UPDATE profile SET ai_ok=true,ai_adult_at=now(),ai_adult_by='self',health_ai_ok=true,garmin_ai_ok=true WHERE user_id=%s",(self.ids['member'],))

    def test_separate_portal_and_csrf_required(self):
        url=f"/api/admin/people/{self.ids['member']}/kit"
        self.assertEqual(client().post(url,json=self.body()).status_code,401)
        self.assertEqual(self.member.post(url,json=self.body()).status_code,403)
        bad=client();bad.cookies.set(admin_auth.COOKIE,self.token,path='/api');self.assertEqual(bad.post(url,json=self.body()).status_code,403)
        self.assertEqual(self.save().status_code,200)
        with db.connect() as c:c.execute('UPDATE users SET is_admin=false WHERE id=%s',(self.ids['admin'],))
        self.assertEqual(self.save().status_code,401,'revoked administrator cannot write')

    def test_explicit_confirmation_and_strict_validation(self):
        self.assertEqual(self.save(self.body(confirm='wrong')).status_code,400)
        for value in (True,'2000',1900,2000.5):self.assertEqual(self.save(self.body(birth_year=value)).status_code,422,str(value))
        self.assertEqual(self.save(self.body(birth_year=YEAR+1)).status_code,400)
        for value in ('false',0,None):self.assertEqual(self.save(self.body(allowed=value)).status_code,422,str(value))
        self.assertEqual(self.save(self.body(ai_ok=True)).status_code,422,'operator cannot forge member consent')
        self.assertEqual(self.a.post('/api/admin/people/999999999/kit',json=self.body()).status_code,404)

    def test_unknown_year_and_list_detail_have_distinct_status(self):
        p=self.detail();self.assertIsNone(p['age']['birth_year']);self.assertIsNone(p['age']['approximate_years'])
        self.assertTrue(p['kit']['allowed']);self.assertFalse(p['kit']['consent']);self.assertEqual(p['kit']['status'],'off')
        self.assertFalse(p['kit']['ready']);self.assertIn('features',p['kit'])
        self.assertEqual(self.save().status_code,200)
        rows=self.a.get('/api/admin/people?tests=true&q=zz_test_kitadmin').json()['rows']
        member=next(x for x in rows if x['id']==self.ids['member']);other=next(x for x in rows if x['id']==self.ids['other'])
        self.assertEqual(member['age']['approximate_years'],26);self.assertEqual(member['age']['birth_year'],YEAR-26)
        self.assertIsNone(other['age']['birth_year']);self.assertNotIn('features',member['kit'],'list does not query full capabilities once per account')

    def test_operator_allow_never_records_consent_or_adult_confirmation(self):
        self.assertEqual(self.save().status_code,200)
        p=self.detail();self.assertTrue(p['kit']['allowed']);self.assertFalse(p['kit']['consent']);self.assertFalse(p['kit']['adult_confirmed'])
        self.assertFalse(coach.allowed(self.ids['member']))
        with db.connect() as c:
            r=c.execute('SELECT ai_ok,ai_adult_at,health_ai_ok,garmin_ai_ok FROM profile WHERE user_id=%s',(self.ids['member'],)).fetchone()
            self.assertFalse(r['ai_ok'] or r['health_ai_ok'] or r['garmin_ai_ok']);self.assertIsNone(r['ai_adult_at'])

    def test_block_enforced_in_open_mode_before_provider_and_manual_features_survive(self):
        self.consent();self.assertEqual(self.save(self.body(allowed=False)).status_code,200)
        self.assertFalse(ai_access.has(self.ids['member'],'food'));self.assertFalse(ai_access.has(self.ids['member'],'coach'))
        with patch('app.food_photo.ask',side_effect=AssertionError('Provider must not be called')):
            r=self.member.post('/api/food/photo',json={'note':'fictional oats'});self.assertEqual(r.status_code,403,r.text)
        self.assertIn('administrator',r.json()['detail']);self.assertFalse(coach.allowed(self.ids['member']))
        for path in ('/api/food/day','/api/dishes','/api/plans/options','/api/plans/current'):
            self.assertEqual(self.member.get(path).status_code,200,path)
        dish=self.member.post('/api/dishes',json={'name':'Fictional manual oats'}).json()
        self.assertEqual(self.member.patch('/api/dishes/'+str(dish['id']),json={'known_kcal':300}).status_code,200)
        self.assertEqual(self.member.put('/api/profile',json={'ai_access_allowed':True}).status_code,200)
        self.assertFalse(ai_access.has(self.ids['member'],'food'),'profile cannot grant operator permission')
        p=self.detail();self.assertEqual(p['kit']['status'],'blocked');self.assertTrue(p['kit']['consent'] and p['kit']['adult_confirmed'])
        with db.connect() as c:
            r=c.execute('SELECT health_ai_ok,garmin_ai_ok FROM profile WHERE user_id=%s',(self.ids['member'],)).fetchone();self.assertTrue(r['health_ai_ok'] and r['garmin_ai_ok'])

    def test_known_under18_blocks_even_old_confirmation_and_can_be_corrected_or_cleared(self):
        self.consent();self.assertEqual(self.save(self.body(birth_year=YEAR-17)).status_code,200)
        self.assertEqual(self.detail()['kit']['status'],'under_age')
        for feature in ai_access.FEATURES:self.assertFalse(ai_access.has(self.ids['member'],feature))
        self.assertEqual(self.member.post('/api/food/photo',json={'note':'fictional oats'}).status_code,403)
        self.assertEqual(self.member.put('/api/profile',json={'ai_ok':True,'ai_adult':True}).status_code,403)
        self.assertEqual(self.save(self.body(birth_year=YEAR-18)).status_code,200)
        self.assertTrue(ai_access.has(self.ids['member'],'food'),'year alone is approximate; prior separate confirmation still applies')
        self.assertEqual(self.save(self.body(birth_year=None)).status_code,200);self.assertIsNone(self.detail()['age']['birth_year'])
        self.assertTrue(ai_access.has(self.ids['member'],'food'))

    def test_retry_receipt_changed_payload_and_audit_privacy(self):
        body=self.body();first=self.save(body);self.assertEqual(first.status_code,200,first.text)
        self.assertEqual(self.save(body).json(),first.json())
        self.assertEqual(self.save({**body,'allowed':False}).status_code,409)
        self.assertEqual(self.save(self.body(allowed=False)).status_code,200)
        self.assertEqual(self.save(body).json(),first.json());self.assertFalse(self.detail()['kit']['allowed'],'old receipt must not reapply an old setting')
        with db.connect() as c:
            rows=c.execute("SELECT action FROM admin_audit WHERE actor_id=%s AND action='account.kit_settings'",(self.ids['admin'],)).fetchall()
            self.assertEqual(len(rows),2)
            receipt=c.execute('SELECT result FROM admin_action_receipts WHERE request_key=%s',(body['request_key'],)).fetchone()['result']
            self.assertNotIn('birth_year',json.dumps(receipt));self.assertNotIn('ai_ok',json.dumps(receipt))

    def test_product_entitlement_stays_separate(self):
        self.assertEqual(self.save().status_code,200)
        with patch.dict(os.environ,{'KINETTA_AI_ACCESS_MODE':'entitled'}):
            self.assertFalse(ai_access.has(self.ids['member'],'food'))
            self.assertEqual(self.member.post('/api/food/photo',json={'note':'fictional oats'}).status_code,402)
            with db.connect() as c:self.assertFalse(c.execute('SELECT 1 FROM ai_entitlements WHERE user_id=%s',(self.ids['member'],)).fetchone())

    def test_age_permission_private_exported_to_owner_and_erased_with_account(self):
        self.assertEqual(self.save(self.body(allowed=False)).status_code,200)
        other=client();self.assertEqual(other.post('/api/login',json={'login':'zz_test_kitadmin_other','password':PW}).status_code,200)
        public=other.get('/api/people/zz_test_kitadmin_member/profile');self.assertEqual(public.status_code,200,public.text)
        for key in ('birth_year','approximate_years','ai_access_allowed','adult_confirmed'):
            self.assertNotIn(key,public.text)
        export=self.member.get('/api/account/export');self.assertEqual(export.status_code,200,export.text[:100] if export.status_code!=200 else '')
        with zipfile.ZipFile(io.BytesIO(export.content)) as archive:
            profile=json.loads(archive.read('data/profile.jsonl').splitlines()[0]);self.assertEqual(profile['birth_year'],YEAR-26);self.assertFalse(profile['ai_access_allowed'])
        with db.connect() as c:
            from app import api_account
            user=c.execute('SELECT id,login::text AS login,sql_role FROM users WHERE id=%s',(self.ids['member'],)).fetchone();api_account.erase(c,user)
            self.assertFalse(c.execute('SELECT 1 FROM profile WHERE user_id=%s',(self.ids['member'],)).fetchone())


if __name__=='__main__':unittest.main()
