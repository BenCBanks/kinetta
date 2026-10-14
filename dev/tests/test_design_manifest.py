"""The screenshot workflow runs its converter outside the git checkout."""
import datetime
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
