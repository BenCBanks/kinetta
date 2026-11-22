"""Daily trend SQL/coverage/privacy checks on fictional accounts; no providers."""
import math
import os
import subprocess
from kc import Client, PW, person


def run():
    project = os.environ['KINETTA_PROJECT']
    assert project == 'kinettatest' or project.startswith('kt-')
    a, b = person('zz_test_trend_a'), person('zz_test_trend_b')
    args = {'metric': 'distance_m', 'window': 7, 'end': '2021-03-17'}
    checks = 0

    def check(ok, message):
        nonlocal checks
        assert ok, message
        checks += 1

    def trend(client=a, **changes):
        status, result = client.post('/api/coach/tools', {'name': 'trend', 'arguments': {**args, **changes}})
        assert status == 200, (status, result)
        return result['data']

    def sql(body):
        subprocess.run(['docker', 'exec', '-i', project + '-app-1', 'python', '-'],
                       input=body, text=True, check=True)

    try:
        check(Client().post('/api/coach/tools', {'name': 'trend', 'arguments': args})[0] == 401, 'auth required')
        for invalid in ({'user_id': 1}, {'sql': 'SELECT * FROM users'}, {'metric': 'distance_m FROM users'},
                        {'window': 1}, {'window': 367}, {'window': True}, {'window': 7.5}, {'window': '7'},
                        {'end': '0001-01-01'}, {'end': 'not-a-date'}):
            check(a.post('/api/coach/tools', {'name': 'trend', 'arguments': {**args, **invalid}})[0] == 400,
                  f'invalid identity/SQL/metric/window/date rejected: {invalid}')
        empty = trend()
        check(empty['observed_days'] == 0 and empty['unknown_days'] == 7 and empty['slope_per_day'] is None,
              'empty measurements stay unknown; no invented flat slope')
        check(empty['uncertain'] and len(empty['uncertainty_reasons']) == 3, 'empty has undefined, sparse and missing flags')
        check(all(day['value'] is None for day in trend(metric='protein_g')['days']), 'unlogged food is unknown')
        check(all(day['value'] == 0 for day in trend(metric='workouts')['days']), 'zero means no recorded workouts only')
        check(trend(end='9999-12-31', window=366)['calendar_days'] == 366, 'max window and date do not overflow')
        check(trend(end='0001-01-02', window=2)['calendar_days'] == 2, 'earliest valid window is accepted')
        sql('''
import datetime as dt
from app import db
with db.connect() as c:
 a=c.execute("SELECT id FROM users WHERE login='zz_test_trend_a'").fetchone()['id']
 b=c.execute("SELECT id FROM users WHERE login='zz_test_trend_b'").fetchone()['id']
 c.execute("UPDATE profile SET tz='America/New_York' WHERE user_id IN (%s,%s)",(a,b))
 for i in range(7):
  day=dt.date(2021,3,11)+dt.timedelta(days=i)
  c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s,elapsed_s) VALUES(%s,'run','Fictional workout','manual',(%s::date+interval '12 hours') AT TIME ZONE 'America/New_York',%s,%s,%s)",
            (a,day,100*(i+1),None if i==2 else i*10,i*10 if i==2 else 999))
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,%s,'Fictional meal',%s,%s)",(a,day,100*(i+1),10*(i+1)))
 for uid,stamp,open_lift in [(a,'2021-03-11T04:59:59Z',False),(a,'2021-03-18T04:00:00Z',False),
                            (a,'2021-03-14T12:00:00Z',True),(b,'2021-03-14T12:00:00Z',False)]:
  c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s,lift_open) VALUES(%s,'run','Excluded fictional workout','manual',%s,99999,99999,%s)",(uid,stamp,open_lift))
 c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,'2021-03-14','Other account meal',9999,999)",(b,))
''')
        full = trend()
        check(full['timezone'] == 'America/New_York' and full['start'] == '2021-03-11', 'inclusive bound-account dates')
        check([d['value'] for d in full['days']] == [100, 200, 300, 400, 500, 600, 700],
              'exact own daily aggregates exclude foreign rows, unfinished lifting and both outside boundaries')
        check(full['slope_per_day'] == 100 and full['residual_rms'] == 0 and full['observed_span_days'] == 6,
              'least-squares uses calendar days across DST, not fixed 24-hour intervals')
        check(not full['uncertain'] and full['observed_days'] == 7 and not full['truncated'], 'complete straight series')
        duration = trend(metric='duration_s')
        check([d['value'] for d in duration['days']] == [0, 10, 20, 30, 40, 50, 60],
              'zero moving time stays zero; missing moving time uses elapsed')
        check(duration['slope_per_day'] == 10 and duration['duration_elapsed_fallbacks'] == 1, 'duration fallback exposed')
        check(trend(metric='protein_g')['slope_per_day'] == 10, 'protein slope from daily totals')
        check(trend(metric='kcal')['slope_per_day'] == 100, 'calorie slope from daily totals')
        constant = trend(metric='workouts')
        check(constant['slope_per_day'] == 0 and constant['residual_rms'] == 0 and not constant['uncertain'],
              'complete constant series has zero slope/residual and no uncertainty reasons')
        check(trend(b)['records'] == 1 and trend(b)['days'][3]['value'] == 99999, 'other account only sees own workout')
        check(trend(b, metric='protein_g')['days'][3]['value'] == 999, 'other account only sees own food')
        single = trend(b)
        check(single['observed_days'] == 1 and single['unknown_days'] == 6 and single['slope_per_day'] is None
              and single['residual_rms'] is None and single['observed_span_days'] is None,
              'single known day has undefined slope, residual and observed fit span')
        check('Slope is undefined with fewer than two known daily observations.' in single['uncertainty_reasons'],
              'single-day result explicitly explains why slope is undefined')
        sparse = trend(window=2)
        check(sparse['slope_per_day'] == 100 and sparse['uncertain'] and len(sparse['days']) == 2
              and sparse['start'] == '2021-03-16' and sparse['end'] == '2021-03-17',
              'minimum two-day window includes exactly its dates and has explicit sparse flag')
        sql('''
from app import db
from psycopg.types.json import Jsonb
from app.coach_tools import AccountTools, FoodTools
from app.kit_tools import KitTools
from unittest.mock import patch
with db.connect() as c:
 uid=c.execute("SELECT id FROM users WHERE login='zz_test_trend_a'").fetchone()['id']
args={'metric':'distance_m','window':7,'end':'2021-03-17'}
with db.coach_connect(uid) as c:
 before=c.execute('SELECT count(*) AS n FROM activities').fetchone()['n']
 assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_coach'
 assert c.execute('SHOW transaction_read_only').fetchone()['transaction_read_only']=='on'
 assert all(row['user_id']==uid for row in c.execute('SELECT user_id FROM activities').fetchall())
 assert all(row['user_id']==uid for row in c.execute('SELECT user_id FROM food_entries').fetchall())
 result=AccountTools(uid).call('trend',args,connection=c)
 assert result['slope_per_day']==100
 assert c.execute('SELECT count(*) AS n FROM activities').fetchone()['n']==before
try: FoodTools(uid).call('trend',args)
except ValueError: pass
else: raise AssertionError('Trend escaped food-only boundary')
with patch('app.coach.health_ok',return_value=False):
 try: KitTools(uid).call('trend',args)
 except ValueError: pass
 else: raise AssertionError('Unconsented Health trend disclosed')
with patch('app.coach.health_ok',return_value=True):
 assert KitTools(uid).call('trend',args)==result
with db.connect() as c:
 assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_app'
 c.execute("INSERT INTO activities(user_id,sport,name,source,start_time) VALUES(%s,'run','Missing measurement','manual','2021-03-13T12:00:00Z')",(uid,))
 for day,value in [('2021-03-12',0),('2021-03-14',999)]:
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES(%s,%s,'Unknown nutrient',%s,%s,%s)",
            (uid,day,value,value,Jsonb({'unknown_nutrients':['protein_g','kcal']})))
 c.execute("DELETE FROM food_entries WHERE user_id=%s AND day='2021-03-15'",(uid,))
 for i,value in enumerate([0,100,0,100,0,100,0]):
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,'2001-01-01'::date+%s,'Variable meal',100,%s)",(uid,i,value))
 for i,value in enumerate([100,100,100,1000,100,100,100]):
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,'2003-01-01'::date+%s,'Outlier fixture',100,%s)",(uid,i,value))
 c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) SELECT %s,'2020-01-01'::date+i,'Leap-year fixture',200,10+2*i FROM generate_series(0,365) AS i",(uid,))
 for stamp,distance in [
  ('2020-03-08T04:59:59Z',9999),('2020-03-08T05:00:00Z',100),('2020-03-09T03:59:59Z',200),
  ('2020-03-09T04:00:00Z',400),('2020-03-10T03:59:59Z',500),('2020-03-10T04:00:00Z',9999),
  ('2020-11-01T03:59:59Z',9999),('2020-11-01T04:00:00Z',100),('2020-11-02T04:59:59Z',200),
  ('2020-11-02T05:00:00Z',400),('2020-11-03T04:59:59Z',500),('2020-11-03T05:00:00Z',9999),
  ('2020-11-01T05:30:00Z',50),('2020-11-01T06:30:00Z',50)]:
  c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s) VALUES(%s,'run','DST edge fixture','manual',%s,%s,10)",(uid,stamp,distance))
 c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s) SELECT %s,'run','Many fictional workouts','manual','2002-01-01T12:00:00Z',10,20 FROM generate_series(1,105)",(uid,))
''')
        check(True, 'real read-only/RLS identity, no writes, role restoration, Health consent and food-only guards')
        missing = trend()
        check(missing['days'][2]['value'] is None and missing['days'][2]['known_total'] == 300
              and missing['days'][2]['unknown_measurements'] == 1, 'partial activity day excluded, subtotal retained')
        check(math.isclose(missing['slope_per_day'], 100, rel_tol=1e-12) and missing['unknown_days'] == 1,
              f'calendar spacing is not compressed over gap: {missing}')
        for metric, factor in [('protein_g', 1), ('kcal', 10)]:
            food = trend(metric=metric)
            check([d['value'] for d in food['days']] == [10*factor, None, 30*factor, None, None, 60*factor, 70*factor],
                  f'{metric} unknown flags override zero and nonzero; unlogged day is not zero')
            check(math.isclose(food['slope_per_day'], 10*factor, rel_tol=1e-12) and food['unknown_days'] == 3 and food['uncertain'],
                  f'{metric} observed-day fit retains missing/partial coverage flags: {food}')
        variable = trend(metric='protein_g', end='2001-01-07')
        check(variable['slope_per_day'] == 0 and variable['uncertain'] and len(variable['uncertainty_reasons']) == 1,
              'complete variable series is flagged even when fitted slope is zero')
        check(math.isclose(variable['residual_rms'], math.sqrt(120000/49)), 'variation is deterministic RMS residual')
        outlier = trend(metric='protein_g', end='2003-01-07')
        check([d['value'] for d in outlier['days']] == [100,100,100,1000,100,100,100]
              and outlier['slope_per_day'] == 0 and outlier['observed_days'] == 7, 'outlier is retained, not trimmed away')
        check(outlier['uncertain'] and outlier['uncertainty_reasons'] == [
              'Daily variation around the fitted line exceeds its end-to-end change.']
              and math.isclose(outlier['residual_rms'], 900*math.sqrt(6)/7), 'outlier triggers the visible variation rule')
        year = trend(metric='protein_g', window=366, end='2020-12-31')
        check(len(year['days']) == year['observed_days'] == year['records'] == 366
              and year['start'] == '2020-01-01' and year['days'][59]['day'] == '2020-02-29',
              'maximum 366-day window includes the whole leap year without truncation')
        check(year['days'][0]['value'] == 10 and year['days'][-1]['value'] == 740
              and year['slope_per_day'] == 2 and not year['uncertain'] and not year['truncated'],
              '366-day fit preserves exact aggregate values and slope')
        for end,values,slope in [('2020-03-09',[300,900],600),('2020-11-02',[400,900],500)]:
            dst = trend(window=2, end=end)
            check([d['value'] for d in dst['days']] == values and dst['slope_per_day'] == slope,
                  f'{end}: 23/25-hour DST day boundaries and repeated hour use local calendar dates: {dst}')
        many = trend(end='2002-01-02', window=2)
        check(many['records'] == 105 and many['days'][0]['value'] == 1050 and not many['truncated'],
              'daily aggregates include every record beyond a page limit')
        check(trend(metric='workouts', end='2002-01-02', window=2)['slope_per_day'] == -105,
              'negative recorded-count slope computed exactly')
        print(f'Trend: {checks} SQL/schema/privacy checks PASS; no providers')
    finally:
        a.post('/api/account/delete', {'password': PW})
        b.post('/api/account/delete', {'password': PW})


if __name__ == '__main__':
    run()
