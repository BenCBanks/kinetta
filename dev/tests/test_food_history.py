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
