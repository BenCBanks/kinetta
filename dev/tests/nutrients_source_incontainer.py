"""Only fictional nutrient rows. Provider mappings are deterministic, not model predictions."""
from unittest.mock import patch
from app import api_food as F,nutrients as N
from pydantic import ValidationError
with patch.object(F,'_get',side_effect=AssertionError('No network')):
 off={'code':'fictional','product_name':'Fictional dry food','nutriments':{'energy-kcal_100g':500,'proteins_100g':10,'carbohydrates_100g':60,'fat_100g':20,'fiber_100g':3,'sodium_100g':.0428,'sodium_unit':'mg','sugars_100g':0,'saturated-fat_100g':2.5}}
 result=F._off_food(off)['per100'];assert result['sodium_mg']==42.8 and result['sugar_g']==0 and result['saturated_fat_g']==2.5
 # Source input-unit suffix is not applied to the already normalized field a second time.
 off['nutriments']['sodium_100g']=.0005;assert F._off_food(off)['per100']['sodium_mg']==.5
 for key in ['sodium_100g','sugars_100g','saturated-fat_100g']:off['nutriments'].pop(key)
 assert all(F._off_food(off)['per100'][k] is None for k in N.EXTRA)
 for value in [True,-1,float('inf'),float('nan'),'not a number',101]:
  assert all(v is None for v in N.off_values({'sodium_100g':value,'sugars_100g':value,'saturated-fat_100g':value}).values())
 rows=[{'nutrientId':1093,'value':.25,'unitName':'G'},{'nutrientId':1063,'value':5,'unitName':'G'},{'nutrientId':2000,'value':0,'unitName':'G'},{'nutrientId':1258,'value':2000,'unitName':'MG'}]
 expected={'sodium_mg':250,'sugar_g':0,'saturated_fat_g':2}
 assert N.fdc_values(rows)==expected and N.fdc_values(list(reversed(rows)))==expected
 fdc={'fdcId':1,'description':'Fictional source food','foodNutrients':[{'nutrientId':1008,'value':500,'unitName':'KCAL'},{'nutrientId':1003,'value':10},{'nutrientId':1005,'value':60},{'nutrientId':1004,'value':20},*rows]}
 assert all(F._fdc_food(fdc)['per100'][k]==v for k,v in expected.items())
 assert N.fdc_values([{'nutrientNumber':'307','value':1000,'unitName':'µg'}])['sodium_mg']==1
 assert N.fdc_values([{'nutrientNumber':'269','value':3}])['sugar_g']==3
 assert N.fdc_values([{'nutrientId':1093,'value':1000,'unitName':'UG'}])['sodium_mg']==1
 for unit in ['KCAL','% DV',True,42]:assert N.fdc_values([{'nutrientId':1093,'value':1,'unitName':unit}])['sodium_mg'] is None
 assert N.fdc_values([None,{}, {'nutrientId':1093,'value':float('inf')}])==dict.fromkeys(N.EXTRA)
for bad in [True,-1,float('inf'),float('nan'),1000001]:
 try:N.ExtraValues(sodium_mg=bad)
 except ValidationError:pass
 else:raise AssertionError('Invalid sodium accepted')
empty=N.day_values([],{});assert all(v['recorded'] is None and not v['complete'] for v in empty.values())
result=N.day_values([{'sodium_mg':100,'sugar_g':0,'saturated_fat_g':1},{'sodium_mg':None,'sugar_g':None,'saturated_fat_g':0}],{'sodium_target_mg':2000})
assert result['sodium_mg']['recorded']==100 and result['sodium_mg']['unknown_count']==1 and not result['sodium_mg']['complete']
assert result['sugar_g']['recorded']==0 and result['sugar_g']['known_count']==1 and result['sugar_g']['unknown_count']==1
assert result['saturated_fat_g']['recorded']==1 and result['saturated_fat_g']['complete']
assert N.day_values([{'sodium_mg':3,'ref':{'unknown_nutrients':42}}],{})['sodium_mg']['recorded']==3
flagged=N.day_values([{'sodium_mg':0,'ref':{'unknown_nutrients':['sodium_mg']}}],{});assert flagged['sodium_mg']['recorded'] is None and flagged['sodium_mg']['unknown_count']==1
print('Extra nutrient sources: OFF normalized grams→mg/zero/missing/invalid; USDA IDs/legacy numbers/units/total-sugar precedence; nullable input bounds, partial coverage and unknown-vs-zero PASS; no network/AI')
