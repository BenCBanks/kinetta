"""Kit conversation, fixed tools and retry/consent isolation on real PostgreSQL; no provider calls."""
import datetime as dt
import io,json,uuid,zipfile,threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,coach_chat,kit_tools,ai_release
from app.main import app
from app.api_mydata import _write_export
uids=[];clients=[];pw='green kettle on a quiet hill'
try:
 for suffix in ['a','b']:
  name='zz_test_kit_'+suffix+uuid.uuid4().hex[:8]
  with db.connect() as c:
   uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(name,'Fictional Kit tester',auth.hash_pw(pw))).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,ai_ok,kcal_target,protein_target,ai_adult_at) VALUES(%s,'UTC',true,2200,120,now())",(uid,))
  client=TestClient(app,raise_server_exceptions=True);client.headers['Origin']='http://testserver';assert client.post('/api/login',json={'login':name,'password':pw}).status_code==200;clients.append(client)
 a,b=clients;uid,other=uids
 def req(client,method,path,body=None,code=200):
  r=client.request(method,path,json=body);assert r.status_code==code,(path,r.status_code,r.text[:300]);return r.json()
 root='/api/coach/conversation'
 generation=req(a,'GET',root)['generation'];othergen=req(b,'GET',root)['generation'];assert generation!=othergen
 assert TestClient(app).get(root).status_code==401
 seen=[]
 def response(user,question,**kw):
  seen.append((user,question,kw));data=kit_tools.KitTools(user).call('profile',{})
  return {'interpretation':'Start with your recorded goals and build a routine that fits your week.', 'facts':[{'label':'protein target','value':data['protein_target']}],'selection':None,'actions':['nutrition'],'limitations':['Only logged records are known.'],'tools_used':['profile']}
 def message(text='Help me understand my progress',gen=None):return {'client_id':str(uuid.uuid4()),'generation':gen or generation,'question':text,'context':{'screen':'progress','activity_id':None}}
 with patch('app.coach.provider',return_value='gemini'),patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=response),patch('urllib.request.urlopen',side_effect=AssertionError('No provider network')):
  body=message();m=req(a,'POST',root+'/messages',body);assert m['state']=='pending'
  assert req(a,'POST',root+'/messages',body)['id']==m['id']
  req(a,'POST',root+'/messages',{**body,'question':'Different question'},409)
  req(a,'POST',root+'/messages',message('Another concurrent question'),409)
  req(b,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':othergen},404)
  req(a,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':generation,'user_id':other},422)
  result=req(a,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':generation});assert result['state']=='answered' and result['answer']['facts'][0]['value']==120
  assert req(a,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':generation})['answer']==result['answer'] and len(seen)==1
  assert req(b,'GET',root)['messages']==[]
  follow=message('What should I do about that?');req(a,'POST',root+'/messages',follow);req(a,'POST',root+'/messages/'+follow['client_id']+'/answer',{'generation':generation});assert seen[-1][2]['history'][0]['text']==body['question']
  assert seen[-1][2]['kit'] is True and len(seen[-1][2]['history'])==2
  # A greeting is a valid message; Kit can reply and ask what the person wants. Blank text is still rejected.
  req(a,'POST',root+'/messages',message('   '),422)
  hi=message('Hi');assert req(a,'POST',root+'/messages',hi)['question']=='Hi';assert req(a,'POST',root+'/messages/'+hi['client_id']+'/answer',{'generation':generation})['state']=='answered' and seen[-1][1].endswith('Question: Hi')
  # Bounded history and pagination use the same account; no source identity can be supplied.
  with db.connect() as c:
   for n in range(55):c.execute("INSERT INTO kit_turns(user_id,client_id,generation,question,state,answer) VALUES (%s,%s,%s,%s,'answered',%s)",(uid,uuid.uuid4(),generation,'Earlier question '+str(n),json.dumps(result['answer'])))
  page=req(a,'GET',root);assert len(page['messages'])==50 and page['before'];older=req(a,'GET',root+'?before='+str(page['before']));assert len(older['messages'])==8
  req(a,'POST',root+'/clear',{'generation':generation,'confirmed':'true'},422)
  new=req(a,'POST',root+'/clear',{'generation':generation,'confirmed':True});assert not new['messages'] and new['generation']!=generation
  req(a,'POST',root+'/messages',body,409);generation=new['generation']
  # Real concurrent requests join a single committed lease; Clear drops its eventual response.
  started=threading.Event();release=threading.Event();count=[0]
  def slow(user,q,**kw):count[0]+=1;started.set();assert release.wait(10);return response(user,q,**kw)
  body=message();req(a,'POST',root+'/messages',body)
  with patch('app.coach_chat.answer',side_effect=slow),ThreadPoolExecutor(max_workers=2) as pool:
   future=pool.submit(req,a,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':generation});assert started.wait(10)
   assert req(a,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':generation})['state']=='running'
   req(a,'POST',root+'/clear',{'generation':generation,'confirmed':True});release.set();assert future.result()['cancelled'] and count[0]==1
  assert not req(a,'GET',root)['messages'];generation=req(a,'GET',root)['generation']
  # A process loss becomes explicit Retry; an expired lease is not paid again on GET.
  body=message();req(a,'POST',root+'/messages',body)
  with db.connect() as c:c.execute("UPDATE kit_turns SET state='running',lease=%s,expires=now()-interval '1 second' WHERE user_id=%s AND client_id=%s",(uuid.uuid4(),uid,body['client_id']))
  assert req(a,'GET',root)['messages'][-1]['state']=='failed'
  req(a,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':generation})
  # Revoked consent while provider runs never stores the answer.
  body=message('Help with another aspect of progress');req(a,'POST',root+'/messages',body);started.clear();release.clear()
  with patch('app.coach_chat.answer',side_effect=slow),ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(req,a,'POST',root+'/messages/'+body['client_id']+'/answer',{'generation':generation});assert started.wait(10)
   with db.connect() as c:c.execute('UPDATE profile SET ai_ok=false WHERE user_id=%s',(uid,))
   release.set();late=future.result();assert late['state']=='failed' and late['answer'] is None
  with db.connect() as c:c.execute('UPDATE profile SET ai_ok = true, ai_adult_at = now() WHERE user_id=%s',(uid,))
 # Release gate, access and consent are separate; no provider work when unreviewed.
 with patch('app.coach.provider',return_value='gemini'),patch('app.ai_release.enabled',return_value=False):req(a,'POST',root+'/messages',message('Question while unreleased'),503)
 with patch('app.ai_release.enabled',return_value=True),patch('app.coach.allowed',return_value=False):req(a,'POST',root+'/messages',message('Question without consent'),403)
 # Own-data tools use true restricted RLS and fixed schemas.
 # Keep local process time, the UTC profile and workout timestamps on one fixture day.
 today='2026-01-15';dates={'start':today,'end':today}
 with db.connect() as c:
  c.execute("INSERT INTO food_entries(user_id,day,meal,name,amount,unit,kcal,protein_g,ref) VALUES (%s,%s,'lunch','Fictional soup',1,'bowl',250,0,%s)",(uid,today,json.dumps({'unknown_nutrients':['protein_g']})))
  aid=c.execute("INSERT INTO activities(user_id,sport,source,name,start_time,distance_m,moving_s) VALUES (%s,'walk','manual','Fictional walk',%s,1000,600) RETURNING id",(uid,today+'T12:00:00+00:00')).fetchone()['id']
  c.execute("INSERT INTO goals(user_id,sport,period,metric,target) VALUES (%s,'walk','week','distance',5000)",(uid,))
  c.execute("INSERT INTO gear(user_id,name) VALUES (%s,'Fictional shoes')",(uid,))
 tools=kit_tools.KitTools(uid);ot=kit_tools.KitTools(other)
 assert tools.call('activities',dates)['totals_by_sport'][0]['distance_m']==1000
 assert not ot.call('activities',dates)['activities']
 assert tools.call('food_log',dates)['foods'][0]['protein_g'] is None
 assert not ot.call('food_log',dates)['foods']
 assert len(tools.call('goals',{})['activity_goals'])==1 and not ot.call('goals',{})['activity_goals']
 assert tools.call('gear',{})['gear'][0]['name']=='Fictional shoes'
 with db.connect() as c:
  food_id=c.execute("INSERT INTO custom_foods(user_id,name,kcal,protein_g) VALUES (%s,'Fictional custom food',100,0) RETURNING id",(uid,)).fetchone()['id']
  recipe_id=c.execute("INSERT INTO dishes(user_id,name,known_kcal) VALUES (%s,'Fictional incomplete recipe',400) RETURNING id",(uid,)).fetchone()['id']
  meal_id=c.execute('INSERT INTO saved_meals(user_id,name,items) VALUES (%s,%s,%s) RETURNING id',(uid,'Fictional saved meal',json.dumps([{'name':'Fictional soup','kcal':100,'protein_g':0,'ref':{'unknown_nutrients':['protein_g']}}]))).fetchone()['id']
 assert tools.call('stored_foods',{'kind':'foods','record_id':food_id})['records'][0]['kcal']==100
 recipe=tools.call('stored_foods',{'kind':'recipes','record_id':recipe_id})['records'][0]
 assert recipe['totals']['kcal']==400 and recipe['totals']['protein_g'] is None
 assert tools.call('stored_foods',{'kind':'meals','record_id':meal_id})['records'][0]['totals']['protein_g'] is None
 for kind,record_id in [('foods',food_id),('recipes',recipe_id),('meals',meal_id)]:
  assert not ot.call('stored_foods',{'kind':kind})['records']
  try:ot.call('stored_foods',{'kind':kind,'record_id':record_id})
  except ValueError:pass
  else:raise AssertionError('Foreign stored food')
 assert tools.call('strength_history',dates)['sets']==[]
 assert any(f['path']=='/track' for f in tools.call('app_features',{})['features'])
 for name,args in [('activities',{**dates,'user_id':other}),('food_log',{**dates,'sql':'SELECT * FROM users'}),('activity',{'activity_id':aid,'user_id':uid})]:
  try:tools.call(name,args)
  except ValueError:pass
  else:raise AssertionError('Unbound tool identity')
 try:ot.call('activity',{'activity_id':aid})
 except ValueError:pass
 else:raise AssertionError('Another account activity')
 with db.coach_connect(uid) as c:
  assert c.execute('SELECT count(*) AS n FROM food_entries').fetchone()['n']==1
  try:
   with c.transaction():c.execute('DELETE FROM food_entries')
  except Exception:pass
  else:raise AssertionError('Coach role writable')
 # Health data blocks sensitive tools, but food questions still work without granting Health disclosure.
 with db.connect() as c:c.execute("UPDATE activities SET source='healthkit',healthkit_id='fictional-health' WHERE user_id=%s AND id=%s",(uid,aid))
 assert tools.call('food_log',dates)['foods']
 try:tools.call('activities',dates)
 except ValueError:pass
 else:raise AssertionError('Health scope disclosed')
 with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(uid,))
 assert tools.call('activities',dates)['activities']
 # Workout ordering/cursors follow workout time, even when an older workout is uploaded last.
 with db.connect() as c:
  late=c.execute("INSERT INTO activities(user_id,sport,source,name,start_time,distance_m,moving_s) VALUES (%s,'walk','manual','Fictional old late upload',%s::timestamptz-interval '1 day',2000,1000) RETURNING id",(uid,today+'T12:00:00+00:00')).fetchone()['id']
 period={'start':(dt.date.fromisoformat(today)-dt.timedelta(days=2)).isoformat(),'end':today}
 ordered=tools.call('activities',period)['activities'];assert ordered[0]['id']==aid
 assert tools.call('activities',{**period,'before_id':aid})['activities'][0]['id']==late
 assert ot.call('activities',{**period,'before_id':aid})['activities']==[]
 # Current profile evidence is preloaded once, identical lookups are cached and the final round must answer.
 calls=[]
 def bounded_turn(messages,definitions):
  calls.append(bool(definitions))
  if definitions:return [{'name':'profile','args':{},'id':'call-'+str(len(calls))}],'',{}
  return [],json.dumps({'interpretation':'Use the saved target as context, not proof of what you ate.','facts':[{'evidence_id':'e1','path':['protein_target'],'value':120}]}),{}
 with patch('app.coach.provider',return_value='gemini'):
  verified=coach_chat.answer(uid,'Explain my saved protein target',kit=True,turn=bounded_turn)
 assert calls==[True,True,True,True,False] and verified['facts'][0]['value']==120
 assert not verified['health_included']
 # A previously consented Health answer must not be included after permission is withdrawn.
 with db.connect() as c:
  c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(uid,))
  c.execute("INSERT INTO kit_turns(user_id,client_id,generation,question,state,answer) VALUES (%s,%s,%s,'Sensitive earlier question','answered',%s)",(uid,uuid.uuid4(),generation,json.dumps({'interpretation':'Fictional sensitive detail','health_included':True,'tools_used':['activities']})))
 with patch('app.coach.provider',return_value='gemini'),patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=response):
  next_body=message('Please review my food today');req(a,'POST',root+'/messages',next_body);req(a,'POST',root+'/messages/'+next_body['client_id']+'/answer',{'generation':generation})
  assert all('Fictional sensitive detail' not in h['text'] for h in seen[-1][2]['history'])
 with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(uid,))
 # Conversation history and data export are personal; deletion cascades all Kit rows.
 import tempfile
 with tempfile.NamedTemporaryFile(suffix='.zip') as f:
  _write_export(uid,f.name)
  with zipfile.ZipFile(f.name) as z:
   assert 'data/kit_turns.jsonl' in z.namelist() and 'data/kit_conversations.jsonl' in z.namelist()
   assert all('lease' not in json.loads(line) for line in z.read('data/kit_turns.jsonl').splitlines())
 with db.connect() as c:
  c.execute('DELETE FROM users WHERE id=%s',(uid,));assert c.execute('SELECT count(*) AS n FROM kit_turns WHERE user_id=%s',(uid,)).fetchone()['n']==0
 print('Kit real DB: session ownership, RLS/read-only tools, missing nutrients, all sports/goals/gear/strength, Health consent, history, UUID replay, lease concurrency/expiry, clear fencing, late consent revocation, pagination/export/delete PASS')
finally:
 for uid in uids:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
