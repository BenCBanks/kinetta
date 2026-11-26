"""Real disposable SQL/Python date, profile and memory timestamp proof; no network."""
import datetime as dt
import os
from app import db, coach_tools, kit_tools, kit_memory, progress_series
from kit_fixture_clock import install,INSTANT
os.environ['KINETTA_KIT_EVAL_ISOLATED']='1'
install(db)
assert coach_tools.AccountTools(1)._local_today('UTC')==INSTANT.date()
assert progress_series.dt.datetime.now(dt.timezone.utc)==INSTANT
from uuid import uuid4
uid=None
try:
    with db.connect() as c:
        row=c.execute('SELECT now() AS n,pg_catalog.now() AS real').fetchone()
        assert row['n']==INSTANT
        uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',('zz_test_clock_'+uuid4().hex,'Fictional clock')).fetchone()['id']
        c.execute("INSERT INTO profile(user_id,tz,health_ai_ok) VALUES(%s,'America/Los_Angeles',true)",(uid,))
        assert c.execute('SELECT created FROM users WHERE id=%s',(uid,)).fetchone()['created']==INSTANT
        c.execute("INSERT INTO kit_memories(user_id,text,kind,source) VALUES(%s,'I prefer mornings.','routine','user')",(uid,))
        assert c.execute('SELECT updated FROM kit_memories WHERE user_id=%s',(uid,)).fetchone()['updated']==INSTANT
    assert kit_tools.KitTools(uid).call('profile',{})['today']==INSTANT.date()
    with db.coach_connect(uid) as c:assert c.execute('SELECT now() AS n').fetchone()['n']==INSTANT
finally:
    if uid:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
print('Pinned clock: Python, actual SQL, defaults, memory timestamps, profile and coach-role reads PASS; zero provider calls')
