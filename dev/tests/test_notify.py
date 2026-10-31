"""Notifications (notify.py): who gets told what, repeats, things that are undone, and phone sign-up checks."""
from kc import person

n1, n2, n3 = person('zz_test_note1'), person('zz_test_note2'), person('zz_test_note3')
n = 0


def ck(cond, m):
    global n
    assert cond, m; n += 1


def notes(c):
    s, r = c.get('/api/notifications'); assert s == 200, r
    return r


for c in (n1, n2, n3): c.post('/api/notifications/read')
n2.delete('/api/friends/zz_test_note1'); n1.delete('/api/friends/zz_test_note2')
base1 = len(notes(n1)['items'])

# friend request -> declined -> gone; asked again -> accepted -> the asker is told
n2.post('/api/friends', {'login': 'zz_test_note1'})
r = notes(n1); ck(r['unread'] == 1 and r['items'][0]['kind'] == 'friend_request' and r['items'][0]['text'] == 'Note2 Test wants to be friends', f'request {r["items"][:1]}')
ck(r['items'][0]['link'] == '/me/friends' and set(r['items'][0]['who']) == {'login', 'name', 'photo'}, 'link and only name, username + photo')
ck(n1.get('/api/me')[1]['notifications'] == 1 and n1.get('/api/notifications/count')[1]['unread'] == 1, 'counts')
n1.post('/api/friends/zz_test_note2/decline')
ck(notes(n1)['unread'] == 0, 'declined: the request notification goes')
n2.post('/api/friends', {'login': 'zz_test_note1'}); n1.post('/api/friends/zz_test_note2/accept')
ck(notes(n1)['unread'] == 0, 'accepted: the request notification goes')
r = notes(n2); ck(r['items'][0]['kind'] == 'friend_accepted' and r['items'][0]['text']=='You and Note1 Test are now friends', 'asker told')

# cheers: once per person and activity, even after un-cheering; comments with a snippet; deleting removes it
s, a = n1.post('/api/activities/manual', {'sport': 'run', 'start': '2026-10-01T07:00', 'duration_s': 1800, 'distance_m': 5000})
aid = a['id']; n1.put(f'/api/activities/{aid}/sharing', {'visibility': 'friends'})
n1.post('/api/notifications/read')
n2.post(f'/api/activities/{aid}/cheer'); n2.delete(f'/api/activities/{aid}/cheer'); n2.post(f'/api/activities/{aid}/cheer')
r = notes(n1); ck([i['kind'] for i in r['items'] if not i['read']] == ['cheer'], f'one cheer {r["items"][:3]}')
ck(r['items'][0]['link'] == f'/activity/{aid}' and 'cheered your' in r['items'][0]['text'], 'cheer text')
s, cm = n2.post(f'/api/activities/{aid}/comments', {'text': 'Nice pace <b>today</b>!'})
r = notes(n1); ck(r['items'][0]['kind'] == 'comment' and r['items'][0]['text'].endswith(': "Nice pace <b>today</b>!"'), f'comment {r["items"][0]}')
n1.post(f'/api/activities/{aid}/comments', {'text': 'Thanks'})
ck(notes(n1)['items'][0]['kind'] == 'comment' and 'Note2' in notes(n1)['items'][0]['text'], 'your own comment tells no one (you)')
ck(not any(i['kind'] == 'comment' for i in notes(n2)['items'] if not i['read']), 'other commenters are not told (yet)')
n2.delete(f"/api/comments/{cm['comments'][-1]['id']}")
ck(not any('Nice pace' in i['text'] for i in notes(n1)['items']), 'deleted comment: its notification goes')

# a shared dish
s, d = n1.post('/api/dishes', {'name': 'Test note soup'})
n1.post(f"/api/dishes/{d['id']}/share", {'login': 'zz_test_note2'}); n1.post(f"/api/dishes/{d['id']}/share", {'login': 'zz_test_note2'})
r = notes(n2); ck([i['kind'] for i in r['items'] if not i['read']].count('dish_shared') == 1 and r['items'][0]['text'] == 'Note1 Test shared Test note soup with you', 'dish shared once')

# read; privacy; deleting the activity takes its notifications
ck(n1.post('/api/notifications/read')[1]['unread'] == 0 and notes(n1)['unread'] == 0, 'all read')
ck(not any(i['link'] == f'/activity/{aid}' for i in notes(n3)['items']), "nobody else sees them")
n1.delete(f'/api/activities/{aid}'); n1.delete(f"/api/dishes/{d['id']}")
ck(not any(i['link'] == f'/activity/{aid}' for i in notes(n1)['items']), 'activity deleted: notifications go')
ck(not any(i['kind'] == 'dish_shared' for i in notes(n2)['items']), 'dish deleted: notifications go')

# Browser delivery is retired. Native registration requires a bearer login and validates device addresses.
ck(n1.get('/api/push/key')[0] == 410, 'browser push key retired')
ck(n1.post('/api/push/subscribe', {'endpoint': 'https://web.push.apple.com/test'})[0] == 410, 'browser signup retired')
ck(n1.post('/api/push/ios', {'token': 'ab' * 32, 'environment': 'production'})[0] == 400, 'cookie-only registration rejected')
s, app_login = n1.post('/api/login', {'login': 'zz_test_note1', 'password': 'green teapot on the hill', 'app': True})
n1.op.addheaders = [('Authorization', 'Bearer ' + app_login['token'])]
ck(n1.post('/api/push/ios', {'token': 'invalid-device', 'environment': 'production'})[0] == 422, 'invalid native token rejected')
ck(n1.post('/api/push/ios', {'token': 'ab' * 32, 'environment': 'arbitrary-host'})[0] == 422, 'native environment allowlist')
ck(n1.post('/api/push/ios', {'token': 'ab' * 32, 'environment': 'production'})[0] == 200, 'native device registered')
ck(n1.delete('/api/push/ios')[0] == 200, 'native device disabled for this session')
s, r = n1.put('/api/notifications/settings', {'cheers': False})
ck(r['push'] == {'friends': True, 'cheers': False, 'comments': True, 'dishes': True, 'activities': True, 'milestones': False, 'challenge_joins': False, 'challenge_reminders': False, 'challenge_finished': False}, 'settings')
n1.put('/api/notifications/settings', {'cheers': True})
# A workout typed in by hand is never congratulated: you just did it yourself. (Workouts that arrive by
# themselves are covered in incontainer.py, with Health/Garmin sources.)
import datetime as dt
recent = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).isoformat()
payload = {'sport': 'run', 'start': recent, 'name': 'Test afternoon run', 'duration_s': 1800, 'distance_m': 5000}
s, a = n1.post('/api/activities/manual', payload); ck(s == 200, f'recent activity {a}')
aid = a['id']
ck(not any(i['kind'] == 'activity_ready' for i in notes(n1)['items']), 'typed-in workout: no alert, nothing under the bell')
n1.put('/api/notifications/settings', {'activities': False})
ck(notes(n1)['push']['activities'] is False, 'new-workout alerts have their own off switch')
n1.put('/api/notifications/settings', {'activities': True})
n1.delete(f'/api/activities/{aid}')
print(f'notifications: {n} checks passed')
