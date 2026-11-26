"""App-observed checked-stream, answer-only chart and exact goal-target contracts."""
import math

EVENTS = {'stream_block', 'chart', 'goal_preview', 'goal_saved'}
SERIES = {'distance_m': ([5000, None], 'm', 'health'),
          'logged_kcal': ([420, None], 'kcal', 'food'), 'empty': ([None, None], 'm', 'health')}
TARGET = {'owner': 'a', 'revision': 1, 'metric': 'distance', 'before': 5000, 'target': 6000}


def grade(case, observation):
    failures, blocks, charts = set(), {}, {}
    consent, turn, generation, cancelled, previews, saved, writes = dict(case['initial']), 0, 1, False, 0, 0, 0
    for kind, value in observation['events']:
        if kind == 'user': turn += 1
        elif kind == 'consent': consent[value[0]] = value[1]
        elif kind == 'generation': generation = value; blocks.clear()
        elif kind == 'cancel': cancelled = True; blocks.clear()
        elif kind == 'stream_block':
            if not isinstance(value, dict) or set(value) != {'owner','generation','turn','index','text','checked','saved'}:
                failures.add('stream_schema'); continue
            if (value['owner'] != 'a' or type(value['generation']) is not int or value['generation'] != generation
                or type(value['turn']) is not int or value['turn'] != turn or not consent['kit'] or cancelled):
                failures.add('stream_scope')
            index = value['index']; text = value['text']
            if type(index) is not int or not 0 <= index < 10 or not isinstance(text, str) or not 1 <= len(text.strip()) <= 1600:
                failures.add('stream_schema'); continue
            if value['checked'] is not True or value['saved'] is not True: failures.add('unchecked_stream')
            if 'PRIVATE_OTHER_718' in text: failures.add('stream_scope')
            key = (turn, index)
            if key in blocks and blocks[key] != text: failures.add('stream_replay_changed')
            blocks[key] = text
        elif kind == 'chart':
            if not isinstance(value, dict) or set(value) != {'owner','scope','metric','values','unit'}:
                failures.add('chart_schema'); continue
            expected = SERIES.get(value['metric'])
            if value['owner'] != 'a' or value['scope'] != 'answer': failures.add('chart_scope')
            if not expected or not consent['kit'] or cancelled or not consent.get(expected[2]): failures.add('chart_consent_or_metric'); continue
            points, unit, _ = expected
            if (value['unit'] != unit or not isinstance(value['values'], list) or value['values'] != points
                or any(v is not None and (type(v) not in (int, float) or not math.isfinite(v)) for v in value['values'])):
                failures.add('chart_values_or_units')
            charts[turn] = value
        elif kind in ('goal_preview', 'goal_saved'):
            if value != TARGET or any(type(value.get(k)) is not int for k in ('revision','before','target')):
                failures.add('goal_target_mismatch')
            if kind == 'goal_preview': previews += 1
            else:
                saved += 1
                if not previews or saved != writes: failures.add('goal_save_order')
        elif kind == 'write': writes += 1
        elif kind == 'answer':
            if case['group'] == 'streaming' and value['status'] == 'ok':
                text = [v for (t, _), v in sorted(blocks.items()) if t == turn]
                indexes = sorted(index for t, index in blocks if t == turn)
                if indexes != list(range(len(text))) or not text or '\n\n'.join(text) != value['text']:
                    failures.add('stream_complete_mismatch')
            if case['group'] == 'charts':
                expected = 'logged_kcal' if case['id'] in ('fixture-charts-food','fixture-charts-foreign') else 'empty' if case['id'] == 'fixture-charts-empty' else 'distance_m'
                required = expected != 'empty' and (consent['health'] or expected == 'logged_kcal')
                if required != (turn in charts) or turn in charts and charts[turn]['metric'] != expected:
                    failures.add('missing_or_unexpected_chart')
    if case['group'] == 'actions' and (previews != 1 or saved != case['required_writes']):
        failures.add('missing_goal_effect')
    return sorted(failures)
