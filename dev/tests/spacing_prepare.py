"""Prepare existing fictional fixtures on one matching disposable server, before opening a browser."""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlparse

base = urlparse(os.environ['KINETTA_URL'])
project = os.environ['KINETTA_PROJECT']
assert base.hostname in ('localhost', '127.0.0.1') and (project.startswith('kt-') or project == 'kinettatest')
port = subprocess.check_output(['docker', 'inspect', '--format', '{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}', project+'-app-1'], text=True).strip()
assert base.port == int(port), 'Fixture project and URL must refer to the same disposable copy'
fixtures = {'base': base.geturl().rstrip('/'), 'project': project}
for filename in ['activity_fixture.py', 'activity_detail_fixture.py', 'track_fixture.py', 'lift_compact_fixture.py',
                 'test_progress_overview.py', 'subpages_fixture.py', 'nutrition_fixture.py', 'food_entry_fixture.py',
                 'recipes_compact_fixture.py', 'friends_compact_fixture.py', 'recaps_ui_fixture.py', 'insights_fixture.py']:
    env = dict(os.environ, KINETTA_KEEP_PROGRESS='1')
    result = subprocess.run([sys.executable, str(Path(__file__).parent/filename)], env=env, capture_output=True, text=True)
    print(result.stdout, end='', flush=True)
    if result.returncode:
        print(result.stderr, file=sys.stderr)
        raise SystemExit(result.returncode)
    if filename in ('activity_detail_fixture.py', 'lift_compact_fixture.py'):
        fixtures['detail' if filename.startswith('activity') else 'lift'] = json.loads(result.stdout.strip().splitlines()[-1])
recap_path = Path(os.environ.get('KINETTA_RECAP_FIXTURE', '/tmp/'+project+'-recaps-ui.json'))
fixtures['recaps'] = json.loads(recap_path.read_text())
destination = Path(os.environ.get('KINETTA_SPACING_FIXTURES', '/tmp/'+project+'-spacing-fixtures.json'))
destination.write_text(json.dumps(fixtures))
print('Spacing fixtures prepared:', destination)
