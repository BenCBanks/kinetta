"""Atomic food/reply commits and learned times, with no second connection/provider."""
import datetime as dt
import uuid
from zoneinfo import ZoneInfo
from app import db, food_thread, food_thread_log as engine, food_photo
uid=None;original_connect=db.connect;original_ask=food_photo.ask;original_finish=food_thread.finish_reply
fixture_captured_at=dt.datetime.now(dt.timezone.utc)
account_tz=ZoneInfo('UTC')
fixture_day=fixture_captured_at.astimezone(account_tz).date()
try:
 with db.connect() as c:
  uid=c.execute("INSERT INTO users(login,name) VALUES ('zz_test_thread_atomic','Fictional atomic food') RETURNING id").fetchone()['id']
  c.execute("INSERT INTO profile(user_id,tz,kcal_target,protein_target) VALUES (%s,'UTC',2000,110)",(uid,))
  c.execute("INSERT INTO custom_foods(user_id,name,kcal,protein_g) VALUES (%s,'Protein bar',200,20)",(uid,))
  day=fixture_day-dt.timedelta(days=1)
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

# Recent "another one" fast path: owner-scoped, grouped, scaled, choice-bound and provider-free.
from fastapi import Response
from app import food_thread_reuse as reuse, food_memory_understand as memory, food_thread_understand as understand, api_food
import time
reuse_uids=[];original_memory_prepare=memory.prepare;original_understand_prepare=understand.prepare
try:
 with db.connect() as c:
  for suffix in ('fast','chip','ambiguous','old','other','half','daycopy','other_daycopy'):
   uid2=c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',('zz_test_repeat_'+suffix,'Fictional repeat '+suffix)).fetchone()['id'];reuse_uids.append(uid2)
   c.execute("INSERT INTO profile(user_id,tz,kcal_target,protein_target,food_chat_auto_log) VALUES (%s,'UTC',2000,110,true)",(uid2,))
 repeat_day=fixture_day
 def seed_group(uid2,items,minutes_ago=5,hours_ago=0,meal='lunch',day=repeat_day):
  stamp=dt.datetime.now(dt.timezone.utc)-dt.timedelta(minutes=minutes_ago,hours=hours_ago)
  if day!=repeat_day:stamp=dt.datetime.combine(day,dt.time(8),dt.timezone.utc)
  prefix=str(uuid.uuid4());ids=[]
  with db.connect() as c:
   for position,(name,amount,unit,kcal) in enumerate(items,1):
    row=c.execute("""INSERT INTO food_entries(user_id,day,meal,name,amount,unit,kcal,protein_g,carbs_g,fat_g,source,ref,position,client_id,created,updated)
      VALUES (%s,%s,%s,%s,%s,%s,%s,2,18,4,'quick','{}',%s,%s,%s,%s) RETURNING id""",
      (uid2,day,meal,name,amount,unit,kcal,position,f'{prefix}-{position:02d}',stamp,stamp)).fetchone();ids.append(row['id'])
  return ids
 def repeat_message(uid2,body,meal='lunch',repeat_entry_id=None,client_id=None):
  request=food_thread.MessageIn(client_id=client_id or uuid.uuid4(),body=body,captured_at=fixture_captured_at,day=repeat_day,meal=meal,review_only=True,draft_id=uuid.uuid4(),repeat_entry_id=repeat_entry_id)
  message=food_thread.append(request,Response(),user={'id':uid2})['message']
  assert message['local_day']==repeat_day,'captured message day follows the UTC account day'
  return message
 def logged_count(uid2):
  with db.connect() as c:return c.execute('SELECT count(*) AS n FROM food_entries WHERE user_id=%s',(uid2,)).fetchone()['n']
 def no_model(*args,**kwargs):raise AssertionError('Recent repeat reached food-memory or food-understanding preparation')
 fast_uid,chip_uid,amb_uid,old_uid,other_uid,half_uid=reuse_uids[:6]
 source=seed_group(fast_uid,[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)])
 message=repeat_message(fast_uid,'I had another two pieces of toast')
 memory.prepare=no_model;understand.prepare=no_model
 started=time.perf_counter();fast=food_thread.process_message(message['id'],food_thread.AnswerIn(),{'id':fast_uid});elapsed=time.perf_counter()-started
 receipt=fast['messages'][-1];assert receipt['result']['kind']=='log' and receipt['result']['reuse_label']=='Another Fictional toast with Fictional butter'
 assert receipt['result']['same_as'] and fast['messages'][0]['result'].get('review_only') is True,'fast logging preserves the chat replay metadata'
 assert len(receipt['entries'])==2 and sorted((e['name'],e['amount']) for e in receipt['entries'])==[('Fictional butter',2),('Fictional toast',2)]
 assert elapsed<.3,f'fast repeat took {elapsed:.3f}s, above the 300 ms target'
 replay=food_thread.process_message(message['id'],food_thread.AnswerIn(),{'id':fast_uid});assert replay['messages'][-1]['id']==receipt['id'] and logged_count(fast_uid)==4,'replayed process is exactly once and still bypasses AI'
 # The recent chip submits its server-selected entry id through the ordinary idempotent message queue.
 chip_ids=seed_group(chip_uid,[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)])
 assert food_thread.recent_reuse(repeat_day,'lunch',user={'id':chip_uid})['item']['entry_id'] in chip_ids
 request_id=uuid.uuid4();chip_message=repeat_message(chip_uid,'Another Fictional toast with Fictional butter',repeat_entry_id=chip_ids[0],client_id=request_id)
 duplicate=food_thread.append(food_thread.MessageIn(client_id=request_id,body='Another Fictional toast with Fictional butter',captured_at=fixture_captured_at,day=repeat_day,meal='lunch',review_only=True,draft_id=uuid.UUID(chip_message['result']['draft_id']),repeat_entry_id=chip_ids[0]),Response(),user={'id':chip_uid})
 assert duplicate['created'] is False,'repeated chip delivery reuses the original message identity'
 chip_result=food_thread.process_message(chip_message['id'],food_thread.AnswerIn(),{'id':chip_uid});assert len(chip_result['messages'][-1]['entries'])==2 and logged_count(chip_uid)==4
 # No name plus two distinct recent groups asks one question; selecting a chip copies only its group.
 seed_group(amb_uid,[('Fictional toast',1,'piece',120),('Fictional butter',1,'serving',40)],minutes_ago=8)
 seed_group(amb_uid,[('Fictional pear',1,'piece',95)],minutes_ago=3)
 question=food_thread.process_message(repeat_message(amb_uid,'another one')['id'],food_thread.AnswerIn(),{'id':amb_uid})
 assert question['messages'][-1]['result']['kind']=='needs' and len(question['messages'][-1]['result']['choices'])==2 and logged_count(amb_uid)==3
 chosen=food_thread.choose_message(question['messages'][0]['id'],food_thread.ChoiceIn(select=0),Response(),{'id':amb_uid})
 assert chosen['messages'][-1]['result']['kind']=='log' and [e['name'] for e in chosen['messages'][-1]['entries']]==['Fictional pear'] and logged_count(amb_uid)==4
 # Fractions scale a single unambiguous recent row.
 half_source=seed_group(half_uid,[('Fictional pita',2,'piece',300)])
 half_result=food_thread.process_message(repeat_message(half_uid,'half a piece more')['id'],food_thread.AnswerIn(),{'id':half_uid})
 assert half_result['messages'][-1]['entries'][0]['amount']==1 and logged_count(half_uid)==2
 # A three-hour-old source or another meal block stays on the normal path and is never auto-copied.
 seed_group(old_uid,[('Fictional toast',1,'piece',120)],hours_ago=3)
 old=repeat_message(old_uid,'another piece of toast');before=logged_count(old_uid);assert reuse.process(old_uid,old['id']) is None and logged_count(old_uid)==before
 wrong_meal=repeat_message(old_uid,'another piece of toast',meal='dinner');assert reuse.process(old_uid,wrong_meal['id']) is None and logged_count(old_uid)==before
 assert reuse.parse_repeat('another coffee but with oat milk') is None
 # Candidate lookup cannot expose a different account's recent foods.
 assert food_thread.recent_reuse(repeat_day,'lunch',user={'id':other_uid})['item'] is None
 assert reuse.parse_repeat('another two pieces of toast')==(2,{'toast'}) and reuse.parse_repeat('half a piece more')==(.5,set())
 assert reuse.parse_yesterday_meal('Same breakfast as yesterday!')=='breakfast'
 assert reuse.parse_yesterday_meal('same as yesterday') is None
 yesterday_day=repeat_day-dt.timedelta(days=1)
 seed_group(reuse_uids[-2],[('Fictional oats',1,'serving',150),('Fictional coffee',1,'cup',5)],meal='breakfast',day=yesterday_day)
 seed_group(reuse_uids[-1],[('Private fictional meal',1,'serving',300)],meal='breakfast',day=yesterday_day)
 with db.connect() as c:
  own=api_food._last_meals(c,reuse_uids[-2],repeat_day)
  foreign=api_food._last_meals(c,other_uid,repeat_day)
 assert own['breakfast']['day']==yesterday_day.isoformat() and {row['name'] for row in own['breakfast']['items']}=={'Fictional oats','Fictional coffee'}
 assert 'breakfast' not in foreign,'yesterday meals are returned only from the caller’s own diary'
 copied_message=repeat_message(reuse_uids[-2],'same breakfast as yesterday',meal='dinner')
 copied=food_thread.process_message(copied_message['id'],food_thread.AnswerIn(),{'id':reuse_uids[-2]})
 copied_receipt=copied['messages'][-1]
 assert copied_receipt['result']['kind']=='log' and copied_receipt['result']['meal']=='breakfast'
 assert sorted(row['name'] for row in copied_receipt['entries'])==['Fictional coffee','Fictional oats']
 assert copied_receipt['result']['reuse_label']=="Yesterday's breakfast"
 with db.connect() as c:
  copied_rows=c.execute('SELECT meal,created FROM food_entries WHERE user_id=%s AND day=%s',(reuse_uids[-2],repeat_day)).fetchall()
 assert all(row['meal']=='breakfast' and (dt.datetime.now(dt.timezone.utc)-row['created']).total_seconds()<10 for row in copied_rows),'copies use the requested meal and current logged time'
 assert food_thread.process_message(copied_message['id'],food_thread.AnswerIn(),{'id':reuse_uids[-2]})['messages'][-1]['id']==copied_receipt['id']
 assert logged_count(reuse_uids[-2])==4,'replayed yesterday copy is exactly once'
 absent_message=repeat_message(other_uid,'same breakfast as yesterday')
 absent=food_thread.process_message(absent_message['id'],food_thread.AnswerIn(),{'id':other_uid})['messages'][-1]
 assert absent['result']['kind']=='needs' and absent['result']['text']=='No breakfast was logged yesterday.' and not absent['entries']
 print(f'Food repeat reuse: owner scope, {elapsed*1000:.0f} ms provider-free copy, scaled group, chip replay, ambiguity and stale fallback PASS')
finally:
 memory.prepare=original_memory_prepare;understand.prepare=original_understand_prepare
 if reuse_uids:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(reuse_uids,))
