"""Upgrade the real previous schema; legacy schedules, marks and overrides survive."""
import datetime as dt
import unittest
import uuid
from contextlib import contextmanager
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from app import db,plans

class PlanUpgrade(unittest.TestCase):
    def test_previous_schema_preserves_existing_active_plan(self):
        name='zz_test_plan_upgrade_'+uuid.uuid4().hex[:8]
        admin=db._conninfo('postgres',db.secret('POSTGRES_PASSWORD'))
        with psycopg.connect(admin,autocommit=True) as c:
            c.execute(sql.SQL('CREATE DATABASE {} OWNER fit_app').format(sql.Identifier(name)))
        try:
            with psycopg.connect(make_conninfo(admin,dbname=name),autocommit=True) as c:
                c.execute('ALTER SCHEMA public OWNER TO fit_app')
                c.execute('CREATE EXTENSION postgis');c.execute('CREATE EXTENSION citext')
            @contextmanager
            def target():
                with psycopg.connect(make_conninfo(db.CONNINFO,dbname=name),row_factory=dict_row) as c:yield c
            with patch.object(db,'connect',target),patch.object(db,'bootstrap'):
                migrations=db.MIGRATIONS
                with patch.object(db,'MIGRATIONS',migrations[:-1]):db.migrate()
                with target() as c:
                    self.assertEqual(c.execute('SELECT max(version) v FROM schema_version').fetchone()['v'],len(migrations)-1)
                    uid=c.execute("INSERT INTO users(login,name) VALUES('zz_test_plan_upgrade','Fictional Runner') RETURNING id").fetchone()['id']
                    c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'UTC')",(uid,))
                    pid=c.execute("""INSERT INTO training_plans(user_id,race,level,weeks,runs,long_day,start_day,race_day,unit,start_vol)
                        VALUES(%s,'marathon','beginner',18,4,6,'2027-03-08','2027-07-11','mi',15) RETURNING id""",(uid,)).fetchone()['id']
                    p=c.execute('SELECT * FROM training_plans WHERE id=%s AND user_id=%s',(pid,uid)).fetchone()
                    before=plans._build_legacy(p,plans.paces(45))
                    day=before[0]['workouts'][0]['day']
                    c.execute('INSERT INTO plan_marks(user_id,plan_id,day,done) VALUES(%s,%s,%s,true)',(uid,pid,day))
                    # RLS is on the same table/owner column: adding JSON must not create a public data path.
                    policies=c.execute("SELECT * FROM pg_policies WHERE tablename='training_plans'").fetchall()
                db.migrate()
                with target() as c:
                    p=c.execute('SELECT * FROM training_plans WHERE id=%s AND user_id=%s',(pid,uid)).fetchone()
                    self.assertIsNone(p['prescription']);self.assertTrue(p['active'])
                    self.assertEqual(plans.build(p,plans.paces(45)),before)
                    self.assertTrue(c.execute('SELECT done FROM plan_marks WHERE user_id=%s AND plan_id=%s',(uid,pid)).fetchone()['done'])
                    self.assertEqual(c.execute("SELECT * FROM pg_policies WHERE tablename='training_plans'").fetchall(),policies)
                    self.assertTrue(c.execute("SELECT relrowsecurity FROM pg_class WHERE relname='training_plans'").fetchone()['relrowsecurity'])
                    c.execute('DELETE FROM users WHERE id=%s',(uid,))
                    self.assertIsNone(c.execute('SELECT id FROM training_plans WHERE user_id=%s',(uid,)).fetchone())
        finally:
            with psycopg.connect(admin,autocommit=True) as c:
                c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))

if __name__=='__main__':unittest.main()
