"""Offline scoring and baseline comparison. Synthetic contract tests are never model accuracy claims."""
import math
import statistics


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0: raise ValueError('Invalid number')
    return float(value)


def score(case, observation):
    out = {'id': case['id'], 'kind': case['kind'], 'schema_failure': False}
    try:
        items = observation['response']['items']
        if not isinstance(items, list) or not 1 <= len(items) <= 30: raise ValueError('Invalid items')
        for item in items:
            if not isinstance(item.get('name'), str) or not item['name'].strip(): raise ValueError('Missing product')
            if not isinstance(item.get('amount'), str) or not item['amount'].strip(): raise ValueError('Missing portion')
            for key in ('kcal', 'protein_g', 'carbs_g', 'fat_g'): number(item[key])
        kcal = sum(number(i['kcal']) for i in items); protein = sum(number(i['protein_g']) for i in items)
        expected = case['expected']
        out['kcal_error'] = abs(kcal - expected['kcal'])
        out['protein_error_g'] = abs(protein - expected['protein_g'])
        out['large_error'] = out['kcal_error'] > max(250, expected['kcal'] * .5) or out['protein_error_g'] > max(25, expected['protein_g'] * .5)
        names = {i['name'].strip().casefold() for i in items}
        out['product_correct'] = all(n.casefold() in names for n in expected['names'])
        grams = sum(number(i['grams']) for i in items) if all(i.get('grams') is not None for i in items) else None
        out['serving_correct'] = grams is not None and abs(grams - expected['grams']) <= max(1, expected['grams'] * .05)
    except (KeyError, TypeError, ValueError, OverflowError):
        out.update(schema_failure=True, large_error=True, product_correct=False, serving_correct=False)
    out['latency_ms'] = number(observation['latency_ms']) if observation.get('latency_ms') is not None else None
    out['cost_usd'] = number(observation['cost_usd']) if observation.get('cost_usd') is not None else None
    return out


def aggregate(cases, observations):
    ids = [o['id'] for o in observations]
    if len(set(ids)) != len(ids) or set(ids) != {c['id'] for c in cases}: raise ValueError('Every case needs exactly one observation')
    by_id = {o['id']: o for o in observations}
    rows = [score(c, by_id[c['id']]) for c in cases]
    n = len(rows)
    if not n: raise ValueError('No cases')
    known = lambda key: [r[key] for r in rows if key in r and r[key] is not None]
    latency = sorted(known('latency_ms'))
    costs = known('cost_usd')
    result = {'cases': n, 'schema_failure_rate': sum(r['schema_failure'] for r in rows) / n,
              'large_error_rate': sum(r['large_error'] for r in rows) / n,
              'product_accuracy': sum(r['product_correct'] for r in rows) / n,
              'serving_accuracy': sum(r['serving_correct'] for r in rows) / n,
              'kcal_mae': statistics.mean(known('kcal_error')) if known('kcal_error') else None,
              'protein_mae_g': statistics.mean(known('protein_error_g')) if known('protein_error_g') else None,
              'latency_p95_ms': latency[max(0, math.ceil(.95 * len(latency)) - 1)] if len(latency) == n else None,
              'total_cost_usd': sum(costs) if len(costs) == n else None}
    result['by_kind'] = {kind: {'cases': sum(r['kind'] == kind for r in rows),
                              'large_error_rate': sum(r['large_error'] for r in rows if r['kind'] == kind) / sum(r['kind'] == kind for r in rows)}
                         for kind in sorted({r['kind'] for r in rows})}
    return result


def compare(baseline, candidate):
    failures = []
    for key in ('schema_failure_rate', 'large_error_rate'):
        if candidate[key] > baseline[key]: failures.append(key)
    for key in ('product_accuracy', 'serving_accuracy'):
        if candidate[key] < baseline[key]: failures.append(key)
    for key in ('kcal_mae', 'protein_mae_g'):
        if baseline[key] is None or candidate[key] is None or candidate[key] > max(baseline[key] * 1.05, baseline[key] + .1): failures.append(key)
    for key in ('latency_p95_ms', 'total_cost_usd'):
        if baseline[key] is None or candidate[key] is None: failures.append(key + '_missing')
        elif candidate[key] > baseline[key] * 1.2: failures.append(key)
    for kind, values in baseline['by_kind'].items():
        if kind not in candidate['by_kind'] or candidate['by_kind'][kind]['cases'] != values['cases'] or candidate['by_kind'][kind]['large_error_rate'] > values['large_error_rate']:
            failures.append('kind:' + kind)
    return {'passed': not failures, 'regressions': failures}
