"""New thread metadata stays private, exports cleanly and follows deletion rules."""
import json,os,secrets,tempfile,uuid,zipfile
import psycopg
from psycopg import sql
from app import db,api_mydata,food_thread_resolve as resolver
uids=[];attempt=None;role='zz_test_resolution_reader';password=secrets.token_urlsafe(24)
try:
 with db.connect() as c:
  messages=[]
  for i in range(2):
   uid=c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',('zz_test_resolution_sql_'+str(i),'Fictional private metadata')).fetchone()['id'];uids.append(uid)
   c.execute('INSERT INTO profile(user_id) VALUES (%s)',(uid,))
   mid=c.execute("""INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state)
                    VALUES (%s,%s,'user','Fictional private food',now(),current_date,'pending') RETURNING id""",(uid,uuid.uuid4())).fetchone()['id'];messages.append(mid)
   c.execute("INSERT INTO food_chat_aliases(user_id,key,templates) VALUES (%s,%s,'[]')",(uid,str(i)*64))
   c.execute("INSERT INTO food_chat_jobs(user_id,message_id,lease,expires,state,input_hash) VALUES (%s,%s,%s,now(),'failed',%s)",(uid,mid,uuid.uuid4(),'a'*64))
   c.execute('INSERT INTO food_chat_cancellations(user_id,client_id) VALUES (%s,%s)',(uid,uuid.uuid4()))
  food=c.execute("INSERT INTO custom_foods(user_id,name,kcal,origin,origin_notes,origin_model) VALUES (%s,'Fictional saved estimate',200,'ai','Assumed one bowl','stand-in') RETURNING id",(uids[0],)).fetchone()['id']
  c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
  c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
  c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uids[0]))
 with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
  for table in ('food_chat_aliases','food_chat_jobs','food_chat_cancellations'):
   rows=reader.execute(sql.SQL('SELECT * FROM {}').format(sql.Identifier(table))).fetchall()
   assert len(rows)==1 and rows[0]['user_id']==uids[0],table
   try:reader.execute(sql.SQL('DELETE FROM {}').format(sql.Identifier(table)))
   except psycopg.errors.InsufficientPrivilege:reader.rollback()
   else:raise AssertionError('Metadata SQL access must remain read-only')
 for query,args in [("INSERT INTO food_chat_jobs(user_id,message_id,lease,expires,state) VALUES (%s,%s,%s,now(),'failed')",(uids[0],messages[1],uuid.uuid4()))]:
  try:
   with db.connect() as c:c.execute(query,args)
  except psycopg.errors.ForeignKeyViolation:pass
  else:raise AssertionError('Job must belong to its parent message owner')
 with tempfile.TemporaryDirectory() as folder:
  path=os.path.join(folder,'export.zip');api_mydata._write_export(uids[0],path)
  with zipfile.ZipFile(path) as z:
   for table in ('food_chat_aliases','food_chat_jobs','food_chat_cancellations'):
    rows=[json.loads(line) for line in z.read('data/'+table+'.jsonl').splitlines()]
    assert len(rows)==1 and 'user_id' not in rows[0]
   foods=[json.loads(line) for line in z.read('data/custom_foods.jsonl').splitlines()]
   assert foods[0]['origin']=='ai' and foods[0]['origin_notes']=='Assumed one bowl'
 with db.connect() as c:
  assert resolver._alias(c,uids[0],[{'index':0,'text':'No matching phrase'}]) is None
  c.execute('DELETE FROM food_chat_messages WHERE id=%s AND user_id=%s',(messages[0],uids[0]))
  assert not c.execute('SELECT 1 FROM food_chat_jobs WHERE user_id=%s',(uids[0],)).fetchone()
  assert c.execute('SELECT 1 FROM custom_foods WHERE id=%s AND user_id=%s',(food,uids[0])).fetchone()
  assert c.execute('SELECT 1 FROM food_chat_cancellations WHERE user_id=%s',(uids[0],)).fetchone()
  attempt=uuid.uuid4()
  c.execute("INSERT INTO ai_service_budget(day) VALUES ((now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING")
  c.execute("UPDATE ai_service_budget SET charged_micros=charged_micros+100 WHERE day=(now() AT TIME ZONE 'UTC')::date")
  c.execute("""INSERT INTO ai_food_attempts(id,user_id,day,model,kind,reserved_micros,charged_micros,request_id)
                  VALUES (%s,%s,(now() AT TIME ZONE 'UTC')::date,'gemini-3.1-flash-lite','fictional deletion',100,100,%s)""",(attempt,uids[0],uuid.uuid4()))
  c.execute('DELETE FROM users WHERE id=%s',(uids[0],))
  bill=c.execute('SELECT user_id,request_id,charged_micros FROM ai_food_attempts WHERE id=%s',(attempt,)).fetchone()
  assert bill['user_id'] is None and bill['request_id'] is None and bill['charged_micros']==100
  for table in ('food_chat_aliases','food_chat_jobs','food_chat_cancellations'):
   assert not c.execute(sql.SQL('SELECT 1 FROM {} WHERE user_id=%s').format(sql.Identifier(table)),(uids[0],)).fetchone()
  assert c.execute('SELECT 1 FROM food_chat_jobs WHERE user_id=%s',(uids[1],)).fetchone()
 print('Food resolution SQL: real RLS/read-only identity, owner job FK, export, deleted text/job cascade, retained food/cancellation and account cascade PASS')
finally:
 with db.connect() as c:
  if attempt:
   old=c.execute('DELETE FROM ai_food_attempts WHERE id=%s RETURNING day,charged_micros',(attempt,)).fetchone()
   if old:c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros-%s WHERE day=%s',(old['charged_micros'],old['day']))
  c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
  c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
