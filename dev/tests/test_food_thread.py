"""Fictional private thread: durable retries, pagination, account scope and explicit preferences."""
import concurrent.futures
import datetime as dt
import io
import json
import urllib.request
import uuid
import zipfile
from kc import BASE, PW, Client, login, person

checks = 0

def check(condition, name):
    global checks
    assert condition, name
    checks += 1


a, b = person('zz_test_thread_a'), person('zz_test_thread_b')
for client in (a, b):
    for message in client.get('/api/food/thread?limit=100')[1]['messages']:
        client.delete('/api/food/thread/messages/' + str(message['id']))
check(Client().get('/api/food/thread')[0] == 401, 'history requires sign in')
check(Client().post('/api/food/thread/messages', {'client_id': str(uuid.uuid4()), 'body': 'Fictional oats'})[0] == 401, 'append requires sign in')
check(a.get('/api/food/thread/preferences')[1] == {'auto_log': True, 'tone': 'supportive'}, 'owner-decided defaults')
check(a.put('/api/profile', {'tz': 'America/New_York'})[0] == 200, 'fictional capture timezone')
before = a.get('/api/me')[1]
key = str(uuid.uuid4())
body = {'client_id': key, 'body': '  Fictional oats and yogurt  ', 'captured_at': '2026-10-16T02:30:00+00:00'}
s, first = a.post('/api/food/thread/messages', body)
check(s == 201 and first['created'], 'new message acknowledged once')
m = first['message']; mid = m['id']
check(m['body'] == body['body'].strip() and m['state'] == 'pending' and m['entries'] == [], 'pending text is durable, no food mutation')
check(m['local_day'] == '2026-10-15' and dt.datetime.fromisoformat(m['captured_at']) == dt.datetime.fromisoformat(body['captured_at']), 'offline capture time survives arrival in another day')
s, replay = a.post('/api/food/thread/messages', body)
check(s == 200 and not replay['created'] and replay['message'] == m, 'lost acknowledgement replay is idempotent')
check(a.post('/api/food/thread/messages', {**body, 'body': 'Different text'})[0] == 409, 'identity cannot replace a different message')
check(b.get('/api/food/thread')[1]['messages'] == [], 'another account sees no messages')
check(b.delete('/api/food/thread/messages/' + str(mid))[0] == 404, 'another account cannot delete')
check(b.post('/api/food/thread/messages', body)[0] == 201, 'same client identity is separate per account')
check(a.get('/api/me')[1] == before, 'opening/appending do not save targets or other profile settings')
for malformed in ({'body': 'missing ID'}, {'client_id': key, 'body': ' '}, {'client_id': key, 'body': 'x' * 4001},
                  {'client_id': key, 'body': 'data:image/png;base64,fictional'}, {**body, 'user_id': 123},
                  {**body, 'kind': 'reply'}, {**body, 'result': {'kcal': 1}}, {**body, 'captured_at': '2026-10-16T02:30:00'}):
    check(a.post('/api/food/thread/messages', malformed)[0] == 422, 'bounded text-only server-controlled input')
for path in ('?limit=0', '?limit=101', '?before=0'):
    check(a.get('/api/food/thread' + path)[0] == 422, 'bounded history pagination')
for i in range(5):
    check(a.post('/api/food/thread/messages', {'client_id': str(uuid.uuid4()), 'body': f'Fictional meal {i}'})[0] == 201, 'append history')
rows = a.get('/api/food/thread?limit=3')[1]
check(len(rows['messages']) == 3 and rows['has_more'], 'newest page bounded')
older = a.get('/api/food/thread?limit=3&before=' + str(rows['before']))[1]
check(len(older['messages']) == 3 and not older['has_more'], 'older page complete')
ids = [r['id'] for r in older['messages'] + rows['messages']]
check(ids == sorted(set(ids)) and ids[0] == mid, 'ascending display and no page overlap')
# Separate real login sessions race the same durable identity.
retry_key = str(uuid.uuid4())
clients = [login('zz_test_thread_a') for _ in range(4)]
with concurrent.futures.ThreadPoolExecutor(4) as pool:
    replies = list(pool.map(lambda c: c.post('/api/food/thread/messages', {'client_id': retry_key, 'body': 'Fictional retry soup'}), clients))
check(sum(status == 201 for status, _ in replies) == 1 and len({r['message']['id'] for _, r in replies}) == 1, 'concurrent retry stores one message')
check(a.put('/api/food/thread/preferences', {'auto_log': False})[1] == {'auto_log': False, 'tone': 'supportive'}, 'explicit require-tap setting')
check(a.put('/api/food/thread/preferences', {'tone': 'numbers'})[1] == {'auto_log': False, 'tone': 'numbers'}, 'explicit tone setting preserves auto-log')
for value in ({}, {'tone': None}, {'auto_log': 'false'}, {'tone': 'shaming'}, {'user_id': 1}):
    check(a.put('/api/food/thread/preferences', value)[0] == 422, 'invalid settings do not write')
check(b.get('/api/food/thread/preferences')[1] == {'auto_log': True, 'tone': 'supportive'}, 'preferences are account scoped')
with a.op.open(urllib.request.Request(BASE + '/api/account/export')) as response:
    z = zipfile.ZipFile(io.BytesIO(response.read()))
exported = [json.loads(row) for row in z.read('data/food_chat_messages.jsonl').splitlines()]
check(len(exported) == 7 and all('user_id' not in row for row in exported), 'all and only own messages exported without internal owner field')
check('data/food_chat_entries.jsonl' in z.namelist(), 'food links included in export')
check(a.delete('/api/food/thread/messages/' + str(mid))[1] == {'deleted': True, 'food_kept': True}, 'individual message deletion explicit food retention')
check(mid not in [r['id'] for r in a.get('/api/food/thread')[1]['messages']], 'deleted message absent after reload')
check(b.get('/api/food/thread')[1]['messages'][0]['body'] == body['body'].strip(), 'deletion leaves other account alone')
check(a.post('/api/account/delete', {'password': PW})[0] == 200, 'account deletion')
check(a.get('/api/food/thread')[0] == 401, 'account deletion revokes access')
b.post('/api/account/delete', {'password': PW})
print(f'food thread storage: {checks} checks passed; fictional data, no provider calls')
