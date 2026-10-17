"""Synthetic histories check estimate wording without medical/cause certainty or AI."""
from unittest.mock import patch
from app.nutrition_insights import _insights
rows=[{'day':f'2026-10-{10+i:02}','goal':2000,'eaten':1800,'protein_g':100,'fiber_g':20,'training':i<3} for i in range(7)]
summary={'missing_burn_days':0,'past_days':7,'avg_goal':2000,'avg_eaten':1800,'trend_change_kg':2,'burn_counted_days':7,'predicted_kg':-.5,'avg_protein_g':100,'meals':{'lunch':60}}
targets={'protein_target':120};top=[{'name':'Fictional oats','kcal':3000,'n':4}]
def words(C=rows,S=summary,tg=targets,units='imperial'):
 with patch('app.coach_chat.answer',side_effect=AssertionError('No AI')),patch('app.food_photo.ask',side_effect=AssertionError('No AI')):
  return ' '.join(text for _,text in _insights(C,S,tg,top,{'kg':75},{},units))
text=words()
for part in ['rough change','1.1 lb','4.4 lb','water changes','missed or underestimated food','burn estimate','weekly check-in','logged']:
 assert part.lower() in text.lower(),(part,text)
for forbidden in ['usually explains','They match.','predicts','more accurate with each','1.6-2.2','g per kg','You eat']:
 assert forbidden not in text,(forbidden,text)
rounded=words(S={**summary,'avg_eaten':1803});assert '1,805 kcal' in rounded and 'about 195 under' in rounded
metric=words(units='metric');assert '0.5 kg' in metric and '2.0 kg' in metric and ' lb' not in metric
same=words(S={**summary,'trend_change_kg':-.55});assert 'broadly consistent' in same and 'neither proves why' in same
assert 'rough change' not in words(C=rows[:2])
assert 'rough change' not in words(S={**summary,'burn_counted_days':6})
assert 'rough change' not in words(S={**summary,'trend_change_kg':None})
assert 'resting calories have not finished syncing' in words(S={**summary,'missing_burn_days':2}).lower()
gain=words(S={**summary,'predicted_kg':1.5,'trend_change_kg':.2});assert '3.3 lb gained' in gain
no_goal=words(S={**summary,'avg_goal':None},tg={});assert 'Set a protein goal' in no_goal and 'g per kg' not in no_goal
missing=words(C=rows[:3],S={**summary,'past_days':10});assert 'missing days are not zero intake' in missing
assert 'days with fiber data' in words(tg={})
print('Nutrition wording: synthetic loss/gain/agreement/gap/sparse/missing-burn/no-goal histories, imperial/metric units, no causal certainty or assumed-weight advice, no AI PASS')
