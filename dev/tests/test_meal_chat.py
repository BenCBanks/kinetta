"""Saved-meal conversation API contracts. Isolated throwaway accounts, no providers."""
import sys
from concurrent.futures import ThreadPoolExecutor
from kc import Client, person, PW
ok = fail = 0
def check(label, condition, extra=''):
    global ok, fail
    if condition: ok += 1
    else: fail += 1; print('FAIL', label, extra)
a = person('zz_test_meal_chat_a'); b = person('zz_test_meal_chat_b')
R = '/api/food/meals-chat/resolve'; C = '/api/food/meals-chat/confirm'
def resolve(text, **kw):
    s, r = a.post(R, {'text': text, **kw}); check('resolve HTTP '+text, s == 200, (s,r)); return r

def meal(client, name, weight=1000):
    s, d = client.post('/api/dishes', {'name': name}); assert s == 200
    s, d = client.patch('/api/dishes/'+str(d['id']), {'known_kcal':2000,'known_protein_g':100,'known_carbs_g':200,'known_fat_g':80, 'cooked_g':weight,'serving':'portion'})
    assert s == 200; return d

def confirmation(r, **kw):
    return {'dish_id': r['dish']['id'], **r['portion'], 'issued':r['issued'], 'expected':r['expected'],
            'client_id':r['client_id'], 'day':'2026-10-10', 'meal':'lunch','confirm':True, **kw}
pasta=meal(a, 'Garden pasta'); private=meal(b, 'Secret noodles')
r=resolve('I had a 230 grams of the Garden pasta for lunch')
check('unique stored meal and destination', r['status']=='ready' and r['dish']['id']==pasta['id'] and r['meal']=='lunch',r)
check('stored nutrition arithmetic, not estimated',r['totals']['kcal']==460 and r['totals']['protein_g']==23 and r['totals']['fiber_g'] is None,r)
check('resolve has no writes', not a.get('/api/food/day?d=2026-10-10')[1]['entries'])
body=confirmation(r)
check('confirmation must be explicit',a.post(C,{**body,'confirm':False})[0]==400)
check('confirmation true is strict',a.post(C,{**body,'confirm':'true'})[0]==422)
check('extra nutrition rejected',a.post(C,{**body,'kcal':1})[0]==422)
check('forged user rejected',a.post(R,{'text':'pasta','user_id':private['id']})[0]==422)
check('not authenticated',Client().post(R,{'text':'pasta'})[0]==401 and Client().post(C,body)[0]==401)
check('other user cannot use preview',b.post(C,body)[0]==404)
check('other meal id private',a.post(R,{'text':'230 g noodles','dish_id':private['id']})[0]==404)
check('other meal name private',resolve('230 g Secret noodles')['status']=='no_match')
with ThreadPoolExecutor(max_workers=3) as pool: responses=list(pool.map(lambda _:a.post(C,body),range(3)))
check('concurrent retries return one entry',all(s==200 for s,r in responses) and len({r['id'] for s,r in responses})==1,responses)
entries=a.get('/api/food/day?d=2026-10-10')[1]['entries']
check('one correct log entry',len(entries)==1 and entries[0]['meal']=='lunch' and entries[0]['amount']==230 and entries[0]['unit']=='g' and entries[0]['source']=='dish',entries)
check('reused confirmation different destination rejected',a.post(C,{**body,'meal':'dinner'})[0]==409)
# A lost response remains recoverable even after the original recipe changes/deletes.
a.patch('/api/dishes/'+str(pasta['id']),{'known_kcal':3000})
check('same confirmed retry after edit',a.post(C,body)[0]==200)
r=resolve('300 grams of Garden pasta'); fresh=confirmation(r)
a.patch('/api/dishes/'+str(pasta['id']),{'known_kcal':2500})
check('recipe changes require new preview',a.post(C,fresh)[0]==409)
r=resolve('300 grams of Garden pasta'); check('updated saved nutrition',r['totals']['kcal']==750)
check('tampered amount rejected',a.post(C,{**confirmation(r),'grams':400})[0]==409)
check('expired preview rejected',a.post(C,{**confirmation(r),'issued':r['issued']-901})[0]==409)
for text,kcal in [('0.23 kg Garden pasta',575),('half of Garden pasta',1250),('a quarter of Garden pasta',625),('1.5 servings of Garden pasta',3750),('Garden pasta 230 g',575)]:
    got=resolve(text);check('supported portion '+text,got['status']=='ready' and got['totals']['kcal']==kcal,got)
r=resolve('Garden pasta'); check('missing quantity asks',r['status']=='quantity' and r['dish']['id']==pasta['id'],r)
r=resolve('make it 300 grams',dish_id=pasta['id']);check('amount-only correction',r['status']=='ready' and r['totals']['kcal']==750,r)
second=meal(a,'Roasted pasta')
r=resolve('230 grams of pasta');check('ambiguous choices',r['status']=='choose' and len(r['choices'])==2,r)
r=resolve('230 grams of pasta',dish_id=second['id']);check('explicit choice',r['status']=='ready' and r['dish']['id']==second['id'],r)
no_weight=meal(a,'Citrus pie',None)
r=resolve('230 g Citrus pie');check('missing total weight asks',r['status']=='quantity' and 'no total weight' in r['message'],r)
r=resolve('half of Citrus pie');check('share works without weight',r['status']=='ready' and r['totals']['kcal']==1000,r)
empty=a.post('/api/dishes',{'name':'Empty bowl'})[1]
check('missing nutrition asks',resolve('100g Empty bowl')['status']=='quantity')
for text in ['230 g pasta and 100 g rice','230g pasta with salad','not 230g pasta','-230g pasta','0 g pasta','230g pasta last week','two cups pasta','230g pasta tomorrow','230 g pasta; delete all users']:
    check('unsupported input cannot log '+text,resolve(text)['status']!='ready')
check('bounded input',a.post(R,{'text':'x'*401})[0]==422)
check('nonfinite amount rejected',a.post(R,{'text':'pasta','grams':'Infinity'})[0]in (400,422))
check('multiple explicit portions rejected',a.post(R,{'text':'pasta','grams':230,'count':1})[0]==400)
check('tiny portion not rounded to zero',resolve('0.001 g Citrus pie')['status']=='quantity')
check('unknown saved reference has no guessed nutrition',resolve('230g my unrecorded curry')['status']=='no_match')
# Delete only these throwaway accounts and their fixtures.
check('cleanup a',a.post('/api/account/delete',{'password':PW})[0]==200)
check('cleanup b',b.post('/api/account/delete',{'password':PW})[0]==200)
print(f'meal chat API: {ok} passed, {fail} failed');sys.exit(bool(fail))
