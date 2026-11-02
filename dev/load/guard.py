"""Only this checkout's explicitly marked, loopback-published disposable deployment."""
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen


def target(base, project):
    u = urlsplit(base)
    if (u.scheme != 'http' or u.hostname not in ('localhost', '127.0.0.1') or not u.port
            or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment
            or not re.fullmatch(r'kt-launch-load-[a-z0-9-]+', project)):
        raise ValueError('Use this checkout’s marked, loopback-only launch-load project')
    app = json.loads(subprocess.check_output(['docker', 'inspect', project+'-app-1']))[0]
    labels = app['Config']['Labels']
    root = Path(__file__).resolve().parents[2]
    ports = app['NetworkSettings']['Ports'].get('8000/tcp') or []
    if (labels.get('com.docker.compose.project') != project
            or Path(labels.get('com.docker.compose.project.working_dir', '/')).resolve() != root
            or 'KINETTA_LOAD_FIXTURE=1' not in app['Config']['Env']
            or not ports or any(p['HostIp'] != '127.0.0.1' or int(p['HostPort']) != u.port for p in ports)):
        raise ValueError('Project, checkout, marker and loopback published port must all match')
    if 'FIT_DB_HOST=db' not in app['Config']['Env']:
        raise ValueError('The fixture must use its own Compose database')
    database = json.loads(subprocess.check_output(['docker', 'inspect', project+'-db-1']))[0]
    db_labels = database['Config']['Labels']
    if (db_labels.get('com.docker.compose.project') != project
            or db_labels.get('com.docker.compose.service') != 'db'
            or Path(db_labels.get('com.docker.compose.project.working_dir', '/')).resolve() != root):
        raise ValueError('Database project/service/checkout must match')
    for container, required in ((app, ('/data', '/run/kinetta')), (database, ('/var/lib/postgresql/data', '/run/kinetta'))):
        mounts = {m['Destination']: m for m in container['Mounts']}
        if any(mounts.get(name, {}).get('Type') != 'volume' for name in required):
            raise ValueError('Data and secrets must use disposable named volumes, never host bind mounts')
        for mount in container['Mounts']:
            if mount['Type'] != 'volume': continue
            volume = json.loads(subprocess.check_output(['docker', 'volume', 'inspect', mount['Name']]))[0]
            if (volume.get('Labels') or {}).get('com.docker.compose.project') != project:
                raise ValueError('All data/secret volumes must belong to this disposable project')
    with urlopen(base.rstrip('/')+'/__load_fixture', timeout=5) as response:
        if json.load(response) != {'fictional_load_fixture': 1}:
            raise ValueError('Missing stand-in server marker')
    return root


def sql(project, query):
    return subprocess.check_output(['docker', 'exec', project+'-db-1', 'psql', '-X', '-qAt',
                                    '-U', 'postgres', '-d', 'fit', '-c', query], text=True).strip()
