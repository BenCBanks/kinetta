"""Named manual recipe ingredients, explicit yield, safe weight totals and portion retries."""
import datetime as dt
import uuid
from kc import person, PW

a,b=person('zz_test_unified'),person('zz_test_unified_other')
def call(method,path,body=None,status=200):
 s,r=getattr(a,method)(path,body) if body is not None else getattr(a,method)(path)
 assert s==status,(path,s,r)
 return r
try:
 d=call('post','/api/dishes',{'name':'Fictional oat bake'});path=f"/api/dishes/{d['id']}"
 r=call('post',path+'/say',{'text':'rice'});assert r['by']=='clarification' and not r['added']
 r=call('post',path+'/say',{'text':'100 g','previous':'rice'});assert r.get('fallback') and r.get('query')=='100 g rice'
 r=call('post',path+'/say',{'text':'remove it'});assert r['by']=='clarification'
 d=call('post',path+'/items',{'name':'Oats','grams':200,'per100':{'kcal':100,'protein_g':5}})
 d=call('post',path+'/items',{'name':'Homemade sauce','kcal':200,'fiber_g':4})
 assert [i['name'] for i in d['items']]==['Oats','Homemade sauce']
 assert d['totals']['kcal']==400 and d['totals']['protein_g'] is None
 assert d['totals']['fiber_g'] is None and d['weight_g'] is None,'Unknown ingredient weight must not become a partial total'
 call('post',path+'/portion',{'meal':'lunch','grams':100},status=400)
 d=call('patch',path,{'yield_servings':4})
 assert d['serving_count']==4 and d['per_serving']['kcal']==100
 key=str(uuid.uuid4());request={'meal':'dinner','day':dt.date.today().isoformat(),'count':1.5,'client_id':key}
 r=call('post',path+'/portion',request);assert r['entry']['kcal']==150 and r['entry']['meal']=='dinner'
 assert 'protein_g' in r['entry']['ref']['unknown_nutrients']
 replay=call('post',path+'/portion',request);assert replay['entry']['id']==r['entry']['id'] and replay['replayed']
 call('post',path+'/portion',{**request,'count':2},status=409)
 assert b.patch(path,{'yield_servings':2})[0]==404
 for invalid in (0,-1,51,None):call('patch',path,{'yield_servings':invalid},status=400 if invalid is None else 422)
 d=call('patch',path+'/items/'+d['items'][1]['id'],{'grams':100})
 assert d['weight_g']==300 and d['totals']['kcal']==400
 d=call('patch',path,{'serving':'portion','cooked_g':400})
 r=call('post',path+'/portion',{'meal':'lunch','grams':100});assert r['entry']['kcal']==100
 # Clearing cooked weight when an ingredient lacks weight must restore unknown, not a partial sum.
 call('post',path+'/items',{'name':'Finishing oil','kcal':50})
 d=call('patch',path,{'cooked_g':None});assert d['weight_g'] is None
 call('post',path+'/items',{'name':'   ','kcal':10},status=400)
 print('Unified food: named ingredients/unknown nutrients and weight, explicit yield, portion math, retry and owner isolation PASS')
finally:
 assert a.post('/api/account/delete',{'password':PW})[0]==200
 assert b.post('/api/account/delete',{'password':PW})[0]==200
