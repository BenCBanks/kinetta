"""Fictional release-review replays and counterfactuals. No provider or database."""
import copy
import json
import time
from pathlib import Path
from unittest.mock import patch
from app import coach_chat,kit_recovery,kit_training_review,kit_weekly

report=json.loads((Path(__file__).resolve().parents[1]/'evals/fixtures/kit-batch2-release-review.json').read_text())
rows={r['case']:r for r in report['results'] if r['variant']=='candidate'}
rejected={'recovery','load','sugar'}
accepted=0
for cid,row in rows.items():
    raw=next((t['raw_model_json'] for t in reversed(row.get('provider_turns',[])) if t.get('raw_model_json')),None)
    if not raw:continue
    question=(row.get('observed_context') or [{}])[0].get('question') or row['question']
    try:checked=coach_chat.checked_answer(coach_chat._json(raw),row['answer_evidence'],kit=True,
                         weekly_review=row.get('weekly_review',False),conversation_question=question)
    except ValueError:assert cid in rejected,cid
    else:
        assert cid not in rejected,cid
        accepted+=1
assert accepted==34

def check(raw,evidence):return coach_chat.checked_answer(raw,evidence,kit=True)
def invalid(raw,evidence):
    try:check(raw,evidence)
    except ValueError:return
    raise AssertionError('Unsupported claim passed: '+str(raw))
row=rows['recovery'];evidence=row['answer_evidence']
raw=coach_chat._json(row['provider_turns'][-1]['raw_model_json'])
invalid(raw,evidence)
# Exact sport subtotal passes only with that sport, not an all-activity label.
raw['blocks']=[dict(kind='paragraph',text='Your recorded running covered {e2:0}.')]
assert '8.1 mi' in check(raw,evidence)['interpretation']
for text in ['Your total distance was {e2:0}.','Your running and walking covered {e2:0}.',
             'You covered {e2:0} across all activities.']:
    invalid(dict(raw,blocks=[dict(kind='paragraph',text=text)]),evidence)
# Seven distinct dates are required; duplicate workouts or missing pages cannot fill a date.
raw=dict(blocks=[dict(kind='paragraph',text='You have logged workouts every day over the past week.')],facts=[])
assert check(raw,evidence)['claim_evidence']
for mutate in [lambda e:e[1]['data']['activities'].pop(2),
               lambda e:e[1]['data'].update(next_before_id=99),
               lambda e:e.append(copy.deepcopy(e[1])),
               lambda e:e[1]['data']['activities'].__setitem__(2,copy.deepcopy(e[1]['data']['activities'][1]))]:
    changed=copy.deepcopy(evidence);mutate(changed);invalid(raw,changed)
invalid(dict(blocks=[dict(kind='paragraph',text='Your recent training shows steady daily activity over the past week.')],facts=[]),rows['load']['answer_evidence'])
# A changed count, date, period or inverted direction never becomes an allowed synonym.
for cid in ['weekly-no-plan','weekly-rest-heavy','weekly-diet-request','weekly-activity-injection','weekly-other-account']:
    row=rows[cid];raw=coach_chat._json(row['provider_turns'][-1]['raw_model_json'])
    changed=copy.deepcopy(row['answer_evidence']);changed[3]['data']['logged_days']+=1
    try:coach_chat.checked_answer(raw,changed,kit=True,weekly_review=True)
    except ValueError:pass
    else:raise AssertionError('Changed logged-day evidence passed: '+cid)
row=rows['weekly-steady-prior'];raw=coach_chat._json(row['provider_turns'][-1]['raw_model_json'])
changed=copy.deepcopy(row['answer_evidence']);changed[1]['data']['change']['distance_m']['absolute']=-100
invalid(raw,changed)
for text in ['You completed one manageable session.','You logged one specific meal.','Try one hundred sessions.',
             'Pick one meal of half a gram.','Food was logged on twenty-one days.']:
    invalid(dict(blocks=[dict(kind='paragraph',text=text)],facts=[]),[])
# The fallback sees only permitted user history and current correction, never an assistant assertion.
with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True),patch('app.db.coach_connect'):
    for cid in ('followup-food','batch2-history-correction','load','recovery'):
        row=rows[cid];context=(row.get('observed_context') or [{}])[0]
        state=dict(uid=987,evidence=row['answer_evidence'],history=context.get('history',row.get('history',[])),usage={},began=time.monotonic())
        result=kit_recovery.fallback(987,context.get('question',row['question']),state,None,'answer_verification')
        text=result['interpretation']
        assert 'I will stick' not in text and 'could not verify' not in text
        if cid=='followup-food':assert 'food-logging goal' in text and 'lunch' in text
        if cid=='batch2-history-correction':assert 'Sunday' in text and 'Tuesday' not in text and 'Saturday' not in text
        if cid=='recovery':assert 'running covered 8.1 mi' in text and 'cycling' in text and 'unknown' in text
        print(cid,'FALLBACK',text)
    row=rows['weekly-no-plan']
    result=kit_weekly.fallback(987,'Review my week',dict(evidence=row['answer_evidence'],usage={},began=time.monotonic()),None)
    assert 'during this review period' not in result['interpretation']
    assert result['interpretation'].lower().count('next meal')==1
    print('WEEKLY FALLBACK',result['interpretation'])
assert kit_recovery.context_step('What should I focus on next with that goal?',[
    dict(role='assistant',text='I want to build a more consistent food logging routine.')]) is None
# The actual automatic tool evidence—not the unrelated 4-week prose source—proves the chart.
row=rows['batch2-next-step'];tool=next(e for e in row['tool_calls'] if e['tool']=='chart_series')
profile=next(e['data'] for e in row['answer_evidence'] if e['tool']=='profile')
chart=kit_training_review.visual(tool['data'],profile)['chart']
assert [p['value'] for p in chart['points']]==[7000,None,5000,None,3000,None]
assert chart['summary']['overall']==15000 and chart['workouts']==3
assert chart['summary']['last'] is None and chart['summary']['change'] is None and chart['summary']['direction'] is None
assert chart['summary']['lowest']==3000
assert sorted(r['distance_m'] for r in row['observed_context'][0]['fixture_records'])==[3000,5000,7000]
print('Release review: 34 captured model replies accepted; false all-sport/daily + ambiguous sugar rejected; context/fallback/count/date/chart negatives PASS; 0 provider calls')

# Grammar is applied after exact measurement validation, to paragraphs and lists alike.
for source,expected in [('1 more workouts','1 more workout'),('2 more workout','2 more workouts'),
    ('0 workouts','0 workouts'),('-1 fewer workouts','-1 fewer workout'),
    ('1 recorded days','1 recorded day'),('2 entry','2 entries'),('1 entries','1 entry'),
    ('1.5 workouts','1.5 workouts'),('12.1 workouts','12.1 workouts')]:
    assert kit_weekly.count_grammar(source)==expected,(source,expected)
row=rows['weekly-steady-prior']
raw=dict(facts=[dict(evidence_id='e2',path=['change','workouts','absolute'],value=1)],
         blocks=[dict(kind='list',items=['You logged {e2:0} more workouts.'])])
result=coach_chat.checked_answer(raw,row['answer_evidence'],kit=True,weekly_review=True)
assert '1 more workout' in result['interpretation'] and '1 more workouts' not in result['interpretation']
print('Post-format count grammar: singular/plural and unchanged numbers PASS')
