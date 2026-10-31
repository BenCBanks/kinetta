"""Run native layout evidence on isolated Simulator devices. Fixtures and artifacts contain no real data."""
import argparse,json,os,platform,re,subprocess,time,uuid
from pathlib import Path
from lifecycle import stop_for_fixture
p=argparse.ArgumentParser();p.add_argument('--app',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--device',choices=['compact','pro','all'],default='all');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
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
assert len(preferred)==2,'Two phone device types are required'
if a.device!='all':preferred=[preferred[0 if a.device=='compact' else 1]]
results=[]
for device in preferred:
 udid=None
 try:
  try:udid=sim('create','KinettaLayout-'+uuid.uuid4().hex[:8],device['identifier'],runtime['identifier'])
  except subprocess.CalledProcessError:
   candidate=next((d for d in existing if d.get('deviceTypeIdentifier') and (('Pro' in d['name'])==('Pro' in device['name']))),None)
   if not candidate:raise
   device={'name':candidate['name'],'identifier':candidate['deviceTypeIdentifier']};udid=sim('create','KinettaLayout-'+uuid.uuid4().hex[:8],device['identifier'],runtime['identifier'])
  diagnostics={'fixture':True,'runtime':runtime['name'],'sdk':sdk,'architecture':platform.machine(),'device':device['name'],'phase':'booting'}
  (a.output/'startup.json').write_text(json.dumps(diagnostics,indent=2))
  print('Booting native UI device: '+device['name'],flush=True)
  # A fresh hosted runner must initialize the iOS runtime; this can exceed three minutes.
  sim('boot',udid);sim('bootstatus',udid,'-b',timeout=480);sim('status_bar',udid,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100')
  installed=None;recovered=False
  for theme in ('light','dark'):
   sim('ui',udid,'appearance',theme)
   for stage,root in [('recipe',16),('review',16),('food',16),('recipe',24),('food',24),('track-live',16),('track-map',16),('track-review',16),('track-live',24),('track-review',24),('activity',16),('activity-sticky',16),('activity-empty',16),('activity-map',16),('activity',24)]:
    diagnostics['phase']=f'{theme} {stage} root={root}';(a.output/'startup.json').write_text(json.dumps(diagnostics,indent=2))
    print(f'Native UI: {device["name"]} {theme} {stage} root={root}',flush=True)
    token=uuid.uuid4().hex;copy=a.output/'KinettaLayout.app'
    if installed:recovered=stop_for_fixture(sim,udid,theme,recovered)
    diagnostics['terminationRecovery']=recovered;(a.output/'startup.json').write_text(json.dumps(diagnostics,indent=2))
    destination=installed or copy
    run('python3',str(Path(__file__).with_name('prepare.py')),str(a.app),str(destination),'--stage',stage,'--root',str(root),'--run',token,*(['--update'] if installed else []))
    if not installed:
     sim('install',udid,str(copy));installed=Path(sim('get_app_container',udid,'com.kinetta.app','app'))
    container=Path(sim('get_app_container',udid,'com.kinetta.app','data'));sim('launch',udid,'com.kinetta.app')
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
    sim('io',udid,'screenshot','--type=png',str(a.output/(filename+'.png')))
    metrics.update(device=device['name'],runtime=runtime['name'],terminationRecovery=recovered);(a.output/(filename+'.json')).write_text(json.dumps(metrics,indent=2))
    assert 'error' not in metrics,metrics
    assert metrics['native'] and metrics['theme']==theme and metrics['safeTop']>=20,metrics
    assert not metrics['errors'] and not metrics['overflow'] and not metrics['status'],metrics
    nav=metrics['navigation']
    assert nav['ready'],'Actual UIKit display-preference bridge must respond'
    assert nav['visible']==(stage in ('track-live','track-review','activity','activity-sticky','activity-empty')),metrics
    if nav['visible']:
     box=nav['box'];assert box['x']>=8 and box['x']+box['width']<=metrics['viewport']['width']-8,metrics
     assert box['bottom']<metrics['viewport']['height'],metrics
     assert [item['text'] for item in nav['items']]==['Me','Activity','Track','Progress','Nutrition'],metrics
     assert sum(item['selected'] for item in nav['items'])==1,metrics
     for item in nav['items']:
      target,label=item['box'],item['label']
      assert target['width']>=44 and target['height']>=44,metrics
      assert label['x']>=target['x']-1 and label['x']+label['width']<=target['x']+target['width']+1,metrics
      assert label['y']>=target['y'] and label['bottom']<=target['bottom'],metrics
    if not stage.startswith(('track-','activity')):assert metrics['back'] and abs(metrics['back']['y']-metrics['safeTop']-10)<=4,metrics
    if stage.startswith('activity'):
     detail=metrics['activity'];assert detail['socialHidden'],metrics
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
       assert detail['hero']['height']<=metrics['viewport']['height']*.41,metrics
       if root==16:assert detail['tabs']['bottom']<nav['box']['y'],metrics
    if stage.startswith('track-'):
     track=metrics['tracking']
     if stage=='track-review':
      assert track['save'] and track['save']['bottom']<=track['tabs']['y']+1,metrics
      assert metrics['header']['y']>=metrics['safeTop'] and metrics['header']['y']<=metrics['safeTop']+14,metrics
      assert track['photos'] and track['title'] and track['chart'],metrics
     else:
      limit=metrics['viewport']['height']-metrics['safeBottom'] if stage=='track-map' else nav['box']['y']
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
assert len(results)==30*len(preferred),'Every selected phone needs all thirty layout cases'
print(f'PASS {len(results)} actual native WebView layout captures with fictional API stand-ins; physical device checks remain separate')
