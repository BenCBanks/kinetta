# Made-up social + cooking state for public screenshots, on top of dev/demo/seed.py (a throwaway install only).
# Seven accepted friends cover running, riding and walking; their mapped activities make a lively feed with reactions,
# comments and a shared 7-of-10 session goal. Morgan's three fictional rides support the feed's achievement stand-in.
# Sam remains a pending request. Alex has a realistic five-entry Nutrition day, compact breakfast chat data, activity
# photos, saved dishes and lifting history. No real account, food provider or AI service is used.
# Usage: stage.py <gpx dir from gen_gpx.py>
from zoneinfo import ZoneInfo
import datetime as dt, glob, http.cookiejar, json, os, re, subprocess, sys, time, urllib.request, uuid
from pathlib import Path
from urllib.parse import urlsplit

# Keep the screenshot-only Kit report and its repository boundary checked in CI.
subprocess.run([sys.executable, str(Path(__file__).with_name('test_kit_release_standin.py'))], check=True)

sys.path.insert(0,str(__import__('pathlib').Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from portal_fixture import admin_headers, is_admin_path
from app import route_geo

B = os.environ.get('KINETTA_URL', 'http://localhost:8798'); G = sys.argv[1]
PW = 'demo friend password 1'
SCREENSHOT_FIXTURE = os.environ.get('KINETTA_SCREENSHOT_FIXTURE') == '1'
if SCREENSHOT_FIXTURE:
    clock = json.loads(Path(__file__).with_name('fixture-time.json').read_text())
    now = dt.datetime.fromisoformat(clock['instant'].replace('Z', '+00:00')).astimezone(ZoneInfo(clock['timezone']))
    screenshot_today = now.date()
else:
    now = dt.datetime.now(ZoneInfo('America/New_York'))
    screenshot_today = now.date()


def person(login, pw):
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def q(m, p, b=None):
        r = urllib.request.Request(B + p, data=json.dumps(b if b is not None else {}).encode() if m != 'GET' else None, method=m,
                                   headers={'Origin': B, 'Content-Type': 'application/json', **(admin_headers(B) if login == 'alex' and is_admin_path(p) else {})})
        return json.loads(op.open(r).read() or b'null')
    q('POST', '/api/login', {'login': login, 'password': pw}); q.op = op
    return q


def upload(q, files):
    bnd = uuid.uuid4().hex; parts = []
    for name, data in files:
        parts += [f'--{bnd}\r\nContent-Disposition: form-data; name="files"; filename="{name}"\r\n\r\n'.encode(), data, b'\r\n']
    parts.append(f'--{bnd}--\r\n'.encode())
    q.op.open(urllib.request.Request(B + '/api/import', data=b''.join(parts), method='POST',
                                     headers={'Origin': B, 'Content-Type': f'multipart/form-data; boundary={bnd}'}))
    for _ in range(100):
        j = q('GET', '/api/imports')[0]
        if j['status'] not in ('queued', 'running'): return j
        time.sleep(2)


def later(gpx, minutes):   # the same made-up route, a little later in the day
    def shift(m):
        t = dt.datetime.fromisoformat(m.group(1).decode().replace('Z', '+00:00')) + dt.timedelta(minutes=minutes)
        return b'<time>' + t.strftime('%Y-%m-%dT%H:%M:%SZ').encode() + b'</time>'
    return re.sub(rb'<time>([^<]+)</time>', shift, gpx)


alex = person('alex', 'blue kettle morning run')
alex('PUT','/api/account',{'name':'Alex Rivera','bio':'Runs, rides and good food.'})
# A completed week of fictional meals reaches this goal, so the combined training + food screen shows a useful trend.
alex('PUT', '/api/food/targets', {'kcal_target': 1800, 'protein_target': 110})
people = (
    ('jordan', 'Jordan Lee'), ('sam', 'Sam Rivera'), ('casey', 'Casey Example'),
    ('taylor', 'Taylor Example'), ('morgan', 'Morgan Patel'), ('avery', 'Avery Chen'),
    ('riley', 'Riley Brooks'), ('quinn', 'Quinn Jones'),
)
for login, name in people:
    try: alex('POST', '/api/admin/people', {'login': login, 'name': name, 'password': PW})
    except urllib.error.HTTPError as e:
        if e.code != 409: raise
friends = {login: person(login, PW) for login, _ in people}
jordan, sam = friends['jordan'], friends['sam']
jordan('PUT', '/api/profile', {'tz': 'America/New_York', 'units': 'imperial'})
jordan('PUT', '/api/sharing', {'default': 'friends'})
cutoff = (screenshot_today - dt.timedelta(days=2)).strftime('%Y%m%d')   # moved 2 days on, they must still be in the past
runs = [p for p in sorted(glob.glob(G + '/*.gpx')) if ('cycling' in p or 'walking' in p) and os.path.basename(p)[:8] < cutoff][-16:]
print('jordan import', upload(jordan, [(os.path.basename(p), later(open(p, 'rb').read(), 2 * 1440 - 60)) for p in runs]).get('added'))

jordan('POST', '/api/friends', {'login': 'alex'}); alex('POST', '/api/friends/jordan/accept')
sam('POST', '/api/friends', {'login': 'alex'})                      # waiting for Alex
# A mature fictional account tells the feed story without new-account discovery cards.
for login in ('casey', 'taylor', 'morgan', 'avery', 'riley', 'quinn'):
    friends[login]('POST', '/api/friends', {'login': 'alex'})
    alex('POST', '/api/friends/' + login + '/accept')
# Casey and Taylor can also cheer Morgan's shared ride, so the featured friend card has a real reaction cluster.
for login in ('casey', 'taylor'):
    friends[login]('POST', '/api/friends', {'login': 'morgan'})
    friends['morgan']('POST', '/api/friends/' + login + '/accept')
assert alex('GET', '/api/me')['friend_count'] >= 7
alex('PUT', '/api/sharing', {'default': 'friends', 'share_achievements': True})
last = [p for p in sorted(glob.glob(G + '/*running.gpx'))][-1]; raw = open(last, 'rb').read()
t0 = dt.datetime.fromisoformat(re.search(rb'<time>([^<]+)</time>', raw).group(1).decode().replace('Z', '+00:00'))
# Scheduled captures near midnight still need a workout on the displayed demo day.
ago = max(now - dt.timedelta(hours=2.5), now.replace(hour=0, minute=0, second=0, microsecond=0)).astimezone(dt.timezone.utc)
print('alex today', upload(alex, [('today-running.gpx', later(raw, (ago - t0).total_seconds() // 60))]).get('added'))

# A shared goal includes Alex and six friends. Their mapped activities are imported after joining, so 7/10 is real.
local_today = dt.datetime.now(ZoneInfo('America/New_York')).date()
group = alex('POST', '/api/groups', {
    'title': 'Weekend Trail Crew', 'event_date': str(local_today + dt.timedelta(days=21)),
    'time_zone': 'America/New_York', 'note': 'Every kind of movement counts.',
    'goal_type': 'sessions', 'goal_target': 10, 'goal_unit': 'sessions',
})
group_id = group['id']
invite = group['invite_url'].rsplit('/', 1)[1]
group_members = ('jordan', 'casey', 'taylor', 'avery', 'riley', 'quinn')
for login in group_members:
    friends[login]('POST', '/api/group-invites/' + invite + '/accept')
friends['morgan']('PUT', '/api/sharing', {'default': 'friends', 'share_achievements': True})

recent_sports = {
    'alex': 'running', 'jordan': 'cycling', 'casey': 'running', 'taylor': 'walking',
    'morgan': 'cycling', 'avery': 'walking', 'riley': 'running', 'quinn': 'cycling',
}
# Round to the next minute so every activity is after membership and never appears as a future workout.
target_time = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0) + dt.timedelta(minutes=1)
# Keep the featured feed rows adjacent while ensuring each of the seven goal sessions happens after group membership.
group_activity_time = dt.datetime.now(dt.timezone.utc).replace(microsecond=0) + dt.timedelta(seconds=15)
# Morgan's first two fictional rides plus the featured ride below total more than 25 miles. They are outside the
# Trail Crew group so its seven members still contribute exactly seven of the ten sessions.
cycling = sorted(glob.glob(G + '/*cycling.gpx'))
for index, (days_ago, source) in enumerate(((2, cycling[-3]), (1, cycling[-2])), 1):
    raw = open(source, 'rb').read()
    first = dt.datetime.fromisoformat(re.search(rb'<time>([^<]+)</time>', raw).group(1).decode().replace('Z', '+00:00'))
    when = target_time - dt.timedelta(days=days_ago)
    result = upload(friends['morgan'], [('morgan-achievement-' + str(index) + '-' + os.path.basename(source),
                                          later(raw, (when - first).total_seconds() / 60))])
    print('morgan achievement ride', result.get('added'))
for login, sport in recent_sports.items():
    candidates = sorted(glob.glob(G + '/*' + sport + '*.gpx'))
    if not candidates:
        raise RuntimeError('Missing fictional GPX for ' + sport)
    source = candidates[-1]
    raw = open(source, 'rb').read()
    first = dt.datetime.fromisoformat(re.search(rb'<time>([^<]+)</time>', raw).group(1).decode().replace('Z', '+00:00'))
    activity_time = group_activity_time + (dt.timedelta(seconds=2) if login == 'morgan' else dt.timedelta())
    shifted = later(raw, (activity_time - first).total_seconds() / 60)
    account = alex if login == 'alex' else friends[login]
    result = upload(account, [(login + '-' + os.path.basename(source), shifted)])
    print(login, 'recent', result.get('added'))
while dt.datetime.now(dt.timezone.utc) <= target_time + dt.timedelta(seconds=1):
    time.sleep(0.5)
group_state = alex('GET', '/api/groups/' + group_id)
assert group_state['member_count'] == 7 and group_state.get('total') == 7, 'The screenshot group must show 7 of 10 sessions.'
alex('POST', '/api/groups/' + group_id + '/updates', {'text': 'Seven sessions in. Keep the momentum going!'})

# Nutrition day fixture: a clear ring and three meal groups with fictional entries.
today = local_today
for entry in alex('GET', '/api/food/day?d=' + str(today))['entries']:
    alex('DELETE', '/api/food/entries/' + str(entry['id']))
alex('POST', '/api/food/entries', [
    {'day': str(today), 'meal': 'breakfast', 'name': '2 eggs', 'amount': 2, 'unit': 'large', 'kcal': 144, 'protein_g': 13, 'carbs_g': 1, 'fat_g': 10, 'source': 'quick'},
    {'day': str(today), 'meal': 'breakfast', 'name': 'Whole-grain toast', 'amount': 1, 'unit': 'slice', 'kcal': 110, 'protein_g': 4, 'carbs_g': 20, 'fat_g': 2, 'source': 'quick'},
    {'day': str(today), 'meal': 'breakfast', 'name': 'Black coffee', 'amount': 1, 'unit': 'cup', 'kcal': 2, 'protein_g': 0, 'carbs_g': 0, 'fat_g': 0, 'source': 'quick'},
    {'day': str(today), 'meal': 'lunch', 'name': 'Chicken grain bowl', 'amount': 1, 'unit': 'bowl', 'kcal': 560, 'protein_g': 42, 'carbs_g': 56, 'fat_g': 16, 'source': 'quick'},
    {'day': str(today), 'meal': 'dinner', 'name': 'Salmon and potatoes', 'amount': 1, 'unit': 'plate', 'kcal': 620, 'protein_g': 38, 'carbs_g': 48, 'fat_g': 27, 'source': 'quick'},
])
mine = alex('GET', '/api/activities?limit=8')
for a in mine: alex('PUT', f"/api/activities/{a['id']}/sharing", {'visibility': 'friends'})
# Three friends on the same newest card show native emoji with individual counts in both capture themes.
for friend, kind in ((jordan, 'clap'), (person('casey', PW), 'starstruck'), (person('taylor', PW), 'mindblown')):
    friend('POST', f"/api/activities/{mine[0]['id']}/reaction", {'kind': kind})
reactions = alex('GET', f"/api/activities/{mine[0]['id']}/social")['reactions']
assert all(reactions.get(kind) == 1 for kind in ('clap', 'starstruck', 'mindblown')) and sum(reactions.values()) == 3
jordan('POST', f"/api/activities/{mine[0]['id']}/comments", {'text': 'Strong finish on that last mile!'})
alex('POST', f"/api/activities/{mine[0]['id']}/comments", {'text': 'Thanks! Legs felt great today.'})
# The Friends screenshot features Morgan's ride and a three-person reaction cluster with two comments.
morgan_activity = friends['morgan']('GET', '/api/activities?limit=1')[0]
for account, kind in ((alex, 'clap'), (friends['casey'], 'starstruck'), (friends['taylor'], 'mindblown')):
    account('POST', f"/api/activities/{morgan_activity['id']}/reaction", {'kind': kind})
alex('POST', f"/api/activities/{morgan_activity['id']}/comments", {'text': 'That loop looks beautiful!'})
friends['casey']('POST', f"/api/activities/{morgan_activity['id']}/comments", {'text': 'Adding this route to my weekend list.'})
morgan_social = alex('GET', f"/api/activities/{morgan_activity['id']}/social")
assert all(morgan_social['reactions'].get(kind) == 1 for kind in ('clap', 'starstruck', 'mindblown'))
assert len(morgan_social['comments']) == 2
jordan('POST', f"/api/activities/{mine[2]['id']}/cheer")
for a in jordan('GET', '/api/activities?limit=4')[:3]: alex('POST', f"/api/activities/{a['id']}/cheer")
# photos on activities (2026-10-13): Freedom Park and the Little Sugar Creek Greenway, where the demo routes run (dev/demo/photos, credits in its README)
PH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'demo', 'photos')
def photo(q, aid, name):
    q('POST', f'/api/activities/{aid}/photos', {'image': 'data:image/jpeg;base64,' + __import__('base64').b64encode(open(os.path.join(PH, name + '.jpg'), 'rb').read()).decode()})
for name in ('freedom-park-lake', 'freedom-park-bridge'): photo(alex, mine[0]['id'], name)
photo(jordan, jordan('GET', '/api/activities?limit=1')[0]['id'], 'sugar-creek-greenway')

for d in alex('GET', '/api/dishes'):
    if d.get('mine') is not False: alex('DELETE', f"/api/dishes/{d['id']}")
soup = alex('POST', '/api/dishes', {'name': 'Lentil and tomato soup'})
alex('PATCH', f"/api/dishes/{soup['id']}", {'serving': 'portion', 'known_kcal': 1450, 'known_protein_g': 82, 'known_carbs_g': 208, 'known_fat_g': 31, 'cooked_g': 2100})
alex('POST', f"/api/dishes/{soup['id']}/portion", {'grams': 420, 'meal': 'lunch', 'day': str(screenshot_today - dt.timedelta(days=1))})
smoothie = alex('POST', '/api/dishes', {'name': 'Berry protein smoothie'})
for n, g, p in [('Banana', 120, {'kcal': 89, 'protein_g': 1.1, 'carbs_g': 23, 'fat_g': .3, 'fiber_g': 2.6}),
                ('Frozen mixed berries', 150, {'kcal': 50, 'protein_g': .7, 'carbs_g': 12, 'fat_g': .3, 'fiber_g': 3}),
                ('Whey protein', 30, {'kcal': 400, 'protein_g': 80, 'carbs_g': 8, 'fat_g': 6}),
                ('Milk, 2%', 250, {'kcal': 50, 'protein_g': 3.3, 'carbs_g': 4.8, 'fat_g': 2})]:
    alex('POST', f"/api/dishes/{smoothie['id']}/items", {'name': n, 'grams': g, 'per100': p})
# the smoothie keeps the default: by servings, makes 1
tray = alex('POST', '/api/dishes', {'name': 'Chicken and veg traybake'})
for n, g, p in [('Chicken breast, raw', 600, {'kcal': 120, 'protein_g': 22.5, 'carbs_g': 0, 'fat_g': 2.6}),
                ('Sweet potato, raw', 500, {'kcal': 86, 'protein_g': 1.6, 'carbs_g': 20, 'fat_g': .1, 'fiber_g': 3}),
                ('Carrots, raw', 250, {'kcal': 41, 'protein_g': .9, 'carbs_g': 9.6, 'fat_g': .2, 'fiber_g': 2.8}),
                ('Red onion, raw', 150, {'kcal': 40, 'protein_g': 1.1, 'carbs_g': 9.3, 'fat_g': .1, 'fiber_g': 1.7}),
                ('Olive oil', 27, {'kcal': 884, 'protein_g': 0, 'carbs_g': 0, 'fat_g': 100})]:
    alex('POST', f"/api/dishes/{tray['id']}/items", {'name': n, 'grams': g, 'per100': p})
alex('PATCH', f"/api/dishes/{tray['id']}", {'serving': 'portion', 'cooked_g': 1400})   # by weight: weighed after roasting
alex('POST', f"/api/dishes/{tray['id']}/share", {'login': 'jordan'})            # eating together: Jordan logs a portion too
# lifting (2026-10-13, api_lifts.py): "Strength A", a little heavier each week (pounds, as an imperial lifter types them)
lb = lambda x: x / 2.20462262
ex = {n: alex('POST', '/api/lifts/exercises', {'name': n})['id'] for n in ('Squat', 'Bench press', 'Barbell row', 'Pull-up', 'Plank')}
for w, days_ago in enumerate((24, 17, 10, 3)):
    s = alex('POST', '/api/activities/manual', {'sport': 'workout', 'name': 'Strength A', 'duration_s': 3300,
                                               'start': f"{screenshot_today - dt.timedelta(days=days_ago)}T18:00"})
    alex('PUT', f"/api/activities/{s['id']}/lifts", {'exercises': [
        {'exercise_id': ex['Squat'], 'sets': [{'reps': 8, 'kg': lb(95), 'warmup': True}] + [{'reps': 5, 'kg': lb(185 + 5 * w)}] * 3},
        {'exercise_id': ex['Bench press'], 'sets': [{'reps': 5, 'kg': lb(145 + 5 * (w // 2))}] * 3},
        {'exercise_id': ex['Barbell row'], 'sets': [{'reps': 8, 'kg': lb(115 + 5 * w)}] * 3},
        {'exercise_id': ex['Pull-up'], 'sets': [{'reps': 7 + w}, {'reps': 6 + w}]},
        {'exercise_id': ex['Plank'], 'sets': [{'secs': 45 + 15 * w}]}]})
alex('PATCH', f"/api/lifts/exercises/{ex['Squat']}", {'note': 'Safety pins on 6'})
routes = json.loads((Path(__file__).resolve().parents[1] / 'demo' / 'routes.json').read_text())
park = route_geo.slice_line(routes['park loop'], 400, 1100)
segment = alex('POST', '/api/segments', {'client_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://kinetta.app/dev/screenshots/segments/park-loop')),
                                         'name': 'Fictional Park Loop', 'sport': 'run', 'audience': 'me', 'source': 'map',
                                         'line': route_geo.encode(park), 'understood_fixed': True})
for theme in ('light', 'dark'):
    login = f'zz_test_658_food_{theme}'
    body = {'login': login, 'name': f'Fictional site food {theme}', 'password': 'green teapot on the hill'}
    try:
        alex('POST', '/api/admin/people', body)
    except urllib.error.HTTPError as error:
        if error.code != 409: raise
        existing = person(login, body['password'])
        existing('POST', '/api/account/delete', {'password': body['password']})
        alex('POST', '/api/admin/people', body)
    screenshot_food = person(login, body['password'])
    screenshot_food('PUT', '/api/profile', {'tz': 'America/New_York', 'units': 'imperial', 'ai_ok': False, 'ai_adult': False})
    # Keep this library empty so the screenshot's typed meal uses the stand-in estimator
    # for all three foods in one review card instead of asking about saved-food portions.
    yesterday = screenshot_today - dt.timedelta(days=1)
    breakfast_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f'https://kinetta.app/dev/screenshots/breakfast/{theme}'))
    screenshot_food('POST', '/api/food/entries', [{'day': str(yesterday), 'meal': 'breakfast',
        'name': 'Greek yogurt with berries', 'amount': 1, 'unit': 'bowl', 'kcal': 225,
        'protein_g': 18, 'carbs_g': 28, 'fat_g': 4, 'fiber_g': 5, 'client_id': breakfast_id}])
    chat_login = f'zz_test_658_chat_{theme}'
    chat_body = {'login': chat_login, 'name': f'Fictional site chat {theme}', 'password': 'green teapot on the hill'}
    try:
        alex('POST', '/api/admin/people', chat_body)
    except urllib.error.HTTPError as error:
        if error.code != 409: raise
        existing = person(chat_login, chat_body['password'])
        existing('POST', '/api/account/delete', {'password': chat_body['password']})
        alex('POST', '/api/admin/people', chat_body)

# A prepared three-food review keeps the browser screenshot deterministic. The
# helper writes only to the disposable screenshot app and uses fictional values.
port = urlsplit(B).port
if not port: raise RuntimeError('Screenshot app URL must include its local port')
rows = subprocess.check_output(['docker', 'ps', '--filter', f'publish={port}', '--format', '{{.ID}} {{.Names}}'], text=True).splitlines()
apps = [row.split()[0] for row in rows if len(row.split()) == 2 and row.split()[1].endswith('-app-1')]
if len(apps) != 1: raise RuntimeError('Could not identify the disposable screenshot app container')
fixture = os.environ.get('KINETTA_SCREENSHOT_FOOD_FIXTURE')
copied_fixture = fixture is None
if copied_fixture:
    fixture = f'/tmp/kinetta-food-chat-fixture-{os.getpid()}.py'
    source = Path(__file__).with_name('food_chat_fixture.py')
    subprocess.run(['docker', 'cp', str(source), f'{apps[0]}:{fixture}'], check=True)
try:
    subprocess.run(['docker', 'exec', apps[0], 'python', fixture], check=True)
finally:
    if copied_fixture:
        subprocess.run(['docker', 'exec', apps[0], 'rm', '-f', fixture], check=False)
print('staged: tray', tray['id'], 'soup', soup['id'], 'segment', segment['id'])
