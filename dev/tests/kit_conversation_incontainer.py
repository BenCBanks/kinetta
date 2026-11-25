"""Fictional conversational contract, formatting, length and provider-shaped stand-ins; no network."""
import copy
import json
from unittest.mock import patch
from app import coach_chat, kit_conversation

profile = {'evidence_id':'e1','tool':'profile','data':{'units':'imperial'}}
evidence = [profile, {'evidence_id':'e2','tool':'recent_runs','data':{
    'runs':[{'distance_m':1609.344*(i+1)} for i in range(8)]}}]
raw = {'blocks':[{'kind':'paragraph','text':'The recorded value was {e2:0}.'},
                 {'kind':'list','items':['Keep a routine that fits your week.','Add a note about your run.']}],
       'facts':[{'evidence_id':'e2','path':['runs',0,'distance_m'],'value':1609.344}],
       'follow_ups':['I want to review my training.']}
result = coach_chat.checked_answer(raw,evidence,kit=True)
assert result['answer_blocks'][0]['text']=='The recorded value was 1 mi.'
assert result['interpretation']=='The recorded value was 1 mi.\n\n• Keep a routine that fits your week.\n• Add a note about your run.'
assert result['follow_ups']==raw['follow_ups'] and result['selection'] is None
assert '<' not in result['interpretation']
metric = coach_chat.checked_answer(raw,[{**profile,'data':{'units':'metric'}},evidence[1]],kit=True)
assert '1.6 km' in metric['interpretation']
expanded = copy.deepcopy(raw)
expanded['facts'] = [{'evidence_id':'e2','path':['runs',i,'distance_m'],'value':1609.344*(i+1)} for i in range(8)]
expanded['blocks'] = [{'kind':'paragraph','text':'The recorded value was {e2:7}.'}]
assert '8 mi' in coach_chat.checked_answer(expanded,evidence,kit=True)['interpretation']


def rejected(bad, *, records=evidence, **kwargs):
    try:coach_chat.checked_answer(bad,records,kit=True,**kwargs)
    except ValueError:return
    raise AssertionError('Unsafe/invalid conversation accepted')


for mutation in (
    lambda x:x['facts'][0].update(value=42),
    lambda x:x['facts'][0].update(path=['owner_id']),
    lambda x:x['facts'][0].update(value=True),
    lambda x:x['blocks'][0].update(text='The recorded value was 42 miles.'),
    lambda x:x['blocks'][0].update(text='The recorded value was {e9:0}.'),
    lambda x:x['blocks'][0].update(text='The recorded value was {e2:8}.'),
    lambda x:x['blocks'][0].update(text='The recorded value was {e2:0} km.'),
    lambda x:x['blocks'][0].update(text=' '),
    lambda x:x['blocks'][1].update(items=['']*7),
    lambda x:x['blocks'][1].update(items=['x'*601]),
    lambda x:x.update(blocks=[]),
    lambda x:x.update(blocks=x['blocks']*6),
    lambda x:x.update(selection={'kind':'plan','evidence_id':'e2','candidate_id':'invented'}),
    lambda x:x.update(user_id=999),
):
    bad=copy.deepcopy(raw);mutation(bad);rejected(bad)

longer={'blocks':[{'kind':'paragraph','text':'Useful guidance. '*90}],'facts':[]}
assert coach_chat.checked_answer(longer,evidence,kit=True)['answer_blocks']
assert kit_conversation.word_limit('Remembered statement: explain in detail\nQuestion: Help me.')==160
assert coach_chat.checked_answer(longer,evidence,kit=True,conversation_question='Explain in detail.')['answer_blocks']
assert kit_conversation.word_limit('Keep it short, not a detailed answer.')==160
assert kit_conversation.word_limit('Question: Give me a step-by-step explanation.')==600
rejected({'blocks':[{'kind':'paragraph','text':'Useful guidance. '*400}],'facts':[]},conversation_question='Explain in detail.')
legacy={'verdict':'Keep a sustainable routine.','reason':'Choose activities you enjoy.','facts':[]}
assert 'answer_blocks' not in coach_chat.checked_answer(legacy,evidence,kit=True)
assert coach_chat.checked_answer(raw,evidence,kit=True,weekly_review=True)['answer_blocks']
weekly_change=copy.deepcopy(raw);weekly_change['actions']=['plan'];rejected(weekly_change,weekly_review=True)
try:coach_chat.checked_answer(raw,evidence)
except ValueError:pass
else:raise AssertionError('General coach must retain its existing contract')

# The real answer path selects the new prompt; old stand-ins/saved response shapes still work.
def profile_only(self,name,args,**kwargs):
    assert name=='profile';return profile['data']

for payload in ({'blocks':[{'kind':'paragraph','text':'Choose a routine you enjoy.'}],'facts':[]},legacy):
    def stand_in(messages,definitions):return [],json.dumps(payload),{}
    with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
         patch('app.kit_tools.KitTools.call',profile_only):
        checked=coach_chat.answer(1,'How can I build a routine?',kit=True,turn=stand_in)
    assert checked['interpretation']

# Transport retains LOW thinking for the new Kit prompt without affecting general settings.
class Captured(Exception):pass
captured=[]
def capture(request,*args,**kwargs):captured.append(json.loads(request.data));raise Captured
with patch.dict('os.environ',{'GEMINI_API_KEY':'fixture','GEMINI_MODEL':'gemini-3.8-flash'}), \
     patch('app.coach_chat.ai_budget.reserve',return_value=1), \
     patch('app.coach_chat.ai_budget.lease'),patch('app.coach_chat.ai_budget.finish'), \
     patch('app.coach_chat.urllib.request.urlopen',capture):
    try:coach_chat._gemini_turn([],[],system=kit_conversation.SYSTEM)
    except Captured:pass
assert captured[0]['generationConfig']['thinkingConfig']=={'thinkingLevel':'LOW'}
print('Kit conversational blocks: formatting, eight references, bounds, legacy/mode isolation and transport PASS')
