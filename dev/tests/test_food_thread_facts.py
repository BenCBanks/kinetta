"""Pure synthetic thread questions and feedback. No application/provider import or model calls."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path

spec=importlib.util.spec_from_file_location('thread_facts',Path(__file__).resolve().parents[2]/'app/food_thread_facts.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
anchor=dt.date(2026,10,17);checks=0

def check(value,name):
 global checks
 assert value,name
 checks+=1

for text,intent,nutrient in [('how much protein do I have left?','left','protein'),('protein left please','left','protein'),('carbs remaining?','left','carbs'),
 ('how many calories so far?','totals','calories'),('total fat today','totals','fat'),('calories left','left','calories'),
 ('how much fibre today?','totals','fiber'),('how much did I burn today?','burn','calories'),
 ('what did I have for lunch Tuesday?','history','calories'),('what have I eaten yesterday?','history','calories'),
 ('am I doing ok?','reassurance','calories'),('was that bad?','reassurance','calories'),('how am I doing?','reassurance','calories'),
 ('what should I eat for dinner?','advice','calories'),('sum up my day','review','calories')]:
 q=f.classify(text,anchor);check(q and q['kind']==intent and q['nutrient']==nutrient,text)
check(f.classify('what did I have for lunch Tuesday?',anchor)['day']==dt.date(2026,10,13),'weekday inference')
check(f.classify('what did I have yesterday?',anchor)['day']==anchor-dt.timedelta(days=1),'yesterday')
check(f.classify('what did I eat 2026-10-10?',anchor)['day']==dt.date(2026,10,10),'explicit date')
for text in ('I had 500 calories total for dinner','2 eggs and toast','a protein shake and leftover rice','log my usual soup'):
 check(f.classify(text,anchor) is None,'food stays with food engine: '+text)
for text in ('what did I eat today and yesterday?','what did I eat 2026-02-30?','what did I eat for lunch and dinner?'):
 q=f.classify(text,anchor);check(q['kind']=='clarify' and q['text'].count('?')==1,'one short clarification')
rows=[{'day':(anchor-dt.timedelta(days=i)).isoformat(),'eaten':1800,'today':i==0} for i in range(5)]
S={'day':{'day':str(anchor),'entries':[{'id':1,'name':'Fictional oats','meal':'breakfast','kcal':400,'fiber_g':None,'source':'custom'}],
 'totals':{'kcal':400,'protein_g':25,'carbs_g':50,'fat_g':12,'fiber_g':0},'goal':{'kcal':1800,'custom':None},'targets':{'protein_target':110},'burned':{'kcal':540,'day_burn':2300,'source':'formula'}},
 'week':{'rows':rows,'summary':{'logged':4,'avg_eaten':1800,'trend_change_kg':-.2}},'needs':{'today':anchor,'bmr':1500,'kg':75,'trend_kg_per_week':-.3},'profile':{'units':'imperial','food_chat_tone':'supportive'}}
q=f.classify('protein left?',anchor);a=f.answer(q,S);check('85 g left' in a['text'] and a['facts']['logged']==25,'protein arithmetic')
q=f.classify('calories left?',anchor);check('1,400 kcal left' in f.answer(q,S)['text'],'calorie arithmetic')
a=f.answer(f.classify('how much fibre?',anchor),S);check('incomplete' in a['text'] and a['facts']['logged'] is None,'unknown fiber is not zero')
for seed in range(6):
 text=f.feedback(S,{'protein_g':32},seed)
 check(not any(word in text.lower().split() for word in ('bad','cheat','failed','perfect')),'kind grounded tone')
check(len({f.feedback(S,{'protein_g':32},seed) for seed in (1,2,4)})>=2,'reviewed variation')
check('32 g' in f.feedback(S,{'protein_g':32},1),'protein added')
check('recorded activities' in f.feedback(S,{'protein_g':32},0),'workout day')
check('logged average' in f.feedback(S,{'kcal':800},1),'larger meal and real week average')
check('1,400 kcal left' in f.feedback(S,{},1),'room toward explicit target')
check('protein' in f.feedback(S,tone='numbers') and 'left' not in f.feedback(S,tone='numbers'),'just numbers')
low=copy.deepcopy(S);low['day']['goal']['kcal']=1000
check('below estimated resting' in f.feedback(low,{'protein_g':32},1),'low target suppresses praise')
low=copy.deepcopy(S)
for row in low['week']['rows'][1:]:row['eaten']=500
check('low or incomplete' in f.feedback(low,{'protein_g':32},1),'low days suppress praise and acknowledge missing logs')
fast=copy.deepcopy(S);fast['needs']['trend_kg_per_week']=-1
check('changing quickly' in f.feedback(fast,{'protein_g':32},1),'fast loss suppresses praise')
unknown=copy.deepcopy(S);unknown['day']['burned']={'source':'apple_health','day_burn':None,'kcal':0}
check('not synced' in f.answer(f.classify('how much did I burn?',anchor),unknown)['text'],'missing resting calories honest')
check('whole day' in f.answer(f.classify('how much did I burn?',anchor),S)['text'],'formula burn is a whole-day estimate')
watch=copy.deepcopy(S);watch['day']['burned']['source']='apple_health'
check('Synced Apple Health' in f.answer(f.classify('how much did I burn?',anchor),watch)['text'],'watch source explicit')
check(f.answer(f.classify('what should I eat?',anchor),S)['offer_kit'],'advice offers consent-gated Kit; no model')
S['period_rows']=[{'kcal':1800,'protein_g':100,'carbs_g':200,'fat_g':60,'fiber_g':None,'n':3,'fiber_n':0},{'kcal':400,'protein_g':25,'carbs_g':50,'fat_g':12,'fiber_g':None,'n':1,'fiber_n':0}]
check('2,200 kcal logged' in f.answer(f.classify('how many calories this week?',anchor),S)['text'],'week sum uses logged days')
check('1,100 kcal per logged day' in f.answer(f.classify('average calories this week?',anchor),S)['text'],'week average labelled per logged day')
check(f.answer(f.classify('how much fiber this week?',anchor),S)['facts']['logged'] is None,'week unknown fiber is not zero')
print(f'food thread facts: {checks} pure checks passed; no model/provider imports or calls')

for text in ['Chicken salad for lunch, about 450 calories total','Had 2 eggs, 300 calories so far']:
 check(f.classify(text,anchor) is None, 'Food description is not a totals question: '+text)
check(f.classify('How much protein is in a chicken breast?',anchor)['kind']=='advice','General food question never claims personal totals')
check(f.classify('weekly average calories',anchor)['weekly'],'weekly adjective recognised')
check(f.classify('calories last week',anchor)['day']==dt.date(2026,10,11),'last week ends last Sunday')
check(f.answer(f.classify('how many calories at lunch today?',anchor),S)['facts']['logged'] is None,'empty requested meal is not whole-day totals')
check(f.feedback(S,{'kcal':None},seed=1),'unknown added calories do not crash feedback')
