"""Admin isolation and beta delivery contracts against a disposable database; providers are stand-ins."""
import base64, hashlib, hmac, json, os, time, unittest, uuid
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import db, auth, admin_auth, admin_mail, api_account
from app.main import app

PW='test account private password'
BASE='http://testserver'

class Portal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with db.connect() as c:
            cls.uid=c.execute("INSERT INTO users(login,name,pw_hash,is_admin) VALUES ('zz_test_portal_admin','Portal Test',%s,true) RETURNING id",(auth.hash_pw(PW),)).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES (%s)',(cls.uid,))
            cls.member=c.execute("INSERT INTO users(login,name,pw_hash) VALUES ('zz_test_portal_member','Member Test',%s) RETURNING id",(auth.hash_pw(PW),)).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES (%s)',(cls.member,))
    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:
            c.execute("DELETE FROM beta_requests WHERE email LIKE 'zz_test_portal%%'")
            c.execute("DELETE FROM users WHERE login LIKE 'zz_test_portal%%'")
    def setUp(self):
        original=api_account.reserved_login
        names=patch.object(api_account,'reserved_login',side_effect=lambda v,**kw:original(v,allow_test=True));names.start();self.addCleanup(names.stop)
        self.client=TestClient(app);self.client.headers['Origin']=BASE;self.client.headers['Content-Type']='application/json'
        with db.connect() as c:
            self.token=admin_auth.issue_session(c,self.uid)
            c.execute('DELETE FROM admin_attempts')
        self.client.cookies.set(admin_auth.COOKIE,self.token,path='/api')
        self.client.headers['X-Admin-CSRF']=admin_auth.csrf(self.token)
    def beta(self):
        with db.connect() as c:return c.execute("INSERT INTO beta_requests(name,email,phone) VALUES ('Fictional Applicant',%s,'iphone') RETURNING id,email",('zz_test_portal_'+uuid.uuid4().hex+'@example.test',)).fetchone()
    def test_today_portal_only_audited_and_content_free(self):
        c=TestClient(app);c.headers['Origin']=BASE
        self.assertEqual(c.get('/api/admin/today').status_code,401)
        for login in ('zz_test_portal_member','zz_test_portal_admin'):
            self.assertEqual(c.post('/api/login',json={'login':login,'password':PW}).status_code,200)
            self.assertEqual(c.get('/api/admin/today').status_code,403)
            c.cookies.clear()
        response=self.client.get('/api/admin/today');self.assertEqual(response.status_code,200,response.text)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        data=response.json();self.assertEqual(data['zone'],'UTC')
        self.assertEqual(set(data['counts']),{'new_signups','unconfirmed','open_reports','kit_requests'})
        self.assertLessEqual(len(data['needs_attention']),15)
        for row in data['needs_attention']:
            self.assertEqual(set(row),{'key','label','count','severity','destination'})
            self.assertIn(row['severity'],('red','amber'))
        for row in data['services']:self.assertEqual(set(row),{'key','label','status','source'})
        for private in ('Portal Test','Member Test','zz_test_portal','sender','reply_to','provider_id','pw_hash'):
            self.assertNotIn(private,response.text)
        with db.connect() as conn:
            self.assertTrue(conn.execute("SELECT 1 FROM admin_audit WHERE actor_id=%s AND action='today.view'",(self.uid,)).fetchone())
        self.client.headers['Origin']='https://evil.example'
        self.assertEqual(self.client.get('/api/admin/today').status_code,403)
        with db.connect() as conn:conn.execute("UPDATE admin_sessions SET expires=now()-interval '1 second' WHERE token_hash=%s",(auth.token_hash(self.token),))
        self.client.headers['Origin']=BASE
        self.assertEqual(self.client.get('/api/admin/today').status_code,401)

    def test_today_counts_use_utc_and_only_measured_kit_requests(self):
        from app import admin_today
        with db.connect() as c:
            with c.transaction(force_rollback=True):
                c.execute("SET LOCAL TIME ZONE 'Pacific/Honolulu'")
                before=admin_today.snapshot(c);day=before['day']
                uid=c.execute("""INSERT INTO users(login,name,pw_hash,created,needs_email_confirm)
                    VALUES ('zz_test_portal_today','PRIVATE_NAME_SENTINEL','unused',%s::date AT TIME ZONE 'UTC',true) RETURNING id""",(day,)).fetchone()['id']
                # A future account is excluded; midnight UTC is included despite the SQL session zone.
                c.execute("""INSERT INTO users(login,name,pw_hash,created) VALUES
                    ('zz_test_portal_future','PRIVATE_FUTURE_SENTINEL','unused',(%s::date+1) AT TIME ZONE 'UTC')""",(day,))
                c.execute("""INSERT INTO reports(reporter,person,kind,what,reason,note)
                    VALUES (%s,%s,'person','PRIVATE_REPORT_SENTINEL','other','PRIVATE_NOTE_SENTINEL')""",(self.uid,uid))
                c.execute('INSERT INTO ai_service_budget(day) VALUES (%s),(%s::date-1) ON CONFLICT DO NOTHING',(day,day))
                for kind,state,offset in [('Kit conversation','measured',0),('food chat','measured',0),('Kit conversation','reserved',0),('Kit conversation','measured',-1)]:
                    c.execute("""INSERT INTO ai_food_attempts(id,user_id,day,model,kind,state,reserved_micros,charged_micros)
                        VALUES (%s,%s,%s::date+%s,'fictional-provider',%s,%s,0,0)""",(uuid.uuid4(),uid,day,offset,kind,state))
                after=admin_today.snapshot(c)
                self.assertEqual(after['counts'],{k:v+1 for k,v in before['counts'].items()})
                self.assertNotIn('PRIVATE_',str(after));self.assertNotIn('fictional-provider',str(after))
                self.assertEqual(next(r for r in after['needs_attention'] if r['key']=='reports')['severity'],'red')

    def test_today_services_are_configuration_or_explicit_evidence(self):
        from app import admin_today
        with db.connect() as c:
            with c.transaction(force_rollback=True):
                c.execute("DELETE FROM admin_readiness WHERE check_key='backup'")
                with patch('app.admin_today.admin_mail.settings',return_value={'ready':False,'sender':'PRIVATE_ADDRESS'}),patch('app.admin_today.mfa_required',return_value=False):
                    data=admin_today.snapshot(c)
                rows={r['key']:r for r in data['services']}
                self.assertEqual(rows['backup']['status'],'needs_check');self.assertEqual(rows['email']['status'],'not_configured')
                self.assertEqual(rows['authenticator']['status'],'disabled');self.assertNotIn('PRIVATE_ADDRESS',str(data))
                c.execute("INSERT INTO admin_readiness(check_key,passed,observed_at,actor_id) VALUES ('backup',true,now(),%s)",(self.uid,))
                self.assertEqual(next(r for r in admin_today.snapshot(c)['services'] if r['key']=='backup')['status'],'verified')
                c.execute("UPDATE admin_readiness SET observed_at=now()-interval '2 days' WHERE check_key='backup'")
                self.assertEqual(next(r for r in admin_today.snapshot(c)['services'] if r['key']=='backup')['status'],'needs_check')
    def draft(self,b,kind='invite'):
        return {'kind':kind,'subject':'Kinetta beta','message':'Welcome to the test beta.','confirm_email':b['email'],'request_key':str(uuid.uuid4())}
    def mail_env(self):
        return patch.dict(os.environ,{'KINETTA_RESEND_KEY':'stand-in-not-a-key','KINETTA_MAIL_FROM':'beta@example.test','KINETTA_MAIL_REPLY_TO':'support@example.test','KINETTA_MAIL_WEBHOOK_SECRET':'whsec_'+base64.b64encode(b'fictional-webhook-key').decode(),'KINETTA_PUBLIC_URL':'https://example.test'})
    def test_no_ordinary_or_member_elevation(self):
        c=TestClient(app);c.headers['Origin']=BASE
        self.assertEqual(c.get('/api/admin/people').status_code,401)
        self.assertEqual(c.post('/api/login',json={'login':'zz_test_portal_admin','password':PW}).status_code,200)
        self.assertEqual(c.get('/api/admin/people').status_code,403)
        self.assertEqual(c.get('/api/people').status_code,404)
        self.assertEqual(c.post('/api/admin/login',json={'login':'zz_test_portal_member','password':PW}).status_code,401)
        c.post('/api/logout',json={})
    def test_mfa_enroll_replay_recovery(self):
        c=TestClient(app);c.headers['Origin']=BASE
        r=c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW});self.assertEqual(r.status_code,200)
        seed=r.json()['setup_key'];self.assertTrue(seed)
        self.assertEqual(c.get('/api/admin/me').status_code,401)
        code=admin_auth.totp(seed,int(time.time()//30));r=c.post('/api/admin/verify',json={'code':code});self.assertEqual(r.status_code,200)
        codes=r.json()['recovery_codes'];self.assertEqual(len(codes),10)
        self.assertEqual(c.get('/api/admin/me').status_code,200)
        c.cookies.clear();c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW})
        self.assertEqual(c.post('/api/admin/verify',json={'code':code}).status_code,401)
        self.assertEqual(c.post('/api/admin/verify',json={'code':codes[0]}).status_code,200)
        c.cookies.clear();c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW})
        self.assertEqual(c.post('/api/admin/verify',json={'code':codes[0]}).status_code,401)
        with db.connect() as dbconn:
            encrypted=dbconn.execute('SELECT secret FROM admin_mfa WHERE user_id=%s',(self.uid,)).fetchone()['secret'];self.assertNotIn(seed,encrypted)
    def test_csrf_origin_expiry_and_revocation(self):
        self.assertEqual(self.client.post('/api/admin/invites',json={}).status_code,200)
        del self.client.headers['X-Admin-CSRF'];self.assertEqual(self.client.post('/api/admin/invites',json={}).status_code,403)
        self.client.headers['X-Admin-CSRF']=admin_auth.csrf(self.token);self.client.headers['Origin']='https://evil.example'
        self.assertEqual(self.client.get('/api/admin/me').status_code,403)
        self.client.headers['Origin']=BASE;self.client.headers['Content-Type']='application/json'
        with db.connect() as c:c.execute("UPDATE admin_sessions SET expires=now()-interval '1 minute' WHERE token_hash=%s",(auth.token_hash(self.token),))
        self.assertEqual(self.client.get('/api/admin/me').status_code,401)
    def test_roles_last_admin_and_member_invites(self):
        saved=[]
        try:
            with db.connect() as c:
                saved=[r['id'] for r in c.execute('SELECT id FROM users WHERE is_admin AND id<>%s',(self.uid,))]
                c.execute('UPDATE users SET is_admin=false WHERE id<>%s',(self.uid,))
            r=self.client.post(f'/api/admin/people/{self.uid}/role',json={'administrator':False,'confirm':'zz_test_portal_admin'});self.assertEqual(r.status_code,409)
            r=self.client.post(f'/api/admin/people/{self.member}/role',json={'administrator':True,'confirm':'wrong'});self.assertEqual(r.status_code,400)
            r=self.client.post(f'/api/admin/people/{self.member}/role',json={'administrator':True,'confirm':'zz_test_portal_member'});self.assertEqual(r.status_code,200)
            with db.connect() as c:member_token=admin_auth.issue_session(c,self.member)
            self.client.post(f'/api/admin/people/{self.member}/role',json={'administrator':False,'confirm':'zz_test_portal_member'})
            other=TestClient(app);other.cookies.set(admin_auth.COOKIE,member_token,path='/api');self.assertEqual(other.get('/api/admin/me').status_code,401)
        finally:
            with db.connect() as c:
                for uid in saved:c.execute('UPDATE users SET is_admin=true WHERE id=%s',(uid,))
    def test_email_setup_required_without_side_effects(self):
        b=self.beta()
        with patch.dict(os.environ,{'KINETTA_RESEND_KEY':''}):
            self.assertEqual(self.client.post(f"/api/admin/beta/{b['id']}/responses",json=self.draft(b)).status_code,503)
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM beta_responses WHERE request_id=%s',(b['id'],)).fetchone()['n'],0)
    def test_mail_retry_idempotency_join_and_revoke(self):
        b=self.beta();draft=self.draft(b)
        with self.mail_env():
            first=self.client.post(f"/api/admin/beta/{b['id']}/responses",json=draft);self.assertEqual(first.status_code,200,first.text)
            preview=first.json()['body']
            self.assertIn('It works once, for 7 days',preview)
            self.assertTrue(preview.startswith('Hello,\n\nWelcome to the test beta.'))
            self.assertIn('\n\nThe Kinetta team\n\n',preview)
            self.assertTrue(preview.endswith(admin_mail.BETA_EMAIL_FOOTER))
            self.assertNotIn("reply and we'll set you up",preview)
            retry=self.client.post(f"/api/admin/beta/{b['id']}/responses",json=draft)
            self.assertEqual(retry.json()['id'],draft['request_key']);self.assertEqual(retry.json()['body'],preview)
            self.assertEqual(self.client.post(f"/api/admin/beta/{b['id']}/responses",json={**draft,'message':'Welcome'}).status_code,409)
            path='/api/admin/responses/'+draft['request_key']+'/send'
            with patch('app.admin_mail.httpx.post',side_effect=httpx.ReadTimeout('lost acknowledgement')) as transport:
                self.assertEqual(self.client.post(path,json={}).json()['state'],'failed');key=transport.call_args.kwargs['headers']['Idempotency-Key']
            receipt=httpx.Response(200,json={'id':'fictional-'+uuid.uuid4().hex},request=httpx.Request('POST','https://api.resend.com/emails'))
            with patch('app.admin_mail.httpx.post',return_value=receipt) as transport:
                self.assertEqual(self.client.post(path,json={}).json()['state'],'accepted');self.assertEqual(transport.call_args.kwargs['headers']['Idempotency-Key'],key)
                sent_text=transport.call_args.kwargs['json']['text']
                self.assertTrue(sent_text.startswith('Hello,\n\nWelcome to the test beta.'))
                self.assertTrue(sent_text.endswith(admin_mail.BETA_EMAIL_FOOTER))
                self.assertIn('\n\nThe Kinetta team\n\n',sent_text)
                self.assertIn('Open this link to create your Kinetta account.',sent_text)
                self.assertNotIn("reply and we'll set you up",sent_text)
                self.assertEqual(sent_text,preview,'admin preview and delivered text are identical')
                self.assertEqual(self.client.post(path,json={}).json()['state'],'accepted');self.assertEqual(transport.call_count,1)
            with db.connect() as c:
                row=c.execute('SELECT body,invite_id FROM beta_responses WHERE id=%s',(draft['request_key'],)).fetchone();self.assertNotIn('/join/',row['body'])
            text=first.json()['body'];token=text.split('/join/')[1].split()[0]
            join=TestClient(app);join.headers['Origin']=BASE;r=join.post('/api/join',json={'age_ok':True,'name':'New Member','login':'zz_test_portal_joined','password':PW,'token':token,'is_admin':True});self.assertEqual(r.status_code,200,r.text)
            self.assertFalse(join.get('/api/me').json()['is_admin'])
            self.assertEqual(join.post('/api/join',json={'age_ok':True,'name':'Again','login':'zz_test_portal_again','password':PW,'token':token}).status_code,404)
            self.assertTrue(any(x['joined_at'] for x in self.client.get('/api/admin/beta').json() if x['id']==b['id']))
            b2=self.beta();draft2=self.draft(b2);r=self.client.post(f"/api/admin/beta/{b2['id']}/responses",json=draft2);self.assertEqual(r.status_code,200)
            with db.connect() as c:iid=c.execute('SELECT invite_id FROM beta_responses WHERE id=%s',(draft2['request_key'],)).fetchone()['invite_id']
            self.assertEqual(self.client.delete('/api/admin/invites/'+str(iid)).status_code,200)
            self.assertEqual(next(x for x in self.client.get('/api/admin/beta').json() if x['id']==b2['id'])['status'],'new')   # no working link: unanswered again
            with patch('app.admin_mail.httpx.post') as transport:self.assertEqual(self.client.post('/api/admin/responses/'+draft2['request_key']+'/send',json={}).json()['state'],'cancelled');transport.assert_not_called()
    def test_signed_webhook_replay_and_early_delivery(self):
        with self.mail_env():
            b=self.beta();d=self.draft(b);self.client.post(f"/api/admin/beta/{b['id']}/responses",json=d)
            pid='test-early-'+uuid.uuid4().hex
            def event(kind,eid):
                raw=json.dumps({'type':kind,'data':{'email_id':pid}}).encode();stamp=str(int(time.time()));sig=base64.b64encode(hmac.new(b'fictional-webhook-key',eid.encode()+b'.'+stamp.encode()+b'.'+raw,hashlib.sha256).digest()).decode()
                return raw,{'svix-id':eid,'svix-timestamp':stamp,'svix-signature':'v1,'+sig,'Content-Type':'application/json'}
            raw,headers=event('email.delivered','event-'+uuid.uuid4().hex)
            anonymous=TestClient(app);self.assertEqual(anonymous.post('/api/admin/email-events',content=raw,headers={**headers,'svix-signature':'v1,bad'}).status_code,403)
            self.assertEqual(anonymous.post('/api/admin/email-events',content=raw,headers=headers).status_code,200)
            self.assertEqual(anonymous.post('/api/admin/email-events',content=raw,headers=headers).status_code,200)
            receipt=httpx.Response(200,json={'id':pid},request=httpx.Request('POST','https://api.resend.com/emails'))
            with patch('app.admin_mail.httpx.post',return_value=receipt):self.assertEqual(self.client.post('/api/admin/responses/'+d['request_key']+'/send',json={}).json()['state'],'delivered')
            raw,headers=event('email.bounced','bounce-'+uuid.uuid4().hex);anonymous.post('/api/admin/email-events',content=raw,headers=headers)
            raw,headers=event('email.delivered','late-'+uuid.uuid4().hex);anonymous.post('/api/admin/email-events',content=raw,headers=headers)
            self.assertEqual(self.client.get(f"/api/admin/beta/{b['id']}/responses").json()[0]['state'],'bounced')
            raw,headers=event('email.sent','sent-'+uuid.uuid4().hex);anonymous.post('/api/admin/email-events',content=raw,headers=headers)
            event_id=headers['svix-id']
            with db.connect() as c:
                self.assertEqual(c.execute('SELECT state FROM admin_mail_events WHERE id=%s',(event_id,)).fetchone()['state'],'sent')
                self.assertEqual(c.execute('SELECT state FROM beta_responses WHERE id=%s',(d['request_key'],)).fetchone()['state'],'bounced')
            failed_pid='test-failed-'+uuid.uuid4().hex;pid=failed_pid
            token_hash=auth.token_hash('fictional-confirmation-token-'+uuid.uuid4().hex)
            with db.connect() as c:
                c.execute("UPDATE beta_responses SET state='accepted',provider_id=%s WHERE id=%s",(failed_pid,d['request_key']))
                c.execute("INSERT INTO account_tokens(token_hash,user_id,kind,email,expires,resend_id) VALUES (%s,%s,'verify_email','zz_test_failed@example.test',now()+interval '1 hour',%s)",(token_hash,self.member,failed_pid))
            raw,headers=event('email.failed','failed-'+uuid.uuid4().hex);anonymous.post('/api/admin/email-events',content=raw,headers=headers)
            with db.connect() as c:
                self.assertEqual(c.execute('SELECT state FROM admin_mail_events WHERE id=%s',(headers['svix-id'],)).fetchone()['state'],'failed')
                self.assertEqual(c.execute('SELECT state FROM beta_responses WHERE id=%s',(d['request_key'],)).fetchone()['state'],'bounced')
                self.assertIsNotNone(c.execute('SELECT bounced_at FROM account_tokens WHERE token_hash=%s',(token_hash,)).fetchone()['bounced_at'])
    def test_https_tunnel_origin_and_secure_cookie(self):
        # Through a Cloudflare Tunnel the app gets plain http with X-Forwarded-Proto: https; the browser's Origin is https.
        c=TestClient(app);c.headers.update({'Origin':'https://portal.example.test','Host':'portal.example.test','X-Forwarded-Proto':'https','Content-Type':'application/json'})
        r=c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW});self.assertEqual(r.status_code,200,r.text)
        self.assertIn('secure',r.headers['set-cookie'].lower())
        c.headers['Origin']='https://evil.example';self.assertEqual(c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW}).status_code,403)
        del c.headers['Origin'];self.assertEqual(c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW}).status_code,403)
    def test_codes_typed_loosely_and_success_resets_attempts(self):
        with db.connect() as c:
            uid=c.execute("INSERT INTO users(login,name,pw_hash,is_admin) VALUES ('zz_test_portal_codes','Codes Test',%s,true) RETURNING id",(auth.hash_pw(PW),)).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES (%s)',(uid,))
        c=TestClient(app);c.headers['Origin']=BASE
        seed=c.post('/api/admin/login',json={'login':'zz_test_portal_codes','password':PW}).json()['setup_key']
        code=admin_auth.totp(seed,int(time.time()//30));r=c.post('/api/admin/verify',json={'code':' '+code[:3]+' '+code[3:]+' '});self.assertEqual(r.status_code,200,r.text)
        with db.connect() as db_:self.assertEqual(db_.execute('SELECT count(*) AS n FROM admin_attempts').fetchone()['n'],0)
        recovery=r.json()['recovery_codes'][0];c.cookies.clear();c.post('/api/admin/login',json={'login':'zz_test_portal_codes','password':PW})
        self.assertEqual(c.post('/api/admin/verify',json={'code':recovery.upper()[:12]+'-'+recovery.upper()[12:]}).status_code,200)
    def test_decline_or_waitlist_cancels_earlier_invite(self):
        for kind in ('decline','waitlist'):
            b=self.beta()
            with self.mail_env():
                r=self.client.post(f"/api/admin/beta/{b['id']}/responses",json=self.draft(b));self.assertEqual(r.status_code,200,r.text)
                token=r.json()['body'].split('/join/')[1].split()[0]
                self.assertEqual(TestClient(app).get('/api/join/'+token).status_code,200)
                with db.connect() as c:c.execute("UPDATE beta_responses SET created=now()-interval '2 minutes' WHERE request_id=%s",(b['id'],))
                r=self.client.post(f"/api/admin/beta/{b['id']}/responses",json=self.draft(b,kind));self.assertEqual(r.status_code,200,r.text)
            self.assertEqual(TestClient(app).get('/api/join/'+token).status_code,404)
            join=TestClient(app);join.headers['Origin']=BASE
            self.assertEqual(join.post('/api/join',json={'age_ok':True,'name':'Declined','login':'zz_test_portal_declined','password':PW,'token':token}).status_code,404)
            row=next(x for x in self.client.get('/api/admin/beta').json() if x['id']==b['id'])
            self.assertEqual(row['status'],'declined' if kind=='decline' else 'waitlisted');self.assertIsNone(row['invite_id'])
    def test_password_only_when_owner_turns_mfa_off(self):
        c=TestClient(app);c.headers['Origin']=BASE
        with patch.dict(os.environ,{'KINETTA_ADMIN_MFA':'off'}):
            r=c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW});self.assertEqual(r.status_code,200,r.text)
            self.assertTrue(r.json()['signed_in']);self.assertIsNone(r.json()['setup_key'])
            me=c.get('/api/admin/me');self.assertEqual(me.status_code,200);self.assertFalse(me.json()['mfa'])
            self.assertEqual(c.post('/api/admin/login',json={'login':'zz_test_portal_admin','password':'wrong password here'}).status_code,401)
            self.assertEqual(c.post('/api/admin/login',json={'login':'zz_test_portal_member','password':PW}).status_code,401)   # members still can't
            ordinary=TestClient(app);ordinary.headers['Origin']=BASE;ordinary.post('/api/login',json={'login':'zz_test_portal_admin','password':PW})
            self.assertEqual(ordinary.get('/api/admin/people').status_code,403)   # an app login still isn't a portal session
        with db.connect() as dbc:self.assertTrue(dbc.execute("SELECT 1 FROM admin_audit WHERE actor_id=%s AND action='session.login_password_only'",(self.uid,)).fetchone())
        r=TestClient(app,headers={'Origin':BASE}).post('/api/admin/login',json={'login':'zz_test_portal_admin','password':PW})
        self.assertNotIn('signed_in',r.json())   # default: authenticator required
    def test_private_tables_and_no_health_overview(self):
        r=self.client.get('/api/admin/overview');self.assertEqual(r.status_code,200);self.assertNotIn('activities',r.json());self.assertNotIn('key',r.json()['email'])
        with db.connect() as c:
            for table in ['admin_mfa','admin_sessions','admin_challenges','admin_recovery','admin_audit','beta_responses','admin_mail_events']:
                self.assertFalse(c.execute('SELECT has_table_privilege(\'fit_readers\',%s,\'SELECT\') AS allowed',(table,)).fetchone()['allowed'])
        self.assertEqual(self.client.post('/api/admin/logout',json={}).status_code,200)
        self.assertEqual(self.client.get('/api/admin/overview').status_code,401)

if __name__=='__main__':unittest.main()
