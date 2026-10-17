"""Resolved own-food thread logging: no AI, meal inference, explicit-tap option and Undo."""
import concurrent.futures
import datetime as dt
import uuid
from kc import Client, PW, login, person

n=0

def check(value,label):
 global n
 assert value,label
 n+=1

a,b=person('zz_test_thread_log_a'),person('zz_test_thread_log_b')
for c in (a,b):
 c.put('/api/profile',{'tz':'UTC','weight_kg':75,'height_cm':175,'birth_year':1990,'sex':'male','ai_ok':False})
 c.put('/api/food/targets',{'kcal_target':2000,'protein_target':110})
a.put('/api/food/thread/preferences',{'auto_log':True})
status,food=a.post('/api/food/foods',{'name':'Protein bar','serving_label':'1 bar','serving_g':60,'kcal':200,'protein_g':20,'carbs_g':20,'fat_g':7})
check(status==200,'fictional own food')
now=dt.datetime.now(dt.timezone.utc);day=now.date();morning=dt.datetime.combine(day,dt.time(9),dt.timezone.utc)
# Use a past morning so a test just after UTC midnight does not depend on clock correction.
if morning>now:morning-=dt.timedelta(days=1)
logday=morning.date()
def send(text,captured=morning):
 status,row=a.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':text,'captured_at':captured.isoformat()})
 check(status==201,'store text before process')
 return row['message']['id']
def process(mid):return a.post('/api/food/thread/messages/'+str(mid)+'/process',{})
def entries():return a.get('/api/food/day?d='+str(logday))[1]['entries']
mid=send('I had 2 protein bars')
status,result=process(mid);check(status==200 and result['messages'][-1]['result']['kind']=='log','fully resolved foods auto-log with AI off')
reply=result['messages'][-1];rows=reply['entries']
check(len(rows)==1 and rows[0]['kcal']==400 and rows[0]['protein_g']==40,'nutrition calculated from own food')
check(rows[0]['day']==str(logday) and rows[0]['meal']=='breakfast','capture-day and morning meal inferred')
check('400' in reply['result']['feedback'] or '40 g' in reply['result']['feedback'] or '1,600' in reply['result']['feedback'],'feedback sees the new uncommitted food')
check(process(mid)[1]['messages'][-1]['id']==reply['id'] and len(entries())==1,'replayed process does not duplicate food or reply')
check(b.post('/api/food/thread/messages/'+str(mid)+'/process',{})[0]==404,'other account cannot process')
check(b.post('/api/food/thread/messages/'+str(mid)+'/undo',{})[0]==404,'other account cannot undo')
check(Client().post('/api/food/thread/messages/'+str(mid)+'/process',{})[0]==401,'signed-in required')
check(a.post('/api/food/thread/messages/'+str(mid)+'/process',{'kcal':1})[0]==422,'client cannot inject nutrition')
status,undone=a.post('/api/food/thread/messages/'+str(mid)+'/undo',{})
check(status==200 and undone['removed']==1 and not entries(),'Undo removes only this log')
check(a.post('/api/food/thread/messages/'+str(mid)+'/undo',{})[1]['removed']==0,'Undo is idempotent')
# Requiring a tap stores a preview without changing the food log.
a.put('/api/food/thread/preferences',{'auto_log':False})
mid=send('a protein bar for lunch yesterday');status,preview=process(mid)
check(status==200 and preview['messages'][-1]['result']['kind']=='preview','require tap makes preview')
previewday=logday-dt.timedelta(days=1)
check(preview['messages'][-1]['result']['day']==str(previewday) and preview['messages'][-1]['result']['meal']=='lunch','spoken meal/day override inference')
check(not a.get('/api/food/day?d='+str(previewday))[1]['entries'],'preview has no food write')
check(a.post('/api/food/thread/messages/'+str(mid)+'/log',{'confirm':False})[0]==400,'explicit confirmation required')
check(a.post('/api/food/thread/messages/'+str(mid)+'/log',{'confirm':'true'})[0]==422,'confirmation is strict')
status,logged=a.post('/api/food/thread/messages/'+str(mid)+'/log',{'confirm':True})
check(status==200 and logged['messages'][-1]['result']['kind']=='log' and len(logged['messages'][-1]['entries'])==1,'explicit Log applies preview once')
check(a.post('/api/food/thread/messages/'+str(mid)+'/log',{'confirm':True})[1]['messages'][-1]['entries']==logged['messages'][-1]['entries'],'repeated explicit tap is idempotent')
# A changed source refreshes the stored card without silently logging the new values.
mid=send('1 protein bar');process(mid)
a.put('/api/food/foods/'+str(food['id']),{'name':'Protein bar','serving_label':'1 bar','serving_g':60,'kcal':250,'protein_g':25,'carbs_g':20,'fat_g':7})
status,changed=a.post('/api/food/thread/messages/'+str(mid)+'/log',{'confirm':True})
check(status==409 and changed['changed'] and changed['messages'][-1]['result']['kind']=='preview','changed source is a refreshed preview, not a write')
check(not entries(),'changed source did not log')
status,logged=a.post('/api/food/thread/messages/'+str(mid)+'/log',{'confirm':True})
check(status==200 and logged['messages'][-1]['entries'][0]['kcal']==250,'a new explicit tap approves refreshed numbers')
# Unknown/ambiguous words ask a single detail; no provider or food write occurs.
a.put('/api/food/thread/preferences',{'auto_log':True})
mid=send('Fictional unknown stew');status,needs=process(mid)
check(status==200 and needs['messages'][-1]['result']['kind']=='needs' and not needs['messages'][-1]['entries'],'unknown remains unlogged for later resolution')
check(needs['messages'][-1]['body'].count('?')<=1,'at most one question')
# Concurrent processing shares a single reply and one set of entry identities.
mid=send('a protein bar for dinner')
clients=[login('zz_test_thread_log_a') for _ in range(4)]
with concurrent.futures.ThreadPoolExecutor(4) as pool:
 responses=list(pool.map(lambda c:c.post('/api/food/thread/messages/'+str(mid)+'/process',{}),clients))
check(all(s==200 for s,_ in responses) and len({r['messages'][-1]['id'] for _,r in responses})==1,'concurrent processing replies once')
check(len({tuple(e['id'] for e in r['messages'][-1]['entries']) for _,r in responses})==1,'concurrent processing logs once')
mid=send('I had 101 protein bars');status,large=process(mid)
check(status==200 and large['messages'][-1]['result']['kind']=='needs','oversize auto-log becomes durable clarification')
mid=send('I had a protein bar');status,logged=process(mid)
row=logged['messages'][-1]['entries'][0]
# Moving through the normal food API must make a later Undo preserve the changed row.
check(a.patch('/api/food/entries/'+str(row['id']),{'name':'Edited fictional bar'})[0]==200,'edit original logged food')
status,undone=a.post('/api/food/thread/messages/'+str(mid)+'/undo',{})
check(status==200 and undone['removed']==0 and undone['kept']==1,'Undo preserves later-edited food')
for c in (a,b):c.post('/api/account/delete',{'password':PW})
print(f'food thread own-food logging: {n} checks passed; no provider/device calls')
