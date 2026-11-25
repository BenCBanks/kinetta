"""Exact-input full-gate resume and spend planning. No provider or app access."""
import datetime as dt
import hashlib
import json
import math
from zoneinfo import ZoneInfo

RESPONSE_ESTIMATE_USD=.025  # Planning estimate, not a guarantee or a provider limit.
RESERVATION_HEADROOM_USD=.30
ATTEMPT_CAP=1000


def identity(root,cases,baseline_commit,candidate_commit,baseline_sha256,*,today=None):
    dates=today or (dt.datetime.now(dt.timezone.utc).date().isoformat(),
                   dt.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat())
    seed=(root/'dev/evals/kit_eval.py').read_text()
    seed=seed[seed.index(' with db.connect() as c:\n  for suffix'):seed.index(' def run(item):')]
    value={'dates':dates,'cases':cases,'baseline_commit':baseline_commit,
           'candidate_commit':candidate_commit,'baseline_sha256':baseline_sha256,
           'model':'gemini-3.8-flash','thinking':'LOW','seed':seed,
           'weekly_seed':(root/'dev/evals/kit_weekly_fixtures.py').read_text()}
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=lambda x:sorted(x)).encode()).hexdigest()


def resume_rows(previous,digest,case_ids):
    if previous.get('gate_resume_version')!=1 or previous.get('input_digest')!=digest or previous.get('setting_smoke'):
        raise ValueError('Gate resume needs identical baseline, candidate, inputs and local dates')
    spent=previous.get('reserved_or_estimated_usd')
    if type(spent) not in (int,float) or not math.isfinite(spent) or not 0<=spent<=2.5:
        raise ValueError('Invalid resume spending')
    if type(previous.get('requests',0)) is not int or previous.get('requests',0)<0:
        raise ValueError('Invalid prior request count')
    rows=[];seen=set()
    for row in previous.get('results',[]):
        key=(row.get('variant'),row.get('case'))
        if key in seen or key[0] not in ('baseline','candidate') or key[1] not in case_ids:
            raise ValueError('Invalid or duplicate gate resume row')
        seen.add(key)
        attempts=row.get('provider_requests',0)
        if type(attempts) is not int or attempts<0:raise ValueError('Invalid resume attempt count')
        # No paid reservation: safe to try an unfinished case. Preserve every paid
        # failure/interrupted case, too; resume never silently buys those calls again.
        if not row.get('passed') and not attempts:continue
        rows.append({**row,'reused':True})
    return rows,float(spent)


def preflight(budget,spent,remaining_responses,*,rounds=6):
    if not 0<=remaining_responses<=80 or spent>budget:raise ValueError('Invalid full-gate budget plan')
    planned=remaining_responses*RESPONSE_ESTIMATE_USD
    headroom=RESERVATION_HEADROOM_USD if remaining_responses else 0
    if planned+headroom>budget-spent+1e-9:
        raise ValueError('Gate preflight: remaining allowance cannot fit the planned responses and reservation headroom')
    if remaining_responses*rounds>ATTEMPT_CAP:raise ValueError('Gate attempt cap is too small')
    return {'responses_total':80,'responses_remaining':remaining_responses,
            'prior_spend_usd':spent,'remaining_budget_usd':budget-spent,
            'estimated_per_response_usd':RESPONSE_ESTIMATE_USD,'estimated_remaining_usd':planned,
            'reservation_headroom_usd':headroom,'attempt_cap':ATTEMPT_CAP,
            'maximum_remaining_attempts':remaining_responses*rounds,
            'estimate_only':True,'hard_stop_usd':budget}


def serial_results(run,jobs):
    # One response in flight minimizes padded reservations and gives a durable
    # checkpoint between responses, including across Ctrl-C/resume.
    from kit_eval_support import capped
    for job in jobs:
        row=run(job)
        yield row
        if capped(row.get('error')):return
