"""Frozen account-local clock and SQL fixtures for nutrition_adequacy."""
import datetime as dt
from unittest.mock import patch
from app import db
from app.coach_tools import AccountTools,FoodTools
from app.kit_tools import KitTools

with db.connect() as c:
    a=c.execute("SELECT id FROM users WHERE login='zz_test_adequacy_a'").fetchone()['id']
    b=c.execute("SELECT id FROM users WHERE login='zz_test_adequacy_b'").fetchone()['id']
    c.execute("UPDATE profile SET tz='America/New_York',kcal_target=2000,protein_target=100 WHERE user_id=%s",(a,))
    c.execute("UPDATE profile SET tz='America/New_York',kcal_target=NULL,protein_target=NULL WHERE user_id=%s",(b,))
    rows=[(a,'2024-06-01',0,0,'[]'),(a,'2024-06-02',500,25,'[]'),
          (a,'2024-06-03',1000,50,'[]'),(a,'2024-06-03',250,999,'["protein_g"]'),
          (a,'2024-06-04',1200,80,'["kcal"]'),(a,'2024-06-05',1300,125,'[]'),
          (a,'2024-06-06',99999,99999,'[]'),(a,'2024-01-01',100,0.1,'[]'),
          (b,'2024-06-02',9999,999,'[]')]
    for uid,day,kcal,protein,flags in rows:
        c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES(%s,%s,'Fictional adequacy fixture',%s,%s,jsonb_build_object('unknown_nutrients',%s::jsonb))",
                  (uid,day,kcal,protein,flags))
    c.execute("INSERT INTO day_goals(user_id,day,kcal) VALUES(%s,'2024-06-05',1200),(%s,'2024-06-06',0)",(a,a))
real_datetime=dt.datetime
class Clock(real_datetime):
    @classmethod
    def now(cls,tz=None): return moment.astimezone(tz)

tool=AccountTools(a)
for stamp,today,excluded in [('2024-06-07T03:59:59+00:00','2024-06-06',1),
                             ('2024-06-07T04:00:00+00:00','2024-06-07',0)]:
    moment=real_datetime.fromisoformat(stamp)
    with patch('app.coach_tools.dt.datetime',Clock):
        data=tool.call('nutrition_adequacy',{'start':'2024-06-01','end':'2024-06-06'})
        assert data['today'].isoformat()==today and data['excluded_days']==excluded, data
        assert data['finished_days']==6-excluded and data['logged_days']==6-excluded, data
        assert data['days'][5]['excluded'] == bool(excluded)
        if excluded:
            assert data['days'][5]['kcal']['logged_total'] is None and data['days'][5]['protein_g']['logged_total'] is None
        else:
            assert data['days'][5]['kcal']['logged_total']==99999 and data['days'][5]['protein_g']['logged_total']==99999
            assert data['days'][5]['kcal']['target']==0 and data['days'][5]['kcal']['difference']==99999
            assert data['days'][5]['kcal']['target_ratio'] is None
        assert data['summary']['kcal']['full_range_comparable'] is False
        before=tool.call('nutrition_adequacy',{'start':'2024-06-02','end':'2024-06-03'})
        assert before['summary']['kcal']['full_range_comparable'] and before['summary']['kcal']['full_range_difference']==-2250
        assert before['summary']['protein_g']['full_range_comparable'] is False
        assert before['summary']['protein_g']['full_range_difference'] is None
        if excluded:
            assert data['summary']['kcal']['comparable_days']==4
            assert data['summary']['kcal']['comparable_day_subtotal']==3050
        with db.coach_connect(a) as c:
            assert c.execute('SHOW transaction_read_only').fetchone()['transaction_read_only']=='on'
            assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_coach'
            assert all(row['user_id']==a for row in c.execute('SELECT user_id FROM food_entries').fetchall())
            assert tool.call('nutrition_adequacy',{'start':'2024-06-01','end':'2024-06-06'},connection=c)==data
        with patch('app.coach_tools.dt.datetime',Clock):
            assert FoodTools(a).call('nutrition_adequacy',{'start':'2024-06-01','end':'2024-06-06'})==data
            with patch('app.coach.health_ok',return_value=False):
                assert KitTools(a).call('nutrition_adequacy',{'start':'2024-06-01','end':'2024-06-06'})==data
        full=tool.call('nutrition_adequacy',{'start':'2024-06-01','end':'2024-06-01'})
        assert full['summary']['kcal']['full_range_comparable'] and full['summary']['protein_g']['full_range_comparable']
        assert full['summary']['kcal']['full_range_difference']==-2000
        assert full['summary']['protein_g']['full_range_target_ratio']==0
        missing_target=KitTools(b).call('nutrition_adequacy',{'start':'2024-06-02','end':'2024-06-02'})
        assert missing_target['days'][0]['kcal']['comparable'] is False and missing_target['days'][0]['protein_g']['comparable'] is False
with db.connect() as c:
    assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_app'
    assert c.execute("SELECT nullif(current_setting('kinetta.coach_user_id',true),'') AS uid").fetchone()['uid'] is None
print('Nutrition adequacy SQL: fixed midnight, goals, zero/unknown/partial, period coverage, RLS and consent PASS')
