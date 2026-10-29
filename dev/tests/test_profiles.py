"""Directory/profile/gear privacy on an isolated server with disposable accounts only."""
import datetime as dt
import json
from kc import Client, PW, person
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

n = 0


def check(condition, message):
    global n
    assert condition, message
    n += 1


owner, viewer = person('zz_test_profile_owner', 'Profile Owner'), person('zz_test_profile_viewer', 'Profile Viewer')


def request(client, method, path, body=None, expected=200):
    status, result = client.req(method, path, body)
    check(status == expected, f'{method} {path}: {status} {result}')
    return result


try:
    start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=5)
    ids = []
    for i, visibility in enumerate(('me', 'friends', 'everyone', 'everyone')):
        activity = request(owner, 'POST', '/api/activities/manual', {'sport': 'run', 'start': (start + dt.timedelta(hours=i)).isoformat(), 'duration_s': 600, 'distance_m': 1000, 'name': f'Profile fixture {i}', 'avg_hr': 145})
        ids.append(activity['id'])
        request(owner, 'PUT', f"/api/activities/{activity['id']}/sharing", {'visibility': visibility})
    request(owner, 'PUT', '/api/profile', {'weight_kg': 70, 'max_hr': 190})
    request(owner, 'PUT', '/api/account', {'name': 'Profile Owner', 'bio': 'Both saved together'})
    check(request(owner, 'GET', '/api/me')['bio'] == 'Both saved together', 'profile name and bio edit in one transaction')
    request(owner, 'PUT', '/api/account', {'name': 'Should not save', 'bio': 'x' * 281}, expected=422)
    check(request(owner, 'GET', '/api/me')['name'] == 'Profile Owner', 'invalid bio does not partially save name')
    bio = '<script>not markup</script> Runner & cyclist'
    request(owner, 'PUT', '/api/profile', {'bio': bio})
    check(request(owner, 'GET', '/api/me')['bio'] == bio, 'owner reads their bio')
    request(viewer, 'PUT', '/api/profile', {'bio': 'Viewer bio'})
    check(request(owner, 'GET', '/api/me')['bio'] == bio, 'bio edits cannot change another profile')
    request(owner, 'PUT', '/api/profile', {'bio': 'x' * 281}, expected=422)
    rows = request(viewer, 'GET', '/api/people/search?q=')
    check(len(rows)<=20 and all(row['login']!='zz_test_profile_viewer' for row in rows),'default discovery is bounded and excludes the viewer')
    check(any(row['login']=='zz_test_profile_owner' for row in request(viewer,'GET','/api/people/search?q=zz_test_profile_owner')),'specific discovery finds the profile even in a larger directory')
    check(all(set(row) == {'login', 'name', 'photo', 'status'} for row in rows), 'directory contains identity/relationship only')
    request(viewer, 'GET', '/api/people/search?q=' + 'a' * 61, expected=422)
    profile = request(viewer, 'GET', '/api/people/zz_test_profile_owner/profile?limit=1')
    check(profile['person']['bio'] == bio, 'profile exposes public bio as literal text')
    check(sum(r['distance_m'] for r in profile['mileage']['days']) == 2000, 'distance chart excludes private and friends-only activities')
    check(len(profile['mileage']['days']) == 14, 'chart zero-fills fixed periods')
    check(profile['sports'] == [{'sport': 'run', 'activities': 2, 'distance_m': 2000, 'time_s': 1200}], 'sport summaries use visible workouts only')
    check(profile['overview'] == {'activities': 2, 'distance_m': 2000, 'time_s': 1200, 'active_days': len({(start+dt.timedelta(hours=i)).astimezone(ZoneInfo(request(viewer,'GET','/api/me')['tz'])).date() for i in (2,3)})}, 'overview excludes private and friends-only workouts')
    check(profile['items'][0]['id'] == ids[-1] and profile['next'], 'newest shared activity and cursor')
    next_page = request(viewer, 'GET', '/api/people/zz_test_profile_owner/profile?limit=1&' + urlencode(profile['next']))
    check([row['id'] for row in next_page['items']] == [ids[-2]] and next_page['next'] is None, 'profile pagination does not duplicate or skip')
    for field in ('weight_kg', 'max_hr', 'avg_hr', 'private_note', 'source_id', 'user_id', 'gear_id', 'ai_note'):
        check(field not in json.dumps(profile), f'profile never leaks {field}')
    request(Client(), 'GET', '/api/people/zz_test_profile_owner/profile', expected=401)
    request(viewer, 'GET', '/api/people/zz_test_nonexistent/profile', expected=404)
    request(viewer, 'POST', '/api/friends', {'login': 'zz_test_profile_owner'})
    request(owner, 'POST', '/api/friends/zz_test_profile_viewer/accept')
    profile = request(viewer, 'GET', '/api/people/zz_test_profile_owner/profile')
    check(profile['overview']['activities'] == 3 and profile['status'] == 'friends', 'approved friend gets only additional friends activities')
    own = request(owner, 'GET', '/api/people/zz_test_profile_owner/profile')
    check(own['mine'] and own['overview']['activities'] == 4, 'own profile normally lists every own activity')
    preview = request(owner, 'GET', '/api/people/zz_test_profile_owner/profile?as_friend=true')
    check(sum(r['distance_m'] for r in profile['mileage']['days']) == 3000, 'chart includes accepted friend activities')
    check(preview['mileage'] == profile['mileage'], 'chart own friend preview matches actual friend')
    check(preview['overview'] == profile['overview'] and [a['id'] for a in preview['items']] == [a['id'] for a in profile['items']],
          'own profile "as friends see it" matches what a friend actually sees')
    other = request(viewer, 'GET', '/api/people/zz_test_profile_owner/profile?as_friend=true')
    check(other['overview'] == profile['overview'], 'as_friend changes nothing on someone else\'s profile')
    request(viewer, 'POST', '/api/people/zz_test_profile_owner/block')
    request(viewer, 'GET', '/api/people/zz_test_profile_owner/profile', expected=404)
    request(owner, 'GET', '/api/people/zz_test_profile_viewer/profile', expected=404)
    check(request(viewer, 'GET', '/api/people/search?q=zz_test_profile_owner') == [], 'blocked accounts absent from exact search')
    request(viewer, 'DELETE', '/api/people/zz_test_profile_owner/block')
    request(owner, 'PUT', '/api/sharing', {'findable': False})
    check(not any(row['login'] == 'zz_test_profile_owner' for row in request(viewer, 'GET', '/api/people/search?q=Profile')), 'discovery respects search opt-out')
    check(any(row['login'] == 'zz_test_profile_owner' for row in request(viewer, 'GET', '/api/people/search?q=zz_test_profile_owner')), 'exact username still discoverable as before')
    gear = request(owner, 'POST', '/api/gear', {'kind': 'shoe', 'name': 'Profile fixture shoes'})['id']
    request(owner, 'PATCH', f'/api/activities/{ids[0]}', {'gear_id': gear})
    request(viewer, 'DELETE', f'/api/gear/{gear}', expected=404)
    request(owner, 'DELETE', f'/api/gear/{gear}')
    kept = request(owner, 'GET', f'/api/activities/{ids[0]}')
    check(kept['gear_id'] is None and kept['distance_m'] == 1000 and kept['moving_s'] == 600, 'gear deletion preserves activity and clears link')
finally:
    for client in (owner, viewer):
        client.post('/api/account/delete', {'password': PW})

print(f'Public profiles/directory/gear: {n} checks passed')
