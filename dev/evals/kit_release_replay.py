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

SOURCE = 'ec1eb655659d9c21c000f40847a7d48f46cd8851'
REGENERATE = frozenset()
# Only the three reviewed wording implications change. Provider inputs are frozen.
APP_CHANGES = {'app/kit_claims.py': {'VOLUME_CLAIM': '5e09fd8a1f8fe2a1403859a3609bc4d59e1b42e33aff08d3393cacbdcc5fdf3d', 'SPORT_WORD': 'ce00f23785e3a3eb6ebee0c94735206c935786cd6bf0643748a9a992ab199e29', 'volume_evidence': '47170c50de9fcd977b123fc6850eb51d79aa3c8bc9dcb5466fb8a442d0e6136b', 'safe_wording': '9b0d52c64e8b8ae78b83931e58622d616d82745028928ba525384ff3ac0c3642', 'claim_evidence': 'f677a0c1e9ea576d5b8fe11a8c6d90412b9ce4dfb1851e7b54bebff9b2b4b1c0', 'activity_scopes': '2473a0c1122ba63abd67dad5d3de8632888c3bb26d88d3d6f658c199309bc028'}, 'app/kit_conversation.py': {'checked_answer': '0fc397d52233d342e4d4f632a59a03e31b2ba15be4afa6929291a54d44c05c52'}}


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
    candidates=[r for r in report['results'] if r['variant']=='candidate']
    if len(report['results'])!=80 or len(candidates)!=40 or not all(r.get('passed') for r in candidates):
        raise ValueError('Use the completed final40/40capture; never invent a missing response')
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
                    if not turn.get('raw_model_json') or row.get('force_checked_fallback'):continue
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
                     'claim_evidence':checked.get('claim_evidence',[]),
                     'safe_render_changed':checked.get('interpretation')!=(original.get('answer') or {}).get('interpretation'),
                     'original_interpretation':(original.get('answer') or {}).get('interpretation')}
        row={**row,'context_evidence':context_evidence(row['question'],row.get('history',[]),row.get('observed_context')),
             'app_tool_evidence':row.get('tool_calls',[]),'case_input_digest':keys[row['variant']][row['case']],
             'revalidated':row['variant']=='candidate','replay_provider_calls':0,'reused':True,
             'source_commit':original.get('source_commit',report[row['variant']+'_commit'])}
        results.append(row)
    changed={r['case'] for r in results if r.get('safe_render_changed')}
    if changed-{'weekly-diet-request','batch2-memory-off','load'}:
        raise ValueError('Unrelated answer changed during scoped replay: '+','.join(sorted(changed)))
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
    if {r['case'] for r in report['results'] if r['variant']=='candidate'}!={c[0] for c in BATCH2_CASES}:
        raise ValueError('All completed cases must be accounted for')
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
