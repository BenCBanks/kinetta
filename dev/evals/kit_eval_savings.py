"""Conservative per-case release cache and exact-head offline receipts. No providers."""
import ast
import hashlib
import json
import math
import os
import subprocess
from pathlib import Path
from kit_fixture_clock import FIXTURE_DATE

# Observed full gate: $1.43 / 80 responses. Estimates are not guarantees.
PER_RESPONSE_USD = .018
SMOKE_IDS = ('food-today','meal','strength','nutrition-adequacy','low-intake',
             'recall-health-consent-off','weekly-steady-prior','weekly-no-plan',
             'batch2-saved-history','batch2-next-step')


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=lambda v:sorted(v)).encode()).hexdigest()


def case_keys(root,cases,baseline,candidate):
    def source(revision):
        paths=subprocess.check_output(['git','-C',str(root),'ls-tree','-r','--name-only',revision,'app'],text=True).splitlines()
        return digest({p:subprocess.check_output(['git','-C',str(root),'show',revision+':'+p]).decode()
                       for p in paths if p.endswith('.py')})
    # Exclude the case declarations: editing one request invalidates that case,
    # while a shared fixture/helper change invalidates all potentially affected cases.
    helpers={}
    for name in ('kit_eval.py','kit_weekly_fixtures.py','kit_batch2_cases.py','kit_fixture_clock.py'):
        tree=ast.parse((root/'dev/evals'/name).read_text())
        nodes=[n for n in tree.body if not (isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in {'CASES','BATCH2_CASES','EXTRA','REPLACED'} for t in n.targets))]
        helpers[name]=ast.dump(ast.Module(body=nodes,type_ignores=[]),include_attributes=False)
    common={'date':FIXTURE_DATE,'helpers':helpers,'model':'gemini-3.8-flash','thinking':'LOW','version':1}
    sources={'baseline':source(baseline),'candidate':source(candidate)}
    # Both variants use the disposable current transport to assemble the actual
    # request. Context/DB changes can alter baseline inputs without altering live
    # provider code; those must also invalidate its row, rather than conceal drift.
    shared={name:(root/'app'/name).read_text() for name in
            ('db.py','ai_budget.py','ai_access.py','kit_thread.py','kit_history_api.py','kit_memory.py','kit_coaching.py')}
    sources['baseline']=digest([sources['baseline'],shared])
    return {v:{c[0]:digest([common,sources[v],c]) for c in cases} for v in sources}


def reuse(reports,keys,selected):
    rows={}; blocked=[]
    for path in reports:
        report=json.loads(Path(path).read_text())
        if report.get('fixture_date')!=FIXTURE_DATE: raise ValueError('Cache lacks the pinned fictional clock; do not relabel old captures')
        for row in report.get('results',[]):
            v,c=row.get('variant'),row.get('case')
            if v not in keys or c not in selected or row.get('case_input_digest')!=keys[v].get(c): continue
            if row.get('interrupted'):
                blocked.append((v,c)); continue
            # Baseline failures are historical measurements, not a reason to buy
            # the live answer again. Only successful candidates carry forward.
            if row.get('passed') or (v=='baseline' and row.get('provider_requests',0)>0):
                rows[v,c]={**row,'reused':True,'source_report':str(path),
                           'source_commit':row.get('source_commit',report.get(v+'_commit'))}
    if any(key not in rows for key in blocked): raise ValueError('Interrupted paid case needs owner reconciliation; automatic repayment refused')
    return list(rows.values())


def plan(rows,total,budget,spent=0):
    if not math.isfinite(budget) or not 0<budget<=.80: raise ValueError('Economy run hard cap must be at most $0.80')
    remaining=total-len(rows)
    if not 0<=remaining<=80:raise ValueError('Invalid response count')
    expected=round(remaining*PER_RESPONSE_USD,3)
    if not math.isfinite(spent) or spent<0 or expected+.08+spent>budget+1e-9: raise ValueError('Expected cost exceeds cap; bootstrap/reuse the pinned live baseline first')
    return {'responses_remaining':remaining,'reused_responses':len(rows),'expected_cost_usd':expected,
            'prior_spend_usd':spent,'reservation_headroom_usd':.08,'hard_stop_usd':budget,'estimate_only':True,'fixture_date':FIXTURE_DATE}


def receipt(root):
    head=subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()
    if subprocess.check_output(['git','-C',str(root),'status','--porcelain','--','app','dev/evals','dev/tests']):
        raise ValueError('Commit source before offline replay')
    return {'head':head,'fixture_date':FIXTURE_DATE,'offline_replay_passed':True,
            'provider_calls':0,'reviewed':False}


def require_receipt(path,root):
    if json.loads(Path(path).read_text())!=receipt(root): raise ValueError('Offline replay receipt is stale; run --replay on this head')


def write_private(path,value):
    with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'w') as out: json.dump(value,out)


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--receipt');p.add_argument('--write',action='store_true')
    p.add_argument('--prepare');p.add_argument('--baseline-commit');p.add_argument('--stage',choices=('smoke','full','baseline'),default='smoke')
    p.add_argument('--cache',action='append',default=[]);p.add_argument('--cache-dir',type=Path)
    p.add_argument('--budget-usd',type=float,default=.80)
    args=p.parse_args();root=Path(__file__).resolve().parents[2]
    if args.prepare:
        if args.cache_dir:
            for path in sorted(args.cache_dir.glob('kit-gate-*.json')):
                prior=json.loads(path.read_text())
                if prior.get('economy') and prior.get('fixture_date')==FIXTURE_DATE:args.cache.append(str(path))
        args.cache=list(dict.fromkeys(args.cache))
        from kit_batch2_cases import BATCH2_CASES
        current=receipt(root)['head']; keys=case_keys(root,BATCH2_CASES,args.baseline_commit,current)
        selected=[c[0] for c in BATCH2_CASES if args.stage!='smoke' or c[0] in SMOKE_IDS]
        variants=['baseline'] if args.stage=='baseline' else ['baseline','candidate']
        rows=[r for r in reuse(args.cache,keys,selected) if r['variant'] in variants]
        paid_runs={}
        for path in args.cache:
            old=json.loads(Path(path).read_text())
            if (old.get('candidate_commit')==current and (old.get('economy_stage')=='baseline')==(args.stage=='baseline')):
                paid_runs.update(old.get('economy_paid_runs',{}))
        estimate=plan(rows,len(variants)*len(selected),args.budget_usd,sum(paid_runs.values()))
        if args.stage=='full':
            smoke=reuse(args.cache,keys,SMOKE_IDS)
            if {r['case'] for r in smoke if r['variant']=='candidate' and r.get('passed')} != set(SMOKE_IDS):
                raise ValueError('Full run requires a passing ten-case smoke on these inputs first')
        data={'stage':args.stage,'variants':variants,'paid_runs':paid_runs,'keys':keys,'results':rows,'selected':selected,'fixture_date':FIXTURE_DATE,
              'candidate_commit':current,'budget_preflight':estimate}
        write_private(args.prepare,data);print(json.dumps(estimate),flush=True)
    elif args.write:write_private(args.receipt,receipt(root))
    else:require_receipt(args.receipt,root)
