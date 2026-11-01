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
from food_memory_score import group_components
tea={'name':'Black tea','source':None,'analogue':None,'amount':1,'unit':'serving','text':'Tea with two sugars','nutrition':{'kcal':2}}
sugar={**tea,'name':'White sugar','amount':2,'nutrition':{'kcal':32}}
grouped=group_components([tea,sugar],'Tea with two sugars')
assert len(grouped)==1 and grouped[0]['nutrition']['kcal']==34 and len(grouped[0]['components'])==2
assert len(group_components([tea,sugar,sugar],'Tea with two sugars'))==3
assert len(group_components([{**tea,'name':'Sweetened tea'},sugar],'Tea with two sugars'))==2
assert len(group_components([tea,sugar,{**tea,'name':'Banana'}],'Tea with two sugars'))==3
assert len(group_components([tea,sugar],'Plain tea'))==2
print('Food grouping: explicit drink components preserved; duplicate sugar, double-counted sweetened drink and unrelated foods rejected PASS')

drink_case={'intents':['log'],'needs_question':False,'foods':[{'words':['tea'],'reference':None,'quantity':None,'analogue':None}]}
drink_frame={**good,'foods':grouped,'raw_foods':[{'name':'Tea with two sugars','habit_ids':[]}]}
assert evaluate(drink_case,drink_frame,fixtures)['passed']
for invalid in [group_components([tea,sugar,sugar],'Tea with two sugars'),group_components([tea,sugar,{**tea,'name':'Banana'}],'Tea with two sugars')]:
    assert not evaluate(drink_case,{**drink_frame,'foods':invalid},fixtures)['passed']
bowl=[{**tea,'name':'White rice'},{**tea,'name':'Black beans'},{**tea,'name':'Shredded cheddar cheese'}]
assert len(group_components(bowl,'A burrito bowl with rice, beans and cheese'))==1
assert len(group_components(bowl+[bowl[0]],'A burrito bowl with rice, beans and cheese'))==4
assert len(group_components(bowl+[{**tea,'name':'Burrito bowl'}],'A burrito bowl with rice, beans and cheese'))==4
assert len(group_components(bowl+[{**tea,'name':'Banana'}],'A burrito bowl with rice, beans and cheese'))==4
revoked_case={**case,'revoke_memory_during_response':True}
assert not evaluate(revoked_case,good,fixtures)['passed']
assert evaluate(revoked_case,{**good,'foods':[],'question':True,'revocation_discarded':True,'revocation_evidence':{'valid_late_response':True,'memory_transition':True,'stored_discard':True}},fixtures)['passed']
assert not evaluate(revoked_case,{**good,'revocation_discarded':True,'revocation_failed':True},fixtures)['passed']
assert not evaluate(revoked_case,{**good,'revocation_discarded':True,'rows_unchanged':False},fixtures)['passed']
print('Mixed-dish components/duplicate guards and independently evidenced late-memory discard controls PASS')

assert len(group_components(bowl[:2],'A burrito bowl with rice, beans and cheese'))==2
sugar_case={'intents':['log'],'needs_question':False,'foods':[{'words':['tea'],'reference':None,'quantity':None,'analogue':None,'sugar_count':2}]}
for amount in (1,20):
    bad_group=group_components([tea,{**sugar,'amount':amount}],'Tea with two sugars')
    assert not evaluate(sugar_case,{**drink_frame,'foods':bad_group},fixtures)['passed']
assert evaluate(sugar_case,{**drink_frame,'foods':grouped},fixtures)['passed']
for missing in ('valid_late_response','memory_transition','stored_discard'):
    proof={'valid_late_response':True,'memory_transition':True,'stored_discard':True};proof[missing]=False
    assert not evaluate(revoked_case,{**good,'revocation_discarded':True,'revocation_evidence':proof},fixtures)['passed']
print('Omitted ingredients, wrong sugar components and unobserved revocation transitions rejected PASS')
