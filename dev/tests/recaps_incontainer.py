"""Period aggregates, source/privacy boundaries and month offers on real disposable SQL; no models or providers."""
import unittest,uuid,datetime as dt,json
from unittest.mock import patch
from zoneinfo import ZoneInfo
from fastapi.testclient import TestClient
from app import db,auth,recaps
from app.main import app

UTC=dt.timezone.utc
class Recaps(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pw=auth.hash_pw('fictional recap test password')
    def setUp(self):
        self.ids=[];self.clients=[]
        with db.connect() as c:
            for i in range(2):
                uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_recap_'+uuid.uuid4().hex[:12],'Fictional owner',self.pw)).fetchone()['id'];self.ids.append(uid)
                c.execute("INSERT INTO profile(user_id,tz,units,protein_target) VALUES(%s,'America/New_York','imperial',150)",(uid,))
                client=TestClient(app);client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'fictional test'));self.clients.append(client)
    def tearDown(self):
        from app.api_account import erase,erase_files
        with db.connect() as c:
            for uid in self.ids:erase(c,{'id':uid,'sql_role':None})
        for uid in self.ids:erase_files(uid)
    def activity(self,start,distance=1000,seconds=600,visibility='everyone',source='manual',device=None,sport='run',owner=0):
        with db.connect() as c:return c.execute('''INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source,visibility,device)
          VALUES(%s,%s,'PRIVATE ACTIVITY TITLE NEVER OUTPUT',%s,%s,%s,%s,%s,%s,%s) RETURNING id''',(self.ids[owner],sport,start,distance,seconds,seconds,source,visibility,device)).fetchone()['id']
    def facts(self,period='this_month',now='2026-11-04T12:00:00+00:00',owner=0):
        with db.connect() as c:return recaps.facts(c,self.ids[owner],period,dt.datetime.fromisoformat(now))
    def test_legacy_invalid_time_zone_uses_the_configured_default(self):
        with db.connect() as c:c.execute("UPDATE profile SET tz='Invalid/Fictional' WHERE user_id=%s",(self.ids[0],))
        self.assertEqual(self.facts()['tz'],db.DEFAULT_TZ)
    def test_unfinished_lifting_does_not_count_as_a_completed_workout_or_week(self):
        aid=self.activity('2026-11-03T12:00:00Z',sport='workout')
        with db.connect() as c:c.execute('UPDATE activities SET lift_open=true WHERE id=%s',(aid,))
        d=self.facts();self.assertEqual((d['activities'],d['active_days'],d['streak_weeks']),(0,0,0))
        with db.connect() as c:c.execute('UPDATE activities SET lift_open=false WHERE id=%s',(aid,))
        d=self.facts();self.assertEqual((d['activities'],d['active_days'],d['streak_weeks']),(1,1,1))
    def test_totals_match_progress_and_dst_local_dates(self):
        for start,distance in [('2026-11-01T03:30:00Z',1000),('2026-11-01T05:30:00Z',2000),('2026-11-01T06:30:00Z',3000),('2026-11-02T05:00:00Z',4000)]:self.activity(start,distance=distance)
        self.activity('2026-11-01T12:00:00Z',distance=99999,owner=1)
        d=self.facts();self.assertEqual((d['activities'],d['active_days'],d['distance_m'],d['time_s']),(3,2,9000,1800))
        self.assertEqual([str(x['day']) for x in d['days']],['2026-11-01','2026-11-02'])
        progress=self.clients[0].get('/api/progress/volume?period=month').json();nov=[r for r in progress['rows'] if r['p']=='2026-11-01']
        self.assertEqual(sum(r['d'] for r in nov),d['distance_m']);self.assertEqual(sum(r['t'] for r in nov),d['time_s']);self.assertEqual(sum(r['n'] for r in nov),d['activities'])
    def test_private_totals_do_not_name_private_highlights_or_records(self):
        hidden=self.activity('2026-11-01T12:00:00Z',distance=10000,visibility='me',source='garmin_connect',device='Forerunner 965')
        shared=self.activity('2026-11-02T12:00:00Z',distance=5000)
        with db.connect() as c:
            for aid,seconds in [(hidden,1400),(shared,1500)]:c.execute("INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) SELECT user_id,id,'run',5000,'5K',%s,start_time FROM activities WHERE id=%s",(seconds,aid))
        d=self.facts();self.assertEqual(d['distance_m'],15000);self.assertEqual(d['highlights'],[{'kind':'longest','sport':'run','distance_m':5000}]);self.assertEqual(d['garmin_sources'],['Garmin Forerunner 965']);self.assertNotIn('PRIVATE ACTIVITY TITLE',str(d))
    def test_food_consistency_is_days_not_streaks_or_intake(self):
        with db.connect() as c:
            for day,protein in [('2026-10-01',160),('2026-10-05',149),('2026-10-20',150),('2026-10-24',None),('2026-10-25',160),('2026-10-27',160),('2026-10-31',160)]:
                c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,ref) VALUES(%s,%s,'lunch','PRIVATE FOOD NEVER OUTPUT',200,%s,0,0,%s::jsonb)",(self.ids[0],day,protein if protein is not None else 0,json.dumps({'unknown_nutrients':['protein_g']} if protein is None else {})))
        d=self.facts('last_month');self.assertEqual(d['food'],{'logged_days':7,'protein_goal_days':5});self.assertTrue(d['monthly_offer']);self.assertNotIn('PRIVATE FOOD',str(d));self.assertNotIn('protein_target',str(d));self.assertNotIn('kcal',str(d))
        with db.connect() as c:c.execute('UPDATE profile SET protein_target=NULL WHERE user_id=%s',(self.ids[0],))
        self.assertIsNone(self.facts('last_month')['food']['protein_goal_days'])
    def test_offer_days_threshold_and_owner_only_endpoint(self):
        for i in range(3):self.activity(f'2026-10-{i+1:02d}T12:00:00Z')
        self.assertTrue(self.facts('last_month')['monthly_offer']);self.assertFalse(self.facts('last_month','2026-11-08T12:00:00+00:00')['monthly_offer'])
        r=self.clients[1].get('/api/recaps',params={'period':'this_year','user_id':self.ids[0]});self.assertEqual(r.status_code,200);self.assertEqual(r.json()['activities'],0)
        self.assertEqual(TestClient(app).get('/api/recaps').status_code,401);self.assertEqual(self.clients[0].get('/api/recaps?period=next_month').status_code,422)
    def test_january_week_boundary_streak_and_safe_device_names(self):
        self.assertEqual(recaps.dates('last_month',dt.date(2026,1,3)),(dt.date(2025,12,1),dt.date(2026,1,1)))
        self.assertEqual(recaps.dates('this_week',dt.date(2026,11,1)),(dt.date(2026,10,26),dt.date(2026,11,2)))
        for day in ['2026-10-05','2026-10-12','2026-10-19','2026-10-26']:self.activity(day+'T12:00:00Z')
        self.assertEqual(self.facts('last_month')['streak_weeks'],4)
        self.assertEqual(recaps.garmin_source('garmin_connect','Forerunner PrivateName 2026'),'Garmin')
        self.assertEqual(recaps.garmin_source('file','Garmin Edge 540'),'Garmin Edge 540')
        self.assertIsNone(recaps.garmin_source('healthkit','Apple Watch'))

unittest.main(verbosity=2)
