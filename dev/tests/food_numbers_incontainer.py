"""Typed nutrition numbers are held for review, with all external resolution blocked."""
import datetime as dt,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import db,auth,food_thread,food_thread_resolve as resolver,meal_chat
from app.main import app
uids=[];clients=[]
try:
 for _ in range(2):
  login='zz_test_numberreview_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',(login,'Fictional Number Review',auth.hash_pw('green teapot on the hill'))).fetchone()['id'];uids.append(uid);c.execute("INSERT INTO profile(user_id,tz,kcal_target,protein_target,food_chat_auto_log) VALUES(%s,'UTC',2100,120,true)",(uid,))
  cl=TestClient(app,raise_server_exceptions=False);cl.headers['Origin']='http://testserver';assert cl.post('/api/login',json={'login':login,'password':'green teapot on the hill'}).status_code==200;clients.append(cl)
 a,b=clients;now=dt.datetime.now(dt.timezone.utc);yesterday=(now.date()-dt.timedelta(days=1)).isoformat()
 def root(text,client=a,context=None):
  body={'client_id':str(uuid.uuid4()),'body':text,'captured_at':now.isoformat()}
  if context:body['context']=context
  r=client.post('/api/food/thread/messages',json=body);assert r.status_code==201,r.text;return r.json()['message']
 def action(message,kind='process',body=None,client=a,status=200):
  r=client.post('/api/food/thread/messages/'+str(message['id'])+'/'+kind,json=body or {});assert r.status_code==status,(r.status_code,r.text)
  return r.json() if status!=500 else None
 def reply(response):return next(r for r in reversed(response['messages']) if r['kind']=='reply')
 with patch.object(meal_chat,'resolve_data',side_effect=AssertionError('Numeric nutrition reached food catalog')),patch.object(resolver,'resolve_outside',side_effect=AssertionError('Numeric nutrition reached external resolver')):
  m=root('For dinner yesterday, Fictional plate 500 kcal, protein 30g, carbs 60g, fat 12g, fiber 5g, sodium 0.5g, sugar 0g')
  r=reply(action(m));assert r['result']['kind']=='preview' and not r['entries'] and not r['result']['can_resolve']
  p=r['result']['parts'][0];assert p['requires_tap'] and p['entries'][0]['sodium_mg']==500 and p['entries'][0]['sugar_g']==0 and p['entries'][0]['saturated_fat_g'] is None
  assert r['result']['day']==yesterday and r['result']['meal']=='dinner'
  assert not a.get('/api/food/day?d='+yesterday).json()['entries']
  assert reply(action(m))['result']['kind']=='preview'
  assert reply(action(m,'resolve'))['result']['kind']=='preview', 'Even a resolver retry must never auto-log entered numbers'
  action(m,'choose',{'part':0,'new':True},status=409)
  action(m,'log',{'confirm':False},status=400);action(m,'log',{'confirm':1},status=422)
  assert b.post('/api/food/thread/messages/'+str(m['id'])+'/log',json={'confirm':True}).status_code==404
  # Explicit save and reply are one transaction; a reply failure cannot leave food.
  original=food_thread.finish_reply
  def failure(c,uid,message,result):
   if result.get('kind')=='log':raise RuntimeError('Fictional reply failure')
   return original(c,uid,message,result)
  with patch.object(food_thread,'finish_reply',side_effect=failure):action(m,'log',{'confirm':True},status=500)
  assert not a.get('/api/food/day?d='+yesterday).json()['entries']
  logged=reply(action(m,'log',{'confirm':True}));entry=logged['entries'][0];assert len(logged['entries'])==1 and entry['kcal']==500 and entry['protein_g']==30 and entry['carbs_g']==60 and entry['fat_g']==12 and entry['fiber_g']==5 and entry['sodium_mg']==500 and entry['sugar_g']==0 and entry['saturated_fat_g'] is None and entry['source']=='quick'
  assert entry['ref']['origin']=='manual' and 'saturated_fat_g' in entry['ref']['unknown_nutrients']
  assert len(reply(action(m,'log',{'confirm':True}))['entries'])==1
  action(m,'undo');assert not a.get('/api/food/day?d='+yesterday).json()['entries'];action(m);assert not a.get('/api/food/day?d='+yesterday).json()['entries']
  for text in ['Fictional lunch 500kcal, 30g protein, 40g protein','Fictional lunch 500kcal per 100g','Fictional lunch 500000kcal','Fictional lunch -500kcal','Fictional lunch 500kcal and toast','Fictional lunch 500kilojoules','30g protein']:
   item=root(text);r=reply(action(item));assert r['result']['kind']=='needs' and not r['entries'] and not r['result']['can_resolve'],(text,r)
   assert reply(action(item,'resolve'))['result']['kind']=='needs';assert not a.get('/api/food/day').json()['entries']
  future=root('Tomorrow, Fictional plate 500kcal');r=reply(action(future));assert r['result']['destination_required']
  action(future,'manual',{'part':0,'items':[{'name':'Fictional plate','kcal':500}],'confirm':True},status=409)
  assert a.put('/api/food/thread/messages/'+str(future['id'])+'/destination',json={'day':now.date().isoformat(),'meal':'lunch'}).status_code==200
  action(future,'manual',{'part':0,'items':[{'name':'Fictional plate','kcal':500}],'confirm':True});action(future,'undo')
  # Partial explicit values are held and prefilled, never zeros; manual save remains an explicit action.
  partial=root('Fictional lunch 500kcal, protein30g');r=reply(action(partial));assert r['result']['parts'][0]['entries'][0]['carbs_g'] is None
  r=reply(action(partial,'manual',{'part':0,'items':[{'name':'Fictional corrected plate','kcal':500,'protein_g':35,'sodium_mg':0}],'confirm':True}));entry=r['entries'][0];assert entry['protein_g']==35 and entry['sodium_mg']==0 and entry['ref']['unknown_nutrients'] and entry['source']=='quick';action(partial,'undo')
  question=root('How much protein do I have left?');r=reply(action(question));assert r['result']['kind']=='answer' and not r['entries']
 # Ordinary quantified protein-bar food still uses the existing owned-food parser and auto-log setting.
 with db.connect() as c:c.execute("INSERT INTO custom_foods(user_id,name,serving_label,kcal,protein_g) VALUES(%s,'Protein bar','1 serving',200,20)",(uids[0],))
 ordinary=root('2 protein bars');r=reply(action(ordinary));assert r['result']['kind']=='log' and sum(e['kcal'] for e in r['entries'])==400;action(ordinary,'undo')
 assert not b.get('/api/food/day').json()['entries'];assert a.get('/api/me').json()['kcal_target']==2100
 print('Nutrition-number actual HTTP/SQL: no catalog/provider path, review required even auto-on/resolver retry,8values/units/date/meal/unknownzero, strict explicit save/rollback/replay/Undo, malformed/ambiguous held, explicit manual edit, questions/ordinary own-food quantities unchanged and two-owner isolation PASS')
finally:
 with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
