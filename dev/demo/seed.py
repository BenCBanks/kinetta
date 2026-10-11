# Demo data for public screenshots: one made-up person ("Alex") on a throwaway copy. No real data.
import json, os, urllib.request, http.cookiejar, uuid, glob, time, datetime as dt, random, sys
B = os.environ.get('LANKKI_URL', 'http://localhost:8798'); G = sys.argv[1]   # a throwaway install, never a real one
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def q(m, p, b=None):
    r = urllib.request.Request(B + p, data=json.dumps(b if b is not None else {}).encode() if m != 'GET' else None, method=m,
                               headers={'Origin': B, 'Content-Type': 'application/json'})
    return json.loads(op.open(r).read() or b'null')
q('POST', '/api/setup', {'name': 'Alex', 'login': 'alex', 'password': 'blue kettle morning run', 'tz': 'America/New_York', 'units': 'imperial'})
q('PUT', '/api/profile', {'max_hr': 188, 'rest_hr': 52, 'weight_kg': 64, 'height_cm': 168, 'birth_year': 1990, 'sex': 'female', 'activity_factor': 1.3})
bnd = uuid.uuid4().hex; parts = []
for p in sorted(glob.glob(G + '/*.gpx')):
    parts += [f'--{bnd}\r\nContent-Disposition: form-data; name="files"; filename="{p.split("/")[-1]}"\r\n\r\n'.encode(), open(p, 'rb').read(), b'\r\n']
parts.append(f'--{bnd}--\r\n'.encode())
op.open(urllib.request.Request(B + '/api/import', data=b''.join(parts), method='POST', headers={'Origin': B, 'Content-Type': f'multipart/form-data; boundary={bnd}'}))
for _ in range(100):
    j = q('GET', '/api/imports')[0]
    if j['status'] not in ('queued', 'running'): break
    time.sleep(3)
print('import', j['status'], j.get('added'))
random.seed(3); today = dt.date.today()
for k in range(0, 28):
    d = str(today - dt.timedelta(days=k))
    rows = [{'day': d, 'meal': 'breakfast', 'name': random.choice(['Oatmeal with blueberries', 'Eggs on whole-wheat toast']), 'kcal': random.randint(320, 420), 'protein_g': 16, 'carbs_g': 50, 'fat_g': 9}]
    if k > 0: rows += [{'day': d, 'meal': 'lunch', 'name': random.choice(['Turkey sandwich', 'Chicken salad bowl', 'Black bean burrito']), 'kcal': random.randint(480, 640), 'protein_g': 34, 'carbs_g': 55, 'fat_g': 16},
                       {'day': d, 'meal': 'dinner', 'name': random.choice(['Baked salmon + potatoes', 'Pasta with turkey', 'Tofu stir-fry']), 'kcal': random.randint(550, 760), 'protein_g': 38, 'carbs_g': 70, 'fat_g': 20}]
    else: rows += [{'day': d, 'meal': 'lunch', 'name': 'Chicken salad bowl', 'kcal': 520, 'protein_g': 32, 'carbs_g': 40, 'fat_g': 22}]
    q('POST', '/api/food/entries', rows)
    if k % 3 == 0: q('PUT', '/api/food/weights', {'day': d, 'kg': round(64.8 - 0.035 * (28 - k) + random.uniform(-0.25, 0.25), 1)})
q('PUT', '/api/food/targets', {'kcal_target': 1800, 'protein_target': 110})
try: q('POST', '/api/plans', {'race': '10k', 'level': 'intermediate', 'weeks': 10, 'runs': 4, 'long_day': 6})
except Exception as e: print('plan', e)
print('seeded')
