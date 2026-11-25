"""Fictional real-DB history/API/race tests; provider is always a stand-in."""
import json
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth, db, kit_memory, kit_history
from app.main import app

ROOT='/api/coach/conversation'


class HistoryAPI(unittest.TestCase):
    def setUp(self):
        self.ids=[];self.clients=[];self.seen=[]
        for _ in range(2):
            login='zz_test_history_api_'+uuid.uuid4().hex[:8]
            with db.connect() as c:
                uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                  (login,'Fictional Historian',auth.hash_pw('green kettle after morning walk'))).fetchone()['id']
                c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(uid,))
            self.ids.append(uid);client=TestClient(app);client.headers['Origin']='http://testserver';client.headers['Content-Type']='application/json'
            self.assertEqual(client.post('/api/login',json={'login':login,'password':'green kettle after morning walk'}).status_code,200)
            self.clients.append(client)
        self.a,self.b=self.clients;self.uid,self.other=self.ids
        self.patches=[patch.dict('os.environ',{'KINETTA_KIT_HISTORY_ENABLED':'1'}),
          patch('app.coach.provider',return_value='gemini'),patch('app.ai_release.enabled',return_value=True),
          patch('app.coach_chat.answer',side_effect=self.answer),patch('app.kit_thread.brake'),
          patch('urllib.request.urlopen',side_effect=AssertionError('No network'))]
        for p in self.patches:p.start()

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        for c in self.clients:c.close()
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))

    def answer(self,*args,**kw):
        self.seen.append(kw)
        return {'interpretation':'Fictional saved answer','health_included':False,'actions':[]}

    def req(self,method,path,body=None,status=200,client=None):
        r=(client or self.a).request(method,ROOT+path,json=body)
        self.assertEqual(r.status_code,status,(path,r.text[:400]));return r.json()

    def new(self,client=None):
        generation=self.req('GET','/threads',client=client)['generation']
        body={'conversation_id':str(uuid.uuid4()),'visit_id':str(uuid.uuid4()),'generation':generation}
        return self.req('POST','/threads',body,client=client)

    def send(self,v,text='Fictional next question',generate=True):
        body={k:v[k] for k in ['visit_id','generation']}
        body.update(client_id=str(uuid.uuid4()),question=text)
        row=self.req('POST','/messages',body)
        return self.req('POST','/messages/'+row['client_id']+'/answer',body={k:v[k] for k in ['visit_id','generation']}) if generate else row

    def resume(self,v):
        return self.req('POST','/threads/'+v['conversation_id']+'/resume',
          {'visit_id':str(uuid.uuid4()),'generation':self.req('GET','/threads')['generation']})

    def test_default_off_auth_ownership_and_no_provider_on_read(self):
        self.assertEqual(TestClient(app).get(ROOT+'/threads').status_code,401)
        v=self.new();self.new(self.b)
        for ident in [v['conversation_id'],str(uuid.uuid4())]:
            self.req('GET','/threads/'+ident,status=404,client=self.b)
            self.req('DELETE','/threads/'+ident,status=404,client=self.b)
        with patch.dict('os.environ',{'KINETTA_KIT_HISTORY_ENABLED':'0'}):
            self.assertFalse(self.req('GET','/threads')['enabled'])
            self.req('GET','/threads/'+v['conversation_id'])
            self.req('POST','/threads',{**{k:v[k] for k in ['generation','conversation_id','visit_id']}},409)
        self.assertEqual(self.seen,[])

    def test_resume_retains_answers_and_bounded_health_filtered_context(self):
        v=self.new();self.send(v)
        # Lost acknowledgement is idempotent, with no new visit/thread.
        self.req('POST','/threads',{k:v[k] for k in ['generation','conversation_id','visit_id']})
        self.req('POST','/visits/'+v['visit_id']+'/end')
        resumed=self.resume(v);self.assertEqual(len(resumed['messages']),1)
        self.send(resumed)
        self.assertEqual(len(self.seen[-1]['history']),2)
        with db.connect() as c:
            for _ in range(8):
                c.execute("""INSERT INTO kit_turns(user_id,client_id,generation,conversation_id,question,state,answer)
                  VALUES(%s,%s,%s,%s,'Fictional previous question','answered','{\"interpretation\":\"Fictional answer\"}')""",
                  (self.uid,uuid.uuid4(),v['generation'],v['conversation_id']))
        self.send(resumed);self.assertEqual(len(self.seen[-1]['history']),12)
        with db.connect() as c:
            c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'walk','healthkit','Fictional Health walk',now())",(self.uid,))
            c.execute("UPDATE kit_turns SET answer=answer||'{\"health_included\":true}' WHERE user_id=%s",(self.uid,))
        self.send(resumed);self.assertEqual(self.seen[-1]['history'],[])
        self.assertEqual(self.req('GET','/threads')['conversations'][0]['message_count'],12)
        self.assertFalse(self.req('GET','/threads',client=self.b)['conversations'])

    def test_interrupted_turn_can_retry_in_new_visit_and_thread_serializes(self):
        v=self.new();pending=self.send(v,generate=False);second=self.resume(v)
        body={k:second[k] for k in ['visit_id','generation']};body.update(client_id=str(uuid.uuid4()),question='Fictional second device')
        self.req('POST','/messages',body,409)
        self.req('POST','/visits/'+v['visit_id']+'/end');resumed=self.resume(v)
        self.assertEqual(resumed['messages'][0]['state'],'failed')
        answer=self.req('POST','/messages/'+pending['client_id']+'/answer',{k:resumed[k] for k in ['visit_id','generation']})
        self.assertEqual(answer['state'],'answered');self.assertEqual(len(self.seen),1)
        self.send(resumed,generate=False)
        with db.connect() as c:c.execute("UPDATE kit_visits SET created=now()-interval '2 days' WHERE id=%s",(resumed['visit_id'],))
        fresh=self.resume(v)
        self.assertEqual(fresh['messages'][-1]['state'],'failed')
        self.send(fresh) # expired pending work must not block this new question


    def test_expiry_rollout_off_and_legacy_clear_preserve_saved_history(self):
        v=self.new();self.send(v)
        with db.connect() as c:c.execute("UPDATE kit_visits SET created=now()-interval '2 days' WHERE user_id=%s",(self.uid,))
        with patch.dict('os.environ',{'KINETTA_KIT_HISTORY_ENABLED':'0'}):
            legacy=self.req('POST','/visits',{'visit_id':str(uuid.uuid4())})
            self.assertEqual(len(self.req('GET','/threads/'+v['conversation_id'])['messages']),1)
            self.req('POST','/clear',{'generation':legacy['generation'],'confirmed':True})
            self.assertEqual(len(self.req('GET','/threads/'+v['conversation_id'])['messages']),1)

    def test_single_and_all_deletion_cancel_late_answer_and_queued_create(self):
        for delete_path in ['single','all']:
            v=self.new();foreign=self.new(self.b);pending=self.send(v,generate=False)
            with db.connect() as c:kit_memory.remember(c,self.uid,'I prefer fictional morning walks.')
            entered=threading.Event();release=threading.Event()
            def slow(*args,**kw):
                entered.set();self.assertTrue(release.wait(10));return self.answer(*args,**kw)
            with patch('app.coach_chat.answer',side_effect=slow),ThreadPoolExecutor(max_workers=1) as pool:
                future=pool.submit(self.req,'POST','/messages/'+pending['client_id']+'/answer',{k:v[k] for k in ['visit_id','generation']})
                self.assertTrue(entered.wait(10))
                deleted=self.req('DELETE','/threads'+('/'+v['conversation_id'] if delete_path=='single' else ''))
                self.assertNotEqual(deleted['generation'],v['generation'])
                release.set();self.assertTrue(future.result()['cancelled'])
            self.req('GET','/threads/'+v['conversation_id'],status=404)
            self.req('POST','/threads',{k:v[k] for k in ['generation','conversation_id','visit_id']},409)
            self.assertTrue(self.req('GET','/memory')['memories'])
            self.req('GET','/threads/'+foreign['conversation_id'],client=self.b)

    def test_expiry_while_answering_rejects_the_late_result(self):
        v=self.new();pending=self.send(v,generate=False)
        def expire(*args,**kw):
            with db.connect() as c:c.execute("UPDATE kit_visits SET created=now()-interval '2 days' WHERE id=%s",(v['visit_id'],))
            return self.answer(*args,**kw)
        with patch('app.coach_chat.answer',side_effect=expire):
            self.assertTrue(self.req('POST','/messages/'+pending['client_id']+'/answer',
              {k:v[k] for k in ['visit_id','generation']})['cancelled'])
        rows=self.req('GET','/threads/'+v['conversation_id'])['messages']
        self.assertEqual(rows[0]['state'],'failed');self.assertIsNone(rows[0]['answer'])

    def test_removed_source_records_do_not_bypass_historical_consent(self):
        v=self.new()
        with db.connect() as c:
            c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
            c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'walk','healthkit','Fictional Health walk',now())",(self.uid,))
        def sensitive(*args,**kw):
            result=self.answer(*args,**kw);result['health_included']=True
            result['history_consents']={'health':False} # forged provider metadata is replaced
            return result
        with patch('app.coach_chat.answer',side_effect=sensitive):
            answer=self.send(v,'Fictional question')
            self.assertTrue(answer['answer']['history_consents']['health'])
            with db.connect() as c:
                c.execute("DELETE FROM activities WHERE user_id=%s",(self.uid,))
                c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(self.uid,))
            self.send(self.resume(v));self.assertEqual(self.seen[-1]['history'],[])
            # Coarse health_included also marks manual-only tools: these remain usable.
            self.send(self.resume(v));self.assertEqual(len(self.seen[-1]['history']),2)
            self.assertNotIn('history_consents',json.dumps(self.seen[-1]['history']))
            with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
            def revoke(*args,**kw):
                with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(self.uid,))
                return sensitive(*args,**kw)
            with patch('app.coach_chat.answer',side_effect=revoke):
                row=self.send(self.resume(v));self.assertTrue(row['cancelled'])

    def test_pagination_and_saved_message_limit(self):
        v=self.new()
        with db.connect() as c:
            kit_history.materialize(c,self.uid,v['conversation_id'])
            for n in range(55):
                c.execute('''INSERT INTO kit_turns(user_id,client_id,generation,conversation_id,question)
                  VALUES(%s,%s,%s,%s,%s)''',(self.uid,uuid.uuid4(),v['generation'],v['conversation_id'],'Fictional question '+str(n)))
            for _ in range(22):c.execute('INSERT INTO kit_threads(id,user_id) VALUES(%s,%s)',(uuid.uuid4(),self.uid))
        page=self.req('GET','/threads/'+v['conversation_id']);self.assertEqual(len(page['messages']),50)
        self.assertEqual(len(self.req('GET','/threads/'+v['conversation_id']+'?before='+str(page['before']))['messages']),5)
        page=self.req('GET','/threads');self.assertEqual(len(page['conversations']),20)
        self.assertEqual(len(self.req('GET','/threads?before='+page['before'])['conversations']),3)
        self.assertEqual(self.seen,[])


    def test_permanent_redaction_revoke_restore_delete_reimport_and_retry(self):
        v=self.new()
        with db.connect() as c:
            c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
            c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'walk','healthkit','Fictional walk',now())",(self.uid,))
        def sensitive(*args,**kw):
            result=self.answer(*args,**kw);result['health_included']=True;return result
        with patch('app.coach_chat.answer',side_effect=sensitive):first=self.send(v,'Fictional source-only first')
        for loss in ['revoke','delete']:
            with db.connect() as c:
                if loss=='revoke':
                    c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(self.uid,))
                    c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
                else:
                    c.execute('DELETE FROM activities WHERE user_id=%s',(self.uid,))
                    c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES(%s,'walk','healthkit','Fictional replacement',now())",(self.uid,))
            resumed=self.resume(v);row=next(r for r in resumed['messages'] if r['client_id']==first['client_id'])
            self.assertEqual(row['question'],first['question']);self.assertTrue(row['invalidated'])
            self.assertEqual(row['answer'],{'interpretation':kit_history.REMOVED_ANSWER})
            before=len(self.seen)
            retry=self.req('POST','/messages/'+first['client_id']+'/answer',{k:resumed[k] for k in ['visit_id','generation']})
            self.assertTrue(retry['invalidated']);self.assertEqual(len(self.seen),before)
            self.send(resumed)
            self.assertNotIn(first['question'],str(self.seen[-1]['history']))
            self.assertNotIn(kit_history.REMOVED_ANSWER,str(self.seen[-1]['history']))
            with patch('app.coach_chat.answer',side_effect=sensitive):first=self.send(resumed,'Fictional sensitive next')

    def test_revoke_restore_during_provider_call_cancels_late_answer(self):
        v=self.new()
        with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
        def revoke_restore(*args,**kw):
            with db.connect() as c:
                c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(self.uid,))
                c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
            self.assertFalse(kw['active']())
            return self.answer(*args,**kw)
        with patch('app.coach_chat.answer',side_effect=revoke_restore):self.assertTrue(self.send(v)['cancelled'])
        row=self.req('GET','/threads/'+v['conversation_id'])['messages'][0]
        self.assertEqual(row['answer']['interpretation'],kit_history.REMOVED_ANSWER)

    def test_empty_chats_not_saved_thread_cap_and_visit_rate_are_account_local(self):
        v=self.new();self.assertEqual(self.req('GET','/threads')['conversations'],[])
        self.req('POST','/threads',{k:v[k] for k in ['generation','conversation_id','visit_id']})
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) n FROM kit_threads WHERE user_id=%s',(self.uid,)).fetchone()['n'],0)
            self.assertEqual(c.execute('SELECT opens_count FROM kit_conversations WHERE user_id=%s',(self.uid,)).fetchone()['opens_count'],1)
            c.execute('UPDATE kit_conversations SET opens_count=30,opens_at=now() WHERE user_id=%s',(self.uid,))
        body={'generation':v['generation'],'conversation_id':str(uuid.uuid4()),'visit_id':str(uuid.uuid4())}
        self.req('POST','/threads',body,429)
        self.req('POST','/visits',{'visit_id':str(uuid.uuid4())},429)
        self.new(self.b)
        with db.connect() as c:
            c.execute("UPDATE kit_conversations SET opens_at=now()-interval '2 minutes' WHERE user_id=%s",(self.uid,))
            for _ in range(500):c.execute('INSERT INTO kit_threads(id,user_id) VALUES(%s,%s)',(uuid.uuid4(),self.uid))
        self.req('POST','/threads',body,429)
        pending={'generation':v['generation'],'visit_id':v['visit_id'],'client_id':str(uuid.uuid4()),'question':'Fictional limit question'}
        self.req('POST','/messages',pending,429)
        with db.connect() as c:c.execute('DELETE FROM kit_threads WHERE user_id=%s',(self.uid,))
        self.send(v);self.assertEqual(len(self.req('GET','/threads')['conversations']),1)

    def test_visit_cap_and_expiry_cleanup(self):
        v=self.new();self.send(v)
        with db.connect() as c:
            for _ in range(99):c.execute('INSERT INTO kit_visits(id,user_id) VALUES(%s,%s)',(uuid.uuid4(),self.uid))
        body={'generation':v['generation'],'visit_id':str(uuid.uuid4())}
        self.req('POST','/threads/'+v['conversation_id']+'/resume',body,429)
        with db.connect() as c:c.execute("UPDATE kit_visits SET created=now()-interval '2 days' WHERE user_id=%s",(self.uid,))
        self.assertEqual(len(self.resume(v)['messages']),1)

    def test_delete_all_erases_legacy_and_saved_visits_not_foreign(self):
        v=self.new();self.send(v)
        legacy=self.req('POST','/visits',{'visit_id':str(uuid.uuid4())});self.send(legacy)
        foreign=self.new(self.b)
        self.req('DELETE','/threads')
        with db.connect() as c:
            for table in ['kit_turns','kit_visits','kit_threads']:
                self.assertEqual(c.execute('SELECT count(*) n FROM '+table+' WHERE user_id=%s',(self.uid,)).fetchone()['n'],0)
        self.req('GET','/threads/'+foreign['conversation_id'],client=self.b)

    def test_quarantine_hides_history_titles_counts_and_replay_without_erasing(self):
        v=self.new();old=self.send(v,'Fictional legacy source question')
        with db.connect() as c:
            original=c.execute('SELECT answer FROM kit_turns WHERE user_id=%s AND id=%s',(self.uid,old['id'])).fetchone()['answer']
            c.execute('UPDATE kit_turns SET replay_blocked_at=now() WHERE user_id=%s AND id=%s',(self.uid,old['id']))
        self.assertEqual(self.req('GET','/threads/'+v['conversation_id'])['messages'],[])
        listed=self.req('GET','/threads')['conversations'][0]
        self.assertEqual(listed['message_count'],0);self.assertEqual(listed['title'],'New conversation')
        self.req('POST','/messages/'+old['client_id']+'/answer',{k:v[k] for k in ['generation','visit_id']},status=404)
        self.req('POST','/messages',{'client_id':old['client_id'],'generation':v['generation'],'visit_id':v['visit_id'],'question':'Fictional legacy source question'},status=404)
        self.send(v,'Fictional visible new question')
        self.assertEqual(self.seen[-1]['history'],[])
        visible=self.req('GET','/threads/'+v['conversation_id'])['messages']
        self.assertEqual([r['question'] for r in visible],['Fictional visible new question'])
        with db.connect() as c:
            row=c.execute('SELECT answer,invalidated_at FROM kit_turns WHERE user_id=%s AND id=%s',(self.uid,old['id'])).fetchone()
            self.assertEqual(row['answer'],original);self.assertIsNone(row['invalidated_at'])


if __name__=='__main__':unittest.main()
