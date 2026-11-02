"""Refuse browser writes outside this checkout's marked disposable deployment."""
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


def inspect(kind, name):
    command = ['docker', *(['volume'] if kind == 'volume' else []), 'inspect', name]
    return json.loads(subprocess.check_output(command))[0]


def target(base, project, read=inspect):
    url = urlsplit(base)
    if (url.scheme != 'http' or url.hostname not in ('localhost', '127.0.0.1') or not url.port
            or url.username is not None or url.password is not None or url.path not in ('', '/') or url.query or url.fragment
            or not re.fullmatch(r'(?:kinettatest|kt-[a-z0-9][a-z0-9-]{0,60})', project)):
        raise ValueError('Use a marked loopback-only disposable journey project')
    app, database = (read('container', project+'-'+name+'-1') for name in ('app', 'db'))
    for container, service in ((app, 'app'), (database, 'db')):
        labels = container['Config']['Labels']
        if (labels.get('com.docker.compose.project') != project
                or labels.get('com.docker.compose.service') != service
                or Path(labels.get('com.docker.compose.project.working_dir', '/')).resolve() != ROOT):
            raise ValueError('Project, service and checkout must match')
        mounts = {mount['Destination']: mount for mount in container['Mounts']}
        required = ('/data', '/run/kinetta') if service == 'app' else ('/var/lib/postgresql/data', '/run/kinetta')
        if any(mounts.get(name, {}).get('Type') != 'volume' for name in required):
            raise ValueError('Data and secrets must use disposable named volumes')
        for mount in container['Mounts']:
            if mount['Type'] == 'volume':
                labels = read('volume', mount['Name']).get('Labels') or {}
                if labels.get('com.docker.compose.project') != project:
                    raise ValueError('All volumes must belong to this project')
    environment = app['Config']['Env']
    ports = app['NetworkSettings']['Ports'].get('8000/tcp') or []
    if ('KINETTA_JOURNEY_FIXTURE=1' not in environment or 'FIT_DB_HOST=db' not in environment
            or not ports or any(p['HostIp'] != '127.0.0.1' or int(p['HostPort']) != url.port for p in ports)):
        raise ValueError('Journey marker, own database and loopback published port must match')
    return ROOT


if __name__ == '__main__':
    import os
    target(os.environ['KINETTA_URL'], os.environ['KINETTA_PROJECT'])
    print('Journey boundary: matching marked checkout, loopback port and project-owned volumes PASS')
