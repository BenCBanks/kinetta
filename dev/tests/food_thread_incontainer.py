"""Thread SQL privacy, owner-bound food/reply links, export and account cascade. No AI."""
import datetime as dt
import json
import os
import secrets
import tempfile
import uuid
import zipfile
import psycopg
from psycopg import sql
from app import db, api_mydata

uids=[]; role='zz_test_thread_reader'; password=secrets.token_urlsafe(24)
def message(c, uid, text, **extra):
    return c.execute('''INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state,reply_to)
                        VALUES (%s,%s,%s,%s,now(),current_date,%s,%s) RETURNING id''',
                     (uid,uuid.uuid4(),extra.get('kind','user'),text,extra.get('state','pending'),extra.get('reply_to'))).fetchone()['id']
try:
    with db.connect() as c:
        for label in ('a','b'):
            uid=c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',('zz_test_thread_db_'+label,'Fictional thread')).fetchone()['id'];uids.append(uid)
            c.execute('INSERT INTO profile(user_id) VALUES (%s)',(uid,))
        ma=message(c,uids[0],'Fictional private oats');mb=message(c,uids[1],'Other fictional soup')
        ea=c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal) VALUES (%s,current_date,'lunch','Fictional oats',400) RETURNING id",(uids[0],)).fetchone()['id']
        eb=c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal) VALUES (%s,current_date,'lunch','Other fictional soup',300) RETURNING id",(uids[1],)).fetchone()['id']
        c.execute('INSERT INTO food_chat_entries VALUES (%s,%s,%s)',(uids[0],ma,ea))
        reply=message(c,uids[0],'Fictional oats logged',kind='reply',state='answered',reply_to=ma)
        c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
        c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
        c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uids[0]))
    with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
        assert len(reader.execute('SELECT * FROM food_chat_messages').fetchall())==2
        assert [r['entry_id'] for r in reader.execute('SELECT * FROM food_chat_entries')]==[ea]
        try:reader.execute("DELETE FROM food_chat_messages")
        except psycopg.errors.InsufficientPrivilege:reader.rollback()
        else:raise AssertionError('Personal SQL role must remain read-only')
    for query,args in [('INSERT INTO food_chat_entries VALUES (%s,%s,%s)',(uids[0],ma,eb)),
                       ('INSERT INTO food_chat_entries VALUES (%s,%s,%s)',(uids[0],mb,ea))]:
        try:
            with db.connect() as c:c.execute(query,args)
        except psycopg.errors.ForeignKeyViolation:pass
        else:raise AssertionError('Cross-account links must be rejected by the database')
    try:
        with db.connect() as c:message(c,uids[1],'Wrong reply owner',kind='reply',state='answered',reply_to=ma)
    except psycopg.errors.ForeignKeyViolation:pass
    else:raise AssertionError('Replies must belong to the parent owner')
    with tempfile.TemporaryDirectory() as folder:
        path=os.path.join(folder,'export.zip');api_mydata._write_export(uids[0],path)
        with zipfile.ZipFile(path) as z:
            messages=[json.loads(row) for row in z.read('data/food_chat_messages.jsonl').splitlines()]
            links=[json.loads(row) for row in z.read('data/food_chat_entries.jsonl').splitlines()]
            assert len(messages)==2 and len(links)==1
            assert all('user_id' not in row for row in messages+links)
    with db.connect() as c:
        c.execute('DELETE FROM food_chat_messages WHERE id=%s AND user_id=%s',(ma,uids[0]))
        assert not c.execute('SELECT * FROM food_chat_messages WHERE user_id=%s',(uids[0],)).fetchall()
        assert not c.execute('SELECT * FROM food_chat_entries WHERE user_id=%s',(uids[0],)).fetchall()
        assert c.execute('SELECT * FROM food_entries WHERE id=%s',(ea,)).fetchone(), 'message deletion keeps the food log'
        mc=message(c,uids[0],'Fictional weight question')
        c.execute('DELETE FROM users WHERE id=%s',(uids[0],))
        assert not c.execute('SELECT * FROM food_chat_messages WHERE user_id=%s',(uids[0],)).fetchall()
        assert c.execute('SELECT * FROM food_chat_messages WHERE id=%s',(mb,)).fetchone()
    print('Food thread SQL: RLS/read-only, composite owner links/replies, export, message deletion and account cascade PASS')
finally:
    with db.connect() as c:
        for uid in uids:c.execute('DELETE FROM users WHERE id=%s',(uid,))
        c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
