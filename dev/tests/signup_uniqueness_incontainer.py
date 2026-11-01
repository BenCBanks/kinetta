"""Account uniqueness and invitation races; disposable records and a stand-in mail provider."""
import base64
import concurrent.futures
import datetime as dt
import os
import threading
import unittest
import uuid
from unittest.mock import patch
import httpx
from fastapi.testclient import TestClient
from app import account_email, api_account, auth, db
from app.main import app

PW='fictional signup private passphrase'
MAIL={'KINETTA_RESEND_KEY':'stand-in-not-a-key','KINETTA_MAIL_FROM':'Kinetta <hello@example.test>',
      'KINETTA_MAIL_REPLY_TO':'support@example.test','KINETTA_PUBLIC_URL':'https://example.test',
      'KINETTA_MAIL_WEBHOOK_SECRET':'whsec_'+base64.b64encode(b'fictional-webhook-key').decode(),
      'KINETTA_SIGNUP':'open','KINETTA_MAX_ACCOUNTS':'','KINETTA_BETA_SIGNUP':'1'}


def receipt(*args,**kwargs):
    return httpx.Response(200,json={'id':'fictional'},request=httpx.Request('POST','https://api.resend.com/emails'))


class Uniqueness(unittest.TestCase):
    def setUp(self):
        self.tag=uuid.uuid4().hex[:8];self.prefix='zz_test_uq_'+self.tag;self.ids={};self.clients={};self.invites=[];self.emails=set()
        self.env=patch.dict(os.environ,MAIL);self.env.start();self.addCleanup(self.env.stop)
        self.mail=patch('app.account_email.httpx.post',side_effect=receipt).start();self.addCleanup(patch.stopall)
        original=api_account.reserved_login
        patch.object(api_account,'reserved_login',side_effect=lambda v,**kw:original(v,allow_test=True)).start()
        patch.object(auth,'client_ip',side_effect=lambda r:'fixture445:'+self.tag+':'+r.headers.get('x-fixture-client','default')).start()
        with db.connect() as c:
            for kind in ('owner','other','admin'):
                uid=c.execute('INSERT INTO users(login,name,pw_hash,is_admin) VALUES(%s,%s,%s,%s) RETURNING id',(self.prefix+'_'+kind,kind.title()+' Example',auth.hash_pw(PW),kind=='admin')).fetchone()['id']
                c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,));self.ids[kind]=uid
                client=self.client();client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'uniqueness-fixture'));self.clients[kind]=client

    def tearDown(self):
        from app.api_account import erase
        with db.connect() as c:
            if self.invites:c.execute('DELETE FROM invites WHERE id=ANY(%s)',(self.invites,))
            for row in c.execute('SELECT id FROM users WHERE login LIKE %s',(self.prefix.replace('_','\\_')+'%',)).fetchall():erase(c,{'id':row['id'],'sql_role':None})
            c.execute('DELETE FROM auth_attempts WHERE key LIKE %s OR key=ANY(%s)',('%fixture445:'+self.tag+'%',['signup-email:'+auth.token_hash(email) for email in self.emails]))

    def client(self,key=None):
        client=TestClient(app);client.headers.update({'Origin':'http://testserver','Content-Type':'application/json','x-fixture-client':key or uuid.uuid4().hex});return client

    def email(self,stem='address'):
        value=stem+'-'+self.tag+'@example.test';self.emails.add(value);return value

    def form(self,suffix='new',email=None):
        return {'login':self.prefix+'_'+suffix,'name':'Signup Example','password':PW,'email':email or self.email(),'age_ok':True}

    def invitation(self,expired=False):
        token=uuid.uuid4().hex
        with db.connect() as c:
            row=c.execute("INSERT INTO invites(token_hash,created_by,expires) VALUES(%s,%s,now()+%s) RETURNING id",(auth.token_hash(token),self.ids['admin'],dt.timedelta(days=-1 if expired else 7))).fetchone();self.invites.append(row['id'])
        return token

    def snapshot(self):
        with db.connect() as c:
            return tuple(c.execute(f'SELECT count(*) AS n FROM {table}').fetchone()['n'] for table in ('users','sessions','friendships','card_connections','challenge_members'))

    def race(self,*calls):
        barrier=threading.Barrier(len(calls))
        def run(call):barrier.wait();return call()
        with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as pool:return [f.result(timeout=20) for f in [pool.submit(run,call)for call in calls]]

    def test_confirmed_email_rejected_before_open_invite_and_beta_writes(self):
        email=self.email();token=self.invitation();before=self.snapshot()
        with db.connect() as c:c.execute('UPDATE users SET email=%s,email_verified_at=now() WHERE id=%s',(email,self.ids['owner']))
        for path,body in [('/api/signup',self.form('open','  '+email.upper()+'  ')),('/api/join',{**self.form('join',email),'token':token}),('/api/beta',{'name':'Beta Example','email':email,'phone':'iphone'})]:
            r=self.client().post(path,json=body);self.assertEqual(r.status_code,409,r.text);self.assertEqual(r.json()['detail']['code'],'email_exists')
        self.assertEqual(self.snapshot(),before);self.assertEqual(self.mail.call_count,0)
        with db.connect() as c:self.assertIsNone(c.execute('SELECT used_at FROM invites WHERE id=%s',(self.invites[-1],)).fetchone()['used_at'])

    def test_email_off_invitation_and_full_signup_still_offer_existing_account(self):
        email=self.email();token=self.invitation();before=self.snapshot()
        with db.connect() as c:c.execute('UPDATE users SET email=%s,email_verified_at=now() WHERE id=%s',(email,self.ids['owner']))
        with patch.object(account_email,'mail_ready',return_value=False):
            r=self.client().post('/api/join',json={**self.form('existing',email),'token':token});self.assertEqual(r.status_code,409,r.text)
            r=self.client().post('/api/join',json={**self.form('fresh',self.email('fresh')),'token':token});self.assertEqual(r.status_code,503,r.text)
        with patch.dict(os.environ,{'KINETTA_MAX_ACCOUNTS':'0'}):
            r=self.client().post('/api/signup',json=self.form('full',email));self.assertEqual(r.status_code,409,r.text);self.assertEqual(r.json()['detail']['code'],'email_exists')
        self.assertEqual(self.snapshot(),before);self.assertEqual(self.mail.call_count,0)

    def test_pending_and_expired_confirmation_still_claim_the_address(self):
        for expired in (False,True):
            email=self.email('expired' if expired else 'pending')
            with db.connect() as c:
                account_email._token(c,self.ids['owner'],'verify_email',60,email)
                if expired:c.execute("UPDATE account_tokens SET expires=now()-interval '1 hour' WHERE user_id=%s AND kind='verify_email'",(self.ids['owner'],))
            before=self.snapshot();r=self.client().post('/api/signup',json=self.form('pending',email.upper()));self.assertEqual(r.status_code,409,r.text);self.assertEqual(self.snapshot(),before)

    def test_two_simultaneous_joins_create_only_one_account(self):
        email=self.email();tokens=[self.invitation(),self.invitation()];clients=[self.client(),self.client()]
        calls=[lambda i=i:clients[i].post('/api/join',json={**self.form('join'+str(i),email),'token':tokens[i]})for i in range(2)]
        replies=self.race(*calls);self.assertEqual(sorted(r.status_code for r in replies),[200,409],[r.text for r in replies]);self.assertEqual(self.mail.call_count,1)
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM invites WHERE id=ANY(%s) AND used_at IS NOT NULL',(self.invites,)).fetchone()['n'],1)

    def test_open_and_invite_signup_share_the_same_reservation(self):
        email=self.email();token=self.invitation();a,b=self.client(),self.client()
        replies=self.race(lambda:a.post('/api/signup',json=self.form('open',email)),lambda:b.post('/api/join',json={**self.form('join',email.upper()),'token':token}))
        self.assertEqual(sorted(r.status_code for r in replies),[200,409],[r.text for r in replies]);self.assertEqual(self.mail.call_count,1)

    def test_pending_change_resend_and_replacement_are_atomic(self):
        email=self.email();a,b=self.clients['owner'],self.clients['other']
        self.assertEqual(a.put('/api/account/email',json={'email':email,'password':PW}).status_code,200)
        before=self.mail.call_count;r=b.put('/api/account/email',json={'email':email.upper(),'password':PW});self.assertEqual(r.status_code,409,r.text);self.assertEqual(self.mail.call_count,before)
        self.assertEqual(a.put('/api/account/email',json={'email':email,'password':PW}).status_code,200)
        self.assertEqual(a.put('/api/account/email',json={'email':self.email('replacement'),'password':PW}).status_code,200)
        self.assertEqual(b.put('/api/account/email',json={'email':email,'password':PW}).status_code,200)

    def test_legacy_ambiguous_pending_tokens_have_one_confirmation_winner(self):
        email=self.email();tokens=[]
        with db.connect() as c:
            for uid in (self.ids['owner'],self.ids['other']):tokens.append(account_email._token(c,uid,'verify_email',60,email.upper()))
        clients=[self.client(),self.client()]
        replies=self.race(*[lambda i=i:clients[i].post('/api/account/email/confirm',json={'token':tokens[i]})for i in range(2)])
        self.assertEqual(sorted(r.status_code for r in replies),[200,409],[r.text for r in replies])
        self.assertEqual(next(r for r in replies if r.status_code==200).json()['email'],email)

    def test_rejected_duplicates_count_toward_email_limit_across_ips(self):
        email=self.email()
        with db.connect() as c:c.execute('UPDATE users SET email=%s,email_verified_at=now() WHERE id=%s',(email,self.ids['owner']))
        replies=[self.client().post('/api/signup',json=self.form('limited',email))for _ in range(6)]
        self.assertEqual([r.status_code for r in replies],[409]*5+[429])
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM auth_attempts WHERE key=%s',('signup-email:'+auth.token_hash(email),)).fetchone()['n'],6)

    def test_username_availability_is_public_limited_and_owner_aware(self):
        name=self.prefix+'_owner';anon=self.client()
        r=anon.get('/api/account/username-availability',params={'login':' '+name.upper()+' '});self.assertEqual(r.status_code,200);self.assertFalse(r.json()['available']);self.assertEqual(r.json()['reason'],'taken');self.assertTrue(r.json()['suggestion'])
        self.assertTrue(self.clients['owner'].get('/api/account/username-availability',params={'login':name}).json()['available'])
        for name in ('admin','support2','kinetta','api','help'):
            answer=anon.get('/api/account/username-availability',params={'login':name}).json();self.assertFalse(answer['available']);self.assertEqual(answer['reason'],'reserved')
        self.assertEqual(api_account._clean_login(' ADMIN ',current='admin'),'admin')
        self.assertEqual(self.clients['owner'].put('/api/account',json={'login':'support'}).status_code,400)
        changed=self.clients['owner'].put('/api/account',json={'login':' '+(self.prefix+'_changed').upper()+' '});self.assertEqual(changed.status_code,200,changed.text);self.assertEqual(changed.json()['login'],self.prefix+'_changed')
        self.assertNotIn('email',str(r.json()));self.assertNotIn('user_id',str(r.json()))
        limited=self.client('username-limit')
        for _ in range(60):self.assertEqual(limited.get('/api/account/username-availability?login=ordinary_name').status_code,200)
        self.assertEqual(limited.get('/api/account/username-availability?login=ordinary_name').status_code,429)

    def test_duplicate_email_changes_commit_their_attempts(self):
        email=self.email()
        with db.connect() as c:c.execute('UPDATE users SET email=%s,email_verified_at=now() WHERE id=%s',(email,self.ids['owner']))
        replies=[self.clients['other'].put('/api/account/email',json={'email':email,'password':PW})for _ in range(6)]
        self.assertEqual([r.status_code for r in replies],[409]*5+[429]);self.assertEqual(self.mail.call_count,0)

    def test_signup_ip_limit_counts_rejections_with_different_emails(self):
        client=self.client('one-address');replies=[]
        for n in range(21):replies.append(client.post('/api/signup',json={**self.form('reserved',self.email('attempt'+str(n))),'login':'admin'}))
        self.assertEqual([r.status_code for r in replies],[400]*20+[429])

    def test_two_open_signups_cannot_create_duplicate_pending_accounts(self):
        email=self.email();clients=[self.client(),self.client()]
        replies=self.race(*[lambda i=i:clients[i].post('/api/signup',json=self.form('open'+str(i),email))for i in range(2)])
        self.assertEqual(sorted(r.status_code for r in replies),[200,409],[r.text for r in replies]);self.assertEqual(self.mail.call_count,1)

    def test_confirmation_and_email_change_keep_one_claim(self):
        email=self.email()
        with db.connect() as c:token=account_email._token(c,self.ids['owner'],'verify_email',60,email)
        replies=self.race(lambda:self.client().post('/api/account/email/confirm',json={'token':token}),lambda:self.clients['other'].put('/api/account/email',json={'email':email,'password':PW}))
        self.assertEqual([r.status_code for r in replies],[200,409],[r.text for r in replies])

    def test_account_disappearing_after_authentication_does_not_consume_invite(self):
        token=self.invitation();uid=self.ids['owner']
        def actor_was_authenticated():
            from app.api_account import erase
            with db.connect() as c:erase(c,{'id':uid,'sql_role':None})
            return {'id':uid,'login':self.prefix+'_owner','name':'Owner Example','is_admin':False}
        with patch.dict(app.dependency_overrides,{auth.current_user:actor_was_authenticated}):
            r=self.clients['owner'].post('/api/join/existing',json={'token':token});self.assertEqual(r.status_code,404,r.text)
        with db.connect() as c:self.assertIsNone(c.execute('SELECT used_at FROM invites WHERE id=%s',(self.invites[-1],)).fetchone()['used_at'])

    def test_existing_account_acceptance_only_consumes_after_explicit_post(self):
        token=self.invitation();a,b=self.clients['owner'],self.clients['other'];before=self.snapshot()
        self.assertEqual(a.get('/api/join/'+token).status_code,200);self.assertEqual(self.snapshot(),before)
        self.assertEqual(a.post('/api/join/existing',json={'token':token,'user_id':self.ids['other']}).status_code,422)
        self.assertEqual(a.post('/api/join/existing',json={'token':token}).status_code,200)
        again=a.post('/api/join/existing',json={'token':token});self.assertEqual(again.status_code,200);self.assertTrue(again.json()['already_accepted'])
        self.assertEqual(b.post('/api/join/existing',json={'token':token}).status_code,404);self.assertEqual(self.snapshot(),before)
        self.assertEqual(a.post('/api/join/existing',json={'token':self.invitation(expired=True)}).status_code,404)


if __name__=='__main__':unittest.main()
