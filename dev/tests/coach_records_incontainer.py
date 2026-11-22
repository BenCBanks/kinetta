"""Deterministic SQL/RLS fixtures for personal_records; invoked by coach_records_checks.py."""
from unittest.mock import patch
from app import db
from app.coach_tools import AccountTools,FoodTools
from app.kit_tools import KitTools

with db.connect() as c:
    a=c.execute("SELECT id FROM users WHERE login='zz_test_records_a'").fetchone()['id']
    b=c.execute("SELECT id FROM users WHERE login='zz_test_records_b'").fetchone()['id']
    efforts=[
        (a,'run',1000,'Fictional 1k',400,'2024-01-01T12:00:00Z'),
        (a,'run',1000,'Fictional 1k',400,'2024-01-02T12:00:00Z'), # exact tie is not a record
        (a,'run',1000,'Fictional 1k',390,'2024-01-03T12:00:00Z'),
        (a,'run',1000,'Fictional 1k',405,'2024-01-04T12:00:00Z'), # slower than prior best
        (a,'run',1000,'Fictional 1k',380,'2024-01-05T12:00:00Z'),
        (a,'run',1609,'Fictional mile',500,'2024-01-01T13:00:00Z'),
        (a,'run',1609,'Fictional mile',480,'2024-01-04T13:00:00Z'),
        (a,'ride',1000,'Fictional 1k',450,'2024-01-01T14:00:00Z'),
        (a,'ride',1000,'Fictional 1k',440,'2024-01-06T14:00:00Z'),
        (a,'ride',1000,'Fictional 1k',440,'2024-01-07T14:00:00Z'), # tie is not a record
        (a,'walk',1000,'Fictional 1k',600,'2024-01-01T15:00:00Z'), # baseline only
        (b,'run',1000,'Fictional 1k B',100,'2024-01-01T12:00:00Z'),
        (b,'run',1000,'Fictional 1k B',90,'2024-01-02T12:00:00Z'),
    ]
    for uid,sport,distance,label,elapsed,stamp in efforts:
        activity=c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,distance_m,elapsed_s) VALUES(%s,%s,'Fictional records test',%s,'manual',%s,%s) RETURNING id",
            (uid,sport,stamp,distance,elapsed)).fetchone()['id']
        c.execute("INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) VALUES(%s,%s,%s,%s,%s,%s,%s)",
            (uid,activity,sport,distance,label,elapsed,stamp))

tool=AccountTools(a)
data=tool.call('personal_records',{'limit':2})
assert data['total_personal_records']==4 and data['returned_count']==2 and data['truncated']
assert [r['elapsed_s'] for r in data['records']]==[440.0,380.0]
with db.coach_connect(a) as c:
    assert c.execute('SHOW transaction_read_only').fetchone()['transaction_read_only']=='on'
    assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_coach'
    assert all(row['user_id']==a for row in c.execute('SELECT user_id FROM best_efforts').fetchall())
    assert tool.call('personal_records',{'limit':2},connection=c)==data
try:FoodTools(a).call('personal_records',{})
except ValueError:pass
else:raise AssertionError('Fitness records escaped food-only boundary')
with patch('app.coach.health_ok',return_value=False):
    try:KitTools(a).call('personal_records',{})
    except ValueError:pass
    else:raise AssertionError('Unconsented Health records disclosed')
with patch('app.coach.health_ok',return_value=True):
    assert KitTools(a).call('personal_records',{'limit':2})==data
print('Personal records SQL: fixed timestamps, strict improvements, sport/distance grouping, read-only RLS and consent PASS')
