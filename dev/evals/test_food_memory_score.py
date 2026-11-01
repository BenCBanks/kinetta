"""The scorer must reject deliberate errors before any paid capture."""
import copy
from food_memory_score import evaluate

case={'intents':['log'],'needs_question':False,'foods':[{'words':['latte'],'reference':'L1','quantity':1,'analogue':None}],'expected_meal':'breakfast'}
fixtures={'L1':{'amount':1,'kcal':180,'protein_g':8,'carbs_g':20,'fat_g':7}}
good={'intent':'log','foods':[{'name':'Latte','source':'L1','analogue':None,'amount':1,'unit':'cup','nutrition':{'kcal':180,'protein_g':8,'carbs_g':20,'fat_g':7},'text':'A latte'}],
      'day':'2026-11-01','meal':'breakfast','rows_unchanged':True,'old_cards_unchanged':True,'question':False}
assert evaluate(case,good,fixtures)['passed']
for key,value in [('intent','chat'),('day','2026-10-31'),('rows_unchanged',False),('foreign_disclosure',True),('old_cards_unchanged',False)]:
    changed=copy.deepcopy(good);changed[key]=value;assert not evaluate(case,changed,fixtures)['passed'],key
changed=copy.deepcopy(good);changed['foods'][0]['nutrition']['kcal']=360;assert not evaluate(case,changed,fixtures)['passed']
question={**case,'needs_question':True,'intents':['unclear']};empty={**good,'intent':'unclear','foods':[],'question':False}
assert not evaluate(question,empty,fixtures)['passed']
assert evaluate(question,{**empty,'question':True,'question_text':'Which saved latte did you mean?'},fixtures)['passed']
ordinary=copy.deepcopy(case);ordinary['foods'][0]['reference']=None
assert not evaluate(ordinary,good,fixtures)['passed']
override=copy.deepcopy(ordinary);override['foods'][0]['must_include']=['skim'];override['foods'][0]['must_exclude']=['whole milk']
changed=copy.deepcopy(good);changed['foods'][0].update(source=None,text='Latte with whole milk')
assert not evaluate(override,changed,fixtures)['passed']
portion=copy.deepcopy(ordinary);portion['foods'][0]['quantity']=2
changed=copy.deepcopy(good);changed['foods'][0].update(source=None,unit='serving')
assert not evaluate(portion,changed,fixtures)['passed']
print('Food memory scorer: correct control plus wrong intent, empty question, wrong quantity/source, ignored override, moved day, foreign data and source/card mutation rejected PASS')

changed=copy.deepcopy(good);changed['day']=None;assert not evaluate(case,changed,fixtures)['passed']
changed=copy.deepcopy(good);changed['foods'][0].update(source=None,amount=1,unit='serving');changed['raw_foods']=[{'name':'Latte','quantity':2}]
assert not evaluate(portion,changed,fixtures)['passed']
assert not evaluate(question,{**good,'intent':'unclear','question':True,'question_text':'Which saved latte?'},fixtures)['passed']
