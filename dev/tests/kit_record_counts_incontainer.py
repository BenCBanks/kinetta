"""Forty fictional captured candidates, evidence counterfactuals; no providers."""
import copy,json
from app import coach_chat,kit_claims,kit_record_counts
rows=json.load(open('/tmp/kit-training-review-replay.json'))
assert len(rows)==40 and len({r['case'] for r in rows})==40
accepted=0;rejected=[]
for row in rows:
    if not row['raws']:
        assert row['case'] in ('low-intake','recall-health-consent-off','weekly-health-consent-off')
        accepted+=1;continue
    for raw in row['raws']:  # Real runner stops on the first checked answer.
        try:
            answer=coach_chat.checked_answer(coach_chat._json(raw),row['evidence'],kit=True,
                weekly_review=row['weekly_review'],conversation_question=row['question'])
        except ValueError:continue
        assert row['expected']=='pass',row['case']
        accepted+=1
        if row['case']=='weekly-rest-heavy':
            assert '3 fewer workouts' in answer['interpretation'] and '-3 fewer' not in answer['interpretation']
            assert 'less time' in answer['interpretation'] and 'fell by 9.3 mi' in answer['interpretation']
        break
    else:
        assert row['expected']=='reject',row['case']
        rejected.append(row['case'])
assert accepted==38 and rejected==['sugar','nutrition-adequacy']

weekly=next(r for r in rows if r['case']=='weekly-diet-request')['evidence']
phrase='You recorded entries on three days.'
def bound(text,evidence,weekly=True):return kit_record_counts.bind(text,evidence,weekly_review=weekly)
assert bound(phrase,weekly)[1]
for text in ('You recorded entries on two days.','You recorded entries on twenty-three days.',
             'You recorded entries on thirty three days.','You recorded entries on three days last week.',
             'You never recorded entries on three days.','You completed three runs.'):
    assert not bound(text,weekly)[1],text
for mutate in (
    lambda e:next(s for s in e if s['tool']=='nutrition_adequacy')['data'].update(logged_days=True),
    lambda e:next(s for s in e if s['tool']=='nutrition_adequacy')['data'].update(start='1999-01-01'),
    lambda e:next(s for s in e if s['tool']=='nutrition_adequacy')['data'].update(truncated=True),
    lambda e:next(s for s in e if s['tool']=='nutrition_adequacy')['data'].update(unlogged_finished_days=0),
    lambda e:next(s for s in e if s['tool']=='period_compare')['data']['current'].update(food_logged_days=7),
    lambda e:next(s for s in e if s['tool']=='period_compare')['data']['current'].update(truncated=True),
    lambda e:next(s for s in e if s['tool']=='nutrition_adequacy').update(error='denied'),
    lambda e:e.append(copy.deepcopy(next(s for s in e if s['tool']=='nutrition_adequacy'))),
):
    evidence=copy.deepcopy(weekly);mutate(evidence)
    assert not bound(phrase,evidence)[1],'Ambiguous/invalid count bound'
assert not bound(phrase,weekly,False)[1]
food=next(r for r in rows if r['case']=='food-today')['evidence']
assert bound('You have logged two meals today.',food,False)[1]
for mutate in (
    lambda e:next(s for s in e if s['tool']=='food_log')['data'].update(next_before_id=9),
    lambda e:next(s for s in e if s['tool']=='food_log')['data']['foods'][0].update(day='1999-01-01'),
):
    evidence=copy.deepcopy(food);mutate(evidence)
    assert not bound('You have logged two meals today.',evidence,False)[1]
assert not bound('You ate two meals today.',food,False)[1]

limitation='Your full-week intake remains unknown rather than complete or low.'
assert kit_claims.claim_evidence([limitation],weekly)
for text,evidence in (
    ('Your full-week intake is low.',weekly),
    ('Your full-week intake remains unknown rather than low. Your weight is lower.',weekly),
    (limitation,[]),
    ('Logging consistently at the same time of day shows your heart rate is lower.',[]),
):
    try:kit_claims.claim_evidence([text],evidence)
    except ValueError:pass
    else:raise AssertionError('Unbacked direction bypassed: '+text)
empty=copy.deepcopy(weekly)
next(s for s in empty if s['tool']=='nutrition_adequacy')['data']['unlogged_finished_days']=0
try:kit_claims.claim_evidence([limitation],empty)
except ValueError:pass
else:raise AssertionError('Unknown-intake limitation lacks missing-log evidence')
rest=next(r for r in rows if r['case']=='weekly-rest-heavy')
for field in ('workouts','duration_s','distance_m'):
    evidence=copy.deepcopy(rest['evidence']);raw=coach_chat._json(rest['raws'][0])
    change=next(s for s in evidence if s['tool']=='period_compare')['data']['change'][field]
    change['absolute']=abs(change['absolute'])
    next(f for f in raw['facts'] if f['path']==['change',field,'absolute'])['value']=change['absolute']
    try:coach_chat.checked_answer(raw,evidence,kit=True,weekly_review=True)
    except ValueError:pass
    else:raise AssertionError('Reversed weekly decrease accepted: '+field)
weight=next(r for r in rows if r['case']=='weight')['evidence']
assert kit_claims.claim_evidence(['Your weight entries show a downward shift.'],weight)
for value in (1,True,float('nan'),float('inf'),None):
    evidence=copy.deepcopy(weight)
    next(s for s in evidence if s['tool']=='weight_trend')['data']['endpoint_change_kg']=value
    try:kit_claims.claim_evidence(['Your weight entries show a downward shift.'],evidence)
    except ValueError:pass
    else:raise AssertionError('Invalid/reversed weight direction accepted')
print('40 captured candidates: 38 accepted / 2 ambiguous outputs safely reject; count/date/completeness/direction counterfactuals PASS; zero provider calls')
