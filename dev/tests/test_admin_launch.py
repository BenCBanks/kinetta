"""Admin launch tools on an isolated database; fictional accounts and a stand-in email transport only."""
import base64
import datetime as dt
import json
import os
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth, admin_auth
from app.main import app

PW = 'a fictional private password'
TEMP = 'an expiring recovery phrase'
NEW = 'my replacement private phrase'
MAIL = {'KINETTA_RESEND_KEY':'stand-in', 'KINETTA_MAIL_FROM':'Kinetta <hello@example.test>',
        'KINETTA_MAIL_REPLY_TO':'support@example.test', 'KINETTA_PUBLIC_URL':'https://example.test',
        'KINETTA_MAIL_WEBHOOK_SECRET':'whsec_'+base64.b64encode(b'fictional-test-key').decode()}


def action(**extra):
    return {'request_key':str(uuid.uuid4()), 'requested_at':dt.datetime.now(dt.timezone.utc).isoformat(), **extra}


def client():
    c = TestClient(app); c.headers['Origin'] = 'http://testserver'; return c


class Launch(unittest.TestCase):
    def setUp(self):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_launch%%'")
            c.execute('DELETE FROM auth_attempts')
            self.ids = {}
            for name in ('admin','plain','email','other'):
                uid = c.execute('''INSERT INTO users(login,name,pw_hash,is_admin,email,email_verified_at)
                    VALUES (%s,%s,%s,%s,%s,%s) RETURNING id''', ('zz_test_launch_'+name, name.title()+' Demo', auth.hash_pw(PW),
                    name=='admin', 'zz_test_launch_email@example.test' if name=='email' else None,
                    dt.datetime.now(dt.timezone.utc) if name=='email' else None)).fetchone()['id']
                self.ids[name] = uid; c.execute('INSERT INTO profile(user_id) VALUES (%s)', (uid,))
            self.token = admin_auth.issue_session(c, self.ids['admin'])
        self.a = client(); self.a.cookies.set(admin_auth.COOKIE,self.token,path='/api'); self.a.headers['X-Admin-CSRF']=admin_auth.csrf(self.token)
        self.env = patch.dict(os.environ, MAIL); self.env.start(); self.addCleanup(self.env.stop)
        self.sent = []
        def send(*args, **kwargs):
            self.sent.append(kwargs['json']); return httpx.Response(200,json={'id':'fictional'},request=httpx.Request('POST','https://api.resend.com/emails'))
        self.mail = patch('app.account_email.httpx.post',side_effect=send); self.mail.start(); self.addCleanup(self.mail.stop)

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM admin_data_requests WHERE user_id=ANY(%s) OR actor_id=%s', (list(self.ids.values()),self.ids['admin']))
            c.execute("DELETE FROM users WHERE login LIKE 'zz\\_test\\_launch%%'")
            c.execute('DELETE FROM auth_attempts')

    def login(self, name='plain', pw=PW, app_token=False):
        c = client(); r = c.post('/api/login',json={'login':'zz_test_launch_'+name,'password':pw,'app':app_token}); return c,r

    def manage(self, name, act, **extra):
        body = action(confirm='zz_test_launch_'+name, **extra)
        return self.a.post(f'/api/admin/manage/{self.ids[name]}/{act}',json=body)

    def issue(self):
        body = action(confirm='zz_test_launch_plain', password=TEMP)
        r = self.a.post(f"/api/admin/people/{self.ids['plain']}/temporary-password",json=body)
        self.assertEqual(r.status_code,200,r.text); return body,r.json()

    def report(self, what='comment'):
        with db.connect() as c:
            aid = c.execute("INSERT INTO activities(user_id,sport,source,name,start_time,visibility,private_note) VALUES (%s,'run','manual','Reported activity',now(),'me','NEVER SHOW THIS NOTE') RETURNING id", (self.ids['plain'],)).fetchone()['id']
            cid = c.execute('INSERT INTO comments(user_id,activity_id,text) VALUES (%s,%s,%s) RETURNING id', (self.ids['plain'],aid,'Fictional reported comment')).fetchone()['id']
            rid = c.execute('INSERT INTO reports(reporter,person,activity_id,comment_id,kind,what,reason,note) VALUES (%s,%s,%s,%s,%s,%s,\'other\',\'Fictional complaint\') RETURNING id',
                            (self.ids['other'], self.ids['plain'], aid if what=='activity' else None, cid if what=='comment' else None, what, 'Comment: Fictional complaint' if what=='comment' else 'Activity: Fictional activity' if what=='activity' else 'Fictional profile')).fetchone()['id']
        return rid,aid,cid

    def decision(self, rid, snapshot, act):
        return action(confirm='zz_test_launch_plain',version=snapshot['version'],action=act)

    def test_schema_and_admin_boundaries(self):
        tables=['admin_readiness','admin_action_receipts','account_password_changes','admin_data_requests']
        with db.connect() as c:
            for t in tables:
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s',(t,)).fetchone()['relrowsecurity'])
                for role in ('fit_readers','fit_all_readers'):
                    self.assertFalse(c.execute('SELECT has_table_privilege(%s,%s,\'SELECT\') AS allowed',(role,t)).fetchone()['allowed'],(role,t))
        member,_=self.login()
        for path in ('readiness','audit-history','data-requests','review/1'):
            self.assertEqual(member.get('/api/admin/'+path).status_code,403)
        bad=client();bad.cookies.set(admin_auth.COOKIE,self.token,path='/api')
        self.assertEqual(bad.post('/api/admin/readiness/backup',json=action(passed=True,confirmed=True,observed_at=dt.datetime.now(dt.timezone.utc).isoformat())).status_code,403)

    def test_readiness_evidence_is_explicit_fresh_and_replay_safe(self):
        with db.connect() as c: c.execute('DELETE FROM admin_readiness')
        r=self.a.get('/api/admin/readiness').json();checks={x['key']:x for x in r['checks']}
        self.assertEqual(checks['restore']['status'],'not_checked');self.assertEqual(checks['mail_config']['source'],'configuration')
        old=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=2)).isoformat()
        b=action(passed=True,confirmed=True,observed_at=old)
        first=self.a.post('/api/admin/readiness/backup',json=b);self.assertEqual(first.status_code,200,first.text)
        self.assertEqual(self.a.post('/api/admin/readiness/backup',json=b).json(),first.json())
        self.assertEqual(self.a.post('/api/admin/readiness/backup',json={**b,'passed':False}).status_code,409)
        r=self.a.get('/api/admin/readiness').json();self.assertEqual(next(x for x in r['checks'] if x['key']=='backup')['status'],'attention')
        future=(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=2)).isoformat()
        self.assertEqual(self.a.post('/api/admin/readiness/restore',json=action(passed=True,confirmed=True,observed_at=future)).status_code,400)
        self.assertEqual(self.a.post('/api/admin/readiness/restore',json=action(passed=True,confirmed=False,observed_at=old)).status_code,400)
        with patch.dict(os.environ,{'KINETTA_ADMIN_MFA':'off'}):
            self.assertEqual(next(x for x in self.a.get('/api/admin/readiness').json()['checks'] if x['key']=='mfa')['status'],'attention')
        self.assertNotIn('stand-in',json.dumps(r));self.assertNotIn('whsec_',json.dumps(r))

    def test_temporary_password_cannot_create_a_session_and_replay_cannot_reset_again(self):
        before,_=self.login();b,receipt=self.issue()
        self.assertEqual(before.get('/api/me').status_code,401)
        c,r=self.login(pw=TEMP);self.assertEqual(r.status_code,200,r.text);self.assertTrue(r.json()['password_change_required'])
        self.assertNotIn('token',r.json());self.assertNotIn('set-cookie',r.headers);self.assertEqual(c.get('/api/me').status_code,401)
        token=r.json()['change_token'];c.headers['Authorization']='Bearer '+token;self.assertEqual(c.get('/api/me').status_code,401)
        body={'change_token':token,'password':NEW,'password_confirm':NEW}
        self.assertEqual(c.post('/api/password/temporary',json={**body,'password_confirm':TEMP}).status_code,400)
        self.assertEqual(c.post('/api/password/temporary',json={'change_token':token,'password':TEMP,'password_confirm':TEMP}).status_code,400)
        changed=c.post('/api/password/temporary',json=body);self.assertEqual(changed.status_code,200,changed.text);self.assertNotIn('set-cookie',changed.headers)
        self.assertEqual(c.post('/api/password/temporary',json=body).status_code,401)
        normal,r=self.login(pw=NEW);self.assertEqual(r.status_code,200);self.assertEqual(normal.get('/api/me').status_code,200)
        self.assertEqual(self.a.post(f"/api/admin/people/{self.ids['plain']}/temporary-password",json=b).json(),receipt)
        self.assertEqual(self.login(pw=NEW)[1].status_code,200,'retry after completion must not overwrite the new password')
        self.assertEqual(self.a.post(f"/api/admin/people/{self.ids['plain']}/temporary-password",json={**b,'password':'a different temporary phrase'}).status_code,409)
        with db.connect() as c:
            rec=c.execute('SELECT fingerprint,result FROM admin_action_receipts WHERE request_key=%s',(b['request_key'],)).fetchone()
            self.assertNotIn(TEMP,str(rec));self.assertEqual(len(rec['fingerprint']),64)

    def test_temporary_expiry_email_preference_and_app_contract(self):
        self.assertEqual(self.a.post(f"/api/admin/people/{self.ids['email']}/temporary-password",json=action(confirm='zz_test_launch_email',password=TEMP)).status_code,409)
        self.issue();_,r=self.login(pw=TEMP,app_token=True);self.assertTrue(r.json()['password_change_required']);self.assertNotIn('token',r.json())
        with db.connect() as c: c.execute("UPDATE account_password_changes SET expires=now()-interval '1 second' WHERE user_id=%s",(self.ids['plain'],))
        self.assertEqual(client().post('/api/password/temporary',json={'change_token':r.json()['change_token'],'password':NEW,'password_confirm':NEW}).status_code,401)
        with db.connect() as c: c.execute("UPDATE users SET password_change_expires=now()-interval '1 second' WHERE id=%s",(self.ids['plain'],))
        self.assertEqual(self.login(pw=TEMP)[1].status_code,401)
        self.assertEqual(self.login(pw='wrong')[1].json()['detail'],'Wrong name or password')
        self.assertEqual(self.a.post('/api/admin/people/zz_test_launch_plain/password',json={'password':NEW}).status_code,409,'legacy reset must not bypass forced change')

    def test_version_is_reported_without_raw_agent_or_address(self):
        c=client();c.headers['X-Kinetta-Version']='1.2.3 (42)'
        r=c.post('/api/login',json={'login':'zz_test_launch_plain','password':PW,'app':True});self.assertEqual(r.status_code,200)
        page=self.a.get(f"/api/admin/people/{self.ids['plain']}").json()
        self.assertEqual(page['devices'][0]['app_version'],'1.2.3 (42)');self.assertEqual(set(page['devices'][0]),{'device','signed_in','last_used','app_version'})

    def test_comment_review_is_scoped_versioned_and_idempotent(self):
        rid,aid,cid=self.report();snap=self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(snap['item']['text'],'Fictional reported comment');self.assertNotIn('NEVER SHOW',str(snap))
        self.assertNotIn('hide_activity',[a['value'] for a in snap['actions']])
        with db.connect() as c:c.execute("UPDATE comments SET text='Newer reported comment' WHERE id=%s",(cid,))
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_comment')).status_code,409)
        snap=self.a.get(f'/api/admin/review/{rid}').json();body=self.decision(rid,snap,'remove_comment')
        first=self.a.post(f'/api/admin/review/{rid}',json=body);self.assertEqual(first.status_code,200,first.text)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=body).json(),first.json())
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT id FROM comments WHERE id=%s',(cid,)).fetchone())
            self.assertIsNotNone(c.execute('SELECT id FROM activities WHERE id=%s',(aid,)).fetchone())
            history=c.execute('SELECT action,target FROM admin_audit WHERE actor_id=%s',(self.ids['admin'],)).fetchall();self.assertNotIn('Newer reported comment',str(history))

    def test_real_report_api_preserves_target_type_after_comment_deletion(self):
        _,aid,cid=self.report()
        with db.connect() as c:c.execute("UPDATE activities SET visibility='everyone' WHERE id=%s",(aid,))
        member,_=self.login('other')
        response=member.post('/api/reports',json={'login':'zz_test_launch_plain','comment_id':cid,'reason':'abuse'})
        self.assertEqual(response.status_code,200,response.text);rid=response.json()['id']
        snapshot=self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(snapshot['report']['kind'],'comment');self.assertEqual(snapshot['item']['text'],'Fictional reported comment')
        with db.connect() as c:c.execute('DELETE FROM comments WHERE id=%s',(cid,))
        snapshot=self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(snapshot['report']['kind'],'comment');self.assertIsNone(snapshot['item'])
        self.assertEqual([a['value'] for a in snapshot['actions']],['dismiss'])

    def test_activity_review_never_exposes_route_or_private_note(self):
        rid,aid,cid=self.report('activity');snap=self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(set(snap['item']),{'name','sport','start_time','visibility'});self.assertNotIn('NEVER SHOW',str(snap))
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_comment')).status_code,409)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'hide_activity')).status_code,200)
        with db.connect() as c:self.assertEqual(c.execute('SELECT visibility FROM activities WHERE id=%s',(aid,)).fetchone()['visibility'],'me')

    def test_attached_photo_review_is_limited_to_the_reported_activity(self):
        rid,aid,_=self.report('activity')
        with db.connect() as c:
            pid=c.execute('INSERT INTO activity_photos(activity_id,user_id,img,thumb,w,h) VALUES (%s,%s,%s,%s,2,2) RETURNING id', (aid,self.ids['plain'],b'fictional-image',b'thumb')).fetchone()['id']
        snap=self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(self.a.get(snap['photos'][0]['url']).content,b'fictional-image')
        self.assertEqual(self.a.get(f"/api/admin/review/{rid}/photos/{pid+100}?version={snap['version']}").status_code,404)
        b={**self.decision(rid,snap,'remove_activity_photo'),'photo_id':pid}
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=b).status_code,200)
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT id FROM activity_photos WHERE id=%s',(pid,)).fetchone())
            self.assertIsNotNone(c.execute('SELECT id FROM activities WHERE id=%s',(aid,)).fetchone())

    def test_profile_photo_access_and_precise_actions(self):
        rid,_,_=self.report('person')
        with db.connect() as c:
            c.execute('UPDATE users SET photo_v=\'first\' WHERE id=%s',(self.ids['plain'],));c.execute('UPDATE profile SET bio=\'Reported bio\' WHERE user_id=%s',(self.ids['plain'],))
            c.execute('INSERT INTO profile_photos(user_id,img) VALUES (%s,%s)',(self.ids['plain'],b'fictional-first-image'))
        snap=self.a.get(f'/api/admin/review/{rid}').json();self.assertEqual(self.a.get(snap['photo_url']).content,b'fictional-first-image')
        member,_=self.login();self.assertEqual(member.get(snap['photo_url']).status_code,403)
        with db.connect() as c:
            c.execute('UPDATE users SET photo_v=\'second\' WHERE id=%s',(self.ids['plain'],));c.execute('UPDATE profile_photos SET img=%s WHERE user_id=%s',(b'new-image',self.ids['plain']))
        self.assertEqual(self.a.get(snap['photo_url']).status_code,404)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_photo')).status_code,409)
        snap=self.a.get(f'/api/admin/review/{rid}').json();self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'clear_bio')).status_code,200)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT bio FROM profile WHERE user_id=%s',(self.ids['plain'],)).fetchone()['bio'],'')
            self.assertIsNotNone(c.execute('SELECT img FROM profile_photos WHERE user_id=%s',(self.ids['plain'],)).fetchone())
        self.assertEqual(self.a.get(snap['photo_url']).status_code,409,'closed reports cannot keep serving private review media')

    def test_account_actions_replay_and_rejections_have_safe_receipts(self):
        b=action(confirm='zz_test_launch_email');url=f"/api/admin/manage/{self.ids['email']}/reset-email"
        r=self.a.post(url,json=b);self.assertEqual(r.status_code,200,r.text);self.assertEqual(len(self.sent),1)
        self.assertEqual(self.a.post(url,json=b).json(),r.json());self.assertEqual(len(self.sent),1)
        self.assertEqual(self.a.post(url,json=action(confirm='WRONG')).status_code,400)
        audit=self.a.get('/api/admin/audit-history?outcome=rejected').json()['items']
        self.assertTrue(audit);self.assertNotIn('WRONG',str(audit));self.assertNotIn(PW,str(audit))
        signed,_=self.login('email');self.assertEqual(self.manage('email','signout').status_code,200);self.assertEqual(signed.get('/api/me').status_code,401)
        self.assertEqual(self.manage('email','suspend',reason='Fictional report review').status_code,200)
        self.assertEqual(self.login('email')[1].status_code,403)
        self.assertEqual(self.manage('email','restore').status_code,200);self.assertEqual(self.login('email')[1].status_code,200)

    def test_audit_paginates_beyond_two_hundred_and_filters(self):
        with db.connect() as c:
            for _ in range(205):admin_auth.audit(c,self.ids['admin'],'account.restore',self.ids['plain'])
        data=self.a.get('/api/admin/audit-history?q=Plain%20Demo&action=account.restore').json();self.assertEqual(len(data['items']),50)
        count=len(data['items'])
        while data['before']:
            data=self.a.get('/api/admin/audit-history',params={'q':'Plain Demo','action':'account.restore','before':data['before']}).json();count+=len(data['items'])
        self.assertEqual(count,205)
        self.assertEqual(self.a.get('/api/admin/audit-history',params={'q':"%' OR 1=1 --"}).json()['items'],[])
        self.assertEqual(self.a.get('/api/admin/people?tests=true&q=zz_test_launch&sort=name').status_code,200)
        self.assertEqual(self.a.get('/api/admin/people?issue=invalid').status_code,422)

    def test_minimal_request_register_and_verified_deletion(self):
        b=action(user_id=self.ids['plain'],kind='deletion');r=self.a.post('/api/admin/data-requests',json=b)
        self.assertEqual(r.status_code,200,r.text);rid=r.json()['request_id'];self.assertEqual(self.a.post('/api/admin/data-requests',json=b).json(),r.json())
        url='/api/admin/data-requests/'+rid
        self.assertEqual(self.a.post(url,json=action(status='completed',confirmed=True)).status_code,409)
        self.assertEqual(self.a.post(url,json=action(status='verified',method='confirmed_email',confirmed=True)).status_code,409)
        self.assertEqual(self.a.post(url,json=action(status='verified',method='identity_checked',confirmed=True)).status_code,200)
        self.assertEqual(self.a.post(url,json=action(status='completed',confirmed=True)).status_code,409,'the account still exists')
        self.assertEqual(self.manage('plain','remove').status_code,200)
        rows=self.a.get('/api/admin/data-requests').json()['items'];row=next(r for r in rows if r['id']==rid)
        self.assertEqual(row['status'],'completed');self.assertIsNone(row['user_id']);self.assertIsNone(row['login'])
        with db.connect() as c:c.execute("UPDATE admin_data_requests SET completed_at=now()-interval '91 days' WHERE id=%s",(rid,))
        self.assertFalse(any(r['id']==rid for r in self.a.get('/api/admin/data-requests').json()['items']))

    def test_recovery_cannot_bypass_administration_and_old_moderation_is_retired(self):
        self.issue()
        self.assertEqual(self.manage('plain','role',administrator=True).status_code,409)
        # A legacy/direct role change still cannot turn a recovery credential into portal access.
        with db.connect() as c:
            c.execute('UPDATE users SET is_admin=true WHERE id=%s',(self.ids['plain'],))
            token=admin_auth.issue_session(c,self.ids['plain'])
        p=client();p.cookies.set(admin_auth.COOKIE,token,path='/api')
        self.assertEqual(p.get('/api/admin/me').status_code,401)
        self.assertEqual(client().post('/api/admin/login',json={'login':'zz_test_launch_plain','password':TEMP}).status_code,403)
        rid,_,_=self.report()
        self.assertEqual(self.a.post(f'/api/admin/reports/{rid}/done?remove=true',json={}).status_code,409)
        self.assertEqual(self.a.get(f'/api/admin/review/{rid}').status_code,200)

    def test_last_admin_expired_confirmations_and_cross_actor_receipts(self):
        # Keep this fixture independent of other test-copy administrators.
        with patch('app.admin_manage.db.connect',db.connect):
            with db.connect() as c:
                others=[r['id'] for r in c.execute('SELECT id FROM users WHERE is_admin AND id<>%s',(self.ids['admin'],)).fetchall()]
                c.execute('UPDATE users SET is_admin=false WHERE id=ANY(%s)',(others,))
            try:self.assertEqual(self.manage('admin','role',administrator=False).status_code,409)
            finally:
                with db.connect() as c:c.execute('UPDATE users SET is_admin=true WHERE id=ANY(%s)',(others,))
        body=action(confirm='zz_test_launch_plain')
        url=f"/api/admin/manage/{self.ids['plain']}/signout"
        self.assertEqual(self.a.post(url,json={**body,'requested_at':(dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=2)).isoformat()}).status_code,409)
        self.assertEqual(self.a.post(url,json=body).status_code,200)
        with db.connect() as c:
            c.execute('UPDATE users SET is_admin=true WHERE id=%s',(self.ids['other'],));token=admin_auth.issue_session(c,self.ids['other'])
        other=client();other.cookies.set(admin_auth.COOKIE,token,path='/api');other.headers['X-Admin-CSRF']=admin_auth.csrf(token)
        self.assertEqual(other.post(url,json=body).status_code,409)
        self.assertEqual(self.manage('other','role',administrator=False).status_code,200)
        self.assertEqual(other.get('/api/admin/readiness').status_code,401)

    def test_support_filters_do_not_leak_reported_text_or_unrelated_audit(self):
        rid,_,_=self.report()
        with db.connect() as c:
            c.execute("INSERT INTO connections(user_id,kind,status) VALUES(%s,'garmin_connect','sync failed: fictional')",(self.ids['plain'],))
            c.execute("INSERT INTO imports(user_id,label,status) VALUES(%s,'Fictional import','failed')",(self.ids['email'],))
            c.execute("INSERT INTO admin_account_days(user_id,day) VALUES(%s,(now() AT TIME ZONE 'UTC')::date)",(self.ids['other'],))
            c.execute("UPDATE users SET created=now()-interval '10 days' WHERE id=%s",(self.ids['plain'],))
            admin_auth.audit(c,self.ids['admin'],'report.dismiss',self.ids['plain'])
        def find(**params):return self.a.get('/api/admin/people',params={'tests':'true','q':'zz_test_launch',**params}).json()['rows']
        self.assertEqual([r['id'] for r in find(issue='connections')],[self.ids['plain']])
        self.assertEqual([r['id'] for r in find(issue='imports')],[self.ids['email']])
        self.assertEqual([r['id'] for r in find(issue='reports')],[self.ids['plain']])
        today=dt.datetime.now(dt.timezone.utc).date().isoformat()
        self.assertEqual([r['id'] for r in find(active_since=today)],[self.ids['other']])
        self.assertNotIn(self.ids['plain'],[r['id'] for r in find(joined_after=today)])
        support=self.a.get(f"/api/admin/people/{self.ids['plain']}").json()
        self.assertNotIn('Fictional reported comment',str(support));self.assertEqual(support['reports'][0]['kind'],'comment')
        self.assertNotIn('report.dismiss',[r['action'] for r in support['audit']])

    def test_request_metadata_export_is_only_for_its_owner(self):
        self.a.post('/api/admin/data-requests',json=action(user_id=self.ids['plain'],kind='export'))
        self.a.post('/api/admin/data-requests',json=action(user_id=self.ids['other'],kind='correction'))
        from app.api_mydata import TABLES
        spec=TABLES['support_requests']
        with db.connect() as c:
            rows=[next(iter(row.values())) for row in c.execute(spec,(self.ids['plain'],)).fetchall()]
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['kind'],'export')
        self.assertNotIn('actor_id',rows[0]);self.assertNotIn('user_id',rows[0])

    def test_same_retry_id_is_serialized(self):
        b=action(passed=True,confirmed=True,observed_at=dt.datetime.now(dt.timezone.utc).isoformat())
        def send(_):
            c=client();c.cookies.set(admin_auth.COOKIE,self.token,path='/api');c.headers['X-Admin-CSRF']=admin_auth.csrf(self.token)
            r=c.post('/api/admin/readiness/restore',json=b);return r.status_code,r.json()
        with ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(send,range(2)))
        self.assertEqual(rows[0],rows[1]);self.assertEqual(rows[0][0],200)
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM admin_action_receipts WHERE request_key=%s',(b['request_key'],)).fetchone()['n'],1)

if __name__=='__main__':unittest.main()
