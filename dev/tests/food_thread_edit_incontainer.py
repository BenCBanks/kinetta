"""Corrections are atomic, current-row based, and never call a provider or borrow a connection."""
import datetime as dt
import uuid
from app import db,food_thread,food_thread_log as engine,food_photo
uid=None;original_connect=db.connect;original_finish=food_thread.finish_reply;original_ask=food_photo.ask
try:
 day=dt.datetime.now(dt.timezone.utc).date()-dt.timedelta(days=1);captured=dt.datetime.combine(day,dt.time(12),dt.timezone.utc)
 with db.connect() as c:
  uid=c.execute("INSERT INTO users(login,name) VALUES ('zz_test_edit_atomic','Fictional corrections') RETURNING id").fetchone()['id']
  c.execute("INSERT INTO profile(user_id,tz,kcal_target) VALUES (%s,'UTC',2000)",(uid,))
  c.execute("INSERT INTO custom_foods(user_id,name,serving_g,kcal,protein_g) VALUES (%s,'Rice',200,350,5)",(uid,))
  root=c.execute("INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state) VALUES (%s,%s,'user','200g rice',%s,%s,'pending') RETURNING id",(uid,uuid.uuid4(),captured,day)).fetchone()['id']
  engine.process(c,uid,engine.locked_message(c,uid,root))
  mid=c.execute("INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state) VALUES (%s,%s,'user','only half the rice',%s,%s,'pending') RETURNING id",(uid,uuid.uuid4(),captured,day)).fetchone()['id']
 def fail(*args,**kwargs):raise RuntimeError('Fictional correction reply failure')
 food_thread.finish_reply=fail
 try:
  with db.connect() as c:engine.process(c,uid,engine.locked_message(c,uid,mid))
 except RuntimeError:pass
 else:raise AssertionError('Expected rollback fixture')
 finally:food_thread.finish_reply=original_finish
 with db.connect() as c:
  row=c.execute('SELECT amount,kcal FROM food_entries WHERE user_id=%s',(uid,)).fetchone();assert row['amount']==200 and row['kcal']==350
  assert c.execute('SELECT state FROM food_chat_messages WHERE id=%s',(mid,)).fetchone()['state']=='pending'
  def forbidden(*args,**kwargs):raise AssertionError('Corrections must not borrow a connection or call a provider')
  db.connect=forbidden;food_photo.ask=forbidden
  try:
   result=engine.process(c,uid,engine.locked_message(c,uid,mid));assert result['updated_message']['entries'][0]['kcal']==175
   engine.process(c,uid,engine.locked_message(c,uid,mid))
   row=c.execute('SELECT amount,kcal FROM food_entries WHERE user_id=%s',(uid,)).fetchone();assert row['amount']==100 and row['kcal']==175
  finally:db.connect=original_connect;food_photo.ask=original_ask
 # A correction against an older card uses bounded batch reads, not two queries
 # for every intervening card while the account is locked.
 with db.connect() as c:
  for index in range(49):
   extra=c.execute("INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state,result) VALUES (%s,%s,'user','Fictional unrelated meal',%s,%s,'answered',%s) RETURNING id",(uid,uuid.uuid4(),captured,day,__import__('json').dumps({'kind':'log'}))).fetchone()['id']
   eid=c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,amount,unit) VALUES (%s,%s,'lunch','Fictional unrelated item',100,1,'serving') RETURNING id",(uid,day)).fetchone()['id']
   c.execute('INSERT INTO food_chat_entries VALUES (%s,%s,%s)',(uid,extra,eid))
  request=c.execute("INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state) VALUES (%s,%s,'user','make the rice 150 grams',%s,%s,'pending') RETURNING id",(uid,uuid.uuid4(),captured,day)).fetchone()['id']
  class Counted:
   def __init__(self,connection):self.connection=connection;self.queries=0
   def execute(self,*a,**k):self.queries+=1;return self.connection.execute(*a,**k)
   def __getattr__(self,name):return getattr(self.connection,name)
  counted=Counted(c)
  output=engine.process(counted,uid,engine.locked_message(counted,uid,request))
  assert output['messages'][-1]['result']['kind']=='edit'
  assert counted.queries<35, 'Older-card correction must not query each intervening card separately'
 print('Food corrections: atomic rollback, current logged nutrition, same connection/no provider, replay once PASS')
finally:
 db.connect=original_connect;food_thread.finish_reply=original_finish;food_photo.ask=original_ask
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
