"""Weekly/fallback wording stays factual and avoids duplicating an existing next step."""
import copy,re
from app import coach_chat,kit_conversation
profile=dict(evidence_id='e1',tool='profile',data=dict(units='metric'))
evidence=[profile,dict(evidence_id='e2',tool='nutrition_adequacy',data=dict(unlogged_finished_days=3))]
steps=[
 'For your next step, pick a convenient time today to log your next full meal.',
 'You could log a complete meal after eating.',
 'Try logging your next routine meal, including drinks and snacks.',
 'For your next meal, you could log it as you eat.',
]
for text in steps:
 for block in [dict(kind='paragraph',text=text),dict(kind='list',items=[text])]:
  original=copy.deepcopy(block)
  result=coach_chat.checked_answer(dict(blocks=[block],facts=[]),evidence,kit=True,weekly_review=True)
  assert len(result['answer_blocks'])==1,(text,result)
  assert result['interpretation'].count('meal')==1,(text,result)
  assert block==original,'No stored input mutation'
# Description of past logging is not a next-step invitation.
for text in ('Your food log has gaps.','You were logging your regular meals.'):
 result=coach_chat.checked_answer(dict(blocks=[dict(kind='paragraph',text=text)],facts=[]),
                                   evidence,kit=True,weekly_review=True)
 assert len(result['answer_blocks'])==2,text
 assert 'You could log your next meal' in result['interpretation']
# Warm substitutions occur only AFTER raw values and claims verify.
records=[profile,dict(evidence_id='e2',tool='period_compare',data=dict(current=dict(totals=dict(workouts=3))))]
raw=dict(blocks=[dict(kind='paragraph',text='Training volume was {e2:0} workouts during this review period.')],
         facts=[dict(evidence_id='e2',path=['current','totals','workouts'],value=3)])
result=coach_chat.checked_answer(raw,records,kit=True,weekly_review=True)
assert result['answer_blocks'][0]['text']=='You logged 3 workouts over the past week.'
bad=copy.deepcopy(raw);bad['facts'][0]['value']=4
try:coach_chat.checked_answer(bad,records,kit=True,weekly_review=True)
except ValueError:pass
else:raise AssertionError('Warm copy cannot hide an invented count')
print('Kit polish: paragraph/list meal-step detection, real missing step, post-validation wording and immutable inputs PASS; 0 providers')
