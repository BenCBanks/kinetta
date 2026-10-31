"""Instrument a disposable unsigned Simulator bundle; never modify source or the original build."""
import argparse,json,shutil,subprocess,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('destination',type=Path);p.add_argument('--stage',choices=['recipe','review','food','track-live','track-review','track-map','activity','activity-sticky','activity-empty','activity-map','friends-empty','friends-typical','friends-heavy'],required=True);p.add_argument('--root',type=int,default=16);p.add_argument('--run',required=True);p.add_argument('--update',action='store_true');a=p.parse_args()
assert a.source.suffix=='.app' and a.source.is_dir()
assert a.destination.suffix=='.app' and a.destination.resolve()!=a.source.resolve()
if a.update:
 assert (a.destination/'public/static/native-ui-early.js').is_file(), 'Only an existing fixture copy may be updated'
else:
 if a.destination.exists():shutil.rmtree(a.destination)
 shutil.copytree(a.source,a.destination,symlinks=True)
public=a.destination/'public';index=public/'index.html';assert index.is_file()
fixture=Path(__file__).parent
config={'stage':a.stage,'root':a.root,'run':a.run}
if a.stage.startswith('friends-'):
 config['friends']=json.loads(subprocess.check_output(['node','-e','process.stdout.write(JSON.stringify(require(process.argv[1])(process.argv[2])))',str(fixture.parents[1]/'demo/friends.cjs'),a.stage.removeprefix('friends-')],text=True))
if a.stage.startswith('activity'):
 config['activity']=json.loads(subprocess.check_output(['node','-e',"process.stdout.write(JSON.stringify(require(process.argv[1])(process.argv[2]==='true')))",str(fixture.parents[1]/'demo/activity_detail.cjs'),str(a.stage=='activity-empty').lower()],text=True))
if a.stage.startswith('track-'):
 config['recording']=json.loads(subprocess.check_output(['node','-e','process.stdout.write(JSON.stringify(require(process.argv[1])()))',str(fixture.parents[1]/'demo/track_session.cjs')],text=True))
 config['recording']['id']=str(uuid.UUID(a.run))
 config['recording']['state']='review' if a.stage=='track-review' else 'recording'
(public/'static/native-ui-early.js').write_text('globalThis.KinettaUIFixture='+json.dumps(config)+';\n'+(fixture/'display-diagnostics.js').read_text()+'\n'+(fixture/'early.js').read_text())
(public/'static/native-ui-late.js').write_text((fixture/'late.js').read_text())
if not a.update:
 s=index.read_text().replace('<script src="/static/keyboard.js','<script src="/static/native-ui-early.js"></script>\n<script src="/static/keyboard.js',1).replace('</body>','<script src="/static/native-ui-late.js"></script>\n</body>')
 assert s!=index.read_text();index.write_text(s)
 p=public/'static/native.js';s=p.read_text();needle='const get = async (key) => (await prefs.get({key})).value;';assert s.count(needle)==1
 p.write_text(s.replace(needle,"const get = async (key) => key==='server'?'https://example.test':key==='token'?'fictional-native-ui-only':(await prefs.get({key})).value;",1))
import re
index.write_text(re.sub(r'(/static/native-ui-early.js)(?:\?run=[a-f0-9-]+)?',lambda m:m[1]+'?run='+a.run,index.read_text()))
