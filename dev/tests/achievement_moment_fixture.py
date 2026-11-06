"""Seed one fictional weekly big-tier moment for the guarded Activity screenshot test."""
import datetime as dt
from zoneinfo import ZoneInfo

from psycopg.types.json import Jsonb

from app import db


with db.connect() as c:
    person = c.execute('''SELECT u.id,p.tz FROM users u JOIN profile p ON p.user_id=u.id
                          WHERE u.login='zz_test_feed_friend1' ''').fetchone()
    if not person:
        raise RuntimeError('Run the guarded activity fixture first.')
    owner_id = person['id']
    zone = ZoneInfo(person['tz'] or 'UTC')
    occurred = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=8)
    day = occurred.astimezone(zone).date()
    since = occurred - dt.timedelta(minutes=5)
    c.execute("DELETE FROM milestones WHERE user_id=%s AND code LIKE 'test-sharing:%%'", (owner_id,))
    c.execute('UPDATE profile SET share_achievements=true,share_achievements_since=%s WHERE user_id=%s',
              (since, owner_id))
    c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES
                 (%s,'test-sharing:journey-state','track_state','Journey',0,%s,%s,%s)''',
              (owner_id, day, occurred, Jsonb({'track':'journey','value_m':6800000,'label':'Journey','unit':'km'})))
    c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES
                 (%s,'test-sharing:journey-big','track','Across the US',1,%s,%s,%s),
                 (%s,'test-sharing:climbing-big','track','2 Everests',2,%s,%s,%s)''',
              (owner_id, day, occurred, Jsonb({'track':'journey','rank':1,'threshold':4500000,'label':'Across the US','unit':'km','big':True}),
               owner_id, day, occurred, Jsonb({'track':'climbing','rank':2,'threshold':17698,'label':'2 Everests','unit':'m','big':True})))
    c.execute("UPDATE users SET name='River Friend 1 With a Long Fictional Name' WHERE id=%s", (owner_id,))
print('Fictional big-tier moment ready for the 390px Activity capture.')
