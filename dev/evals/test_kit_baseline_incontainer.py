"""Offline proof through the frozen baseline answer path and disposable SQL ledger."""
import argparse
import hashlib
import json
import os
from pathlib import Path
from unittest.mock import patch
import uuid

from app import ai_budget, coach, db
from kit_eval_support import configure_budget, load_baseline
from kit_weekly_fixtures import (is_expected_health_consent_refusal, request_contract,
                                 run_weekly_answer)


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--baseline', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    if os.environ.get('KINETTA_JOURNEY_FIXTURE') != '1':
        p.error('Use the disposable wrapper, never a live database')
    path = Path(args.baseline)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    baseline = load_baseline(path)
    # The old loader fails here, before paying for any response.
    baseline.KitAnswer.model_json_schema()
    uids, calls = [], []
    raw = {'verdict': 'Your saved records are available.',
           'reason': 'Only recorded information is included.', 'facts': [],
           'selection': None, 'actions': [], 'follow_ups': []}
    weekly = {**raw, 'weekly_review': {
        'what_went_well': 'You can review your recorded workouts.',
        'what_to_change': 'Food records are incomplete.',
        'next_week_focus': 'Follow your saved plan.'}}

    def provider(messages, definitions, *, system):
        calls.append(system)
        return [], json.dumps(weekly if system == baseline.KIT_WEEKLY_SYSTEM else raw), {}

    try:
        with db.connect() as c:
            for consent in (True, False):
                uid = c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',
                    ('zz_test_baseline_'+uuid.uuid4().hex, 'Fictional baseline account')).fetchone()['id']
                uids.append(uid)
                c.execute("""INSERT INTO profile(user_id,tz,ai_ok,ai_adult_at,health_ai_ok,
                    health_weight_ai_ok,weight_health_derived) VALUES (%s,'UTC',true,now(),%s,%s,%s)""",
                    (uid, consent, consent, not consent))
        # Only transport/provider selection is stubbed. Real answer(), tools, consent,
        # schema validation, rendering and SQL run against the unchanged baseline.
        with patch.dict(os.environ, {'KINETTA_AI_ENABLED': '1'}), \
             patch.object(coach, 'provider', return_value='gemini'), \
             patch.object(baseline, '_gemini_turn', side_effect=provider), \
             patch('urllib.request.urlopen', side_effect=AssertionError('Network provider call forbidden')):
            answer = baseline.answer(uids[0], 'What is recorded?', kit=True)
            assert answer['interpretation'] == raw['verdict']+' '+raw['reason']
            transport = request_contract(uuid.uuid4(), uuid.uuid4(), uuid.uuid4())
            result = run_weekly_answer(baseline.answer, uids[0], transport)
            assert result['error'] is None, result
            assert result['answer']['weekly_review'] == weekly['weekly_review']
            before = len(calls)
            refused = run_weekly_answer(baseline.answer, uids[1], transport)
            assert len(calls) == before, 'Consent refusal must happen before provider transport'
            for variant in ('baseline', 'candidate'):
                assert is_expected_health_consent_refusal('weekly-health-consent-off',
                    variant=variant, answer=refused['answer'], error=refused['error'],
                    provider_requests=0, refusal_message=coach.HEALTH_NO), refused
            configure_budget(2.50)
            assert ai_budget.budget_micros() == 2_500_000
            # Model 80 responses with two provider attempts each, exercising real
            # dollar/attempt limits (no network). Larger actual runs still stop safely.
            with ai_budget.scope(uids[0], feature='Offline gate budget proof'):
                for index in range(160):
                    rid = ai_budget.reserve('gemini-3.8-flash', 'offline',
                        {'contents': [{'text': 'fictional '*2000}],
                         'generationConfig': {'maxOutputTokens': 8192 if index%2==0 else 16384}})
                    ai_budget.settle(rid, {'usageMetadata': {
                        'promptTokenCount': 3000, 'candidatesTokenCount': 700}})
                    ai_budget.finish(rid)
        with db.connect() as c:
            cost = c.execute('SELECT count(*) AS n,sum(charged_micros) AS cost FROM ai_food_attempts WHERE user_id=ANY(%s)', (uids,)).fetchone()
        assert cost['n'] == 160 and cost['cost'] == 1_560_000, cost
        assert digest == hashlib.sha256(path.read_bytes()).hexdigest(), 'Baseline bytes changed'
        report = {'offline_smoke': True, 'dry_run': False, 'reviewed': False, 'complete': False,
                  'provider_calls': 0, 'stubbed_responses': len(calls),
                  'baseline_sha256': digest, 'baseline_schema': 'pass', 'baseline_chat': 'pass',
                  'baseline_weekly': 'pass', 'consent_refusal_both_variants': 'pass',
                  'simulated_ledger_attempts': cost['n'], 'simulated_cost_usd': int(cost['cost'])/1e6}
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(report, stream, indent=2)
            stream.write('\n')
        print(json.dumps(report), flush=True)
    finally:
        with db.connect() as c:
            for uid in uids:
                c.execute('DELETE FROM users WHERE id=%s', (uid,))


if __name__ == '__main__':
    main()
