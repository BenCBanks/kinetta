"""Cooking mode in plain words (2026-10-12): '2 apples' style messages, answered from what the person used before
without AI; with no AI the app is told to search instead. The AI side is tested in incontainer.py with a stand-in."""
import sys
from kc import person

ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print('FAIL', name, extra)

p = person('zz_test_cookchat')
for d in p.get('/api/dishes')[1]:
    if d.get('mine') is not False: p.delete(f"/api/dishes/{d['id']}")
did = p.post('/api/dishes', {'name': 'Test apple crumble'})[1]['id']

# parse: plural search and a typical weight for counts and spoons
r = p.post('/api/dishes/parse', {'text': '2 apples'})[1]
check('apples -> apple, about 360 g', r['search'] == 'apple' and r['guess_g'] == 360 and r['grams'] is None, r)
check('1 tbsp guessed', p.post('/api/dishes/parse', {'text': '1 tbsp olive oil'})[1]['guess_g'] == 14)
check('weights need no guess', p.post('/api/dishes/parse', {'text': '200 g rice'})[1]['guess_g'] is None)

# teach it once (as if picked from search, with the amount as said), then plain words are free
apple = {'kcal': 52, 'protein_g': 0.3, 'carbs_g': 13.8, 'fat_g': 0.2, 'fiber_g': 2.4}
s, d = p.post(f'/api/dishes/{did}/items', {'name': 'Apple', 'grams': 180, 'per100': apple, 'source': 'usda'})
check('first apple', s == 200 and len(d['items']) == 1, d)
s, r = p.post(f'/api/dishes/{did}/say', {'text': '300 g apples'})
check('known food by weight: no AI', s == 200 and r.get('by') == 'memory' and r['dish']['items'][-1]['grams'] == 300, r)
check('values per 100 g kept', abs(r['dish']['items'][-1]['kcal'] - 156) < 0.5, r['dish']['items'][-1])
check('reply says what was added', 'apple' in r['reply'] and r['added'] == [r['dish']['items'][-1]['id']], r['reply'])
s, r = p.post(f'/api/dishes/{did}/say', {'text': 'two apples'})
check('a count needs a known size: asks', s == 200 and (r.get('fallback') or r.get('by') == 'ai'), r)

# several pieces in one message
s, r = p.post(f'/api/dishes/{did}/say', {'text': '100 g apple and 50 g apple'})
check('several at once', s == 200 and r.get('by') == 'memory' and len(r['added']) == 2, r)
s, r = p.post(f'/api/dishes/{did}/say', {'text': 'salt and pepper'})
check('unknown: search (or AI)', s == 200 and (r.get('fallback') or r.get('by') == 'ai'), r)
check('empty refused', p.post(f'/api/dishes/{did}/say', {'text': ''})[0] == 422)
check('too long refused', p.post(f'/api/dishes/{did}/say', {'text': 'x' * 601})[0] == 422)
q = person('zz_test_cookchat2')
check("someone else's dish: 404", q.post(f'/api/dishes/{did}/say', {'text': '100 g apples'})[0] == 404)

p.delete(f'/api/dishes/{did}')
print(f'cook chat: {ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
