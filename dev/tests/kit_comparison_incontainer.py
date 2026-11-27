"""Fictional SQL/RLS/source-consent contracts. No provider, endpoint or real account."""
import datetime as dt
import json
import unittest
from unittest.mock import patch
from psycopg import errors
from pydantic import ValidationError
from app import db
from app.coach_tools import ComparisonRange
from app.kit_comparison import Compare, OwnComparison

DATES = {'start': '2004-03-01', 'end': '2004-03-03'}


class CalendarValidation(unittest.TestCase):
    def test_calendar_underflow_is_value_error_before_database_access(self):
        for start, end in [('0001-01-01', '0001-01-01'),
                           ('0001-01-02', '0001-01-03'),
                           ('0001-12-31', '0002-12-31')]:
            with self.subTest(start=start, end=end), patch.object(db, 'coach_connect') as connect:
                with self.assertRaises(ValueError):
                    OwnComparison(1).read({'start': start, 'end': end, 'metric': 'workouts'})
                connect.assert_not_called()

    def test_unknown_fields_are_forbidden_by_both_range_models(self):
        for model in [ComparisonRange, Compare]:
            self.assertEqual(model.model_config['extra'], 'forbid')
            self.assertFalse(model.model_json_schema()['additionalProperties'])
            for key in ['user_id', 'sql', 'connection', 'unexpected']:
                args = {**DATES, key: 'forged'}
                if model is Compare:
                    args['metric'] = 'workouts'
                with self.subTest(model=model.__name__, key=key):
                    with self.assertRaises(ValidationError) as raised:
                        model.model_validate(args)
                    self.assertEqual(raised.exception.errors()[0]['type'], 'extra_forbidden')
        with patch.object(db, 'coach_connect') as connect:
            with self.assertRaises(ValueError):
                OwnComparison(1).read({**DATES, 'metric': 'workouts', 'user_id': 2})
            connect.assert_not_called()


class Comparison(unittest.TestCase):
    def setUp(self):
        with db.connect() as c:
            c.execute("DELETE FROM users WHERE login IN ('zz_test_compare_a','zz_test_compare_b')")
            self.ids = [c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',
                        (login, 'Fictional Comparator')).fetchone()['id']
                        for login in ['zz_test_compare_a', 'zz_test_compare_b']]
            self.a, self.b = self.ids
            for uid in self.ids:
                c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'Pacific/Kiritimati')", (uid,))
            fixtures = [(self.a,'manual',None,1000,'2004-02-27T12:00:00Z',False),
                        (self.a,'manual',None,2000,'2004-03-01T12:00:00Z',False),
                        (self.a,'healthkit',None,5000,'2004-03-01T12:00:00Z',False),
                        (self.a,'manual','health-derived',7000,'2004-03-01T12:00:00Z',False),
                        (self.a,'garmin_connect',None,11000,'2004-03-01T12:00:00Z',False),
                        (self.a,'garmin_connect','mixed-source',9000,'2004-03-01T12:00:00Z',False),
                        (self.a,'manual',None,99999,'2004-03-01T12:00:00Z',True),
                        (self.b,'manual',None,1000000,'2004-03-01T12:00:00Z',False)]
            for uid,source,health,distance,stamp,open_lift in fixtures:
                c.execute('''INSERT INTO activities(user_id,sport,name,source,healthkit_id,start_time,
                    distance_m,moving_s,elapsed_s,lift_open) VALUES(%s,'run','IGNORE PRIVATE SENTINEL',%s,%s,%s,%s,%s,%s,%s)''',
                    (uid,source,health,stamp,distance,distance/10,distance/10+20,open_lift))
            for day,protein in [('2004-02-27',10),('2004-02-28',20),('2004-02-29',30),
                                ('2004-03-01',20),('2004-03-02',40),('2004-03-03',60)]:
                c.execute("INSERT INTO food_entries(user_id,day,name,kcal,protein_g) VALUES(%s,%s,'Fictional meal',400,%s)", (self.a,day,protein))
        self.reader = OwnComparison(self.a)

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=ANY(%s)', (self.ids,))

    def read(self, metric='distance_m', **extra):
        return self.reader.read({**DATES, 'metric': metric, **extra})

    def test_each_source_and_combined_provenance(self):
        # Denied weight consent must not block unrelated permitted workout measurements.
        with db.connect() as c:
            c.execute('UPDATE profile SET weight_health_derived=true,health_weight_ai_ok=false WHERE user_id=%s', (self.a,))
        for health,garmin,total,records in [(False,False,2000,1),(True,False,14000,3),
                                          (False,True,13000,2),(True,True,34000,5)]:
            with db.connect() as c:
                c.execute('UPDATE profile SET health_ai_ok=%s,garmin_ai_ok=%s WHERE user_id=%s', (health,garmin,self.a))
            result = self.read()
            self.assertEqual(result['current']['value'],total)
            self.assertEqual(result['current']['records'],records)
            self.assertEqual(result['previous']['value'],1000)
            self.assertEqual(result['previous']['start'],dt.date(2004,2,27))
            self.assertEqual(result['change']['absolute'],total-1000)
            self.assertEqual(result['source_consents'],{'health':health,'garmin':garmin})
            self.assertNotIn('SENTINEL',json.dumps(result,default=str))
            self.assertEqual(self.read(sport='ride')['current']['records'],0)

    def test_missing_values_elapsed_fallback_and_empty_baseline(self):
        with db.connect() as c:
            c.execute("UPDATE activities SET moving_s=NULL WHERE user_id=%s AND source='manual' AND healthkit_id IS NULL AND NOT lift_open AND distance_m=2000", (self.a,))
        self.assertEqual(self.read('duration_s')['current']['value'],220)
        self.assertEqual(self.read('duration_s')['current']['duration_elapsed_fallbacks'],1)
        with db.connect() as c:
            c.execute("UPDATE activities SET elapsed_s=NULL,distance_m=NULL WHERE user_id=%s AND source='manual' AND healthkit_id IS NULL AND moving_s IS NULL", (self.a,))
        result=self.read();self.assertIsNone(result['current']['value']);self.assertIsNone(result['change']['absolute'])
        self.assertEqual(result['current']['unknown_measurements'],1)
        empty=self.read('workouts',sport='ride');self.assertEqual(empty['current']['value'],0)
        self.assertIsNone(empty['change']['percent'])

    def test_food_missing_flags_partial_days_and_zero(self):
        result=self.read('protein_g');self.assertEqual(result['current']['value'],120)
        self.assertEqual(result['change'],{'absolute':60,'percent':100})
        self.assertEqual(result['source_consents'],{})
        with db.connect() as c:
            c.execute("UPDATE food_entries SET protein_g=0,ref='{\"unknown_nutrients\":[\"protein_g\"]}' WHERE user_id=%s AND day='2004-03-02'", (self.a,))
        result=self.read('protein_g');self.assertIsNone(result['current']['value'])
        self.assertEqual(result['current']['known_total'],80);self.assertIsNone(result['change']['absolute'])
        with db.connect() as c:
            c.execute("UPDATE food_entries SET ref='{}' WHERE user_id=%s AND day='2004-03-02'", (self.a,))
        self.assertEqual(self.read('protein_g')['current']['value'],80)
        with db.connect() as c:
            c.execute("DELETE FROM food_entries WHERE user_id=%s AND day='2004-03-02'", (self.a,))
        result=self.read('protein_g');self.assertIsNone(result['current']['value'])
        self.assertEqual(result['current']['logged_days'],2)

    def test_full_period_is_not_limited_to_a_page(self):
        with db.connect() as c:
            for _ in range(100):
                c.execute("INSERT INTO activities(user_id,sport,name,source,start_time,distance_m) VALUES(%s,'walk','Fictional extra walk','manual','2004-03-01T12:00:00Z',10)", (self.a,))
        result=self.read();self.assertEqual(result['current']['value'],3000)
        self.assertEqual(result['current']['records'],101)
        self.assertEqual(self.read('workouts')['current']['value'],101)

    def test_nonfinite_measurements_stay_unknown(self):
        with db.connect() as c:
            c.execute("UPDATE activities SET distance_m='NaN' WHERE user_id=%s AND distance_m=2000", (self.a,))
        self.assertIsNone(self.read()['current']['value'])
        with db.connect() as c:
            c.execute("UPDATE food_entries SET protein_g='Infinity' WHERE user_id=%s AND day='2004-03-02'", (self.a,))
        self.assertIsNone(self.read('protein_g')['current']['value'])

    def test_bounds_identity_and_unfinished_dates(self):
        for uid in [None,0,-1,True,'1']:
            with self.assertRaises(ValueError):OwnComparison(uid)
        invalid=[{'user_id':self.b},{'sql':'SELECT * FROM users'},{'metric':'table_name'},
                 {'sport':'run; SELECT'},{'metric':'protein_g','sport':'run'},
                 {'start':'2004-03-04'},{'start':'2002-01-01'},
                 {'start':'0001-01-01','end':'0001-01-01'}]
        for args in invalid:
            with self.assertRaises((ValueError,ValidationError)):self.read(**args)
        with db.connect() as c:
            today=c.execute("SELECT (now() AT TIME ZONE tz)::date AS d FROM profile WHERE user_id=%s", (self.a,)).fetchone()['d']
        with self.assertRaises(ValueError):self.read(start=today,end=today)
        leap=self.read(start='2008-01-01',end='2008-12-31')
        self.assertEqual(leap['current']['calendar_days'],366)
        for start, end in [('0001-01-02', '0001-01-02'),
                           ('0001-01-03', '0001-01-04')]:
            with self.subTest(start=start, end=end):
                earliest=self.read('workouts',start=start,end=end)
                self.assertEqual(earliest['previous']['start'],dt.date.min)
                self.assertEqual(earliest['current']['calendar_days'],earliest['previous']['calendar_days'])

    def test_dst_dates_are_local_and_inclusive(self):
        with db.connect() as c:
            c.execute("UPDATE profile SET tz='America/New_York' WHERE user_id=%s", (self.a,))
            for stamp in ['2024-03-09T04:59:59Z','2024-03-09T05:00:00Z','2024-03-11T03:59:59Z','2024-03-11T04:00:00Z']:
                c.execute("INSERT INTO activities(user_id,sport,name,source,start_time) VALUES(%s,'run','Fictional DST run','manual',%s)", (self.a,stamp))
        result=self.read('workouts',start='2024-03-09',end='2024-03-10')
        self.assertEqual(result['current']['value'],2);self.assertEqual(result['previous']['value'],1)

    def test_revocation_discards_result(self):
        outer=self
        class Changing(OwnComparison):
            def _period(self,c,r,p,start,end,days):
                result=super()._period(c,r,p,start,end,days)
                with db.connect() as write:
                    write.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s', (outer.a,))
                return result
        with self.assertRaisesRegex(ValueError,'Source consent changed'):
            Changing(self.a).read({**DATES,'metric':'distance_m'})

    def test_rls_readonly_pool_cleanup_and_no_provider(self):
        with db.coach_connect(self.a) as c:
            self.assertEqual(c.execute("SHOW statement_timeout").fetchone()['statement_timeout'],'3s')
            self.assertEqual(c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s', (self.b,)).fetchone()['n'],0)
            self.assertTrue(all(r['user_id']==self.a for r in c.execute('SELECT user_id FROM activities').fetchall()))
        with self.assertRaises((errors.InsufficientPrivilege,errors.ReadOnlySqlTransaction)):
            with db.coach_connect(self.a) as c:c.execute('DELETE FROM activities')
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT current_user AS role').fetchone()['role'],'fit_app')
            self.assertFalse(c.execute("SELECT current_setting('kinetta.coach_user_id',true) AS uid").fetchone()['uid'])
        with patch('urllib.request.urlopen',side_effect=AssertionError('Provider/network call forbidden')) as request:
            self.assertEqual(self.read()['current']['value'],2000)
            request.assert_not_called()
        self.assertEqual(OwnComparison(self.b).read({**DATES,'metric':'distance_m'})['current']['value'],1000000)


if __name__ == '__main__':unittest.main()
