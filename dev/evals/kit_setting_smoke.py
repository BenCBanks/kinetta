"""Small setting experiment, never a release-gate report; no provider access here."""
import ast
import datetime as dt
import hashlib
import json
from pathlib import Path
import subprocess
import os
from zoneinfo import ZoneInfo

CASE_IDS = ('conversation-detail','general-diet','nutrition-adequacy','meal','followup-food',
            'strength','weekly-steady-prior','weekly-no-plan','recall-health-consent-off','recall-other-account')
CAP_USD = .45
RUBRIC = ('direct_and_useful','right_length_and_structure','evidence_and_units',
          'context_and_clarification','supported_next_step','privacy_and_safety')


def dates():
    return (dt.datetime.now(dt.timezone.utc).date().isoformat(),
            dt.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat())


def input_digest(root, cases, files, *, today=None, read=None, legacy=False):
    today=today or dates()
    read=read or (lambda name:(root/name).read_bytes())
    paths=['app/'+name for name in files]+['app/db.py']
    if legacy:
        paths+=['dev/evals/'+name for name in ('kit_setting_smoke.py','kit_eval.py','kit_cases.py','kit_weekly_fixtures.py')]
        sources={name:hashlib.sha256(read(name)).hexdigest() for name in paths}
    else:
        # Scheduling/report changes don't change the model input. Validator-only
        # changes require replay, not repaying for an identical provider response.
        sources={}
        for name in paths:
            source=read(name)
            if name=='app/kit_claims.py':
                tree=ast.parse(source)
                source=ast.dump(ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef)
                    and n.name in {'weekly_system','conversation_retry_prompt','weekly_retry_prompt'}],type_ignores=[])).encode()
            sources[name]=hashlib.sha256(source).hexdigest()
        source=read('dev/evals/kit_eval.py').decode()
        seed=source[source.index(' with db.connect() as c:\n  for suffix'):source.index(' def run(item):')]
        sources['fictional_seed']=hashlib.sha256(seed.encode()).hexdigest()
        for name in ('kit_cases.py','kit_weekly_fixtures.py'):
            sources[name]=hashlib.sha256(read('dev/evals/'+name)).hexdigest()
    data={'dates':today,'model':'gemini-3.8-flash','cases':cases,'sources':sources}
    return hashlib.sha256(json.dumps(data,sort_keys=True,default=lambda x:sorted(x)).encode()).hexdigest()


def prepare_cache(root, report, cases, files):
    # Host-only migration of old private captures: prove both the old digest and
    # unchanged provider inputs from Git. Never edit the archived report itself.
    if not report.get('setting_smoke'):raise ValueError('Only setting smoke captures can resume')
    current=input_digest(root,cases,files)
    if report.get('digest_version')==2:
        if report.get('input_digest')!=current:raise ValueError('Resume inputs/date/source changed')
        return report
    revision=report.get('candidate_commit','')
    if report.get('baseline_commit')!=revision:raise ValueError('Resume requires same-code smoke')
    if not revision or not all(c in '0123456789abcdef' for c in revision):raise ValueError('Invalid archived revision')
    def read(name):
        return subprocess.check_output(['git','-C',str(root),'show',revision+':'+name],stderr=subprocess.DEVNULL)
    if report.get('input_digest')!=input_digest(root,cases,files,read=read,legacy=True):
        raise ValueError('Archived capture inputs/date cannot be verified')
    if current!=input_digest(root,cases,files,read=read):raise ValueError('Model inputs changed; do not reuse this capture')
    return {**report,'input_digest':current,'digest_version':2,'source_report_commit':revision}



def replay_row(row,parse,check):
    from kit_eval_support import capped
    if row.get('expected_refusal') and row.get('passed'):return {}
    turns=row.get('provider_turns') or (row.get('rejection') or {}).get('provider_turns',[])
    raw=next((t.get('raw_model_json') for t in reversed(turns) if t.get('raw_model_json')),None)
    evidence=row.get('answer_evidence') or (row.get('rejection') or {}).get('answer_evidence')
    if not raw or not evidence or capped(row.get('error')):return None
    try:
        answer=check(parse(raw),evidence,kit=True,weekly_review=row.get('weekly_review',False),
                     conversation_question=row.get('question'))
    except ValueError as error:
        return {'answer':None,'error':'Replay '+type(error).__name__+': '+str(error)[:350],
                'passed':False,'revalidated':True}
    return {'answer':answer,'error':None,'passed':True,'revalidated':True,'rejection':None}


def cached_rows(report,digest,settings,recheck,*,low_only=False):
    if report.get('setting_smoke') is not True or report.get('input_digest')!=digest:
        raise ValueError('Resume inputs differ; use a fresh smoke')
    source_settings=report.get('thinking_settings',{})
    rows=[];seen=set()
    for row in report.get('results',[]):
        variant=row.get('variant');key=(variant,row.get('case'))
        if row.get('case') not in CASE_IDS or source_settings.get(variant)!=settings.get(variant):continue
        if low_only and source_settings.get(variant)!='LOW':continue
        if key in seen:raise ValueError('Duplicate resume case/setting')
        seen.add(key)
        # A cap/transport failure is unfinished. A captured validation rejection
        # can be replayed after a validator fix, without another provider call.
        replay=recheck(row)
        if replay is None:continue
        rows.append({**row,**replay,'reused':True,'source_commit':report.get('source_report_commit',report.get('candidate_commit'))})
    return rows


def cached_low(report,digest):
    # Legacy unit-level API; runtime reuse always revalidates the exact captured JSON.
    return cached_rows(report,digest,{'baseline':'LOW'},
        lambda r:{} if r.get('passed') and r.get('answer') and not r.get('error') else None,low_only=True)


if __name__=='__main__':
    import argparse,importlib.util
    p=argparse.ArgumentParser();p.add_argument('--prepare-cache',required=True);p.add_argument('--output',required=True)
    args=p.parse_args();root=Path(__file__).resolve().parents[2]
    spec=importlib.util.spec_from_file_location('release_only',root/'app/ai_release.py')
    release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
    from kit_cases import CASES
    cases=[c for c in CASES if c[0] in CASE_IDS]
    report=prepare_cache(root,json.loads(Path(args.prepare_cache).read_text()),cases,release.FILES['kit'])
    with os.fdopen(os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:json.dump(report,stream)
