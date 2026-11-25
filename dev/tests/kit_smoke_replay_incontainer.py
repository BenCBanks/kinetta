"""Exact truncated fictional smoke captures and explicitly reconstructed prose/safety regressions."""
import copy
import json
from unittest.mock import patch
from app import coach_chat,kit_conversation,kit_claims

# These are the exact three first-response strings the report retained. None is a complete answer.
CAPTURES = ['```json\n{"blocks":[{"kind":"paragraph","text":"To build a sustainable routine around your saved running goal of {e2:0}, you should distribute your training across manageable sessions, balance easy efforts with adequate rest, and progress gradually."},{"kind":"paragraph","text":"Your recorded data:"},{"kind":"list","items":["Your saved weekly running target is {e2:0}.","Your active training plan schedules {e3:1} running sessions per week over {e', '```json\n{\n  "blocks": [\n    {\n      "kind": "paragraph",\n      "text": "I found a saved option featuring Fictional soup that fits within your remaining targets for today. The estimated energy is {e2:0}, with protein at {e2:1}, carbohydrates at {e2:2}, and fat at {e2:3}."\n    },\n    {\n      "kind": "paragraph', '```json\n{"blocks":[{"kind":"paragraph","text":"You recently recorded completed sets of Fictional squat."},{"kind":"list","items":["Set with reps recorded at {e2:0} and weight at {e2:1}.","Set with reps recorded at {e2:2} and weight at {e2:3}.","Total recorded exercise volume was {e2:4}."]}],"facts":[{"evidence_id":"e2","path":["sets']

for raw in CAPTURES:
    try:coach_chat._json(raw)
    except json.JSONDecodeError:pass
    else:raise AssertionError('Truncated capture must not be repaired or accepted')
# Fences alone were never the failure: the existing parser accepts complete fenced JSON.
assert coach_chat._json('```json\n{"blocks":[],"facts":[]}\n```')=={'blocks':[],'facts':[]}
profile={'evidence_id':'e1','tool':'profile','data':{'units':'metric'}}
evidence=[profile,{'evidence_id':'e2','tool':'meal_combinations','arguments':{'day':'2026-11-25'},'data':{
    'candidates':[{'candidate_id':'fictional-soup','totals':{'kcal':300,'protein_g':15,'carbs_g':40,'fat_g':8}}]}}]
# Reconstructed complete envelope from the captured meal paragraph, with explicitly fictional matching evidence.
meal={'blocks':[{'kind':'paragraph','text':'I found a saved option featuring Fictional soup that fits within your remaining targets for today. The estimated energy is {e2:0}, with protein at {e2:1}, carbohydrates at {e2:2}, and fat at {e2:3}.'}],
    'facts':[{'evidence_id':'e2','path':['candidates',0,'totals',key],'value':value} for key,value in [('kcal',300),('protein_g',15),('carbs_g',40),('fat_g',8)]],
    'selection':{'kind':'meal','evidence_id':'e2','candidate_id':'fictional-soup'}}
assert coach_chat.checked_answer(meal,evidence,kit=True)['selection']['kind']=='food'
# Advice fragments from the detail capture: no speculative relation/feeling/style-word rejection.
texts=[
 'To build a sustainable routine around your saved running goal, you should distribute your training across manageable sessions, balance easy efforts with adequate rest, and progress gradually.',
 'Your saved plan can help you build a more consistent routine.',
 'You can choose a shorter workout when your schedule changes.',
 'Let your goals guide the routine rather than treating every session as a test.',
 'Add a note about how it felt so we can discuss it next time.',
]
for text in texts:
    assert coach_chat.checked_answer({'blocks':[{'kind':'paragraph','text':text}],'facts':[]},[profile],kit=True)['interpretation']==text
# Keep the hard safety boundaries: no fabricated evidence, quantities, mismatched identifiers or candidate writes.
for mutation in (
    lambda x:x['facts'][0].update(value=999),
    lambda x:x['facts'][0].update(path=['owner_id']),
    lambda x:x['facts'][0].update(evidence_id='e99'),
    lambda x:x['blocks'][0].update(text='You logged 999 kcal.'),
    lambda x:x['blocks'][0].update(text='You logged seventy calories.'),
    lambda x:x['blocks'][0].update(text='You have diabetes.'),
    lambda x:x['blocks'][0].update(text='Stop your medication.'),
    lambda x:x['selection'].update(candidate_id='not-owned'),
):
    bad=copy.deepcopy(meal);mutation(bad)
    try:coach_chat.checked_answer(bad,evidence,kit=True)
    except ValueError:pass
    else:raise AssertionError('Hard safety mutation accepted')
# Smoke can disable correction attempts without changing ordinary production retry policy.
rounds=[]
def bad_provider(messages,definitions,**kwargs):
    rounds.append(1);return [],CAPTURES[0],{}
with kit_conversation.correction_policy(False),patch('app.coach.allowed',return_value=True), \
     patch('app.coach.provider',return_value='gemini'),patch('app.kit_tools.KitTools.call',return_value={'units':'metric'}), \
     patch('app.coach_chat._gemini_turn',bad_provider):
    try:coach_chat.answer(1,'A fictional question',kit=True)
    except ValueError:pass
    else:raise AssertionError('Truncated answer accepted')
assert len(rounds)==1 and kit_conversation.corrections_enabled()
# Complete current-response JSON gets a higher ceiling; legacy/weekly settings stay unchanged.
assert kit_conversation.output_tokens(kit_conversation.SYSTEM,2500)==8192
assert kit_conversation.output_tokens(coach_chat.SYSTEM,2500)==2500
assert kit_conversation.output_tokens(coach_chat.KIT_WEEKLY_SYSTEM,4096)==4096
print('Smoke replay: 0/3 truncated originals accepted (correct); 6/6 reconstructed honest prose/envelopes pass; 8 safety mutations rejected; zero-correction smoke PASS')

# Diagnostic text/error/evidence stay paired across retries and across baseline/helper modules.
from app.kit_eval_diagnostics import RejectionDiagnostics
class Fake:
    def _gemini_turn(self,*a,**k):return [],'{}',{}
    def _claude_turn(self,*a,**k):return [],'{}',{}
    def _json(self,text):return json.loads(text)
    def checked_answer(self,raw,evidence,**kwargs):raise ValueError(raw.get('why','rejected'))
first,baseline=Fake(),Fake();diagnostics=RejectionDiagnostics(first);diagnostics.attach(baseline)
capture=diagnostics.begin()
for module,text in ((baseline,'{"why":"first rule"}'),(first,'{"why":"second rule"}')):
    try:module.checked_answer(module._json(text),[profile])
    except ValueError:pass
assert [a['validation_error'] for a in capture['attempts']]==['first rule','second rule']
assert capture['raw_model_json']=='{"why":"second rule"}' and capture['validation_error']=='second rule'
assert capture['attempts'][0]['evidence']==[profile]
diagnostics.end()
print('Both-variant diagnostics preserve each exact rejected response and matching error/evidence PASS')
