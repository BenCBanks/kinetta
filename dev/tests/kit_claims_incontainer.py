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


check('Your distance was higher than the previous period, recorded at {e2:0}.')
check('Your distance was lower than the previous period, recorded at {e2:0}.',expected='relation_unsupported')
check('Your protein was recorded at {e2:0}.',expected='topic_unsupported')
for word in ('improved','better','worse','stronger','weaker','fitter','most','least','worst','dropped','rose','rising','fell','falling','further','farther'):
    check('Your fitness was '+word+'.',expected='relation_unsupported',facts=[])
check('Your most recent run was recorded at {e2:0}.')
check('Your distance increased because you recovered, recorded at {e2:0}.',expected='relation_unsupported')
check('Your run felt tired.',expected='voice_invalid',facts=[])
check('You felt tired.',facts=[],question='I felt tired.')
check('You felt tired.',expected='voice_invalid',facts=[],question='I felt good.')
check('You felt tired.',expected='voice_invalid',facts=[],question='I did not feel tired.')
check('You felt tired.',expected='voice_invalid',facts=[],question='Did I feel tired?')
check("I can’t tell how you felt. Add a note about this run.",facts=[])
check('Choose shorter workouts if time is tight.',facts=[])
check('You can try a shorter workout.',facts=[])
check('You have diabetes.',expected='health_claim',facts=[])
check('Stop your medication.',expected='health_claim',facts=[])
check('Ask a clinician about persistent pain.',facts=[])
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
