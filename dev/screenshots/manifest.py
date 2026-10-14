"""Screenshot capture metadata; works from any caller's working directory."""
import datetime
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]

def write_manifest(output):
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    target = Path(output)
    target.mkdir(parents=True, exist_ok=True)
    (target / 'manifest.json').write_text(json.dumps({
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'revision': revision,
    }))

if __name__ == '__main__':
    write_manifest(sys.argv[1])
