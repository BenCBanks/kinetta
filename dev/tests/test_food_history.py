"""Setup sees own all-time food history even when today's food/workouts are empty."""
import datetime as dt
from kc import person,PW
a=person('zz_test_setup_food_history');b=person('zz_test_setup_food_other')
try:
 assert a.get('/api/food/day')[1]['has_history'] is False
 assert b.get('/api/food/day')[1]['has_history'] is False
 assert a.get('/api/food/day')[1]['food_user'] is False and a.get('/api/me')[1]['food_user'] is False
 day=(dt.datetime.now(dt.timezone.utc).date()-dt.timedelta(days=40)).isoformat()
 status,result=a.post('/api/food/entries',[{'day':day,'meal':'lunch','name':'Fictional older food','kcal':300}]);assert status==200
 today=a.get('/api/food/day')[1];assert today['has_history'] is True and not today['entries']
 assert not a.get('/api/activities')[1] and b.get('/api/food/day')[1]['has_history'] is False
 assert a.get('/api/food/day?d='+day)[1]['has_history'] is True
 assert today['food_user'] is False and a.get('/api/me')[1]['food_user'] is False, 'food 40 days ago is not current food use'
 recent=(dt.datetime.now(dt.timezone.utc).date()-dt.timedelta(days=3)).isoformat()
 status,fresh=a.post('/api/food/entries',[{'day':recent,'meal':'lunch','name':'Fictional recent food','kcal':200}]);assert status==200
 assert a.get('/api/food/day')[1]['food_user'] is True and a.get('/api/me')[1]['food_user'] is True
 assert b.get('/api/food/day')[1]['food_user'] is False and b.get('/api/me')[1]['food_user'] is False
 assert a.delete('/api/food/entries/'+str(fresh['ids'][0]))[0]==200 and a.get('/api/food/day')[1]['food_user'] is False
 assert b.put('/api/food/targets',{'kcal_target':2100})[0]==200 and b.get('/api/me')[1]['food_user'] is True, 'a calorie goal alone makes a food user'
 assert a.delete('/api/food/entries/'+str(result['ids'][0]))[0]==200
 assert a.get('/api/food/day')[1]['has_history'] is False
 print('Food setup history: old own food counts with empty today/no workouts; another account stays empty; deletion updates history; food_user needs a goal or food in 14 days PASS')
finally:
 a.post('/api/account/delete',{'password':PW});b.post('/api/account/delete',{'password':PW})


# Generic CSV safety probes, NOT certification of any vendor's exact headers.
from pathlib import Path
fixtures = Path(__file__).with_name('fixtures') / 'history_csv'
a, b = person('zz_test_history_csv_a'), person('zz_test_history_csv_b')
day = '2024-02-10'
def preview(name, client=a):
 return client.post('/api/food/history/preview', {'text': (fixtures / (name + '.csv')).read_text()})
try:
 for name in ('cronometer-groups-unverified', 'cronometer-biometric-unverified',
              'strong-sets-unverified', 'hevy-sets-unverified'):
  status, result = preview(name)
  assert status == 400, (name, status, result)
 for name, kcal in [('mfp-meals-unverified', 1000), ('cronometer-daily-unverified', 1900),
                    ('macrofactor-quick-unverified', 2000), ('loseit-food-unverified', 500)]:
  status, result = preview(name)
  assert status == 200 and len(result['rows']) == 1, (name, result)
  assert result['rows'][0]['eaten'] == kcal, (name, result)
  assert result['problems'] == [], result
  if name.startswith('macrofactor'):
   assert result['rows'][0]['weight_kg'] == 70 and result['rows'][0]['burned'] == 2400
 status, result = preview('mfp-weight-unverified')
 assert status == 200 and result['rows'][0]['weight_kg'] == 70
 status, result = preview('generic-daily')
 assert status == 200 and result['rows'][0]['burned'] == 2300
 row = result['rows'][0]
 assert row['weight_kg'] == 67.5 and row['eaten'] == 1800
 # Repeat and cross-source replacement preserve one daily entry instead of summing.
 for _ in range(2):
  status, saved = a.post('/api/food/history', {'rows': [row]})
  assert status == 200 and saved['days_food'] == 1, saved
 entries = a.get('/api/food/day?d=' + day)[1]['entries']
 assert len(entries) == 1 and entries[0]['kcal'] == 1800, entries
 row2 = preview('mfp-meals-unverified')[1]['rows'][0]
 assert a.post('/api/food/history', {'rows': [row2]})[0] == 200
 entries = a.get('/api/food/day?d=' + day)[1]['entries']
 assert len(entries) == 1 and entries[0]['kcal'] == 1000, entries
 # B's sentinel does not influence A's preview; A cannot replace or remove B's rows.
 sentinel = {'day': day, 'eaten': 9876, 'protein_g': 123, 'carbs_g': 234, 'fat_g': 45, 'weight_kg': 123.45}
 assert b.post('/api/food/history', {'rows': [sentinel]})[0] == 200
 assert '9876' not in str(preview('generic-daily')[1])
 assert a.delete('/api/food/history')[0] == 200
 other = b.get('/api/food/day?d=' + day)[1]['entries']
 assert len(other) == 1 and other[0]['kcal'] == 9876, other
 assert a.get('/api/food/history/days?start=' + day + '&end=' + day)[1][0]['weight_kg'] is None
 assert b.get('/api/food/history/days?start=' + day + '&end=' + day)[1][0]['weight_kg'] == 123.45
 # App-logged food wins over any daily-total import, including repeat attempts.
 assert a.post('/api/food/entries', [{'day': day, 'meal': 'lunch', 'name': 'Fictional lunch', 'kcal': 321}])[0] == 200
 result = preview('generic-daily')[1]
 assert result['rows'][0]['food_logged_here'] is True
 for _ in range(2):
  status, saved = a.post('/api/food/history', {'rows': result['rows']})
  assert status == 200 and saved['skipped_food'] == 1, saved
 entries = a.get('/api/food/day?d=' + day)[1]['entries']
 assert len(entries) == 1 and entries[0]['kcal'] == 321
 # Unknown, target and trend columns are never relabelled as actuals.
 for text in ('Date,Weight Trend,Calories Target\n2024-02-10,70,2000',
              'Date,Calories Goal\n2024-02-10,2000',
              'Date,Calories,Energy\n2024-02-10,2000,2000'):
  assert a.post('/api/food/history/preview', {'text': text})[0] == 400
 text = 'Date,Energy (kJ),Carbs Target,Protein\n2024-02-10,4184,30,'
 status, result = a.post('/api/food/history/preview', {'text': text})
 assert status == 200 and result['rows'][0]['eaten'] == 1000
 assert 'carbs_g' not in result['rows'][0] and 'protein_g' not in result['rows'][0]
 text = 'Date,Calories,Protein,Carbs,Fat\n2024-02-10,0,0,0,0'
 assert a.post('/api/food/history/preview', {'text': text})[1]['rows'][0]['eaten'] == 0
 from kc import Client
 assert Client().post('/api/food/history/preview', {'text': text})[0] == 401
 print('History CSV: explicit units, grouped/lifting/target guards, repeat/source replacement, app-food preservation and two-account isolation PASS; vendor layouts UNVERIFIED')
finally:
 a.post('/api/account/delete', {'password': PW}); b.post('/api/account/delete', {'password': PW})

# Run parser boundaries against a fixed clock in a separate test process.
import os, subprocess
project = os.environ.get('KINETTA_PROJECT', 'kinettatest')
assert project == 'kinettatest' or project.startswith('kt-')
subprocess.run(['docker', 'exec', '-i', project + '-app-1', 'python', '-'], input='''
import datetime as dt
from types import SimpleNamespace
from unittest.mock import patch
from app import history_import as H
class FixedDate(dt.date):
 @classmethod
 def today(cls): return cls(2026,11,27)
with patch.object(H, 'dt', SimpleNamespace(date=FixedDate, datetime=dt.datetime)):
 rows, problems, cols = H.parse('Date,Calories\\n2026-11-27,0\\n2026-11-28,100\\n1999-12-31,100\\n2024-02-29,500\\n2025-02-29,700', 'imperial')
 assert rows == [{'day':'2024-02-29','eaten':500.0},{'day':'2026-11-27','eaten':0.0}], rows
 assert len(problems) == 3, problems
 rows, _, _ = H.parse('\\ufeffDate;Scale Weight (kg);Energy (kJ)\\n2024-02-29;70;4184', 'imperial')
 assert rows == [{'day':'2024-02-29','weight_kg':70.0,'eaten':1000.0}], rows
print('History CSV fixed clock: today/future/lower bound/leap date/known zero/BOM/semicolon/unit override PASS')
''', text=True, check=True)
