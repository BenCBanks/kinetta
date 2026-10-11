"""Cooking mode (api_dishes.py): parser, ingredients, weighing, portions, leftovers, pans, who may do what."""
import sys
from kc import Client, person

ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print('FAIL', name, extra)

a, b = person('zz_test_cook'), person('zz_test_rachel', 'Test Rachel')

# ---- parser ----
P = {
    '100 g chicken': (100, 'g', 100, 'chicken'), '250 grams of carrots': (250, 'g', 250, 'carrots'),
    '1.5 kg potatoes': (1.5, 'kg', 1500, 'potatoes'), '2 tbsp olive oil': (2, 'tbsp', None, 'olive oil'),
    '8 oz salmon': (8, 'oz', 226.8, 'salmon'), 'chicken 100g': (100, 'g', 100, 'chicken'),
    '1,5 kg potatoes': (1.5, 'kg', 1500, 'potatoes'), '1,500 g rice': (1500, 'g', 1500, 'rice'),
    '1 1/2 lb beef': (1.5, 'lb', 680.4, 'beef'), '½ cup rice': (0.5, 'cup', None, 'rice'),
    '1½ cups milk': (1.5, 'cup', None, 'milk'), '500ml milk': (500, 'ml', 500, 'milk'),
    '2 eggs': (2, None, None, 'eggs'), 'salt': (None, None, None, 'salt'), '3 lemons': (3, None, None, 'lemons'),
    'chicken breast, 250 g': (250, 'g', 250, 'chicken breast'), 'olive oil 2 tbsp': (2, 'tbsp', None, 'olive oil'),
    '2 cloves garlic, minced': (2, 'clove', None, 'garlic'), '1 l stock': (1, 'l', 1000, 'stock'),
    'about 200 g pasta (dry)': (200, 'g', 200, 'pasta'), '8oz. salmon fillet': (8, 'oz', 226.8, 'salmon fillet'),
    '1/2 tsp salt': (0.5, 'tsp', None, 'salt'), 'Chicken Thighs 400 G': (400, 'g', 400, 'chicken thighs'),
    '2 lbs ground beef': (2, 'lb', 907.2, 'ground beef'), '1 cup of rice': (1, 'cup', None, 'rice'),
    '100g': (100, 'g', 100, ''), '3 kilos onions': (3, 'kg', 3000, 'onions'), '16 ounces spinach': (16, 'oz', 453.6, 'spinach'),
}
for text, (amt, unit, g, q) in P.items():
    s, r = b.post('/api/dishes/parse', {'text': text})
    got = (r.get('amount'), r.get('unit'), r.get('grams'), r.get('query')) if s == 200 else r
    check(f'parse {text!r}', s == 200 and got == (amt, unit, g, q), got)
check('parse empty -> 422', b.post('/api/dishes/parse', {'text': ''})[0] == 422)
check('parse too long -> 422', b.post('/api/dishes/parse', {'text': 'x' * 201})[0] == 422)

# ---- a dish with 3 ingredients ----
s, d = b.post('/api/dishes', {'name': 'Test chicken stew'})
check('create', s == 200 and d['name'] == 'Test chicken stew' and d['status'] == 'cooking' and d['items'] == [], d)
did = d['id']
s, d2 = b.post('/api/dishes', {})
check('create default name', s == 200 and d2['name'] in ('Breakfast', 'Lunch', 'Dinner'), d2)
check('name too long 422', b.post('/api/dishes', {'name': 'x' * 81})[0] == 422)

s, d = b.post(f'/api/dishes/{did}/items', {'name': 'Chicken breast', 'grams': 400,
                                          'per100': {'kcal': 165, 'protein_g': 31, 'carbs_g': 0, 'fat_g': 3.6, 'fiber_g': 0},
                                          'source': 'usda', 'ref': {'id': '171077'}})
check('item per100', s == 200 and d['items'][0]['kcal'] == 660 and d['items'][0]['protein_g'] == 124, d)
s, d = b.post(f'/api/dishes/{did}/items', {'name': 'Carrots', 'grams': 250, 'per100': {'kcal': 41, 'protein_g': 0.9, 'carbs_g': 9.6, 'fat_g': 0.2, 'fiber_g': 2.8}})
check('item 2', s == 200 and d['items'][1]['kcal'] == 102.5, d)
s, d = b.post(f'/api/dishes/{did}/items', {'name': 'Olive oil', 'grams': 27, 'kcal': 239, 'fat_g': 27})
check('item typed totals', s == 200 and d['items'][2]['kcal'] == 239 and d['items'][2]['per100']['kcal'] == 885.185, d)
oil = d['items'][2]['id']
check('totals', d['totals'] == {'kcal': 1001.5, 'protein_g': 126.2, 'carbs_g': 24.0, 'fat_g': 41.9, 'fiber_g': 7.0}, d['totals'])
check('no per_100g before weighing', d['per_100g'] is None and d['left_g'] is None)

# rescale + delete an item
s, d = b.patch(f'/api/dishes/{did}/items/{oil}', {'grams': 13.5})
check('rescale item', s == 200 and d['items'][2]['kcal'] == 119.5 and d['items'][2]['grams'] == 13.5, d['items'][2])
s, d = b.patch(f'/api/dishes/{did}/items/{oil}', {'grams': 27})
check('rescale back', d['totals']['kcal'] == 1001.5, d['totals'])
s, d = b.post(f'/api/dishes/{did}/items', {'name': 'Salt', 'grams': 2, 'kcal': 0})
check('add 4th', s == 200 and len(d['items']) == 4)
s, d = b.delete(f'/api/dishes/{did}/items/{d["items"][3]["id"]}')
check('delete item', s == 200 and len(d['items']) == 3)
check('delete missing item 404', b.delete(f'/api/dishes/{did}/items/deadbeef')[0] == 404)

# validation
check('grams 0 -> 422', b.post(f'/api/dishes/{did}/items', {'name': 'X', 'grams': 0, 'kcal': 1})[0] == 422)
check('grams 20000 -> 422', b.post(f'/api/dishes/{did}/items', {'name': 'X', 'grams': 20000, 'kcal': 1})[0] == 422)
check('no nutrition -> 400', b.post(f'/api/dishes/{did}/items', {'name': 'X', 'grams': 10})[0] == 400)
check('impossible kcal -> 400', b.post(f'/api/dishes/{did}/items', {'name': 'X', 'grams': 10, 'kcal': 500})[0] == 400)
check('per100 kcal > 1000 -> 422', b.post(f'/api/dishes/{did}/items', {'name': 'X', 'grams': 10, 'per100': {'kcal': 4000}})[0] == 422)
check('no name -> 422', b.post(f'/api/dishes/{did}/items', {'grams': 10, 'kcal': 1})[0] == 422)
check('rescale 0 -> 422', b.patch(f'/api/dishes/{did}/items/{oil}', {'grams': 0})[0] == 422)
check('bad meal -> 422', b.post(f'/api/dishes/{did}/portion', {'grams': 100, 'meal': 'brunch'})[0] == 422)
check('cooked_g 0 -> 422', b.patch(f'/api/dishes/{did}', {'cooked_g': 0})[0] == 422)

# portion before weighing
s, r = b.post(f'/api/dishes/{did}/portion', {'grams': 100, 'meal': 'dinner'})
check('portion needs cooked_g', s == 400 and 'Weigh' in r['detail'], r)

# ---- pans + cooked weight ----
s, pan = b.post('/api/dishes/pans', {'name': 'Big pot', 'grams': 1250})
check('pan add', s == 200 and pan['grams'] == 1250, pan)
check('pan list', [p['name'] for p in b.get('/api/dishes/pans')[1]] == ['Big pot'])
check('pan bad -> 422', b.post('/api/dishes/pans', {'name': 'X', 'grams': -1})[0] == 422)
check('gross less than pan -> 400', b.patch(f'/api/dishes/{did}', {'gross_g': 1200, 'pan_id': pan['id']})[0] == 400)
s, d = b.patch(f'/api/dishes/{did}', {'gross_g': 2250, 'pan_id': pan['id']})
check('cooked = gross - pan', s == 200 and d['cooked_g'] == 1000 and d['left_g'] == 1000, d)
check('per_100g', d['per_100g']['kcal'] == 100.2, d['per_100g'])
check('cooked_g + gross_g -> 400', b.patch(f'/api/dishes/{did}', {'gross_g': 2250, 'cooked_g': 5})[0] == 400)

# ---- a portion ----
s, r = b.post(f'/api/dishes/{did}/portion', {'grams': 350, 'meal': 'dinner', 'day': '2026-10-11'})
check('portion', s == 200, r)
e = r['entry']
check('entry values', e['name'] == 'Test chicken stew' and e['amount'] == 350 and e['unit'] == 'g' and e['source'] == 'dish'
      and abs(e['kcal'] - 350.5) < .2 and abs(e['protein_g'] - 44.2) < .2 and e['ref']['dish_id'] == did and e['ref']['cooked_g'] == 1000, e)
check('dish after portion', r['dish']['eaten_g'] == 350 and r['dish']['left_g'] == 650 and r['dish']['status'] == 'leftovers' and r['dish']['done_at'], r['dish'])
day = b.get('/api/food/day?d=2026-10-11')[1]
check('in food log', any(x['id'] == e['id'] and x['meal'] == 'dinner' and x['source'] == 'dish' for x in day['entries']), day['entries'])
check('food log totals', abs(sum(x['kcal'] for x in day['entries'] if (x.get('ref') or {}).get('dish_id') == did) - 350.5) < .2, day['totals'])
check('list shows leftovers', any(x['id'] == did and x['left_g'] == 650 for x in b.get('/api/dishes')[1]))
check('list newest first', [x['id'] for x in b.get('/api/dishes')[1]][:2] == [d2['id'], did])

# second portion, default day (today), refuse too large
s, r = b.post(f'/api/dishes/{did}/portion', {'grams': 300, 'meal': 'lunch'})
check('second portion', s == 200 and r['dish']['left_g'] == 350 and r['entry']['day'], r)
s, r = b.post(f'/api/dishes/{did}/portion', {'grams': 400, 'meal': 'lunch'})
check('too large -> 400', s == 400 and '350 g' in r['detail'], r)
check('snack portion within 5% slack', b.post(f'/api/dishes/{did}/portion', {'grams': 360, 'meal': 'snacks', 'day': '2026-10-12'})[0] == 200)
s, r = b.get(f'/api/dishes/{did}')
check('fully eaten', r['left_g'] == 0 and r['status'] == 'finished', r)
check('gone from list when eaten', did not in [x['id'] for x in b.get('/api/dishes')[1]])
check('portion of empty dish -> 400', b.post(f'/api/dishes/{did}/portion', {'grams': 10, 'meal': 'lunch'})[0] == 400)
check('done false after portions -> 400', b.patch(f'/api/dishes/{did}', {'done': False})[0] == 400)

# ---- known_kcal override (from a recipe) ----
s, k = b.post('/api/dishes', {'name': 'Test lasagne'})
kid = k['id']
check('portion with nothing -> 400', b.patch(f'/api/dishes/{kid}', {'cooked_g': 1200})[0] == 200
      and b.post(f'/api/dishes/{kid}/portion', {'grams': 100, 'meal': 'dinner'})[0] == 400)
s, k = b.patch(f'/api/dishes/{kid}', {'known_kcal': 2400, 'known_protein_g': 120})
check('known totals', s == 200 and k['totals']['kcal'] == 2400 and k['totals']['protein_g'] == 120 and k['totals']['fat_g'] == 0
      and k['totals']['fiber_g'] is None and k['per_100g']['kcal'] == 200, k)
s, k = b.post(f'/api/dishes/{kid}/items', {'name': 'Pasta sheets', 'grams': 250, 'per100': {'kcal': 350, 'carbs_g': 70, 'protein_g': 12}})
check('known kcal wins over items', k['totals']['kcal'] == 2400 and k['totals']['carbs_g'] == 175 and k['totals']['protein_g'] == 120, k['totals'])
s, r = b.post(f'/api/dishes/{kid}/portion', {'grams': 300, 'meal': 'dinner'})
check('known portion', s == 200 and r['entry']['kcal'] == 600 and r['entry']['protein_g'] == 30, r)
s, k = b.patch(f'/api/dishes/{kid}', {'known_kcal': None, 'name': 'Test lasagne 2'})
check('null clears known', k['totals']['kcal'] == 875 and k['known']['kcal'] is None and k['name'] == 'Test lasagne 2', k)
check('empty name -> 422', b.patch(f'/api/dishes/{kid}', {'name': ''})[0] == 422)
check('blank name -> 400', b.patch(f'/api/dishes/{kid}', {'name': '   '})[0] == 400)

# ---- done flag (closed without portions), cooking list ----
s, x = b.patch(f'/api/dishes/{d2["id"]}', {'done': True})
check('close', s == 200 and x['done_at'] and x['status'] == 'finished')
check('closed unweighed dish hidden', d2['id'] not in [y['id'] for y in b.get('/api/dishes')[1]])
s, x = b.patch(f'/api/dishes/{d2["id"]}', {'done': False})
check('reopen', s == 200 and x['status'] == 'cooking' and d2['id'] in [y['id'] for y in b.get('/api/dishes')[1]])

# ---- another person can't touch it ----
for name, (s, _) in {'get': a.get(f'/api/dishes/{kid}'), 'patch': a.patch(f'/api/dishes/{kid}', {'name': 'Hacked'}),
                     'item add': a.post(f'/api/dishes/{kid}/items', {'name': 'X', 'grams': 10, 'kcal': 1}),
                     'item del': a.delete(f'/api/dishes/{kid}/items/{k["items"][0]["id"]}'),
                     'portion': a.post(f'/api/dishes/{kid}/portion', {'grams': 10, 'meal': 'lunch'}),
                     'delete': a.delete(f'/api/dishes/{kid}'), 'pan del': a.delete(f'/api/dishes/pans/{pan["id"]}'),
                     'gross with their pan': (a.patch(f'/api/dishes/{a.post("/api/dishes", {})[1]["id"]}', {'gross_g': 3000, 'pan_id': pan['id']})[0], 0)}.items():
    check(f'other person {name} -> 404', s == 404, s)
check('other list empty of hers', kid not in [y['id'] for y in a.get('/api/dishes')[1]])
check('other pans empty', a.get('/api/dishes/pans')[1] == [])
check('still hers', b.get(f'/api/dishes/{kid}')[1]['name'] == 'Test lasagne 2')
check('not logged in -> 401', Client().get('/api/dishes')[0] == 401)

# ---- 60 ingredients max ----
s, m = b.post('/api/dishes', {'name': 'Test big'})
for i in range(60): b.post(f'/api/dishes/{m["id"]}/items', {'name': f'Thing {i}', 'grams': 1, 'kcal': 1})
check('61st item -> 400', b.post(f'/api/dishes/{m["id"]}/items', {'name': 'More', 'grams': 1, 'kcal': 1})[0] == 400)

# ---- delete keeps logged entries ----
check('delete dish', b.delete(f'/api/dishes/{kid}')[0] == 200 and b.get(f'/api/dishes/{kid}')[0] == 404)
check('entries kept', any(x['name'] == 'Test lasagne' for x in b.get('/api/food/day')[1]['entries']))
check('pan delete', b.delete(f'/api/dishes/pans/{pan["id"]}')[0] == 200 and b.get('/api/dishes/pans')[1] == [])
check('route /pans not swallowed by /{id}', b.get('/api/dishes/pans')[0] == 200 and b.get('/api/dishes/abc')[0] in (404, 405))

print(f'cooking: {ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
