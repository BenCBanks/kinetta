"""Native CI path policy without API pagination or shell-expanded filenames."""
import json
import os
from pathlib import Path
import subprocess


def native_path(path):
    return path.startswith(('mobile/','app/static/','dev/tests/native-ui/')) or path in ('app/asset_build.py','.github/workflows/ios.yml','dev/ci/policy.py','dev/demo/friends.cjs','dev/demo/activity_detail.cjs','dev/demo/track_session.cjs','dev/tests/fixtures/interval_presets.json')


def native_needed(event_name,event,paths):
    if event_name=='pull_request':
        return not event['pull_request']['draft'] and any(native_path(p) for p in paths)
    return True


def changed_paths(event):
    pr=event['pull_request'];base=pr['base']['sha'];head=pr['head']['sha']
    # Both revisions are trusted git object IDs from the event, never branch names
    # or interpolated shell text. Three dots use the PR's merge base.
    if any(len(value)!=40 or any(ch not in '0123456789abcdef' for ch in value) for value in (base,head)):
        raise ValueError('Invalid event commit ID')
    result=subprocess.run(['git','diff','--name-only','--no-renames','-z',base+'...'+head],check=True,capture_output=True)
    return result.stdout.decode('utf-8',errors='surrogateescape').rstrip('\0').split('\0')


if __name__=='__main__':
    name=os.environ['GITHUB_EVENT_NAME'];event=json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    paths=changed_paths(event) if name=='pull_request' else []
    print('native='+str(native_needed(name,event,paths)).lower())
