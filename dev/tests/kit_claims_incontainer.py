"""Fictional claim checks and regressions from owner-run fictional evaluation; no provider calls."""
import copy
import json
from unittest.mock import patch
from app import coach_chat, kit_claims

profile={'evidence_id':'e1','tool':'profile','data':{'units':'metric','today':'2026-11-25'}}
comparison={'evidence_id':'e2','tool':'period_compare','data':{
    'current':{'totals':{'distance_m':15000},'known_totals':{'protein_g':54}},
    'previous':{'totals':{'distance_m':10000}},
    'change':{'distance_m':{'absolute':5000},'workouts':{'absolute':2}}}}
evidence=[profile,comparison]
fact={'evidence_id':'e2','path':['current','totals','distance_m'],'value':15000}


def check(text, *, expected=None, facts=None, records=evidence, question=''):
    raw={'blocks':[{'kind':'paragraph','text':text}],'facts':facts if facts is not None else [fact]}
    try:result=coach_chat.checked_answer(raw,records,kit=True,conversation_question=question)
    except kit_claims.ClaimRejected as error:
        assert error.reason_code==expected,(text,error.reason_code,expected)
        assert str(error)==error.reason_code and error.reason_code in kit_claims.CODES
    else:
        assert expected is None,(text,expected)
        return result


check('The recorded value was {e2:0} during the week.')
check('The recorded value was within {e2:0}.')
check('Your distance was higher than the previous period, recorded at {e2:0}.')
for text in (
    'Your distance was recorded at {e2:0}; choose a shorter session when time is tight.',
    'To build a sustainable routine around your saved running goal, balance easy efforts with adequate rest.',
    'Your saved plan can help you build a more consistent routine.',
    'Your most recent run was recorded at {e2:0}.',
    'Choose shorter workouts if time is tight.',
    'You can try a shorter workout.',
    "I can’t tell how you felt. Add a note about this run.",
):check(text)
check('You have diabetes.',expected='health_claim',facts=[])
check('Stop your medication.',expected='health_claim',facts=[])
check('Ask a clinician about persistent pain.',facts=[])
check('You recorded seventy workouts.',expected='numeric_unsupported',facts=[])
check('You recorded three workouts.',expected='numeric_unsupported',facts=[])
check('Here is one useful next step: choose a routine you enjoy.',facts=[])
try:kit_claims.ClaimRejected('provider text')
except ValueError:pass
else:raise AssertionError('Closed rejection codes only')

weekly={'verdict':'You logged workouts covering {e2:0} and {e2:1} across the week.',
 'reason':'Training activity increased with {e2:2} compared to the previous week.',
 'facts':[{'evidence_id':'e2','path':['current','known_totals','distance_m'],'value':10000.0},
          {'evidence_id':'e2','path':['current','known_totals','duration_s'],'value':3600.0},
          {'evidence_id':'e2','path':['change','workouts','absolute'],'value':2}],
 'weekly_review':{'what_went_well':'You recorded completed sessions after having no workouts logged the prior week.',
                 'what_to_change':'Food records were missing on several days, making full nutritional patterns unknown.',
                 'next_week_focus':'Aim to log meals consistently so your energy intake matches training demands.'},
 'selection':None,'actions':[],'follow_ups':[]}
weekly_ev=[profile,{'evidence_id':'e2','tool':'period_compare','data':{
 'current':{'known_totals':{'distance_m':10000.0,'duration_s':3600.0,'protein_g':54.0}},
 'change':{'workouts':{'absolute':2}}}}]
assert coach_chat.checked_answer(weekly,weekly_ev,kit=True,weekly_review=True)['facts'][2]['value']==2
protein=copy.deepcopy(weekly)
protein['facts'][2]={'evidence_id':'e2','path':['current','known_totals','protein_g'],'value':54.0}
protein['reason']='Your recorded activity totaled {e2:1}.'
protein['weekly_review']['what_to_change']='Food logs were incomplete, with a known intake totaling {e2:2}.'
assert '54 g' in coach_chat.checked_answer(protein,weekly_ev,kit=True,weekly_review=True)['weekly_review']['what_to_change']
crosswired=copy.deepcopy(protein);crosswired['weekly_review']['what_to_change']='Food intake was {e2:0}.'
try:coach_chat.checked_answer(crosswired,weekly_ev,kit=True,weekly_review=True)
except ValueError:pass
else:raise AssertionError('True food/training cross-wire still rejected')

# An exact real-output reference error still fails; one no-tools correction can fix it, never silently remap.
bad=copy.deepcopy(protein);bad['facts'][2]['evidence_id']='e4'
weekly_ev.append({'evidence_id':'e4','tool':'nutrition_adequacy','data':{'summary':{'protein_g':{'comparable_day_subtotal':54.0}}}})
bad['facts'][2]['path']=['summary','protein_g','comparable_day_subtotal']
try:coach_chat.checked_answer(bad,weekly_ev,kit=True,weekly_review=True)
except ValueError as error:assert str(error)=='Unknown or mismatched numeric reference'
else:raise AssertionError('Evidence IDs must never be guessed')

def tool(self,name,args,**kwargs):
    return profile['data'] if name=='profile' else next((e['data'] for e in weekly_ev if e.get('tool')==name),{})
for fixed in (True,False):
    rounds=[]
    def stand_in(messages,definitions):
        assert definitions==[];rounds.append(1)
        return [],json.dumps(protein if fixed and len(rounds)==2 else bad),{}
    with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True), \
         patch('app.coach.provider',return_value='gemini'),patch('app.kit_tools.KitTools.call',tool):
        try:answer=coach_chat.answer(1,'Review my week',kit=True,weekly_review=True,turn=stand_in)
        except ValueError:assert not fixed
        else:assert fixed and answer['weekly_review']
    assert len(rounds)==2
print('Kit claims + weekly reference/delta/nutrient/correction regressions PASS; no provider calls')

for unit in ('miles','grams','kcal','watts','seventy'):
    bad={'blocks':[{'kind':'paragraph','text':'The recorded value was {e2:0} '+unit+'.'}],'facts':[fact]}
    try:coach_chat.checked_answer(bad,evidence,kit=True)
    except ValueError:pass
    else:raise AssertionError('Extra numeric/unit suffix accepted: '+unit)

# The correction must not escape claim validation by switching to a legacy shape.
legacy_unsafe={'verdict':'You have diabetes.','reason':'This is a personal diagnosis.','facts':[]}
for initial,correction,should_pass in (
    ({'blocks':[{'kind':'paragraph','text':'You have diabetes.'}],'facts':[]},legacy_unsafe,False),
    (legacy_unsafe,{'blocks':[{'kind':'paragraph','text':'Ask a clinician about persistent symptoms.'}],'facts':[]},True),
):
    calls=[]
    def provider(messages,definitions,**kwargs):
        calls.append(1);return [],json.dumps(initial if len(calls)==1 else correction),{}
    with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
         patch('app.kit_tools.KitTools.call',lambda *args,**kwargs:profile['data']), \
         patch('app.coach_chat._gemini_turn',provider):
        try:result=coach_chat.answer(1,'Help me understand my workout.',kit=True)
        except ValueError:assert not should_pass
        else:assert should_pass and result['answer_blocks']
    assert len(calls)==2

# Revoking consent after a bad weekly response prevents even the correction provider call.
calls=[]
def rejected_weekly(messages,definitions):
    calls.append(1)
    return [],json.dumps({'verdict':'The recorded value was {e9:0}.','reason':'These are recorded values.',
        'facts':[],'weekly_review':weekly['weekly_review']}),{}
with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',side_effect=[True,False]), \
     patch('app.coach.provider',return_value='gemini'),patch('app.coach_chat.db.coach_connect'), \
     patch('app.kit_tools.KitTools.call',tool):
    try:coach_chat.answer(1,'Review my week',kit=True,weekly_review=True,turn=rejected_weekly)
    except ValueError as error:assert str(error)==coach_chat.coach.HEALTH_NO
    else:raise AssertionError('Revoked consent accepted')
assert len(calls)==1
