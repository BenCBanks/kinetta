"""Made-up histories for Fitness/Heatmap screenshots on one matching isolated server."""
import os,sys,subprocess,datetime as dt
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT'];assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
now=dt.datetime.now(dt.timezone.utc);sql=[]
for state,n in [('empty',0),('typical',20),('heavy',120)]:
 c=person('zz_test_subpages_'+state);assert c.post('/api/account/delete',{'password':PW})[0]==200;c=person('zz_test_subpages_'+state,'Fictional '+state.title());uid=c.get('/api/me')[1]['id'];assert c.put('/api/profile',{'ai_ok':False,'tz':'UTC','weight_kg':70,'height_cm':174,'birth_year':1992,'sex':'female'})[0]==200
 for i in range(n):
  day=now-dt.timedelta(days=i*3+1);start=day.replace(hour=8,minute=0,second=0,microsecond=0).isoformat();sport='ride' if i%6==5 else 'run';distance=10000 if sport=='ride' else 5000;elapsed=2400 if sport=='ride' else 1500+i%4*30
  # Three repeated fictional lines, offset branches, plus a single-pass line. No real-person route.
  if i==n-1:wkt='LINESTRING(-77.05 38.89,-77.045 38.895,-77.04 38.898)'
  else:wkt=f'LINESTRING(-77.04 38.90,-77.035 38.905,-77.03 {38.91+i%3*.001})'
  sql.append(f"WITH a AS (INSERT INTO activities(user_id,sport,name,start_time,elapsed_s,moving_s,distance_m,effort,source,geom,visibility) VALUES({uid},'{sport}','Fictional training route','{start}',{elapsed},{elapsed},{distance},50,'manual',ST_GeomFromText('{wkt}',4326),'me') RETURNING id,user_id,sport,start_time) INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) SELECT user_id,id,sport,{distance},'{('10K' if sport=='ride' else '5K')}',{elapsed},start_time FROM a;")
r=subprocess.run(['docker','exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],input='\n'.join(sql),text=True,capture_output=True);assert r.returncode==0,r.stderr
print('Fictional empty/20/120 activity private histories, repeated/single-pass routes and best efforts ready')
