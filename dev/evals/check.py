"""Contract checks for the metric/gate implementation, not a paid AI benchmark."""
import copy
from cases import cases
from scoring import aggregate, compare, score

fixtures = cases()
assert len(fixtures) == 300 and len({x['id'] for x in fixtures}) == 300
observations = []
for case in fixtures:
    truth = case['expected']
    observations.append({'id': case['id'], 'response': {'items': [{'name': truth['names'][0], 'amount': f'{truth["grams"]} g',
        **{k: truth[k] for k in ('grams', 'kcal', 'protein_g', 'carbs_g', 'fat_g')}}]}, 'latency_ms': 100, 'cost_usd': .001})
baseline = aggregate(fixtures, observations)
assert compare(baseline, baseline)['passed']
for mutate in ('calories', 'protein', 'product', 'serving', 'schema', 'latency', 'cost'):
    candidate = copy.deepcopy(observations)
    for row in candidate:
        item = row['response']['items'][0]
        if mutate == 'calories': item['kcal'] += 1000
        elif mutate == 'protein': item['protein_g'] += 100
        elif mutate == 'product': item['name'] = 'Wrong product'
        elif mutate == 'serving': item['grams'] *= 2
        elif mutate == 'schema': item['kcal'] = 'not a number'
        elif mutate == 'latency': row['latency_ms'] *= 3
        elif mutate == 'cost': row['cost_usd'] *= 3
    assert not compare(baseline, aggregate(fixtures, candidate))['passed'], mutate
for value in (float('nan'), float('inf'), -1, True):
    bad = copy.deepcopy(observations[0]); bad['response']['items'][0]['kcal'] = value
    assert score(fixtures[0], bad)['schema_failure']
try: aggregate(fixtures, observations[:-1])
except ValueError: pass
else: raise AssertionError('Skipped cases must fail')
print('AI evaluation contracts: 300 reference cases; nutrition/product/serving/schema/latency/cost regression gates passed. No model called.')
