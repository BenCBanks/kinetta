"""A fictional Me account whose planned workout is always scheduled for today."""
import datetime as dt
import json
import os
import subprocess
from urllib.parse import urlparse

from kc import person, PW

base = urlparse(os.environ.get('KINETTA_URL', 'http://localhost:8798'))
project = os.environ.get('KINETTA_PROJECT', 'kinettatest')
assert base.hostname in ('localhost', '127.0.0.1') and (project.startswith('kt-') or project == 'kinettatest')
port = subprocess.check_output(
    ['docker', 'inspect', '--format', '{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}', project + '-app-1'],
    text=True,
).strip()
assert base.port == int(port), 'URL must reach this isolated project'

now = dt.datetime.now(dt.timezone.utc)
today = now.date()
long_day = 6 if today.weekday() == 4 else 5
monday = today - dt.timedelta(days=today.weekday())
race_day = monday + dt.timedelta(weeks=5, days=long_day)

login = 'zz_test_me_today'
c = person(login)
assert c.post('/api/account/delete', {'password': PW})[0] == 200
c = person(login, 'River Today')
assert c.put('/api/profile', {'tz': 'UTC', 'ai_ok': False})[0] == 200
result = c.post('/api/plans', {
    'race': '5k', 'level': 'advanced', 'weeks': 6, 'runs': 6,
    'long_day': long_day, 'race_day': race_day.isoformat(),
})
assert result[0] == 200, result
plan = c.get('/api/plans/current')
assert plan[0] == 200, plan
assert plan[1]['today'] == today.isoformat(), plan[1]
assert plan[1]['today_workout'] and plan[1]['today_workout']['status'] == 'today', plan[1]
print('Me Today fixture ready:', today.isoformat(), plan[1]['today_workout']['title'])
print(json.dumps({'now': now.isoformat(), 'today': today.isoformat()}))
