"""Fictional sources, actual SQL/HTTP and deterministic algorithm stand-ins; no devices/providers/models."""
import concurrent.futures
import datetime as dt
import json
import math
import threading
import secrets
import psycopg
from psycopg import sql
import unittest
import uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from psycopg import errors
from app import auth,db,admin_auth,activities,api_segments,route_geo,segments,segment_rebuilds as rebuilds
from app.main import app

PW='fictional integrity test password'
LAT,LON=45.30,10.20

def north(m):return [LAT+m/110540,LON]
def client(token=None):
    c=TestClient(app);c.headers.update({'Origin':'http://testserver','Content-Type':'application/json'})
    if token:c.cookies.set(auth.COOKIE,token)
    return c

class Integrity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pw=auth.hash_pw(PW)
    def setUp(self):
        self.ids={};self.clients={};self.prefix='zz_test_integrity_'+uuid.uuid4().hex[:8]+'_'
        with db.connect() as c:
            for name in ('owner','rival','admin'):
                uid=c.execute('INSERT INTO users(login,name,pw_hash,is_admin) VALUES(%s,%s,%s,%s) RETURNING id',(self.prefix+name,'Fictional '+name,self.pw,name=='admin')).fetchone()['id']
                self.ids[name]=uid;c.execute('INSERT INTO profile(user_id,segment_boards) VALUES(%s,true)',(uid,))
                self.clients[name]=client(auth.new_session(c,uid,'fictional test'))
            tok=admin_auth.issue_session(c,self.ids['admin'])
        self.admin=client();self.admin.cookies.set(admin_auth.COOKIE,tok,path='/api');self.admin.headers['X-Admin-CSRF']=admin_auth.csrf(tok)
        with patch.object(api_segments.route_providers,'elevation',return_value=None):
            r=self.clients['owner'].post('/api/segments',json={'client_id':str(uuid.uuid4()),'name':'Fictional integrity hill','sport':'run','audience':'everyone','understood_fixed':True,'line':route_geo.encode([north(600),north(1000)])})
        self.assertEqual(r.status_code,200,r.text);self.sid=r.json()['id']
    def tearDown(self):
        from app.api_account import erase
        with db.connect() as c:
            for uid in self.ids.values():erase(c,{'id':uid,'sql_role':None})
    def activity(self,name='owner',speed=5,day=1,assistance='unassisted',source='track',label=None):
        n=round(1600/speed);t=[float(i) for i in range(n+1)];pts=[north(1600*i/n) for i in range(n+1)]
        with db.connect() as c:
            aid=c.execute('''INSERT INTO activities(user_id,name,sport,sport_label,start_time,source,visibility,distance_m,elapsed_s,segment_assistance)
              VALUES(%s,'Fictional run','run',%s,%s,%s,'everyone',1600,%s,%s) RETURNING id''',(self.ids[name],label,dt.datetime(2026,10,day,8,tzinfo=dt.timezone.utc),source,n,assistance)).fetchone()['id']
            c.execute('INSERT INTO activity_streams(activity_id,user_id,t,lat,lon) VALUES(%s,%s,%s,%s,%s)',(aid,self.ids[name],t,[p[0] for p in pts],[p[1] for p in pts]))
            activities.set_geometry(c,aid,{'lat':[p[0] for p in pts],'lon':[p[1] for p in pts]})
            segments.scan(c,self.sid,aid)
            # Keep tests deterministic while the disposable HTTP server has its own matching worker.
            c.execute("UPDATE segment_jobs SET attempts=5 WHERE kind='activity' AND ref=%s",(aid,))
        return aid
    def board(self):
        r=self.clients['rival'].get(f'/api/segments/{self.sid}/leaderboard');self.assertEqual(r.status_code,200,r.text);return r.json()
    def mine(self,aid):return self.clients['owner'].get(f'/api/activities/{aid}/segment-efforts').json()
    def test_assistance_unknown_strict_ownership_retry_and_source_rights(self):
        aid=self.activity(assistance=None)
        self.assertEqual(self.board()['count'],0);self.assertEqual(self.mine(aid)['efforts'][0]['why_not'],'assistance_unknown')
        url=f'/api/activities/{aid}/segment-assistance';body={'assistance':'unassisted','revision':0,'confirmed':True}
        self.assertEqual(self.clients['rival'].put(url,json=body).status_code,404)
        for bad in (False,'true',1):self.assertIn(self.clients['owner'].put(url,json=body|{'confirmed':bad}).status_code,(400,422))
        for _ in range(2):self.assertEqual(self.clients['owner'].put(url,json=body).status_code,200)
        self.assertEqual(self.mine(aid)['assistance_revision'],1);self.assertEqual(self.board()['count'],1)
        self.assertEqual(self.clients['owner'].put(url,json=body|{'assistance':'assisted'}).status_code,409)
        self.assertEqual(self.clients['owner'].put(url,json=body|{'assistance':'assisted','revision':1}).status_code,200)
        self.assertEqual(self.board()['count'],0)
        self.assertEqual(self.clients['owner'].put(url,json=body|{'assistance':'virtual','revision':2}).status_code,200)
        self.assertEqual(self.board()['count'],0)
        self.clients['owner'].put(url,json=body|{'revision':3})
        with db.connect() as c:c.execute("UPDATE activities SET source='garmin' WHERE id=%s",(aid,))
        self.assertEqual(self.board()['count'],0)
        with db.connect() as c:
            c.execute("UPDATE activities SET source='track',sport_label='Virtual Run' WHERE id=%s",(aid,));segments.scan(c,self.sid,aid)
        self.assertEqual(self.board()['count'],0,'declaration cannot override an imported virtual type')
    def test_staged_atomic_generation_preserves_moderation_appeal_and_identity(self):
        a=self.activity();b=self.activity('rival',speed=4,day=2)
        with db.connect() as c:
            e=c.execute('SELECT id FROM segment_efforts WHERE segment_id=%s AND activity_id=%s',(self.sid,a)).fetchone()['id']
            c.execute("UPDATE segment_efforts SET moderation='held',moderation_reason='Fictional review' WHERE id=%s",(e,))
            ap=c.execute("INSERT INTO segment_appeals(effort_id,user_id,note) VALUES(%s,%s,'Fictional GPS correction') RETURNING id",(e,self.ids['owner'])).fetchone()['id']
        self.assertEqual(self.board()['rows'][0]['elapsed_s'],100)
        with patch.object(segments,'MATCHER',3),db.connect() as c:
            epoch=rebuilds.begin(c,self.sid,1);self.assertEqual(epoch,2)
            self.assertFalse(rebuilds.run_batch(c,self.sid,epoch))
            self.assertEqual(c.execute('SELECT active FROM segment_match_state WHERE segment_id=%s',(self.sid,)).fetchone()['active'],1)
            self.assertEqual(self.board()['rows'][0]['elapsed_s'],100,'uncommitted stage never leaks')
            # A deterministic replacement algorithm stand-in produces a different time.
            c.execute("UPDATE segment_stage_scans SET result=jsonb_set(result,'{0,elapsed_s}','90') WHERE segment_id=%s AND activity_id=%s",(self.sid,b))
            self.assertTrue(rebuilds.run_batch(c,self.sid,epoch))
            self.assertEqual(self.board()['rows'][0]['elapsed_s'],100,'replacement remains atomic until commit')
        self.assertEqual(self.board()['rows'][0]['elapsed_s'],90)
        with db.connect() as c:
            now=c.execute('SELECT id,moderation,generation FROM segment_efforts WHERE segment_id=%s AND activity_id=%s',(self.sid,a)).fetchone()
            self.assertEqual((now['id'],now['moderation'],now['generation']),(e,'held',2))
            self.assertEqual(c.execute('SELECT effort_id FROM segment_appeals WHERE id=%s',(ap,)).fetchone()['effort_id'],e)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM segment_stage_scans WHERE segment_id=%s',(self.sid,)).fetchone()['n'],0)
    def test_cancelled_epoch_cannot_activate_or_erase_newer_stage(self):
        aid=self.activity()
        with db.connect() as c:
            old=rebuilds.begin(c,self.sid,1);rebuilds.run_batch(c,self.sid,old)
            c.execute('UPDATE segment_match_state SET pending=NULL,pending_matcher=NULL WHERE segment_id=%s',(self.sid,))
            new=rebuilds.begin(c,self.sid,1);rebuilds.run_batch(c,self.sid,new)
            self.assertFalse(rebuilds.activate(c,self.sid,old,segments.MATCHER))
            self.assertTrue(rebuilds.run_batch(c,self.sid,old))
            self.assertTrue(c.execute('SELECT 1 FROM segment_stage_scans WHERE segment_id=%s AND epoch=%s',(self.sid,new)).fetchone())
            self.assertTrue(rebuilds.run_batch(c,self.sid,new))
        self.assertEqual(self.board()['count'],1)
    def test_source_revision_immediate_filter_and_rebuild_catchup(self):
        aid=self.activity();self.assertEqual(self.board()['count'],1)
        with db.connect() as c:
            epoch=rebuilds.begin(c,self.sid,1);rebuilds.run_batch(c,self.sid,epoch)
            old=c.execute('SELECT segment_revision FROM activities WHERE id=%s',(aid,)).fetchone()['segment_revision']
            c.execute('UPDATE activity_streams SET t=ARRAY(SELECT unnest(t)*2) WHERE activity_id=%s',(aid,))
            self.assertGreater(c.execute('SELECT segment_revision FROM activities WHERE id=%s',(aid,)).fetchone()['segment_revision'],old)
            self.assertFalse(rebuilds.run_batch(c,self.sid,epoch),'stale staged source is checked again')
            self.assertTrue(rebuilds.run_batch(c,self.sid,epoch))
            c.execute("UPDATE segment_jobs SET attempts=5 WHERE kind='activity' AND ref=%s",(aid,))
        self.assertEqual(self.board()['rows'][0]['elapsed_s'],160)
        with db.connect() as c:
            c.execute('UPDATE activity_streams SET t=ARRAY(SELECT unnest(t)*2) WHERE activity_id=%s',(aid,))
            c.execute("UPDATE segment_jobs SET attempts=5 WHERE kind='activity' AND ref=%s",(aid,))
        self.assertEqual(self.board()['count'],0,'old times disappear before a replacement worker runs')
        self.assertEqual(self.mine(aid)['efforts'][0]['why_not'],'processing')
    def test_privacy_deletion_and_retirement_fence_staged_work(self):
        aid=self.activity()
        with db.connect() as c:
            epoch=rebuilds.begin(c,self.sid,1);rebuilds.run_batch(c,self.sid,epoch)
            c.execute("UPDATE activities SET visibility='me' WHERE id=%s",(aid,))
            self.assertTrue(rebuilds.run_batch(c,self.sid,epoch))
        self.assertEqual(self.board()['count'],0)
        with db.connect() as c:
            epoch=rebuilds.begin(c,self.sid,2);rebuilds.run_batch(c,self.sid,epoch)
            c.execute('DELETE FROM activities WHERE id=%s',(aid,))
            self.assertTrue(rebuilds.run_batch(c,self.sid,epoch))
            self.assertFalse(c.execute('SELECT 1 FROM segment_efforts WHERE activity_id=%s',(aid,)).fetchone())
        aid=self.activity()
        with db.connect() as c:
            epoch=rebuilds.begin(c,self.sid,3);rebuilds.run_batch(c,self.sid,epoch)
            api_segments.take_down(c,[self.sid],'Fictional removal')
            self.assertTrue(rebuilds.run_batch(c,self.sid,epoch))
            self.assertFalse(rebuilds.activate(c,self.sid,epoch,segments.MATCHER))
            self.assertFalse(c.execute('SELECT 1 FROM segment_efforts WHERE segment_id=%s',(self.sid,)).fetchone())
            self.assertTrue(c.execute('SELECT 1 FROM activities WHERE id=%s',(aid,)).fetchone(),'workout survives')
    def test_private_recheck_is_owner_scoped_and_public_creator_has_no_power(self):
        body={'generation':1,'confirmed':True}
        self.assertEqual(self.clients['owner'].post(f'/api/segments/{self.sid}/recheck',json=body).status_code,404)
        with patch.object(api_segments.route_providers,'elevation',return_value=None):
            r=self.clients['owner'].post('/api/segments',json={'client_id':str(uuid.uuid4()),'name':'Fictional private hill','sport':'run','audience':'me','understood_fixed':True,'line':route_geo.encode([north(600),north(1000)])})
        self.assertEqual(r.status_code,200,r.text);sid=r.json()['id']
        url=f'/api/segments/{sid}/recheck'
        self.assertEqual(self.clients['rival'].post(url,json=body).status_code,404)
        self.assertEqual(self.clients['owner'].post(url,json=body|{'confirmed':False}).status_code,400)
        self.assertEqual(self.admin.post(f'/api/admin/segments/{sid}/rebuild',json={'action':'start','generation':1,'reason':'Fictional review','confirmed':True}).status_code,404)
        self.assertEqual(self.clients['owner'].post(url,json=body).status_code,200)
        self.assertEqual(self.clients['owner'].post(url,json=body|{'generation':999}).status_code,409)

    def test_admin_cancel_search_and_bounded_retry(self):
        aid=self.activity()
        with db.connect() as c:
            epoch=rebuilds.begin(c,self.sid,1);rebuilds.run_batch(c,self.sid,epoch)
            c.execute("UPDATE segment_jobs SET attempts=5 WHERE kind='rebuild' AND ref=%s",(self.sid,))
        found=self.admin.get('/api/admin/segments/generations',params={'q':str(self.sid)})
        self.assertEqual(found.status_code,200,found.text);self.assertEqual([g['id'] for g in found.json()],[self.sid])
        self.assertEqual(self.admin.get('/api/admin/segments/generations',params={'q':"' OR true --"}).json(),[])
        body={'action':'cancel','generation':1,'pending':epoch,'reason':'Fictional cancellation review','confirmed':True}
        r=self.admin.post(f'/api/admin/segments/{self.sid}/rebuild',json=body);self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.admin.post(f'/api/admin/segments/{self.sid}/rebuild',json=body).status_code,409)
        with db.connect() as c:
            self.assertFalse(c.execute('SELECT 1 FROM segment_stage_scans WHERE segment_id=%s',(self.sid,)).fetchone())
            for i in range(105):c.execute("INSERT INTO segment_jobs(kind,ref,attempts) VALUES('activity',%s,5)",(-self.sid*1000-i,))
        try:
            r=self.admin.post('/api/admin/segments/jobs/retry',json={});self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['retried'],100)
        finally:
            with db.connect() as c:c.execute("DELETE FROM segment_jobs WHERE kind='activity' AND ref BETWEEN %s AND %s",(-self.sid*1000-104,-self.sid*1000))

    def test_invalid_clock_golden_fixtures(self):
        pts=[north(-20+i*4) for i in range(111)];t=[float(i) for i in range(len(pts))]
        line=[north(0),north(400)];la=[p[0] for p in pts];lo=[p[1] for p in pts]
        self.assertEqual(len(segments.match(line,'run',t,la,lo)[0]),1)
        for bad in (float('nan'),float('inf'),t[50],-10.0):
            clock=t.copy();clock[51]=bad
            self.assertEqual(segments.match(line,'run',clock,la,lo),([],'invalid_times'))
    def test_activation_rollback_and_latest_moderation(self):
        aid=self.activity()
        with db.connect() as c:
            epoch=rebuilds.begin(c,self.sid,1);rebuilds.run_batch(c,self.sid,epoch)
            # Moderation occurs after staging, in another actual transaction.
            with db.connect() as other:
                other.execute("UPDATE segment_efforts SET moderation='excluded',moderation_reason='Fictional newer decision',rev=rev+1 WHERE segment_id=%s",(self.sid,))
            class Fail:
                def execute(inner,query,params=None):
                    if 'UPDATE segment_match_state SET active=' in query:raise RuntimeError('stand-in failure before activation')
                    return c.execute(query,params)
            with self.assertRaises(RuntimeError):
                with c.transaction():rebuilds.activate(Fail(),self.sid,epoch,segments.MATCHER)
            self.assertEqual(c.execute('SELECT active FROM segment_match_state WHERE segment_id=%s',(self.sid,)).fetchone()['active'],1)
            self.assertEqual(c.execute('SELECT generation FROM segment_efforts WHERE segment_id=%s',(self.sid,)).fetchone()['generation'],1)
            self.assertTrue(rebuilds.activate(c,self.sid,epoch,segments.MATCHER))
        self.assertEqual(self.board()['count'],0,'latest moderation is not replaced by a staged old answer')
    def test_real_reader_stage_isolation_owner_links_and_export(self):
        aid=self.activity();other=self.activity('rival',day=2);role=self.prefix+'sql';password=secrets.token_urlsafe(24)
        try:
            with db.connect() as c:
                epoch=rebuilds.begin(c,self.sid,1);rebuilds.run_batch(c,self.sid,epoch)
                c.execute("UPDATE segment_jobs SET attempts=5 WHERE kind='rebuild' AND ref=%s",(self.sid,))
                with self.assertRaises(errors.ForeignKeyViolation):
                    with c.transaction():c.execute('UPDATE segment_stage_scans SET user_id=%s WHERE activity_id=%s',(self.ids['rival'],aid))
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
                c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
                c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids['owner']))
            with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
                rows=reader.execute('SELECT activity_id,user_id FROM segment_stage_scans').fetchall()
                self.assertEqual(rows,[{'activity_id':aid,'user_id':self.ids['owner']}])
                with self.assertRaises(errors.InsufficientPrivilege):reader.execute('SELECT * FROM segment_match_state')
                reader.rollback()
                with self.assertRaises(errors.InsufficientPrivilege):reader.execute('DELETE FROM segment_stage_scans')
                reader.rollback()
            from app.api_mydata import TABLES
            with db.connect() as c:
                rows=c.execute(TABLES['segment_stage_scans'],(self.ids['owner'],)).fetchall()
                self.assertEqual(len(rows),1)
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids['owner'],))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
    def test_stream_update_and_locked_old_worker_do_not_deadlock(self):
        aid=self.activity();started=threading.Event();finished=threading.Event()
        def update():
            started.set()
            with db.connect() as c:c.execute('UPDATE activity_streams SET t=ARRAY(SELECT unnest(t)*1.1) WHERE activity_id=%s',(aid,))
            finished.set()
        with concurrent.futures.ThreadPoolExecutor() as pool:
            with db.connect() as c:
                job=c.execute("SELECT id FROM segment_jobs WHERE kind='activity' AND ref=%s ORDER BY id LIMIT 1 FOR UPDATE",(aid,)).fetchone()
                segments.scan(c,self.sid,aid)
                f=pool.submit(update);self.assertTrue(started.wait(2));self.assertFalse(finished.wait(.1))
            f.result(timeout=5)
        self.assertTrue(finished.is_set())

    def test_account_erasure_waits_before_taking_segment_rows(self):
        from app.api_account import erase
        uid=self.ids['owner'];locked=threading.Event();release=threading.Event();erasing=threading.Event();pid=[]
        with db.connect() as c:c.execute("UPDATE segment_jobs SET attempts=5 WHERE kind='segment' AND ref=%s",(self.sid,))
        def matching():
            with db.connect() as c:
                segments.lock_people(c,[uid]);locked.set()
                if not release.wait(4):raise RuntimeError('Test worker was not released')
                c.execute('SELECT id FROM segments WHERE id=%s FOR UPDATE',(self.sid,)).fetchall()
        def deleting():
            with db.connect() as c:
                c.execute("SET LOCAL lock_timeout='4s'");pid.append(c.info.backend_pid);erasing.set();erase(c,{'id':uid,'sql_role':None})
        with concurrent.futures.ThreadPoolExecutor() as pool:
            worker=pool.submit(matching);self.assertTrue(locked.wait(2));deletion=pool.submit(deleting)
            try:
                self.assertTrue(erasing.wait(2));waiting=False
                import time
                for _ in range(100):
                    with db.connect() as c:waiting=bool(c.execute("SELECT 1 FROM pg_stat_activity WHERE pid=%s AND wait_event_type='Lock'",(pid[0],)).fetchone())
                    if waiting:break
                    time.sleep(.01)
                self.assertTrue(waiting,'erasure waits for the matching account lock')
                # This fails deterministically with the old segment-before-account order.
                with db.connect() as c:
                    row=c.execute('SELECT status FROM segments WHERE id=%s FOR UPDATE NOWAIT',(self.sid,)).fetchone()
                    self.assertEqual(row['status'],'active')
            finally:release.set()
            worker.result(timeout=5);deletion.result(timeout=5)
        with db.connect() as c:self.assertIsNone(c.execute('SELECT id FROM users WHERE id=%s',(uid,)).fetchone())

    def test_admin_bounds_stale_control_and_readers(self):
        self.activity()
        url=f'/api/admin/segments/{self.sid}/rebuild';body={'action':'start','generation':1,'pending':None,'reason':'Fictional algorithm review','confirmed':True}
        self.assertIn(self.clients['owner'].post(url,json=body).status_code,(401,403))
        self.assertEqual(self.admin.post(url,json=body|{'confirmed':False}).status_code,400)
        # Hold the queue rows in a transaction so the server cannot activate between these control requests.
        with patch.object(segments,'BATCH',1):
            r=self.admin.post(url,json=body);self.assertEqual(r.status_code,200,r.text)
        # Whatever the worker did, a stale generation/pending pair must never create another rebuild.
        self.assertEqual(self.admin.post(url,json=body|{'generation':999}).status_code,409)
        d=self.admin.get('/api/admin/segments').json();self.assertTrue(any(g['id']==self.sid for g in d['generations']))
        with db.connect() as c:
            self.assertTrue(c.execute("SELECT relrowsecurity FROM pg_class WHERE relname='segment_stage_scans'").fetchone()['relrowsecurity'])
            self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers','segment_match_state','SELECT') AS p").fetchone()['p'])
            self.assertTrue(c.execute("SELECT 1 FROM pg_policies WHERE tablename='segment_stage_scans' AND policyname='own_rows'").fetchone())
        from app.api_mydata import TABLES
        self.assertIn('segment_stage_scans',TABLES)

if __name__=='__main__':unittest.main(argv=['x','-v'])
