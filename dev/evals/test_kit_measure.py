"""Fake-clock traces test contracts, never model speed, billing or accuracy."""
import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from kit_measure import collect, summarize


def fixture():
    # Clock starts at a nonzero monotonic offset; raw provider bytes are not visible text.
    events = [('start', 500, {}),
              ('attempt', 510, {'id': 1, 'round': 1, 'retry': False, 'reserved_microusd': 20_000}),
              ('usage', 700, {'id': 1, 'input_tokens': 1000, 'output_tokens': 40,
                              'thinking_tokens': 60, 'charged_microusd': 2250}),
              ('tool', 710, {}),
              ('attempt', 720, {'id': 2, 'round': 2, 'retry': False, 'reserved_microusd': 20_000}),
              ('usage', 900, {'id': 2, 'input_tokens': 1200, 'output_tokens': 80,
                              'thinking_tokens': 20, 'charged_microusd': 2550}),
              ('validated_text', 950, {}), ('validated_text', 1000, {}),
              ('end', 1100, {'outcome': 'complete'})]
    return {'fictional': True, 'case': 'fixture-simple',
            'events': [{'event': kind, 'at_ms': at, **fields} for kind, at, fields in events]}


def rejected(value):
    try:
        collect(value)
    except ValueError as error:
        assert str(error) == 'Invalid fictional measurement trace'
    else:
        raise AssertionError('Unsafe or ambiguous trace accepted')


def run():
    trace = fixture();row = collect(trace)
    assert (row['first_validated_ms'], row['final_answer_ms']) == (450, 600)
    assert (row['attempts'], row['rounds'], row['retries'], row['tool_calls']) == (2, 2, 0, 1)
    assert [row[k] for k in ('input_tokens', 'output_tokens', 'thinking_tokens')] == [2200, 120, 80]
    assert row['estimated_or_reserved_microusd'] == 4800
    failed = copy.deepcopy(trace)
    failed['events'][2] = {'event': 'failed', 'at_ms': 700, 'id': 1}
    failed['events'][4].update(round=1, retry=True)
    result = collect(failed)
    assert (result['rounds'], result['retries'], result['unknown_usage_attempts']) == (1, 1, 1)
    assert result['estimated_or_reserved_microusd'] == 22550
    assert result['input_tokens'] is None and not result['usage_complete']
    missing = copy.deepcopy(trace);del missing['events'][2]
    assert collect(missing)['estimated_or_reserved_microusd'] == 22550
    assert not summarize([missing], ['fixture-simple'])['target_eligible']
    for outcome in ('partial', 'cancelled', 'error', 'refused'):
        aborted = copy.deepcopy(trace);aborted['events'][-1]['outcome'] = outcome
        report = summarize([aborted], ['fixture-simple'])
        assert not report['complete'] and not report['target_eligible']
        assert report['final_answer_p95_ms'] is None
    zero = {'fictional': True, 'case': 'fixture-zero', 'events': [
        {'event': 'start', 'at_ms': 0},
        {'event': 'attempt', 'at_ms': 0, 'id': 1, 'round': 1, 'retry': False, 'reserved_microusd': 0},
        {'event': 'usage', 'at_ms': 0, 'id': 1, 'input_tokens': 0, 'output_tokens': 0,
         'thinking_tokens': 0, 'charged_microusd': 0}, {'event': 'validated_text', 'at_ms': 0},
        {'event': 'end', 'at_ms': 0, 'outcome': 'complete'}]}
    assert collect(zero)['first_validated_ms'] == 0
    rejected({**zero, 'events': [zero['events'][0], *zero['events'][3:]]})
    assert summarize([trace, zero], ['fixture-simple', 'fixture-zero'])['final_answer_p95_ms'] == 600
    for key in ('prompt', 'answer', 'account_id', 'error', 'api_key'):
        bad = copy.deepcopy(trace);bad['events'][1][key] = 'PRIVATE_SENTINEL';rejected(bad)
    for value in (-1, True, .1, float('nan'), float('inf'), 'PRIVATE_SENTINEL'):
        bad = copy.deepcopy(trace);bad['events'][1]['reserved_microusd'] = value;rejected(bad)
    for index, key, value in [(1, 'id', 2), (1, 'round', 0), (1, 'retry', True),
                              (2, 'id', 9), (4, 'retry', 'false'), (5, 'at_ms', 600)]:
        bad = copy.deepcopy(trace);bad['events'][index][key] = value;rejected(bad)
    for events in [trace['events'][1:], trace['events'][:-1], trace['events'] + [trace['events'][0]],
                   trace['events'][:3] + [trace['events'][2]] + trace['events'][3:]]:
        rejected({**trace, 'events': events})
    rejected({**trace, 'fictional': False});rejected({**trace, 'case': 'PRIVATE_SENTINEL'})
    for traces, ids in [([], ['fixture-simple']), ([trace, trace], ['fixture-simple']),
                        ([trace], ['fixture-simple', 'fixture-simple']), ([trace], ['fixture-other'])]:
        try: summarize(traces, ids)
        except ValueError: pass
        else: raise AssertionError('Incomplete/duplicate replay accepted')
    assert summarize([trace], ['fixture-simple'])['reviewed'] is False
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)/'fixture.json';path.write_text(json.dumps({'secret': 'PRIVATE_SENTINEL'}))
        command = [sys.executable, str(Path(__file__).with_name('kit_measure.py')), str(path)]
        result = subprocess.run(command, capture_output=True, text=True)
        assert result.returncode == 2 and 'PRIVATE_SENTINEL' not in result.stdout + result.stderr
    print('Kit measurement: fake-clock latency, retries, reserved cost, unknown usage and redaction PASS; zero provider calls.')


if __name__ == '__main__':
    run()
