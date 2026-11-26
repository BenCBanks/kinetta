"""Three fictional real-output regressions and evidence counterexamples; zero providers."""
import copy,json
from pathlib import Path
from app import coach_chat,kit_claims,kit_conversation
fixtures=Path('/tmp/kit-final-wording.json')
if not fixtures.exists():fixtures=Path(__file__).resolve().parents[1]/'evals/fixtures/kit-final-wording.json'
rows={r['case']:r for r in json.loads(fixtures.read_text())}

def raw(row):return coach_chat._json(next(t['raw_model_json'] for t in reversed(row['provider_turns']) if t.get('raw_model_json')))
def answer(row,data=None):
 return coach_chat.checked_answer(data or raw(row),row['answer_evidence'],kit=True,
    weekly_review=row.get('weekly_review',False),conversation_question=(row.get('observed_context') or [{}])[0].get('question',row['question']))

def reject(fn):
 try:fn()
 except ValueError:return
 raise AssertionError('Unsupported claim passed')

weekly=rows['weekly-diet-request'];data=raw(weekly)
result=answer(weekly)
assert 'up to' not in result['interpretation'] and 'running' not in result['interpretation']
assert '1h 0m' in result['interpretation'] and '6.2 mi of recorded workouts' in result['interpretation']
assert result['facts']==answer(weekly,data)['facts']
# Alternative unrewritten wording must still fail rather than imply an unknown trend/sport.
for text in ['Your recorded training time went up to {e2:1}.','Your recorded training time increased to {e2:1}.',
             'Your recorded running distance was {e2:2}.','You ran {e2:2}.']:
 reject(lambda:answer(weekly,dict(data,blocks=[dict(kind='paragraph',text=text)])))
# Known positive duration delta remains valid; unknown/inverted baselines cannot pass.
for delta,accepted in [(1800,True),(None,False),(-1800,False),(0,False)]:
 row=copy.deepcopy(weekly);row['answer_evidence'][1]['data']['change']['duration_s']['absolute']=delta
 sample=dict(data,blocks=[dict(kind='paragraph',text='Your recorded training time increased to {e2:1}.')])
 if accepted:assert 'increased' in answer(row,sample)['interpretation']
 else:reject(lambda:answer(row,sample))
# Rewriting does not rescue an invented number, another evidence ID or a non-current path.
for key,value in [('value',3601),('evidence_id','e99'),('path',['previous','totals','duration_s'])]:
 bad=copy.deepcopy(data);bad['facts'][1][key]=value;reject(lambda:answer(weekly,bad))

memory=answer(rows['batch2-memory-off'])['interpretation']
assert 'visible to Kit' in memory and 'off or unavailable' in memory
assert 'I do not have any training days saved' not in memory
# A false absence cannot contradict visible memory.
row=copy.deepcopy(rows['batch2-memory-off']);row['observed_context'][0]['question']=row['observed_context'][0]['question'].replace('"remembered_user_statements": []','"remembered_user_statements": [{"user_said": "I train on Tuesday."}]')
reject(lambda:answer(row))
# General fallback wording never asserts a memory setting the app has not supplied.
assert 'may be off or unavailable' in kit_claims.safe_wording('I do not have any training days saved or remembered from you.',[],[],None)

load=rows['load'];result=answer(load)
assert 'does not establish consistent workout volume' in result['interpretation']
assert 'steady recorded sessions' not in result['interpretation']
# The raw rule rejects extrapolation from equal (or varying) load scores.
for text in ['Your recent training shows steady recorded sessions.', 'You built consistent workout volume.']:
 reject(lambda:kit_claims.claim_evidence([text],load['answer_evidence']))
assert kit_claims.volume_evidence(load['answer_evidence'])==[]
# Actual equal, complete measured periods—not modelled load—can support volume.
period=copy.deepcopy(weekly['answer_evidence'][1])
for side in ['current','previous']:
 period['data'][side]['totals'].update(distance_m=10000,duration_s=3600,workouts=2)
for field in ['distance_m','duration_s','workouts']:period['data']['change'][field]['absolute']=0
assert len(kit_claims.volume_evidence([period]))==3
period['data']['previous']['totals']['duration_s']=None
assert kit_claims.volume_evidence([period])==[]
print('Final wording: unknown prior duration, all-sport scope, memory visibility and load-vs-volume safety PASS; zero providers')

assert kit_claims.safe_wording('You could aim for consistent workout volume.',[],[])=='You could aim for consistent workout volume.'
