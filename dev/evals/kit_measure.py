"""Offline fictional timing/ledger replay. No app, database, provider or network imports."""
import argparse
import json
import math
import re
import statistics
from pathlib import Path

FIELDS = {'start': (), 'attempt': ('id', 'round', 'retry', 'reserved_microusd'),
          'usage': ('id', 'input_tokens', 'output_tokens', 'thinking_tokens', 'charged_microusd'),
          'failed': ('id',), 'tool': (), 'validated_text': (), 'end': ('outcome',)}
TOKENS = ('input_tokens', 'output_tokens', 'thinking_tokens')


def invalid():
    # Never echo an input value, raw provider error or rejected payload.
    raise ValueError('Invalid fictional measurement trace')


def integer(value):
    if type(value) is not int or not 0 <= value <= 10**12:
        invalid()
    return value


def case_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'fixture-[a-z0-9-]{1,48}', value):
        invalid()
    return value


def collect(trace):
    if not isinstance(trace, dict) or set(trace) != {'fictional', 'case', 'events'} or trace['fictional'] is not True:
        invalid()
    cid = case_id(trace['case'])
    events = trace['events']
    if not isinstance(events, list) or not 2 <= len(events) <= 1000:
        invalid()
    attempts, first, end, outcome, tools, previous = {}, None, None, None, 0, -1
    for index, event in enumerate(events):
        if not isinstance(event, dict) or not isinstance(event.get('event'), str):
            invalid()
        kind = event['event']
        if kind not in FIELDS or set(event) != {'event', 'at_ms', *FIELDS[kind]}:
            invalid()
        at = integer(event['at_ms'])
        if at < previous or end is not None or (index == 0) != (kind == 'start'):
            invalid()
        previous = at
        if kind == 'start':
            began = at
        elif kind == 'attempt':
            aid, round_id = integer(event['id']), integer(event['round'])
            retry = event['retry']
            rounds = {a['round'] for a in attempts.values()}
            if aid != len(attempts) + 1 or type(retry) is not bool or round_id < 1:
                invalid()
            if (retry and round_id != max(rounds, default=0)) or (not retry and round_id != max(rounds, default=0) + 1):
                invalid()
            attempts[aid] = {'round': round_id, 'retry': retry, 'state': 'reserved',
                             'reserved': integer(event['reserved_microusd'])}
        elif kind in ('usage', 'failed'):
            aid = integer(event['id'])
            attempt = attempts.get(aid)
            if not attempt or attempt['state'] != 'reserved':
                invalid()
            if kind == 'usage':
                attempt.update({key: integer(event[key]) for key in TOKENS})
                attempt['charged'] = integer(event['charged_microusd'])
                attempt['state'] = 'measured'
            else:
                attempt['state'] = 'failed'
        elif kind == 'tool':
            tools += 1
        elif kind == 'validated_text':
            if first is None:
                first = at - began
        elif kind == 'end':
            outcome = event['outcome']
            if outcome not in ('complete', 'partial', 'cancelled', 'error', 'refused'):
                invalid()
            end = at - began
    if end is None or (outcome == 'complete' and (first is None or not attempts)):
        invalid()
    known = all(a['state'] == 'measured' for a in attempts.values())
    total = sum(a['charged'] if a['state'] == 'measured' else a['reserved'] for a in attempts.values())
    return {'case': cid, 'outcome': outcome, 'first_validated_ms': first,
            'final_answer_ms': end if outcome == 'complete' else None, 'elapsed_ms': end,
            'attempts': len(attempts), 'rounds': len({a['round'] for a in attempts.values()}),
            'retries': sum(a['retry'] for a in attempts.values()), 'tool_calls': tools,
            'unknown_usage_attempts': sum(a['state'] != 'measured' for a in attempts.values()),
            **{key: sum(a[key] for a in attempts.values()) if known else None for key in TOKENS},
            'estimated_or_reserved_microusd': total, 'usage_complete': known}


def summarize(traces, expected):
    if not isinstance(expected, list) or not expected or len(expected) != len(set(map(case_id, expected))):
        invalid()
    rows = [collect(trace) for trace in traces]
    if len(rows) != len(expected) or {r['case'] for r in rows} != set(expected):
        invalid()
    complete = all(r['outcome'] == 'complete' for r in rows)
    eligible = complete and all(r['usage_complete'] for r in rows)
    def p95(key):
        values = sorted(r[key] for r in rows)
        return values[math.ceil(.95 * len(values)) - 1]
    return {'fictional': True, 'reviewed': False, 'release_evidence': False, 'case_count': len(rows),
            'complete': complete, 'target_eligible': eligible,
            'first_validated_p95_ms': p95('first_validated_ms') if complete else None,
            'final_answer_p95_ms': p95('final_answer_ms') if complete else None,
            'mean_estimated_or_reserved_microusd': statistics.mean(r['estimated_or_reserved_microusd'] for r in rows),
            'estimated_or_reserved_microusd': sum(r['estimated_or_reserved_microusd'] for r in rows),
            'results': rows}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path, help='Fictional JSON: traces and expected fixture IDs')
    args = parser.parse_args()
    try:
        data = json.loads(args.input.read_text())
        if set(data) != {'traces', 'expected'}:
            invalid()
        result = summarize(data['traces'], data['expected'])
    except (ValueError, TypeError, KeyError, OSError):
        parser.exit(2, 'Invalid fictional measurement input\n')
    print(json.dumps(result, allow_nan=False))
