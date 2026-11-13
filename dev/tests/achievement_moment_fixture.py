"""Seed one fictional weekly big-tier moment for the guarded Activity screenshot test."""
import datetime as dt
import json
from pathlib import Path
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
    fixture_data=json.loads((Path(__file__).resolve().parents[1] / 'screenshots' / 'fixture-time.json').read_text())
    occurred = dt.datetime.fromisoformat(fixture_data['instant'].replace('Z','+00:00')) - dt.timedelta(minutes=8)
    day = occurred.astimezone(zone).date()
    since = occurred - dt.timedelta(minutes=5)
    c.execute("DELETE FROM milestones WHERE user_id=%s AND code LIKE 'test-sharing:%%'", (owner_id,))
    c.execute('UPDATE profile SET share_achievements=true,share_achievements_since=%s WHERE user_id=%s',
              (since, owner_id))
    c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES
                 (%s,'test-sharing:journey-state','track_state','Journey',0,%s,%s,%s)''',
              (owner_id, day, occurred, Jsonb({'track':'journey','value_m':6800000,'label':'Journey','unit':'km'})))
    c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details) VALUES
                 (%s,'test-sharing:journey-big','track','Across the US',7,%s,%s,%s),
                 (%s,'test-sharing:climbing-big','track','Cruising altitude',10,%s,%s,%s)''',
              (owner_id, day, occurred, Jsonb({'track':'journey','rank':7,'threshold':4506163,'label':'Across the US','unit':'km','big':True}),
               owner_id, day, occurred, Jsonb({'track':'climbing','rank':10,'threshold':10668,'label':'Cruising altitude','unit':'m','big':True})))
    c.execute("UPDATE users SET name='River Friend 1 With a Long Fictional Name' WHERE id=%s", (owner_id,))
print('Fictional big-tier moment ready for the 390px Activity capture.')
