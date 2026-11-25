"""Fictional PostgreSQL turn admission/pre-provider cleanup and stored-redaction proof."""
import json
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import auth,db,ai_budget
from app.food_photo import brake
from app.main import app

ROOT='/api/coach/conversation'


class HistoryLimits(unittest.TestCase):
    def setUp(self):
        login='zz_test_history_limits_'+uuid.uuid4().hex[:8]
        with db.connect() as c:
            self.uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
              (login,'Fictional Historian',auth.hash_pw('green kettle after morning walk'))).fetchone()['id']
            c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(self.uid,))
        self.client=TestClient(app);self.client.headers['Origin']='http://testserver';self.client.headers['Content-Type']='application/json'
        self.assertEqual(self.client.post('/api/login',json={'login':login,'password':'green kettle after morning walk'}).status_code,200)
        self.calls=0
        self.patches=[patch.dict('os.environ',{'KINETTA_KIT_HISTORY_ENABLED':'1'}),
          patch('app.coach.provider',return_value='gemini'),patch('app.ai_release.enabled',return_value=True),
          patch('app.coach_chat.answer',side_effect=self.answer),
          patch('urllib.request.urlopen',side_effect=AssertionError('No provider calls'))]
        for p in self.patches:p.start()
        self.generation=self.req('GET','/threads')['generation']
        self.body={'conversation_id':str(uuid.uuid4()),'visit_id':str(uuid.uuid4()),'generation':self.generation}
        self.req('POST','/threads',self.body)
        self.answer_body={k:self.body[k] for k in ['generation','visit_id']}

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.client.close()
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(self.uid,))

    def req(self,method,path,body=None,status=200):
        r=self.client.request(method,ROOT+path,json=body)
        self.assertEqual(r.status_code,status,(path,r.text[:400]));return r.json()

    def message(self):
        return {'client_id':str(uuid.uuid4()),'generation':self.generation,
          'visit_id':self.body['visit_id'],'question':'Fictional bounded question'}

    def answer(self,*args,**kw):
        self.calls+=1
        return {'interpretation':'Fictional answer','health_included':False}

    def counts(self):
        with db.connect() as c:
            return tuple(c.execute('SELECT count(*) n FROM '+t+' WHERE user_id=%s',(self.uid,)).fetchone()['n'] for t in ['kit_threads','kit_turns'])

    def test_chat_cap_serializes_at_200_and_preserves_idempotent_retry(self):
        first=self.message();self.req('POST','/messages',first)
        self.req('POST','/messages/'+first['client_id']+'/answer',self.answer_body)
        with db.connect() as c:
            for _ in range(198):
                c.execute('''INSERT INTO kit_turns(user_id,client_id,generation,conversation_id,question,state,answer)
                  VALUES(%s,%s,%s,%s,'Fictional earlier question','answered','{"health_included":false}')''',
                  (self.uid,uuid.uuid4(),self.generation,self.body['conversation_id']))
        # Concurrent devices cannot both admit the 200th turn.
        bodies=[self.message(),self.message()]
        with ThreadPoolExecutor(max_workers=2) as pool:
            replies=list(pool.map(lambda b:self.client.post(ROOT+'/messages',json=b),bodies))
        self.assertEqual(sorted(r.status_code for r in replies),[200,429])
        accepted=next(b for b,r in zip(bodies,replies) if r.status_code==200)
        self.assertEqual(self.req('POST','/messages',accepted)['client_id'],accepted['client_id'])
        self.req('POST','/messages/'+accepted['client_id']+'/answer',self.answer_body)
        self.req('POST','/messages',self.message(),status=429)
        self.assertEqual(self.counts(),(1,200))
        self.req('POST','/visits/'+self.body['visit_id']+'/end')
        unlinked=self.message();unlinked.pop('visit_id')
        self.req('POST','/messages',unlinked)
        self.req('POST','/messages/'+unlinked['client_id']+'/answer',{'generation':self.generation})
        self.req('POST','/threads',{**self.body,'conversation_id':str(uuid.uuid4()),'visit_id':str(uuid.uuid4())})
        # Legacy chats have the same cap, scoped to their visit.
        visit=self.req('POST','/visits',{'visit_id':str(uuid.uuid4())})
        with db.connect() as c:
            for _ in range(200):
                c.execute("INSERT INTO kit_turns(user_id,client_id,generation,visit_id,question,state) VALUES(%s,%s,%s,%s,'Fictional legacy','failed')",
                  (self.uid,uuid.uuid4(),self.generation,visit['visit_id']))
        self.req('POST','/messages',{**self.message(),'visit_id':visit['visit_id']},status=429)

    def test_exhausted_daily_quota_creates_no_turn_or_empty_saved_chat(self):
        with db.connect() as c:
            c.execute("INSERT INTO ai_daily_usage(user_id,day,kind,requests) VALUES(%s,(now() AT TIME ZONE 'UTC')::date,'kit_conversation',30)",(self.uid,))
        for _ in range(4):self.req('POST','/messages',self.message(),status=429)
        self.assertEqual(self.counts(),(0,0));self.assertEqual(self.calls,0)

    def test_pre_generation_failures_are_not_saved_but_attempted_failures_can_retry(self):
        for failure in [HTTPException(429,'Fictional rate limit'),HTTPException(503,'Fictional budget unavailable'),ValueError('Fictional preflight unavailable')]:
            row=self.req('POST','/messages',self.message())
            with patch('app.coach_chat.answer',side_effect=failure):
                self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body,status=429 if isinstance(failure,HTTPException) and failure.status_code==429 else 503)
            self.assertEqual(self.counts(),(0,0))
        row=self.req('POST','/messages',self.message())
        with patch('app.kit_thread.brake',side_effect=HTTPException(429,'Fictional race at daily cap')):
            self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body,status=429)
        self.assertEqual(self.counts(),(0,0))
        row=self.req('POST','/messages',self.message())
        def provider_rate_limit(*args,**kwargs):
            ai_budget._reserved_hook.get()(uuid.uuid4())
            raise HTTPException(429,'Fictional provider rate limit')
        with patch('app.coach_chat.answer',side_effect=provider_rate_limit):
            self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body,status=429)
        self.assertEqual(self.counts(),(0,0))
        # Provider reservation hook means an actual attempt began; validation
        # failure is retained so Retry does not silently repeat paid work.
        row=self.req('POST','/messages',self.message())
        def attempted(*args,**kwargs):
            ai_budget._reserved_hook.get()(uuid.uuid4())
            raise ValueError('Fictional post-generation validation failed')
        with patch('app.coach_chat.answer',side_effect=attempted):
            result=self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body)
        self.assertEqual(result['state'],'failed');self.assertEqual(self.counts(),(1,1))
        self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body)
        self.assertEqual(self.counts(),(1,1))

    def test_access_preflight_removes_new_turn(self):
        row=self.req('POST','/messages',self.message())
        with patch('app.ai_release.enabled',return_value=False):
            self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body,status=503)
        self.assertEqual(self.counts(),(0,0));self.assertEqual(self.calls,0)
        row=self.req('POST','/messages',self.message())
        with patch.dict('os.environ',{'KINETTA_KIT_HISTORY_ENABLED':'0'}):
            self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body,status=409)
        self.assertEqual(self.counts(),(0,0))

    def test_personal_sql_reads_own_question_but_original_answer_is_physically_null(self):
        row=self.req('POST','/messages',self.message());self.req('POST','/messages/'+row['client_id']+'/answer',self.answer_body)
        role='zz_test_history_reader_'+uuid.uuid4().hex[:8];password=uuid.uuid4().hex
        with db.connect() as c:
            c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
            c.execute('UPDATE kit_turns SET answer=%s WHERE user_id=%s',(json.dumps({'interpretation':'Fictional sensitive answer','health_included':True}),self.uid))
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} IN ROLE fit_readers').format(sql.Identifier(role),sql.Literal(password)))
            c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.uid))
        try:
            with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as c:
                self.assertEqual(c.execute('SELECT answer FROM kit_turns').fetchone()['answer']['interpretation'],'Fictional sensitive answer')
            with db.connect() as c:
                c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(self.uid,))
                c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(self.uid,))
            with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as c:
                stored=c.execute('SELECT question,answer,invalidated_at FROM kit_turns').fetchone()
                self.assertEqual(stored['question'],row['question']);self.assertIsNone(stored['answer'])
                self.assertIsNotNone(stored['invalidated_at'])
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.uid,))
                c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


if __name__=='__main__':unittest.main()
