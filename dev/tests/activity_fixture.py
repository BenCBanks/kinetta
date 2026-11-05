"""Fictional feed evidence on an explicitly guarded local project; no real accounts/devices."""
from pathlib import Path
import os,sys,uuid,math,base64,subprocess,datetime as dt
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT']
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(value):
 assert value[0]==200,value
 return value[1]
names=['empty','typical','heavy','established']+['friend'+str(i) for i in range(6)]+['pending','blocked']
clients={}
for who in names:
 name='zz_test_feed_'+who;c=person(name);ok(c.post('/api/account/delete',{'password':PW}));c=person(name,'River '+who.title());ok(c.put('/api/profile',{'tz':'America/New_York' if who=='typical' else 'UTC','ai_ok':False}));ok(c.put('/api/sharing',{'default':'friends','trim_m':400}));clients[who]=c
for who,count in [('typical',2),('heavy',6),('established',3)]:
 for i in range(count):
  friend='friend'+str(i);ok(clients[friend].post('/api/friends',{'login':'zz_test_feed_'+who}));ok(clients[who].post('/api/friends/zz_test_feed_'+friend+'/accept'))
 ok(clients['pending'].post('/api/friends',{'login':'zz_test_feed_'+who}))
now=dt.datetime.now(dt.timezone.utc)
photos=['freedom-park-lake.jpg','freedom-park-bridge.jpg'];first={}
for who in ['typical','heavy','established']+['friend'+str(i) for i in range(6)]+['blocked']:
 c=clients[who];ids=[]
 for i in range(12 if who=='heavy' else 3 if who.startswith('friend') else 2):
  when=now-dt.timedelta(hours=i*3+(1 if who.startswith('friend') else 0))
  name=['Fictional short route','Fictional long route','Fictional formerly clipped route'][i] if i<3 else 'Fictional trail session '+str(i+1)
  aid=ok(c.post('/api/activities/manual',{'sport':'run' if i%2==0 else 'walk','name':name,'start':when.isoformat(),'duration_s':1500+i*60,'distance_m':5000 if i%2==0 else 2400}))['id'];ids.append(aid)
  ok(c.put(f'/api/activities/{aid}/sharing',{'visibility':'me' if i==1 else 'friends'}))
 if who=='typical':
  for day,name in [('2026-10-29','Fictional River October first workout'),('2026-10-12','Fictional October second workout')]:
   ok(c.post('/api/activities/manual',{'sport':'run','name':name,'start':day+'T08:00:00+00:00','duration_s':1800,'distance_m':5000}))
  if os.environ.get('KINETTA_ACTIVITY_MONTHS_ONLY') == '1':
   for i in range(26):
    when=now-dt.timedelta(minutes=7+i*31)
    ok(c.post('/api/activities/manual',{'sport':'run','name':f'Fictional River session {i+1:02d}','start':when.isoformat(),'duration_s':1800,'distance_m':5000}))
 first[who]=ids[0]
 for photo in photos if who in ('typical','heavy','established') else photos[:1] if who=='friend0' else []:
  raw=base64.b64encode((Path('dev/demo/photos')/photo).read_bytes()).decode();ok(c.post(f'/api/activities/{ids[0]}/photos',{'image':'data:image/jpeg;base64,'+raw}))
# One mapless treadmill run and three fictional route scales exercise the compact row and route fitting.
aid=ok(clients['heavy'].post('/api/activities/manual',{'sport':'run','name':'Fictional treadmill workout','start':(now-dt.timedelta(minutes=30)).isoformat(),'duration_s':2400,'distance_m':5000}))['id']
ok(clients['heavy'].put(f'/api/activities/{aid}/sharing',{'visibility':'me'}))
spans=[(.0008,.0005),(.018,.01),(.075,.05)]
statements=[]
for who in ['typical','heavy','established']+['friend'+str(i) for i in range(6)]+['blocked']:
 # The first three rows for each persona are short, long and previously clipped routes.
 own=[int(row['id']) for row in ok(clients[who].get('/api/activities?limit=100')) if row['name']!='Fictional treadmill workout']
 for index,activity_id in enumerate(own):
  if who.startswith('friend') and index==0:
   sx,sy=spans[1]  # Leave a visible fictional route after the 400 m friend-map trim.
  elif index<3:
   sx,sy=spans[index]
  else:
   sx,sy=spans[1]
  coords=','.join(f'{-73.9665+sx*math.cos(i*math.tau/80)} {40.7812+sy*math.sin(i*math.tau/80)}' for i in range(81));wkt='LINESTRING('+coords+')'
  statements.append(f"UPDATE activities SET geom=ST_GeomFromText('{wkt}',4326),start_pt=ST_StartPoint(ST_GeomFromText('{wkt}',4326)),end_pt=ST_EndPoint(ST_GeomFromText('{wkt}',4326)) WHERE id={activity_id};")
for who in ('typical','heavy','established'):
 uid=ok(clients[who].get('/api/me'))['id'];aid=first[who];statements.append(f"WITH r AS (INSERT INTO routes(user_id,sport,name) VALUES({uid},'run','Fictional matched loop') RETURNING id) UPDATE activities SET route_id=(SELECT id FROM r) WHERE user_id={uid} AND id={aid};")
 ok(clients['friend0'].post(f'/api/activities/{aid}/reaction',{'kind':'strong'}));ok(clients['friend1'].post(f'/api/activities/{aid}/reaction',{'kind':'applause'}));ok(clients['friend0'].post(f'/api/activities/{aid}/comments',{'text':'Fictional encouragement'}))
 ok(clients[who].post('/api/food/entries',[{'day':str(now.date()),'meal':'lunch','name':'Fictional private noodles','kcal':999,'protein_g':37,'carbs_g':80,'fat_g':18}]))
 ok(clients[who].put('/api/food/weights',{'day':str(now.date()),'kg':121.7}))
r=subprocess.run(['docker','exec','-i',project+'-db-1','psql','-U','postgres','-d','fit','-v','ON_ERROR_STOP=1','-q'],input='\n'.join(statements),text=True,capture_output=True);assert r.returncode==0,r.stderr
ok(clients['heavy'].post('/api/people/zz_test_feed_blocked/block',{}))
ok(clients['heavy'].post('/api/challenges',{'kind':'active_days','period':'this_week','target':4,'unit':'days','sports':[],'request_id':uuid.uuid4().hex}))
print('Fictional feed personas: 0/2/3/6 friends, requests, private controls, maps/photos, reactions and active challenge ready')
