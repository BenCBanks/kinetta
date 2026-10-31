"""Fictional nutrition histories on one matching disposable port; no models/providers/real user rows."""
import sys,os,datetime as dt,subprocess,json
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT'];assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:400])
 return r[1]
today=dt.datetime.now(dt.timezone.utc).date();sql=[]
for state in ('empty','low','typical','heavy','unknown'):
 c=person('zz_test_insights_'+state);ok(c.post('/api/account/delete',{'password':PW}));c=person('zz_test_insights_'+state,'Fictional '+state.title());uid=ok(c.get('/api/me'))['id'];ok(c.put('/api/profile',{'tz':'UTC','ai_ok':False,'weight_kg':70,'height_cm':174,'birth_year':1992,'sex':'female','activity_factor':1.3}));ok(c.put('/api/food/targets',{'kcal_target':2100,'protein_target':130,'carbs_target':None,'fat_target':None}));sql.append(f"UPDATE profile SET deficit_start='{today-dt.timedelta(days=70)}' WHERE user_id={uid};")
 n={'empty':0,'low':1,'typical':28,'heavy':365,'unknown':7}[state]
 for i in range(n):
  day=today-dt.timedelta(days=i+1)
  if state in ('typical','heavy') and i%11==5:continue
  if state=='heavy':sql.append(f"INSERT INTO day_energy(user_id,day,burned_kcal,source) VALUES({uid},'{day}',2350,'import');")
  if state in ('typical','heavy') and i%4==0:sql.append(f"INSERT INTO day_goals(user_id,day,kcal) VALUES({uid},'{day}',1900);")
  kcal=1800+(i%5)*45;unknown=state=='unknown' and i<3;ref=json.dumps({'unknown_nutrients':['protein_g']} if unknown else {})
  sql.append(f"INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,ref) VALUES({uid},'{day}','lunch','Fictional logged day',{kcal},{0 if unknown else 120+i%5*5},200,65,28,1400,30,12,'{ref}'::jsonb);")
 if state in ('typical','heavy'):
  # A partial day and today's values must remain visibly separate from completed-day averages.
  sql.append(f"INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g) VALUES({uid},'{today-dt.timedelta(days=6)}','snacks','Fictional snack',100,5,10,3);")
  for i in range(0,30 if state=='typical' else 365,3):
   sql.append(f"INSERT INTO weights(user_id,day,kg,note) VALUES({uid},'{today-dt.timedelta(days=i)}',{70+i*.002},'Fictional weigh-in');")
  sql.append(f"INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g) VALUES({uid},'{today}','breakfast','Fictional today',400,20,50,10);")
r=subprocess.run(['docker','exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],input='\n'.join(sql),text=True,capture_output=True);assert r.returncode==0,r.stderr
print('Fictional empty/one-day/typical/year/missing-protein histories ready; no provider calls')
