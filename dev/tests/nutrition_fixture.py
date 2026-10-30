"""Isolated fictional accounts for Nutrition browser evidence; no providers/devices."""
import datetime as dt
import sys
import os
import subprocess
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
sys.path.insert(0,'dev/tests')
from kc import person, PW
assert urlparse(os.environ.get('KINETTA_URL','http://localhost:8798')).hostname in ('localhost','127.0.0.1')
assert os.environ.get('KINETTA_PROJECT','kinettatest').startswith('kt-') or os.environ.get('KINETTA_PROJECT','kinettatest')=='kinettatest'
project=os.environ.get('KINETTA_PROJECT','kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip()
assert urlparse(os.environ.get('KINETTA_URL','http://localhost:8798')).port==int(port),'URL must reach this isolated test project'
TODAY=dt.datetime.now(ZoneInfo('America/New_York')).date()
def ok(result):
 assert result[0]==200,result
 return result[1]
for who in ('empty','typical','heavy'):
 name='zz_test_nutrition_'+who;c=person(name)
 ok(c.post('/api/account/delete',{'password':PW}));c=person(name,'River '+who.title())
 if who=='empty':continue
 ok(c.put('/api/profile',{'tz':'America/New_York','weight_kg':70,'height_cm':174,'birth_year':1992,'sex':'female','activity_factor':1.3,'ai_ok':False}))
 ok(c.put('/api/food/targets',{'kcal_target':2100,'protein_target':130,'carbs_target':None,'fat_target':None}))
 meals=[('breakfast','Oats, yogurt and berries',395,24,56,10),('lunch','Chicken and rice bowl',520,40,60,13),('dinner','Salmon with potatoes',610,42,52,25),('snacks','Apple and peanut butter',210,6,28,10)]
 rows=[]
 for days in range(7 if who=='typical' else 35):
  day=str(TODAY-dt.timedelta(days=days))
  for meal,label,kcal,p,carbs,fat in meals:
   names=[label] if who=='typical' else [label,'Mixed vegetables','Wholegrain side','Fruit bowl','Greek yogurt']
   for i,label in enumerate(names):rows.append({'day':day,'meal':meal,'name':label,'amount':1,'unit':'serving','kcal':kcal if i==0 else 80,'protein_g':p if i==0 else 4,'carbs_g':carbs if i==0 else 10,'fat_g':fat if i==0 else 2,'source':'quick'})
 for at in range(0,len(rows),60):ok(c.post('/api/food/entries',rows[at:at+60]))
 for d in range(7 if who=='typical' else 30):ok(c.put('/api/food/weights',{'day':str(TODAY-dt.timedelta(days=d)),'kg':70+d*.03}))
 ok(c.post('/api/food/foods',{'name':'Fixturebar','kcal':200,'protein_g':12,'carbs_g':20,'fat_g':8}))
 for i in range(3 if who=='typical' else 12):
  recipe=ok(c.post('/api/dishes',{'name':'Fictional recipe '+str(i+1)}))
  ok(c.patch('/api/dishes/'+str(recipe['id']),{'known_kcal':400,'known_protein_g':20,'known_carbs_g':40,'known_fat_g':15}))
 print(who,'fictional food fixture ready')
