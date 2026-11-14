"""Run native layout evidence on isolated Simulator devices. Fixtures and artifacts contain no real data."""
import argparse,hashlib,json,os,platform,re,subprocess,time,uuid
from pathlib import Path
from urllib.parse import urlsplit
import urllib.request
from lifecycle import stop_for_fixture
from header_geometry import check_headers
STORE_STAGES=('header-me','activity','header-track','header-food','food','header-progress','header-activity','achievements')
from startup_timing import phase_durations,summary_markdown
p=argparse.ArgumentParser();p.add_argument('--app',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--store',action='store_true');p.add_argument('--store-stage',action='append',choices=STORE_STAGES,help='Add a Store scene to the default set; repeat for extra screens.');p.add_argument('--device',choices=['compact','pro','all'],default='all');p.add_argument('--startup-timing',action='store_true');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
assert not (a.store and a.startup_timing),'Cold-start timing uses the fictional Me fixture, not Store captures'
def run(*args,check=True,timeout=180):
 try:result=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 except subprocess.TimeoutExpired as error:
  print('Command timed out: '+' '.join(args),flush=True)
  for value in (error.stdout,error.stderr):
   if value:
    value=value.decode(errors='replace') if isinstance(value,bytes) else value
    print(re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',value)[-4000:],flush=True)
  if check:raise
  return ''
 if check and result.returncode:
  print(result.stdout,flush=True);print(result.stderr,flush=True);result.check_returncode()
 return result.stdout.strip()
def sim(*args,**kw):return run('xcrun','simctl',*args,**kw)
sdk=run('xcrun','--sdk','iphonesimulator','--show-sdk-version')
sdk_version=tuple(map(int,sdk.split('.')))
runtimes=json.loads(sim('list','runtimes','-j'))['runtimes']
available=[r for r in runtimes if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS-')]
matching=[r for r in available if tuple(map(int,r['version'].split('.')))==sdk_version]
compatible=[r for r in available if int(r['version'].split('.')[0])==sdk_version[0]]
assert matching or compatible,'No installed Simulator runtime matches the selected Xcode SDK'
runtime=sorted(matching or compatible,key=lambda r:tuple(map(int,r['version'].split('.'))))[-1]
print('Native UI runtime: '+runtime['name']+'; SDK '+sdk+'; '+platform.machine(),flush=True)
types=json.loads(sim('list','devicetypes','-j'))['devicetypes'];iphones=[t for t in types if t.get('productFamily')=='iPhone' or t['name'].startswith('iPhone')]
existing=json.loads(sim('list','devices','available','-j'))['devices'].get(runtime['identifier'],[])
preferred=[]
for names in [('iPhone SE (3rd generation)','iPhone 16e','iPhone 17'),('iPhone 17 Pro','iPhone 16 Pro','iPhone 16 Pro Max')]:
 choice=next((t for name in names for t in iphones if t['name']==name),None)
 if choice:preferred.append(choice)
if a.store:
 preferred=[next((t for t in iphones if t['name']=='iPhone 16 Pro Max'),None)]
 assert preferred[0], 'Exact1320x2868 iPhone16ProMax Simulator type required; no fallback/upscaling'
assert a.store or len(preferred)==2,'Two phone device types are required'
if not a.store and a.device!='all':preferred=[preferred[0 if a.device=='compact' else 1]]
if a.store:
 expected=a.output/'expected-static'
 run('python3','app/asset_build.py','app/static',str(expected))
 for item in expected.rglob('*'):
  if item.is_file() and item.name!='sw.js':
   bundled=a.app/'public/static'/item.relative_to(expected)
   assert bundled.is_file() and hashlib.sha256(item.read_bytes()).digest()==hashlib.sha256(bundled.read_bytes()).digest(),'Supplied bundle differs from current app assets: '+str(item.relative_to(expected))
 import shutil
 shutil.rmtree(expected)
 # Read only the published map contract; no account, cookie or runtime setting access.
 with urllib.request.urlopen(urllib.request.Request('https://login.kinetta.app/api/map-config',headers={'User-Agent':'Kinetta fictional capture setup'}),timeout=20) as response:map_config=json.load(response)
 url=urlsplit(map_config['url'])
 assert map_config['kind']=='pmtiles' and url.scheme=='https' and url.hostname and not (url.username or url.password or url.query or url.fragment),'Public credential-free vector map required'
 assert not url.hostname.endswith('tile.openstreetmap.org'),'Never use public OSM tile servers'
 (a.output/'public-map.json').write_text(json.dumps(map_config,indent=2))
results=[];startup_rows=[]
for device in preferred:
 udid=None
 try:
  try:udid=sim('create','KinettaLayout-'+uuid.uuid4().hex[:8],device['identifier'],runtime['identifier'])
  except subprocess.CalledProcessError:
   if a.store:raise
   candidate=next((d for d in existing if d.get('deviceTypeIdentifier') and (('Pro' in d['name'])==('Pro' in device['name']))),None)
   if not candidate:raise
   device={'name':candidate['name'],'identifier':candidate['deviceTypeIdentifier']};udid=sim('create','KinettaLayout-'+uuid.uuid4().hex[:8],device['identifier'],runtime['identifier'])
  diagnostics={'fixture':True,'runtime':runtime['name'],'sdk':sdk,'architecture':platform.machine(),'device':device['name'],'phase':'booting'}
  (a.output/'startup.json').write_text(json.dumps(diagnostics,indent=2))
  print('Booting native UI device: '+device['name'],flush=True)
  # A fresh hosted runner must initialize the iOS runtime; this can exceed three minutes.
  sim('boot',udid);sim('bootstatus',udid,'-b',timeout=480);sim('status_bar',udid,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100')
  installed=None;recovered=False
  for theme in (('light',) if a.store else ('light','dark')):
   sim('ui',udid,'appearance',theme)
   if a.store:
    store_stages=list(dict.fromkeys([*STORE_STAGES,*(a.store_stage or [])]));stages=[(name,16) for name in store_stages]
   else: stages=[(name,16) for name in ['header-me','header-activity','header-track','header-progress','header-food']]+[('recipe',16),('review',16),('food',16),('recipe',24),('food',24),('track-live',16),('track-map',16),('track-review',16),('track-live',24),('track-review',24),('activity',16),('activity-sticky',16),('activity-empty',16),('activity-map',16),('activity',24),('friends-empty',16),('friends-typical',16),('friends-heavy',16),('friends-heavy',24),('groups-create',16)]
   for stage,root in stages:
    diagnostics['phase']=f'{theme} {stage} root={root}';(a.output/'startup.json').write_text(json.dumps(diagnostics,indent=2))
    measure_startup=a.startup_timing and theme=='light' and stage=='header-me'
    print(f'Native UI: {device["name"]} {theme} {stage} root={root}',flush=True)
    token=uuid.uuid4().hex;copy=a.output/'KinettaLayout.app'
    if installed:recovered=stop_for_fixture(sim,udid,theme,recovered)
    diagnostics['terminationRecovery']=recovered;(a.output/'startup.json').write_text(json.dumps(diagnostics,indent=2))
    destination=installed or copy
    run('python3',str(Path(__file__).with_name('prepare.py')),str(a.app),str(destination),'--stage',stage,'--root',str(root),'--run',token,*(['--update'] if installed else []),*(['--store','--map-config',str(a.output/'public-map.json')] if a.store else []),*(['--startup-timing'] if measure_startup else []))
    if not installed:
     sim('install',udid,str(copy));installed=Path(sim('get_app_container',udid,'com.kinetta.app','app'))
    container=Path(sim('get_app_container',udid,'com.kinetta.app','data'))
    process_launch_epoch_ms=time.time_ns()/1_000_000 if measure_startup else None
    sim('launch',udid,'com.kinetta.app')
    metrics=None
    for _ in range(250):
     try:
      candidate=json.loads((container/'tmp/kinetta-ui-metrics.json').read_text())
      if candidate.get('run')==token:metrics=candidate;break
     except (OSError,ValueError):pass
     time.sleep(.2)
    filename=device['name'].replace(' ','-').replace('(','').replace(')','')+'-'+theme+'-'+stage+'-'+str(root)
    if not metrics:
     sim('io',udid,'screenshot','--type=png',str(a.output/(filename+'-missing-metrics.png')),check=False,timeout=20)
     (a.output/(filename+'-missing-metrics.json')).write_text(json.dumps({**diagnostics,'error':'No metrics for current fixture run'},indent=2))
    assert metrics, f'No native metrics: {device["name"]} {theme} {stage}'
    if measure_startup:
     timing=metrics.get('startupTiming')
     assert timing,'Cold-start fixture did not return phase timestamps'
     timing['processLaunchEpochMs']=process_launch_epoch_ms
     timing['phasesMs']=phase_durations(timing,process_launch_epoch_ms)
     startup_rows.append({'device':device['name'],'phases':timing['phasesMs']})
     phases=timing['phasesMs']
     print('IOS_COLD_START '+device['name']+' '+ ' '.join(f'{key}={value:.1f}ms' for key,value in phases.items()),flush=True)
    capture=a.output/(filename+('.jpg' if a.store else '.png'))
    sim('io',udid,'screenshot','--type='+('jpeg' if a.store else 'png'),str(capture))
    metrics.update(device=device['name'],runtime=runtime['name'],terminationRecovery=recovered);(a.output/(filename+'.json')).write_text(json.dumps(metrics,indent=2))
    assert 'error' not in metrics,metrics
    assert metrics['native'] and metrics['theme']==theme and metrics['safeTop']>=20,metrics
    assert not metrics['errors'] and not metrics['overflow'] and not metrics['status'],metrics
    assert metrics['requests'].count('/api/me')==1,metrics
    assert metrics['mePreloadCount']==0,metrics
    nav=metrics['navigation']
    assert nav['ready'],'Actual UIKit display-preference bridge must respond: '+json.dumps(metrics.get('display',{}),sort_keys=True)
    assert nav['visible']==(stage in ('activity','activity-sticky','activity-empty','achievements') or stage.startswith(('friends-','groups-','header-'))),metrics
    if a.store:
     raw=capture.read_bytes();dimensions=run('sips','-g','pixelWidth','-g','pixelHeight',str(capture))
     assert raw[:3]==b'\xff\xd8\xff' and re.search(r'pixelWidth: 1320\b',dimensions) and re.search(r'pixelHeight: 2868\b',dimensions),'Store JPEG must be native1320x2868, no alpha or resizing'
     assert not metrics.get('blocked') and metrics.get('sceneReady'),metrics
     assert metrics.get('store') and metrics.get('bodyText') and not re.search(r'could not load|couldn.t load|Map unavailable|NaN|undefined',metrics['bodyText'],re.I),metrics
     if stage in ('activity','header-activity'):
      assert re.search(r'\d+(?:\.\d+)?\s*mi\b',metrics['bodyText']) and re.search(r'\d+:\d{2}\s*/mi\b',metrics['bodyText']), 'US App Store activity scenes must use miles and min/mi pace'
      assert not re.search(r'\bkm\b|/km\b',metrics['bodyText']), 'US App Store activity scenes must not show metric distance or pace'
     if stage.startswith('header-') or stage=='achievements':
      top=metrics.get('topBand',{});assert top.get('glyph',{}).get('y',-1)>=metrics['safeTop']-1, f'{stage} top heading is fully visible: {top}'
     if stage!='food' and metrics['navigation']['visible']:
      assert all(item['label']['height']>=10 for item in metrics['navigation']['items']), f'{stage} Store nav must remain expanded: {metrics["navigation"]}'
     if stage=='header-me':
      me_text=metrics['bodyText']
      assert re.search(r'\b5\.0\s+Distance\s+\(mi\)',me_text), 'Me screenshot must show the matching fictional 5.0 mi distance'
      assert not re.search(r'\bkm\b|/km\b',me_text), 'US App Store Me scene must not show metric distance or pace'
      assert re.search(r'\b2\s+Workouts\b',me_text) and re.search(r'\b48m\s+Time\b',me_text), 'Me screenshot must show its two fictional workouts and their 48 minutes'
      assert re.search(r'Featured achievements[\s\S]{0,220}\b134\s+(?:wkt|workouts)\b',me_text) and len(metrics.get('featuredAchievements',[]))==3, 'Me screenshot must show three earned featured achievements including lifetime workouts'
      assert all(item['box'] and item['box']['y']>=metrics['safeTop'] and item['box']['bottom']<=metrics['navigation']['box']['y'] for item in metrics['featuredAchievements']), 'All three featured medals must be visible above the tab bar'
      assert not re.search(r'\b0\s+Workouts\b|\b0m\s+Time\b',me_text), 'Me screenshot must not show empty weekly count/time beside a nonzero distance'
     assert metrics['viewport']=={'width':440,'height':956,'offset':0},metrics
     metrics['sha256']=hashlib.sha256(raw).hexdigest();metrics['captureToolRevision']=run('git','rev-parse','HEAD');metrics['bundleAssetsVerifiedAgainst']=metrics['captureToolRevision']
     (a.output/(filename+'.json')).write_text(json.dumps(metrics,indent=2))
     results.append(metrics);(a.output/'results.json').write_text(json.dumps(results,indent=2));continue
    if nav['visible']:
     box=nav['box'];assert box['x']>=8 and box['x']+box['width']<=metrics['viewport']['width']-8,metrics
     assert box['bottom']<metrics['viewport']['height'],metrics
     assert [item['text'] for item in nav['items']]==['Home','Progress','Track','Nutrition','Me'],metrics
     assert sum(item['selected'] for item in nav['items'])==1,metrics
     for item in nav['items']:
      target,label=item['box'],item['label']
      assert target['width']>=44 and target['height']>=44,metrics
      assert label['x']>=target['x']-1 and label['x']+label['width']<=target['x']+target['width']+1,metrics
      assert label['y']>=target['y'] and label['bottom']<=target['bottom'],metrics
    if not stage.startswith(('track-','activity','header-')):assert metrics['back'] and abs(metrics['back']['y']-metrics['safeTop'])<=4,metrics
    if stage.startswith('header-') or stage=='achievements':
     assert metrics['topBand']['page']==stage.removeprefix('header-') and metrics['topBand']['title']['height']>0,metrics
     if stage=='header-food':check_headers([*results,metrics][-5:])
    if stage=='header-activity' and metrics.get('activityMetadata'):
     cards=metrics['activityMetadata'];assert cards['own'] and cards['friend'],metrics
     assert cards['own']['name']=='You' and cards['friend']['name']=='River Friend 1 With a Long Fictional Name',metrics
     for label,card in cards.items():
      header,box=card['header'],card['card'];assert header['x']>=box['x'] and header['right']<=box['right']+.5 and header['y']>=box['y'] and header['bottom']<=box['bottom']+.5,metrics
      assert card['target']['width']>=44 and card['target']['height']>=44 and card['namePadding']=='0px' and card['nameMargin']=='0px',metrics
      assert not card['dateText'].startswith('·') and not card['kindText'].startswith('·'),metrics
      assert card['dateRects'] and card['kindRects'],metrics
      for part in card['nameText']+card['dateRects']+card['kindRects']:
       assert part['x']>=header['x']-.5 and part['right']<=header['right']+.5 and part['y']>=header['y']-.5 and part['bottom']<=header['bottom']+.5,metrics
      date=card['dateRects'][0];target=card['target'];assert target['right']<=date['x']+.5 or target['y']+target['height']<=date['y']+.5 or date['bottom']<=target['y']+.5,metrics
    if stage.startswith('friends-'):
     friends=metrics['friends'];assert friends['title']=='Friends' and friends['backLabel']=='Back to Me',metrics
     expected_friends=40 if stage=='friends-heavy' else 1 if stage=='friends-typical' else 0
     expected_requests=5 if stage=='friends-heavy' else 3 if stage=='friends-typical' else 0
     assert friends['counts']==[expected_friends,1 if expected_requests else 0,0],metrics
     expected_label=({'friends-typical':'Friend requests1 waiting · 2 sent3','friends-heavy':'Friend requests3 waiting · 2 sent5'}.get(stage,''))
     assert friends['requestLabel']==expected_label,metrics
     assert friends['findAction'] and friends['findAction']['width']>=44 and friends['findAction']['height']>=44 and not friends['fullChallenges'],metrics
     if friends['requestRow']:assert friends['requestRow']['height']>=44,metrics
     assert all(r['width']>=44 and r['height']>=44 for r in friends['controls']),metrics
     if stage=='friends-empty':assert friends['empty'] and friends['emptyAction'] and friends['emptyAction']['width']==0,metrics
     if stage=='friends-heavy' and root==16:assert friends['firstFriend']['bottom']<nav['box']['y'],metrics
    if stage.startswith('groups-'):
     groups=metrics['groups'];fields=groups['fields'];date=groups['date'];name=groups['name'];grid=groups['grid']
     assert fields and fields['scrollWidth']<=fields['clientWidth']+1,metrics
     assert date and name and abs(date['width']-name['width'])<=1,metrics
     assert date['x']>=fields['x']-.5 and date['right']<=fields['right']+.5,metrics
     assert grid and grid['x']>=fields['x']-.5 and grid['right']<=fields['right']+.5,metrics
     assert all(r and r['x']>=fields['x']-.5 and r['right']<=fields['right']+.5 for r in groups['labels']),metrics
    if stage.startswith('activity'):
     detail=metrics['activity'];assert detail['social']['hidden'],metrics
     if stage=='activity-map':
      assert detail['expanded'] and detail['close']['y']>=metrics['safeTop'],metrics
     else:
      assert not detail['expanded'],metrics
      assert detail['back']['y']>=metrics['safeTop'] and detail['back']['height']>=44,metrics
      assert all(r['width']>=44 and r['height']>=44 and r['y']>=metrics['safeTop'] for r in detail['actions']),metrics
      if stage=='activity-empty':assert detail['hero'] is None and detail['secondary']==0,metrics
      elif stage=='activity-sticky':assert detail['hero']['bottom']<=0 and detail['bar']['y']==0,metrics
      else:
       assert abs(detail['hero']['y'])<=1 and abs(detail['hero']['width']-metrics['viewport']['width'])<=1,metrics
       expected_hero=min(408,max(264,metrics['viewport']['height']*.46))
       assert abs(detail['hero']['height']-expected_hero)<=1,metrics
       if root==16:assert detail['tabs']['bottom']<nav['box']['y'],metrics
    if stage.startswith('track-'):
     track=metrics['tracking']
     if stage=='track-review':
      assert track['save'] and track['save']['bottom']<=metrics['viewport']['height']-metrics['safeBottom']+1,metrics
      assert metrics['header']['y']>=metrics['safeTop'] and metrics['header']['y']<=metrics['safeTop']+14,metrics
      assert track['photos'] and track['title'] and track['chart'],metrics
     else:
      limit=metrics['viewport']['height']-metrics['safeBottom']
      assert track['controls'] and track['controls']['bottom']<=limit,metrics
      assert all(bottom<=limit for bottom in track['captions']),metrics
      assert track['expanded']==(stage=='track-map'),metrics
      if stage=='track-live':assert track['average'] and track['lap'] and track['lap']!='—',metrics
    if stage=='recipe':
     assert metrics['name'] and metrics['content']['y']>=metrics['header']['bottom']-1,metrics
     assert metrics['name']['y']<=metrics['header']['bottom']+30,metrics
     assert metrics['composer']['bottom']<=metrics['viewport']['height']-metrics['safeBottom']+1,metrics
    if stage=='review':assert metrics['review'],metrics
    if stage=='food':
     assert metrics['field'] and metrics['field']['scrollHeight']<=metrics['field']['clientHeight']+1,metrics
     assert metrics['composer']['bottom']<=metrics['viewport']['height']-metrics['safeBottom']+1,metrics
    results.append(metrics);(a.output/'results.json').write_text(json.dumps(results,indent=2))
 finally:
  if udid:sim('shutdown',udid,check=False,timeout=20);sim('delete',udid,check=False,timeout=20)
import shutil
shutil.rmtree(a.output/'KinettaLayout.app',ignore_errors=True)
expected_count=len(dict.fromkeys([*STORE_STAGES,*(a.store_stage or [])])) if a.store else 50*len(preferred)
assert len(results)==expected_count,'Every selected phone needs all selected layout cases'
if a.startup_timing:
 assert len(startup_rows)==len(preferred),'Each selected phone needs one cold-start sample'
 summary=summary_markdown(startup_rows)
 (a.output/'startup-summary.md').write_text(summary)
 summary_path=os.environ.get('GITHUB_STEP_SUMMARY')
 if summary_path:
  with open(summary_path,'a',encoding='utf-8') as output:output.write(summary+'\n')
print(f'PASS {len(results)} actual native WebView layout captures with fictional API stand-ins; physical device checks remain separate')
