"""Synthetic Resting Energy export, SQL isolation, AI consent and cascade deletion. No providers/devices."""
import datetime as dt
import json
import os
import secrets
import tempfile
import zipfile
import psycopg
from psycopg import sql
from app import api_mydata, coach, db

uids=[]
role='zz_test_resting_reader'
password=secrets.token_urlsafe(24)
try:
    with db.connect() as c:
        for login in ('zz_test_resting_db_a','zz_test_resting_db_b'):
            uid=c.execute('INSERT INTO users (login,name) VALUES (%s,%s) RETURNING id',(login,'Fictional energy')).fetchone()['id'];uids.append(uid)
            c.execute('INSERT INTO profile (user_id) VALUES (%s)',(uid,))
            assert c.execute('SELECT resting_source FROM profile WHERE user_id=%s',(uid,)).fetchone()['resting_source']=='formula'
            c.execute("UPDATE profile SET resting_source='apple_health' WHERE user_id=%s",(uid,))
            c.execute("INSERT INTO health_resting (user_id,tz,day,resting_kcal,observed_at) VALUES (%s,'UTC',current_date,%s,now())",(uid,1111 if len(uids)==1 else 2222))
        assert not coach.health_ok(c,uids[0]),'resting-derived balances require explicit Health AI consent even without workouts'
        c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(uids[0],));assert coach.health_ok(c,uids[0])
        c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
        c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
        c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,uids[0]))
    with psycopg.connect(db._conninfo(role,password),row_factory=psycopg.rows.dict_row) as reader:
        rows=reader.execute('SELECT resting_kcal FROM health_resting').fetchall();assert [r['resting_kcal'] for r in rows]==[1111],'SQL RLS must hide other account'
    with tempfile.TemporaryDirectory() as folder:
        name=os.path.join(folder,'own.zip');api_mydata._write_export(uids[0],name)
        with zipfile.ZipFile(name) as z:
            data=[json.loads(x) for x in z.read('data/health_resting.jsonl').splitlines()]
            assert len(data)==1 and data[0]['resting_kcal']==1111 and 'user_id' not in data[0]
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=%s',(uids[0],));assert not c.execute('SELECT 1 FROM health_resting WHERE user_id=%s',(uids[0],)).fetchone()
    print('PASS Resting Energy: default migration preference, SQL RLS, own-only export, Health AI consent and account cascade')
finally:
    with db.connect() as c:
        for uid in uids:c.execute('DELETE FROM users WHERE id=%s',(uid,))
        c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

# Apply the real upgrade to pre-existing profile rows in an isolated schema inside a rolled-back transaction.
with db.connect() as c:
    try:
        with c.transaction():
            c.execute('CREATE SCHEMA zz_test_resting_upgrade')
            c.execute('SET LOCAL search_path = zz_test_resting_upgrade, public')
            c.execute('CREATE TABLE users (id bigint PRIMARY KEY)')
            c.execute('CREATE TABLE profile (user_id bigint PRIMARY KEY REFERENCES users(id), kcal_target real, activity_factor real)')
            c.execute('INSERT INTO users VALUES (1)')
            c.execute('INSERT INTO profile VALUES (1, 1750, 1.45)')
            c.execute(db.MIGRATIONS[42])
            p=c.execute('SELECT * FROM profile WHERE user_id=1').fetchone()
            assert p['kcal_target']==1750 and abs(p['activity_factor']-1.45)<0.001 and p['resting_source']=='formula'
            assert c.execute("SELECT relrowsecurity FROM pg_class WHERE oid='health_resting'::regclass").fetchone()['relrowsecurity']
            raise RuntimeError('rollback synthetic upgrade')
    except RuntimeError as error:
        assert str(error)=='rollback synthetic upgrade'
print('PASS migration42→43 preserves existing calorie target/activity setting and defaults to calculated source')
