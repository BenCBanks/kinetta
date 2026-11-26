"""Scoped offline migration of the fixed release-review captures; never calls a provider.

The archived report stays intact. Prove exact old inputs and a closed set of
validation/render-only edits, replay every candidate, and retain original provenance.
This is fresh evaluation evidence, not a fingerprint equivalence or human approval.
"""
import argparse
import ast
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from kit_eval_savings import case_keys, write_private
from kit_batch2_cases import BATCH2_CASES

SOURCE = 'cea140b1621ee2ad6d5a2a23fc17e200e2ebc8cf'
REGENERATE = frozenset({'recovery','load'})
# Exact replacement-node hashes; any further source/prompt/reader change needs a new review.
APP_CHANGES = {'app/kit_claims.py': {'validate': '65532a6dd8994c3b83c244d12f97c49f1cc572b76a41848d458ef85186c2b563',
                       'advice_quantities': '2169938c1d0799cff25ec3d59b4ec09c46df053c4b72972455d9a1bc7bb06032',
                       'METRICS': 'ae36f133881267cade2d459d8422e38b985b92c9d69f9867a5b8676e7f17c116',
                       'claim_evidence': '20a4c261d0dadd11e77b2f435414a280891d42695151b9ca0c08c58051e4eb6f',
                       'activity_scopes': '4a0dfb1c8662e684c9a300faab6d9525203aabbc85cc3a58c4af98f3fd805128'},
 'app/kit_record_counts.py': {'bind': '6145353ee7218b55ac3266d3fe57759c56f0856166c76e50ee83f29008b53c3a'},
 'app/kit_recovery.py': {'fallback': '93eac1e08d1ea35a2dcc57083831d72e29608516b2ca8b58e148ba8b5ba05fb5',
                         'safe': 'e6126d1e542686233ed0314700fcf8c6a5ed76cd369677865ab7e82e78701425',
                         'context_step': '24db657b03efd45bbb33233d2156a9c920a30f86abb94d584411b4a9eb5ea728'},
 'app/kit_training_review.py': {'visual': '26c087a994edebe980a5dcccd6b30d0d849df86f9fe9112d6d076a78949f4c8e'},
 'app/kit_weekly.py': {'fallback': 'aa8fcd17f1ae75e9b83a66bb51b32345c220af472f9c056c63c417db0d44723e'},
 'app/progress_series.py': {'read_series': '83d2244abfe25007c36ee26295a1bb67d957c58eaf1eeb0ac8b239e4e1eebac1'}}


def git(root,*args):
    return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.DEVNULL)


def canonical(source,names=()):
    tree=ast.parse(source)
    tree.body=[n for n in tree.body if not (
        isinstance(n,ast.FunctionDef) and n.name in names or
        isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in names for t in n.targets))]
    return ast.dump(tree,include_attributes=False)


def node_hashes(source,names):
    return {n.name if isinstance(n,ast.FunctionDef) else n.targets[0].id:
            hashlib.sha256(ast.dump(n,include_attributes=False).encode()).hexdigest()
            for n in ast.parse(source).body if isinstance(n,ast.FunctionDef) and n.name in names
            or isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in names}


class OldPath:
    def __init__(self,root,name=''):self.root,self.name=root,name
    def __str__(self):return str(self.root)
    def __truediv__(self,name):return OldPath(self.root,str(Path(self.name)/name))
    def read_text(self):return git(self.root,'show',SOURCE+':'+self.name).decode()


def prove(root,report):
    if report.get('candidate_commit')!=SOURCE or report.get('fixture_date')!='2026-11-26':
        raise ValueError('Use the original pinned full release-review capture')
    old_keys=case_keys(OldPath(root),BATCH2_CASES,report['baseline_commit'],SOURCE)
    for row in report['results']:
        if row.get('case_input_digest')!=old_keys[row['variant']].get(row['case']):
            raise ValueError('Archived case inputs/source cannot be verified: '+row['case'])
    changed=git(root,'diff','--name-only',SOURCE,'--','app').decode().splitlines()
    for name in changed:
        if name=='app/ai_fingerprints.json':continue  # ledger is never used as reuse proof
        hashes=APP_CHANGES.get(name)
        if hashes is None:raise ValueError('Provider input/source changed: '+name)
        before=git(root,'show',SOURCE+':'+name).decode();after=(root/name).read_text()
        if canonical(before,hashes)!=canonical(after,hashes) or node_hashes(after,hashes)!=hashes:
            raise ValueError('Unreviewed source changed: '+name)
    # Seed, context assembly and provider-call options are identical. Only reviewer
    # fields were added to run(); strip those exact dict entries and one import.
    class Reporting(ast.NodeTransformer):
        def visit_Dict(self,node):
            self.generic_visit(node)
            kept=[(k,v) for k,v in zip(node.keys,node.values) if not isinstance(k,ast.Constant)
                  or k.value not in {'context_evidence','app_tool_evidence'}]
            node.keys=[k for k,v in kept];node.values=[v for k,v in kept];return node
        def visit_ImportFrom(self,node):
            return None if node.module=='kit_review_evidence' else node
    def reporting(source):return ast.dump(Reporting().visit(ast.parse(source)),include_attributes=False)
    for name in ('kit_eval.py','kit_weekly_fixtures.py','kit_batch2_cases.py','kit_fixture_clock.py'):
        path='dev/evals/'+name;old=git(root,'show',SOURCE+':'+path).decode();new=(root/path).read_text()
        if reporting(old)!=reporting(new):raise ValueError('Fictional/provider inputs changed: '+path)
    return old_keys


def replay(report,keys,current):
    from app import ai_release, coach_chat, kit_recovery, kit_weekly, kit_training_review
    from kit_review_evidence import context_evidence
    from unittest.mock import patch
    import time
    results=[]
    for row in report['results']:
        original=row
        if row['variant']=='candidate' and row['case'] in REGENERATE:continue
        if row['variant']=='candidate' and not row.get('expected_refusal'):
            turns=row.get('provider_turns') or []
            raw=next((t['raw_model_json'] for t in reversed(turns) if t.get('raw_model_json')),None)
            if raw:
                context=(row.get('observed_context') or [{}])[0]
                question=context.get('question',row['question'])
                fallback=False
                checked=None
                # Production stops at its first valid answer; do not substitute a later
                # correction when the original captured answer now verifies honestly.
                for turn_index,turn in enumerate(turns):
                    if not turn.get('raw_model_json'):continue
                    try:checked=coach_chat.checked_answer(coach_chat._json(turn['raw_model_json']),row['answer_evidence'],kit=True,
                        weekly_review=row.get('weekly_review',False),conversation_question=question)
                    except ValueError:continue
                    row={**row,'selected_provider_turn':turn_index};break
                if checked is None:
                    if not (row.get('answer') or {}).get('app_fallback'):raise
                    with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True),patch('app.db.coach_connect'):
                        state=dict(uid=987,evidence=row['answer_evidence'],usage={},began=time.monotonic(),
                                   history=context.get('history',row.get('history',[])))
                        checked=(kit_weekly.fallback(987,question,state,None) if row.get('weekly_review') else
                                 kit_recovery.fallback(987,question,state,None,'answer_verification'))
                    fallback=True
                # Automatic charts read after the answer; their measured sources were
                # separately observed. Rebuild the app card, never recycle its old zero trend.
                if (row.get('answer') or {}).get('chart',{}).get('presentation')=='weekly_totals':
                    charts=[t for t in row['tool_calls'] if t['tool']=='chart_series' and 'data' in t]
                    profiles=[t for t in row['tool_calls'] if t['tool']=='profile' and 'data' in t]
                    if len(charts)!=1 or not profiles:raise ValueError('Automatic card evidence missing')
                    checked.update(kit_training_review.visual(charts[0]['data'],profiles[-1]['data']))
                answer={**row['answer'],**checked}
                if not fallback:
                    answer.pop('app_fallback',None);answer.pop('fallback_reason',None)
                row={**row,'answer':answer,'rejection':None,'error':None,'passed':True,
                     'claim_evidence':checked.get('claim_evidence',[])}
        row={**row,'context_evidence':context_evidence(row['question'],row.get('history',[]),row.get('observed_context')),
             'app_tool_evidence':row.get('tool_calls',[]),'case_input_digest':keys[row['variant']][row['case']],
             'revalidated':row['variant']=='candidate','replay_provider_calls':0,'reused':True,
             'source_commit':original.get('source_commit',report[row['variant']+'_commit'])}
        results.append(row)
    text=ai_release.ai_text('kit')
    fingerprint=hashlib.sha256(json.dumps(dict(scheme=2,text=text,models=report['models']),sort_keys=True).encode()).hexdigest()
    return {**report,'candidate_commit':current,'candidate_fingerprint':fingerprint,'ai_text':text,
            'results':results,'reviewed':False,'complete':False,'new_spend_usd':0,
            'owner_qualitative_review':'pending','reused_responses':len(results),'new_responses':0,
            'kit':dict(case_count=sum(r['variant']=='candidate' for r in results),
                unsupported_numeric_claims=None,isolation_failures=None,health_disclosures=None,
                baseline_compared=None,conversation_review_passed=None,qualitative_review_passed=None),
            'source_report_commit':SOURCE,'offline_replay_only':True,'release_ready':False,
            'replay_summary':dict(reused=len(results),remaining=sorted(REGENERATE),provider_calls=0,
                app_fallbacks=sum(bool((r.get('answer') or {}).get('app_fallback')) for r in results if r['variant']=='candidate'))}


def main():
    p=argparse.ArgumentParser();p.add_argument('--capture',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path);p.add_argument('--in-container',action='store_true')
    args=p.parse_args();root=Path(__file__).resolve().parents[2]
    if args.in_container:
        value=json.loads(args.capture.read_text());result=replay(value['report'],value['keys'],value['current'])
        print(json.dumps(result));return
    report=json.loads(args.capture.read_text());prove(root,report)
    current=git(root,'rev-parse','HEAD').decode().strip()
    if git(root,'status','--porcelain','--','app','dev/evals','dev/tests'):raise ValueError('Commit before preparing replay cache')
    value=dict(report=report,keys=case_keys(root,BATCH2_CASES,report['baseline_commit'],current),current=current)
    import tempfile
    with tempfile.TemporaryDirectory() as temp:
        path=Path(temp)/'input.json';write_private(path,value);path.chmod(0o644)
        result=json.loads(subprocess.check_output(['docker','run','--rm','--network','none','-e','PYTHONPATH=/srv',
            '-v',str(root)+':/srv:ro','-v',str(path)+':/tmp/input.json:ro',
            'ghcr.io/bencbanks/kinetta:latest','python','/srv/dev/evals/kit_release_replay.py',
            '--in-container','--capture','/tmp/input.json','--output','/tmp/unused.json']))
    result['source_report_sha256']=hashlib.sha256(args.capture.read_bytes()).hexdigest()
    write_private(args.output,result);print(json.dumps(result['replay_summary']))


if __name__=='__main__':main()
