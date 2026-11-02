"""Bounded closed-loop workload; report endpoint latency separately from complete workflows."""
import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
from pathlib import Path
import random
import re
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from guard import target, sql

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', required=True)
parser.add_argument('--project', required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--users', type=int, default=100)
parser.add_argument('--seconds', type=int, default=600)
parser.add_argument('--think', type=float, default=1)
args = parser.parse_args()
assert 2 <= args.users <= 100 and 10 <= args.seconds <= 900 and .1 <= args.think <= 10
root = target(args.url, args.project)
args.url = args.url.rstrip('/')
args.output.mkdir(parents=True, exist_ok=True)
os.chmod(args.output, 0o700)
fixture = args.output/'sessions.json'
if not fixture.exists():
    seeded = subprocess.check_output(['docker', 'exec', '-e', f'LOAD_USERS={args.users}', args.project+'-app-1',
                                      'python', '/load/seed.py'])
    fd = os.open(fixture, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as f: f.write(seeded)
people = json.loads(fixture.read_text())
assert len(people) == args.users
sequence_file = args.output/'import-sequences.json'
sequences = json.loads(sequence_file.read_text()) if sequence_file.exists() else {}
sql(args.project, 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements; SELECT pg_stat_statements_reset();')
records, resources, failures, routes = [], [], [], {}
lock = threading.Lock()
stop = threading.Event()
deadline = time.monotonic()+args.seconds
day = str(dt.datetime.now(dt.timezone.utc).date())


def request(person, label, method, path, body=None, content_type='application/json'):
    data = body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None
    headers = {'Authorization': 'Bearer '+person['token'], 'Origin': args.url, 'Content-Type': content_type}
    started = time.monotonic()
    try:
        with urllib.request.urlopen(urllib.request.Request(args.url+path, data, headers, method=method), timeout=20) as r:
            status, raw = r.status, r.read()
        value = json.loads(raw or b'null')
    except urllib.error.HTTPError as e:
        status, value = e.code, None
    except (OSError, ValueError):
        status, value = 0, None
    with lock:
        routes[label] = method+' '+re.sub(r'/\d+(?=/|$)', '/{id}', path.split('?')[0])
        records.append((label, status, (time.monotonic()-started)*1000))
    return status, value


def worker(i):
    person, rng = people[i], random.Random(i)
    reads = [('me', [('me', '/api/me'), ('stats', '/api/stats'), ('activity_food', '/api/activity-food'),
                     ('plans', '/api/plans/current'), ('nutrition', '/api/food/day')]),
             ('activity', [('feed', '/api/activities')]), ('progress', [('progress', '/api/progress/overview')]),
             ('nutrition', [('nutrition', '/api/food/day'), ('food_thread', '/api/food/thread/messages')]),
             ('track', [('plans', '/api/plans/current'), ('connections', '/api/connections')]),
             ('detail', [('activity_detail', '/api/activities/'+str(person['activity']))])]
    while time.monotonic() < deadline:
        pick = rng.randrange(100)
        if pick < 65:
            tab, calls = rng.choice(reads); began = time.monotonic(); statuses = []
            for label, path in calls: statuses.append(request(person, label, 'GET', path)[0])
            with lock: records.append(('tab_'+tab, next((s for s in statuses if not 200 <= s < 300), 200),
                                       (time.monotonic()-began)*1000))
        elif pick < 80:
            request(person, 'search_mine' if pick < 73 else 'search_catalog', 'GET',
                    '/api/food/search?q=Fictional'+('%20saved&sources=mine' if pick < 73 else '%20oats&sources=off,usda'))
        elif pick < 87:
            request(person, 'food_log', 'POST', '/api/food/entries', [{'day': day, 'meal': 'snacks',
                    'name': 'Fictional snack', 'kcal': 100, 'protein_g': 5, 'carbs_g': 15, 'fat_g': 2,
                    'client_id': str(uuid.uuid4())}])
        elif pick < 92:
            describe(person)
        elif pick < 98:
            aid = people[(i+1) % len(people)]['activity']
            comment = pick >= 96
            request(person, 'comment' if comment else 'reaction', 'POST', f'/api/activities/{aid}/'+
                    ('comments' if comment else 'reaction'), {'text': 'Fictional encouragement'} if comment else {'kind': 'cheer'})
        else:
            upload(person)
        stop.wait(args.think*rng.uniform(.75, 1.25))


def describe(person):
    started = time.monotonic()
    draft = str(uuid.uuid4())
    status, value = request(person, 'describe_message', 'POST', '/api/food/thread/messages',
                            {'client_id': str(uuid.uuid4()), 'draft_id': draft, 'review_only': True,
                             'body': '1 bowl of fictional lentils', 'day': day, 'meal': 'lunch'})
    if status != 201: return
    mid = value['message']['id']
    path = f'/api/food/thread/messages/{mid}'
    status, value = request(person, 'describe_process', 'POST', path+'/process', {})
    reply = next((m.get('result') or {} for m in (value or {}).get('messages', []) if m.get('reply_to') == mid), {})
    if reply.get('can_resolve'):
        status, value = request(person, 'describe_resolve', 'POST', path+'/resolve', {'itemize': False})
        reply = next((m.get('result') or {} for m in (value or {}).get('messages', []) if m.get('reply_to') == mid), {})
    ready = reply.get('parts') and all(p.get('status') == 'ready' and not p.get('logged') for p in reply['parts'])
    if status == 200 and (not ready or reply.get('entry_ids')): status = 500
    if status == 200:
        status, value = request(person, 'describe_review', 'POST', '/api/food/thread/reviews',
                                {'client_id': str(uuid.uuid4()), 'draft_id': draft, 'messages': [mid]})
    if status == 200:
        rid = value['id']
        status, value = request(person, 'describe_confirm', 'POST', f'/api/food/thread/reviews/{rid}/confirm',
                                {'confirm': True, 'meal': 'lunch', 'day': day})
        receipt = next((m.get('result') or {} for m in (value or {}).get('messages', []) if m.get('reply_to') == rid), {})
        if status == 200 and not receipt.get('entry_ids'): status = 500
    with lock: records.append(('describe_complete', status, (time.monotonic()-started)*1000))


def upload(person):
    # Original fictional FIT points, varied timestamps avoid measuring duplicate-only imports.
    import sys
    sys.path.insert(0, str(root/'dev/tests'))
    from fit_fixture import original_fit
    started = time.monotonic()
    with lock:
        key = str(person['uid']); sequence = sequences.get(key, 0); sequences[key] = sequence+1
        temporary = sequence_file.with_suffix('.tmp')
        temporary.write_text(json.dumps(sequences)); temporary.replace(sequence_file)
    data = original_fit(dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc)+dt.timedelta(minutes=5*sequence))
    boundary = uuid.uuid4().hex
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="fictional.fit"\r\n'
            'Content-Type: application/octet-stream\r\n\r\n').encode()+data+f'\r\n--{boundary}--\r\n'.encode()
    status, result = request(person, 'import_accept', 'POST', '/api/import', body, 'multipart/form-data; boundary='+boundary)
    if status != 200: return
    job = result.get('id', result.get('job'))
    while time.monotonic()-started < 45:
        status, jobs = request(person, 'import_poll', 'GET', '/api/imports')
        found = next((x for x in jobs or [] if x['id'] == job), None)
        if found and found['status'] in ('done', 'failed'):
            with lock: records.append(('import_complete', 200 if found['status'] == 'done' and not found['failed']
                                       and found['added'] == 1 and found['duplicates'] == 0 else 500,
                                       (time.monotonic()-started)*1000))
            return
        stop.wait(.5)
    with lock: records.append(('import_complete', 0, (time.monotonic()-started)*1000))


def sample():
    while not stop.is_set():
        try:
            raw = subprocess.check_output(['docker', 'stats', '--no-stream', '--format', '{{json .}}',
                                           args.project+'-app-1', args.project+'-db-1'], timeout=10, text=True)
            resources.append({'seconds': args.seconds-(deadline-time.monotonic()),
                              'containers': [json.loads(s) for s in raw.splitlines()]})
        except (subprocess.SubprocessError, ValueError): failures.append('resource sample failed')
        stop.wait(4)


sampler = threading.Thread(target=sample)
sampler.start()
started = time.monotonic()
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.users) as pool:
        list(pool.map(worker, range(args.users)))
finally:
    stop.set(); sampler.join()
summary = {}
for label in sorted({x[0] for x in records}):
    rows = [x for x in records if x[0] == label]
    stats = {'route': routes.get(label, 'complete workflow'), 'count': len(rows),
             'statuses': {str(s): sum(x[1] == s for x in rows) for s in sorted({x[1] for x in rows})}}
    for group, valid in [('success', lambda s: 200 <= s < 300), ('rejected_or_failed', lambda s: not 200 <= s < 300)]:
        values = sorted(x[2] for x in rows if valid(x[1]))
        stats[group] = {'count': len(values), **{f'p{p}_ms': round(values[max(0, math.ceil(len(values)*p/100)-1)], 2)
                                                for p in (50, 95, 99)}} if values else {'count': 0}
    summary[label] = stats
query = """SELECT coalesce(json_agg(t),'[]') FROM (SELECT queryid::text,query,calls,total_exec_time,mean_exec_time,
           max_exec_time,rows,shared_blks_hit,shared_blks_read FROM pg_stat_statements
           WHERE dbid=(SELECT oid FROM pg_database WHERE datname='fit') ORDER BY total_exec_time DESC LIMIT 15) t"""
report = {'fictional': True, 'users': args.users, 'requested_seconds': args.seconds, 'elapsed_seconds': time.monotonic()-started,
          'think_seconds': args.think, 'source_sha': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
          'provider_standins': {'model_seconds': .2, 'catalog_seconds': .05, 'paid_calls': 0},
          'limits': ['Closed-loop users with think time, not an open-loop saturation test',
                     'Context/understanding gates off; deterministic food parsing and simulated estimator transport',
                     'Current food-message → process/resolve → unified review → explicit confirmation APIs; browser UI is measured separately'],
          'endpoints': summary, 'queries': json.loads(sql(args.project, query)), 'resources': resources, 'errors': failures}
(args.output/'report.json').write_text(json.dumps(report, indent=2))
print(json.dumps({'users': args.users, 'calls': len(records), 'endpoints': summary, 'errors': failures}, indent=2))
