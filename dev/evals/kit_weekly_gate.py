"""Private gate preparation: freeze live helpers, prove historical baseline input identity."""
import ast
import datetime as dt
import hashlib
import json
import subprocess
from pathlib import Path
from zoneinfo import ZoneInfo

LIVE='ba8e9500049f25b2cb769d09a25d99fc4cb198c1'
CANDIDATE='21d42242749ba8296e6b95668d283810e3d7d59e'
INSTALLED='5aae49f41cb3ea4bb8091a34fee4459ca6e7d8cb857c3b82d37b4b361da0e568'


def source(root,revision,name):
    return subprocess.check_output(['git','-C',str(root),'show',revision+':'+name],text=True,stderr=subprocess.DEVNULL)


def namespace(text):
    scope={'__name__':'_offline_gate_source','__file__':'/offline/source.py'}
    exec(compile(text,'frozen_eval_source','exec'),scope)
    return scope


def live_pin(tree,report):
    data=Path(report).read_bytes();reviewed=json.loads(data);tree=Path(tree)
    if hashlib.sha256(data).hexdigest()!=INSTALLED:raise ValueError('Use the installed live report')
    release=namespace((tree/'ai_release.py').read_text())
    files={n:hashlib.sha256(json.dumps(release['model_text']((tree/n).read_text())).encode()).hexdigest() for n in release['FILES']['kit']}
    text=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()
    models={'provider':'gemini','model':'gemini-3.8-flash'}
    fingerprint=hashlib.sha256(json.dumps(dict(scheme=2,text=text,models=models),sort_keys=True).encode()).hexdigest()
    kit=reviewed.get('kit',{})
    if not (reviewed.get('reviewed') is True and reviewed.get('ai_text')==text and reviewed.get('models')==models
            and reviewed.get('candidate_fingerprint')==fingerprint and kit.get('case_count',0)>=40
            and all(kit.get(k)==0 for k in ('unsupported_numeric_claims','isolation_failures','health_disclosures'))
            and all(kit.get(k) is True for k in ('baseline_compared','conversation_review_passed','qualitative_review_passed'))):
        raise ValueError('Installed report does not approve frozen live source')
    return dict(baseline_commit=LIVE,installed_report_sha256=INSTALLED,baseline_ai_text=text,baseline_fingerprint=fingerprint,baseline_files=files)


def prepare(root,tree,report,history=None):
    root=Path(root)
    if subprocess.run(['git','-C',str(root),'diff','--quiet',CANDIDATE,'--','app']).returncode:
        raise ValueError('Candidate app must be byte-identical to weekly PR1579')
    pin=live_pin(tree,report);pin['candidate_app_commit']=CANDIDATE
    if not history:return pin,None
    data=Path(history).read_bytes();old=json.loads(data);revision=old.get('candidate_commit','')
    if len(revision)!=40 or any(c not in '0123456789abcdef' for c in revision):raise ValueError('Invalid historical source')
    if old.get('baseline_commit')!=LIVE or old.get('baseline_pin',{}).get('baseline_files')!=pin['baseline_files'] or old.get('baseline_report_sha256')!=INSTALLED:
        raise ValueError('Historical baseline must use the same frozen live tree and installed report')
    read=lambda n:source(root,revision,n)
    from kit_cases import CASES
    from kit_gate_cases import GATE_CASE_IDS
    from kit_batch2_history_cases import historical_cases
    old_cases=historical_cases(read)
    identity=namespace(read('dev/evals/kit_gate_resume.py'))['identity']
    if old.get('input_digest')!=identity(root,old_cases,LIVE,revision,old['baseline_sha256'],read=read):
        raise ValueError('Historical inputs or UTC/local dates changed; omit --reuse-baseline for a fresh comparison')
    def seed(s):return s[s.index(' with db.connect() as c:\n  for suffix'):s.index(' def run(item):')]
    if seed(read('dev/evals/kit_eval.py'))!=seed((root/'dev/evals/kit_eval.py').read_text()):raise ValueError('Generic seed changed')
    if read('dev/evals/kit_cases.py')!=(root/'dev/evals/kit_cases.py').read_text():raise ValueError('Case inputs changed')
    before=read('dev/evals/kit_weekly_fixtures.py');after=(root/'dev/evals/kit_weekly_fixtures.py').read_text()
    def without_wrapper(s):
        tree=ast.parse(s);tree.body=[n for n in tree.body if not isinstance(n,ast.FunctionDef) or n.name!='run_weekly_answer']
        return ast.dump(tree,include_attributes=False)
    if without_wrapper(before)!=without_wrapper(after):raise ValueError('Weekly seed/period/history changed')
    # Execute only the two pure fixture wrappers with a recorder, proving the actual
    # baseline question/history (including null omission) still matches, not just the case name.
    calls=[]
    for s in (before,after):
        ns=namespace(s)
        def record(*args,**kwargs):calls.append((args,kwargs));return {'interpretation':'stand-in'}
        ns['run_weekly_answer'](record,1,ns['request_contract']('c','g','v'),history=[{'role':'user','text':'prior'}],guidance='starter')
    if len(calls)!=2 or calls[0]!=calls[1]:raise ValueError('Weekly baseline provider question changed')
    # Actual starter guidance, not merely the wrapper, must also remain identical.
    def guidance(s):
        return next(ast.dump(n.value,include_attributes=False) for n in ast.parse(s).body
                    if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='STARTER_GUIDANCE' for t in n.targets))
    if guidance(read('app/kit_thread.py'))!=guidance((root/'app/kit_thread.py').read_text()):raise ValueError('Starter guidance changed')
    eligible={c[0]:c for c in CASES if c[0] in GATE_CASE_IDS and c in old_cases}
    rows=[];seen=set()
    for row in old.get('results',[]):
        if row.get('variant')!='baseline' or row.get('case') not in eligible:continue
        cid=row['case']
        if cid in seen:raise ValueError('Duplicate historical baseline row')
        seen.add(cid)
        if row.get('interrupted') or type(row.get('provider_requests')) is not int or row['provider_requests']<0:continue
        if not row['provider_requests'] and not row.get('expected_refusal'):
            if cid!='low-intake':continue
            claim_tree=ast.parse((Path(tree)/'kit_claims.py').read_text())
            safety=next(n for n in claim_tree.body if isinstance(n,ast.FunctionDef) and n.name=='eating_safety_answer')
            scope={'re':__import__('re')};exec(compile(ast.Module(body=[safety],type_ignores=[]),'frozen_safety','exec'),scope)
            if row.get('error') or row.get('answer')!=scope['eating_safety_answer'](row['question']):continue
        if row.get('question')!=eligible[cid][1]:raise ValueError('Historical question differs')
        rows.append(dict(row,reused=True,historical_baseline=True))
    cache=dict(baseline_commit=LIVE,installed_report_sha256=INSTALLED,dates=dates(),
               source_report_sha256=hashlib.sha256(data).hexdigest(),source_report_commit=revision,
               results=rows,candidate_rows_reused=0,proven_cases=sorted(eligible))
    return pin,cache


def dates():
    return [dt.datetime.now(dt.timezone.utc).date().isoformat(),dt.datetime.now(ZoneInfo('America/Los_Angeles')).date().isoformat()]


def cached_baseline(cache,cases,baseline):
    if cache.get('dates')!=dates() or cache.get('baseline_commit')!=baseline or cache.get('installed_report_sha256')!=INSTALLED:
        raise ValueError('Historical baseline cache has wrong dates/source/report')
    ids={c[0] for c in cases};seen=set()
    for row in cache['results']:
        if row.get('variant')!='baseline' or row.get('case') not in ids or row['case'] in seen or not row.get('historical_baseline'):
            raise ValueError('Invalid historical baseline cache')
        seen.add(row['case'])
    return cache['results']


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--tree',required=True);p.add_argument('--installed-report',required=True)
    p.add_argument('--reuse-baseline');p.add_argument('--output-dir',required=True);args=p.parse_args()
    root=Path(__file__).resolve().parents[2];pin,cache=prepare(root,args.tree,args.installed_report,args.reuse_baseline)
    for name,value in (('pin.json',pin),('baseline-cache.json',cache)):
        if value is not None:(Path(args.output_dir)/name).write_text(json.dumps(value,default=lambda x:sorted(x)))
    print(json.dumps(dict(baseline_rows_reused=len(cache['results']) if cache else 0,candidate_rows_reused=0)))
