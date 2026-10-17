"""Fictional list/recipe receipts, replay and delayed correction privacy contracts."""
import uuid
import datetime as dt
from kc import person,PW

a,b=person('zz_test_receipts_a'),person('zz_test_receipts_b')
def post(path,body,client=a,status=200):
 s,r=client.post(path,body);assert s==status,(path,s,r);return r

def entry(name='Fictional oats',**extra):
 return {'day':'2026-10-16','meal':'lunch','name':name,'kcal':200,'protein_g':10,'carbs_g':30,'fat_g':4,'client_id':str(uuid.uuid4()),**extra}
def history(client=a):return client.get('/api/food/thread?limit=100')[1]['messages']
def roots(client=a):return [m for m in history(client) if m['kind']=='user']
def send(text,context=None,client=a):
 m=post('/api/food/thread/messages',{'body':text,'client_id':str(uuid.uuid4()),**({'context':context} if context else {})},client,status=201)['message']
 return m,post(f"/api/food/thread/messages/{m['id']}/process",{},client)
try:
 old=entry('Legacy oats');post('/api/food/entries',[old]);assert not history(),'legacy client contract stays unchanged'
 item=entry();r=post('/api/food/entries?thread=true&captured_at=2026-10-16T17:00:00Z',[item]);root=r['messages'][0];reply=r['messages'][1]
 assert root['result']['receipt']['client_id']==item['client_id'] and reply['entries'][0]['kcal']==200
 assert dt.datetime.fromisoformat(root['captured_at'])==dt.datetime(2026,10,16,17,tzinfo=dt.timezone.utc)
 again=post('/api/food/entries?thread=true',[item]);assert r['ids']==again['ids'] and [m['id'] for m in r['messages']]==[m['id'] for m in again['messages']]
 assert again['messages'][1]['entries'][0]['id']==r['ids'][0]
 assert b.get('/api/food/thread')[1]['messages']==[]
 assert b.post(f"/api/food/thread/messages/{root['id']}/undo",{})[0]==404
 post(f"/api/food/thread/messages/{root['id']}/undo",{});post('/api/food/entries?thread=true',[item],status=409)
 assert not any(e['id']==r['ids'][0] for e in a.get('/api/food/day?d=2026-10-16')[1]['entries'])
 kept=entry('Kept food');r=post('/api/food/entries?thread=true',[kept]);mid=r['messages'][0]['id'];assert a.delete('/api/food/thread/messages/'+str(mid))[0]==200
 replay=post('/api/food/entries?thread=true',[kept]);assert replay['ids']==r['ids'] and not replay['messages'],'deleted text never resurrects'
 assert a.delete('/api/food/entries/'+str(r['ids'][0]))[0]==200;post('/api/food/entries?thread=true',[kept],status=409)
 dish=post('/api/dishes',{'name':'Fictional soup'});did=dish['id'];assert a.patch('/api/dishes/'+str(did),{'known_kcal':600,'known_protein_g':30,'known_carbs_g':70,'known_fat_g':20})[0]==200
 portion={'count':.5,'day':'2026-10-16','meal':'dinner','client_id':str(uuid.uuid4())}
 pr=post(f'/api/dishes/{did}/portion?thread=true',portion);assert pr['entry']['kcal']==300 and len(pr['messages'])==2
 assert post(f'/api/dishes/{did}/portion?thread=true',portion)['entry']['id']==pr['entry']['id']
 post(f'/api/dishes/{did}/portion?thread=true',{**portion,'count':1},status=409)
 post(f"/api/food/thread/messages/{pr['messages'][0]['id']}/undo",{});post(f'/api/dishes/{did}/portion?thread=true',portion,status=409)
 # Another device adds food while this device still shows its earlier food card.
 first=post('/api/food/entries?thread=true',[entry('First plate')]);second=post('/api/food/entries?thread=true',[entry('Other device plate',kcal=400)])
 correction,result=send('make it half',first['messages'][0]['client_id']);assert result['messages'][-1]['result']['kind']=='edit',result
 rows=a.get('/api/food/day?d=2026-10-16')[1]['entries'];assert next(e for e in rows if e['id']==first['ids'][0])['kcal']==100;assert next(e for e in rows if e['id']==second['ids'][0])['kcal']==400
 foreign=post('/api/food/entries?thread=true',[entry('Private other plate')],b)
 _,result=send('make it half',foreign['messages'][0]['client_id']);assert result['messages'][-1]['result']['kind']=='needs'
 assert b.get('/api/food/day?d=2026-10-16')[1]['entries'][0]['kcal']==200
 conflict=a.post('/api/food/thread/messages',{'body':'make it half','client_id':correction['client_id'],'context':second['messages'][0]['client_id']});assert conflict[0]==409
 # A non-food question does not lose its deterministic answer when its old food context disappeared.
 assert a.delete('/api/food/thread/messages/'+str(second['messages'][0]['id']))[0]==200
 _,result=send('how many calories so far?',second['messages'][0]['client_id']);assert result['messages'][-1]['result']['kind']=='answer'
 pending=post('/api/food/thread/messages',{'body':'Pending fictional plate','client_id':str(uuid.uuid4())},status=201)['message']
 _,result=send('make it half',pending['client_id']);assert result['messages'][-1]['result']['kind']=='needs','an unprocessed context asks which food rather than failing'
 print('Food picker receipts: replay/Undo/text deletion, recipe portion identity, context/account isolation and deterministic questions PASS')
finally:
 for c in (a,b):c.post('/api/account/delete',{'password':PW})
