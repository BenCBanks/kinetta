"""Fictional library/recipe layouts on this guarded throwaway project. No providers or model calls."""
import os,sys,subprocess,json
from pathlib import Path
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ['KINETTA_URL']);project=os.environ['KINETTA_PROJECT'];assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
def ok(r):
 assert r[0]==200,(r[0],str(r[1])[:400])
 return r[1]
recipes=[('Chicken and veg traybake',5,[('Chicken breast, raw',600,120,22,0,3),('Sweet potato',500,86,1.6,20,.1),('Carrots',200,40,1,9,.2),('Olive oil',35,900,0,0,100)]),('Berry protein smoothie',1,[('Banana',120,89,1,23,.3),('Mixed berries',150,50,1,12,.5),('Fictional whey',30,380,75,10,6),('Oats',30,380,13,65,7)]),('Lentil and tomato soup',4,[('Cooked lentils',600,116,9,20,.4),('Chopped tomatoes',400,24,1,4,.2),('Carrots',200,40,1,9,.2),('Olive oil',15,900,0,0,100)])]
ids={}
for state in ('empty','typical','heavy','recipe'):
 c=person('zz_test_recipes_ui_'+state);ok(c.post('/api/account/delete',{'password':PW}));c=person('zz_test_recipes_ui_'+state,'River '+state.title());ok(c.put('/api/profile',{'tz':'UTC','ai_ok':False}));ids[state]={}
 n=0 if state=='empty' else 25 if state=='heavy' else 3 if state=='typical' else 1
 for i in range(n-1,-1,-1):
  name,yield_n,items=recipes[i%3];name=name if i<3 else f'Fictional recipe {i+1:02} · '+name
  d=ok(c.post('/api/dishes',{'name':name}));did=d['id']
  for label,g,k,p,carb,f in items:d=ok(c.post(f'/api/dishes/{did}/items',{'name':label,'grams':g,'source':'quick','per100':{'kcal':k,'protein_g':p,'carbs_g':carb,'fat_g':f,'fiber_g':0}}))
  mode='portion' if i%3==2 else 'one';d=ok(c.patch(f'/api/dishes/{did}',{'yield_servings':yield_n,'serving':mode,**({'cooked_g':1500} if mode=='portion' else {})}));assert d['serving_count']==yield_n
  if i==0:ids[state]['saved']=did
 for i in range(0 if state in ('empty','recipe') else 30 if state=='heavy' else 2):
  ok(c.post('/api/food/foods',{'name':('Fictional protein yogurt' if i==0 else 'Fictional oat bar' if i==1 else f'Fictional pantry food {i+1:02}'),'brand':'Fictional Pantry','serving_label':'1 pot' if i==0 else '1 bar' if i==1 else '1 portion','serving_g':170 if i==0 else 50,'kcal':180,'protein_g':12,'carbs_g':20,'fat_g':6,'fiber_g':3}))
 if state=='recipe':
  d=ok(c.post('/api/dishes',{}));ids[state]['draft']=d['id'];ok(c.post(f'/api/dishes/{d["id"]}/items',{'name':'Fictional unsaved-name ingredient','grams':100,'source':'quick','per100':{'kcal':100,'protein_g':10,'carbs_g':10,'fat_g':2,'fiber_g':0}}))
 assert len(ok(c.get('/api/dishes')))==n+(1 if state=='recipe' else 0)
 print(state,n,'recipes and',len(ok(c.get('/api/food/foods'))),'foods ready')
if os.environ.get('KINETTA_RECIPE_IDS'):Path(os.environ['KINETTA_RECIPE_IDS']).write_text(json.dumps(ids))
print(json.dumps(ids))
