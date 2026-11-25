"""Disposable PostgreSQL storage/privacy contracts; never call a provider."""
import json
import tempfile
import unittest
import uuid
import zipfile
import psycopg
from psycopg import errors, sql
from psycopg.rows import dict_row
from fastapi import HTTPException
from app import db, kit_history
from app.api_mydata import _write_export


class HistoryStorage(unittest.TestCase):
    def setUp(self):
        self.ids=[]
        with db.connect() as c:
            for suffix in ['a','b']:
                uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                    ('zz_test_history_'+suffix+uuid.uuid4().hex[:8],'Fictional Historian')).fetchone()['id']
                self.ids.append(uid)
                c.execute('INSERT INTO profile(user_id) VALUES(%s)',(uid,))
                c.execute('INSERT INTO kit_conversations(user_id,generation) VALUES(%s,%s)',(uid,uuid.uuid4()))
        self.a,self.b=self.ids

    def tearDown(self):
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))

    def fixture(self,c,uid,state='answered',saved=True):
        tid,vid=uuid.uuid4(),uuid.uuid4()
        if saved:c.execute('INSERT INTO kit_threads(id,user_id) VALUES(%s,%s)',(tid,uid))
        c.execute('INSERT INTO kit_visits(id,user_id,conversation_id) VALUES(%s,%s,%s)',(vid,uid,tid if saved else None))
        mid=c.execute('''INSERT INTO kit_turns(user_id,client_id,generation,visit_id,conversation_id,
          question,state,answer,lease,expires) SELECT user_id,%s,generation,%s,%s,'Fictional saved question',
          %s,%s,%s,now()+interval '5 minutes' FROM kit_conversations WHERE user_id=%s RETURNING id''',
          (uuid.uuid4(),vid,tid if saved else None,state,json.dumps({'interpretation':'Fictional answer'})
           if state=='answered' else None,uuid.uuid4(),uid)).fetchone()['id']
        return tid,vid,mid

    def test_owner_constraints_and_identical_unavailable(self):
        with db.connect() as c:
            tid,vid,mid=self.fixture(c,self.a)
            for statement,args in [
                ('INSERT INTO kit_visits(id,user_id,conversation_id) VALUES(%s,%s,%s)',(uuid.uuid4(),self.b,tid)),
                ('UPDATE kit_turns SET conversation_id=%s WHERE id=%s',(uuid.uuid4(),mid)),
                ('UPDATE kit_turns SET user_id=%s WHERE id=%s',(self.b,mid))]:
                with self.assertRaises(errors.ForeignKeyViolation),c.transaction():c.execute(statement,args)
            failures=[]
            for candidate in [tid,uuid.uuid4()]:
                with self.assertRaises(HTTPException) as x:kit_history.thread(c,self.b,candidate)
                failures.append((x.exception.status_code,x.exception.detail))
            self.assertEqual(failures[0],failures[1])

    def test_end_expiry_and_switch_off_cannot_erase_saved_turns(self):
        with db.connect() as c:
            for state in ['answered','failed','pending','running']:
                tid,vid,mid=self.fixture(c,self.a,state)
                c.execute("UPDATE kit_visits SET created=now()-interval '2 days' WHERE id=%s",(vid,))
                kit_history.preserve(c,self.b) # foreign cleanup is harmless
                self.assertIsNotNone(c.execute('SELECT visit_id FROM kit_turns WHERE id=%s',(mid,)).fetchone()['visit_id'])
                kit_history.preserve(c,self.a) # intentionally independent of rollout settings
                c.execute('DELETE FROM kit_visits WHERE id=%s',(vid,))
                row=c.execute('SELECT * FROM kit_turns WHERE id=%s',(mid,)).fetchone()
                self.assertEqual(row['conversation_id'],tid);self.assertIsNone(row['visit_id'])
                self.assertIsNone(row['lease']);self.assertIsNone(row['expires'])
                self.assertEqual(row['state'],'answered' if state=='answered' else 'failed')
                if state in ['pending','running']:self.assertIn('Retry',row['error'])
                if state=='answered':self.assertEqual(row['answer']['interpretation'],'Fictional answer')
            _,vid,mid=self.fixture(c,self.a,saved=False)
            kit_history.preserve(c,self.a,vid)
            c.execute('DELETE FROM kit_visits WHERE id=%s',(vid,))
            self.assertIsNone(c.execute('SELECT 1 FROM kit_turns WHERE id=%s',(mid,)).fetchone())

    def test_single_all_and_account_delete(self):
        with db.connect() as c:
            tid,vid,mid=self.fixture(c,self.a,'running')
            second=self.fixture(c,self.a);foreign=self.fixture(c,self.b)
            kit_history.remove(c,self.a,tid)
            self.assertIsNone(c.execute('SELECT 1 FROM kit_turns WHERE id=%s',(mid,)).fetchone())
            visit=c.execute('SELECT * FROM kit_visits WHERE id=%s',(vid,)).fetchone()
            self.assertIsNotNone(visit['ended']);self.assertIsNone(visit['conversation_id'])
            self.assertIsNotNone(kit_history.thread(c,self.a,second[0]))
            kit_history.remove(c,self.a)
            self.assertIsNone(c.execute('SELECT 1 FROM kit_threads WHERE user_id=%s',(self.a,)).fetchone())
            self.assertIsNotNone(kit_history.thread(c,self.b,foreign[0]))
            self.fixture(c,self.a)
            c.execute('DELETE FROM users WHERE id=%s',(self.a,))
            for table in ['kit_threads','kit_visits','kit_turns']:
                self.assertEqual(c.execute(sql.SQL('SELECT count(*) AS n FROM {} WHERE user_id=%s').format(sql.Identifier(table)),(self.a,)).fetchone()['n'],0)

    def test_export_is_own_and_has_no_lease(self):
        with db.connect() as c:self.fixture(c,self.a);self.fixture(c,self.b)
        with tempfile.NamedTemporaryFile(suffix='.zip') as f:
            _write_export(self.a,f.name)
            with zipfile.ZipFile(f.name) as z:
                threads=[json.loads(line) for line in z.read('data/kit_threads.jsonl').splitlines()]
                turns=[json.loads(line) for line in z.read('data/kit_turns.jsonl').splitlines()]
                self.assertEqual(len(threads),1);self.assertEqual(len(turns),1)
                self.assertEqual(turns[0]['conversation_id'],threads[0]['id'])
                self.assertNotIn('user_id',threads[0]);self.assertNotIn('lease',turns[0])

    def test_sql_reader_rls_and_model_cannot_browse_archive(self):
        role='zz_test_history_sql_'+uuid.uuid4().hex[:8];password=uuid.uuid4().hex
        with db.connect() as c:
            self.fixture(c,self.a);self.fixture(c,self.b)
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} IN ROLE fit_readers').format(sql.Identifier(role),sql.Literal(password)))
            c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.a))
        try:
            with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as c:
                rows=c.execute('SELECT * FROM kit_threads').fetchall()
                self.assertEqual([r['user_id'] for r in rows],[self.a])
                with self.assertRaises(errors.InsufficientPrivilege),c.transaction():
                    c.execute('DELETE FROM kit_threads')
            with self.assertRaises(errors.InsufficientPrivilege),db.coach_connect(self.a) as c:
                c.execute('SELECT * FROM kit_threads')
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.a,))
                c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


if __name__=='__main__':unittest.main()
