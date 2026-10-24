"""Photos (api_photos.py, 2026-10-12): profile photos and activity photos. Who may see them, that nothing from the
original file survives (camera details, location), the limits, and the admin taking down a reported profile photo.
Made-up zz_test people only; their accounts are deleted at the end."""
import urllib.error, urllib.request
from kc import ALEX, BASE, PW, Client, login, person, review_decision

# a 64x48 JPEG with made-up camera details ("ZZTestPhoneMaker"), a made-up GPS position and "rotate 90°" (EXIF)
JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4QCyRXhpZgAATU0AKgAAAAgAAwEPAAIAAAARAAAAMgESAAMAAAABAAYAAIglAAQAAAABAAAARAAAAABaWlRlc3RQaG9uZU1ha2VyAAAABAABAAIAAAACTgAAAAACAAUAAAADAAAAegADAAIAAAACVwAAAAAEAAUAAAADAAAAkgAAAAAAAAAoAAAAAQAAABoAAAABAAAALgAAAAEAAABPAAAAAQAAADoAAAABAAAAOAAAAAH/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDmqKKK+YP1IKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k='
n = 0
def ck(cond, what):
    global n
    assert cond, what; n += 1

def fetch(c, path):
    """Status, headers and raw bytes (photos aren't JSON)."""
    try:
        with c.op.open(urllib.request.Request(BASE + path)) as r: return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e: return e.code, e.headers, b''

a, b, c = person('zz_test_ph_a', 'Photo Tester'), person('zz_test_ph_b'), person('zz_test_ph_c')
admin = login(*ALEX)
# This fixture exercises private photos explicitly; signup now defaults to Everyone.
ck(a.put('/api/sharing', {'default':'me'})[0] == 200, 'choose private activity default for this fixture')
for x, y in ((a, 'zz_test_ph_b'), (b, 'zz_test_ph_a'), (a, 'zz_test_ph_c'), (c, 'zz_test_ph_a')):
    x.delete(f'/api/people/{y}/block'); x.delete(f'/api/friends/{y}')

# profile photo: saved as a new square JPEG with none of the original file's details
s, r = a.put('/api/me/photo', {'image': JPG}); ck(s == 200 and r['photo'], f'set profile photo {s} {r}')
v = r['photo']
ck(a.get('/api/me')[1].get('photo') == v, '/api/me has the photo version')
s, h, data = fetch(c, '/api/people/zz_test_ph_a/photo?v=' + v)
ck(s == 200 and data[:2] == b'\xff\xd8' and h['Content-Type'] == 'image/jpeg', f'someone signed in sees it {s}')
ck(b'ZZTestPhoneMaker' not in data and b'Exif' not in data, 'no camera details or EXIF (location) in the saved photo')
ck('private' in h.get('Cache-Control', '') and 'no-store' not in h.get('Cache-Control', ''), f"phones may keep it: {h.get('Cache-Control')}")
ck(fetch(Client(), '/api/people/zz_test_ph_a/photo')[0] == 401, 'not signed in: 401')
ck(fetch(c, '/api/people/zz_test_ph_b/photo')[0] == 404, 'no photo: 404')
ck(a.put('/api/me/photo', {'image': 'data:image/jpeg;base64,bm90IGEgcGhvdG8='})[0] == 400, 'not a photo: 400')
ck(a.put('/api/me/photo', {'image': '%%%'})[0] in (400, 422), 'not base64: refused')
# shown with the person in the answers that list people
s, r = c.post('/api/friends', {'login': 'zz_test_ph_a'})
ck(any(x['login'] == 'zz_test_ph_a' and x['photo'] == v for x in c.get('/api/friends')[1]['outgoing']), 'friend list has the photo')
ck(any(x['login'] == 'zz_test_ph_a' and x['photo'] == v for x in c.get('/api/people/search?q=zz_test_ph_a')[1]), 'search has the photo')
c.delete('/api/friends/zz_test_ph_a')
# blocking works both ways: neither sees the other's photo
c.post('/api/people/zz_test_ph_a/block')
ck(fetch(c, '/api/people/zz_test_ph_a/photo')[0] == 404, 'blocked: 404')
c.put('/api/me/photo', {'image': JPG})
ck(fetch(a, '/api/people/zz_test_ph_c/photo')[0] == 404, 'blocked the other way: 404')
c.delete('/api/people/zz_test_ph_a/block')

# activity photos: only the owner adds and removes them; they follow who may see the activity
s, run = a.post('/api/activities/manual', {'sport': 'run', 'start': '2026-10-04T07:00', 'duration_s': 1800, 'distance_m': 5000}); ck(s == 200, 'run')
aid = run['id']
s, p = a.post(f'/api/activities/{aid}/photos', {'image': JPG}); ck(s == 200 and p['id'], f'add photo {s} {p}')
ck((p['w'], p['h']) == (48, 64), f"turned upright from its EXIF rotation {p}")
ck(b.post(f'/api/activities/{aid}/photos', {'image': JPG})[0] == 404, "someone else can't add to your activity")
s, h, data = fetch(a, f"/api/activity-photos/{p['id']}")
ck(s == 200 and b'ZZTestPhoneMaker' not in data and b'Exif' not in data, 'owner sees it, without the original details')
ck(fetch(a, f"/api/activity-photos/{p['id']}?size=thumb")[0] == 200, 'thumbnail')
ck(fetch(b, f"/api/activity-photos/{p['id']}")[0] == 404, 'private activity: others get 404')
ck(b.delete(f"/api/activity-photos/{p['id']}")[0] == 404, "someone else can't remove it")
ck(a.get(f'/api/activities/{aid}')[1]['photos'] == [p], 'activity page lists it')
ck(any(x['id'] == aid and x['photos'] == [p] for x in a.get('/api/activities?limit=50')[1]), 'your list has it')
a.put(f'/api/activities/{aid}/sharing', {'visibility': 'everyone'})
ck(fetch(b, f"/api/activity-photos/{p['id']}")[0] == 200, 'shared with everyone: others see it')
s, sh = b.get(f'/api/shared/{aid}'); ck(s == 200 and sh['photos'] == [p] and sh['owner']['photo'] == v, f'shared activity has photos + owner photo {sh.get("photos")}')
b.post(f'/api/activities/{aid}/cheer')
s, soc = a.get(f'/api/activities/{aid}/social')
ck(any(x['login'] == 'zz_test_ph_b' for x in soc['cheers']), 'who sent cheers is listed')
a.put(f'/api/activities/{aid}/sharing', {'visibility': 'friends'})
ck(fetch(b, f"/api/activity-photos/{p['id']}")[0] == 404, 'friends only, not friends: 404 again')
for i in range(9): a.post(f'/api/activities/{aid}/photos', {'image': JPG})
s, r = a.post(f'/api/activities/{aid}/photos', {'image': JPG}); ck(s == 400 and '10' in r['detail'], f'11th photo refused {s} {r}')
ck(a.delete(f"/api/activity-photos/{p['id']}")[0] == 200, 'owner removes one')
ck(fetch(a, f"/api/activity-photos/{p['id']}")[0] == 404, 'gone')
ck(len(a.get(f'/api/activities/{aid}')[1]['photos']) == 9, 'nine left')
s, r = a.delete(f'/api/activities/{aid}'); ck(s == 200, 'delete the activity: its photos go with it')

# a reported profile photo: the admin can take it down
s, r = c.post('/api/reports', {'login': 'zz_test_ph_a', 'reason': 'inappropriate'}); ck(s == 200, f'report person {s} {r}')
rep = next(x for x in admin.get('/api/admin/reports')[1] if x['id'] == r['id'])
ck(rep['photo'] == v, 'admin sees which photo')
ck(review_decision(admin, r['id'], 'remove_photo')[0] == 200, 'admin removes it')
ck(a.get('/api/me')[1].get('photo') is None and fetch(c, '/api/people/zz_test_ph_a/photo')[0] == 404, 'profile photo gone')
ck(a.put('/api/me/photo', {'image': JPG})[0] == 200 and a.delete('/api/me/photo')[0] == 200 and a.get('/api/me')[1].get('photo') is None, 'remove your own')

for x in (a, b, c): x.post('/api/account/delete', {'password': PW})
print(f'photos: {n} checks passed')
