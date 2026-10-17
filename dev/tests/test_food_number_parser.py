"""Numeric nutrition is never a food-catalog query."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from app.food_thread_numbers import parse
limits={'kcal':20000,'protein_g':2000,'carbs_g':2000,'fat_g':2000,'fiber_g':1000,'sodium_mg':1000000,'sugar_g':2000,'saturated_fat_g':2000}
cases=[('Fictional lunch 500 kcal, 30g protein, 60g carbs, 12g fat, 5g fiber',{'kcal':500,'protein_g':30,'carbs_g':60,'fat_g':12,'fiber_g':5}),('Fictional bar calories: 200, protein: 20g, sodium: 0.5g, sugars: 0g, saturated fat: 2g',{'kcal':200,'protein_g':20,'sodium_mg':500,'sugar_g':0,'saturated_fat_g':2}),('Soup 1,200 calories and 300mg protein',{'kcal':1200,'protein_g':.3}),('Meal 500 kcal',{'kcal':500}),('Meal 500kcal protein30grams carbohydrates60g fat12g fibre5g',{'kcal':500,'protein_g':30,'carbs_g':60,'fat_g':12,'fiber_g':5})]
cases += [(text,{'kcal':kcal}) for text,kcal in [('1/2 sandwich, 300 calories',300),('1/2 cup oats 150 calories',150),('1 serving of oatmeal, 150 calories',150)]]
for text,expected in cases:
 result=parse(text,limits);assert result and not result['problem'],(text,result);assert result['values']==expected,(text,result)
for text in ['a protein bar','2 protein bars','30g protein powder','200g brown sugar','2 fat-free yogurts','eggs and toast','a lunch bowl']:
 assert parse(text,limits) is None,(text,parse(text,limits))
for text in ['Meal 500kcal, protein30g, protein40g','Meal 500kcal per 100g','Meal 500kcal and toast','Meal 500kilojoules','Meal -500kcal','Meal 500000kcal','30g protein','Meal 500kcal, protein20','Meal 500.5.5kcal','Meal 1,2kcal','calories: NaN','protein: infinity','2 eggs, 140 calories each','oats, 150 calories/serving','oats, 150 calories/100 g','oats, 150 calories a serving']:
 result=parse(text,limits);assert result and result['problem'],(text,result)
assert parse('Meal 500kcal, protein30g, protein40g',limits)['values'].get('protein_g') is None
assert not parse('Meal 500kcal per 100g',limits)['values']
print('Nutrition number parser: supplied8 nutrients/unit conversion/knownzero/nullablemissing/wholeportion/name, duplicate/negative/bounds/per100/energyunit/multifood ambiguity held; ordinary protein/sugar/fat-free foods unchanged PASS')
