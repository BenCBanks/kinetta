"""Sharing a dish with friends, and "Let people find me by name". Runs after test_search.py (cook and rachel are friends)."""
from kc import person
a, b, c = person('zz_test_cook'), person('zz_test_rachel', 'Test Rachel'), person('zz_test_other', 'Test Other')
n = 0
def ck(cond, m):
    global n
    assert cond, m; n += 1
# --- findable ---
ck(a.get('/api/sharing')[1]['findable'] is True, 'findable by default')
ck([p['login'] for p in c.get('/api/people/search?q=test%20r')[1]] == ['zz_test_rachel'], 'other finds rachel')
s, _ = b.put('/api/sharing', {'findable': False}); ck(s == 200, 'turn off')
ck(c.get('/api/people/search?q=test%20r')[1] == [], f"hidden from strangers {c.get('/api/people/search?q=test%20r')[1]}")
ck([p['login'] for p in c.get('/api/people/search?q=zz_test_rachel')[1]] == ['zz_test_rachel'], 'exact username still works')
ck([p['login'] for p in a.get('/api/people/search?q=test%20r')[1]] == ['zz_test_rachel'], 'friends still find her')
b.put('/api/sharing', {'findable': True})
# --- sharing a dish ---
s, d = a.post('/api/dishes', {'name': 'Test chili'}); did = d['id']; ck(d['mine'] and d['shared_with'] == [], 'new dish mine')
a.post(f'/api/dishes/{did}/items', {'name': 'Beans', 'grams': 800, 'per100': {'kcal': 100, 'protein_g': 7, 'carbs_g': 18, 'fat_g': 0.5}})
ck(b.get(f'/api/dishes/{did}')[0] == 404, 'not shared yet: 404')
s, _ = a.post(f'/api/dishes/{did}/share', {'login': 'zz_test_other'}); ck(s == 404, f'only friends {s}')
s, d = a.post(f'/api/dishes/{did}/share', {'login': 'zz_test_rachel'}); ck(s == 200 and [p['login'] for p in d['shared_with']] == ['zz_test_rachel'], 'shared')
s, d = b.get(f'/api/dishes/{did}'); ck(s == 200 and d['mine'] is False and d['owner']['login'] == 'zz_test_cook' and 'shared_with' not in d, f'friend sees it {d.get("owner")}')
ck(any(x['id'] == did for x in b.get('/api/dishes')[1]), 'in friend list')
ck(c.get(f'/api/dishes/{did}')[0] == 404, 'others still 404')
for m, p, body in [('patch', f'/api/dishes/{did}', {'name': 'x'}), ('post', f'/api/dishes/{did}/items', {'name': 'x', 'grams': 1, 'kcal': 1}),
                   ('delete', f'/api/dishes/{did}', None), ('post', f'/api/dishes/{did}/share', {'login': 'zz_test_cook'})]:
    st = (getattr(b, m)(p, body) if body is not None else getattr(b, m)(p))[0]; ck(st == 404, f'friend cannot {m} {p}: {st}')
ck(b.get(f'/api/dishes/{did}')[1]['weight_g'] == 800, 'friend sees the ingredients added up before it is weighed')
ck(b.post(f'/api/dishes/{did}/finish', {})[0] == 404 and b.post(f'/api/dishes/{did}/recipe')[0] == 404, 'only the cook finishes or saves it')
a.patch(f'/api/dishes/{did}', {'cooked_g': 1000})
s, r = b.post(f'/api/dishes/{did}/portion', {'grams': 250, 'meal': 'dinner'}); ck(s == 200 and r['entry']['kcal'] == 200 and r['dish']['left_g'] == 750, f'friend portion {r}')
day = b.get('/api/food/day')[1]; ck(any(e['source'] == 'dish' and e['kcal'] == 200 for e in day['entries']), 'in friend food log')
ck(not any(e['source'] == 'dish' and e['kcal'] == 200 for e in a.get('/api/food/day')[1]['entries']), 'not in cook food log')
s, r = a.post(f'/api/dishes/{did}/portion', {'grams': 300, 'meal': 'dinner'}); ck(r['dish']['left_g'] == 450, 'shared leftovers')
s, _ = b.post(f'/api/dishes/{did}/portion', {'grams': 600, 'meal': 'lunch'}); ck(s == 400, 'too big for leftovers')
s, _ = b.delete(f'/api/dishes/{did}/share/zz_test_cook'); ck(s == 404, 'friend cannot unshare others')
s, _ = b.delete(f'/api/dishes/{did}/share/zz_test_rachel'); ck(s == 200 and b.get(f'/api/dishes/{did}')[0] == 404, 'friend hides it')
a.post(f'/api/dishes/{did}/share', {'login': 'zz_test_rachel'}); a.delete(f'/api/dishes/{did}/share/zz_test_rachel'); ck(b.get(f'/api/dishes/{did}')[0] == 404, 'cook unshares')
a.post(f'/api/dishes/{did}/share', {'login': 'zz_test_rachel'}); a.delete(f'/api/dishes/{did}'); ck(b.get('/api/dishes')[1] == [] or all(x['id'] != did for x in b.get('/api/dishes')[1]), 'delete removes shares')

print(f'share: {n} checks passed')
