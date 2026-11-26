"""Exact fictional smoke raw replay plus plain weekly/provider/refusal regressions; no network."""
import copy,json,sys
from unittest.mock import patch
from app import coach_chat,kit_conversation,kit_claims
sys.path.insert(0,'/tmp/kit-smoke4-evals')
from kit_weekly_fixtures import is_expected_health_consent_refusal
rows=json.load(open('/tmp/kit-smoke4-fixtures.json'))
counts={'pass':0,'reject':0};covered=set();outputs={}
for row in rows:
    try:
        result=coach_chat.checked_answer(coach_chat._json(row['raw_model_json']),row['evidence'],
                                        kit=True,weekly_review=row['weekly_review'])
    except ValueError as error:state='reject'
    else:
        state='pass';covered.add(row['case']);outputs[row['case']]=result
        if not row['weekly_review']:
            kit_conversation.check_rendered(result['interpretation'])
            assert 'meal candidate' not in result['interpretation'].casefold()
    assert state==row['expected'],(row['case'],row['attempt'],state,row['expected'])
    counts[state]+=1
assert counts=={'pass':10,'reject':2},counts
assert '3 weekly runs' in outputs['conversation-detail']['interpretation']
assert '3 runs per week weekly runs' not in outputs['conversation-detail']['interpretation']
assert '20 g protein, 45 g carbohydrates, and 10 g fat' in outputs['meal']['interpretation']
assert 'two completed sets of Fictional squat' in outputs['strength']['interpretation']
assert '88.2 lb' in outputs['strength']['interpretation']
for bad in ('20 g meal candidate total protein protein','3 runs per week weekly runs','45 g carbohydrates carbohydrates'):
    try:kit_conversation.check_rendered(bad)
    except ValueError:pass
    else:raise AssertionError('Broken substitution passed its regression guard')
# Counts remain bound to the exact subject/current range; no global number exemption.
for case in ('strength','nutrition-adequacy'):
    row=next(r for r in rows if r['case']==case)
    raw=coach_chat._json(row['raw_model_json']);bad=copy.deepcopy(row['evidence'])
    if case=='strength':bad[1]['data']['summary_by_exercise'][0]['completed_sets']=3
    else:bad[1]['data']['unlogged_finished_days']=5
    try:coach_chat.checked_answer(raw,bad,kit=True)
    except ValueError:pass
    else:raise AssertionError('Invented subject-specific count accepted')
# Weekly's real production adapter now requests the conversational system and no tools.
row=next(r for r in rows if r['case']=='weekly-no-plan');ev=row['evidence']
raw={'blocks':[{'kind':'paragraph','text':'You logged {e2:0} more workouts than the week before.'},
               {'kind':'paragraph','text':'That gives you a starting routine to build on without adding more this week.'},
               {'kind':'paragraph','text':'Keep a routine that fits your week and log meals when you can.'}],
     'facts':[{'evidence_id':'e2','path':['change','workouts','absolute'],'value':2}],
     'selection':None,'actions':[],'follow_ups':['Help me keep a sustainable routine.']}
seen=[]
def tool(self,name,args):return next(e['data'] for e in ev if e['tool']==name)
def provider(messages,definitions,*,system):
    seen.append((definitions,system));return [],json.dumps(raw),{}
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
     patch('app.kit_tools.KitTools.call',tool),patch('app.coach_chat._gemini_turn',provider), \
     patch('app.coach_chat.db.coach_connect'),patch('app.coach.health_ok',return_value=True):
    answer=coach_chat.answer(1,'Review my week',kit=True,weekly_review=True)
assert answer['answer_blocks'] and 'weekly_review' not in answer
assert '2 more workouts than the week before' in answer['interpretation']
assert answer['weekly_period']['end']=='2026-11-24'
assert seen==[([],kit_conversation.WEEKLY_SYSTEM)]
body={'generationConfig':{}};kit_conversation.final_schema(body,kit_claims.weekly_system())
assert 'blocks' in body['generationConfig']['responseJsonSchema']['required']
assert 'weekly_review' not in body['generationConfig']['responseJsonSchema']['properties']
# A provider that repeats the legacy shape gets one no-tools correction, never an old-format display.
legacy=next(r for r in rows if r['case']=='weekly-no-plan')
seen=[]
def corrected_provider(messages,definitions,*,system):
    seen.append((definitions,system))
    return [],legacy['raw_model_json'] if len(seen)==1 else json.dumps(raw),{}
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
     patch('app.kit_tools.KitTools.call',tool),patch('app.coach_chat._gemini_turn',corrected_provider), \
     patch('app.coach_chat.db.coach_connect'),patch('app.coach.health_ok',return_value=True):
    corrected=coach_chat.answer(1,'Review my week',kit=True,weekly_review=True)
assert len(seen)==2 and all(d==[] for d,s in seen) and corrected['answer_blocks']
# Exact app-authored consent refusal terminates cleanly; it is never model-authored.
calls=[]
def deny(self,name,args):
    if name=='profile':return {'units':'imperial'}
    raise ValueError(coach_chat.coach.HEALTH_NO)
def denied_turn(*args,**kwargs):calls.append(1);return [{'name':'weight_trend','args':{}}],'',{}
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
     patch('app.kit_tools.KitTools.call',deny):
    answer=coach_chat.answer(1,'What Apple Health weight did I share?',kit=True,turn=denied_turn)
assert answer['consent_refused'] and len(calls)==1 and not answer['facts'] and answer['health_included'] is False
for count in (0,1):
    assert is_expected_health_consent_refusal('recall-health-consent-off',variant='candidate',answer=answer,
        error=None,provider_requests=count,refusal_message=coach_chat.coach.HEALTH_NO)
assert not is_expected_health_consent_refusal('recall-other-account',variant='candidate',answer=answer,
        error=None,provider_requests=1,refusal_message=coach_chat.coach.HEALTH_NO)
covered.add('recall-health-consent-off');assert len(covered)==10,covered
print('Smoke4: 12 exact raw outputs replayed: 10 pass, 2 reject (explicit wrong units/unsupported rate framing); all 10 cases have a safe captured answer/refusal. Weekly conversational stand-in + schema/period/no-tools, value-only substitution, precise counts and consent PASS; no provider calls')
