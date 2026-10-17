"""Facts readers must see uncommitted food and never borrow another connection or call AI."""
import datetime as dt
from app import db, food_thread_facts as facts, food_photo
uid=None; original_connect=db.connect; original_ask=food_photo.ask
try:
 with db.connect() as c:
  uid=c.execute("INSERT INTO users(login,name) VALUES ('zz_test_thread_transaction','Fictional facts') RETURNING id").fetchone()['id']
  c.execute("INSERT INTO profile(user_id,tz,kcal_target) VALUES (%s,'UTC',1800)",(uid,))
  c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g) VALUES (%s,current_date,'lunch','Fictional uncommitted soup',350,20)",(uid,))
  day=c.execute('SELECT current_date AS day').fetchone()['day']
  def forbidden(*args,**kwargs):raise AssertionError('Facts must not borrow another connection or call a model')
  db.connect=forbidden;food_photo.ask=forbidden
  try:
   snapshot=facts.snapshot(c,uid,day)
   assert snapshot['day']['totals']['kcal']==350
   assert any(e['name']=='Fictional uncommitted soup' for e in snapshot['day']['entries'])
   assert facts.answer(facts.classify('how many calories so far?',day),snapshot)['facts']['logged']==350
   assert '20 g' in facts.feedback(snapshot,tone='numbers')
  finally:db.connect=original_connect;food_photo.ask=original_ask
 print('Food facts: same-transaction uncommitted totals, no second pooled connection or model calls PASS')
finally:
 db.connect=original_connect;food_photo.ask=original_ask
 if uid:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
