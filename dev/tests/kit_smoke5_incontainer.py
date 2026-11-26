"""Exact latest fictional capture replay and meal/weekly/strength regressions; no provider."""
import copy,json
from app import coach_chat,kit_conversation
rows=json.load(open('/tmp/kit-smoke5-fixtures.json'))
counts={'pass':0,'reject':0};outputs={}
for row in rows:
    try:
        answer=coach_chat.checked_answer(coach_chat._json(row['raw_model_json']),row['evidence'],
                                        kit=True,weekly_review=row['weekly_review'])
    except ValueError as error:
        counts['reject']+=1
        assert (row['case']=='weekly-no-plan' and str(error)=='Invalid evidence path'
                or row['case'] in {'strength','nutrition-adequacy'} and str(error)=='numeric_unsupported'
                or row['case']=='conversation-detail' and str(error)=='Unverified numeric symbol'),(row['case'],str(error))
    else:
        counts['pass']+=1;outputs[row['case']]=answer
assert len(outputs)==9 and counts=={'pass':10,'reject':4},(counts,outputs.keys())
weekly=outputs['weekly-no-plan']
assert '2 more workouts than the week before' in weekly['interpretation']
assert '5' not in weekly['interpretation'] and 'five days were unlogged' in weekly['interpretation']
assert 'answer_blocks' in weekly and 'weekly_review' not in weekly
row=next(r for r in rows if r['case']=='weekly-no-plan')
bad=copy.deepcopy(row['evidence']);bad[3]['data']['logged_days']=3
try:coach_chat.checked_answer(coach_chat._json(row['raw_model_json']),bad,kit=True,weekly_review=True)
except ValueError:pass
else:raise AssertionError('Wrong weekly count accepted')
# A successful correction omitted all facts. The selected candidate still supplies its known totals.
meal=outputs['meal'];assert 'This meal provides 350 kcal and 20 g protein.' in meal['interpretation']
assert not meal['facts'] and meal['selection']['confirmation_required']
raw=coach_chat._json(next(r for r in rows if r['case']=='strength' and 'repetitions counted' in r['raw_model_json'])['raw_model_json'])
raw['blocks'][1]['items']=['{e2:0} reps at {e2:1}.','{e2:2} reps at {e2:3}.']
row=next(r for r in rows if r['case']=='strength')
strength=coach_chat.checked_answer(raw,row['evidence'],kit=True)
assert '8 reps at 88.2 lb' in strength['interpretation']
assert '6 reps at 99.2 lb' in strength['interpretation']
assert '8 reps at 88.2 lb' in outputs['strength']['interpretation']
assert kit_conversation.meal_summary(None,[],[]) is None
for bad in (None,float('nan'),True):
    assert kit_conversation.meal_summary({'kind':'food','candidate':{'totals':{'kcal':350,'protein_g':bad}}},[],[]) is None
print('Smoke5 exact raw replay:',counts,'; weekly count, selected-meal totals and natural strength stand-in PASS; no provider calls')
