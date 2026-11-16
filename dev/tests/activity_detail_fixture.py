"""Before evidence: only fictional seeded/zz_test records on a guarded throwaway project."""
import os,sys,datetime as dt,subprocess,json,base64,time
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,login,ALEX,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT']
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:300])
 return r[1]
people={}
for name in ('owner','friend'):
 c=person('zz_test_detail_'+name);ok(c.post('/api/account/delete',{'password':PW}));c=person('zz_test_detail_'+name,'River '+name.title());ok(c.put('/api/profile',{'tz':'UTC','ai_ok':False}));people[name]=c
owner,friend=people.values();uid=ok(owner.get('/api/me'))['id'];alex=login(*ALEX)
# Detail-share browser fixtures must surface their new First 10K milestone.
# Admin-created test accounts start as backfills, so make this fictional owner fresh before adding activities.
r=subprocess.run(['docker','exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],input=f'UPDATE milestone_state SET fresh=TRUE WHERE user_id={uid};',text=True,capture_output=True);assert r.returncode==0,r.stderr
source={}
for kind in ('run','ride'):
 rows=ok(alex.get('/api/activities?sport='+kind+'&limit=100'));source[kind]=next(a for a in rows if a['line'] and (kind!='run' or a['distance_m']>=5000))
fixture_data=json.loads((Path(__file__).resolve().parents[1] / 'screenshots' / 'fixture-time.json').read_text())
# All activity dates are offsets from the checked-in screenshot clock, never the wall clock.
fixture_anchor=dt.datetime.fromisoformat(fixture_data['instant'].replace('Z','+00:00'))-dt.timedelta(hours=3);ids={};sql=[]
for i,(kind,sport,label) in enumerate([('run','run',None),('paused','run',None),('treadmill','run','Treadmill Running'),('ride','ride',None),('lifting','workout','Strength Training'),('empty','walk',None)]):
 src=source.get('run') if kind=='paused' else source.get(kind);body={'sport':sport,'name':'Fictional '+kind+' session','start':(fixture_anchor-dt.timedelta(days=i)).isoformat(),'duration_s':src['elapsed_s'] if src else 1800,'sport_label':label}
 if kind!='empty':body.update(distance_m=src['distance_m'] if src else 5000 if kind=='treadmill' else None)
 aid=ok(owner.post('/api/activities/manual',body))['id'];ids[kind]=aid
 ok(owner.put(f'/api/activities/{aid}/sharing',{'visibility':'friends' if kind=='run' else 'me'}))
 if src:
  fields=['chart','geom','start_pt','end_pt','avg_hr','max_hr','distance_m','moving_s','elapsed_s','ascent_m','calories','avg_cad','avg_power','max_speed','laps','splits_km','splits_mi','zones','health_details']
  # Copy only known fixture columns; the source is Alex from dev/demo on this isolated database.
  sql.append('UPDATE activities a SET '+','.join(f'{f}=d.{f}' for f in fields)+f' FROM activities d WHERE d.id={src["id"]} AND a.id={aid} AND a.user_id={uid};')
 if kind=='run':
  # A guaranteed First 10K trigger, independent of whichever demo run is returned first.
  sql.append(f"UPDATE activities SET distance_m=10000,elapsed_s=3600,moving_s=3300 WHERE id={aid} AND user_id={uid};")
  sql.append(f"WITH r AS (INSERT INTO routes(user_id,sport,name) VALUES({uid},'run','Fictional river loop') RETURNING id) UPDATE activities SET route_id=(SELECT id FROM r) WHERE id={aid} AND user_id={uid};")
  sql.append(f"INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) SELECT user_id,id,sport,5000,'5K',1500,start_time FROM activities WHERE id={aid} AND user_id={uid};")
  for photo in ('freedom-park-lake.jpg','freedom-park-bridge.jpg'):
   raw=base64.b64encode((Path('dev/demo/photos')/photo).read_bytes()).decode();ok(owner.post(f'/api/activities/{aid}/photos',{'image':'data:image/jpeg;base64,'+raw}))
 if kind=='paused':sql.append(f"UPDATE activities SET name='Fictional paused five mile run',distance_m=8046.72,moving_s=2400,elapsed_s=3000 WHERE id={aid} AND user_id={uid};")
 if kind=='lifting':
  ex=ok(owner.post('/api/lifts/exercises',{'name':'Fictional squat'}))['id'];ok(owner.put(f'/api/activities/{aid}/lifts',{'exercises':[{'exercise_id':ex,'sets':[{'reps':8,'kg':40,'warmup':True},{'reps':5,'kg':70},{'reps':5,'kg':70}]}]}))
r=subprocess.run(['docker','exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],input='\n'.join(sql),text=True,capture_output=True);assert r.returncode==0,r.stderr
ok(friend.post('/api/friends',{'login':'zz_test_detail_owner'}));ok(owner.post('/api/friends/zz_test_detail_friend/accept'))
# Wait for the background worker, then verify the persisted fictional milestone
# directly. The recent-offer API deliberately hides events older than seven days.
deadline=time.monotonic()+20
while True:
 milestones=ok(owner.get(f'/api/milestones?activity_id={ids["run"]}'))
 if not milestones.get('pending'):
  # A new account's historical baseline is intentionally silent. This UI case
  # needs a visible offer, so make that state explicit after the worker has
  # created the fictional milestone instead of relying on account freshness.
  visible=subprocess.run(['docker','exec',project+'-db-1','psql','-U','postgres','-d','fit','-q','-tA','-c',
   f"UPDATE milestones SET silent=false,seen_at=NULL WHERE user_id={uid} AND activity_id={ids['run']} AND code='first:run:10000' AND valid RETURNING title"],
   text=True,capture_output=True)
  assert visible.returncode==0 and visible.stdout.strip()=='First 10K', 'fictional run fixture must create its First 10K milestone'
  milestones=ok(owner.get(f'/api/milestones?activity_id={ids["run"]}'))
  assert any(item.get('title')=='First 10K' for item in milestones.get('items',[])), 'fictional run fixture exposes its First 10K milestone'
  break
 if time.monotonic()>=deadline:raise TimeoutError('milestone worker did not finish the fictional activity fixture')
 time.sleep(.1)
earned=subprocess.run(['docker','exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-At'],input=f"SELECT EXISTS(SELECT 1 FROM milestones WHERE user_id={uid} AND activity_id={ids['run']} AND title='First 10K' AND valid);\n",text=True,capture_output=True);assert earned.returncode==0,earned.stderr;assert earned.stdout.strip()=='t','pinned fictional 10K fixture persists its earned milestone'
if os.environ.get('KINETTA_DETAIL_IDS'):Path(os.environ['KINETTA_DETAIL_IDS']).write_text(json.dumps(ids))
print('Fictional run/HR/route, treadmill, ride, lifting, sparse and friend-view fixture ready')
print(json.dumps(ids))
