"""Cooking mode in plain words (2026-10-12): '2 apples' style messages, answered from what the person used before
without AI; with no AI the app is told to search instead. The AI side is tested in incontainer.py with a stand-in."""
import sys
from kc import person

ok = fail = 0
def check(name, cond, extra=''):
    global ok, fail
    if cond: ok += 1
    else: fail += 1; print('FAIL', name, extra)

p = person('zz_test_cookchat')
for d in p.get('/api/dishes')[1]:
    if d.get('mine') is not False: p.delete(f"/api/dishes/{d['id']}")
did = p.post('/api/dishes', {'name': 'Test apple crumble'})[1]['id']

# parse: plural search and a typical weight for counts and spoons
r = p.post('/api/dishes/parse', {'text': '2 apples'})[1]
check('apples -> apple, about 360 g', r['search'] == 'apple' and r['guess_g'] == 360 and r['grams'] is None, r)
check('1 tbsp guessed', p.post('/api/dishes/parse', {'text': '1 tbsp olive oil'})[1]['guess_g'] == 14)
check('weights need no guess', p.post('/api/dishes/parse', {'text': '200 g rice'})[1]['guess_g'] is None)

# teach it once (as if picked from search, with the amount as said), then plain words are free
apple = {'kcal': 52, 'protein_g': 0.3, 'carbs_g': 13.8, 'fat_g': 0.2, 'fiber_g': 2.4}
s, d = p.post(f'/api/dishes/{did}/items', {'name': 'Apple', 'grams': 180, 'per100': apple, 'source': 'usda'})
check('first apple', s == 200 and len(d['items']) == 1, d)
s, r = p.post(f'/api/dishes/{did}/say', {'text': '300 g apples'})
check('known food by weight: no AI', s == 200 and r.get('by') == 'memory' and r['dish']['items'][-1]['grams'] == 300, r)
check('values per 100 g kept', abs(r['dish']['items'][-1]['kcal'] - 156) < 0.5, r['dish']['items'][-1])
check('reply says what was added', 'apple' in r['reply'] and r['added'] == [r['dish']['items'][-1]['id']], r['reply'])
s, r = p.post(f'/api/dishes/{did}/say', {'text': 'two apples'})
check('a count needs a known size: asks', s == 200 and r.get('by') == 'clarification', r)

# several pieces in one message
s, r = p.post(f'/api/dishes/{did}/say', {'text': '100 g apple and 50 g apple'})
check('several at once', s == 200 and r.get('by') == 'memory' and len(r['added']) == 2, r)
s, r = p.post(f'/api/dishes/{did}/say', {'text': 'salt and pepper'})
check('unknown amount: asks before search or AI', s == 200 and r.get('by') == 'clarification', r)
check('empty refused', p.post(f'/api/dishes/{did}/say', {'text': ''})[0] == 422)
check('too long refused', p.post(f'/api/dishes/{did}/say', {'text': 'x' * 601})[0] == 422)
q = person('zz_test_cookchat2')
for d in q.get('/api/dishes')[1]:
    if d.get('mine') is not False:q.delete(f"/api/dishes/{d['id']}")
check("someone else's dish: 404", q.post(f'/api/dishes/{did}/say', {'text': '100 g apples'})[0] == 404)

created=[]
def recipe(client,name,*,kcal=200,measured=500):
    s,d=client.post('/api/dishes',{'name':name});check(name+' created',s==200,d)
    rid=d['id'];created.append((client,rid))
    item={'name':'Fictional source ingredient','grams':100,'source':'quick'}
    if kcal is not None:item['per100']={'kcal':kcal,'protein_g':10,'carbs_g':20,'fat_g':4,'fiber_g':None}
    s,d=client.post(f'/api/dishes/{rid}/items',item);check(name+' ingredient',s==200,d)
    if measured is not None:
        s,d=client.patch(f'/api/dishes/{rid}',{'cooked_g':measured,'serving':'portion'});check(name+' measured weight',s==200 and d.get('weighed'),d)
    return rid

target_q=q.post('/api/dishes',{'name':'Fictional private target'})
check('other owner target created',target_q[0]==200,target_q)
other_did=target_q[1]['id'];created.append((q,other_did))
source=recipe(p,'Fictional kale soup')
recent=p.get(f'/api/dishes/recent-own?exclude={did}')
check('recent lookup is own and excludes destination',recent[0]==200 and did not in [r['id'] for r in recent[1]] and source in [r['id'] for r in recent[1]],recent)
check('read-only source endpoint is available to owner',p.get(f'/api/dishes/{source}/own-source')[0]==200)
other_recent=q.get('/api/dishes/recent-own')
check('recent lookup hides another owner source',other_recent[0]==200 and source not in [r['id'] for r in other_recent[1]],other_recent)
check('source view is owner-only',q.get(f'/api/dishes/{source}/own-source')[0]==404)
check('recipe add is owner-only',q.post(f'/api/dishes/{other_did}/items/recipe',{'recipe_id':source,'mode':'all'})[0]==404)

s,all_result=p.post(f'/api/dishes/{did}/items/recipe',{'recipe_id':source,'mode':'all'})
all_item=next((i for i in all_result.get('dish',{}).get('items',[]) if i['id'] in all_result.get('added',[])),{})
check('all uses measured whole weight and copied per-gram nutrition',s==200 and all_result.get('grams')==500 and all_item.get('kcal')==200 and all_item.get('fiber_g') is None,all_result)
half_source=recipe(p,'Fictional bean stew',measured=400)
s,half_result=p.post(f'/api/dishes/{did}/items/recipe',{'recipe_id':half_source,'mode':'half'})
half_item=next((i for i in half_result.get('dish',{}).get('items',[]) if i['id'] in half_result.get('added',[])),{})
check('half uses half of measured weight',s==200 and half_result.get('grams')==200 and half_item.get('kcal')==100,half_result)
s,gram_result=p.post(f'/api/dishes/{did}/items/recipe',{'recipe_id':source,'mode':'grams','grams':75})
gram_item=next((i for i in gram_result.get('dish',{}).get('items',[]) if i['id'] in gram_result.get('added',[])),{})
check('explicit grams use copied nutrition',s==200 and gram_result.get('grams')==75 and gram_item.get('kcal')==30,gram_result)

no_weight=recipe(p,'Fictional no measured weight',measured=None)
recent_map={r['id']:r for r in p.get(f'/api/dishes/recent-own?exclude={did}')[1]}
check('inferred ingredient sum is not measured recipe weight',no_weight in recent_map and recent_map[no_weight]['weight_g'] is None and recent_map[no_weight]['has_nutrition'],recent_map.get(no_weight))
check('cannot copy without measured weight',p.post(f'/api/dishes/{did}/items/recipe',{'recipe_id':no_weight,'mode':'all'})[0]==400)

single=recipe(p,'Fictional broccoli soup')
s,ask=p.post(f'/api/dishes/{did}/say',{'text':'Fictional broccoli soup'})
check('single recipe match asks for amount',s==200 and ask.get('reply')=='How much went in?' and ask.get('clarification')=='Fictional broccoli soup' and ask.get('recipe_amount',{}).get('id')==single,ask)
s,cup=p.post(f'/api/dishes/{did}/say',{'text':'1 cup Fictional broccoli soup'})
check('generic cup density is not used for recipes',s==200 and cup.get('reply')=='How much went in?' and cup.get('recipe_grams') is None and not cup.get('added'),cup)
s,explicit=p.post(f'/api/dishes/{did}/say',{'text':'50 g Fictional broccoli soup'})
check('explicit chat grams add directly',s==200 and explicit.get('by')=='recipe' and len(explicit.get('added',[]))==1 and explicit['dish']['items'][-1]['grams']==50,explicit)
ambiguous=recipe(p,'Fictional bean curry',measured=300)
s,choices=p.post(f'/api/dishes/{did}/say',{'text':'Fictional bean stew and Fictional bean curry'})
choice_ids={r['id'] for r in choices.get('recipe_choices',[])}
check('chat returns every equal specific recipe match',s==200 and choice_ids=={half_source,ambiguous} and choices.get('clarification'),choices)
s,missing=p.post(f'/api/dishes/{did}/say',{'text':'Fictional no measured weight'})
check('chat missing-data response remains resumable',s==200 and missing.get('by')=='recipe' and missing.get('clarification')=='Fictional no measured weight' and missing.get('recipe_amount',{}).get('weight_g') is None and not missing.get('added'),missing)

s,_=p.delete(f'/api/dishes/{source}')
copied=p.get(f'/api/dishes/{did}')[1]
saved=next((i for i in copied['items'] if i.get('ref',{}).get('recipe_id')==source),None)
check('deleting source keeps copied ingredient nutrition',s==200 and saved is not None and saved.get('kcal')==200,p.get(f'/api/dishes/{did}'))
check('deleted source becomes unavailable',p.get(f'/api/dishes/{source}/own-source')[0]==404)
for client,rid in reversed(created):client.delete(f'/api/dishes/{rid}')

p.delete(f'/api/dishes/{did}')
print(f'cook chat: {ok} passed, {fail} failed')
sys.exit(1 if fail else 0)
