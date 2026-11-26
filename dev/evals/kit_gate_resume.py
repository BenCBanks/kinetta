"""Exact-input full-gate resume and spend planning. No provider or app access."""
import datetime as dt
import hashlib
import json
import math
import ast
import subprocess
from zoneinfo import ZoneInfo

RESPONSE_ESTIMATE_USD=.025  # Planning estimate, not a guarantee or a provider limit.
RESERVATION_HEADROOM_USD=.30
ATTEMPT_CAP=1000


def identity(root,cases,baseline_commit,candidate_commit,baseline_sha256,*,today=None,read=None):
    dates=today or (dt.datetime.now(dt.timezone.utc).date().isoformat(),
                   dt.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat())
    read=read or (lambda name:(root/name).read_text())
    seed=read('dev/evals/kit_eval.py')
    seed=seed[seed.index(' with db.connect() as c:\n  for suffix'):seed.index(' def run(item):')]
    value={'dates':dates,'cases':cases,'baseline_commit':baseline_commit,
           'candidate_commit':candidate_commit,'baseline_sha256':baseline_sha256,
           'model':'gemini-3.8-flash','thinking':'LOW','seed':seed,
           'weekly_seed':read('dev/evals/kit_weekly_fixtures.py')}
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=lambda x:sorted(x)).encode()).hexdigest()


def resume_rows(previous,digest,case_ids,*,recheck=None,retry_cases=()):
    if previous.get('gate_resume_version')!=1 or previous.get('input_digest')!=digest or previous.get('setting_smoke'):
        raise ValueError('Gate resume needs identical baseline, candidate, inputs and local dates')
    spent=previous.get('reserved_or_estimated_usd')
    if type(spent) not in (int,float) or not math.isfinite(spent) or not 0<=spent<=2.5:
        raise ValueError('Invalid resume spending')
    if type(previous.get('requests',0)) is not int or previous.get('requests',0)<0:
        raise ValueError('Invalid prior request count')
    retries=set(retry_cases)
    if retries-set(case_ids):raise ValueError('Unknown retry case')
    rows=[];seen=set();retried=set()
    for row in previous.get('results',[]):
        key=(row.get('variant'),row.get('case'))
        if key in seen or key[0] not in ('baseline','candidate') or key[1] not in case_ids:
            raise ValueError('Invalid or duplicate gate resume row')
        seen.add(key)
        attempts=row.get('provider_requests',0)
        if type(attempts) is not int or attempts<0:raise ValueError('Invalid resume attempt count')
        if previous.get('source_report_commit'):
            if recheck is None:raise ValueError('Validator-only resume requires offline revalidation')
            updated=recheck(row)
            if updated is None:raise ValueError('Cannot safely replay saved response: '+str(key))
            original=row;row={**row,**updated,'source_row':row.get('source_row',original)}
        else:original=row
        if key[0]=='candidate' and key[1] in retries:
            if original.get('passed') or not attempts or original.get('interrupted'):
                raise ValueError('Retry must explicitly replace a captured failed paid candidate response')
            retried.add(key[1]);continue
        # No paid reservation: safe to try an unfinished case. Preserve every paid
        # failure/interrupted case, too; resume never silently buys those calls again.
        if not row.get('passed') and not attempts:continue
        rows.append({**row,'reused':True})
    if retried!=retries:raise ValueError('Retry case has no failed paid candidate response')
    return rows,float(spent)


def refusal_replay(row,message):
    from kit_weekly_fixtures import is_expected_health_consent_refusal
    error=row.get('error')
    if error=='Weekly answer returned without an AI provider request.':error=None
    if is_expected_health_consent_refusal(row['case'],variant=row['variant'],answer=row.get('answer'),
            error=error,provider_requests=row.get('provider_requests',0),refusal_message=message):
        return {'error':None,'expected_refusal':True,'passed':True,'revalidated':True}


def replay_gate_row(row,message,parse,check):
    refusal=refusal_replay(row,message)
    if refusal is not None:return refusal
    # The baseline remains a historical measurement, including its failures.
    if row['variant']=='baseline' or row.get('interrupted'):return {}
    from kit_setting_smoke import replay_row
    updated=replay_row(row,parse,check)
    if updated and updated.get('answer'):
        updated['answer']={**(row.get('answer') or {}),**updated['answer']}
    return updated


def prepare_cache(root,report,cases,files):
    """Host-only proof: same provider inputs, only the scoped count validator may differ."""
    revision=report.get('candidate_commit','')
    if len(revision)!=40 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('Invalid archived gate revision')
    def read(name):
        return subprocess.check_output(['git','-C',str(root),'show',revision+':'+name],
                                       stderr=subprocess.DEVNULL).decode()
    args=(cases,report['baseline_commit'],revision,report['baseline_sha256'])
    if report.get('input_digest')!=identity(root,*args,read=read):
        raise ValueError('Archived source, inputs or UTC/local dates changed')
    def stable(source,names):
        tree=ast.parse(source)
        tree.body=[n for n in tree.body if not (
            isinstance(n,ast.FunctionDef) and n.name in names or
            isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets))]
        return ast.dump(tree,include_attributes=False)
    for name in ['app/'+n for n in files]+['app/db.py','app/kit_eval_diagnostics.py']:
        before,after=read(name),(root/name).read_text()
        if name=='app/kit_claims.py':
            before,after=(stable(s,{'NUMBER_WORD','bound_logged_days'}) for s in (before,after))
        if before!=after:raise ValueError('Provider inputs/source changed: '+name)
    name='dev/evals/kit_weekly_fixtures.py'
    if stable(read(name),{'is_expected_health_consent_refusal'})!=stable((root/name).read_text(),{'is_expected_health_consent_refusal'}):
        raise ValueError('Weekly seed or request contract changed')
    # identity also proves the seed text, selected cases and dates match the archive.
    current=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
    digest=identity(root,cases,report['baseline_commit'],current,report['baseline_sha256'])
    old_seed=read('dev/evals/kit_eval.py');new_seed=(root/'dev/evals/kit_eval.py').read_text()
    def seed(s):return s[s.index(' with db.connect() as c:\n  for suffix'):s.index(' def run(item):')]
    if seed(old_seed)!=seed(new_seed):raise ValueError('Fictional seed changed')
    return {**report,'input_digest':digest,'source_report_commit':revision,'reviewed':False}


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


if __name__=='__main__':
    import argparse,importlib.util,os
    from pathlib import Path
    from kit_cases import CASES
    from kit_gate_cases import GATE_CASE_IDS
    parser=argparse.ArgumentParser();parser.add_argument('--prepare-cache',required=True);parser.add_argument('--output',required=True)
    args=parser.parse_args();root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('release_only',root/'app/ai_release.py')
    release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
    data=Path(args.prepare_cache).read_bytes();report=json.loads(data)
    if report.get('input_digest')!=identity(root,[c for c in CASES if c[0] in GATE_CASE_IDS],
            report['baseline_commit'],report['candidate_commit'],report['baseline_sha256']):
        report=prepare_cache(root,report,[c for c in CASES if c[0] in GATE_CASE_IDS],release.FILES['kit'])
        report['source_report_sha256']=hashlib.sha256(data).hexdigest()
    with os.fdopen(os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:json.dump(report,stream)
