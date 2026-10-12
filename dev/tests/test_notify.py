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
r = notes(n2); ck(r['items'][0]['kind'] == 'friend_accepted' and 'Note1 Test accepted' in r['items'][0]['text'], 'asker told')

# cheers: once per person and activity, even after un-cheering; comments with a snippet; deleting removes it
s, a = n1.post('/api/activities/manual', {'sport': 'run', 'start': '2026-10-01T07:00', 'duration_s': 1800, 'distance_m': 5000})
aid = a['id']; n1.put(f'/api/activities/{aid}/sharing', {'visibility': 'friends'})
n1.post('/api/notifications/read')
n2.post(f'/api/activities/{aid}/cheer'); n2.delete(f'/api/activities/{aid}/cheer'); n2.post(f'/api/activities/{aid}/cheer')
r = notes(n1); ck([i['kind'] for i in r['items'] if not i['read']] == ['cheer'], f'one cheer {r["items"][:3]}')
ck(r['items'][0]['link'] == f'/activity/{aid}' and 'sent cheers on your' in r['items'][0]['text'], 'cheer text')
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

# phone notifications: the key, sign-up checks, settings
s, k = n1.get('/api/push/key'); ck(s == 200 and len(k['key']) > 80, 'push key')
ck(n1.post('/api/push/subscribe', {'endpoint': 'http://insecure.example/x', 'keys': {'p256dh': 'x' * 87, 'auth': 'y' * 22}})[0] == 422, 'https only')
ck(n1.post('/api/push/subscribe', {'endpoint': 'https://fcm.googleapis.com/fcm/send/abc', 'keys': {'p256dh': 'x'}})[0] == 400, 'needs both keys')
for bad in ('https://push.example/abc', 'https://192.168.1.10/x', 'https://localhost:8123/api', 'https://fcm.googleapis.com.evil.example/x',
            'https://user@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x'):
    ck(n1.post('/api/push/subscribe', {'endpoint': bad, 'keys': {'p256dh': 'x' * 87, 'auth': 'y' * 22}})[0] == 400, f'not a push service: {bad}')
for good in ('https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QOx', 'https://updates.push.services.mozilla.com/wpush/v2/x'):
    ck(n1.post('/api/push/subscribe', {'endpoint': good, 'keys': {'p256dh': 'x' * 87, 'auth': 'y' * 22}})[0] == 200, f'subscribe {good}')
s, r = n1.put('/api/notifications/settings', {'cheers': False}); ck(r['push'] == {'friends': True, 'cheers': False, 'comments': True, 'dishes': True}, 'settings')
n1.put('/api/notifications/settings', {'cheers': True})
ck(all(n1.post('/api/push/unsubscribe', {'endpoint': e})[0] == 200 for e in ('https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QOx', 'https://updates.push.services.mozilla.com/wpush/v2/x')), 'unsubscribe')
ck(n3.get('/api/notifications')[0] == 200 and person('zz_test_note3').get('/api/push/key')[0] == 200, 'others fine')
print(f'notifications: {n} checks passed')
