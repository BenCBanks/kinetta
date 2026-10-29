"""The screenshot workflow runs its converter outside the git checkout."""
import datetime
from html.parser import HTMLParser
from urllib.parse import urlsplit
import json
from pathlib import Path
import subprocess
import sys
import tempfile
root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory() as scratch:
    output = Path(scratch) / 'images'
    subprocess.run([sys.executable, str(root / 'dev/screenshots/manifest.py'), str(output)], cwd=scratch, check=True)
    manifest = json.loads((output / 'manifest.json').read_text())
    expected = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    assert manifest['revision'] == expected
    assert datetime.datetime.fromisoformat(manifest['generated_at']).utcoffset() == datetime.timedelta(0)
print('Capture manifest: revision and UTC timestamp work outside the repository')

# Loading a classic script twice can fail at runtime even though each individual file passes node --check.
class Scripts(HTMLParser):
    def __init__(self):
        super().__init__(); self.paths=[]
    def handle_starttag(self,tag,attrs):
        if tag=='script' and (src:=dict(attrs).get('src')):self.paths.append(urlsplit(src).path)
for entry in ('index.html','admin.html'):
    parser=Scripts();parser.feed((root/'app/static'/entry).read_text())
    assert len(parser.paths)==len(set(parser.paths)),f'{entry} loads a script more than once: {parser.paths}'
    for asset in parser.paths:
        assert asset.startswith('/static/') and (root/'app'/asset.lstrip('/')).is_file(),f'Missing local script: {asset}'
print('App entry assets: scripts exist and load once, independent of cache version')
