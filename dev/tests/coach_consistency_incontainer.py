"""Real storage with frozen local midnight; run by coach_consistency_checks.py."""
import datetime as dt
from unittest.mock import patch
from app import db
from app.coach_tools import AccountTools, FoodTools
from app.kit_tools import KitTools

with db.connect() as c:
    a=c.execute("SELECT id FROM users WHERE login='zz_test_consistency_a'").fetchone()['id']
    b=c.execute("SELECT id FROM users WHERE login='zz_test_consistency_b'").fetchone()['id']
    c.execute("UPDATE profile SET tz='America/New_York' WHERE user_id IN (%s,%s)",(a,b))
    pid=c.execute("""INSERT INTO training_plans(user_id,race,level,weeks,runs,long_day,start_day,race_day,unit,start_vol,created)
        VALUES(%s,'5k','beginner',6,3,6,'2024-06-03','2024-07-14','mi',6,'2024-06-05T04:00:00Z') RETURNING id""",(a,)).fetchone()['id']
    c.execute("INSERT INTO plan_marks(plan_id,user_id,day,done) VALUES(%s,%s,'2024-06-09',true)",(pid,a))
    c.execute("INSERT INTO plan_adjustments(plan_id,user_id,day,workout) VALUES(%s,%s,'2024-06-06',%s::jsonb)",
              (pid,a,'{"dist": 0.5, "type": "easy"}'))
    for uid,day,sport,opened in [(a,4,'run',False),(a,6,'run',False),(a,6,'run',False),
                                (a,8,'run',False),(a,9,'ride',False),(a,9,'run',True),
                                (a,10,'run',False),(a,12,'run',False),(b,9,'run',False)]:
        c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s,lift_open) VALUES(%s,%s,'Fictional attendance','manual',('2024-06-01'::date+%s+interval '12 hours') AT TIME ZONE 'America/New_York',1,1,%s)",
                  (uid,sport,day-1,opened))
    for uid,day in [(a,6),(a,6),(a,9),(a,10),(a,12),(b,8)]:
        c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES(%s,'2024-06-01'::date+%s,'Fictional log',0,0,%s::jsonb)",
                  (uid,day-1,'{"unknown_nutrients":["protein_g","kcal"]}'))
    for stamp in ('2020-03-08T04:59:59Z','2020-03-08T05:00:00Z','2020-03-09T03:59:59Z',
                  '2020-03-09T04:00:00Z','2020-11-01T04:00:00Z','2020-11-01T05:30:00Z',
                  '2020-11-01T06:30:00Z','2020-11-02T04:59:59Z','2020-11-02T05:00:00Z'):
        c.execute("INSERT INTO activities(user_id,sport,name,source,start_time) VALUES(%s,'run','DST attendance','manual',%s)",(a,stamp))
real_datetime=dt.datetime
class Clock(real_datetime):
    @classmethod
    def now(cls,tz=None): return moment.astimezone(tz)

args={'start':'2024-06-03','end':'2024-06-12'}
for stamp,today,finished,workouts,foods,due in [
    ('2024-06-10T03:59:59+00:00','2024-06-09',6,3,1,1),
    ('2024-06-10T04:00:00+00:00','2024-06-10',7,4,2,2)]:
    moment=real_datetime.fromisoformat(stamp)
    with patch('app.coach_tools.dt.datetime',Clock):
        result=AccountTools(a).call('consistency',args); plan=result['training_plan']
        assert result['today'].isoformat()==today and result['finished_days']==finished, result
        assert result['excluded_days']==10-finished and result['recorded_workout_days']==workouts, result
        assert result['food_log_days']==foods and result['unlogged_finished_days']==finished-foods, result
        assert plan['covered_days']==finished-2 and plan['scheduled_run_days']==due, plan
        assert plan['scheduled_days_with_recorded_run']==1 and plan['attendance_fraction']==1/due, plan
        assert result['food_plan']['expected_log_days'] is None and result['food_plan']['attendance_fraction'] is None
        # Another account's plan, workouts and food never enter these results.
        other=AccountTools(b).call('consistency',args)
        assert other['training_plan']['scheduled_run_days'] is None and other['training_plan']['attendance_fraction'] is None
        assert other['recorded_workout_days']==(1 if finished==7 else 0) and other['food_log_days']==1, other
        for dates in ({'start':'2024-06-03','end':'2024-06-04'}, {'start':'2024-08-01','end':'2024-08-07'}):
            absent=AccountTools(a).call('consistency',dates)
            assert absent['training_plan']['covered_days']==0 and absent['training_plan']['scheduled_run_days'] is None
        rest=AccountTools(a).call('consistency',{'start':'2024-06-05','end':'2024-06-05'})
        assert rest['training_plan']['scheduled_run_days']==0 and rest['training_plan']['attendance_fraction'] is None, rest
        future=AccountTools(a).call('consistency',{'start':'2024-06-10','end':'2024-06-12'})
        assert future['finished_days']==0 and future['excluded_days']==3 and future['recorded_workout_days']==future['food_log_days']==0
        empty=AccountTools(b).call('consistency',{'start':'2020-01-01','end':'2020-12-31'})
        assert empty['finished_days']==366 and empty['unlogged_finished_days']==366 and not empty['truncated']
        assert empty['training_plan']['attendance_fraction'] is None and empty['food_plan']['expected_log_days'] is None
        with db.coach_connect(a) as c:
            assert c.execute('SHOW transaction_read_only').fetchone()['transaction_read_only']=='on'
            assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_coach'
            for table in ('training_plans','plan_marks','plan_adjustments','activities','food_entries'):
                assert all(r['user_id']==a for r in c.execute('SELECT user_id FROM '+table).fetchall())
            assert AccountTools(a).call('consistency',args,connection=c)==result
        try: FoodTools(a).call('consistency',args)
        except ValueError: pass
        else: raise AssertionError('Food-only boundary escaped')
        with patch('app.coach.health_ok',return_value=False):
            try: KitTools(a).call('consistency',args)
            except ValueError: pass
            else: raise AssertionError('Unconsented Health disclosed')
        with patch('app.coach.health_ok',return_value=True): assert KitTools(a).call('consistency',args)==result
with db.connect() as c:
    assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_app'
    c.execute('UPDATE training_plans SET active=false WHERE id=%s',(pid,))
assert AccountTools(a).call('consistency',args)['training_plan']['scheduled_run_days'] is None
with db.connect() as c: c.execute('UPDATE training_plans SET active=true WHERE id=%s',(pid,))
for stamp,day in [('2020-03-09T04:00:00+00:00','2020-03-08'),('2020-11-02T05:00:00+00:00','2020-11-01')]:
    moment=real_datetime.fromisoformat(stamp)
    with patch('app.coach_tools.dt.datetime',Clock):
        result=AccountTools(a).call('consistency',{'start':day,'end':day})
        assert result['recorded_workout_days']==1 and result['finished_days']==1, result
        assert result['training_plan']['scheduled_run_days'] is None, result
print('Consistency fixed-clock SQL: attendance/creation/rest/manual/adjusted/absent-plan, RLS and consent PASS')
