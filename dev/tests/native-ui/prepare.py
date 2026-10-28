"""Instrument a disposable unsigned Simulator bundle; never modify source or the original build."""
import argparse,json,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('source',type=Path);p.add_argument('destination',type=Path);p.add_argument('--stage',choices=['recipe','review','food'],required=True);p.add_argument('--root',type=int,default=16);p.add_argument('--run',required=True);a=p.parse_args()
assert a.source.suffix=='.app' and a.source.is_dir()
assert a.destination.suffix=='.app' and a.destination.resolve()!=a.source.resolve()
if a.destination.exists():shutil.rmtree(a.destination)
shutil.copytree(a.source,a.destination,symlinks=True)
public=a.destination/'public';index=public/'index.html';assert index.is_file()
fixture=Path(__file__).parent
config={'stage':a.stage,'root':a.root,'run':a.run}
(public/'static/native-ui-early.js').write_text('globalThis.KinettaUIFixture='+json.dumps(config)+';\n'+(fixture/'early.js').read_text())
(public/'static/native-ui-late.js').write_text((fixture/'late.js').read_text())
s=index.read_text().replace('<script src="/static/keyboard.js','<script src="/static/native-ui-early.js"></script>\n<script src="/static/keyboard.js',1).replace('</body>','<script src="/static/native-ui-late.js"></script>\n</body>')
assert s!=index.read_text();index.write_text(s)
p=public/'static/native.js';s=p.read_text();needle='const get = async (key) => (await prefs.get({key})).value;';assert s.count(needle)==1
p.write_text(s.replace(needle,"const get = async (key) => key==='server'?'https://example.test':key==='token'?'fictional-native-ui-only':(await prefs.get({key})).value;",1))
