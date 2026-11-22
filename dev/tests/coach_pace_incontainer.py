"""Fixed-clock SQL, coverage, consent and food-boundary checks for pace_vs_effort."""
import datetime as dt
from unittest.mock import patch
from app import db
from app.coach_tools import AccountTools, FoodTools
from app.kit_tools import KitTools

with db.connect() as c:
    a=c.execute("SELECT id FROM users WHERE login='zz_test_pace_a'").fetchone()['id']
    b=c.execute("SELECT id FROM users WHERE login='zz_test_pace_b'").fetchone()['id']
    c.execute("UPDATE profile SET tz='America/New_York' WHERE user_id IN (%s,%s)",(a,b))
    runs=[
        (a,'run','2026-03-07T23:30:00-05:00',5000,1500,1600,20),
        (a,'run','2026-03-08T00:20:00-05:00',5000,None,1800,25), # elapsed fallback across DST boundary
        (a,'run','2026-03-08T12:00:00-04:00',1000,300,300,None), # no effort
        (a,'run','2026-03-09T09:00:00-04:00',None,1000,1000,18), # no pace
        (a,'run','2026-03-10T10:00:00-04:00',1000,200,200,12), # current local date
        (a,'run','2026-03-11T10:00:00-04:00',1000,190,190,10), # future date
        (a,'ride','2026-03-08T09:00:00-04:00',10000,1200,1300,30),
        (b,'run','2026-03-08T08:00:00-04:00',5000,1400,1400,16),
    ]
    for uid,sport,stamp,distance,moving,elapsed,effort in runs:
        c.execute('''INSERT INTO activities(user_id,sport,name,start_time,source,distance_m,moving_s,elapsed_s,effort)
            VALUES(%s,%s,'Fictional pace fixture',%s,'manual',%s,%s,%s,%s)''',
            (uid,sport,stamp,distance,moving,elapsed,effort))

tool=AccountTools(a)
args={'start':'2026-03-07','end':'2026-03-12','limit':5}
with patch.object(AccountTools,'_local_today',return_value=dt.date(2026,3,10)):
    data=tool.call('pace_vs_effort',args)
assert data['requested_days']==6 and data['finished_days']==3 and data['excluded_days']==3,data
assert data['coverage']=={'run_count':4,'pace_known_count':3,'effort_known_count':3,'paired_count':2,
    'missing_pace_count':1,'missing_effort_count':1,'elapsed_time_fallbacks':1},data
assert data['samples']==[
    {'day':dt.date(2026,3,8),'pace_s_per_km':360.0,'effort':25.0},
    {'day':dt.date(2026,3,7),'pace_s_per_km':300.0,'effort':20.0}],data
assert data['truncated'] is False and data['returned_count']==2
assert all('name' not in row and 'activity_id' not in row for row in data['samples'])
with patch.object(AccountTools,'_local_today',return_value=dt.date(2026,3,7)):
    future=tool.call('pace_vs_effort',args)
assert future['finished_days']==0 and future['excluded_days']==6 and future['coverage']['run_count']==0,future
with patch.object(AccountTools,'_local_today',return_value=dt.date(2026,3,10)):
    limited=tool.call('pace_vs_effort',{**args,'limit':1})
assert limited['coverage']['paired_count']==2 and limited['returned_count']==1 and limited['truncated']
with patch.object(AccountTools,'_local_today',return_value=dt.date(2026,3,10)):
    with db.coach_connect(a) as c:
        assert c.execute('SHOW transaction_read_only').fetchone()['transaction_read_only']=='on'
        assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_coach'
        assert all(row['user_id']==a for row in c.execute("SELECT user_id FROM activities WHERE sport='run'").fetchall())
        scoped=tool.call('pace_vs_effort',args,connection=c)
        assert scoped==data,(scoped,data)
try:FoodTools(a).call('pace_vs_effort',args)
except ValueError:pass
else:raise AssertionError('Fitness pace/effort escaped food-only boundary')
with patch('app.coach.health_ok',return_value=False):
    try:KitTools(a).call('pace_vs_effort',args)
    except ValueError:pass
    else:raise AssertionError('Unconsented Health records disclosed')
with patch('app.coach.health_ok',return_value=True), patch.object(AccountTools,'_local_today',return_value=dt.date(2026,3,10)):
    assert KitTools(a).call('pace_vs_effort',args)==data
print('Pace/effort SQL: local DST boundary, today/future exclusion, missing values, fallback, read-only RLS and consent PASS')
