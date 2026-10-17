"""Goal setup previews never write; explicit saves are private and bounded. Fictional accounts only."""
import datetime as dt
from kc import person, Client

p, other = person('zz_test_onboard'), person('zz_test_onboard_other')
ok = 0

def check(label, value):
    global ok
    assert value, label
    ok += 1

profile = {'weight_kg':80,'height_cm':180,'birth_year':1990,'sex':'male','activity_factor':1.3}
p.put('/api/profile',profile)
p.put('/api/food/targets',{'kcal_target':2200,'protein_target':120,'carbs_target':250,'fat_target':65,'fiber_target':30})
p.put('/api/profile',{'resting_source':'apple_health'})
p.put('/api/food/day-goal',{'day':dt.date.today().isoformat(),'kcal':2300})
before = p.get('/api/me')[1]
base = {'goal':'lose_weight','pace_percent':.5,'activity_factor':1.3}
status,s = p.post('/api/food/target-suggestion',base)
check('preview succeeds',status==200)
rest = 10*80+6.25*180-5*(dt.date.today().year-1990)+5
expected=max(__import__('math').ceil(rest/10)*10,round((rest*1.3-80*.005*7700/7)/10)*10)
check('calorie suggestion uses energy formula and pace',s['kcal_target']==expected)
check('protein suggestion uses weight and goal',s['protein_target']==130)
check('preview and skip write nothing',p.get('/api/me')[1]==before)
for goal in ('maintain','build_muscle','eat_healthier','fuel_training'):
 status,r=p.post('/api/food/target-suggestion',{**base,'goal':goal})
 check('all five goals '+goal,status==200 and r['kcal_target']>=r['resting_floor'] and r['protein_target']>0)
 if goal in ('maintain','eat_healthier','fuel_training'):check('non-weight goal ignores pace '+goal,r['pace_percent']==0)
status,floor=p.post('/api/food/target-suggestion',{**base,'pace_percent':1,'activity_factor':1.2})
check('floor binds at aggressive pace',status==200 and floor['floor_applied'] and floor['kcal_target']>=rest)
for pace in (-.1,1.01,float('inf'),float('nan')):
 check('invalid pace '+str(pace),p.post('/api/food/target-suggestion',{**base,'pace_percent':pace})[0]==422)
check('invalid activity rejected',p.post('/api/food/target-suggestion',{**base,'activity_factor':2})[0]==400)
check('minor estimate rejected',p.post('/api/food/target-suggestion',{**base,'birth_year':dt.date.today().year-15})[0]==400)
check('no body defaults are explicit',other.post('/api/food/target-suggestion',{'goal':'eat_healthier'})[1]['weight_assumed'])
check('no target created on other account',not other.get('/api/me')[1].get('kcal_target'))
check('anonymous preview denied',Client().post('/api/food/target-suggestion',base)[0]==401)
check('below resting save rejected',p.put('/api/food/goal-setup',{**base,'kcal_target':s['resting_floor']-1,'protein_target':130})[0]==400)
check('invalid save atomic',p.get('/api/me')[1]==before)
other_before=other.get('/api/me')[1]
status,saved=p.put('/api/food/goal-setup',{**base,'kcal_target':s['kcal_target']+10,'protein_target':135,'user_id':other_before['id']})
check('explicit edited save succeeds',status==200 and saved['profile']['protein_target']==135)
after=p.get('/api/me')[1]
check('goal and pace persisted',after['nutrition_goal']=='lose_weight' and after['goal_pace_percent']==.5)
check('edited targets persisted',after['kcal_target']==s['kcal_target']+10 and after['protein_target']==135)
check('other macros preserved',all(after[k]==before[k] for k in ('carbs_target','fat_target','fiber_target')))
check('Health setting and body preserved',all(after[k]==before[k] for k in (*profile,'resting_source')))
check('other account unchanged',other.get('/api/me')[1]==other_before)
day=p.get('/api/food/day?d='+dt.date.today().isoformat())[1]
check('Nutrition sees saved targets',day['targets']['protein_target']==135 and day['goal']['default']==s['kcal_target']+10)
check('daily override preserved',day['goal']['custom']==2300)
check('save retry idempotent',p.put('/api/food/goal-setup',{**base,'kcal_target':s['kcal_target']+10,'protein_target':135})[0]==200)
check('explicit body changes can save',p.put('/api/food/goal-setup',{'goal':'maintain','weight_kg':90,'activity_factor':1.45,'kcal_target':3000,'protein_target':110})[0]==200 and p.get('/api/me')[1]['weight_kg']==90)
print(f'onboarding: {ok} passed')

other.put('/api/food/weights',{'day':dt.date.today().isoformat(),'kg':90})
other.put('/api/profile',{'weight_kg':None,'activity_factor':1.45})
r=other.post('/api/food/target-suggestion',{'goal':'maintain'})[1]
check('preview uses stored weight trend and current activity',r['weight_kg']==90 and not r['weight_assumed'] and r['activity_factor']==1.45)
check('float storage normalization',other.post('/api/food/target-suggestion',{'goal':'maintain','activity_factor':1.4500000477})[0]==200)
other.put('/api/profile',{'weight_kg':85})
check('save without body fields preserves concurrent profile',other.put('/api/food/goal-setup',{'goal':'maintain','kcal_target':3000,'protein_target':120})[0]==200 and other.get('/api/me')[1]['weight_kg']==85)
print('onboarding review regressions: weight trend, stored float, untouched body/activity fields PASS')

latest=other.get('/api/food/weights/latest')[1]['points']
check('latest-only weight read bounded and private',len(latest)==1 and latest[0]['kg']==90)
check('latest-only read requires authentication',Client().get('/api/food/weights/latest')[0]==401)
