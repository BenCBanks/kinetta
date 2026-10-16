"""Disposable-data regressions: batch image contracts and summary correction/import consistency."""
import base64,datetime as dt,json,unittest,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,auth,food_photo,activities,api_health,parsers,activity_corrections
from app.main import app

class Corrections(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with db.connect() as c:
            cls.uid=c.execute("INSERT INTO users(login,name,pw_hash) VALUES ('zz_test_correct','Correction Test',%s) RETURNING id",(auth.hash_pw('fictional correction password'),)).fetchone()['id']
            c.execute('INSERT INTO profile(user_id,ai_ok) VALUES (%s,true)',(cls.uid,))
    @classmethod
    def tearDownClass(cls):
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(cls.uid,))
    def setUp(self):
        self.client=TestClient(app);self.client.headers['Origin']='http://testserver';self.client.post('/api/login',json={'login':'zz_test_correct','password':'fictional correction password'})
    def workout(self,**extra):
        return api_health.WorkoutIn(id=str(uuid.uuid4()),type='running',start=dt.datetime(2026,9,1,10,tzinfo=dt.timezone.utc),end=dt.datetime(2026,9,1,10,30,tzinfo=dt.timezone.utc),duration_s=1800,**extra)
    def save(self,w):
        with db.connect() as c:c.execute('DELETE FROM activities WHERE user_id=%s',(self.uid,))
        return api_health.save(self.uid,w)[1]
    def test_missing_distance_correct_replay_restore(self):
        w=self.workout();aid=self.save(w);path=f'/api/activities/{aid}'
        before=self.client.get(path).json();r=self.client.patch(path,json={'distance_m':5000});self.assertEqual(r.status_code,200,r.text)
        a=self.client.get(path).json();self.assertEqual(a['distance_m'],5000);self.assertEqual(a['summary_overrides'],{'distance_m':5000});self.assertFalse(a['efforts']);self.assertIsNone(a['route_id']);self.assertEqual(a['splits_km'],[])
        # The same Health identity later gains a different distance. Correction wins, latest original is restorable.
        newer=w.model_copy(update={'distance_m':6200});status,again,_=api_health.save(self.uid,newer);self.assertEqual(again,aid)
        a=self.client.get(path).json();self.assertEqual(a['distance_m'],5000);self.assertAlmostEqual(a['summary_original']['distance_m'],6200)
        self.assertEqual(self.client.patch(path,json={'restore_summary':['distance_m']}).status_code,200)
        a=self.client.get(path).json();self.assertEqual(a['distance_m'],6200);self.assertEqual(a['summary_overrides'],{})
        api_health.save(self.uid,newer);self.assertEqual(self.client.get(path).json()['distance_m'],6200)
        with db.connect() as c:self.assertEqual(c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s',(self.uid,)).fetchone()['n'],1)
    def test_recording_and_records_restore(self):
        start=dt.datetime(2026,9,2,10,tzinfo=dt.timezone.utc)
        st={k:[] for k in ('t',)+parsers.STREAMS};st.update(t=list(range(0,1801,30)),dist=[i*3 for i in range(0,1801,30)],hr=[140]*61)
        with db.connect() as c:c.execute('DELETE FROM activities WHERE user_id=%s',(self.uid,))
        _,aid=activities.store(self.uid,{'sport':'run','start':start,'streams':st,'session':{'elapsed_s':1800,'moving_s':1800,'distance_m':5400}},source='manual')
        path=f'/api/activities/{aid}';a=self.client.get(path).json();self.assertTrue(a['efforts']);splits=a['splits_km']
        with db.connect() as c:original_stream=c.execute('SELECT dist FROM activity_streams WHERE activity_id=%s',(aid,)).fetchone()['dist']
        self.assertEqual(self.client.patch(path,json={'distance_m':7000,'moving_s':1600,'avg_hr':150,'max_hr':170}).status_code,200)
        activities.reprocess(self.uid,aid)
        a=self.client.get(path).json();self.assertEqual(a['distance_m'],7000);self.assertEqual(a['moving_s'],1600);self.assertEqual(a['avg_hr'],150);self.assertIsNone(a['zones']);self.assertIsNone(a['effort']);self.assertFalse(a['efforts']);self.assertIsNone(a['gap_s_per_km'])
        with db.connect() as c:self.assertEqual(c.execute('SELECT dist FROM activity_streams WHERE activity_id=%s',(aid,)).fetchone()['dist'],original_stream)
        self.assertEqual(self.client.patch(path,json={'restore_summary':list(a['summary_overrides'])}).status_code,200)
        a=self.client.get(path).json();self.assertEqual(a['distance_m'],5400);self.assertTrue(a['efforts']);self.assertEqual(a['splits_km'],splits)
    def test_validation_and_owner_only(self):
        aid=self.save(self.workout(distance_m=5000));path=f'/api/activities/{aid}'
        for body in ({'distance_m':-1},{'distance_m':1e7},{'moving_s':0},{'avg_hr':301},{'distance_m':'NaN'},{'nonsense':4}):self.assertEqual(self.client.patch(path,json=body).status_code,422,body)
        self.assertEqual(self.client.patch(path,json={'moving_s':2000}).status_code,400)
        self.assertEqual(self.client.patch(path,json={'avg_hr':180,'max_hr':160}).status_code,400)
        self.assertEqual(self.client.patch(path,json={'restore_summary':['name']}).status_code,400)
        other=TestClient(app);other.headers['Origin']='http://testserver';other.post('/api/login',json={'login':'alex','password':'blue kettle morning run'});self.assertEqual(other.patch(path,json={'distance_m':6000}).status_code,404)
        self.assertEqual(self.client.patch(path,json={'distance_m':0}).status_code,200);self.assertEqual(self.client.get(path).json()['distance_m'],0)
        self.assertEqual(self.client.patch(path,json={'distance_m':None}).status_code,200);self.assertIsNone(self.client.get(path).json()['distance_m'])
    def test_duplicate_uses_imported_identity_not_corrected_total(self):
        w=self.workout(distance_m=5000);aid=self.save(w);self.client.patch(f'/api/activities/{aid}',json={'distance_m':10000,'elapsed_s':3600})
        with db.connect() as c:hit=activities.find_duplicate(c,self.uid,w.start,5000,'run',1800)
        self.assertEqual(hit['id'],aid)
    def test_images_joint_request_validation_and_legacy(self):
        imgs=[base64.b64encode(b'\xff\xd8fictional'+bytes([i])).decode() for i in range(2)]
        captured=[]
        def ask(parts,*args):captured.append(parts);return {'items':[{'name':'Meal','amount':'one portion','kcal':400}]},{},'stand-in'
        with patch('app.food_photo.ask',side_effect=ask):
            r=self.client.post('/api/food/photo',json={'images':imgs,'note':'Two views of the same plate'});self.assertEqual(r.status_code,200,r.text);self.assertEqual(len(r.json()['items']),1)
            self.assertEqual(len([p for p in captured[0] if 'inline_data' in p]),2);self.assertIn('one portion',captured[0][0]['text'])
            self.assertEqual(self.client.post('/api/food/photo',json={'image':imgs[0]}).status_code,200)
            self.assertEqual(self.client.post('/api/food/photo',json={'images':[imgs[0],imgs[0]]}).status_code,200);self.assertEqual(len([p for p in captured[-1] if 'inline_data' in p]),1)
            n=len(captured)
            for body in ({'images':imgs*4},{'images':['bad']},{'images':imgs,'image':imgs[0]}):self.assertIn(self.client.post('/api/food/photo',json=body).status_code,(400,422))
            self.assertEqual(len(captured),n)
        label={'readable':True,'name':'Fictional oats','serving_g':40,'per_serving':{'kcal':150,'protein_g':5,'carbs_g':27,'fat_g':3}}
        with patch('app.food_photo.ask',return_value=(label,{},'stand-in')) as provider:
            r=self.client.post('/api/food/label',json={'images':imgs});self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()['per_serving']['kcal'],150);self.assertEqual(len(provider.call_args.args[0]),3)
        self.client.put('/api/profile',json={'ai_ok':False})
        try:
            with patch('app.food_photo.ask') as provider:self.assertEqual(self.client.post('/api/food/photo',json={'images':imgs}).status_code,403);provider.assert_not_called()
        finally:self.client.put('/api/profile',json={'ai_ok':True})

if __name__=='__main__':unittest.main()
