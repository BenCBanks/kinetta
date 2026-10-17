"""Private deterministic food answers; AI is off and no foods/targets are changed."""
import concurrent.futures
import datetime as dt
import uuid
from kc import Client, PW, login, person

n=0

def check(value,name):
 global n
 assert value,name
 n+=1

a,b=person('zz_test_thread_facts_a'),person('zz_test_thread_facts_b')
for c in (a,b):
 c.put('/api/profile',{'tz':'UTC','weight_kg':75,'height_cm':175,'birth_year':1990,'sex':'male','ai_ok':False,'resting_source':'formula'})
 for m in c.get('/api/food/thread?limit=100')[1]['messages']:c.delete('/api/food/thread/messages/'+str(m['id']))
 c.put('/api/food/targets',{'kcal_target':1800,'protein_target':110})
now=dt.datetime.now(dt.timezone.utc);today=now.date();tuesday=today-dt.timedelta(days=(today.weekday()-1)%7)
for c in (a,b):
 for day in {today,tuesday}:
  for e in c.get('/api/food/day?d='+str(day))[1]['entries']:c.delete('/api/food/entries/'+str(e['id']))
a.post('/api/food/entries',[{'day':str(today),'meal':'breakfast','name':'Fictional oats','kcal':400,'protein_g':25,'carbs_g':50,'fat_g':12}])
b.post('/api/food/entries',[{'day':str(today),'meal':'breakfast','name':'Other private meal','kcal':900,'protein_g':99}])
original=a.get('/api/food/day')[1]['entries'];profile=a.get('/api/me')[1]
def ask(text):
 status,row=a.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':text,'captured_at':now.isoformat()});check(status==201,'store question')
 status,result=a.post('/api/food/thread/messages/'+str(row['message']['id'])+'/answer',{})
 check(status==200 and result['handled'] and len(result['messages'])==2,'answer without AI')
 check(result['messages'][0]['state']=='answered','request and reply commit together')
 return row['message']['id'],result['messages'][-1]
mid,reply=ask('how much protein do I have left?')
check('85 g left' in reply['body'] and reply['result']['facts']['logged']==25,'protein comes from own records')
check(a.post('/api/food/thread/messages/'+str(mid)+'/answer',{})[1]['messages'][-1]==reply,'retry returns the same factual snapshot')
check(b.post('/api/food/thread/messages/'+str(mid)+'/answer',{})[0]==404,'other account cannot answer or read')
check(Client().post('/api/food/thread/messages/'+str(mid)+'/answer',{})[0]==401,'sign-in required')
check(a.post('/api/food/thread/messages/'+str(mid)+'/answer',{'user_id':1})[0]==422,'owner cannot come from request body')
check('400 kcal logged' in ask('how many calories so far?')[1]['body'],'calorie sum by code')
check('1,400 kcal left' in ask('calories left?')[1]['body'],'saved goal, no guessed budget')
check(ask('how much fiber today?')[1]['result']['facts']['logged'] is None,'unknown nutrient remains unknown')
check(ask('was that bad?')[1]['result']['offer_kit'],'reassurance is code, advice optional')
check(ask('what should I eat for dinner?')[1]['result']['offer_kit'],'open advice offers consent-gated Kit without model work')
check(a.get('/api/food/day')[1]['entries']==original and a.get('/api/me')[1]==profile,'answers never change foods or targets/consent')
a.post('/api/food/entries',[{'day':str(tuesday),'meal':'lunch','name':'Fictional Tuesday soup','kcal':300,'protein_g':15}])
check('Fictional Tuesday soup' in ask('what did I have for lunch Tuesday?')[1]['body'],'historic meal by code')
check('Other private meal' not in ask('what did I have today?')[1]['body'],'history is private')
a.put('/api/food/targets',{'kcal_target':None,'protein_target':None})
check(ask('protein left?')[1]['result']['set_goal'],'no invented macro target')
a.put('/api/food/targets',{'kcal_target':1800,'protein_target':110})
# A food sentence is left pending for the logging engine, not answered as a numbers question.
_,row=a.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':'I had a protein shake and leftover rice'})
check(a.post('/api/food/thread/messages/'+str(row['message']['id'])+'/answer',{})[1]['handled'] is False,'food input stays pending for logging engine')
_,row=a.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':'how many calories so far?'})
clients=[login('zz_test_thread_facts_a') for _ in range(4)]
with concurrent.futures.ThreadPoolExecutor(4) as pool:
 answers=list(pool.map(lambda c:c.post('/api/food/thread/messages/'+str(row['message']['id'])+'/answer',{}),clients))
check(all(status==200 for status,_ in answers) and len({result['messages'][-1]['id'] for _,result in answers})==1,'concurrent answering creates one reply')
# Resting-only Watch sync remains independent from a manually chosen food goal.
a.put('/api/profile',{'resting_source':'apple_health'})
a.post('/api/health/resting',{'tz':'UTC','observed_at':now.isoformat(),'days':[{'day':str(today),'resting_kcal':1200}]})
_,burn=ask('how much did I burn today?')
check(burn['result']['source']=='apple_health' and burn['result']['facts']['burned']==1200,'actual synced resting calories, no BMR substitution')
check(a.get('/api/food/day')[1]['goal']['kcal']==1800,'Watch burn never replaces independently set goal')
check(any(m['id']==reply['id'] for m in a.get('/api/food/thread?limit=100')[1]['messages']),'answers survive reopening history')
for c in (a,b):c.post('/api/account/delete',{'password':PW})
print(f'food thread answers: {n} API checks passed, AI off; no providers or devices')
