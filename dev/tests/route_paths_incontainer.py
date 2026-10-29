"""Real API/database path-only saves with a bent map-service stand-in, never a routing/network call."""
import json,unittest,uuid
from unittest.mock import patch
import os
from fastapi.testclient import TestClient
from app import auth,db,route_geo,route_providers,api_routes_plan as plans
from app.main import app

# Dormant saved-route compatibility fixture; production does not mount these endpoints.
from copy import copy
from app import api_routes_plan as _legacy_plans, route_sharing as _legacy_sharing
app = copy(app)
from fastapi import APIRouter
app.router = APIRouter(routes=list(app.router.routes))
app.middleware_stack = None
_fallback = app.router.routes.pop()
app.include_router(_legacy_plans.router)
app.include_router(_legacy_sharing.router)
app.router.routes.append(_fallback)


REAL_ROUTE=route_providers.route

def mapped(uid,sport,pts):
    return [{'ok':True,'line':route_geo.encode([a,[(a[0]+b[0])/2,(a[1]+b[1])/2+.001],b])} for a,b in zip(pts,pts[1:])]

class Paths(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pw=auth.hash_pw('fictional path test password')
    def setUp(self):
        self.ids=[];self.clients=[]
        with db.connect() as c:
            for n in range(2):
                uid=c.execute("INSERT INTO users(login,name,pw_hash) VALUES(%s,'Fictional planner',%s) RETURNING id",('zz_test_paths_'+uuid.uuid4().hex,self.pw)).fetchone()['id'];self.ids.append(uid)
                c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,));client=TestClient(app);client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'fictional test'));client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'});self.clients.append(client)
        self.r=patch.object(route_providers,'route',side_effect=mapped);self.router=self.r.start();self.e=patch.object(plans,'_elevation',return_value=None);self.e.start()
    def tearDown(self):
        self.r.stop();self.e.stop()
        from app.api_account import erase
        with db.connect() as c:
            for uid in self.ids:erase(c,{'id':uid,'sql_role':None})
    def body(self,pts=None):
        pts=pts or [[45.3,10.2],[45.31,10.2]]
        return {'client_id':str(uuid.uuid4()),'name':'Fictional curved path','sport':'run','waypoints':pts,'legs':[{'mode':'path','line':r['line']} for r in mapped(0,'run',pts)]}
    def create(self,body):
        r=self.clients[0].post('/api/planned-routes',json=body);self.assertEqual(r.status_code,200,r.text);return r.json()
    def test_manual_track_and_forged_path_labels_cannot_save(self):
        for mode in ('manual','track','path'):
            body=self.body();body['legs']=[{'mode':mode,'line':route_geo.encode(body['waypoints'])}]
            r=self.clients[0].post('/api/planned-routes',json=body);self.assertEqual(r.status_code,409 if mode=='path' else 400,r.text)
        with db.connect() as c:self.assertFalse(c.execute('SELECT 1 FROM planned_routes WHERE user_id=%s',(self.ids[0],)).fetchone())
    def test_saved_geometry_is_the_reviewed_mapped_bend_and_retries_need_no_provider(self):
        body=self.body();saved=self.create(body);self.assertEqual(saved['legs'][0]['line'],body['legs'][0]['line'])
        self.assertGreater(saved['distance_m'],route_geo.dist(*body['waypoints'])+10)
        self.router.side_effect=route_providers.Unavailable('Unavailable')
        r=self.clients[0].post('/api/planned-routes',json=body);self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['id'],saved['id']);self.assertTrue(r.json()['duplicate'])
        dup=self.clients[0].post(f"/api/planned-routes/{saved['id']}/duplicate",json={'client_id':str(uuid.uuid4())});self.assertEqual(dup.status_code,200,dup.text);self.assertEqual(dup.json()['legs'][0]['line'],body['legs'][0]['line'])
    def test_unavailable_no_path_and_missing_legs_keep_database_draft_and_saved_version(self):
        body=self.body();saved=self.create(body);self.clients[0].put('/api/route-drafts/new',json={'data':{'name':'Keep this draft'}})
        for result in (None,[{'ok':False}],[]):
            self.router.side_effect=route_providers.Unavailable('Unavailable') if result is None else None;self.router.return_value=result
            body['client_id']=str(uuid.uuid4());r=self.clients[0].post('/api/planned-routes',json=body);self.assertEqual(r.status_code,503 if result is None else 400,r.text)
            r=self.clients[0].put(f"/api/planned-routes/{saved['id']}",json=body|{'base_version':1});self.assertEqual(r.status_code,503 if result is None else 400,r.text)
        self.assertEqual(self.clients[0].get('/api/route-drafts/new').json()['data']['name'],'Keep this draft')
        self.assertEqual(self.clients[0].get(f"/api/planned-routes/{saved['id']}").json()['version'],1)
    def test_changed_map_requires_another_review_and_other_owner_never_calls_provider(self):
        body=self.body();saved=self.create(body);self.router.reset_mock();self.router.side_effect=route_providers.Unavailable('Unavailable')
        self.assertEqual(self.clients[1].put(f"/api/planned-routes/{saved['id']}",json=body).status_code,404);self.router.assert_not_called()
        self.router.side_effect=lambda uid,sport,pts:[{'ok':True,'line':route_geo.encode(pts)}]
        r=self.clients[0].put(f"/api/planned-routes/{saved['id']}",json=body|{'base_version':1});self.assertEqual((r.status_code,r.json()['detail']['code']),(409,'paths_changed'))
        self.assertEqual(self.clients[0].get(f"/api/planned-routes/{saved['id']}").json()['legs'][0]['line'],body['legs'][0]['line'])
    def test_unjoined_provider_sections_cannot_insert_a_straight_connector(self):
        pts=[[45.3,10.2],[45.31,10.2],[45.32,10.2]];body=self.body(pts);line=route_geo.decode(body['legs'][1]['line']);line[0][1]+=.0001;body['legs'][1]['line']=route_geo.encode(line)
        self.router.side_effect=None;self.router.return_value=[{'ok':True,'line':l['line']} for l in body['legs']]
        r=self.clients[0].post('/api/planned-routes',json=body);self.assertEqual((r.status_code,r.json()['detail']['code']),(400,'paths_required'))
    def test_long_routes_recheck_bounded_batches(self):
        body=self.body([[45.3+i*.001,10.2] for i in range(100)]);self.create(body)
        self.assertEqual([len(c.args[2]) for c in self.router.call_args_list],[26,26,26,25])
    def test_no_path_is_not_cached_and_incomplete_answers_stop_before_saving(self):
        with patch.dict(os.environ,{'KINETTA_ROUTING_URL':'https://example.test'}),patch.object(route_providers,'_route_once',side_effect=[None,[{'ok':True,'line':'fictional provider path'}]]) as transport:
            route_providers._cache.clear()
            pts=[[45.3,10.2],[45.31,10.2]]
            self.assertFalse(REAL_ROUTE(self.ids[0],'run',pts)[0]['ok'])
            self.assertTrue(REAL_ROUTE(self.ids[0],'run',pts)[0]['ok'])
            self.assertEqual(transport.call_count,2,'Retry must consult the provider after a no-path answer')
        with patch.dict(os.environ,{'KINETTA_ROUTING_URL':'https://example.test'}),patch.object(route_providers,'_post',return_value=(200,{'trip':{'legs':[]}})):
            old=route_providers._gates['route'].gap;route_providers._gates['route'].gap=0
            try:
                with self.assertRaises(route_providers.Unavailable):route_providers._route_once('run',[[45.3,10.2],[45.31,10.2]])
            finally:route_providers._gates['route'].gap=old

    def test_import_is_a_guide_and_older_manual_plans_need_paths_before_copy_or_share(self):
        data='<gpx><trk><trkseg><trkpt lat="45.3" lon="10.2"/><trkpt lat="45.31" lon="10.2"/></trkseg></trk></gpx>'
        draft=self.clients[0].post('/api/planned-routes/import',json={'gpx':data}).json()['tracks'][0];body=self.body()|{'waypoints':draft['waypoints'],'legs':draft['legs'],'source':'gpx'}
        self.assertEqual(self.clients[0].post('/api/planned-routes',json=body).status_code,400)
        body['legs']=[{'mode':'path','line':l['line']} for l in mapped(0,'run',body['waypoints'])];saved=self.create(body)
        with db.connect() as c:c.execute("UPDATE planned_route_versions SET legs=%s WHERE route_id=%s",(json.dumps([{'mode':'manual','line':route_geo.encode(body['waypoints'])}]),saved['id']))
        self.assertEqual(self.clients[0].post(f"/api/planned-routes/{saved['id']}/duplicate",json={'client_id':str(uuid.uuid4())}).status_code,400)
        self.assertEqual(self.clients[0].post(f"/api/planned-routes/{saved['id']}/sharing/preview",json={'audience':'everyone','name':'Fictional older route'}).status_code,400)

if __name__=='__main__':unittest.main(argv=['x','-v'])
