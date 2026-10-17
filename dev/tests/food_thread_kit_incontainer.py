"""Food-only Kit, real SQL/HTTP ownership and atomic writes; stand-in turns only."""
import datetime as dt
import json,os,uuid
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,coach,coach_chat,coach_tools,food_thread_kit,ai_release
from app.main import app
PW='green teapot on the hill';ids=[];clients=[];day=dt.date.today().isoformat()
def check(value):assert value
try:
 for i in range(2):
  name='zz_test_foodkit_'+uuid.uuid4().hex[:12]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(name,'Fictional food Kit',auth.hash_pw(PW))).fetchone()['id'];ids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,ai_ok,health_ai_ok,kcal_target,protein_target) VALUES (%s,'UTC',true,false,2200,130)",(uid,))
  client=TestClient(app,raise_server_exceptions=False);client.headers['Origin']='http://testserver'
  check(client.post('/api/login',json={'login':name,'password':PW}).status_code==200);clients.append(client)
 a,b=clients;uid,other=ids
 def post(path,body={}):
  r=a.post(path,json=body);assert r.status_code in (200,201),(path,r.status_code,r.text);return r.json()
 def question(text='What should I eat for dinner?'):
  r=post('/api/food/thread/messages',{'client_id':str(uuid.uuid4()),'body':text})['message'];mid=r['id']
  post(f'/api/food/thread/messages/{mid}/process');return mid
 with patch('urllib.request.urlopen',side_effect=AssertionError('No network')):
  mid=question();path=f'/api/food/thread/messages/{mid}/kit'
  with patch('app.coach_chat.answer',side_effect=AssertionError('Gate must prevent turn')):
   check(a.post(path,json={}).status_code==503)
  check(b.post(path,json={}).status_code==404)
  with db.connect() as c:
   check(not c.execute('SELECT 1 FROM food_entries WHERE user_id=%s',(uid,)).fetchone())
   c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,ref) VALUES (%s,%s,'lunch','Fictional unknown soup',300,0,30,8,%s)",(uid,day,json.dumps({'unknown_nutrients':['protein_g']})))
   c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES (%s,%s,'Other private food',9000,900)",(other,day))
  tools=coach_tools.FoodTools(uid)
  profile=tools.call('profile',{});check(set(profile)<={'tz','units','kcal_target','protein_target','carbs_target','fat_target','fiber_target'})
  incomplete=post('/api/dishes',{'name':'Fictional calories-only recipe'})
  check(a.patch(f'/api/dishes/{incomplete["id"]}',json={'known_kcal':800}).status_code==200)
  check(not any(x['source']=='dish' for x in tools.call('meal_options',{'day':day})['candidates']))
  check({d['name'] for d in coach_tools.specifications(True)}==coach_tools.FOOD_TOOLS)
  for name,args in [('weight_trend',{}),('activity',{'activity_id':1}),('training_plan',{}),('profile',{'user_id':other}),('profile',{'sql':'SELECT * FROM users'}),('SELECT * FROM users',{})]:
   try:tools.call(name,args)
   except ValueError:pass
   else:raise AssertionError(name)
  summary=tools.call('nutrition_summary',{'start':day,'end':day});check(summary['totals']['kcal']==300 and summary['totals']['protein_g'] is None and summary['known_totals']['protein_g']==0)
  meal=tools.call('meal_options',{'day':day});check(meal['remaining']['protein_g'] is None and meal['eaten']['protein_g'] is None)
  def turn(messages,definitions):
   check({d['name'] for d in definitions}==coach_tools.FOOD_TOOLS)
   if len(messages)==1:return [{'name':'nutrition_summary','args':{'start':day,'end':day},'id':'food'}],'',{}
   data=messages[-1]['parts'][0]['functionResponse']['response']['data'];check(data['totals']['kcal']==300)
   return [],json.dumps({'interpretation':'Your logged foods give a starting point; incomplete nutrients limit meal advice.','facts':[{'evidence_id':'e1','path':['totals','kcal'],'value':300}]}),{}
  # Existing generic Health gate stays enforced; the food-only tools cannot read it.
  with patch('app.coach.health_ok',return_value=False),patch('app.coach.provider',return_value='gemini'):
   try:coach_chat.answer(uid,'generic question',turn=turn)
   except ValueError as e:check(str(e)==coach.HEALTH_NO)
   else:raise AssertionError('Generic Health gate bypassed')
   result=coach_chat.answer(uid,'food question',turn=turn,food_only=True);check(result['facts'][0]['value']==300)
  with patch('app.coach.allowed',side_effect=[True,True,False]),patch('app.coach.provider',return_value='gemini'):
   try:coach_chat.answer(uid,'revoked',turn=turn,food_only=True)
   except ValueError:pass
   else:raise AssertionError('Consent revocation ignored')
  calls=[]
  def fake(*args,**kwargs):calls.append(kwargs);check(kwargs=={'food_only':True});return result
  with patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=fake):
   first=post(path);check(any(m.get('result',{}).get('kit') for m in first['messages']))
   post(path);check(len(calls)==1)
   check(len(a.get('/api/food/day?d='+day).json()['entries'])==1)
  # Concurrent retry is a pending response, not a second provider request.
  with patch('app.ai_release.enabled',return_value=True):
   another=question('I overate today');p=f'/api/food/thread/messages/{another}/kit'
   def concurrent(*args,**kwargs):check(post(p)['processing']);return result
   with patch('app.coach_chat.answer',side_effect=concurrent):check(any(m.get('result',{}).get('kit') for m in post(p)['messages']))
   # Deleting just the reply while a provider is in flight prevents resurrection.
   another=question();p=f'/api/food/thread/messages/{another}/kit'
   def deleted(*args,**kwargs):
    with db.connect() as c:rid=c.execute('SELECT id FROM food_chat_messages WHERE user_id=%s AND reply_to=%s',(uid,another)).fetchone()['id']
    check(a.delete(f'/api/food/thread/messages/{rid}',headers={'Content-Type':'application/json'}).status_code==200);return result
   with patch('app.coach_chat.answer',side_effect=deleted):check(post(p)['cancelled'])
   with db.connect() as c:check(not c.execute('SELECT 1 FROM food_chat_messages WHERE user_id=%s AND reply_to=%s',(uid,another)).fetchone())
   another=question();p=f'/api/food/thread/messages/{another}/kit'
   def removed(*args,**kwargs):check(a.delete(f'/api/food/thread/messages/{another}',headers={'Content-Type':'application/json'}).status_code==200);return result
   with patch('app.coach_chat.answer',side_effect=removed):check(post(p)['cancelled'])
 print('Food Kit: ownership, gate, code-only advice, food-only tools/RLS, unknowns, revocation, cached retry, concurrent lease and late deletion PASS')
 # Exact stored usual-food numbers/source/fibre and an atomic receipt on explicit confirmation.
 with db.connect() as c:
  c.execute('DELETE FROM food_entries WHERE user_id=%s',(uid,))
  for n in range(3):c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g,source,ref) VALUES (%s,%s,'lunch','Fictional usual oats',400,25,45,12,7,'custom',%s)",(uid,day,json.dumps({'origin':'ai','origin_notes':'Illustrative estimate'})))
 a.delete(f'/api/dishes/{incomplete["id"]}',headers={'Content-Type':'application/json'})
 options=tools.call('meal_combinations',{'day':day});candidate=options['candidates'][0]
 proposal=post('/api/coach/proposals',{'kind':'food','day':day,'meal':'dinner','candidate_id':candidate['candidate_id']});p=f'/api/coach/proposals/{proposal["id"]}/confirm?thread=true'
 check(len(a.get('/api/food/day?d='+day).json()['entries'])==3)
 check(a.post(p,json={}).status_code==422 and b.post(p,json={'confirmed':True}).status_code==404)
 with patch('app.food_thread_receipts.create',side_effect=RuntimeError('Fictional failure')):check(a.post(p,json={'confirmed':True}).status_code==500)
 check(len(a.get('/api/food/day?d='+day).json()['entries'])==3)
 saved=post(p,{'confirmed':True});check(len(saved['entry_ids'])==1 and saved['messages'])
 check(post(p,{'confirmed':True})['already_applied'])
 entry=next(e for e in a.get('/api/food/day?d='+day).json()['entries'] if e['id']==saved['entry_ids'][0]);check(entry['fiber_g']==7 and entry['ref']['origin']=='ai')
 root=next(m for m in saved['messages'] if m['kind']=='user');post(f'/api/food/thread/messages/{root["id"]}/undo')
 check(post(p,{'confirmed':True})['removed_after_apply']);check(len(a.get('/api/food/day?d='+day).json()['entries'])==3)
 print('Food Kit proposals: explicit tap, foreign-owner/confirmation guards, atomic rollback, source/fibre receipt, idempotent confirm and no resurrection after Undo PASS')
finally:
 with db.connect() as c:
  for uid in ids:c.execute('DELETE FROM users WHERE id=%s',(uid,))

# In-memory report fixture exercises the gate contract; no rollout report is written.
report={'reviewed':True,'candidate_fingerprint':ai_release.fingerprint(),'food':{'passed':True},'coach':{'case_count':30,'unsupported_numeric_claims':0,'isolation_failures':0,'qualitative_review_passed':True}}
with patch.dict(os.environ,{'KINETTA_COACH_TOOLS_ENABLED':'1','KINETTA_AI_EVAL_REPORT':'/fictional/report.json'}),patch('pathlib.Path.read_text',side_effect=lambda *a,**k:json.dumps(report)):
 check(ai_release.enabled() and not ai_release.enabled('food'))
 report['food_chat']={'case_count':30,'unsupported_numeric_claims':0,'isolation_failures':0,'health_disclosures':0,'qualitative_review_passed':True}
 check(ai_release.enabled('food'))
 report['food_chat']['health_disclosures']=1;check(not ai_release.enabled('food'))
print('Food-specific reviewed release gate contract PASS; no real evaluation/rollout report created')
