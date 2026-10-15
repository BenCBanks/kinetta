"""Describe what you ate: API contracts. Throwaway zz_test accounts, made-up foods, no AI providers."""
import sys
from concurrent.futures import ThreadPoolExecutor
from kc import Client, person, PW
ok = fail = 0
def check(label, condition, extra=''):
    global ok, fail
    if condition: ok += 1
    else: fail += 1; print('FAIL', label, extra)
a = person('zz_test_meal_chat_a'); b = person('zz_test_meal_chat_b')
R = '/api/food/meals-chat/resolve'; C = '/api/food/meals-chat/confirm'
DAY = '2026-10-10'

def resolve(say=None, parts=None, who=a):
    s, r = who.post(R, {'say': say, 'parts': parts or []}); check('resolve HTTP ' + str(say), s == 200, (s, r)); return r

def dish(client, name, weight=1000, kcal=2000):
    s, d = client.post('/api/dishes', {'name': name}); assert s == 200
    s, d = client.patch('/api/dishes/' + str(d['id']), {'known_kcal': kcal, 'known_protein_g': 100, 'known_carbs_g': 200, 'known_fat_g': 80, 'cooked_g': weight, 'serving': 'portion'})
    assert s == 200; return d

def logged(client, name, amount, unit, kcal, day='2026-09-01'):
    s, r = client.post('/api/food/entries', [{'day': day, 'meal': 'snacks', 'name': name, 'amount': amount, 'unit': unit, 'kcal': kcal, 'protein_g': 1, 'carbs_g': 2, 'fat_g': 3, 'source': 'quick'}])
    assert s == 200, r

def confirmation(r, **kw):
    return {'items': [{'kind': i['kind'], 'id': i['id'], 'portion': i['portion'], 'expected': i['expected']} for i in r['items'] if i['status'] == 'ready'],
            'issued': r['issued'], 'client_id': r['client_id'], 'day': DAY, 'meal': 'lunch', 'confirm': True, **kw}

def entries(day=DAY): return a.get('/api/food/day?d=' + day)[1]['entries']

pasta = dish(a, 'Garden pasta'); private = dish(b, 'Secret noodles'); mac = dish(a, 'Mac and cheese', 800, 1600)
logged(a, 'Diet Coke', 1, 'can', 1); logged(a, 'Eggs', 2, 'serving', 140); logged(a, 'Toast', 1, 'slice', 80); logged(a, 'Oat milk', 250, 'ml', 120)
s, food = a.post('/api/food/foods', {'name': 'Protein bar', 'serving_label': '1 bar', 'serving_g': 60, 'kcal': 200, 'protein_g': 20, 'carbs_g': 20, 'fat_g': 7})
assert s == 200

# the original example still works, now with the log day/meal read from the sentence
r = resolve('I had a 230 grams of the Garden pasta for lunch')
check('saved meal portion', r['status'] == 'ready' and r['items'][0]['id'] == pasta['id'] and r['meal'] == 'lunch', r)
check('stored nutrition arithmetic, not estimated', r['items'][0]['totals']['kcal'] == 460 and r['items'][0]['totals']['fiber_g'] is None, r)
check('resolve has no writes', not entries())
body = confirmation(r)
check('confirmation must be explicit', a.post(C, {**body, 'confirm': False})[0] == 400)
check('confirmation true is strict', a.post(C, {**body, 'confirm': 'true'})[0] == 422)
check('client nutrition rejected', a.post(C, {**body, 'kcal': 1})[0] == 422)
check('forged user rejected', a.post(R, {'say': 'pasta', 'user_id': private['id']})[0] == 422)
check('not authenticated', Client().post(R, {'say': 'pasta'})[0] == 401 and Client().post(C, body)[0] == 401)
check('other user cannot use preview', b.post(C, body)[0] == 404)
check('other person’s meal by id', a.post(R, {'parts': [{'text': 'noodles', 'pick': {'kind': 'dish', 'id': private['id']}}]})[1]['items'][0]['status'] == 'unknown')
check('other person’s meal by name', resolve('230 g Secret noodles')['items'][0]['status'] == 'unknown')
with ThreadPoolExecutor(max_workers=3) as pool: responses = list(pool.map(lambda _: a.post(C, body), range(3)))
check('concurrent retries return one entry', all(s == 200 for s, r in responses) and len({tuple(r['ids']) for s, r in responses}) == 1, responses)
e = entries()
check('one correct log entry', len(e) == 1 and e[0]['meal'] == 'lunch' and e[0]['amount'] == 230 and e[0]['unit'] == 'g' and e[0]['source'] == 'dish', e)
check('reused confirmation for a different meal rejected', a.post(C, {**body, 'meal': 'dinner'})[0] == 409)
a.patch('/api/dishes/' + str(pasta['id']), {'known_kcal': 3000})
check('lost answer retried after an edit returns the same entry', a.post(C, body)[0] == 200 and len(entries()) == 1)
r = resolve('300 grams of Garden pasta'); fresh = confirmation(r)
a.patch('/api/dishes/' + str(pasta['id']), {'known_kcal': 2500})
check('recipe change needs a new preview', a.post(C, fresh)[0] == 409)
r = resolve('300 grams of Garden pasta'); check('updated saved nutrition', r['items'][0]['totals']['kcal'] == 750, r)
tampered = confirmation(r); tampered['items'][0]['portion'] = {'grams': 400}
check('tampered amount rejected', a.post(C, tampered)[0] == 409)
check('expired preview rejected', a.post(C, {**confirmation(r), 'issued': r['issued'] - 901})[0] == 409)

# everyday phrasing (review findings): names with "and", a serving, a bowl, last time's amount, several foods at once
for say, kcal in [('0.23 kg Garden pasta', 575), ('half of the Garden pasta', 1250), ('a quarter of Garden pasta', 625),
                  ('three quarters of the garden pasta', 1875), ('Garden pasta 230 g', 575), ('230 g mac and cheese', 460)]:
    got = resolve(say); check('portion ' + say, got['status'] == 'ready' and got['items'][0]['totals']['kcal'] == kcal, got)
got = resolve('2 eggs and toast for breakfast')
check('two foods from history, amounts as logged', got['status'] == 'ready' and [i['name'] for i in got['items']] == ['Eggs', 'Toast']
      and got['items'][0]['totals']['kcal'] == 140 and got['items'][1]['totals']['kcal'] == 80 and got['meal'] == 'breakfast', got)
got = resolve('a diet coke and 4 eggs')
check('a = usual amount; 4 eggs = 4 servings', got['items'][0]['totals']['kcal'] == 1 and got['items'][1]['totals']['kcal'] == 280, got)
got = resolve('2 diet cokes')
check('plurals and counts in the unit used before', got['items'][0]['totals']['kcal'] == 2 and got["items"][0]["amount"] == "2 cans", got)
got = resolve('oat milk')
check('no amount = as last time', got['items'][0]['totals']['kcal'] == 120 and got['items'][0]['note'] == 'as last time', got)
got = resolve('2 protein bars')
check('My foods by servings', got['items'][0]['kind'] == 'custom' and got['items'][0]['totals']['kcal'] == 400, got)
got = resolve('a hot dog and a diet coke')
check('unknown food comes back for AI or search, the rest is found', [i['status'] for i in got['items']] == ['unknown', 'ready'] and got['items'][0]['text'] == 'a hot dog', got)
got = resolve('I had pasta last night')
check('last night = yesterday, dinner', got['meal'] == 'dinner' and got['day'] is not None, got)

# a saved meal never logged before, measured by weight: ask, with one-tap amounts; then "same as last time"
got = resolve('Mac and cheese')
check('asks how much, with quick amounts', got['items'][0]['status'] == 'quantity' and [o['label'] for o in got['items'][0]['options']] == ['All of it', 'Half', 'A quarter'], got)
parts = got['parts']; parts[0]['portion'] = got['items'][0]['options'][1]['portion']
got = resolve(None, parts)
check('quick amount', got['items'][0]['status'] == 'ready' and got['items'][0]['totals']['kcal'] == 800, got)
check('add it', a.post(C, confirmation(got))[0] == 200)
got = resolve('a bowl of mac and cheese')
check('a bowl = same as last time', got['items'][0]['status'] == 'ready' and got['items'][0]['totals']['kcal'] == 800 and got['items'][0]['note'] == 'same as last time', got)

# the conversation: corrections, removal, additions
got = resolve('Garden pasta and a diet coke')
parts = got['parts']
got = resolve('make the pasta 300 grams', parts)
check('named correction', got['items'][0]['totals']['kcal'] == 750 and got['items'][1]['totals']['kcal'] == 1, got)
got = resolve('remove the coke', got['parts'])
check('removal', len(got['items']) == 1 and got['items'][0]['name'] == 'Garden pasta', got)
got = resolve('also 2 eggs', got['parts'])
check('addition', [i['name'] for i in got['items']] == ['Garden pasta', 'Eggs'], got)
got = resolve('for dinner', got['parts'])
check('destination change keeps the foods', got['meal'] == 'dinner' and len(got['items']) == 2, got)
got = resolve('Garden pasta')
got = resolve('no, make it 300 grams', got['parts'])
check('amount-only correction', got['items'][0]['totals']['kcal'] == 750, got)
body = confirmation(resolve('2 eggs and toast'))
s, r = a.post(C, {**body, 'day': '2026-10-11'})
check('several foods in one confirmation', s == 200 and len(r['ids']) == 2 and len(entries('2026-10-11')) == 2, (s, r))

# choices, missing data, unsafe input
second = dish(a, 'Roasted pasta')
got = resolve('230 grams of pasta')
check('ambiguous names offer choices', got['items'][0]['status'] == 'choose' and {c['name'] for c in got['items'][0]['choices']} >= {'Garden pasta', 'Roasted pasta'}, got)
parts = got['parts']; parts[0]['pick'] = {'kind': 'dish', 'id': second['id']}
got = resolve(None, parts); check('explicit choice', got['items'][0]['status'] == 'ready' and got['items'][0]['id'] == second['id'], got)
no_weight = dish(a, 'Citrus pie', None)
got = resolve('230 g Citrus pie'); check('missing weight asks', got['items'][0]['status'] == 'quantity' and 'weight' in got['items'][0]['message'], got)
got = resolve('half of Citrus pie'); check('share works without weight', got['items'][0]['status'] == 'ready' and got['items'][0]['totals']['kcal'] == 1000, got)
for say in ['-230g pasta', '0 g pasta', '230g pasta tomorrow', 'two cups of my unrecorded curry']:
    got = a.post(R, {'say': say})[1]
    check('cannot log ' + say, got.get('status') == 'clarify' or all(i['status'] != 'ready' for i in got['items']), got)
check('bounded input', a.post(R, {'say': 'x' * 401})[0] == 422)
check('too many parts rejected', a.post(R, {'parts': [{'text': 'eggs'}] * 13})[0] == 422)
check('nonfinite amount rejected', a.post(R, {'parts': [{'text': 'eggs', 'portion': {'grams': 'Infinity'}}]})[0] in (400, 422))
check('two portion kinds rejected', a.post(R, {'parts': [{'text': 'eggs', 'portion': {'grams': 230, 'count': 1}}]})[0] == 400)
check('cleanup a', a.post('/api/account/delete', {'password': PW})[0] == 200)
check('cleanup b', b.post('/api/account/delete', {'password': PW})[0] == 200)
print(f'meal chat API: {ok} passed, {fail} failed'); sys.exit(bool(fail))
