"""Plain recovery/weekly wording; claim safety still checks the original raw answer first."""
from copy import deepcopy
from app import coach_chat,kit_conversation

profile={'evidence_id':'e1','tool':'profile','data':{'units':'metric'}}
ev=[profile,{'evidence_id':'e2','tool':'training_load','data':{'days':[{'fatigue':26.4}]}}]
raw={'blocks':[{'kind':'paragraph','text':'Your estimated fatigue score is {e2:0}.'}],
     'facts':[{'evidence_id':'e2','path':['days',0,'fatigue'],'value':26.4}],
     'selection':None,'actions':[],'follow_ups':[]}
def check(value=raw,evidence=ev,question='Help with recovery',weekly=False):
 return coach_chat.checked_answer(value,evidence,kit=True,conversation_question=question,weekly_review=weekly)
answer=check();assert '26.4' not in answer['interpretation'] and 'fatigue' not in answer['interpretation'].lower()
assert 'Make your next session easy' in answer['interpretation']
assert not answer['facts'],'internal scores cannot return as client detail rows'
# Removing the score from display must NEVER license an unsupported raw number.
wrong=deepcopy(raw);wrong['facts'][0]['value']=99
try:check(wrong)
except ValueError:pass
else:raise AssertionError('Unverified score hidden before validation')
# A normal training question and old/general coach modes keep their existing output.
assert '26.4' in check(question='Explain this recorded measurement')['interpretation']
step={'blocks':[{'kind':'paragraph','text':'Schedule an easy day before your next hard effort.'}],
      'facts':[],'selection':None,'actions':[],'follow_ups':[]}
assert len(check(step)['answer_blocks'])==1,'an existing concrete action is not duplicated'
for weekly,missing,expected in [(True,2,'Log your next meal'),(True,0,'Choose a day'),(False,0,'Make your next session easy')]:
 evidence=[profile,{'evidence_id':'e2','tool':'nutrition_adequacy','data':{'unlogged_finished_days':missing}}]
 example={**step,'blocks':[{'kind':'paragraph','text':'A practical next step is to build a sustainable routine.'}]}
 result=check(example,evidence,weekly=weekly)
 assert expected in result['interpretation'] and len(result['answer_blocks'])==1,result
for field in ('fatigue','fitness','form','ctl','atl','tsb'):
 facts=[{'path':['days',0,field],'display_value':'26.4'}]
 blocks=[{'kind':'paragraph','text':f'Your estimated {field} score is 26.4.'}]
 result=kit_conversation.coaching_wording(blocks,facts,[])
 assert '26.4' not in str(result),result
 assert blocks[0]['text'].endswith('26.4.'),'the saved input is never mutated'
assert 'fatigue' not in str(kit_conversation.coaching_wording([{'kind':'paragraph','text':'Your recorded training covered the week, with an estimated fatigue score reaching 26.4.'}],[{'path':['days',0,'fatigue'],'display_value':'26.4'}],[])).lower()
assert 'Do not display internal fatigue' in kit_conversation.SYSTEM
print('Plain coaching: scores hidden only after claims validation, concrete next-step rows, no duplicate action, unrelated answers preserved PASS; no providers')
