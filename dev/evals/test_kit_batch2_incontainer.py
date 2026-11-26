"""No-network proof of both frozen/candidate answer paths through saved-thread assembly."""
import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path
from unittest.mock import patch
from app import ai_budget, coach, coach_chat, db
from kit_batch2_cases import EXTRA, run_case
from kit_eval_support import load_baseline, configure_budget


def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',required=True);p.add_argument('--output',required=True)
    args=p.parse_args()
    assert os.environ.get('KINETTA_JOURNEY_FIXTURE')=='1', 'Disposable database only'
    baseline=load_baseline(args.baseline)
    root=Path(os.environ['KINETTA_KIT_BASELINE_DIR'])
    pin=json.loads(Path('/tmp/kit-live-pin.json').read_text())
    for name in ('coach_chat','coach_tools','kit_conversation','kit_tools','kit_claims'):
        module=importlib.import_module('app._kit_live.'+name)
        assert Path(module.__file__).parent==root, name+' loaded candidate source'
    assert baseline.db is db and baseline.ai_budget is coach_chat.ai_budget
    for module in (baseline,coach_chat):module.KitAnswer.model_json_schema()
    before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.py')}
    raw={'blocks':[{'kind':'paragraph','text':'Review your saved activity goal before choosing your next session.'}],
         'facts':[],'selection':None,'actions':['goals'],'follow_ups':[]}
    uids=[];seen=[]
    def provider(*args,**kwargs):
        seen.append(args);return [],json.dumps(raw),{'finishReason':'STOP'}
    try:
        with patch.dict(os.environ,{'KINETTA_AI_ENABLED':'1'}), \
             patch.object(coach,'provider',return_value='gemini'), \
             patch.object(baseline.coach,'provider',return_value='gemini'), \
             patch.object(coach_chat,'_gemini_turn',side_effect=provider), \
             patch.object(baseline,'_gemini_turn',side_effect=provider), \
             patch('urllib.request.urlopen',side_effect=AssertionError('Provider network forbidden')):
            for case in EXTRA:
                for variant,fn in (('baseline',baseline.answer),('candidate',coach_chat.answer)):
                    answer,error,requests,context=run_case(case,variant,fn,uids)
                    assert error is None and answer and requests==0,(case[0],variant,error)
                    assert len(context)==1
                    question=context[0]['question'];history=context[0]['history']
                    if case[3].get('resume'):assert history[0]['text']==case[3]['prior']
                    if case[3].get('memory_off'):assert 'Tuesday' not in question
                    elif case[3].get('memory'):assert case[3]['memory'] in question
            assert len(seen)==16
            # Exercise disposable app dollar/attempt caps, not just arithmetic.
            configure_budget(2.50)
            with ai_budget.scope(uids[0],feature='Offline batch2 cap proof'):
                for index in range(160):
                    attempt=ai_budget.reserve('gemini-3.8-flash','offline',
                        {'contents':[{'text':'fictional '*2000}],
                         'generationConfig':{'maxOutputTokens':8192 if index%2==0 else 16384}})
                    ai_budget.settle(attempt,{'usageMetadata':{'promptTokenCount':3000,'candidatesTokenCount':700}})
                    ai_budget.finish(attempt)
            with db.connect() as c:
                ledger=c.execute('SELECT count(*) AS n,sum(charged_micros) AS cost FROM ai_food_attempts WHERE user_id=ANY(%s)',(uids,)).fetchone()
            assert ledger['n']==160 and ledger['cost']==1560000,ledger
        assert before=={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in root.glob('*.py')}
        report={'offline_smoke':True,'reviewed':False,'release_evidence':False,'provider_calls':0,
                'standin_responses':len(seen),'baseline_pin':pin,'saved_history_memory_goal_input_paths':'pass',
                'quality_assessed':False,'simulated_attempts':160,'simulated_cost_usd':1.56}
        with os.fdopen(os.open(args.output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as f:
            json.dump(report,f,indent=2)
        print(json.dumps(report))
    finally:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))


if __name__=='__main__':main()
