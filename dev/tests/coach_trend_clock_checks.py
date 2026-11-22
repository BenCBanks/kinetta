"""Executed inside the disposable server; real SQL with a frozen account-local clock."""
import datetime as dt
from unittest.mock import patch
from app import db
from app.coach_tools import AccountTools

with db.connect() as c:
    uid = c.execute("SELECT id FROM users WHERE login='zz_test_trend_a'").fetchone()['id']
    for i in range(1, 4):
        day = dt.date(2024, 6, i)
        c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s) VALUES(%s,'run','Fractional fixture','manual',(%s::date+interval '12 hours') AT TIME ZONE 'America/New_York',%s,%s)", (uid,day,10.25*i,1.25*i))
        c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,%s,'Fractional meal',%s,%s)", (uid,day,100.125*i,1.25*i))
real_datetime = dt.datetime
class Clock(real_datetime):
    @classmethod
    def now(cls, tz=None):
        return moment.astimezone(tz)

tools = AccountTools(uid)
for stamp, today, observed, excluded in [('2024-06-04T03:59:59+00:00','2024-06-03',2,1),
                                        ('2024-06-04T04:00:00+00:00','2024-06-04',3,0)]:
    moment = real_datetime.fromisoformat(stamp)
    with patch('app.coach_tools.dt.datetime', Clock):
        for metric, slope in [('distance_m',10.25),('duration_s',1.25),('protein_g',1.25),('kcal',100.125),('workouts',0)]:
            result = tools.call('trend', {'metric':metric,'window':3,'end':'2024-06-03'})
            assert result['today'].isoformat() == today and result['observed_days'] == observed, result
            assert result['excluded_days'] == excluded and result['unknown_days'] == 0, result
            assert result['slope_per_day'] == slope, result
            assert result['days'][-1]['excluded'] == bool(excluded), result
            if excluded:
                assert result['days'][-1]['value'] is None and result['days'][-1]['known_total'] is not None, result
            mixed = tools.call('trend', {'metric':metric,'window':6,'end':'2024-06-06'})
            assert mixed['excluded_days'] == excluded+3 and mixed['observed_days'] == observed, mixed
            assert mixed['slope_per_day'] == slope and mixed['uncertain'], mixed
            future = tools.call('trend', {'metric':metric,'window':7,'end':'2024-06-12'})
            assert future['excluded_days'] == 7 and future['observed_days'] == future['unknown_days'] == 0, future
            assert future['slope_per_day'] is None and future['uncertain'], future
            assert all(d['value'] is None and d['known_total'] is None for d in future['days']), future
        zero = tools.call('trend', {'metric':'workouts','window':7,'end':'2024-05-07'})
        assert zero['excluded_days'] == 0 and zero['slope_per_day'] == 0 and not zero['uncertain'], zero
        for start, end in [('2024-06-01','2024-06-03'),('2024-06-01','2024-06-06'),('2024-06-06','2024-06-12')]:
            if end >= today:
                try: tools.call('period_compare', {'start':start,'end':end})
                except ValueError as error: assert 'completed account-local days' in str(error)
                else: raise AssertionError('Partial/future period was compared with a completed period')
            else:
                result = tools.call('period_compare', {'start':start,'end':end})
                assert result['current']['totals']['distance_m'] == 61.5, result
print('Frozen local midnight: all five metrics exclude unfinished/future days; finished zero workouts and period guard PASS')
