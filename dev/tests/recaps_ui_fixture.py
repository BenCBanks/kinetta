"""Fictional recap pictures; refuse anything except the matching throwaway Docker port."""
import os,sys,datetime as dt,subprocess,json
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT']
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:300])
 return r[1]
today=dt.datetime.now(dt.timezone.utc).date();monday=today-dt.timedelta(days=today.weekday());last=(today.replace(day=1)-dt.timedelta(days=1)).replace(day=1);sql=[]
for state in ('empty','typical','heavy'):
 c=person('zz_test_recap_ui_'+state);ok(c.post('/api/account/delete',{'password':PW}));c=person('zz_test_recap_ui_'+state,'Fictional '+state.title());ok(c.put('/api/profile',{'tz':'UTC','units':'imperial','ai_ok':False}));uid=ok(c.get('/api/me'))['id']
 sql.append(f"UPDATE profile SET protein_target=150 WHERE user_id={uid};")
 if state=='empty':continue
 days=[monday,monday+dt.timedelta(days=min(2,today.weekday())),last,last+dt.timedelta(days=3)]
 if state=='heavy':days=sorted(set(days+[monday-dt.timedelta(weeks=i) for i in range(80)]+[today-dt.timedelta(days=i) for i in range(28)]))
 for i,day in enumerate(days):
  # Private activity is larger than every shared run; no title or body data may reach a picture.
  private=i==1;sport=('run','ride','workout','walk')[i%4] if state=='heavy' else 'run';distance=1609.344*(3 if private else 1) if state=='typical' else 12000 if private else 0 if sport=='workout' else 2500+i*25
  seconds=(900 if private else 1200) if state=='typical' else 1800;stamp=dt.datetime.combine(day,dt.time(0),dt.timezone.utc);sql.append(f"INSERT INTO activities(user_id,sport,name,start_time,distance_m,moving_s,elapsed_s,source,device,visibility) VALUES({uid},'{sport}','PRIVATE TITLE NEVER SHARE','{stamp.isoformat()}',{distance},{seconds},{seconds},'garmin_connect','Forerunner 965','{'me' if private else 'everyone'}');")
 if state=='heavy':
  for i in range(28):
   day=today-dt.timedelta(days=i);sql.append(f"INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g) VALUES({uid},'{day}','lunch','PRIVATE FOOD NEVER SHARE',800,{160 if i%3 else 100},50,20);")
  sql.append(f"INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) SELECT user_id,id,sport,5000,'5K',1500,start_time FROM activities WHERE user_id={uid} AND visibility='everyone' AND sport='run' ORDER BY start_time DESC LIMIT 1;")
r=subprocess.run(['docker','exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],input='\n'.join(sql),text=True,capture_output=True);assert r.returncode==0,r.stderr
print('Recap empty / two-run typical (one Only me) / mixed-sport heavy with 80 weeks and food ready')
