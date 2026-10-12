"""Dishes (api_dishes.py): parser, ingredients, weight, one serving vs a portion, logging, who may do what."""
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
check('create: by servings, makes 1', s == 200 and d['name'] == 'Test chicken stew' and d['named'] and d['items'] == [] and d['serving'] == 'one' and d['servings'] == 1 and 'status' not in d, d)
did = d['id']
s, d2 = b.post('/api/dishes', {'meal': 'dinner'})       # older phones still send the meal
check('create unnamed', s == 200 and d2['name'] == 'New dish' and not d2['named'], d2)
check('name too long 422', b.post('/api/dishes', {'name': 'x' * 81})[0] == 422)
# Start a new dish again reopens the empty one instead of making another; empty ones stay off the list
s, d3 = b.post('/api/dishes', {})
check('empty dish reused', s == 200 and d3['id'] == d2['id'], (d2['id'], d3.get('id')))
lst = [x['id'] for x in b.get('/api/dishes')[1]]
check('empty dish hidden, named one shown', d2['id'] not in lst and did in lst, lst)

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
check('weight is the ingredients added up', d['weight_g'] == 677 and d['items_g'] == 677 and not d['weighed'] and d['per_100g']['kcal'] == 147.9, d)

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
check('bad serving -> 422', b.patch(f'/api/dishes/{did}', {'serving': 'some'})[0] == 422)
check('servings 0 -> 422', b.patch(f'/api/dishes/{did}', {'servings': 0})[0] == 422)
check('pans are gone', b.get('/api/dishes/pans')[0] in (404, 405) and b.patch(f'/api/dishes/{did}', {'gross_g': 2000})[1]['cooked_g'] is None)

# a portion is one of grams, a share or a count
check('grams and share -> 400', b.post(f'/api/dishes/{did}/portion', {'grams': 100, 'share': .5, 'meal': 'dinner'})[0] == 400)
check('grams and count -> 400', b.post(f'/api/dishes/{did}/portion', {'grams': 100, 'count': 1, 'meal': 'dinner'})[0] == 400)
check('neither -> 400', b.post(f'/api/dishes/{did}/portion', {'meal': 'dinner'})[0] == 400)
check('share > 1 -> 422', b.post(f'/api/dishes/{did}/portion', {'share': 1.5, 'meal': 'dinner'})[0] == 422)
check('count 0 -> 422', b.post(f'/api/dishes/{did}/portion', {'count': 0, 'meal': 'dinner'})[0] == 422)

# ---- the weight: typed over, back to the sum ----
s, d = b.patch(f'/api/dishes/{did}', {'cooked_g': 1000})
check('typed weight wins', s == 200 and d['cooked_g'] == 1000 and d['weight_g'] == 1000 and d['weighed'] and d['items_g'] == 677, d)
check('per_100g', d['per_100g']['kcal'] == 100.2, d['per_100g'])
s, d = b.patch(f'/api/dishes/{did}', {'cooked_g': 677})
check('typing the sum = not weighed', d['cooked_g'] is None and not d['weighed'] and d['weight_g'] == 677, d)
s, d = b.patch(f'/api/dishes/{did}', {'cooked_g': 1000})

# ---- log a portion (any number of times: nothing runs out) ----
s, r = b.post(f'/api/dishes/{did}/portion', {'grams': 350, 'meal': 'dinner', 'day': '2026-10-11'})
check('portion', s == 200 and set(r) == {'entry'}, r)
e = r['entry']
check('entry values', e['name'] == 'Test chicken stew' and e['amount'] == 350 and e['unit'] == 'g' and e['source'] == 'dish'
      and abs(e['kcal'] - 350.5) < .2 and abs(e['protein_g'] - 44.2) < .2 and e['ref']['dish_id'] == did and e['ref']['weight_g'] == 1000, e)
day = b.get('/api/food/day?d=2026-10-11')[1]
check('in food log', any(x['id'] == e['id'] and x['meal'] == 'dinner' and x['source'] == 'dish' for x in day['entries']), day['entries'])
for i in range(3): s, r = b.post(f'/api/dishes/{did}/portion', {'grams': 600, 'meal': 'lunch'})
check('more than the whole dish over time is fine', s == 200 and r['entry']['day'], r)
check('still on the list', did in [x['id'] for x in b.get('/api/dishes')[1]])
s, r = b.post(f'/api/dishes/{did}/portion', {'share': .25, 'of': 4, 'meal': 'dinner'})
check('a share is grams when there is a weight', s == 200 and r['entry']['amount'] == 250 and r['entry']['unit'] == 'g' and abs(r['entry']['kcal'] - 250.4) < .2, r)
check('the 4 is remembered', b.get(f'/api/dishes/{did}')[1]['servings'] == 4)
b.patch(f'/api/food/entries/{e["id"]}', {'amount': 200, 'kcal': 200})
check('editing an entry leaves the dish alone', b.get(f'/api/dishes/{did}')[1]['weight_g'] == 1000)

# ---- one serving (a smoothie) ----
s, sm = b.post('/api/dishes', {'name': 'Test smoothie'}); smid = sm['id']
b.post(f'/api/dishes/{smid}/items', {'name': 'Banana', 'grams': 120, 'per100': {'kcal': 89, 'protein_g': 1.1, 'carbs_g': 23, 'fat_g': .3}})
s, sm = b.patch(f'/api/dishes/{smid}', {'serving': 'one'})
check('one serving', s == 200 and sm['serving'] == 'one', sm)
s, r = b.post(f'/api/dishes/{smid}/portion', {'count': 1, 'meal': 'breakfast'})
check('logged whole', s == 200 and r['entry']['amount'] == 1 and r['entry']['unit'] == 'serving' and r['entry']['kcal'] == 106.8, r)
s, r = b.post(f'/api/dishes/{smid}/portion', {'count': 1.5, 'meal': 'snacks'})
check('one and a half', s == 200 and r['entry']['amount'] == 1.5 and r['entry']['kcal'] == 160.2, r)
s, sm = b.patch(f'/api/dishes/{smid}', {'serving': 'portion'})
check('and back', sm['serving'] == 'portion')
# a pot by servings: makes 4, so 1 serving is a quarter and 1½ is three eighths
s, pot = b.patch(f'/api/dishes/{did}', {'serving': 'one', 'servings': 4})
check('makes 4', pot['serving'] == 'one' and pot['servings'] == 4, pot)
s, r = b.post(f'/api/dishes/{did}/portion', {'count': 1, 'meal': 'dinner'})
check('1 serving of 4 = a quarter', s == 200 and r['entry']['unit'] == 'serving' and abs(r['entry']['kcal'] - 1001.5 / 4) < .2, r)
s, r = b.post(f'/api/dishes/{did}/portion', {'count': 1.5, 'meal': 'dinner'})
check('1½ servings of 4', abs(r['entry']['kcal'] - 1001.5 * 1.5 / 4) < .2, r)
b.patch(f'/api/dishes/{did}', {'serving': 'portion'})

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
# a typed-in total with no weight: shares only
s, k2 = b.post('/api/dishes', {'name': 'Test pie'}); k2id = k2['id']
s, k2 = b.patch(f'/api/dishes/{k2id}', {'known_kcal': 2000, 'known_protein_g': 80})
check('no weight', k2['weight_g'] is None, k2)
check('grams need a weight', b.post(f'/api/dishes/{k2id}/portion', {'grams': 100, 'meal': 'dinner'})[0] == 400)
s, r = b.post(f'/api/dishes/{k2id}/portion', {'share': .25, 'meal': 'dinner'})
check('share of a dish without weight', s == 200 and r['entry']['unit'] == 'dish' and r['entry']['amount'] == .25 and r['entry']['kcal'] == 500, r)

# ---- another person can't touch it ----
for name, (s, _) in {'get': a.get(f'/api/dishes/{kid}'), 'patch': a.patch(f'/api/dishes/{kid}', {'name': 'Hacked'}),
                     'item add': a.post(f'/api/dishes/{kid}/items', {'name': 'X', 'grams': 10, 'kcal': 1}),
                     'item del': a.delete(f'/api/dishes/{kid}/items/{k["items"][0]["id"]}'),
                     'portion': a.post(f'/api/dishes/{kid}/portion', {'grams': 10, 'meal': 'lunch'}),
                     'delete': a.delete(f'/api/dishes/{kid}')}.items():
    check(f'other person {name} -> 404', s == 404, s)
check('other list empty of hers', kid not in [y['id'] for y in a.get('/api/dishes')[1]])
check('still hers', b.get(f'/api/dishes/{kid}')[1]['name'] == 'Test lasagne 2')
check('not logged in -> 401', Client().get('/api/dishes')[0] == 401)

# ---- 60 ingredients max ----
s, m = b.post('/api/dishes', {'name': 'Test big'})
for i in range(60): b.post(f'/api/dishes/{m["id"]}/items', {'name': f'Thing {i}', 'grams': 1, 'kcal': 1})
check('61st item -> 400', b.post(f'/api/dishes/{m["id"]}/items', {'name': 'More', 'grams': 1, 'kcal': 1})[0] == 400)

# ---- delete keeps logged entries; old recipe routes are gone ----
check('delete dish', b.delete(f'/api/dishes/{kid}')[0] == 200 and b.get(f'/api/dishes/{kid}')[0] == 404)
check('entries kept', any(x['name'] == 'Test lasagne' for x in b.get('/api/food/day')[1]['entries']))
check('no finish or recipes any more', b.post(f'/api/dishes/{did}/finish', {})[0] in (404, 405) and b.get('/api/dishes/recipes')[0] in (404, 405, 422))
check('list: yours, most recently changed first', [x['id'] for x in b.get('/api/dishes')[1]][:2] == [m['id'], k2id], [x['name'] for x in b.get('/api/dishes')[1]])

print(f'cooking: {ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
