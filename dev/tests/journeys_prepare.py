"""Reuse the shared screen fixtures, then add original fictional journey records."""
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
from journeys_guard import target

base, project = os.environ['KINETTA_URL'], os.environ['KINETTA_PROJECT']
root = target(base, project)  # No fixture writes before the independent deployment check.
subprocess.run([sys.executable, str(root/'dev/tests/spacing_prepare.py')], check=True)
fixtures = json.loads(Path(os.environ.get('KINETTA_SPACING_FIXTURES', '/tmp/'+project+'-spacing-fixtures.json')).read_text())
from kc import person, PW


def ok(response):
    status, value = response
    assert status == 200, (status, str(value)[:300])
    return value


login = 'zz_test_journeys'
client = person(login)
ok(client.post('/api/account/delete', {'password': PW}))
client = person(login, 'Fictional Journey')
ok(client.put('/api/profile', {'tz': 'UTC', 'ai_ok': False, 'units': 'metric'}))
ok(client.put('/api/food/targets', {'kcal_target': 2100, 'protein_target': 110}))
now = dt.datetime.now(dt.timezone.utc)
activities = []
for index in range(12):
    activities.append(ok(client.post('/api/activities/manual', {
        'sport': 'run', 'name': 'Fictional journey run '+str(index+1), 'duration_s': 1800,
        'distance_m': 5000, 'start': (now-dt.timedelta(hours=3, days=index)).isoformat()}))['id'])
food = ok(client.post('/api/food/foods', {'name': 'Fictional journey rice', 'serving_label': '1 serving',
              'serving_g': 100, 'kcal': 130, 'protein_g': 3, 'carbs_g': 28, 'fat_g': .3}))['id']
dish = ok(client.post('/api/dishes', {'name': 'Fictional journey soup'}))['id']
ok(client.post(f'/api/dishes/{dish}/items', {'name': 'Fictional lentils', 'grams': 100, 'source': 'quick',
              'per100': {'kcal': 100, 'protein_g': 8, 'carbs_g': 16, 'fat_g': 1}}))
challenge = ok(client.post('/api/challenges', {'kind': 'activities', 'target': 3, 'period': 'custom',
                   'start': str(now.date()), 'end': str(now.date()+dt.timedelta(days=6)), 'request_id': uuid.uuid4().hex}))['code']
me = ok(client.get('/api/me'))
journey = {'login': login, 'uid': me['id'], 'activity': activities[0], 'dish': dish, 'challenge': challenge, 'food': food}
# Exercise the backend's actual kind-to-link generation; delivery/visibility is tested separately.
script = '''import datetime as dt,json,sys
from app import notify
f=json.load(sys.stdin);row={'name':'Fictional Journey','login':f['login'],'photo':None,'activity':'Fictional journey run 1',
'activity_id':f['activity'],'sport':'run','distance_m':5000,'elapsed_s':1800,'dish':'Fictional journey soup','dish_id':f['dish'],
'challenge_code':f['challenge'],'comment':'Fictional encouragement','created':dt.datetime.now(dt.timezone.utc).isoformat(),'read':True}
print(json.dumps([notify._item({**row,'id':index+1,'kind':kind}) for index,kind in enumerate(notify.KINDS)]))
'''
# The script and fixture JSON travel on stdin, without credentials or shell interpolation.
result = subprocess.run(['docker', 'exec', '-i', project+'-app-1', 'python', '-c', script],
                        input=json.dumps(journey), text=True, capture_output=True, check=True)
journey['notifications'] = json.loads(result.stdout)
fixtures['journey'] = journey
destination = Path(os.environ.get('KINETTA_JOURNEY_FIXTURES', '/tmp/'+project+'-journeys.json'))
destination.write_text(json.dumps(fixtures))
print('Journey fixtures ready: twelve original runs, saved food, recipe, challenge and all notification links.')
