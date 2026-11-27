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
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
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

    def group_report(self, update=False):
        with db.connect() as c:
            gid = c.execute("""INSERT INTO event_groups(organizer_id,title,event_date,time_zone,goal_type,goal_target,goal_unit,goal_start_date)
                VALUES (%s,'Fictional reported group',current_date+30,'UTC','sessions',3,'sessions',current_date) RETURNING id""", (self.ids['plain'],)).fetchone()['id']
            for uid in (self.ids['plain'], self.ids['other']):
                c.execute('INSERT INTO group_members(group_id,user_id) VALUES (%s,%s)', (gid,uid))
            update_id = c.execute("INSERT INTO group_updates(group_id,user_id,text) VALUES (%s,%s,'Unrelated update sentinel') RETURNING id", (gid,self.ids['plain'])).fetchone()['id']
            aid = c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES (%s,'run','manual','Private workout sentinel',now()) RETURNING id", (self.ids['plain'],)).fetchone()['id']
        member,_ = self.login('other')
        path = f'/api/groups/{gid}' + (f'/updates/{update_id}' if update else '') + '/report'
        response = member.post(path,json={'reason':'abuse','note':'Fictional complaint'})
        self.assertEqual(response.status_code,200,response.text)
        return response.json()['id'],gid,update_id,aid

    def test_group_removal_is_report_scoped_confirmed_and_replay_safe(self):
        rid,gid,update_id,aid = self.group_report()
        snap = self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(snap['item']['name'],'Fictional reported group')
        self.assertNotIn('Unrelated update sentinel',str(snap));self.assertNotIn('Private workout sentinel',str(snap))
        body = self.decision(rid,snap,'remove_group')
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json={**body,'confirm':'wrong'}).status_code,400)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json={**body,'group_id':str(gid)}).status_code,422,'client cannot supply a different target')
        member,_ = self.login('other')
        self.assertEqual(member.post(f'/api/admin/review/{rid}',json=body).status_code,403)
        first = self.a.post(f'/api/admin/review/{rid}',json=body)
        self.assertEqual(first.status_code,200,first.text)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=body).json(),first.json())
        self.assertEqual(self.a.get(f'/api/admin/review/{rid}').status_code,409)
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT id FROM event_groups WHERE id=%s',(gid,)).fetchone())
            self.assertIsNone(c.execute('SELECT id FROM group_updates WHERE id=%s',(update_id,)).fetchone())
            self.assertIsNotNone(c.execute('SELECT id FROM activities WHERE id=%s',(aid,)).fetchone())
            self.assertEqual(c.execute('SELECT status FROM reports WHERE id=%s',(rid,)).fetchone()['status'],'done')
            rows = c.execute("SELECT target FROM admin_audit WHERE actor_id=%s AND action='report.remove_group'",(self.ids['admin'],)).fetchall()
            self.assertEqual(rows,[{'target':str(rid)}])

    def test_group_removal_rejects_renamed_or_missing_target(self):
        rid,gid,_,_ = self.group_report();snap = self.a.get(f'/api/admin/review/{rid}').json()
        with db.connect() as c:c.execute("UPDATE event_groups SET title='Changed name' WHERE id=%s",(gid,))
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_group')).status_code,409)
        fresh = self.a.get(f'/api/admin/review/{rid}').json();self.assertEqual(fresh['item']['name'],'Changed name')
        with db.connect() as c:c.execute('DELETE FROM event_groups WHERE id=%s',(gid,))
        missing = self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual([a['value'] for a in missing['actions']],['dismiss'])
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,missing,'remove_group')).status_code,409)

    def test_legacy_update_report_never_unlocks_whole_group_removal(self):
        rid,gid,update_id,_ = self.group_report(update=True)
        with db.connect() as c:c.execute('UPDATE reports SET group_update_id=NULL WHERE id=%s',(rid,))
        snap = self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual([a['value'] for a in snap['actions']],['dismiss'])
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_group')).status_code,409)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_group_update')).status_code,409)
        with db.connect() as c:self.assertIsNotNone(c.execute('SELECT id FROM event_groups WHERE id=%s',(gid,)).fetchone())

    def test_group_update_removal_is_exact_confirmed_and_replay_safe(self):
        rid,gid,update_id,aid = self.group_report(update=True)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT group_update_id FROM reports WHERE id=%s',(rid,)).fetchone()['group_update_id'],update_id)
            other = c.execute("INSERT INTO group_updates(group_id,user_id,text) VALUES(%s,%s,'Unrelated private update') RETURNING id",(gid,self.ids['other'])).fetchone()['id']
            c.execute("INSERT INTO group_update_reactions(update_id,user_id,kind) VALUES(%s,%s,'heart')",(update_id,self.ids['other']))
        snap = self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(snap['item']['id'],update_id)
        self.assertNotIn('Unrelated private update',str(snap));self.assertNotIn('Private workout sentinel',str(snap))
        self.assertEqual([a['value'] for a in snap['actions']],['dismiss','remove_group_update'])
        body = self.decision(rid,snap,'remove_group_update')
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json={**body,'confirm':'wrong'}).status_code,400)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json={**body,'group_update_id':other}).status_code,422)
        member,_ = self.login('other')
        self.assertEqual(member.get(f'/api/admin/review/{rid}').status_code,403)
        self.assertEqual(member.post(f'/api/admin/review/{rid}',json=body).status_code,403)
        first = self.a.post(f'/api/admin/review/{rid}',json=body)
        self.assertEqual(first.status_code,200,first.text)
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=body).json(),first.json())
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json={**body,'action':'remove_group'}).status_code,409)
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT id FROM group_updates WHERE id=%s',(update_id,)).fetchone())
            self.assertFalse(c.execute('SELECT 1 FROM group_update_reactions WHERE update_id=%s',(update_id,)).fetchone())
            self.assertIsNotNone(c.execute('SELECT id FROM group_updates WHERE id=%s',(other,)).fetchone())
            self.assertIsNotNone(c.execute('SELECT id FROM event_groups WHERE id=%s',(gid,)).fetchone())
            self.assertIsNotNone(c.execute('SELECT id FROM activities WHERE id=%s',(aid,)).fetchone())
            self.assertEqual(c.execute('SELECT status,group_update_id FROM reports WHERE id=%s',(rid,)).fetchone(),{'status':'done','group_update_id':None})
            rows = c.execute("SELECT action,target FROM admin_audit WHERE actor_id=%s AND action='report.remove_group_update'",(self.ids['admin'],)).fetchall()
            self.assertEqual(rows,[{'action':'report.remove_group_update','target':str(rid)}])

    def test_group_update_removal_rechecks_content_identity_and_missing_target(self):
        rid,gid,update_id,_ = self.group_report(update=True)
        snap = self.a.get(f'/api/admin/review/{rid}').json()
        with db.connect() as c:c.execute("UPDATE group_updates SET text='Changed update' WHERE id=%s",(update_id,))
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_group_update')).status_code,409)
        fresh = self.a.get(f'/api/admin/review/{rid}').json()
        with db.connect() as c:
            replacement = c.execute('INSERT INTO group_updates(group_id,user_id,text,created) SELECT group_id,user_id,text,created FROM group_updates WHERE id=%s RETURNING id',(update_id,)).fetchone()['id']
            c.execute('UPDATE reports SET group_update_id=%s WHERE id=%s',(replacement,rid))
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,fresh,'remove_group_update')).status_code,409,'same text is not the same target')
        with db.connect() as c:c.execute('DELETE FROM group_updates WHERE id=%s',(replacement,))
        missing = self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual([a['value'] for a in missing['actions']],['dismiss'])
        self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,missing,'remove_group_update')).status_code,409)
        with db.connect() as c:self.assertIsNotNone(c.execute('SELECT id FROM group_updates WHERE id=%s',(update_id,)).fetchone())

    def test_group_update_target_must_match_report_group_and_author(self):
        rid,gid,_,_ = self.group_report(update=True)
        _,other_group,foreign,_ = self.group_report(update=True)
        with db.connect() as c:
            wrong_author = c.execute("INSERT INTO group_updates(group_id,user_id,text) VALUES(%s,%s,'Unrelated author sentinel') RETURNING id",(gid,self.ids['other'])).fetchone()['id']
        for target in (foreign,wrong_author):
            with db.connect() as c:c.execute('UPDATE reports SET group_update_id=%s WHERE id=%s',(target,rid))
            snap = self.a.get(f'/api/admin/review/{rid}').json()
            self.assertNotIn('Unrelated author sentinel',str(snap));self.assertEqual([a['value'] for a in snap['actions']],['dismiss'])
            self.assertEqual(self.a.post(f'/api/admin/review/{rid}',json=self.decision(rid,snap,'remove_group_update')).status_code,409)

    def test_group_update_reference_upgrade_does_not_guess_legacy_target(self):
        from app import admin_review
        rid,_,update_id,_ = self.group_report(update=True)
        with db.connect() as c:
            c.execute('SAVEPOINT update_report_upgrade')
            try:
                c.execute('ALTER TABLE reports DROP COLUMN group_update_id')
                c.execute(db.MIGRATIONS[128]);c.execute(db.MIGRATIONS[128])
                self.assertIsNone(c.execute('SELECT group_update_id FROM reports WHERE id=%s',(rid,)).fetchone()['group_update_id'])
                self.assertEqual([a['value'] for a in admin_review.material(c,rid)[1]['actions']],['dismiss'])
                c.execute('UPDATE reports SET group_update_id=%s WHERE id=%s',(update_id,rid))
                c.execute(db.MIGRATIONS[128])
                self.assertEqual(c.execute('SELECT group_update_id FROM reports WHERE id=%s',(rid,)).fetchone()['group_update_id'],update_id)
                self.assertEqual([a['value'] for a in admin_review.material(c,rid)[1]['actions']],['dismiss','remove_group_update'])
            finally:c.execute('ROLLBACK TO SAVEPOINT update_report_upgrade')

    def test_group_update_moderation_preserves_reader_rls(self):
        rid,gid,update_id,_ = self.group_report(update=True)
        role='zz_test_update_reader_'+uuid.uuid4().hex[:8];password='fictional reader phrase'
        with db.connect() as c:
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
            c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
            c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids['other']))
            for table in ('reports','group_updates'):
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE oid=%s::regclass',(table,)).fetchone()['relrowsecurity'])
            self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers','reports','SELECT') AS ok").fetchone()['ok'])
        try:
            with psycopg.connect(db._conninfo(role,password),row_factory=dict_row,autocommit=True) as reader:
                self.assertEqual(reader.execute('SELECT id FROM group_updates WHERE id=%s',(update_id,)).fetchall(),[{'id':update_id}])
                for statement in ('SELECT group_update_id FROM reports WHERE id=%s','DELETE FROM group_updates WHERE id=%s'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute(statement,(rid if 'reports' in statement else update_id,))
                with db.connect() as c:c.execute("UPDATE group_members SET status='removed',removed_invite_generation=1 WHERE group_id=%s AND user_id=%s",(gid,self.ids['other']))
                self.assertEqual(reader.execute('SELECT id FROM group_updates WHERE id=%s',(update_id,)).fetchall(),[])
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids['other'],))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_group_update_reports_follow_account_erasure(self):
        from app.api_account import erase
        rid,gid,update_id,_ = self.group_report(update=True)
        with db.connect() as c:
            c.execute('UPDATE event_groups SET organizer_id=%s WHERE id=%s',(self.ids['admin'],gid))
            erase(c,c.execute('SELECT * FROM users WHERE id=%s',(self.ids['other'],)).fetchone())
            self.assertIsNone(c.execute('SELECT reporter FROM reports WHERE id=%s',(rid,)).fetchone()['reporter'])
        snap = self.a.get(f'/api/admin/review/{rid}').json()
        self.assertEqual(snap['item']['id'],update_id)
        self.assertEqual(snap['report']['reporter'],'Deleted account')
        with db.connect() as c:
            erase(c,c.execute('SELECT * FROM users WHERE id=%s',(self.ids['plain'],)).fetchone())
            self.assertIsNone(c.execute('SELECT id FROM reports WHERE id=%s',(rid,)).fetchone())
            self.assertIsNone(c.execute('SELECT id FROM group_updates WHERE id=%s',(update_id,)).fetchone())
            self.assertIsNotNone(c.execute('SELECT id FROM event_groups WHERE id=%s',(gid,)).fetchone())
        self.assertEqual(self.a.get(f'/api/admin/review/{rid}').status_code,404)

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

    def test_confirmation_email_can_be_sent_again(self):
        """An unconfirmed signup is hidden from everyone; an admin can send them a fresh link (2026-10-26)."""
        with db.connect() as c:
            c.execute('UPDATE users SET needs_email_confirm=true WHERE id=%s',(self.ids['plain'],))
            c.execute("INSERT INTO account_tokens(token_hash,user_id,kind,email,expires) VALUES ('zz-old',%s,'verify_email','zz_test_launch_plain@example.test',now()-interval '1 hour')",(self.ids['plain'],))
        b=action(confirm='zz_test_launch_plain');url=f"/api/admin/manage/{self.ids['plain']}/confirm-email"
        r=self.a.post(url,json=b);self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(len(self.sent),1);self.assertEqual(self.sent[0]['to'],['zz_test_launch_plain@example.test']);self.assertIn('/confirm-email#',self.sent[0]['text'])
        self.assertEqual(self.a.post(url,json=b).json(),r.json());self.assertEqual(len(self.sent),1,'a retried request sends once')
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL AND expires>now()",(self.ids['plain'],)).fetchone()['n'],1)
        self.assertEqual(self.manage('email','confirm-email').status_code,409,'already confirmed')

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

    def test_unhandled_action_failure_rolls_back_and_records_only_uncertain_metadata(self):
        with db.connect() as c:c.execute("DELETE FROM admin_readiness WHERE check_key='capacity'")
        c=TestClient(app,raise_server_exceptions=False);c.headers['Origin']='http://testserver'
        c.cookies.set(admin_auth.COOKIE,self.token,path='/api');c.headers['X-Admin-CSRF']=admin_auth.csrf(self.token)
        with patch('app.admin_readiness.complete',side_effect=RuntimeError('PRIVATE FAILURE CONTENT')):
            r=c.post('/api/admin/readiness/capacity',json=action(passed=True,confirmed=True,observed_at=dt.datetime.now(dt.timezone.utc).isoformat()))
        self.assertEqual(r.status_code,500)
        with db.connect() as c:self.assertIsNone(c.execute("SELECT 1 FROM admin_readiness WHERE check_key='capacity'").fetchone())
        rows=self.a.get('/api/admin/audit-history?outcome=uncertain&action=readiness.record').json()['items']
        self.assertTrue(rows);self.assertNotIn('PRIVATE FAILURE CONTENT',str(rows))

    def test_same_retry_id_is_serialized(self):
        b=action(passed=True,confirmed=True,observed_at=dt.datetime.now(dt.timezone.utc).isoformat())
        def send(_):
            c=client();c.cookies.set(admin_auth.COOKIE,self.token,path='/api');c.headers['X-Admin-CSRF']=admin_auth.csrf(self.token)
            r=c.post('/api/admin/readiness/restore',json=b);return r.status_code,r.json()
        with ThreadPoolExecutor(max_workers=2) as pool:rows=list(pool.map(send,range(2)))
        self.assertEqual(rows[0],rows[1]);self.assertEqual(rows[0][0],200)
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM admin_action_receipts WHERE request_key=%s',(b['request_key'],)).fetchone()['n'],1)

if __name__=='__main__':unittest.main()
