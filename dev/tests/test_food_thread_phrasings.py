"""Fifty fictional loose phrasings log correct own-food totals without any model or rephrase."""
import datetime as dt
import json
from pathlib import Path
import uuid
from kc import person,PW
p=person('zz_test_thread_phrasings')
p.put('/api/profile',{'tz':'UTC','ai_ok':False})
p.put('/api/food/targets',{'kcal_target':2000})
for name,kcal in [('Protein bar',200),('Eggs',70),('Toast',80)]:
 status,_=p.post('/api/food/foods',{'name':name,'serving_label':'1 serving','kcal':kcal,'protein_g':10,'carbs_g':10,'fat_g':4});assert status==200
status,dish=p.post('/api/dishes',{'name':'Garden pasta'});assert status==200
assert p.patch('/api/dishes/'+str(dish['id']),{'known_kcal':2000,'known_protein_g':100,'known_carbs_g':200,'known_fat_g':80,'cooked_g':1000,'serving':'portion'})[0]==200
now=dt.datetime.now(dt.timezone.utc);captured=dt.datetime.combine(now.date()-dt.timedelta(days=1),dt.time(9),dt.timezone.utc)
cases=json.loads((Path(__file__).parent/'fixtures/food_thread_phrasings.json').read_text())['cases']
for case in cases:
 status,stored=p.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':case['text'],'captured_at':captured.isoformat()});assert status==201
 mid=stored['message']['id'];status,result=p.post('/api/food/thread/messages/'+str(mid)+'/process',{})
 assert status==200,(case['text'],status,result)
 reply=result['messages'][-1]
 assert reply['result']['kind']=='log',(case['text'],reply['body'])
 assert abs(sum(e['kcal'] for e in reply['entries'])-case['kcal'])<.01,(case['text'],reply['entries'])
 assert reply['body'].count('?')==0,case['text']
 assert p.post('/api/food/thread/messages/'+str(mid)+'/undo',{})[0]==200
assert p.post('/api/account/delete',{'password':PW})[0]==200
print(f'food thread loose phrasings: {len(cases)} fictional cases logged correct own-food nutrition; no rephrasing/questions/model calls')
