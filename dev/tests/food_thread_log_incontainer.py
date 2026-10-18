"""Atomic food/reply commits and learned times, with no second connection/provider."""
import datetime as dt
import uuid
from app import db, food_thread, food_thread_log as engine, food_photo
uid=None;original_connect=db.connect;original_ask=food_photo.ask;original_finish=food_thread.finish_reply
try:
 with db.connect() as c:
  uid=c.execute("INSERT INTO users(login,name) VALUES ('zz_test_thread_atomic','Fictional atomic food') RETURNING id").fetchone()['id']
  c.execute("INSERT INTO profile(user_id,tz,kcal_target,protein_target) VALUES (%s,'UTC',2000,110)",(uid,))
  c.execute("INSERT INTO custom_foods(user_id,name,kcal,protein_g) VALUES (%s,'Protein bar',200,20)",(uid,))
  day=dt.datetime.now(dt.timezone.utc).date()-dt.timedelta(days=1)
  captured=dt.datetime.combine(day,dt.time(9),dt.timezone.utc)
  mid=c.execute("""INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state)
                     VALUES (%s,%s,'user','a protein bar',%s,%s,'pending') RETURNING id""",(uid,uuid.uuid4(),captured,day)).fetchone()['id']
 # Social turns must bypass private-food matching, catalogs, model work and snapshot queries.
 def forbidden_social(*args,**kwargs):raise AssertionError('Small talk reached food resolution')
 original_resolve=engine.resolve;original_classify=engine.facts.classify
 engine.resolve=forbidden_social;engine.facts.classify=forbidden_social
 try:
  with db.connect() as c:
   for phrase in ('Hello','HELLO!!','Hi Kit','Hey, how are you?','Good morning','How’s it going?','Thank you','Thanks so much!'):
    social=c.execute("""INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state)
      VALUES (%s,%s,'user',%s,%s,%s,'pending') RETURNING id""",(uid,uuid.uuid4(),phrase,captured,day)).fetchone()['id']
    reply=engine.process(c,uid,engine.locked_message(c,uid,social))['messages'][-1]
    assert reply['result']['intent']=='small_talk' and not reply['entries']
    assert engine.process(c,uid,engine.locked_message(c,uid,social))['messages'][-1]['id']==reply['id']
   assert not c.execute('SELECT id FROM food_entries WHERE user_id=%s',(uid,)).fetchall()
 finally:engine.resolve=original_resolve;engine.facts.classify=original_classify
 for phrase in ('Hello Kitty cereal','Hi-C juice','Thank you cookies','a good morning bar','Hi, I had 2 eggs','Thanks, half the rice','How many calories left?','Hello 2 eggs'):
  assert engine.social_reply(phrase) is None,phrase
 # Force an exception after the food write; nothing in the transaction may survive.
 def fail_reply(*args,**kwargs):raise RuntimeError('Fictional reply persistence failure')
 food_thread.finish_reply=fail_reply
 try:
  with db.connect() as c:engine.process(c,uid,engine.locked_message(c,uid,mid))
 except RuntimeError:pass
 else:raise AssertionError('Expected synthetic persistence failure')
 finally:food_thread.finish_reply=original_finish
 with db.connect() as c:
  assert not c.execute('SELECT id FROM food_entries WHERE user_id=%s',(uid,)).fetchall()
  assert c.execute('SELECT state FROM food_chat_messages WHERE id=%s',(mid,)).fetchone()['state']=='pending'
  def forbidden(*args,**kwargs):raise AssertionError('Logging cannot borrow another connection or call a provider')
  db.connect=forbidden;food_photo.ask=forbidden
  try:
   result=engine.process(c,uid,engine.locked_message(c,uid,mid))
   assert len(result['messages'][-1]['entries'])==1 and result['messages'][-1]['entries'][0]['kcal']==200
   assert c.execute('SELECT count(*) AS n FROM food_chat_entries WHERE user_id=%s',(uid,)).fetchone()['n']==2
  finally:db.connect=original_connect;food_photo.ask=original_ask
 # A learned 14:00 lunch wins over the fallback 14:00 snack, using only own records.
 with db.connect() as c:
  for ago in (1,2,3):
   logged=day-dt.timedelta(days=ago);created=dt.datetime.combine(logged,dt.time(14),dt.timezone.utc)
   c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,created) VALUES (%s,%s,'lunch','Fictional learned lunch',400,%s)",(uid,logged,created))
  assert engine.expected_meal(c,uid,dt.datetime.combine(day,dt.time(14),dt.timezone.utc))=='lunch'
 print('Food-thread logging: rollback on reply failure, atomic food/links/reply, no second connection/model, learned meal times PASS')
finally:
 db.connect=original_connect;food_photo.ask=original_ask;food_thread.finish_reply=original_finish
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
