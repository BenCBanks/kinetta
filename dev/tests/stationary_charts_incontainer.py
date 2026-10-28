"""Indoor HR-only streams, old zero-speed data, and independent sharing permissions on disposable SQL."""
import datetime as dt,json,uuid,unittest
from fastapi.testclient import TestClient
from app import analysis,db,auth,api_health,parsers
from app.main import app
UTC=dt.timezone.utc
class StationaryCharts(unittest.TestCase):
 def setUp(self):
  self.clients=[];self.ids=[]
  with db.connect() as c:
   for n in range(2):
    uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',('zz_test_bike_'+uuid.uuid4().hex[:12],'Fictional rider',auth.hash_pw('fictional bike testing phrase'))).fetchone()['id'];self.ids.append(uid);c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,));client=TestClient(app);client.cookies.set(auth.COOKIE,auth.new_session(c,uid,'fictional test'));self.clients.append(client)
 def tearDown(self):
  from app.api_account import erase,erase_files
  with db.connect() as c:
   for uid in self.ids:erase(c,{'id':uid,'sql_role':None})
  for uid in self.ids:erase_files(uid)
 def ride(self,chart=None,distance=None):
  chart=chart or {'t':[0,10,20,30], 'd':[0,0,0,0], 'hr':[120,130,140,135], 'speed':[0,0,0,0]}
  with db.connect() as c:return c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,visibility,distance_m,moving_s,elapsed_s,avg_hr,chart) VALUES(%s,'ride','Fictional indoor ride',now(),'healthkit','everyone',%s,1800,1800,131,%s) RETURNING id",(self.ids[0],distance,json.dumps(chart))).fetchone()['id']
 def share(self,aid,hr=True,pace=True):
  with db.connect() as c:c.execute('UPDATE activities SET share_details=%s WHERE id=%s AND user_id=%s',(json.dumps({'heart_rate':hr,'pace':pace}),aid,self.ids[0]))
  return self.clients[1].get('/api/shared/'+str(aid)).json()
 def test_new_health_hr_only_has_time_and_hr_without_speed(self):
  start=dt.datetime(2026,10,10,tzinfo=UTC);w=api_health.WorkoutIn(id=str(uuid.uuid4()),type='cycling',start=start,end=start+dt.timedelta(minutes=30),duration_s=1800,heart_rate=[{'t':start+dt.timedelta(seconds=n*10),'bpm':120+n%25} for n in range(180)])
  parsed,_=api_health.to_activity(w);s=analysis.prepare(parsed['streams'],'ride');chart=analysis.chart_series(s,'ride');self.assertIn('hr',chart);self.assertIn('t',chart);self.assertNotIn('speed',chart)
 def test_existing_zero_speed_removed_on_owner_and_shared_reads(self):
  aid=self.ride();mine=self.clients[0].get('/api/activities/'+str(aid));self.assertEqual(mine.status_code,200);self.assertNotIn('speed',mine.json()['chart']);shared=self.share(aid);self.assertIn('hr',shared['chart']);self.assertNotIn('speed',shared['chart']);self.assertNotIn('chart',self.share(aid,False))
 def test_indoor_hr_when_pace_private_uses_time_without_distance(self):
  aid=self.ride();chart=self.share(aid,True,False)['chart'];self.assertEqual(set(chart),{'t','hr'});self.assertEqual(chart['t'],[0,10,20,30]);self.assertNotIn('chart',self.share(aid,False,False))
 def test_outdoor_short_distance_does_not_leak_time_when_pace_private(self):
  aid=self.ride({'d':[0,20,40,60],'t':[0,5,10,15],'speed':[0,4,4,4],'hr':[120,130,140,135]},60);chart=self.share(aid,True,False)['chart'];self.assertEqual(set(chart),{'d','hr'});self.assertEqual(chart['d'][-1],60);self.assertIn('speed',self.share(aid)['chart'])
 def test_empty_samples_and_explicit_distance_are_preserved(self):
  self.assertIsNone(analysis.clean_chart({'t':[0,10],'d':[0,0],'speed':[0,None],'hr':[None,None]}));self.assertEqual(analysis.clean_chart({'t':[0,10],'speed':[0,5]})['speed'],[0,5])
  aid=self.ride(distance=10000);self.assertEqual(self.clients[0].get('/api/activities/'+str(aid)).json()['distance_m'],10000);self.assertEqual(self.share(aid,False)['distance_m'],10000)
if __name__=='__main__':unittest.main(verbosity=2)
