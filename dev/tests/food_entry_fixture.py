"""Fictional saved estimate/clarification stand-ins, local isolated project only; no model calls."""
import os,subprocess,sys
from urllib.parse import urlparse
sys.path.insert(0,'dev/tests')
from kc import person,PW
base=urlparse(os.environ.get('KINETTA_URL','http://localhost:8798'));project=os.environ.get('KINETTA_PROJECT','kinettatest')
assert base.hostname in ('localhost','127.0.0.1') and (project.startswith('kt-') or project=='kinettatest')
def login_for(who):
 return {'648fastlight':'zz_test_648_fl','648fastdark':'zz_test_648_fd','648chiplight':'zz_test_648_cl','648chipdark':'zz_test_648_cd','648amblight':'zz_test_648_al','648ambdark':'zz_test_648_ad'}.get(who,'zz_test_food_compact_'+who)
port=subprocess.check_output(['docker','inspect','--format','{{(index (index .NetworkSettings.Ports "8000/tcp") 0).HostPort}}',project+'-app-1'],text=True).strip();assert base.port==int(port)
for who in ('empty','one','three','photo','clarify','actions','nullable','barcode','logged','context','copy','edit','recent','recentd','untitled','multi','multid','mixed','add390l','add390d','add330l','add330d','askkit','queue','path','restored','recipe','638one','6381d','638three','6383d','638undo','638ud','638think','638dark','648fastlight','648fastdark','648chiplight','648chipdark','648amblight','648ambdark'):
 c=person(login_for(who));assert c.post('/api/account/delete',{'password':PW})[0]==200;c=person(login_for(who),'River '+who.title());ai_ok=who in ('barcode','askkit');timezone='America/New_York' if who.startswith(('638','648')) else 'UTC';assert c.put('/api/profile',{'tz':timezone,'ai_ok':ai_ok,'ai_adult':ai_ok})[0]==200
script=r'''
import datetime as dt,uuid
from zoneinfo import ZoneInfo
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,api_food as F,food_thread as T,food_thread_compose as C,food_thread_sources as S
from app.main import app
def login_for(who):
 return {'648fastlight':'zz_test_648_fl','648fastdark':'zz_test_648_fd','648chiplight':'zz_test_648_cl','648chipdark':'zz_test_648_cd','648amblight':'zz_test_648_al','648ambdark':'zz_test_648_ad'}.get(who,'zz_test_food_compact_'+who)
foods=[{'name':'Fictional hot dog','amount':'2','grams':280,'kcal':550,'protein_g':20,'carbs_g':45,'fat_g':32},{'name':'Fictional diet soda','amount':'1 bottle','grams':590,'kcal':0,'protein_g':0,'carbs_g':0,'fat_g':0},{'name':'Fictional apple','amount':'1 apple','grams':150,'kcal':80,'protein_g':0,'carbs_g':21,'fat_g':0}]
photo=[{'name':name,'amount':amount,'grams':grams,'kcal':kcal,'protein_g':protein,'carbs_g':carbs,'fat_g':fat} for name,amount,grams,kcal,protein,carbs,fat in [('Spiced rice','0.75 cup',120,160,3,35,1),('Butter chicken','1 cup',240,380,28,12,24),('Chickpeas and potato','0.5 cup',120,150,6,24,3),('Slaw and tomato','0.5 cup',60,70,1,8,4)]]
with patch('urllib.request.urlopen',side_effect=AssertionError('No external request')):
 for who in ('one','three','photo','clarify','actions','barcode','mixed','add390l','add390d','add330l','add330d','askkit','queue','path','restored','recipe','638one','6381d','638three','6383d','638undo','638ud'):
  login='zz_test_food_compact_'+who;client=TestClient(app);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200
  if who=='askkit':
   custom=client.post('/api/food/foods',json={'name':'Fictional hot dog','serving_g':140,'kcal':210,'protein_g':14,'carbs_g':20,'fat_g':8});assert custom.status_code==200,custom.text
   print(who,'saved fictional food for inline Kit entry');continue
  draft=str(uuid.uuid4());body='Scanned product 016000157620' if who=='barcode' else 'Fictional photo result: half the rice' if who=='photo' else 'Make it two hot dogs' if who in ('three','638three','6383d') else 'A taco' if who=='clarify' else 'A fictional hot dog and a taco' if who=='mixed' else 'A fictional hot dog'
  day=dt.datetime.now(ZoneInfo('America/New_York')).date() if who.startswith('638') else dt.datetime.now(dt.timezone.utc).date()
  payload={'client_id':str(uuid.uuid4()),'draft_id':draft,'review_only':True,'body':body,'meal':'lunch','day':str(day)}
  if who=='barcode':payload.update(media='barcode',barcode='016000157620')
  response=client.post('/api/food/thread/messages',json=payload);assert response.status_code==201,response.text
  if who=='barcode':
   m=response.json()['message'];assert client.post(f"/api/food/thread/messages/{m['id']}/process",json={}).status_code==200
   with patch('app.api_food._cached',side_effect=lambda key,fetch,days:fetch()),patch('app.api_food._get',return_value={'status':0}):
    data=client.post(f"/api/food/thread/messages/{m['id']}/resolve",json={})
   assert data.status_code==200,data.text
   result=next(row['result'] for row in data.json()['messages'] if row.get('reply_to')==m['id'])
   assert result['error']['message']=="We couldn't find this barcode."
   print('barcode saved fictional not-found card')
   continue
  m=response.json()['message'];items=photo if who=='photo' else foods[:3 if who in ('three','actions','638three','6383d') else 1];items=[dict(x) for x in items]
  if who=='mixed':
   custom=client.post('/api/food/foods',json={'name':'Fictional chicken taco','serving_g':140,'kcal':210,'protein_g':14,'carbs_g':20,'fat_g':8});assert custom.status_code==200,custom.text
  estimate={'items':items,'notes':'','model':'fictional-layout-standin'};drafts=S.model_drafts(estimate)
  if who=='actions':
   product=F._off_food({'product_name':'Fictional grain','serving_size':'1 cup','serving_quantity':50,'nutriments':{'energy-kcal_100g':400,'proteins_100g':14,'carbohydrates_100g':84}})
   drafts[0]=S.catalog_draft(product,{'count':2},partial=True)
  part={'index':0,'status':'ready','estimated':True,'drafts':drafts,'entries':S.draft_entries(drafts)}
  if who=='clarify':part={'index':0,'status':'description','description':{'food':'taco','portion_only':False},'question':'What kind of taco?','replies':['Chicken taco','Beef taco']}
  parts=[part]
  if who=='mixed':parts.append({'index':1,'status':'description','description':{'food':'taco','portion_only':False},'question':'What kind of taco?','replies':['1 serving Fictional chicken taco']})
  with db.connect() as c:
   uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];result=C.write(c,uid,T.locked_message(c,uid,m['id']),{'composed':True,'day':str(dt.datetime.now(dt.timezone.utc).date()),'meal':'lunch','parts':parts})
  reply=next(x for x in result['messages'] if x.get('reply_to')==m['id']);assert not reply['result'].get('error'),reply['result'];assert client.get('/api/food/day').json()['entries']==[]
  first=(reply['result'].get('parts') or [{}])[0].get('entries') or []
  if first and first[0].get('name')=='Fictional hot dog':assert first[0].get('amount')==2 and first[0].get('kcal')==550, f"two fictional portions keep count-matched calories: {first[0]}"
  print(who,'saved fictional stand-in ready')
login='zz_test_food_compact_logged';client=TestClient(app);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200
draft=str(uuid.uuid4());message=client.post('/api/food/thread/messages',json={'client_id':str(uuid.uuid4()),'draft_id':draft,'body':'Fictional logged apple','meal':'lunch','day':str(dt.datetime.now(dt.timezone.utc).date())});assert message.status_code==201,message.text
m=message.json()['message'];entry={'name':'Fictional logged apple','brand':None,'amount':1,'unit':'serving','kcal':80,'protein_g':0,'carbs_g':21,'fat_g':0,'fiber_g':4,'source':'quick','ref':{}}
with db.connect() as c:
 uid=c.execute('SELECT id FROM users WHERE login=%s',(login,)).fetchone()['id'];result=C.write(c,uid,T.locked_message(c,uid,m['id']),{'composed':True,'day':str(dt.datetime.now(dt.timezone.utc).date()),'meal':'lunch','parts':[{'index':0,'status':'ready','manual':True,'entries':[entry]}]},force=True)
reply=next(x for x in result['messages'] if x.get('reply_to')==m['id']);assert reply['entries'] and reply['result']['kind']=='log'
print('logged saved fictional card')
def signed(who):
 client=TestClient(app);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':'zz_test_food_compact_'+who,'password':'green teapot on the hill'}).status_code==200;return client
today=dt.datetime.now(dt.timezone.utc).date();yesterday=(today-dt.timedelta(days=1)).isoformat()
for who,day,name in [('copy',yesterday,'Fictional copied breakfast'),('edit',today.isoformat(),'Fictional editable food')]:
 client=signed(who);res=client.post('/api/food/entries',json=[{'client_id':str(uuid.uuid4()),'day':day,'meal':'breakfast','name':name,'amount':1,'unit':'serving','kcal':320,'protein_g':12,'carbs_g':44,'fat_g':9,'fiber_g':5,'source':'quick','ref':{}}]);assert res.status_code==200,res.text
client=signed('untitled');res=client.post('/api/dishes',json={});assert res.status_code==200,res.text;did=res.json()['id'];res=client.post(f'/api/dishes/{did}/items',json={'name':'Fictional oats','grams':40,'per100':{'kcal':389,'protein_g':16.9,'carbs_g':66.3,'fat_g':6.9,'fiber_g':10.6}});assert res.status_code==200,res.text
def seed_recent(who):
 client=signed(who);recipe_ids=[]
 for i in range(1,4):
  res=client.post('/api/dishes',json={'name':f'Fictional recent recipe {i}'});assert res.status_code==200,res.text;did=res.json()['id'];recipe_ids.append(did);res=client.post(f'/api/dishes/{did}/items',json={'name':'Fictional rice','grams':100,'per100':{'kcal':130,'protein_g':2.7,'carbs_g':28,'fat_g':0.3,'fiber_g':0.4}});assert res.status_code==200,res.text
 requests=[{'grams':125,'meal':'lunch','day':today.isoformat(),'client_id':str(uuid.uuid4())},{'share':0.25,'of':4,'meal':'lunch','day':today.isoformat(),'client_id':str(uuid.uuid4())},{'count':2,'meal':'lunch','day':today.isoformat(),'client_id':str(uuid.uuid4())}]
 for did,portion in zip(recipe_ids,requests):
  res=client.post(f'/api/dishes/{did}/portion',json=portion);assert res.status_code==200,res.text
  assert client.post(f'/api/dishes/{did}/portion',json=portion).json().get('replayed') is True,'portion retry stays idempotent'
 meal_ids=[]
 for i in range(1,4):
  res=client.post('/api/food/entries',json=[{'client_id':str(uuid.uuid4()),'day':today.isoformat(),'meal':'breakfast','name':f'Fictional meal food {i}','amount':1,'unit':'serving','kcal':100,'protein_g':5,'carbs_g':12,'fat_g':3,'sodium_mg':200,'sugar_g':4,'saturated_fat_g':2,'source':'quick','ref':{}}]);assert res.status_code==200,res.text;eid=res.json()['ids'][0];res=client.post('/api/food/meals',json={'name':f'Fictional recent saved meal {i}','entry_ids':[eid]});assert res.status_code==200,res.text;mid=res.json()['id'];meal_ids.append(mid);res=client.post('/api/food/entries',json=[{'client_id':str(uuid.uuid4()),'day':today.isoformat(),'meal':'breakfast','name':f'Fictional meal food {i}','amount':1.5,'unit':'serving','kcal':150,'protein_g':7.5,'carbs_g':18,'fat_g':4.5,'sodium_mg':300,'sugar_g':6,'saturated_fat_g':3,'source':'meal','ref':{'saved_meal_id':mid,'saved_meal_factor':1.5}}]);assert res.status_code==200,res.text
 repeat={'share':0.5,'of':4,'meal':'lunch','day':today.isoformat(),'client_id':str(uuid.uuid4())}
 res=client.post(f'/api/dishes/{recipe_ids[1]}/portion',json=repeat);assert res.status_code==200,res.text
 assert client.post(f'/api/dishes/{recipe_ids[1]}/portion',json=repeat).json().get('replayed') is True,'last portion retry does not create a duplicate'
 recent_dishes={x['id']:x for x in client.get('/api/dishes').json()};recent_meals={x['id']:x for x in client.get('/api/food/meals').json()}
 all_recent=[*recent_dishes.values(),*recent_meals.values()]
 assert [x['name'] for x in sorted((x for x in all_recent if x['last_used_entry_id']),key=lambda x:x['last_used_entry_id'],reverse=True)[:5]]==['Fictional recent recipe 2','Fictional recent saved meal 3','Fictional recent saved meal 2','Fictional recent saved meal 1','Fictional recent recipe 3'],'cross-kind last-used order and top-five cutoff'
 assert recent_dishes[recipe_ids[0]]['last_used_portion']=={'grams':125.0},'recipe recency keeps the latest gram portion without stale day/meal/of'
 assert recent_dishes[recipe_ids[1]]['last_used_portion']=={'share':0.5},'recipe recency keeps the latest share without stale day/meal/of'
 assert recent_dishes[recipe_ids[2]]['last_used_portion']=={'count':2.0},'recipe recency keeps serving count'
 assert all(recent_meals[mid]['last_used_factor']==1.5 for mid in meal_ids),'saved meal recency keeps the last scale'
 return client,meal_ids
client,meal_ids=seed_recent('recent');seed_recent('recentd')
# A saved meal marker can only point to a saved meal owned by the requester.
foreign_client=signed('copy');foreign=foreign_client.post('/api/food/entries',json=[{'client_id':str(uuid.uuid4()),'day':today.isoformat(),'meal':'breakfast','name':'Fictional own food with foreign marker','amount':1,'unit':'serving','kcal':100,'protein_g':5,'carbs_g':12,'fat_g':3,'source':'meal','ref':{'saved_meal_id':meal_ids[0],'saved_meal_factor':1.5}}]);assert foreign.status_code==200,foreign.text
foreign_row=next(x for x in foreign_client.get('/api/food/day?d='+today.isoformat()).json()['entries'] if x['id']==foreign.json()['ids'][0]);assert foreign_row['kcal']==100 and 'saved_meal_id' not in (foreign_row['ref'] or {}) and 'saved_meal_factor' not in (foreign_row['ref'] or {}),'foreign meal metadata is stripped while the users own food remains logged'
# The full food snapshot remains loggable if a queued request first arrives after its source meal was deleted.
queued_source=client.post('/api/food/entries',json=[{'client_id':str(uuid.uuid4()),'day':today.isoformat(),'meal':'lunch','name':'Fictional queued source','amount':1,'unit':'serving','kcal':80,'protein_g':3,'carbs_g':10,'fat_g':2,'source':'quick','ref':{}}]);assert queued_source.status_code==200,queued_source.text
queued_meal=client.post('/api/food/meals',json={'name':'Fictional queued meal','entry_ids':queued_source.json()['ids']});assert queued_meal.status_code==200,queued_meal.text
queued_item={'client_id':str(uuid.uuid4()),'day':today.isoformat(),'meal':'lunch','name':'Fictional queued meal food','amount':1.5,'unit':'serving','kcal':120,'protein_g':4.5,'carbs_g':15,'fat_g':3,'source':'meal','ref':{'saved_meal_id':queued_meal.json()['id'],'saved_meal_factor':1.5}}
assert client.request('DELETE',f"/api/food/meals/{queued_meal.json()['id']}",json={}).status_code==200
queued=client.post('/api/food/entries',json=[queued_item]);assert queued.status_code==200,queued.text;queued_row=next(x for x in client.get('/api/food/day?d='+today.isoformat()).json()['entries'] if x['id']==queued.json()['ids'][0]);assert queued_row['kcal']==120 and 'saved_meal_id' not in (queued_row['ref'] or {}),'deleted-meal offline snapshot still logs without stale metadata'
# An acknowledged retry stays idempotent even if its saved-meal label is deleted on another device.
source=client.post('/api/food/entries',json=[{'client_id':str(uuid.uuid4()),'day':today.isoformat(),'meal':'lunch','name':'Fictional retry source','amount':1,'unit':'serving','kcal':90,'protein_g':4,'carbs_g':10,'fat_g':2,'source':'quick','ref':{}}]);assert source.status_code==200,source.text
retry_meal=client.post('/api/food/meals',json={'name':'Fictional retry meal','entry_ids':source.json()['ids']});assert retry_meal.status_code==200,retry_meal.text
retry_item={'client_id':str(uuid.uuid4()),'day':today.isoformat(),'meal':'lunch','name':'Fictional retry portion','amount':1.5,'unit':'serving','kcal':135,'protein_g':6,'carbs_g':15,'fat_g':3,'source':'meal','ref':{'saved_meal_id':retry_meal.json()['id'],'saved_meal_factor':1.5}}
first=client.post('/api/food/entries',json=[retry_item]);assert first.status_code==200,first.text
assert client.request('DELETE',f"/api/food/meals/{retry_meal.json()['id']}",json={}).status_code==200
retry=client.post('/api/food/entries',json=[retry_item]);assert retry.status_code==200,retry.text;assert retry.json()['ids']==first.json()['ids'],'delete-after-write retry returns the original log id'
print('copied/editable/recent/untitled fictional diary rows ready')
repeat_day=dt.datetime.now(ZoneInfo('America/New_York')).date();repeat_now=dt.datetime.now(dt.timezone.utc)
repeat_groups={
 '648fastlight':[[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)]],
 '648fastdark':[[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)]],
 '648chiplight':[[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)]],
 '648chipdark':[[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)]],
 '648amblight':[[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)],[('Fictional pear',1,'piece',95)]],
 '648ambdark':[[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)],[('Fictional pear',1,'piece',95)]],
}
for who,groups in repeat_groups.items():
 with db.connect() as c:
  uid=c.execute('SELECT id FROM users WHERE login=%s',(login_for(who),)).fetchone()['id']
  for group_index,items in enumerate(groups):
   group_id=str(uuid.uuid4());created=repeat_now-dt.timedelta(minutes=5-group_index*2)
   for index,(name,amount,unit,kcal) in enumerate(items,1):
    c.execute("""INSERT INTO food_entries(user_id,day,meal,name,amount,unit,kcal,protein_g,carbs_g,fat_g,source,ref,position,client_id,created,updated)
                 VALUES (%s,%s,'lunch',%s,%s,%s,%s,2,18,4,'quick','{}',%s,%s,%s,%s)""",
              (uid,repeat_day,name,amount,unit,kcal,index,f'{group_id}-{index:02d}',created,created))
print('recent fictional repeat groups ready')
'''
subprocess.run(['docker','exec','-i',project+'-app-1','python','-'],input=script,text=True,check=True)
