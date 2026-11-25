"""Real previous-schema -> history migration on one separate disposable database."""
import json
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
    def test_previous_schema_upgrade_retains_answers_and_memories_unless_consent_revoked(self):
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
                    fixtures=[]
                    for mode in ['consented','unused_sources_off','revoked','unknown_sources']:
                        uid=c.execute("INSERT INTO users(login,name) VALUES(%s,'Fictional Historian') RETURNING id",
                          ('zz_test_upgrade_'+mode,)).fetchone()['id']
                        granted=mode!='revoked'
                        c.execute('INSERT INTO profile(user_id,ai_ok,health_ai_ok,health_weight_ai_ok,garmin_ai_ok,health_weight_read) VALUES(%s,true,%s,%s,%s,%s)',
                          (uid,granted,mode=='consented',mode=='consented',mode=='consented'))
                        if mode!='unknown_sources':
                            c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'run','healthkit','Fictional run',now())",(uid,))
                        generation,visit=uuid.uuid4(),uuid.uuid4()
                        c.execute('INSERT INTO kit_conversations(user_id,generation) VALUES(%s,%s)',(uid,generation))
                        c.execute('INSERT INTO kit_visits(id,user_id) VALUES(%s,%s)',(visit,uid))
                        for answer in [{'interpretation':'Sensitive old answer','health_included':True},
                                       {'interpretation':'Unknown old answer'},
                                       {'interpretation':'Non-sensitive old answer','health_included':False}]:
                            c.execute("""INSERT INTO kit_turns(user_id,client_id,generation,visit_id,question,state,answer)
                              VALUES(%s,%s,%s,%s,'Fictional old question','answered',%s)""",
                              (uid,uuid.uuid4(),generation,visit,json.dumps(answer)))
                        c.execute("""INSERT INTO kit_turns(user_id,client_id,generation,visit_id,question,state,lease,expires)
                          VALUES(%s,%s,%s,%s,'Fictional pending question','running',%s,now()+interval '5 minutes')""",
                          (uid,uuid.uuid4(),generation,visit,visit))
                        c.execute("INSERT INTO kit_memories(user_id,text,health_included) VALUES(%s,'I prefer morning runs.',true),(%s,'I prefer short replies.',false)",(uid,uid))
                        fixtures.append((uid,generation,visit,mode))
                db.migrate()
                with target() as c:
                    self.assertEqual(c.execute('SELECT max(version) v FROM schema_version').fetchone()['v'],len(migrations))
                    for uid,generation,visit,mode in fixtures:
                        with self.subTest(mode=mode):
                            rows=c.execute('SELECT * FROM kit_turns WHERE user_id=%s ORDER BY id',(uid,)).fetchall()
                            self.assertEqual(len(rows),4)
                            for row,text in zip(rows,['Sensitive old answer','Unknown old answer','Non-sensitive old answer']):
                                self.assertEqual(row['question'],'Fictional old question');self.assertEqual(row['visit_id'],visit)
                                if mode=='revoked' and text!='Non-sensitive old answer':
                                    self.assertIsNone(row['answer']);self.assertIsNotNone(row['invalidated_at'])
                                else:
                                    self.assertEqual(row['answer']['interpretation'],text);self.assertIsNone(row['invalidated_at'])
                                self.assertEqual(row['replay_blocked_at'] is not None,text!='Non-sensitive old answer')
                            pending=rows[3]
                            self.assertEqual(pending['state'],'answered' if mode=='revoked' else 'running')
                            self.assertEqual(pending['lease'],None if mode=='revoked' else visit)
                            self.assertIsNone(pending['replay_blocked_at'])
                            memories=c.execute('SELECT text FROM kit_memories WHERE user_id=%s ORDER BY id',(uid,)).fetchall()
                            self.assertEqual([r['text'] for r in memories],['I prefer short replies.'] if mode=='revoked'
                              else ['I prefer morning runs.','I prefer short replies.'])
                            self.assertEqual(c.execute('SELECT generation FROM kit_conversations WHERE user_id=%s',(uid,)).fetchone()['generation'],generation)

        finally:
            with psycopg.connect(admin,autocommit=True) as c:
                c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


if __name__=='__main__':unittest.main()
