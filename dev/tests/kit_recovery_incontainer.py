"""Owner-run fictional gate captures and recovery safety checks; no providers or database."""
import copy
import json
import time
from unittest.mock import patch
from app import coach_chat, kit_recovery, kit_conversation

rows=json.load(open('/tmp/kit-ordinary-recovery.json'))
assert len(rows)==30 and sum(r['passed'] for r in rows)==23
rejected=[]
for row in rows:
    if not row['raws']:continue  # The safety/refusal shortcuts made no provider response.
    if row['passed']:
        checked=coach_chat.checked_answer(coach_chat._json(row['raws'][-1]),row['evidence'],kit=True,conversation_question=row['question'])
        assert checked['interpretation']==row['answer']['interpretation'],row['case']
    else:
        for raw in row['raws']:
            try:coach_chat.checked_answer(coach_chat._json(raw),row['evidence'],kit=True,conversation_question=row['question'])
            except ValueError:pass
            else:raise AssertionError('Captured unsafe output unexpectedly accepted: '+row['case'])
        rejected.append(row)


def run(row, *, fail=None, health=True, enabled=True, active=None, corrections=True):
    evidence=row['evidence'];calls=[];tools=[]
    def tool(self,name,args):
        tools.append(name)
        return next(e['data'] for e in evidence if e['tool']==name and e.get('arguments',{})==args)
    def turn(messages,definitions):
        calls.append(definitions)
        if len(calls)==1 and len(evidence)>1:
            return [dict(name=e['tool'],args=e.get('arguments',{})) for e in evidence[1:]],'',{}
        if fail=='provider':raise ValueError('Kit could not answer right now. Try again shortly.')
        if fail=='programming':raise ValueError('Unknown programming failure')
        if fail=='limit':return [dict(name='profile',args={})],'',{}
        raw='{"blocks":[' if fail=='truncated' else row['raws'][min(len(calls)-2,len(row['raws'])-1)]
        return [],raw,dict(promptTokenCount=7,candidatesTokenCount=3)
    with patch('app.coach.allowed',return_value=enabled),patch('app.coach.off',return_value='off'), \
         patch('app.coach.provider',return_value='gemini'),patch('app.coach.health_ok',return_value=health), \
         patch('app.db.coach_connect'),patch('app.kit_tools.KitTools.call',tool), \
         kit_conversation.correction_policy(corrections):
        result=coach_chat.answer(987,row['question'],kit=True,turn=turn,active=active)
    return result,calls,tools

for row in rejected:
    answer,calls,tools=run(row)
    assert answer['app_fallback'] and answer['fallback_reason']=='answer_verification',row['case']
    assert answer['answer_blocks'] and 'could not verify' not in answer['interpretation'].lower()
    assert answer['selection'] is None and answer['actions']==[] and answer['follow_ups']==[]
    assert len(calls)==3 and calls[-1]==[], 'No retry beyond the existing bounded correction'
    assert answer['usage']['promptTokenCount']==14 and answer['usage']['candidatesTokenCount']==6
    assert {f['evidence_id'] for f in answer['facts']}<={e['evidence_id'] for e in row['evidence']}
    assert row['raws'][-1] not in answer['interpretation']
    if row['case'] in {'food-today','sugar','runs','weight'}:
        assert answer['facts'], (row['case'],answer)
    if row['case']=='sugar':assert 'entries each show 4 g sugar' in answer['interpretation']
    print(row['case'],answer['fallback_reason'],answer['interpretation'])

food=next(r for r in rejected if r['case']=='food-today')
for failure in ('provider','truncated','limit'):
    result,calls,_=run(food,fail=failure)
    assert result['app_fallback'] and len(calls)<=coach_chat.MAX_ROUNDS
    assert result['fallback_reason']==('answer_provider' if failure=='provider' else 'answer_limit' if failure=='limit' else 'answer_verification')
result,calls,_=run(food,corrections=False)
assert result['app_fallback'] and len(calls)==2
result,_,_=run(food,health=False)
assert result['facts'] and not result['health_included'], 'Own food remains available with Health consent off'
try:run(food,fail='programming')
except ValueError as error:assert str(error)=='Unknown programming failure'
else:raise AssertionError('Programming failures must not be hidden')
for enabled,active in ((False,None),(True,lambda:False)):
    try:run(food,enabled=enabled,active=active)
    except ValueError:pass
    else:raise AssertionError('Disabled/cancelled request recovered')

# Recheck consent, cancellation, enabled state and owner at the actual fallback boundary.
weight=next(r for r in rejected if r['case']=='weight')
state=dict(uid=987,evidence=weight['evidence'],usage={},began=time.monotonic())
with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=False),patch('app.db.coach_connect'):
    result=kit_recovery.fallback(987,weight['question'],state,None,'answer_verification')
    assert result['consent_refused'] and not result['facts'] and not result['health_included']
    assert 'weight' not in result['interpretation'].lower()
for enabled,active,owner in ((False,None,987),(True,lambda:False,987),(True,None,988)):
    with patch('app.coach.allowed',return_value=enabled),patch('app.coach.off',return_value='off'):
        try:kit_recovery.fallback(owner,weight['question'],state,active,'answer_verification')
        except ValueError:pass
        else:raise AssertionError('Recovery boundary guard bypassed')

# Missing/error/ambiguous results, unknown/invalid values and unavailable units never create claims.
for change in (
    lambda e:e[2].update(error='unavailable'),
    lambda e:e.append(copy.deepcopy(e[2])),
    lambda e:e[2]['data']['known_totals'].update(kcal=None,protein_g=None),
    lambda e:e[2]['data']['known_totals'].update(kcal=False,protein_g=float('inf')),
    lambda e:e[0]['data'].update(units='unknown'),
    lambda e:e[2]['data'].update(logged_days=0),
    lambda e:e[2]['data'].update(known_totals={'kcal':0,'protein_g':0},totals={'kcal':None,'protein_g':None}),
):
    evidence=copy.deepcopy(food['evidence']);change(evidence)
    with patch('app.coach.allowed',return_value=True):
        result=kit_recovery.fallback(987,food['question'],dict(state,evidence=evidence),None,'answer_verification')
        assert not any(f['tool']=='nutrition_summary' for f in result['facts'])
# Existing free low-intake protection and consent refusal remain clean, without recovery prose.
result,calls,_=run(next(r for r in rows if r['case']=='low-intake'))
assert not calls and not result.get('app_fallback') and 'doctor' in result['interpretation']
assert kit_recovery._attempt.get() is None
print('Ordinary gate replay: 21 accepted model replies unchanged; all 14 rejected outputs stay rejected; 7 checked app recoveries PASS. Consent/cancel/owner/unknown/provider/limit guards PASS; zero provider calls')

# A known-data nutrition assessment must not acquire an invented missing-nutrient
# reason, even in the last-resort generic fallback.
known = dict(uid=987,evidence=[dict(evidence_id='e1',tool='profile',data=dict(units='metric')),
    dict(evidence_id='e2',tool='nutrition_adequacy',data=dict(days=[],logged_days=0))],
    usage={},began=time.monotonic())
with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True),patch('app.db.coach_connect'):
    result=kit_recovery.fallback(987,'Compare my recorded calories and protein with my saved targets.',known,None,'answer_verification')
assert result['app_fallback'] and 'missing nutrient' not in result['interpretation']
assert result['facts']==[]
print('Known/no assessed nutrient gaps cannot be invented by the generic recovery PASS')
with patch('app.coach.allowed',return_value=True):
    state=dict(uid=987,evidence=[dict(evidence_id='e1',tool='profile',data=dict(units='metric'))],usage={},began=time.monotonic())
    result=kit_recovery.fallback(987,'Coaching context: old weight preference\nQuestion: Review my training',state,None,'answer_verification')
assert 'activity history' in result['interpretation'] and 'Progress' not in result['interpretation']
print('Recovery uses the current message instead of older context keywords PASS')
