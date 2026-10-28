"""Run native layout evidence on isolated Simulator devices. Fixtures and artifacts contain no real data."""
import argparse,json,os,subprocess,time,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--app',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
def run(*args,check=True,timeout=180):
 try:result=subprocess.run(args,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 except subprocess.TimeoutExpired:
  print('Command timed out: '+' '.join(args),flush=True)
  if check:raise
  return ''
 if check and result.returncode:
  print(result.stdout,flush=True);print(result.stderr,flush=True);result.check_returncode()
 return result.stdout.strip()
def sim(*args,**kw):return run('xcrun','simctl',*args,**kw)
runtimes=json.loads(sim('list','runtimes','-j'))['runtimes'];runtime=sorted([r for r in runtimes if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS-')],key=lambda r:tuple(map(int,r['version'].split('.'))))[-1]
types=json.loads(sim('list','devicetypes','-j'))['devicetypes'];iphones=[t for t in types if t.get('productFamily')=='iPhone' or t['name'].startswith('iPhone')]
existing=json.loads(sim('list','devices','available','-j'))['devices'].get(runtime['identifier'],[])
preferred=[]
for names in [('iPhone SE (3rd generation)','iPhone 16e','iPhone 17'),('iPhone 17 Pro','iPhone 16 Pro','iPhone 16 Pro Max')]:
 choice=next((t for name in names for t in iphones if t['name']==name),None)
 if choice:preferred.append(choice)
assert len(preferred)==2,'Two phone device types are required'
results=[]
for device in preferred:
 udid=None
 try:
  try:udid=sim('create','KinettaLayout-'+uuid.uuid4().hex[:8],device['identifier'],runtime['identifier'])
  except subprocess.CalledProcessError:
   candidate=next((d for d in existing if d.get('deviceTypeIdentifier') and (('Pro' in d['name'])==('Pro' in device['name']))),None)
   if not candidate:raise
   device={'name':candidate['name'],'identifier':candidate['deviceTypeIdentifier']};udid=sim('create','KinettaLayout-'+uuid.uuid4().hex[:8],device['identifier'],runtime['identifier'])
  print('Booting native UI device: '+device['name'],flush=True)
  sim('boot',udid);sim('bootstatus',udid,'-b');sim('status_bar',udid,'override','--time','9:41','--dataNetwork','wifi','--wifiMode','active','--wifiBars','3','--batteryState','charged','--batteryLevel','100')
  installed=None
  for theme in ('light','dark'):
   sim('ui',udid,'appearance',theme)
   for stage,root in [('recipe',16),('review',16),('food',16),('recipe',24)]:
    print(f'Native UI: {device["name"]} {theme} {stage} root={root}',flush=True)
    token=uuid.uuid4().hex;copy=a.output/'KinettaLayout.app'
    sim('terminate',udid,'com.kinetta.app',check=False,timeout=20)
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
    assert metrics, f'No native metrics: {device["name"]} {theme} {stage}'
    filename=device['name'].replace(' ','-').replace('(','').replace(')','')+'-'+theme+'-'+stage+'-'+str(root)
    sim('io',udid,'screenshot','--type=png',str(a.output/(filename+'.png')))
    metrics.update(device=device['name'],runtime=runtime['name']);(a.output/(filename+'.json')).write_text(json.dumps(metrics,indent=2))
    assert 'error' not in metrics,metrics
    assert metrics['native'] and metrics['theme']==theme,metrics
    assert not metrics['errors'] and not metrics['overflow'] and not metrics['status'],metrics
    assert metrics['back'] and abs(metrics['back']['y']-metrics['safeTop']-10)<=4,metrics
    if stage=='recipe':
     assert metrics['name'] and metrics['content']['y']>=metrics['header']['bottom']-1,metrics
     assert metrics['name']['y']<=metrics['header']['bottom']+30,metrics
     assert metrics['composer']['bottom']<=metrics['viewport']['height']-metrics['safeBottom']+1,metrics
    if stage=='review':assert metrics['review'],metrics
    results.append(metrics);(a.output/'results.json').write_text(json.dumps(results,indent=2))
 finally:
  if udid:sim('shutdown',udid,check=False,timeout=20);sim('delete',udid,check=False,timeout=20)
import shutil
shutil.rmtree(a.output/'KinettaLayout.app',ignore_errors=True)
print(f'PASS {len(results)} actual native WebView layout captures with fictional API stand-ins; physical device checks remain separate')
