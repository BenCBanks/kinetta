"""Fixed-date period comparisons on two disposable accounts; real SQL/RLS, no providers."""
import os
import subprocess
from kc import Client, PW, person


def run():
    project = os.environ['KINETTA_PROJECT']
    assert project == 'kinettatest' or project.startswith('kt-')
    a, b = person('zz_test_period_a'), person('zz_test_period_b')
    args = {'start': '2004-03-01', 'end': '2004-03-03'}
    checks = 0

    def check(ok, message):
        nonlocal checks
        assert ok, message
        checks += 1

    def compare(client=a, dates=None):
        status, result = client.post('/api/coach/tools', {'name': 'period_compare', 'arguments': dates or args})
        assert status == 200, (status, result)
        return result['data']

    def sql(body):
        subprocess.run(['docker', 'exec', '-i', project + '-app-1', 'python', '-'],
                       input=body, text=True, check=True)

    try:
        check(Client().post('/api/coach/tools', {'name': 'period_compare', 'arguments': args})[0] == 401, 'auth required')
        for invalid in ({**args, 'user_id': 1}, {**args, 'sql': 'SELECT * FROM users'},
                        {'start': '2004-03-03', 'end': '2004-03-01'},
                        {'start': '2003-01-01', 'end': '2004-01-02'},
                        {'start': '0001-01-01', 'end': '0001-01-01'}):
            check(a.post('/api/coach/tools', {'name': 'period_compare', 'arguments': invalid})[0] == 400,
                  'identity, SQL, reversed, excessive and underflow ranges are rejected')
        empty = compare()
        check(empty['current']['totals'] == {'workouts': 0, 'distance_m': None, 'duration_s': None, 'protein_g': None},
              'empty means no recorded workouts; missing measurements/intake are unknown')
        check(empty['change']['workouts'] == {'absolute': 0, 'percent': None}, 'zero baseline has no percentage')
        check(all(empty['change'][k]['absolute'] is None for k in ('distance_m', 'duration_s', 'protein_g')),
              'no invented change from absent data')
        maximum = compare(dates={'start': '2008-01-01', 'end': '2008-12-31'})
        check(maximum['current']['calendar_days'] == maximum['previous']['calendar_days'] == 366,
              'maximum supported range stays bounded across leap year')
        sql('''
from app import db
with db.connect() as c:
 a=c.execute("SELECT id FROM users WHERE login='zz_test_period_a'").fetchone()['id']
 b=c.execute("SELECT id FROM users WHERE login='zz_test_period_b'").fetchone()['id']
 c.execute("UPDATE profile SET tz='Pacific/Kiritimati' WHERE user_id IN (%s,%s)",(a,b))
 for uid,stamp,sport,distance,moving,elapsed,open_lift in [
  (a,'2004-02-26T10:00:00Z','run',1000,100,120,False),
  (a,'2004-02-29T09:59:59Z','ride',2000,200,220,False),
  (a,'2004-02-29T10:00:00Z','run',3000,300,310,False),
  (a,'2004-03-02T12:00:00Z','walk',4000,None,400,False),
  (a,'2004-03-03T10:00:00Z','run',99999,9999,9999,False),
  (a,'2004-02-26T09:59:59Z','run',99999,9999,9999,False),
  (a,'2004-03-01T12:00:00Z','strength',99999,9999,9999,True),
  (b,'2004-03-01T12:00:00Z','run',99000,9900,9900,False)]:
  c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s,elapsed_s,lift_open) VALUES(%s,%s,'Fictional workout','manual',%s,%s,%s,%s,%s)",(uid,sport,stamp,distance,moving,elapsed,open_lift))
 for day,protein in [('2004-02-27',10),('2004-02-28',20),('2004-02-29',30),('2004-03-01',20),('2004-03-02',40),('2004-03-03',60)]:
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,%s,'Fictional meal',400,%s)",(a,day,protein))
 c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,'2004-03-01','Other fictional meal',9999,999)",(b,))
''')
        result = compare()
        check(result['timezone'] == 'Pacific/Kiritimati', 'bound account timezone')
        check(result['previous']['start'] == '2004-02-27' and result['previous']['end'] == '2004-02-29',
              'preceding equal period crosses leap day correctly')
        check(result['current']['calendar_days'] == result['previous']['calendar_days'] == 3, 'inclusive equal dates')
        check(result['current']['totals'] == {'workouts': 2, 'distance_m': 7000, 'duration_s': 700, 'protein_g': 120},
              'all sports, local midnight bounds, own totals, completed lifting only, elapsed fallback')
        check(result['previous']['totals'] == {'workouts': 2, 'distance_m': 3000, 'duration_s': 300, 'protein_g': 60},
              'previous period includes its final local second, excludes preceding local day')
        check(result['current']['duration_elapsed_fallbacks'] == 1, 'fallback is explicit')
        check(result['change']['protein_g'] == {'absolute': 60, 'percent': 100}, 'protein arithmetic from fully logged days')
        check(result['change']['distance_m'] == {'absolute': 4000, 'percent': 133.33}, 'distance arithmetic')
        other = compare(b)
        check(other['current']['totals']['distance_m'] == 99000 and other['current']['known_totals']['protein_g'] == 999,
              'second account never sees first account history')
        check(other['current']['totals']['protein_g'] is None and other['change']['protein_g']['absolute'] is None,
              'partial logging cannot become a full-period comparison')
        sql('''
from app import db
from psycopg.types.json import Jsonb
from app.coach_tools import AccountTools, FoodTools
from app.kit_tools import KitTools
from unittest.mock import patch
with db.connect() as c:
 uid=c.execute("SELECT id FROM users WHERE login='zz_test_period_a'").fetchone()['id']
args={'start':'2004-03-01','end':'2004-03-03'}
with db.coach_connect(uid) as c:
 before=c.execute('SELECT count(*) AS n FROM activities').fetchone()['n']
 assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_coach'
 result=AccountTools(uid).call('period_compare',args,connection=c)
 assert result['current']['totals']['distance_m']==7000
 assert c.execute('SELECT count(*) AS n FROM activities').fetchone()['n']==before
 assert all(r['user_id']==uid for r in c.execute('SELECT user_id FROM activities').fetchall())
try: FoodTools(uid).call('period_compare',args)
except ValueError: pass
else: raise AssertionError('Food-only boundary escaped')
with patch('app.coach.health_ok',return_value=False):
 try: KitTools(uid).call('period_compare',args)
 except ValueError: pass
 else: raise AssertionError('Unconsented Health comparison disclosed')
with patch('app.coach.health_ok',return_value=True):
 assert KitTools(uid).call('period_compare',args)==result
with db.connect() as c:
 assert c.execute('SELECT current_user AS role').fetchone()['role']=='fit_app'
 c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES(%s,'2004-03-01','Unknown protein',10,0,%s)",(uid,Jsonb({"unknown_nutrients":["protein_g"]})))
 c.execute("INSERT INTO activities(user_id,sport,name,source,start_time) VALUES(%s,'run','Missing measurements','manual','2004-03-01T12:00:00Z')",(uid,))
''')
        missing = compare()['current']
        check(missing['totals'] == {'workouts': 3, 'distance_m': None, 'duration_s': None, 'protein_g': None},
              'unknown nutrient flags and missing activity measurements invalidate full totals')
        check(missing['known_totals'] == {'distance_m': 7000, 'duration_s': 700, 'protein_g': 120}, 'known subtotals preserved')
        check(missing['unknown_measurement_counts'] == {'distance_m': 1, 'duration_s': 1, 'protein_g': 1}, 'coverage is explicit')
        sql('''
from app import db
from psycopg.types.json import Jsonb
with db.connect() as c:
 uid=c.execute("SELECT id FROM users WHERE login='zz_test_period_a'").fetchone()['id']
 c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g,ref) VALUES(%s,'2004-03-02','Unknown nonzero protein',10,999,%s)",(uid,Jsonb({'unknown_nutrients':['protein_g']})))
 c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m,moving_s) SELECT %s,'run','Fictional repeated workout','manual','2005-01-01T12:00:00Z',10,20 FROM generate_series(1,105)",(uid,))
 for day,protein in [("2006-01-01",0),("2006-01-02",10)]:
  c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,%s,'Known protein',10,%s)",(uid,day,protein))
''')
        check(compare()['current']['unknown_measurement_counts']['protein_g'] == 2, 'unknown flags override both zero and nonzero stored protein')
        many = compare(dates={'start': '2005-01-02', 'end': '2005-01-02'})
        check(many['current']['totals']['workouts'] == 105 and many['current']['totals']['distance_m'] == 1050,
              'aggregates include more than a page of records')
        check(not many['truncated'] and not many['current']['truncated'] and not many['previous']['truncated'],
              'complete aggregates explicitly report no truncation')
        check(many['current']['food_unlogged_days'] == 1 and many['current']['known_totals']['protein_g'] is None,
              'empty food range is unknown, not zero')
        zero = compare(dates={'start': '2006-01-02', 'end': '2006-01-02'})
        check(zero['previous']['totals']['protein_g'] == 0 and zero['change']['protein_g'] == {'absolute': 10, 'percent': None},
              'a known zero is valid evidence but not a percentage denominator')
        print(f'Period comparison: {checks} SQL/schema/privacy checks PASS; no providers')
    finally:
        a.post('/api/account/delete', {'password': PW})
        b.post('/api/account/delete', {'password': PW})


if __name__ == '__main__':
    run()
