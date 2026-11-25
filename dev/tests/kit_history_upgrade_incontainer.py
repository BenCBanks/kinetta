"""Real previous-schema -> history migration on one separate disposable database."""
import unittest
import uuid
from contextlib import contextmanager
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from app import db


class HistoryUpgrade(unittest.TestCase):
    def test_previous_schema_then_history_preserves_question_and_fences_sensitive_text(self):
        name='zz_test_kit_upgrade_'+uuid.uuid4().hex[:8]
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
                    uid=c.execute("INSERT INTO users(login,name) VALUES('zz_test_upgrade','Fictional Historian') RETURNING id").fetchone()['id']
                    generation,visit=uuid.uuid4(),uuid.uuid4()
                    c.execute('INSERT INTO kit_conversations(user_id,generation) VALUES(%s,%s)',(uid,generation))
                    c.execute('INSERT INTO kit_visits(id,user_id) VALUES(%s,%s)',(visit,uid))
                    c.execute('''INSERT INTO kit_turns(user_id,client_id,generation,visit_id,question,state,answer)
                      VALUES(%s,%s,%s,%s,'Fictional old question','answered','{"interpretation":"Sensitive old answer","health_included":true}')''',
                      (uid,uuid.uuid4(),generation,visit))
                db.migrate()
                with target() as c:
                    self.assertEqual(c.execute('SELECT max(version) v FROM schema_version').fetchone()['v'],len(migrations))
                    row=c.execute('SELECT * FROM kit_turns WHERE user_id=%s',(uid,)).fetchone()
                    self.assertEqual(row['question'],'Fictional old question');self.assertIsNone(row['answer'])
                    self.assertIsNotNone(row['invalidated_at']);self.assertEqual(row['visit_id'],visit)
                    self.assertEqual(c.execute('SELECT generation FROM kit_conversations WHERE user_id=%s',(uid,)).fetchone()['generation'],generation)
        finally:
            with psycopg.connect(admin,autocommit=True) as c:
                c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


if __name__=='__main__':unittest.main()
