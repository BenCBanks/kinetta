"""Friend search by name or username (api_social.people_search). Leaves zz_test_cook and zz_test_rachel friends."""
from kc import Client, person
a, b = person('zz_test_cook'), person('zz_test_rachel', 'Test Rachel')
b.delete('/api/friends/zz_test_cook')
n = 0
def ck(c, m):
    global n
    assert c, m; n += 1
s, r = a.get('/api/people/search?q=r'); ck(s == 200 and r == [], 'one letter: nothing')
s, r = a.get('/api/people/search?q=rach'); ck([p['login'] for p in r] == ['zz_test_rachel'] and r[0]['status'] is None and set(r[0]) == {'login', 'name', 'photo', 'status'}, f'by first name {r}')
s, r = a.get('/api/people/search?q=Test%20R'); ck(len(r) == 1, 'by full name')
s, r = a.get('/api/people/search?q=zz_test'); ck('zz_test_rachel' in [p['login'] for p in r] and 'zz_test_cook' not in [p['login'] for p in r], f'by username, never yourself {r}')
s, r = a.get('/api/people/search?q=%25'); ck(r == [], f'% is literal {r}')
s, r = a.get('/api/people/search?q=__'); ck(r == [], f'_ is literal {r}')
a.post('/api/friends', {'login': 'zz_test_rachel'})
ck(a.get('/api/people/search?q=rachel')[1][0]['status'] == 'sent', 'sent')
ck(b.get('/api/people/search?q=cook')[1][0]['status'] == 'incoming', 'incoming')
b.post('/api/friends/zz_test_cook/accept')
ck(b.get('/api/people/search?q=cook')[1][0]['status'] == 'friends', 'friends')
s, r = a.get('/api/activities?limit=1'); ck(s == 200, 'list ok')
c = Client(); s, r = c.get('/api/people/search?q=rach'); ck(s == 401, f'needs login {s}')
print(f'search: {n} checks passed')
