"""Route sharing with fictional accounts, real disposable SQL and stand-in terrain. No provider/model/device calls."""
import concurrent.futures
import datetime as dt
import json
import math
import threading
import time
import unittest
import uuid
import secrets
import psycopg
from psycopg import sql
from unittest.mock import patch

from fastapi.testclient import TestClient
from psycopg import errors
from app import auth,db,admin_auth,api_routes_plan as plans,route_geo,route_sharing as sharing
from app.main import app

PW='fictional route test password'
LAT,LON=45.30,10.20
def north(m):return [LAT+m/110540,LON]
def terrain(uid,line):
    n=route_geo.length(line)
    return {'profile':[[n*i/20,100+i*2] for i in range(21)],'ascent_m':40,'descent_m':0,'unknown_m':0,'source':'private-provider-request?secret=not-for-recipients'}
def client(token=None):
    c=TestClient(app);c.headers.update({'Origin':'http://testserver','Content-Type':'application/json'})
    if token:c.cookies.set(auth.COOKIE,token)
    return c

class Sharing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pw=auth.hash_pw(PW)
    def setUp(self):
        self.patch=patch.object(plans,'_elevation',side_effect=terrain);self.patch.start()
        self.ids={};self.tokens={};self.c={};self.prefix='zz_test_share_'+uuid.uuid4().hex[:8]+'_'
        with db.connect() as c:
            for name in ('owner','friend','stranger','admin'):
                uid=c.execute('INSERT INTO users(login,name,pw_hash,is_admin) VALUES(%s,%s,%s,%s) RETURNING id',(self.prefix+name,'Fictional '+name,self.pw,name=='admin')).fetchone()['id']
                c.execute('INSERT INTO profile(user_id,share_trim_m) VALUES(%s,400)',(uid,));self.ids[name]=uid
                self.tokens[name]=auth.new_session(c,uid,'fictional test');self.c[name]=client(self.tokens[name])
            c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(self.ids['owner'],self.ids['friend']))
            token=admin_auth.issue_session(c,self.ids['admin'])
        self.admin=client();self.admin.cookies.set(admin_auth.COOKIE,token,path='/api');self.admin.headers['X-Admin-CSRF']=admin_auth.csrf(token)
        self.route=self.make_route()
    def tearDown(self):
        self.patch.stop()
        from app.api_account import erase
        with db.connect() as c:
            for uid in self.ids.values():erase(c,{'id':uid,'sql_role':None})
    def make_route(self,length=4000):
        pts=[north(length*i/20) for i in range(21)]
        r=self.c['owner'].post('/api/planned-routes',json={'client_id':str(uuid.uuid4()),'name':'Private original title','description':'Never share this private note','sport':'run',
          'waypoints':[pts[0],pts[-1]],'legs':[{'mode':'manual','line':route_geo.encode([pts[0],pts[-1]])}]})
        self.assertEqual(r.status_code,200,r.text);return r.json()
    def preview(self,audience='friends',**kw):
        r=self.c['owner'].post(f"/api/planned-routes/{self.route['id']}/sharing/preview",json={'audience':audience,'name':'Fictional shared loop','description':'Meet at the public trailhead',**kw})
        self.assertEqual(r.status_code,200,r.text);return r.json()
    def publish(self,audience='friends',**kw):
        p=self.preview(audience,**kw);r=self.c['owner'].put(f"/api/planned-routes/{self.route['id']}/sharing",json={'preview_id':p['preview_id'],'confirmed':True})
        self.assertEqual(r.status_code,200,r.text);return p,r.json()
    def shared(self,who='friend'):
        r=self.c[who].get(f"/api/shared-routes/{self.route['id']}");self.assertEqual(r.status_code,200,r.text);return r.json()

    def test_audiences_and_all_recipient_representations(self):
        rid=self.route['id'];url=f'/api/shared-routes/{rid}'
        self.assertEqual(self.c['friend'].get(url).status_code,404)
        p,state=self.publish()
        d=self.shared();self.assertEqual(d['line'],p['route']['line'])
        for field in ('distance_m','ascent_m','descent_m','elevation','warnings','description'):
            self.assertEqual(d[field],p['route'][field],field+' matches the reviewed preview exactly')
        self.assertEqual(self.c['stranger'].get(url).status_code,404)
        self.assertEqual(client().get(url).status_code,401)
        landing=client().get(f'/routes/shared/{rid}')
        self.assertEqual(landing.status_code,200)
        for private in ('Fictional shared loop','Meet at the public trailhead','Never share this private note'):
            self.assertNotIn(private,landing.text,'signed-out HTML/metadata remains generic')
        self.assertEqual(client().get(url+'/gpx',params={'snapshot_key':d['snapshot_key']}).status_code,401)
        self.assertEqual(client().post(url+'/copy',json={'client_id':str(uuid.uuid4()),'snapshot_key':d['snapshot_key']}).status_code,401)
        for verb,path,body in [('get',f'/api/planned-routes/{rid}',None),('get',f'/api/planned-routes/{rid}/gpx',None),('post',f'/api/planned-routes/{rid}/duplicate',{'client_id':str(uuid.uuid4())})]:
            self.assertEqual(getattr(self.c['friend'],verb)(path,**({'json':body} if body else {})).status_code,404)
        self.publish('everyone');self.shared('stranger')
        self.assertEqual(self.c['stranger'].get('/api/shared-routes').json()['rows'][0]['id'],rid)
        with db.connect() as c:c.execute('UPDATE users SET suspended_at=now() WHERE id=%s',(self.ids['owner'],))
        self.assertEqual(self.c['friend'].get(url).status_code,404)
        self.assertEqual(self.c['stranger'].get('/api/shared-routes').json()['rows'],[])

    def test_projection_has_no_hidden_private_fields_or_totals(self):
        p,_=self.publish('everyone',description='')
        d=self.shared('stranger');pts=route_geo.decode(d['line'])
        self.assertGreaterEqual(route_geo.dist(north(0),pts[0]),400)
        self.assertGreaterEqual(route_geo.dist(north(4000),pts[-1]),400)
        self.assertLess(d['distance_m'],self.route['distance_m']-790)
        self.assertAlmostEqual(d['distance_m'],route_geo.length(pts),delta=.2)
        self.assertEqual(d['line'],p['route']['line'])
        self.assertNotIn('Never share',json.dumps(d));self.assertNotIn('private-provider',json.dumps(d))
        for key in ('waypoints','legs','created','updated','source','source_version','hidden_start_m','hidden_end_m','trim_m','activity_id'):
            self.assertNotIn(key,d)
        self.assertIsNone(d['description'])
        elev=d['elevation'];self.assertEqual(elev['profile'][0][0],0)
        self.assertAlmostEqual(elev['profile'][-1][0],d['distance_m'],delta=2)
        file=self.c['stranger'].get(f"/api/shared-routes/{self.route['id']}/gpx",params={'snapshot_key':d['snapshot_key']})
        self.assertEqual(file.status_code,200,file.text)
        self.assertNotIn('Never share',file.text);self.assertNotIn('Private original',file.text);self.assertNotIn('<time>',file.text)
        self.assertNotIn(f'lat="{north(0)[0]:.6f}"',file.text)

    def test_preview_conflicts_retry_and_private_edits_do_not_republish(self):
        rid=self.route['id'];p=self.preview();body={'preview_id':p['preview_id'],'confirmed':True};url=f'/api/planned-routes/{rid}/sharing'
        self.c['owner'].patch(f'/api/planned-routes/{rid}',json={'name':'Changed privately','description':'New private note'})
        self.assertEqual(self.c['owner'].put(url,json=body).status_code,409)
        p,state=self.publish('everyone');body={'preview_id':p['preview_id'],'confirmed':True}
        self.assertTrue(self.c['owner'].put(url,json=body).json()['duplicate'])
        before=self.shared('stranger')
        self.c['owner'].patch(f'/api/planned-routes/{rid}',json={'name':'Later private title','description':'Keep this private too'})
        self.assertEqual(self.shared('stranger'),before)
        self.c['owner'].post(f'/api/planned-routes/{rid}/unshare',json={'revision':state['revision']})
        self.assertEqual(self.c['owner'].put(url,json=body).status_code,409,'old successful publication cannot revive a revoked route')
        self.assertEqual(self.c['friend'].get(f'/api/shared-routes/{rid}').status_code,404)

    def test_privacy_tightening_and_too_short_routes(self):
        p=self.preview('everyone');self.c['owner'].put('/api/sharing',json={'trim_m':800})
        self.assertEqual(self.c['owner'].put(f"/api/planned-routes/{self.route['id']}/sharing",json={'preview_id':p['preview_id'],'confirmed':True}).status_code,409)
        self.c['owner'].put('/api/sharing',json={'trim_m':400});self.publish('everyone')
        old=self.shared('stranger');self.c['owner'].put('/api/sharing',json={'trim_m':800});new=self.shared('stranger')
        self.assertLess(new['distance_m'],old['distance_m']-790);self.assertNotEqual(old['snapshot_key'],new['snapshot_key'])
        bad=self.c['stranger'].post(f"/api/shared-routes/{self.route['id']}/copy",json={'client_id':str(uuid.uuid4()),'snapshot_key':old['snapshot_key']})
        self.assertEqual(bad.status_code,409)
        self.c['owner'].put('/api/sharing',json={'trim_m':0})
        # Lowering a global setting never expands a previously reviewed snapshot.
        self.assertEqual(self.shared('stranger')['line'],old['line'])
        short=self.make_route(500)
        self.c['owner'].put('/api/sharing',json={'trim_m':400})
        self.assertEqual(self.c['owner'].post(f"/api/planned-routes/{short['id']}/sharing/preview",json={'audience':'everyone','name':'Too short'}).status_code,400)

    def test_copy_is_private_independent_retry_safe_and_survives_source_deletion(self):
        self.publish();d=self.shared();rid=self.route['id'];cid=str(uuid.uuid4());payload={'client_id':cid,'snapshot_key':d['snapshot_key']}
        copied=self.c['friend'].post(f'/api/shared-routes/{rid}/copy',json=payload)
        self.assertEqual(copied.status_code,200,copied.text);copy_id=copied.json()['id']
        again=self.c['friend'].post(f'/api/shared-routes/{rid}/copy',json=payload).json();self.assertTrue(again['duplicate']);self.assertEqual(again['id'],copy_id)
        own=self.c['friend'].get(f'/api/planned-routes/{copy_id}').json()
        self.assertEqual(own['line'],d['line']);self.assertNotIn('Never share',str(own));self.assertEqual(self.c['friend'].get(f'/api/planned-routes/{copy_id}/sharing').json()['audience'],'me')
        self.c['owner'].delete(f'/api/planned-routes/{rid}')
        self.assertEqual(self.c['friend'].get(f'/api/planned-routes/{copy_id}').status_code,200)
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT source_route_id FROM planned_routes WHERE id=%s',(copy_id,)).fetchone()['source_route_id'])
            self.assertIsNone(c.execute('SELECT source_route_id FROM route_copy_receipts WHERE destination_id=%s',(copy_id,)).fetchone()['source_route_id'])

    def test_revocation_covers_copy_export_download_and_old_client_retry(self):
        self.publish();d=self.shared();url=f"/api/shared-routes/{self.route['id']}"
        ticket=self.c['friend'].post(url+'/gpx-link',json={'snapshot_key':d['snapshot_key']}).json()['path']
        self.c['friend'].delete('/api/friends/'+self.prefix+'owner')
        self.assertEqual(self.c['friend'].get(url).status_code,404)
        self.assertEqual(self.c['friend'].get(url+'/gpx',params={'snapshot_key':d['snapshot_key']}).status_code,404)
        self.assertEqual(self.c['friend'].post(url+'/copy',json={'client_id':str(uuid.uuid4()),'snapshot_key':d['snapshot_key']}).status_code,404)
        self.assertEqual(client().get(ticket).status_code,404)
        self.publish('everyone');d=self.shared('stranger')
        self.c['owner'].post('/api/people/'+self.prefix+'stranger/block',json={})
        self.assertEqual(self.c['stranger'].get(url).status_code,404)
        self.assertEqual(self.c['stranger'].get('/api/shared-routes').json()['rows'],[])

    def test_download_single_use_expiry_and_session_revocation(self):
        self.publish();d=self.shared();url=f"/api/shared-routes/{self.route['id']}"
        mint=lambda:self.c['friend'].post(url+'/gpx-link',json={'snapshot_key':d['snapshot_key']}).json()['path']
        p=mint();response=client().get(p);self.assertEqual(response.status_code,200,response.text);self.assertEqual(client().get(p).status_code,404)
        p=mint();key=p.rsplit('/',1)[1]
        with sharing._ticket_lock:sharing._tickets[key]=(0,*sharing._tickets[key][1:])
        self.assertEqual(client().get(p).status_code,404)
        p=mint();self.c['friend'].post('/api/logout',json={});self.assertEqual(client().get(p).status_code,404)

    def test_creator_account_deletion_removes_original_but_not_deliberate_copy(self):
        self.publish('everyone');d=self.shared('stranger');rid=self.route['id']
        saved=self.c['stranger'].post(f'/api/shared-routes/{rid}/copy',json={'client_id':str(uuid.uuid4()),'snapshot_key':d['snapshot_key']}).json()['id']
        deleted=self.c['owner'].post('/api/account/delete',json={'password':PW});self.assertEqual(deleted.status_code,200,deleted.text)
        self.assertEqual(self.c['stranger'].get(f'/api/shared-routes/{rid}').status_code,404)
        self.assertEqual(self.c['stranger'].get(f'/api/planned-routes/{saved}').status_code,200)
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT source_route_id FROM planned_routes WHERE id=%s',(saved,)).fetchone()['source_route_id'])
            self.assertFalse(c.execute('SELECT 1 FROM route_publications WHERE route_id=%s',(rid,)).fetchone())
            self.assertFalse(c.execute('SELECT 1 FROM route_share_previews WHERE route_id=%s',(rid,)).fetchone())

    def test_discovery_filters_use_only_shared_geometry(self):
        self.publish('everyone');d=self.shared('stranger');c=self.c['stranger']
        self.assertEqual(c.get('/api/shared-routes',params={'q':'Private original'}).json()['rows'],[])
        self.assertEqual(len(c.get('/api/shared-routes',params={'q':'shared','sport':'run','min_km':2,'max_km':4}).json()['rows']),1)
        self.assertEqual(c.get('/api/shared-routes',params={'sport':'ride'}).json()['rows'],[])
        self.assertEqual(c.get('/api/shared-routes',params={'lat':LAT,'lon':LON,'radius_km':.05}).json()['rows'],[],'hidden start is not a search hit')
        visible_point=route_geo.decode(d['line'])[0]
        self.assertEqual(len(c.get('/api/shared-routes',params={'lat':visible_point[0],'lon':visible_point[1],'radius_km':.05}).json()['rows']),1)

    def test_report_case_scope_stale_material_removal_and_retry(self):
        self.publish('everyone');rid=self.route['id'];url=f'/api/shared-routes/{rid}'
        report=self.c['stranger'].post(url+'/report',json={'reason':'unsafe','note':'Fictional restricted path'}).json()
        self.assertEqual(report['duplicate'],False);self.assertTrue(self.c['stranger'].post(url+'/report',json={'reason':'unsafe'}).json()['duplicate'])
        self.assertEqual(self.c['stranger'].get(url).status_code,200,'a report removes nothing')
        case=self.admin.get(f"/api/admin/route-reports/{report['id']}").json();self.assertEqual(case['route']['line'],self.shared('stranger')['line'])
        self.assertNotIn('Never share',str(case));self.assertEqual(self.c['admin'].get('/api/admin/route-reports').status_code,403)
        body={'request_key':str(uuid.uuid4()),'requested_at':dt.datetime.now(dt.timezone.utc).isoformat(),'action':'remove','version':case['version'],
              'reason':'Reviewed fictional access problem','confirm':self.prefix+'owner'}
        self.c['owner'].put('/api/sharing',json={'trim_m':800})
        self.assertEqual(self.admin.post(f"/api/admin/route-reports/{report['id']}",json=body).status_code,409)
        case=self.admin.get(f"/api/admin/route-reports/{report['id']}").json();body['version']=case['version'];body['request_key']=str(uuid.uuid4())
        result=self.admin.post(f"/api/admin/route-reports/{report['id']}",json=body);self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(self.admin.post(f"/api/admin/route-reports/{report['id']}",json=body).json(),result.json())
        self.assertEqual(self.c['stranger'].get(url).status_code,404)
        self.assertEqual(self.c['owner'].get(f'/api/planned-routes/{rid}').status_code,200)
        self.assertEqual(self.c['owner'].post(f'/api/planned-routes/{rid}/sharing/preview',json={'audience':'everyone','name':'Cannot evade removal'}).status_code,403)

    def test_rls_owner_links_export_and_deletion(self):
        p,_=self.publish();d=self.shared()
        with db.connect() as c:
            for table in ('route_publications','route_share_previews','route_copy_receipts'):
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s',(table,)).fetchone()['relrowsecurity'])
                self.assertTrue(c.execute("SELECT 1 FROM pg_policies WHERE tablename=%s AND policyname='own_rows'",(table,)).fetchone())
            for role in ('fit_readers','fit_all_readers'):
                self.assertFalse(c.execute('SELECT has_table_privilege(%s,%s,%s) AS p',(role,'route_reports','SELECT')).fetchone()['p'])
            with self.assertRaises(errors.ForeignKeyViolation):
                with c.transaction():c.execute('UPDATE route_publications SET user_id=%s WHERE route_id=%s',(self.ids['stranger'],self.route['id']))
        from app.api_mydata import TABLES
        for table in ('route_publications','route_share_previews','route_copy_receipts'):self.assertIn(table,TABLES)

    def test_real_read_only_sql_identity_cannot_read_other_publications(self):
        self.publish('everyone');role=self.prefix+'sql';password=secrets.token_urlsafe(24)
        try:
            with db.connect() as c:
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
                c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
                c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids['stranger']))
            with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
                for table in ('route_publications','route_share_previews','route_copy_receipts'):
                    self.assertEqual(reader.execute(sql.SQL('SELECT * FROM {}').format(sql.Identifier(table))).fetchall(),[],table)
                with self.assertRaises(errors.InsufficientPrivilege):reader.execute('SELECT * FROM route_reports')
                reader.rollback()
                with self.assertRaises(errors.InsufficientPrivilege):reader.execute('DELETE FROM route_publications')
                reader.rollback()
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids['stranger'],))
                c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids['owner']))
            with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
                own=reader.execute('SELECT user_id,route_id FROM route_publications').fetchall()
                self.assertEqual(own,[{'user_id':self.ids['owner'],'route_id':self.route['id']}])
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=ANY(%s)',([self.ids['stranger'],self.ids['owner']],))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_copy_and_block_have_one_authoritative_order(self):
        self.publish('everyone');d=self.shared('stranger');original=sharing.visible;entered=threading.Event();release=threading.Event()
        def paused(c,uid,rid,lock=False):
            value=original(c,uid,rid,lock)
            if lock:entered.set();self.assertTrue(release.wait(5))
            return value
        with patch.object(sharing,'visible',side_effect=paused),concurrent.futures.ThreadPoolExecutor(2) as pool:
            copy=pool.submit(lambda:client(self.tokens['stranger']).post(f"/api/shared-routes/{self.route['id']}/copy",json={'client_id':str(uuid.uuid4()),'snapshot_key':d['snapshot_key']}))
            self.assertTrue(entered.wait(5))
            block=pool.submit(lambda:client(self.tokens['owner']).post('/api/people/'+self.prefix+'stranger/block',json={}))
            time.sleep(.1);self.assertFalse(block.done(),'revocation waits for the authorized copy transaction')
            release.set();saved=copy.result(5);self.assertEqual(saved.status_code,200,saved.text);self.assertEqual(block.result(5).status_code,200)
        self.assertEqual(self.c['stranger'].get(f"/api/shared-routes/{self.route['id']}").status_code,404)
        self.assertEqual(self.c['stranger'].get(f"/api/planned-routes/{saved.json()['id']}").status_code,200)

if __name__=='__main__':unittest.main(argv=['x','-v'])
