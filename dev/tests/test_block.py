"""Blocking and reporting (api_social: blocks, reports; App Store guideline 1.2). Made-up zz_test people only.
Leaves no friendship, block or open report behind."""
from kc import ALEX, login, person
a, b, c = person('zz_test_blk_a'), person('zz_test_blk_b'), person('zz_test_blk_c')
admin = login(*ALEX)
for x, y in ((a, 'zz_test_blk_b'), (b, 'zz_test_blk_a'), (a, 'zz_test_blk_c')):
    x.delete(f'/api/people/{y}/block'); x.delete(f'/api/friends/{y}')
n = 0
def ck(cond, m):
    global n
    assert cond, m; n += 1

# a shares one run with everyone and one with friends; b and a are friends; b comments and cheers
s, r1 = a.post('/api/activities/manual', {'sport': 'run', 'start': '2026-10-02T07:00', 'duration_s': 1800, 'distance_m': 5000}); ck(s == 200, f'run {s} {r1}')
s, r2 = a.post('/api/activities/manual', {'sport': 'run', 'start': '2026-10-03T07:00', 'duration_s': 1800, 'distance_m': 5000}); ck(s == 200, 'run 2')
e, f = r1['id'], r2['id']
a.put(f'/api/activities/{e}/sharing', {'visibility': 'everyone'}); a.put(f'/api/activities/{f}/sharing', {'visibility': 'friends'})
a.post('/api/friends', {'login': 'zz_test_blk_b'}); b.post('/api/friends/zz_test_blk_a/accept')
ck(b.get(f'/api/shared/{f}')[0] == 200, 'friend sees friends-only run')
s, soc = b.post(f'/api/activities/{e}/comments', {'text': 'zz test comment'}); cid = soc['comments'][-1]['id']
b.post(f'/api/activities/{e}/cheer')
ck(len(c.get(f'/api/shared/{e}')[1]['social']['comments']) >= 1, 'c sees the comment on an everyone run')

# reporting: only what you can see, only the right person, reasons checked
s, r = c.post('/api/reports', {'login': 'zz_test_blk_b', 'comment_id': cid, 'reason': 'abuse', 'note': 'zz test'}); ck(s == 200, f'report comment {s} {r}')
rep_c = r['id']
ck(c.post('/api/reports', {'login': 'zz_test_blk_a', 'comment_id': cid, 'reason': 'spam'})[0] == 404, 'comment by someone else: 404')
ck(c.post('/api/reports', {'login': 'zz_test_blk_a', 'activity_id': f, 'reason': 'spam'})[0] == 404, "an activity you can't see: 404")
ck(c.post('/api/reports', {'login': 'zz_test_blk_b', 'activity_id': e, 'reason': 'spam'})[0] == 404, 'activity of someone else: 404')
ck(c.post('/api/reports', {'login': 'zz_test_blk_a', 'activity_id': e, 'reason': 'nope'})[0] == 422, 'unknown reason: 422')
ck(c.post('/api/reports', {'login': 'zz_test_blk_c', 'reason': 'spam'})[0] == 400, 'not yourself')
s, r = c.post('/api/reports', {'login': 'zz_test_blk_a', 'activity_id': e, 'reason': 'inappropriate'}); ck(s == 200, 'report activity'); rep_a = r['id']
ck(c.get('/api/reports')[0] == 403, 'reports list: admins only')
s, rows = admin.get('/api/reports'); mine = {x['id']: x for x in rows}
ck(rep_c in mine and 'zz test comment' in mine[rep_c]['what'] and mine[rep_c]['login'] == 'zz_test_blk_b', f'admin sees the comment report {rows}')
ck(any(x['kind'] == 'report' and x['who']['login'] == 'zz_test_blk_c' for x in admin.get('/api/notifications')[1]['items']), 'admin notified')
ck(c.post(f'/api/reports/{rep_c}/done?remove=true')[0] == 403, 'closing: admins only')
ck(admin.post(f'/api/reports/{rep_c}/done?remove=true')[0] == 200, 'admin removes the comment')
ck(all(x['id'] != cid for x in c.get(f'/api/shared/{e}')[1]['social']['comments']), 'comment gone')
ck(admin.post(f'/api/reports/{rep_a}/done?remove=true')[0] == 200, 'admin makes the activity private')
ck(c.get(f'/api/shared/{e}')[0] == 404, 'activity now private')
a.put(f'/api/activities/{e}/sharing', {'visibility': 'everyone'})
ck(rep_c not in {x['id'] for x in admin.get('/api/reports')[1]}, 'closed reports leave the list')

# blocking: b blocks a
s, soc = b.post(f'/api/activities/{e}/comments', {'text': 'zz second comment'})
ck(b.post('/api/people/zz_test_blk_a/block')[0] == 200, 'block')
ck(b.post('/api/people/zz_test_blk_b/block')[0] == 400, "can't block yourself")
ck('zz_test_blk_a' in [x['login'] for x in b.get('/api/blocks')[1]], 'listed under blocks')
ck('zz_test_blk_b' not in [x['login'] for x in a.get('/api/friends')[1]['friends']], 'no longer friends')
ck(b.get(f'/api/shared/{e}')[0] == 404, "blocker can't see the blocked person's everyone run")
ck(a.get('/api/people/search?q=zz_test_blk_b')[1] == [], 'blocked people vanish from search (their side)')
ck(b.get('/api/people/search?q=zz_test_blk_a')[1] == [], 'and from yours')
ck(a.post('/api/friends', {'login': 'zz_test_blk_b'})[0] == 404, "blocked person can't send a friend request")
ck(b.post('/api/friends', {'login': 'zz_test_blk_a'})[0] == 404, 'nor can the blocker')
s, sh = a.get(f'/api/shared/{e}')
ck(all(x['login'] != 'zz_test_blk_b' for x in sh['social']['comments']) and all(x['login'] != 'zz_test_blk_b' for x in sh['social']['cheers']), 'owner no longer sees comments and cheers from the blocker')
ck(any(x['login'] == 'zz_test_blk_b' for x in c.get(f'/api/shared/{e}')[1]['social']['comments']), 'others still do')
ck(b.post(f'/api/activities/{e}/cheer')[0] == 404, "can't cheer through a block")
s, s2 = b.post('/api/activities/manual', {'sport': 'run', 'start': '2026-10-04T07:00', 'duration_s': 1800, 'distance_m': 5000}); b.put(f"/api/activities/{s2['id']}/sharing", {'visibility': 'everyone'})
ck(a.get(f"/api/shared/{s2['id']}")[0] == 404, 'blocked person cannot see the blocker either')
ck(a.post(f"/api/activities/{s2['id']}/comments", {'text': 'x'})[0] == 404, 'nor comment')
ck(b.delete('/api/people/zz_test_blk_a/block')[0] == 200, 'unblock')
ck(b.get(f'/api/shared/{e}')[0] == 200 and a.get(f"/api/shared/{s2['id']}")[0] == 200, 'visible again after unblocking')

# tidy up: activities, friendships and reports go with the accounts' own deletion elsewhere; here just the activities
for x, i in ((a, e), (a, f), (b, s2['id'])): x.delete(f'/api/activities/{i}')
for x in admin.get('/api/reports')[1]:
    if x['login'].startswith('zz_test_blk'): admin.post(f"/api/reports/{x['id']}/done")
print(f'block and report: {n} checks passed')
