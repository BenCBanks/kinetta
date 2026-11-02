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

# High-fiber catalog rows and validated UPC-A/EAN-13 aliases; no provider traffic.
from unittest.mock import MagicMock
from fastapi import HTTPException
high={'kcal':225,'protein_g':7.5,'carbs_g':82.5,'fat_g':2.5,'fiber_g':45}
assert F._sane(high)==high
assert F._sane({'kcal':1046,'protein_g':0,'carbs_g':50,'fat_g':0,'fiber_g':30})['kcal']==250, 'existing kJ repair still accepts fiber-excluded labels'
assert F._sane({'kcal':260,'protein_g':0,'carbs_g':50,'fat_g':0,'fiber_g':30}) is not None, 'fiber-excluded carbohydrate labels remain usable'
assert F._sane({**high,'fiber_g':None}) is None
product={'code':'0016000157620','product_name':'Fictional high-fiber cereal','serving_quantity':40,'serving_size':'1 cup',
 'nutriments':{'energy-kcal_100g':225,'proteins_100g':7.5,'carbohydrates_100g':82.5,'fat_100g':2.5,'fiber_100g':45}}
assert F._off_food(product)['per100']=={**high,**dict.fromkeys(N.EXTRA)}
with patch.object(F,'_cached',return_value=[product]):assert F._search_off('fictional cereal')[0]['per100']['fiber_g']==45
assert F._barcode_codes('016000157620')==['016000157620','0016000157620']
assert F._barcode_codes('0016000157620')==['0016000157620','016000157620']
for code in ['016000157621','0016000157621']:
 try:F._barcode_codes(code)
 except HTTPException as e:assert e.status_code==400
 else:raise AssertionError('bad check digit accepted')
for code in ['123456','12345678','10160001576201']:assert F._barcode_codes(code)==[code]
connection=MagicMock();connection.__enter__.return_value.execute.return_value.fetchone.return_value=None
with patch.object(F.db,'connect',return_value=connection),patch.object(F,'_cached',side_effect=lambda key,fetch,days:fetch()),patch.object(F,'_get',side_effect=lambda url:{'status':1,'product':product} if '/0016000157620.json?' in url else {'status':0}) as provider:
 assert F.barcode('016000157620',user={'id':42})['per100']['fiber_g']==45
 assert provider.call_count==2
 params=connection.__enter__.return_value.execute.call_args.args[1];assert params==(42,['016000157620','0016000157620'],'016000157620')
connection.__enter__.return_value.execute.return_value.fetchone.return_value={'id':9}
with patch.object(F.db,'connect',return_value=connection),patch.object(F,'_custom_food',return_value={'source':'custom'}) as own,patch.object(F,'_get',side_effect=AssertionError('own food needs no provider')):
 assert F.barcode('0016000157620',user={'id':43})=={'source':'custom'}
 assert connection.__enter__.return_value.execute.call_args.args[1]==(43,['0016000157620','016000157620'],'0016000157620')
from app import meal_chat as M
portion,rest=M.amount(M.raw('40 g fiber one'));assert portion=={'grams':40} and rest==['fiber','one']
assert M.amount(M.raw('2 eggs and 3 slices'))==(None,None)
print('High-fiber barcode/search, checksum and bidirectional aliases, owner-scoped own match and explicit mass before brand words PASS')
with patch.object(M,'_search_usda',return_value=[]) as usda,patch.object(M,'_search_off',return_value=[]) as off:
 lookup=M.lookup('40 g fiber one');assert lookup['portion']=={'grams':40} and lookup['query']=='fiber one';usda.assert_called_once_with('fiber one');off.assert_called_once_with('fiber one')
print('Typed mass and complete unsaved brand words reach catalog search unchanged PASS')
