import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from app.training_food import policy,target
base={'birth_year':1990,'nutrition_goal':'maintain'}
assert policy(base,2026,False,False)['reason']=='no_training'
assert not policy(base,2026,False,True)['enabled']
assert policy(base,2026,True,False)['enabled']
assert policy({**base,'nutrition_goal':'fuel_training'},2026,False,True)['enabled']
assert not policy({**base,'training_day_targets':False},2026,True,True)['enabled']
for born,confirmed,eligible in [(2010,True,False),(2008,False,False),(2008,True,True),(2007,False,True),(None,False,False),(None,True,True)]:
 assert policy({**base,'birth_year':born,'training_food_adult_confirmed':confirmed},2026,True,True)['eligible']==eligible
for recorded,planned,usual,expected in [(0,0,200,0),(100,0,200,0),(540,0,200,340),(540,600,200,400),(300,1200,200,1000),(10000,0,200,1500)]:
 t=target(2100,None,recorded,planned,usual,True,True);assert t['extra']==expected and t['kcal']==2100+expected
assert target(2100,1800,1000,1000,0,True,True)['kcal']==1800
assert target(2100,None,1000,1000,0,False,True)['kcal']==2100
assert target(2100,None,1000,1000,0,True,False)['kcal']==2100
assert target(2100,None,1000,1000,0,True,True,current_day=False)['kcal']==2100
assert target(None,None,1000,1000,0,True,True)['kcal'] is None
assert target(9900,None,1000,1000,0,True,True)['kcal']==10000
print('Training food rules: plan/fuel defaults, explicit off, conservative18+confirmation/minor/unknown guards, rest/easy/long/recordedvsplanned/averageexercise subtraction, cap, customday/nohistorychange/no target PASS')

from app.training_food import low_intake
t={'eligible':True,'recorded_minutes':100}
assert low_intake(t,1000,3000,False,18)
for eaten,burned,unknown,hour in [(0,3000,False,18),(1000,None,False,18),(1000,3000,True,18),(1000,3000,False,10),(2200,3000,False,18)]:assert low_intake(t,eaten,burned,unknown,hour) is None
assert low_intake({**t,'eligible':False},1000,3000,False,18) is None
assert low_intake({**t,'recorded_minutes':30},1000,3000,False,18) is None
print('Gentle long-day note: adult/training90min/late-day/known-positive log only, unknown burn/calories/emptylog/ordinaryday silence PASS')

assert target(0,None,1000,1000,0,True,True)['kcal'] is None
