"""Disposable PostgreSQL storage/privacy contracts; never call a provider."""
import json
import tempfile
import unittest
import uuid
import zipfile
from unittest.mock import patch
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
            c.execute('''INSERT INTO kit_turns(user_id,client_id,generation,visit_id,question)
              SELECT user_id,%s,generation,%s,'Fictional legacy question' FROM kit_conversations WHERE user_id=%s''',
              (uuid.uuid4(),vid,self.a))
            second=self.fixture(c,self.a);foreign=self.fixture(c,self.b)
            kit_history.remove(c,self.a,tid)
            self.assertIsNone(c.execute('SELECT 1 FROM kit_turns WHERE id=%s',(mid,)).fetchone())
            visit=c.execute('SELECT * FROM kit_visits WHERE id=%s',(vid,)).fetchone()
            self.assertIsNone(visit)
            self.assertIsNone(c.execute('SELECT 1 FROM kit_turns WHERE visit_id=%s',(vid,)).fetchone())
            self.assertIsNotNone(kit_history.thread(c,self.a,second[0]))
            self.fixture(c,self.a,saved=False)
            kit_history.remove(c,self.a)
            for table in ['kit_threads','kit_visits','kit_turns']:
                self.assertEqual(c.execute(sql.SQL('SELECT count(*) n FROM {} WHERE user_id=%s').format(sql.Identifier(table)),(self.a,)).fetchone()['n'],0)
            self.assertIsNone(c.execute('SELECT 1 FROM kit_threads WHERE user_id=%s',(self.a,)).fetchone())
            self.assertIsNotNone(kit_history.thread(c,self.b,foreign[0]))
            self.fixture(c,self.a)
            self.fixture(c,self.a,saved=False)
            c.execute("INSERT INTO kit_memories(user_id,text) VALUES(%s,'Fictional preference')",(self.a,))
            from app.api_account import erase
            erase(c,c.execute('SELECT * FROM users WHERE id=%s',(self.a,)).fetchone())
            for table in ['kit_threads','kit_visits','kit_turns','kit_memories','kit_conversations']:
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
                turns=c.execute('SELECT question,answer,user_id FROM kit_turns').fetchall()
                self.assertEqual([r['user_id'] for r in turns],[self.a])
                self.assertEqual(turns[0]['question'],'Fictional saved question')
                with self.assertRaises(errors.InsufficientPrivilege),c.transaction():
                    c.execute('SELECT fit_invalidate_kit(%s)',(self.b,))
                with self.assertRaises(errors.InsufficientPrivilege),c.transaction():
                    c.execute('DELETE FROM kit_threads')
            with db.connect() as c:
                c.execute(sql.SQL('GRANT fit_all_readers TO {}').format(sql.Identifier(role)))
            with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as c:
                for selected_role in [None,'fit_readers']:
                    if selected_role:c.execute('SET ROLE fit_readers')
                    for table in ['kit_threads','kit_turns','kit_memories','kit_visits','kit_conversations']:
                        self.assertEqual(c.execute(sql.SQL('SELECT * FROM {}').format(sql.Identifier(table))).fetchall(),[],table)
            with self.assertRaises(errors.InsufficientPrivilege),db.coach_connect(self.a) as c:
                c.execute('SELECT * FROM kit_threads')
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.a,))
                c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


    def test_source_loss_and_consent_restoration_never_restore_answers(self):
        with db.connect() as c:
            for consent in ['ai_ok','health_ai_ok','health_weight_ai_ok','garmin_ai_ok','health_weight_read']:
                with self.subTest(consent=consent):
                    c.execute(sql.SQL('UPDATE profile SET {}=true WHERE user_id=%s').format(sql.Identifier(consent)),(self.a,))
                    _,_,mid=self.fixture(c,self.a)
                    _,_,running=self.fixture(c,self.a,'running')
                    self.fixture(c,self.b)
                    c.execute("INSERT INTO kit_memories(user_id,text,health_included) VALUES(%s,%s,true)",(self.a,'Fictional sensitive preference'))
                    c.execute(sql.SQL('UPDATE profile SET {}=false WHERE user_id=%s').format(sql.Identifier(consent)),(self.a,))
                    c.execute(sql.SQL('UPDATE profile SET {}=true WHERE user_id=%s').format(sql.Identifier(consent)),(self.a,))
                    c.execute("UPDATE kit_turns SET answer='{\"interpretation\":\"Must not resurrect\"}',invalidated_at=NULL WHERE id=%s",(mid,))
                    for ident in [mid,running]:
                        row=c.execute('SELECT * FROM kit_turns WHERE id=%s',(ident,)).fetchone()
                        self.assertIsNotNone(row['invalidated_at']);self.assertIsNone(row['answer']);self.assertIsNone(row['lease'])
                    self.assertEqual(c.execute('SELECT count(*) n FROM kit_memories WHERE user_id=%s',(self.a,)).fetchone()['n'],0)
            self.assertIsNone(c.execute('SELECT invalidated_at FROM kit_turns WHERE user_id=%s LIMIT 1',(self.b,)).fetchone()['invalidated_at'])

    def test_source_removal_triggers_and_legacy_rows(self):
        with db.connect() as c:
            mutations=[
                ("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'walk','healthkit','Fictional walk',now())", "DELETE FROM activities WHERE user_id=%s"),
                ("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'run','garmin_connect','Fictional run',now())", "DELETE FROM activities WHERE user_id=%s"),
                ("INSERT INTO weights(user_id,day,kg) VALUES(%s,current_date,70)", "DELETE FROM weights WHERE user_id=%s"),
                ("INSERT INTO health_weight_samples(user_id,sample_id,sampled_at,kg,observed_at) VALUES(%s,gen_random_uuid(),now(),70,now())", "UPDATE health_weight_samples SET deleted=true WHERE user_id=%s"),
                ("INSERT INTO health_weight_samples(user_id,sample_id,sampled_at,kg,observed_at) VALUES(%s,gen_random_uuid(),now(),70,now())", "UPDATE health_weight_samples SET excluded=true WHERE user_id=%s"),
                ("INSERT INTO day_energy(user_id,day,burned_kcal) VALUES(%s,current_date,2000)", "DELETE FROM day_energy WHERE user_id=%s"),
                ("INSERT INTO health_resting(user_id,tz,day,resting_kcal,observed_at) VALUES(%s,'UTC',current_date,1400,now())", "DELETE FROM health_resting WHERE user_id=%s"),
                ("INSERT INTO connections(user_id,kind) VALUES(%s,'garmin_connect')", "DELETE FROM connections WHERE user_id=%s"),
            ]
            for seed,mutation in mutations:
                with self.subTest(mutation=mutation):
                    c.execute(seed,(self.a,))
                    _,_,mid=self.fixture(c,self.a,saved=False)
                    c.execute(mutation,(self.a,))
                    self.assertIsNotNone(c.execute('SELECT invalidated_at FROM kit_turns WHERE id=%s',(mid,)).fetchone()['invalidated_at'])
            _,_,mid=self.fixture(c,self.a)
            c.execute('DELETE FROM health_weight_samples WHERE user_id=%s',(self.a,))
            self.assertIsNotNone(c.execute('SELECT invalidated_at FROM kit_turns WHERE id=%s',(mid,)).fetchone()['invalidated_at'])
            aid=c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'run','healthkit','Fictional stream',now()) RETURNING id",(self.a,)).fetchone()['id']
            for table,seed in [
                ('activity_streams','INSERT INTO activity_streams(user_id,activity_id) VALUES(%s,%s)'),
                ('best_efforts',"INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) VALUES(%s,%s,'run',1000,'1 km',300,now())")]:
                c.execute(seed,(self.a,aid));_,_,mid=self.fixture(c,self.a)
                c.execute(sql.SQL('DELETE FROM {} WHERE user_id=%s').format(sql.Identifier(table)),(self.a,))
                self.assertEqual(c.execute('SELECT invalidated_at FROM kit_turns WHERE id=%s',(mid,)).fetchone()['invalidated_at'] is not None,table=='activity_streams')
            _,_,mid=self.fixture(c,self.a)
            c.execute("INSERT INTO health_weight_exclusions(user_id,day,before_time) VALUES(%s,current_date,now())",(self.a,))
            self.assertIsNotNone(c.execute('SELECT invalidated_at FROM kit_turns WHERE id=%s',(mid,)).fetchone()['invalidated_at'])

    def test_quarantined_legacy_answer_is_retained_but_hidden_and_never_replayed(self):
        from app import kit_thread as chat
        with db.connect() as c:
            _,visit,mid=self.fixture(c,self.a,saved=False)
            c.execute('UPDATE kit_turns SET replay_blocked_at=now() WHERE id=%s',(mid,))
            old=c.execute('SELECT * FROM kit_turns WHERE id=%s',(mid,)).fetchone()
            generation=old['generation']
        user={'id':self.a}
        with patch('app.ai_release.enabled',return_value=True),patch.object(chat,'permitted'),\
             patch.object(chat,'brake'),patch('app.coach.allowed',return_value=True),\
             patch('app.coach_chat.answer',return_value={'interpretation':'Fictional new answer','health_included':False}) as answer:
            self.assertEqual(chat.read(user=user,before=None,visit_id=visit)['messages'],[])
            with self.assertRaises(HTTPException) as x:
                chat.generate(old['client_id'],chat.GenerationIn(generation=generation,visit_id=visit),user=user)
            self.assertEqual(x.exception.status_code,404)
            with self.assertRaises(HTTPException) as x:
                chat.create(chat.MessageIn(client_id=old['client_id'],generation=generation,visit_id=visit,question=old['question']),user=user)
            self.assertEqual(x.exception.status_code,404)
            new=chat.create(chat.MessageIn(client_id=uuid.uuid4(),generation=generation,visit_id=visit,question='Fictional follow-up question'),user=user)
            result=chat.generate(new['client_id'],chat.GenerationIn(generation=generation,visit_id=visit),user=user)
            self.assertEqual(result['state'],'answered');self.assertEqual(answer.call_args.kwargs['history'],[])
        with db.connect() as c:
            retained=c.execute('SELECT * FROM kit_turns WHERE id=%s',(mid,)).fetchone()
            self.assertEqual(retained['answer'],old['answer']);self.assertIsNone(retained['invalidated_at'])

    def test_sync_same_or_corrected_values_preserve_answers_memories_and_pending_work(self):
        with db.connect() as c:
            c.execute("UPDATE profile SET ai_ok=true,health_ai_ok=true,health_weight_ai_ok=true,garmin_ai_ok=true,health_weight_read=true WHERE user_id=%s",(self.a,))
            aid=c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'run','healthkit','Fictional sync',now()) RETURNING id",(self.a,)).fetchone()['id']
            c.execute('INSERT INTO weights(user_id,day,kg) VALUES(%s,current_date,70)',(self.a,))
            c.execute('INSERT INTO day_energy(user_id,day,burned_kcal) VALUES(%s,current_date,2000)',(self.a,))
            c.execute("INSERT INTO health_resting(user_id,tz,day,resting_kcal,observed_at) VALUES(%s,'UTC',current_date,1400,now())",(self.a,))
            c.execute('INSERT INTO health_weight_samples(user_id,sample_id,sampled_at,kg,observed_at) VALUES(%s,gen_random_uuid(),now(),70,now())',(self.a,))
            c.execute('INSERT INTO activity_streams(user_id,activity_id,hr) VALUES(%s,%s,ARRAY[120.0])',(self.a,aid))
            c.execute("INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) VALUES(%s,%s,'run',1000,'1 km',300,now())",(self.a,aid))
            _,_,mid=self.fixture(c,self.a)
            c.execute('UPDATE kit_turns SET answer=%s WHERE id=%s',(json.dumps({'interpretation':'Keep this answer','health_included':True}),mid))
            _,_,pending=self.fixture(c,self.a,'running')
            original=c.execute('SELECT * FROM kit_turns WHERE id=%s',(pending,)).fetchone()
            c.execute("INSERT INTO kit_memories(user_id,text,health_included) VALUES(%s,'I prefer morning runs.',true)",(self.a,))
            version=c.execute('SELECT memory_version FROM kit_conversations WHERE user_id=%s',(self.a,)).fetchone()['memory_version']
            for table,column,updated in [('weights','kg','71'),('day_energy','burned_kcal','2100'),
                    ('health_resting','resting_kcal','1500'),('health_weight_samples','kg','72'),
                    ('activity_streams','hr','ARRAY[125.0]'),('best_efforts','elapsed_s','290'),
                    ('activities','name',"'Fictional corrected name'"),('profile','weight_kg','72')]:
                for value in [column,updated]:
                    with self.subTest(table=table,value=value):
                        c.execute(sql.SQL('UPDATE {} SET {}={} WHERE user_id=%s').format(sql.Identifier(table),sql.Identifier(column),sql.SQL(value)),(self.a,))
                        answer=c.execute('SELECT * FROM kit_turns WHERE id=%s',(mid,)).fetchone()
                        self.assertEqual(answer['answer']['interpretation'],'Keep this answer')
                        self.assertIsNone(answer['invalidated_at']);self.assertIsNone(answer['replay_blocked_at'])
                        self.assertEqual(c.execute('SELECT * FROM kit_turns WHERE id=%s',(pending,)).fetchone(),original)
                        self.assertEqual(c.execute('SELECT memory_version FROM kit_conversations WHERE user_id=%s',(self.a,)).fetchone()['memory_version'],version)
                        self.assertEqual(c.execute('SELECT count(*) n FROM kit_memories WHERE user_id=%s',(self.a,)).fetchone()['n'],1)
            # Actual source deletion still redacts/cancels, but never deletes a user-authored note.
            c.execute('DELETE FROM weights WHERE user_id=%s',(self.a,))
            self.assertIsNone(c.execute('SELECT answer FROM kit_turns WHERE id=%s',(mid,)).fetchone()['answer'])
            self.assertIsNone(c.execute('SELECT lease FROM kit_turns WHERE id=%s',(pending,)).fetchone()['lease'])
            self.assertEqual(c.execute('SELECT count(*) n FROM kit_memories WHERE user_id=%s',(self.a,)).fetchone()['n'],1)

    def test_health_weight_and_workout_projection_rebuilds_do_not_erase(self):
        from app import api_health_weights
        with db.connect() as c:
            c.execute("UPDATE profile SET ai_ok=true,health_ai_ok=true,health_weight_ai_ok=true,health_weight_read=true WHERE user_id=%s",(self.a,))
            sample=uuid.uuid4()
            c.execute('INSERT INTO health_weight_samples(user_id,sample_id,sampled_at,kg,observed_at) VALUES(%s,%s,now(),70,now())',(self.a,sample))
            api_health_weights.rebuild(c,self.a,'UTC')
            aid=c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'run','healthkit','Fictional rebuilt run',now()) RETURNING id",(self.a,)).fetchone()['id']
            _,_,mid=self.fixture(c,self.a);_,_,running=self.fixture(c,self.a,'running')
            c.execute("INSERT INTO kit_memories(user_id,text,health_included) VALUES(%s,'I prefer evening walks.',true)",(self.a,))
            turns=c.execute('SELECT * FROM kit_turns WHERE id=ANY(%s) ORDER BY id',([mid,running],)).fetchall()
            version=c.execute('SELECT memory_version FROM kit_conversations WHERE user_id=%s',(self.a,)).fetchone()['memory_version']
            for kg in [70,71]:
                c.execute('UPDATE health_weight_samples SET kg=%s,observed_at=now() WHERE user_id=%s AND sample_id=%s',(kg,self.a,sample))
                api_health_weights.rebuild(c,self.a,'UTC')
                c.execute("INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time) VALUES(%s,%s,'run',1000,'1 km',300,now())",(self.a,aid))
                c.execute('DELETE FROM best_efforts WHERE user_id=%s AND activity_id=%s',(self.a,aid))
                self.assertEqual(c.execute('SELECT * FROM kit_turns WHERE id=ANY(%s) ORDER BY id',([mid,running],)).fetchall(),turns)
                self.assertEqual(c.execute('SELECT memory_version FROM kit_conversations WHERE user_id=%s',(self.a,)).fetchone()['memory_version'],version)
                self.assertEqual(c.execute('SELECT count(*) n FROM kit_memories WHERE user_id=%s',(self.a,)).fetchone()['n'],1)
                self.assertEqual(c.execute('SELECT kg FROM weights WHERE user_id=%s',(self.a,)).fetchone()['kg'],kg)


if __name__=='__main__':unittest.main()
