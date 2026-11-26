"""Fictional captured weekly replies, exact-count counterfactuals, and real runner failure recovery."""
import copy
import json
from unittest.mock import patch
from app import coach_chat, kit_weekly, kit_conversation

cases=json.load(open('/tmp/kit-weekly-live-replay.json'))
expected={
    'weekly-steady-prior':(True,False),  # Correction omits all comparison references.
    'weekly-sparse':(False,False),  # The aggregate proves a workout, not its sport.
    'weekly-no-plan':(True,True),
    'weekly-rest-heavy':(True,True),
    'weekly-activity-injection':(False,False),  # Implicit "none before" lacks a metric.
}
for case in cases:
    for raw,passes in zip(case['answers'],expected[case['case']]):
        try:result=coach_chat.checked_answer(raw,case['evidence'],kit=True,weekly_review=True)
        except ValueError:assert not passes,case['case']
        else:
            assert passes and result['answer_blocks'],case['case']
            if case['case']=='weekly-rest-heavy':assert 'down by 1h 30m' in result['interpretation'] and 'down by -' not in result['interpretation']

rest=next(c for c in cases if c['case']=='weekly-rest-heavy')
raw=copy.deepcopy(rest['answers'][0]);records=copy.deepcopy(rest['evidence'])
records[1]['data']['change']['duration_s']['absolute']=5400
raw['facts'][0]['value']=5400
try:coach_chat.checked_answer(raw,records,kit=True,weekly_review=True)
except ValueError:pass
else:raise AssertionError('Reversed down-by duration accepted')

case=next(c for c in cases if c['case']=='weekly-no-plan')
for mutate in (
    lambda e:e[3]['data'].update(logged_days=3),
    lambda e:e[3]['data'].update(logged_days=True),
    lambda e:e[3]['data'].update(start='1999-01-01'),
    lambda e:e[1]['data']['current'].update(food_logged_days=3),
    lambda e:e.append(copy.deepcopy(e[3])),
    lambda e:e[3].update(error='unavailable'),
):
    evidence=copy.deepcopy(case['evidence']);mutate(evidence)
    try:coach_chat.checked_answer(case['answers'][0],evidence,kit=True,weekly_review=True)
    except ValueError:pass
    else:raise AssertionError('Unbacked/ambiguous/prior-period food-day count accepted')
for text in ('Food was logged on three days.','Food was logged on twenty-two days.','You completed one run.','You logged seventy workouts.','You logged twenty-one logged sessions.','Food was logged on two days the previous week.','Food was not logged on two days.'):
    try:coach_chat.checked_answer(dict(blocks=[dict(kind='paragraph',text=text)],facts=[]),case['evidence'],kit=True,weekly_review=True)
    except ValueError:pass
    else:raise AssertionError(text)

# Exercise the real answer path, with actual captured tool returns and a provider stand-in.
evidence=case['evidence'];profile=evidence[0]['data']
def tool(self,name,args):
    return next(e['data'] for e in evidence if e['tool']==name)
for failure in ('invalid','provider','truncated','tool_call','no_correction'):
    calls=[]
    def turn(messages,definitions):
        assert definitions==[];calls.append(1)
        if failure=='provider':raise ValueError('Kit could not answer right now. Try again shortly.')
        if failure=='tool_call':return [dict(name='profile',args={})],'',{}
        return [],'{broken',dict(promptTokenCount=11,finishReason='MAX_TOKENS' if failure=='truncated' else 'STOP')
    with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True), \
         patch('app.coach.provider',return_value='gemini'),patch('app.db.coach_connect'), \
         patch('app.kit_tools.KitTools.call',tool),kit_conversation.correction_policy(failure!='no_correction'):
        result=coach_chat.answer(987,'Review my week',kit=True,weekly_review=True,turn=turn)
    assert result['app_fallback'] and len(calls)<=2 and '{broken' not in result['interpretation']
    assert result['usage']['promptTokenCount']==(11 if failure=='no_correction' else 22 if failure in ('invalid','truncated') else 0)
    assert result['weekly_period']['start']=='2026-11-19'
    assert result['facts'] and all(f['evidence_id'] in {'e2','e4'} for f in result['facts'])

state=dict(evidence=evidence,usage={},began=0)
with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=False),patch('app.db.coach_connect'):
    result=kit_weekly.fallback(987,'Review my week',state,None)
    assert result['consent_refused'] and not result['facts'] and not result['health_included']
for enabled,active in ((False,lambda:True),(True,lambda:False)):
    with patch('app.coach.allowed',return_value=enabled),patch('app.coach.off',return_value='off'):
        try:kit_weekly.fallback(987,'Review my week',state,active)
        except ValueError:pass
        else:raise AssertionError('Disabled/cancelled request recovered')
# Missing/error/stale results never create facts; fallback must not infer missing counts as zero.
for mutate in (lambda e:e[1].update(error='unavailable'),lambda e:e[1]['data']['current'].update(start='1999-01-01')):
    changed=copy.deepcopy(evidence);mutate(changed)
    with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True),patch('app.db.coach_connect'):
        result=kit_weekly.fallback(987,'Review my week',dict(state,evidence=changed),None)
        assert not any(f['evidence_id']=='e2' for f in result['facts'])
assert kit_weekly._attempt.get() is None
# A good weekly answer remains untouched; a failed correction uses only application facts.
for captured in cases:
    evidence=captured['evidence']
    for raw in captured['answers']:
        def captured_turn(messages,definitions):return [],json.dumps(raw),{}
        with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True),patch('app.coach.provider',return_value='gemini'),patch('app.db.coach_connect'),patch('app.kit_tools.KitTools.call',tool):
            result=coach_chat.answer(987,'Review my week',kit=True,weekly_review=True,turn=captured_turn)
            assert result['answer_blocks']
print('Weekly: 10 captured replies replayed (5 accepted/5 correctly rejected); bounded counts, provider/invalid/truncated fallback, consent/cancel/date checks PASS; zero provider calls')
