"""Second-smoke exact raw regressions and final provider schema/consent tests; no network."""
import copy
import json
from unittest.mock import patch
from app import coach_chat,kit_conversation,kit_claims

# Exact action alias is shape-only; unknown/extra-key destinations must still fail.
profile=[{'evidence_id':'e1','tool':'profile','data':{'units':'metric'}}]
good={'blocks':[{'kind':'paragraph','text':'Choose a routine you enjoy.'}],'facts':[],
      'actions':[{'screen':'plan'}]}
assert coach_chat.checked_answer(good,profile,kit=True)['actions']==['plan']
for action in ({'screen':'admin'},{'screen':'plan','url':'https://example.invalid'},
               {'screen':'plan','user_id':99}):
    bad=copy.deepcopy(good);bad['actions']=[action]
    try:coach_chat.checked_answer(bad,profile,kit=True)
    except ValueError:pass
    else:raise AssertionError('Action alias expanded authority')

# The schema describes the same contract and can never bypass the local validator.
for system,field in ((kit_conversation.SYSTEM,'blocks'),(kit_claims.weekly_system(),'weekly_review')):
    body={'generationConfig':{}}
    kit_conversation.final_schema(body,system)
    schema=body['generationConfig']['responseJsonSchema']
    assert field in schema['required']
    assert schema['properties']['actions']['items']['enum']==['food','nutrition','record','activities','plan','progress','strength','recipes','goals','connections']
    assert schema['additionalProperties'] is False
    assert kit_conversation.output_tokens(system,0)==8192
    assert kit_conversation.output_tokens(system,0,thinking_level='MEDIUM')==16384

# Narrow general-advice duration doesn't permit claims about recorded measurements.
text='Pick a single meal to log every day for one week.'
assert coach_chat.checked_answer({'blocks':[{'kind':'paragraph','text':text}],'facts':[]},profile,kit=True)
for text in ('You logged meals every day for one week.',
             'Pick a meal after you logged for one week.',
             'Try one hundred grams of protein.',
             'Pick a meal. You recorded seventy calories.'):
    try:coach_chat.checked_answer({'blocks':[{'kind':'paragraph','text':text}],'facts':[]},profile,kit=True)
    except ValueError:pass
    else:raise AssertionError('Unsupported recorded quantity accepted')

# A denied data read terminates with the existing consent decision-point message.
# The model sees only the profile and cannot loop on or infer a denied tool result.
def tools(self,name,args):
    if name=='profile':return {'units':'metric'}
    raise ValueError(coach_chat.coach.HEALTH_NO)
calls=[]
def turn(messages,definitions):
    calls.append(1)
    return [{'name':'weight_trend','args':{}}],'',{}
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
     patch('app.kit_tools.KitTools.call',tools):
    try:coach_chat.answer(1,'What Apple Health weight did I share?',kit=True,turn=turn)
    except ValueError as error:assert str(error)==coach_chat.coach.HEALTH_NO
    else:raise AssertionError('Consent-off read accepted')
assert len(calls)==1
print('Final schemas, exact-only action normalization, advice/recorded-count distinction and clean consent refusal PASS')

# Replay every captured raw string (unchanged). Some still contain unreferenced quantities;
# shape normalization must not turn those into accepted claims.
rows=json.load(open('/tmp/kit-smoke2-fixtures.json'))['cases']
counts={'pass':0,'reject':0,'truncated':0}
for row in rows:
    try:
        raw=coach_chat._json(row['raw_model_json'])
        result=coach_chat.checked_answer(raw,row['evidence'],kit=True,weekly_review=row['weekly_review'])
    except json.JSONDecodeError:state='truncated'
    except ValueError:state='reject'
    else:state='pass'
    assert state==row['expected'],(row['case'],state,row['expected'])
    counts[state]+=1
assert counts=={'pass':2,'reject':3,'truncated':1}
# An explicit correction can keep all original fact values while removing the unsafe prose.
for row in rows:
    if row['expected']!='reject':continue
    raw=coach_chat._json(row['raw_model_json'])
    raw['blocks']=[{'kind':'paragraph','text':'The recorded value was {e2:0}.'}]
    assert coach_chat.checked_answer(raw,row['evidence'],kit=True)
# Goal targets derive units from the actual goal metric, never arbitrary metadata.
ev=profile+[{'evidence_id':'e2','tool':'goals','data':{
    'activity_goals':[{'metric':'distance','target':5000}]}}]
goal={'blocks':[{'kind':'paragraph','text':'Your saved target is {e2:0}.'}],
      'facts':[{'evidence_id':'e2','path':['activity_goals',0,'target'],'value':5000}]}
assert '5 km' in coach_chat.checked_answer(goal,ev,kit=True)['interpretation']
bad=copy.deepcopy(ev);bad[1]['data']['activity_goals'][0]['metric']='account_id'
try:coach_chat.checked_answer(goal,bad,kit=True)
except ValueError:pass
else:raise AssertionError('Goal target units must match a known metric')
print('Exact raw replay: 2/5 complete captures pass; 3 unreferenced-quantity captures and 1 truncation stay rejected; explicit safe corrections pass')

# Production can gather data over multiple rounds, then make exactly one schema correction.
rounds=[]
complete={'blocks':[{'kind':'paragraph','text':'Choose a routine you enjoy.'}],'facts':[]}
def many_rounds(messages,definitions):
    rounds.append(definitions)
    if len(rounds)<=3:return [{'name':'goals','args':{}}],'',{}
    if len(rounds)==4:return [],'{"blocks":',{}
    return [],json.dumps(complete),{}
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'),      patch('app.kit_tools.KitTools.call',return_value={'units':'metric'}):
    answer=coach_chat.answer(1,'Help with my routine',kit=True,turn=many_rounds)
assert len(rounds)==5 and rounds[-1]==[] and answer['interpretation']=='Choose a routine you enjoy.'
print('Multiple production tool rounds plus one correction pass without a two-call experiment cap')

# Exact LOW nutrition captures bind prose counts to the matching current-turn tool.
rows=json.load(open('/tmp/kit-smoke3-fixtures.json'))
for row in rows:
    raw=coach_chat._json(row['raw_model_json'])
    assert coach_chat.checked_answer(raw,row['evidence'],kit=True)
    for change in ('wrong','absent','failed','ambiguous'):
        ev=copy.deepcopy(row['evidence'])
        if change=='wrong':ev[1]['data']['logged_days']=2
        if change=='absent':ev=ev[:1]
        if change=='failed':ev[1]['error']='unavailable'
        if change=='ambiguous':ev.append(copy.deepcopy(ev[1]))
        try:coach_chat.checked_answer(raw,ev,kit=True)
        except ValueError:pass
        else:raise AssertionError('Recorded-day count accepted without unique matching evidence')
for text in ('You logged two days.', 'Twenty one day had recorded intake.',
             'Thirty-one day had recorded intake.', 'One day had recorded intake and seventy calories.'):
    try:coach_chat.checked_answer({'blocks':[{'kind':'paragraph','text':text}],'facts':[]},rows[0]['evidence'],kit=True)
    except ValueError:pass
    else:raise AssertionError('Invented count accepted')
print('Both exact LOW nutrition attempts pass; absent, ambiguous, failed and mismatching counts reject')
