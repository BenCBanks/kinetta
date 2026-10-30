"""Fictional saved estimate/clarification stand-ins, local isolated project only; no model calls."""
import os,subprocess,sys
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ.get('KINETTA_URL','http://localhost:8798'));project=os.environ.get('KINETTA_PROJECT','kinettatest')
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
for who in ('empty','one','three','photo','clarify','actions'):
 c=person('zz_test_food_compact_'+who);assert c.post('/api/account/delete',{'password':PW})[0]==200;c=person('zz_test_food_compact_'+who,'River '+who.title());assert c.put('/api/profile',{'tz':'UTC','ai_ok':False})[0]==200
script=r'''
import datetime as dt,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,api_food as F,food_thread as T,food_thread_compose as C,food_thread_sources as S
from app.main import app
foods=[{'name':'Fictional hot dog','amount':'2','grams':280,'kcal':550,'protein_g':20,'carbs_g':45,'fat_g':32},{'name':'Fictional diet soda','amount':'1 bottle','grams':590,'kcal':0,'protein_g':0,'carbs_g':0,'fat_g':0},{'name':'Fictional apple','amount':'1 apple','grams':150,'kcal':80,'protein_g':0,'carbs_g':21,'fat_g':0}]
photo=[{'name':name,'amount':amount,'grams':grams,'kcal':kcal,'protein_g':protein,'carbs_g':carbs,'fat_g':fat} for name,amount,grams,kcal,protein,carbs,fat in [('Spiced rice','0.75 cup',120,160,3,35,1),('Butter chicken','1 cup',240,380,28,12,24),('Chickpeas and potato','0.5 cup',120,150,6,24,3),('Slaw and tomato','0.5 cup',60,70,1,8,4)]]
with patch('urllib.request.urlopen',side_effect=AssertionError('No external request')):
 for who in ('one','three','photo','clarify','actions'):
  login='zz_test_food_compact_'+who;client=TestClient(app);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200
  draft=str(uuid.uuid4());body='Fictional photo result: half the rice' if who=='photo' else 'Make it two hot dogs' if who=='three' else 'A taco' if who=='clarify' else 'A fictional hot dog'
  response=client.post('/api/food/thread/messages',json={'client_id':str(uuid.uuid4()),'draft_id':draft,'review_only':True,'body':body,'meal':'lunch','day':str(dt.date.today())});assert response.status_code==201,response.text
  m=response.json()['message'];items=photo if who=='photo' else foods[:3 if who in ('three','actions') else 1];items=[dict(x) for x in items]
  estimate={'items':items,'notes':'','model':'fictional-layout-standin'};drafts=S.model_drafts(estimate)
  if who=='actions':
   product=F._off_food({'product_name':'Fictional grain','serving_size':'1 cup','serving_quantity':50,'nutriments':{'energy-kcal_100g':400,'proteins_100g':14,'carbohydrates_100g':84}})
   drafts[0]=S.catalog_draft(product,{'count':2},partial=True)
  part={'index':0,'status':'ready','estimated':True,'drafts':drafts,'entries':S.draft_entries(drafts)}
  if who=='clarify':part={'index':0,'status':'description','description':{'food':'taco','portion_only':False},'question':'What kind of taco?','replies':['Chicken taco','Beef taco']}
  with db.connect() as c:
   uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];result=C.write(c,uid,T.locked_message(c,uid,m['id']),{'composed':True,'day':str(dt.date.today()),'meal':'lunch','parts':[part]})
  reply=next(x for x in result['messages'] if x.get('reply_to')==m['id']);assert not reply['result'].get('error'),reply['result'];assert client.get('/api/food/day').json()['entries']==[]
  print(who,'saved fictional stand-in ready')
'''
subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],input=script,text=True,check=True)
