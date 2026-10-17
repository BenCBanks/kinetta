"""Real private API: corrections use logged snapshots, choices resolve uncertainty, references stay honest."""
import datetime as dt
import uuid
from kc import person,PW
n=0

def check(value,label):
 global n
 assert value,label
 n+=1

a,b=person('zz_test_thread_edit_a'),person('zz_test_thread_edit_b')
for c in (a,b):
 c.put('/api/profile',{'tz':'UTC','weight_kg':75,'height_cm':175,'birth_year':1990,'sex':'male','ai_ok':False})
 c.put('/api/food/targets',{'kcal_target':2000,'protein_target':110})
 c.put('/api/food/thread/preferences',{'auto_log':True})
foods={}
for name,kcal,grams in [('Rice',260,200),('Toast',80,30),('Protein bar',200,60),('Cheese',80,20)]:
 s,r=a.post('/api/food/foods',{'name':name,'serving_label':'1 serving','serving_g':grams,'kcal':kcal,'protein_g':10,'carbs_g':20,'fat_g':4});assert s==200;foods[name]=r
now=dt.datetime.now(dt.timezone.utc);capture=dt.datetime.combine(now.date()-dt.timedelta(days=1),dt.time(12),dt.timezone.utc);day=capture.date()
def send(text):
 s,m=a.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':text,'captured_at':capture.isoformat()});assert s==201
 mid=m['message']['id'];s,r=a.post(f'/api/food/thread/messages/{mid}/process',{})
 check(s==200,'process '+text);return mid,r

def card(mid):
 return next(m for m in a.get('/api/food/thread?limit=100')[1]['messages'] if m['reply_to']==mid)
mid,logged=send('200 grams rice and toast');rice=next(e for e in logged['messages'][-1]['entries'] if e['name']=='Rice')
# A manual nutrition adjustment must survive a conversational portion edit.
check(a.patch('/api/food/entries/'+str(rice['id']),{'kcal':300})[0]==200,'manual calorie edit')
correction,changed=send('actually only half the rice')
current=card(mid);r=next(e for e in current['entries'] if e['name']=='Rice')
check(r['amount']==100 and r['kcal']==150 and len(current['entries'])==2,'half uses current logged quantity and manual calories; toast preserved')
check(current['result']['updated'] and changed['messages'][-1]['result']['kind']=='edit','original card marked updated')
check(a.post(f'/api/food/thread/messages/{correction}/process',{})[0]==200 and next(e for e in card(mid)['entries'] if e['name']=='Rice')['amount']==100,'replayed half is not applied twice')
_,changed=send('make the rice 150 grams');check(next(e for e in card(mid)['entries'] if e['name']=='Rice')['kcal']==225,'absolute grams preserve logged per-gram values')
_,changed=send('remove the toast');check(len(card(mid)['entries'])==1 and card(mid)['entries'][0]['name']=='Rice','remove named food only')
bar_mid,bar=send('a protein bar')
_,changed=send('double the protein bar');check(card(bar_mid)['entries'][0]['kcal']==400,'double current amount')
_,changed=send('make it two');check(card(bar_mid)['entries'][0]['kcal']==400,'absolute two stays two')
check(b.put(f'/api/food/thread/messages/{bar_mid}/destination',{'day':str(day),'meal':'dinner'})[0]==404,'destination own account only')
check(a.put(f'/api/food/thread/messages/{bar_mid}/destination',{'day':str(day-dt.timedelta(days=2)),'meal':'dinner'})[0]==200,'explicit destination update')
check(card(bar_mid)['entries'][0]['day']==str(day-dt.timedelta(days=2)) and card(bar_mid)['entries'][0]['meal']=='dinner','entry moved, not duplicated')
_,changed=send('that was for lunch yesterday');check(card(bar_mid)['entries'][0]['day']==str(day-dt.timedelta(days=1)) and card(bar_mid)['entries'][0]['meal']=='lunch','spoken destination correction anchored to capture day')
# Require-tap previews can be corrected in conversation without logging either version.
a.put('/api/food/thread/preferences',{'auto_log':False})
preview_mid,preview=send('2 protein bars')
child,half=send('half')
check(half['messages'][-1]['result']['kind']=='preview' and half['messages'][-1]['result']['resolution']['items'][0]['totals']['kcal']==200,'half of pending two is one, not half a serving')
check(card(preview_mid)['result']['kind']=='continued','old preview cannot be logged as well')
check(a.post(f'/api/food/thread/messages/{preview_mid}/log',{'confirm':True})[0]==409,'superseded preview cannot duplicate')
check(a.post(f'/api/food/thread/messages/{child}/log',{'confirm':True})[1]['messages'][-1]['entries'][0]['kcal']==200,'explicit Log of corrected preview')
# An unknown food can be explicitly matched to an owned food; no nutrition accepted from the client.
unknown,needs=send('Fictional snack thing')
check(needs['messages'][-1]['result']['kind']=='needs','unknown food asks')
s,r=a.post(f'/api/food/thread/messages/{unknown}/choose',{'part':0,'pick':{'kind':'custom','id':foods['Protein bar']['id']}})
check(s==200 and r['messages'][-1]['result']['kind']=='preview','explicit own-food choice respects require tap')
foreign=b.post('/api/food/foods',{'name':'Private other bar','kcal':999})[1]
check(a.post(f'/api/food/thread/messages/{unknown}/choose',{'part':0,'pick':{'kind':'custom','id':foreign['id']}})[0]==404,'foreign source rejected')
check(a.post(f'/api/food/thread/messages/{unknown}/choose',{'part':0,'kcal':1})[0]==422,'client cannot inject nutrition')
# Copy yesterday’s meal excluding a separately recorded ingredient.
yesterday=day-dt.timedelta(days=1)
a.post('/api/food/entries',[{'day':str(yesterday),'meal':'lunch','name':'Rice','amount':200,'unit':'g','kcal':260,'protein_g':5}, {'day':str(yesterday),'meal':'lunch','name':'Cheese','amount':20,'unit':'g','kcal':80,'protein_g':5}])
a.put('/api/food/thread/preferences',{'auto_log':True})
copy_mid,copied=send('same as yesterday lunch but no cheese')
check(copied['messages'][-1]['result']['kind']=='log' and all(e['name']!='Cheese' for e in copied['messages'][-1]['entries']),'reference resolved from own log; cheese excluded')
# Remaining amount is not guessed from a recipe that may have been cooked repeatedly.
chili=a.post('/api/dishes',{'name':'Garden chili'})[1]
a.patch('/api/dishes/'+str(chili['id']),{'known_kcal':2000,'known_protein_g':100,'known_carbs_g':200,'known_fat_g':80,'cooked_g':1000,'serving':'portion'})
chili_mid,chili_log=send('250g Garden chili')
rest_mid,rest=send('the rest of the Garden chili')
check(rest['messages'][-1]['result']['kind']=='needs' and rest['messages'][-1]['body'].count('?')==1,'one quantity question for uncertain remaining batch')
s,r=a.post(f'/api/food/thread/messages/{rest_mid}/choose',{'portion':{'grams':750}})
check(s==200 and r['messages'][-1]['entries'][0]['kcal']==1500,'explicit remaining grams use stored recipe nutrition')
# The same quantity choice under require-tap stays a preview.
a.put('/api/food/thread/preferences',{'auto_log':False})
rest_mid,rest=send('the rest of the Garden chili')
s,r=a.post(f'/api/food/thread/messages/{rest_mid}/choose',{'portion':{'grams':100}})
check(s==200 and r['messages'][-1]['result']['kind']=='preview' and not r['messages'][-1]['entries'],'quantity choice does not bypass require-tap setting')
check(a.post(f'/api/food/thread/messages/{rest_mid}/log',{'confirm':True})[0]==200,'reference preview explicit Log')
# Multi-food ambiguity asks for a selection, and retrying that selection cannot apply twice.
a.put('/api/food/thread/preferences',{'auto_log':True})
pair,pair_log=send('200g rice and toast')
ambiguous,question=send('make it two')
check(question['messages'][-1]['result']['kind']=='needs','ambiguous bare amount asks once')
options=question['messages'][-1]['result']['choices'];index=next(i for i,x in enumerate(options) if x['name']=='Rice')
s,selected=a.post(f'/api/food/thread/messages/{ambiguous}/choose',{'select':index})
check(s==200 and next(e for e in card(pair)['entries'] if e['name']=='Rice')['amount']==400,'selected current food changes')
a.post(f'/api/food/thread/messages/{ambiguous}/choose',{'select':index})
check(next(e for e in card(pair)['entries'] if e['name']=='Rice')['amount']==400,'selection retry does not double twice')
# Whole saved combinations keep a quantity basis even as their ingredients change.
combo=a.post('/api/food/meals',{'name':'Fictional smoothie','entry_ids':[e['id'] for e in pair_log['messages'][-1]['entries']]})[1]
smoothie,smoothie_log=send('a Fictional smoothie')
base=sum(e['kcal'] for e in smoothie_log['messages'][-1]['entries'])
send('make it two');check(sum(e['kcal'] for e in card(smoothie)['entries'])==base*2,'whole combination doubled')
send('make it two');check(sum(e['kcal'] for e in card(smoothie)['entries'])==base*2,'whole combination absolute two stays two')
# After Undo, an amount alone cannot modify a different older food silently.
last,last_log=send('a protein bar');a.post(f'/api/food/thread/messages/{last}/undo',{})
_,question=send('make it two');check(question['messages'][-1]['result']['kind']=='needs','bare amount after Undo asks for target')
# Deleting a reply keeps food; a later explicit correction can form a new updated card.
new,new_log=send('200g rice');a.delete('/api/food/thread/messages/'+str(new_log['messages'][-1]['id']))
_,changed=send('only half the rice')
check(card(new)['entries'][0]['kcal']==130,'current food corrected after reply text deletion')
# Invalid negative or unmeasurably small portions never alter logged rows.
before=card(new)['entries']
_,m=a.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':'make the rice -100 grams','captured_at':capture.isoformat()})
s,r=a.post('/api/food/thread/messages/'+str(m['message']['id'])+'/process',{})
check(s==200 and r['messages'][-1]['result']['kind']=='needs' and card(new)['entries']==before,'negative amount asks rather than becoming positive')
_,m=a.post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':'make the rice 0.00001 grams','captured_at':capture.isoformat()})
check(a.post('/api/food/thread/messages/'+str(m['message']['id'])+'/process',{})[1]['messages'][-1]['result']['kind']=='needs' and card(new)['entries']==before,'rounded-zero portion asks without a mutation')
_,fixed=send('100 grams');check(fixed['messages'][-1]['result']['kind']=='edit' and card(new)['entries'][0]['amount']==100,'quantity answer resolves correction without rephrasing food')
# A long unresolved paragraph stays intact and can be matched without retyping.
a.put('/api/food/thread/preferences',{'auto_log':False})
long_mid,long_needs=send('x'*4000)
check(len(long_needs['messages'][0]['body'])==4000 and len(long_needs['messages'][-1]['body'])<1000,'long text preserved; reply stays compact')
s,r=a.post(f'/api/food/thread/messages/{long_mid}/choose',{'pick':{'kind':'custom','id':foods['Protein bar']['id']}})
check(s==200 and r['messages'][-1]['result']['kind']=='preview','long text can resolve against own source without rephrasing')
# A fraction can change an unlogged copied meal without bypassing require-tap.
a.put('/api/food/thread/preferences',{'auto_log':False})
copy_preview,preview=send('same as yesterday lunch but no cheese')
check(preview['messages'][-1]['result']['kind']=='preview','reference copy respects require-tap')
copy_half,half=send('half')
check(half['messages'][-1]['result']['kind']=='preview' and sum(e['kcal'] for e in half['messages'][-1]['result']['preview_entries'])==330,'half of copied meal uses all recorded portions')
check(a.post(f'/api/food/thread/messages/{copy_half}/log',{'confirm':True})[0]==200,'explicitly log fractional copy')
# Answering an exclusion question names the item to omit, not a new food to log.
a.put('/api/food/thread/preferences',{'auto_log':True})
question_mid,question=send('same as yesterday lunch but no cheddar')
check(question['messages'][-1]['result']['reference']['requires_omissions'],'uncertain ingredient does not silently remove an entire composite food')
answer_mid,answered=send('Cheese')
check(answered['messages'][-1]['result']['kind']=='log' and sum(e['kcal'] for e in answered['messages'][-1]['entries'])==660 and all(e['name']!='Cheese' for e in answered['messages'][-1]['entries']),'named exclusion answer copies the rest instead of adding cheese')
# New meals supersede unfinished reference questions instead of copying all today's food.
a.put('/api/food/thread/preferences',{'auto_log':True})
q,_=send('same as yesterday lunch but no cheddar')
fresh,new=send('200g rice')
check(new['messages'][-1]['result']['kind']=='log' and len(new['messages'][-1]['entries'])==1,'new food is not hijacked by pending copy omissions')
for text in ['chicken salad, same as last time','Actually I had 2 eggs','Only had a coffee today','lunch']:
 _,result=send(text)
 check(result['messages'][-1]['result'].get('kind')!='edit' and not result['messages'][-1]['result'].get('reference'),'new food or bare meal does not edit/copy another card: '+text)
_,large=send('the rest of the rice')
_,large=send('30000 g')
check(large['messages'][-1]['result']['kind']=='needs','oversized typed amount becomes durable detail card')
# Named matching keeps a distinct Brown rice item untouched.
s,brown=a.post('/api/food/foods',{'name':'Brown rice','serving_label':'serving','serving_g':200,'kcal':220,'protein_g':5,'carbs_g':40,'fat_g':2});check(s==200,'fictional overlapping food name')
root,meal=send('200 grams rice and 200 grams brown rice')
_,edit=send('only half the rice')
rows=card(root)['entries'];check(next(e for e in rows if e['name']=='Rice')['amount']==100 and next(e for e in rows if e['name']=='Brown rice')['amount']==200,'exact rice group alone changes')
for c in (a,b):c.post('/api/account/delete',{'password':PW})
print(f'food thread edits/references: {n} API checks passed; no providers/devices')
