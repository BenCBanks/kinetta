"""Reference-event fixtures exercise the evaluator, never predict Kit answers or quality."""
import copy
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from kit_coach_cases import RUBRIC, cases
from kit_coach_replay import evaluate, replay


def answer(*, status='ok', memory=None):
    return ('answer', {'owner': 'a', 'status': status, 'text': 'Fictional reference response.',
        'facts': {'food.kcal': 420} if status == 'ok' else {}, 'sources': ['food'] if status == 'ok' else [],
        'memory_versions': (memory or {}) if status == 'ok' else {}})


def reference(case):
    # These are hand-specified expected effects, not calls to runtime Kit or an AI provider.
    cid = case['id'].removeprefix('fixture-');script = case['script'];initial_refusal = not case['initial']['kit']
    events = [script[0], answer(status='refused' if initial_refusal else 'ok',
                               memory={'preference': 1} if case['group'] == 'memory' else {})]
    if case['group'] == 'actions': events.append(('proposal', {'owner': 'a', 'revision': 1}))
    for control in script[1:-1]:
        events.append(copy.deepcopy(control))
        if control[0] == 'confirm' and cid in ('actions-confirm', 'actions-retry'):
            if not any(e[0] == 'write' for e in events): events.append(('write', {'owner': 'a', 'revision': 1}))
            events.append(('receipt', {'owner': 'a', 'revision': 1}))
    refs = {'preference': 2} if case['group'] == 'memory' else {}
    if cid in ('memory-forget', 'memory-off'): refs = {}
    status = 'refused' if initial_refusal or cid in ('consent-kit-revoke', 'app-switch-logout') else 'ok'
    if cid in ('app-switch-cancel', 'actions-cancel'): status = 'cancelled'
    events += [script[-1], answer(status=status, memory=refs)]
    return {'id': case['id'], 'fictional': True, 'events': events, 'ratings': {key: 2 for key in RUBRIC}}


def run():
    manifest = cases();assert len(manifest) == len({c['id'] for c in manifest}) == 48
    from kit_measure import case_id
    assert all(case_id(c['id']) == c['id'] for c in manifest)
    assert len({c['script'][0][1] for c in manifest}) >= 40
    assert all(sum(c['group'] == group for c in manifest) == 6 for group in {c['group'] for c in manifest})
    observations = [reference(c) for c in manifest];report = evaluate(observations)
    assert evaluate(json.loads(json.dumps(observations)))['contract_passed']
    assert report['contract_passed'] and report['quality_passed'] and not report['release_evidence'] and not report['reviewed']
    # JSON round trip includes a non-binary fraction without turning missing protein into zero.
    obs = reference(manifest[0]);obs['events'][1][1]['facts'] = {'fraction': .1}
    assert not replay(manifest[0], json.loads(json.dumps(obs)))['failures']
    def mutate(cid, change, expected):
        case = next(c for c in manifest if c['id'] == 'fixture-' + cid);o = reference(case);change(o)
        assert expected in replay(case, o)['failures'], (cid, expected)
    def final(o): return o['events'][-1][1]
    mutate('integrity-isolation', lambda o: final(o).update(text='PRIVATE_OTHER_718'), 'account_isolation')
    mutate('integrity-isolation', lambda o: final(o).update(owner='b'), 'account_isolation')
    mutate('integrity-unknown', lambda o: final(o).update(facts={'food.protein_g': 0}), 'unsupported_fact')
    mutate('integrity-fraction', lambda o: final(o).update(facts={'fraction': .10001}), 'unsupported_fact')
    for value in (True, float('nan'), float('inf'), '420'):
        mutate('integrity-coverage', lambda o: final(o).update(facts={'food.kcal': value}), 'unsupported_fact')
    mutate('memory-correct', lambda o: final(o).update(memory_versions={'preference': 1}), 'stale_memory')
    for cid in ('memory-forget', 'memory-off'):
        mutate(cid, lambda o: final(o).update(memory_versions={'preference': 1}), 'stale_memory')
    mutate('consent-health-revoke', lambda o: final(o).update(facts={'run.distance_m': 5000}), 'source_consent')
    mutate('consent-weight-off', lambda o: final(o).update(sources=['weight']), 'source_consent')
    mutate('consent-kit-revoke', lambda o: final(o).update(status='ok'), 'kit_consent')
    mutate('app-switch-cancel', lambda o: final(o).update(status='ok'), 'cancelled_answer')
    for cid in ('actions-preview', 'actions-stale', 'actions-foreign', 'actions-cancel'):
        mutate(cid, lambda o: o['events'].insert(-1, ('write', {'owner': 'a', 'revision': 1})), 'unconfirmed_or_duplicate_write')
    mutate('actions-confirm', lambda o: o['events'].insert(-1, ('write', {'owner': 'a', 'revision': 1})), 'unconfirmed_or_duplicate_write')
    mutate('actions-confirm', lambda o: next(e[1] for e in o['events'] if e[0] == 'confirm').__setitem__(1, True), 'script_mismatch')
    mutate('actions-confirm', lambda o: next(e[1] for e in o['events'] if e[0] == 'write').update(revision=True), 'unconfirmed_or_duplicate_write')
    mutate('actions-confirm', lambda o: o.update(events=[e for e in o['events'] if e[0] != 'write']), 'action_effect_mismatch')
    mutate('app-switch-background', lambda o: o.update(events=[e for e in o['events'] if e[0] != 'visibility']), 'incomplete_journey')
    mutate('consent-kit-revoke', lambda o: o['events'].insert(2, o['events'].pop()), 'answer_turn_order')
    for ratings in ({}, {key: True for key in RUBRIC}, {key: 1 for key in RUBRIC}):
        unreviewed = copy.deepcopy(observations);unreviewed[0]['ratings'] = ratings
        assert not evaluate(unreviewed)['quality_passed']
    unreviewed = copy.deepcopy(observations);unreviewed[0].pop('ratings')
    assert not evaluate(unreviewed)['human_review_complete']
    for bad in (observations[:-1], observations + [observations[0]], [{**observations[0], 'id':'unknown'}, *observations[1:]]):
        try: evaluate(bad)
        except ValueError: pass
        else: raise AssertionError('Incomplete/extra/duplicate case set accepted')
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp)/'fictional.json';path.write_text(json.dumps([{'id': 'PRIVATE_SENTINEL'}]))
        command = [sys.executable, str(Path(__file__).with_name('kit_coach_replay.py')), str(path)]
        result = subprocess.run(command, capture_output=True, text=True)
        assert result.returncode == 2 and 'PRIVATE_SENTINEL' not in result.stdout + result.stderr
    print('Kit coach replay: 48 fictional journeys; safety/consent/memory/action mutations and pending human rubric PASS; no provider calls.')


if __name__ == '__main__':
    run()
