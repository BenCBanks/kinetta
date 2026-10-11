# Made-up social + cooking state for the homepage screenshots, on top of dev/demo/seed.py (a throwaway install only).
# Adds a friend, "Jordan", with a few weeks of rides and walks (the demo routes, two days later and an hour earlier, so
# the newest activity in the feed is Jordan's), shares some of Alex's runs with friends, cheers and comments both ways,
# a waiting friend request from "Sam", a pan, a dish shared with Jordan and a dish with leftovers.
# Usage: stage.py <gpx dir from gen_gpx.py>
import datetime as dt, glob, http.cookiejar, json, os, re, sys, time, urllib.request, uuid

B = os.environ.get('KINETTA_URL', 'http://localhost:8798'); G = sys.argv[1]
PW = 'demo friend password 1'


def person(login, pw):
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    def q(m, p, b=None):
        r = urllib.request.Request(B + p, data=json.dumps(b if b is not None else {}).encode() if m != 'GET' else None, method=m,
                                   headers={'Origin': B, 'Content-Type': 'application/json'})
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
for login, name in (('jordan', 'Jordan Lee'), ('sam', 'Sam Rivera')):
    try: alex('POST', '/api/people', {'login': login, 'name': name, 'password': PW})
    except urllib.error.HTTPError as e:
        if e.code != 409: raise
jordan, sam = person('jordan', PW), person('sam', PW)
jordan('PUT', '/api/profile', {'tz': 'America/New_York', 'units': 'imperial'})
jordan('PUT', '/api/sharing', {'default': 'friends'})
cutoff = (dt.date.today() - dt.timedelta(days=2)).strftime('%Y%m%d')   # moved 2 days on, they must still be in the past
runs = [p for p in sorted(glob.glob(G + '/*.gpx')) if ('cycling' in p or 'walking' in p) and os.path.basename(p)[:8] < cutoff][-16:]
print('jordan import', upload(jordan, [(os.path.basename(p), later(open(p, 'rb').read(), 2 * 1440 - 60)) for p in runs]).get('added'))

jordan('POST', '/api/friends', {'login': 'alex'}); alex('POST', '/api/friends/jordan/accept')
sam('POST', '/api/friends', {'login': 'alex'})                      # waiting for Alex
alex('PUT', '/api/sharing', {'default': 'friends'})
mine = alex('GET', '/api/activities?limit=8')
for a in mine: alex('PUT', f"/api/activities/{a['id']}/sharing", {'visibility': 'friends'})
jordan('POST', f"/api/activities/{mine[0]['id']}/cheer")
jordan('POST', f"/api/activities/{mine[0]['id']}/comments", {'text': 'Strong finish on that last mile!'})
alex('POST', f"/api/activities/{mine[0]['id']}/comments", {'text': 'Thanks! Legs felt great today.'})
jordan('POST', f"/api/activities/{mine[2]['id']}/cheer")
for a in jordan('GET', '/api/activities?limit=4')[:3]: alex('POST', f"/api/activities/{a['id']}/cheer")

for d in alex('GET', '/api/dishes'): alex('DELETE', f"/api/dishes/{d['id']}")
pan = alex('POST', '/api/dishes/pans', {'name': 'Roasting tray', 'grams': 1150})
soup = alex('POST', '/api/dishes', {'name': 'Lentil and tomato soup'})
alex('PATCH', f"/api/dishes/{soup['id']}", {'known_kcal': 1450, 'known_protein_g': 82, 'known_carbs_g': 208, 'known_fat_g': 31, 'cooked_g': 2100})
alex('POST', f"/api/dishes/{soup['id']}/portion", {'grams': 420, 'meal': 'lunch', 'day': str(dt.date.today() - dt.timedelta(days=1))})
tray = alex('POST', '/api/dishes', {'name': 'Chicken and veg traybake'})
for n, g, p in [('Chicken breast, raw', 600, {'kcal': 120, 'protein_g': 22.5, 'carbs_g': 0, 'fat_g': 2.6}),
                ('Sweet potato, raw', 500, {'kcal': 86, 'protein_g': 1.6, 'carbs_g': 20, 'fat_g': .1, 'fiber_g': 3}),
                ('Carrots, raw', 250, {'kcal': 41, 'protein_g': .9, 'carbs_g': 9.6, 'fat_g': .2, 'fiber_g': 2.8}),
                ('Red onion, raw', 150, {'kcal': 40, 'protein_g': 1.1, 'carbs_g': 9.3, 'fat_g': .1, 'fiber_g': 1.7}),
                ('Olive oil', 27, {'kcal': 884, 'protein_g': 0, 'carbs_g': 0, 'fat_g': 100})]:
    alex('POST', f"/api/dishes/{tray['id']}/items", {'name': n, 'grams': g, 'per100': p})
alex('PATCH', f"/api/dishes/{tray['id']}", {'gross_g': 2550, 'pan_id': pan['id']})
alex('POST', f"/api/dishes/{tray['id']}/share", {'login': 'jordan'})            # eating together: Jordan logs a portion too
print('staged: tray', tray['id'], 'soup', soup['id'])
