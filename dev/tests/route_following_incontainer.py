"""Actual private recorder-plan SQL/HTTP with fictional sources; no routing, model, GPS or real-device calls."""
import concurrent.futures
import datetime as dt
import json
import secrets
import unittest
import uuid
import psycopg
from psycopg import errors,sql
from fastapi.testclient import TestClient
from app import auth,db,api_activities
from app.main import app

class Following(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pw=auth.hash_pw('fictional route following password')
    def setUp(self):
        self.ids={};self.c={};self.prefix='zz_test_follow_'+uuid.uuid4().hex[:8]+'_'
        with db.connect() as c:
            for who in ('owner','other'):
                uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(self.prefix+who,'Fictional '+who,self.pw)).fetchone()['id'];self.ids[who]=uid
                c.execute("INSERT INTO profile(user_id,share_default) VALUES(%s,'me')",(uid,));client=TestClient(app);client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'fictional test'));client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'});self.c[who]=client
    def tearDown(self):
        from app.api_account import erase,erase_files
        with db.connect() as c:
            for uid in self.ids.values():erase(c,{'id':uid,'sql_role':None})
        for uid in self.ids.values():erase_files(uid)
    def payload(self,kind='owned'):
        start=dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=2)
        return {'client_id':str(uuid.uuid4()),'sport':'run','name':'Fictional measured run','start':start.isoformat(),'elapsed_s':100,'moving_s':100,'visibility':'me',
          'points':[{'lat':45.3+i*12.5/111195,'lon':10.2,'t':i*5,'accuracy':5,'segment':0} for i in range(21)],
          'route_plan':{'source_kind':kind,'route_id':123456,'version':4,'snapshot_key':'a'*64 if kind=='shared' else None,'name':'Private pinned route name','distance_m':99999}}
    def save(self,body,who='owner'):
        r=self.c[who].post('/api/activities/track',json=body);self.assertEqual(r.status_code,200,r.text);return r.json()
    def test_private_identity_has_no_effect_on_measured_totals_or_public_dtos(self):
        body=self.payload();aid=self.save(body)['id'];a=self.c['owner'].get(f'/api/activities/{aid}').json()
        self.assertAlmostEqual(a['distance_m'],250,delta=2);self.assertEqual(a['moving_s'],100);self.assertEqual(a['elapsed_s'],100)
        self.assertEqual(a['route_plan']['version'],4);self.assertEqual(a['route_plan']['name'],body['route_plan']['name'])
        self.assertEqual(self.c['other'].get(f'/api/activities/{aid}').status_code,404)
        with db.connect() as c:c.execute("UPDATE activities SET visibility='everyone' WHERE id=%s",(aid,))
        public=self.c['other'].get(f'/api/shared/{aid}');self.assertEqual(public.status_code,200,public.text)
        self.assertNotIn('route_plan',public.json());self.assertNotIn(body['route_plan']['name'],public.text)
        self.assertNotIn('route_plan',self.c['other'].get('/api/feed/friends').text)
    def test_lost_acknowledgement_concurrency_and_changed_retry_keep_one_plan(self):
        body=self.payload('shared')
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            result=list(pool.map(lambda _:self.save(body),range(2)))
        self.assertEqual(result[0]['id'],result[1]['id']);aid=result[0]['id']
        retry=body|{'route_plan':body['route_plan']|{'name':'Different retry name','version':9}}
        self.assertTrue(self.save(retry)['duplicate'])
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM activity_route_plans WHERE activity_id=%s',(aid,)).fetchone()['n'],1)
            self.assertEqual(c.execute('SELECT version FROM activity_route_plans WHERE activity_id=%s',(aid,)).fetchone()['version'],4)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM track_recording_receipts WHERE user_id=%s',(self.ids['owner'],)).fetchone()['n'],1)
        other=self.save(body,'other')['id'];self.assertNotEqual(other,aid,'recording identities are scoped to the account')
    def test_watch_first_canonical_recording_keeps_plan_across_retry(self):
        body=self.payload()
        with db.connect() as c:
            aid=c.execute("""INSERT INTO activities(user_id,name,sport,start_time,source,source_id,elapsed_s,moving_s,distance_m,visibility)
              VALUES(%s,'Fictional Watch run','run',%s,'healthkit',%s,100,100,250,'me') RETURNING id""",(self.ids['owner'],body['start'],str(uuid.uuid4()))).fetchone()['id']
        self.assertEqual(self.save(body)['id'],aid);self.assertEqual(self.save(body)['id'],aid)
        self.assertEqual(self.c['owner'].get(f'/api/activities/{aid}').json()['route_plan']['version'],4)
    def test_deleted_activity_receipt_prevents_resurrection_and_old_clients_work(self):
        body=self.payload();aid=self.save(body)['id'];self.assertEqual(self.c['owner'].delete(f'/api/activities/{aid}').status_code,200)
        self.assertEqual(self.c['owner'].post('/api/activities/track',json=body).status_code,409)
        with db.connect() as c:
            self.assertFalse(c.execute('SELECT 1 FROM activity_route_plans WHERE activity_id=%s',(aid,)).fetchone())
            self.assertIsNone(c.execute('SELECT activity_id FROM track_recording_receipts WHERE user_id=%s AND client_id=%s',(self.ids['owner'],body['client_id'])).fetchone()['activity_id'])
        old=self.payload();old.pop('route_plan');saved=self.save(old)['id'];self.assertIsNone(self.c['owner'].get(f'/api/activities/{saved}').json()['route_plan'])
    def test_strict_metadata_and_owner_link_validation(self):
        body=self.payload()
        for plan in (body['route_plan']|{'user_id':self.ids['other']},body['route_plan']|{'distance_m':0},body['route_plan']|{'name':'  '},body['route_plan']|{'source_kind':'shared','snapshot_key':None},body['route_plan']|{'version':0}):
            self.assertEqual(self.c['owner'].post('/api/activities/track',json=body|{'route_plan':plan}).status_code,422)
        aid=self.save(body)['id']
        with db.connect() as c:
            for table in ('activity_route_plans','track_recording_receipts'):
                with self.assertRaises(errors.ForeignKeyViolation):
                    with c.transaction():c.execute(sql.SQL('UPDATE {} SET user_id=%s WHERE activity_id=%s').format(sql.Identifier(table)),(self.ids['other'],aid))
    def test_real_sql_reader_export_and_account_cascade(self):
        body=self.payload();aid=self.save(body)['id'];other=self.save(self.payload(),'other')['id'];role=self.prefix+'sql';password=secrets.token_urlsafe(24)
        try:
            with db.connect() as c:
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)));c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)));c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids['owner']))
            with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
                for table in ('activity_route_plans','track_recording_receipts'):
                    rows=reader.execute(sql.SQL('SELECT activity_id,user_id FROM {}').format(sql.Identifier(table))).fetchall();self.assertEqual(rows,[{'activity_id':aid,'user_id':self.ids['owner']}])
                    with self.assertRaises(errors.InsufficientPrivilege):reader.execute(sql.SQL('DELETE FROM {}').format(sql.Identifier(table)))
                    reader.rollback()
            from app.api_mydata import TABLES
            with db.connect() as c:
                for table in ('activity_route_plans','track_recording_receipts'):
                    self.assertEqual(len(c.execute(TABLES[table],(self.ids['owner'],)).fetchall()),1)
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids['owner'],));c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
        from app.api_account import erase
        with db.connect() as c:erase(c,{'id':self.ids['owner'],'sql_role':None})
        with db.connect() as c:
            for table in ('activity_route_plans','track_recording_receipts'):self.assertFalse(c.execute(sql.SQL('SELECT 1 FROM {} WHERE user_id=%s').format(sql.Identifier(table)),(self.ids['owner'],)).fetchone())

if __name__=='__main__':unittest.main(argv=['x','-v'])
