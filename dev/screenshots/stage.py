# Made-up social + cooking state for the homepage screenshots, on top of dev/demo/seed.py (a throwaway install only).
# Adds a cast of fictional friends, with a few weeks of rides and walks (the demo routes, two days later and an hour earlier),
# shares the owner's runs with friends, adds reactions and comments both ways,
# a waiting friend request, photos on a few activities, saved dishes (a soup, a shared traybake, a smoothie), four weeks of
# lifting (the same session twice a week, a little heavier each week, in round pounds). The owner also ran this
# morning (a demo run moved to 2.5 hours ago), so the Today screen isn't an empty week on a Monday.
# Usage: stage.py <gpx dir from gen_gpx.py>
from zoneinfo import ZoneInfo
import base64, datetime as dt, glob, http.cookiejar, json, os, re, subprocess, sys, time, urllib.request, uuid
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
                                   headers={'Origin': B, 'Content-Type': 'application/json', **(admin_headers(B) if login == owner_login and is_admin_path(p) else {})})
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


owner_login = 'alex'  # portal_fixture.admin_headers authenticates this disposable owner before its screenshot-only rename.
owner_fixture_login = 'nia' if SCREENSHOT_FIXTURE else 'alex'
alex = person(owner_login, 'blue kettle morning run')
members = (('ethan', 'Ethan Park'), ('maya', 'Maya Chen'), ('mateo', 'Mateo Ruiz'), ('priya', 'Priya Shah'), ('andre', 'Andre Hill')) if SCREENSHOT_FIXTURE else (('jordan', 'Jordan Lee'), ('sam', 'Sam Rivera'), ('casey', 'Casey Example'), ('taylor', 'Taylor Example'), ('morgan', 'Morgan Example'))
for login, name in members:
    try: alex('POST', '/api/admin/people', {'login': login, 'name': name, 'password': PW})
    except urllib.error.HTTPError as e:
        if e.code != 409: raise
jump = {'name':'Nia Brooks','login':owner_fixture_login,'bio':'Runs, rides and good food.'} if SCREENSHOT_FIXTURE else {'name':'Alex Rivera','bio':'Runs, rides and good food.'}
alex('PUT','/api/account',jump)
jordan_login, sam_login = ('ethan', 'priya') if SCREENSHOT_FIXTURE else ('jordan', 'sam')
friend_a_login, friend_b_login = ('maya', 'mateo') if SCREENSHOT_FIXTURE else ('casey', 'taylor')
jordan, sam = person(jordan_login, PW), person(sam_login, PW)
jordan('PUT', '/api/profile', {'tz': 'America/New_York', 'units': 'imperial'})
jordan('PUT', '/api/sharing', {'default': 'friends'})
# Small generated portraits belong only to the dedicated disposable screenshot database.
# The ordinary test seed stays photo-free; the public app bundle and live accounts never read these files.
if SCREENSHOT_FIXTURE:
    portrait_dir = Path(__file__).with_name('portraits')
    for login in ('nia', 'ethan', 'maya', 'mateo', 'priya', 'andre'):
        fixture_person = alex if login == owner_fixture_login else person(login, PW)
        portrait = (portrait_dir / f'{login}.webp').read_bytes()
        payload = 'data:image/webp;base64,' + base64.b64encode(portrait).decode('ascii')
        fixture_person('PUT', '/api/me/photo', {'image': payload})
cutoff = (screenshot_today - dt.timedelta(days=2)).strftime('%Y%m%d')   # moved 2 days on, they must still be in the past
runs = [p for p in sorted(glob.glob(G + '/*.gpx')) if ('cycling' in p or 'walking' in p) and os.path.basename(p)[:8] < cutoff][-16:]
print('jordan import', upload(jordan, [(os.path.basename(p), later(open(p, 'rb').read(), 2 * 1440 - 60)) for p in runs]).get('added'))

jordan('POST', '/api/friends', {'login': owner_fixture_login}); alex('POST', f'/api/friends/{jordan_login}/accept')
sam('POST', '/api/friends', {'login': owner_fixture_login})                      # waiting friend request
# A mature fictional account tells the feed story without new-account discovery cards.
for login in (friend_a_login,friend_b_login):
    friend=person(login,PW);friend('POST','/api/friends',{'login':owner_fixture_login});alex('POST','/api/friends/'+login+'/accept')
assert alex('GET','/api/me')['friend_count']>=3
alex('PUT', '/api/sharing', {'default': 'friends'})
# A complete, fictional day on the captured date. The local screenshot clock
# can differ from ambient time, so seed every row directly on screenshot_today.
alex('POST', '/api/food/entries', [
    {'day': str(screenshot_today), 'meal': 'breakfast', 'name': 'Oats and berries', 'amount': 1, 'unit': 'bowl', 'kcal': 500,
     'protein_g': 22, 'carbs_g': 70, 'fat_g': 14, 'fiber_g': 11},
    {'day': str(screenshot_today), 'meal': 'lunch', 'name': 'Chicken grain bowl', 'amount': 1, 'unit': 'bowl', 'kcal': 750,
     'protein_g': 42, 'carbs_g': 82, 'fat_g': 23, 'fiber_g': 8},
    {'day': str(screenshot_today), 'meal': 'dinner', 'name': 'Vegetables and rice', 'amount': 1, 'unit': 'plate', 'kcal': 400,
     'protein_g': 14, 'carbs_g': 55, 'fat_g': 10, 'fiber_g': 10}])
last = [p for p in sorted(glob.glob(G + '/*running.gpx'))][-1]; raw = open(last, 'rb').read()
t0 = dt.datetime.fromisoformat(re.search(rb'<time>([^<]+)</time>', raw).group(1).decode().replace('Z', '+00:00'))
# Scheduled captures near midnight still need a workout on the displayed demo day.
ago = max(now - dt.timedelta(hours=2.5), now.replace(hour=0, minute=0, second=0, microsecond=0)).astimezone(dt.timezone.utc)
print('alex today', upload(alex, [('today-running.gpx', later(raw, (ago - t0).total_seconds() // 60))]).get('added'))
if SCREENSHOT_FIXTURE:
    # Put another under-30 member at the top of the published feed capture; the ordinary test seed is unchanged.
    friend_start = max(now - dt.timedelta(minutes=50), now.replace(hour=0, minute=0, second=0, microsecond=0)).astimezone(dt.timezone.utc)
    print('ethan today', upload(jordan, [('ethan-morning-run.gpx', later(raw, (friend_start - t0).total_seconds() // 60))]).get('added'))
    recent_friend_run = jordan('GET', '/api/activities?limit=1')[0]
    jordan('PUT', f"/api/activities/{recent_friend_run['id']}/sharing", {'visibility': 'friends'})
mine = alex('GET', '/api/activities?limit=8')
for a in mine: alex('PUT', f"/api/activities/{a['id']}/sharing", {'visibility': 'friends'})
# Three friends on the same newest card show native emoji with individual counts in both capture themes.
for friend, kind in ((jordan, 'clap'), (person(friend_a_login, PW), 'starstruck'), (person(friend_b_login, PW), 'mindblown')):
    friend('POST', f"/api/activities/{mine[0]['id']}/reaction", {'kind': kind})
reactions = alex('GET', f"/api/activities/{mine[0]['id']}/social")['reactions']
assert all(reactions.get(kind) == 1 for kind in ('clap', 'starstruck', 'mindblown')) and sum(reactions.values()) == 3
jordan('POST', f"/api/activities/{mine[0]['id']}/comments", {'text': 'Strong finish on that last mile!'})
alex('POST', f"/api/activities/{mine[0]['id']}/comments", {'text': 'Thanks! Legs felt great today.'})
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
alex('POST', f"/api/dishes/{tray['id']}/share", {'login': jordan_login})            # eating together: the first friend logs a portion too
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
    home_review_login = f'zz_test_home_food_{theme}'
    home_review_body = {'login': home_review_login, 'name': f'Fictional Home food review {theme}', 'password': 'green teapot on the hill'}
    try:
        alex('POST', '/api/admin/people', home_review_body)
    except urllib.error.HTTPError as error:
        if error.code != 409: raise
        existing = person(home_review_login, home_review_body['password'])
        existing('POST', '/api/account/delete', {'password': home_review_body['password']})
        alex('POST', '/api/admin/people', home_review_body)
    person(home_review_login, home_review_body['password'])('PUT', '/api/profile', {'tz': 'America/New_York', 'units': 'imperial', 'ai_ok': True, 'ai_adult': True})
    weight_login = f'zz_test_1049_food_{theme}'
    weight_body = {'login': weight_login, 'name': f'Fictional food and weight {theme}', 'password': 'green teapot on the hill'}
    try:
        alex('POST', '/api/admin/people', weight_body)
    except urllib.error.HTTPError as error:
        if error.code != 409: raise
        existing = person(weight_login, weight_body['password'])
        existing('POST', '/api/account/delete', {'password': weight_body['password']})
        alex('POST', '/api/admin/people', weight_body)
    person(weight_login, weight_body['password'])('PUT', '/api/profile', {'tz': 'America/New_York', 'units': 'imperial', 'ai_ok': False, 'ai_adult': False})
    confirmed_login = f'zz_test_1319_chat_{theme}'
    confirmed_body = {'login': confirmed_login, 'name': f'Fictional meal example {theme}', 'password': 'green teapot on the hill'}
    try:
        alex('POST', '/api/admin/people', confirmed_body)
    except urllib.error.HTTPError as error:
        if error.code != 409: raise
        existing = person(confirmed_login, confirmed_body['password'])
        existing('POST', '/api/account/delete', {'password': confirmed_body['password']})
        alex('POST', '/api/admin/people', confirmed_body)
    person(confirmed_login, confirmed_body['password'])('PUT', '/api/profile', {'tz': 'America/New_York', 'units': 'imperial', 'ai_ok': True, 'ai_adult': True})

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
    subprocess.run(['docker', 'exec', apps[0], 'python', fixture, now.isoformat()], check=True)
    home_fixture = f'/tmp/kinetta-home-food-review-fixture-{os.getpid()}.py'
    subprocess.run(['docker', 'cp', str(Path(__file__).with_name('home_food_review_fixture.py')), f'{apps[0]}:{home_fixture}'], check=True)
    try:
        subprocess.run(['docker', 'exec', apps[0], 'python', home_fixture, now.isoformat()], check=True)
    finally:
        subprocess.run(['docker', 'exec', apps[0], 'rm', '-f', home_fixture], check=False)
    confirmed_fixture = f'/tmp/kinetta-meal-example-fixture-{os.getpid()}.py'
    subprocess.run(['docker', 'cp', str(Path(__file__).with_name('food_confirmed_chat_fixture.py')), f'{apps[0]}:{confirmed_fixture}'], check=True)
    try:
        subprocess.run(['docker', 'exec', apps[0], 'python', confirmed_fixture, now.isoformat()], check=True)
    finally:
        subprocess.run(['docker', 'exec', apps[0], 'rm', '-f', confirmed_fixture], check=False)
    weight_fixture = f'/tmp/kinetta-food-weight-fixture-{os.getpid()}.py'
    subprocess.run(['docker', 'cp', str(Path(__file__).with_name('food_weight_chat_fixture.py')), f'{apps[0]}:{weight_fixture}'], check=True)
    try:
        subprocess.run(['docker', 'exec', apps[0], 'python', weight_fixture, now.isoformat()], check=True)
    finally:
        subprocess.run(['docker', 'exec', apps[0], 'rm', '-f', weight_fixture], check=False)
finally:
    if copied_fixture:
        subprocess.run(['docker', 'exec', apps[0], 'rm', '-f', fixture], check=False)
print('staged: tray', tray['id'], 'soup', soup['id'], 'segment', segment['id'])
