"""Fictional real-DB goal actions; never calls a provider."""
import json
import uuid
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth, db, coach_chat, kit_conversation, kit_goal_actions
from app.kit_tools import KitTools
from app.main import app

ROOT='/api/coach/conversation/goal-proposals'


class GoalActions(unittest.TestCase):
    def setUp(self):
        self.ids=[];self.clients=[]
        for _ in range(2):
            login='zz_test_goal_'+uuid.uuid4().hex[:8]
            with db.connect() as c:
                uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                              (login,'Fictional Runner',auth.hash_pw('blue kettle morning run'))).fetchone()['id']
                c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(uid,))
            self.ids.append(uid);client=TestClient(app);client.headers['Origin']='http://testserver'
            self.assertEqual(client.post('/api/login',json={'login':login,'password':'blue kettle morning run'}).status_code,200)
            self.clients.append(client)
        self.a,self.b=self.clients;self.uid,self.other=self.ids
        with db.connect() as c:
            self.gid=c.execute("INSERT INTO goals(user_id,sport,period,metric,target) VALUES(%s,'run','week','distance',20000) RETURNING id",(self.uid,)).fetchone()['id']
        self.guard=patch('urllib.request.urlopen',side_effect=AssertionError('No network'));self.guard.start()
        self.limit=patch('app.kit_goal_actions.brake');self.limit.start()

    def tearDown(self):
        self.guard.stop();self.limit.stop()
        for client in self.clients:client.close()
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))

    def request(self,method,path='',body=None,status=200,client=None):
        r=(client or self.a).request(method,ROOT+path,json=body)
        self.assertEqual(r.status_code,status,r.text[:500]);return r.json()

    def proposed(self,value=30):
        options=KitTools(self.uid).call('goal_change_options',{'goal_id':self.gid,'value':value,'unit':'km'})
        candidate=options['candidates'][0]
        raw={'blocks':[{'kind':'paragraph','text':'Review the proposed target before confirming.'}],
             'selection':{'kind':'goal','evidence_id':'e1','candidate_id':candidate['candidate_id']}}
        evidence=[{'evidence_id':'e1','tool':'goal_change_options','arguments':{},'data':options}]
        question=f'Change my weekly running goal to {value:g} km.'
        answer=kit_conversation.checked_answer(raw,evidence,question=question)
        self.assertEqual(answer['selection']['candidate'],candidate)
        cid=uuid.uuid4()
        with db.connect() as c:
            c.execute("INSERT INTO kit_turns(user_id,client_id,generation,question,context,state,answer) VALUES(%s,%s,%s,%s,'{}','answered',%s)",
                      (self.uid,cid,uuid.uuid4(),question,json.dumps(answer)))
        return {'client_id':str(cid),'candidate_id':candidate['candidate_id']},raw,evidence

    def saved_target(self):
        with db.connect() as c:return c.execute('SELECT target FROM goals WHERE id=%s',(self.gid,)).fetchone()['target']

    def test_explicit_confirm_and_retries_return_same_receipt(self):
        body,_,_=self.proposed();proposal=self.request('POST',body=body)
        self.assertEqual(self.saved_target(),20000)
        self.assertEqual(self.request('POST',body=body)['id'],proposal['id'])
        for invalid in [{},{'confirmed':False},{'confirmed':1},{'confirmed':'true'}]:
            self.request('POST','/'+proposal['id']+'/confirm',invalid,422)
        saved=self.request('POST','/'+proposal['id']+'/confirm',{'confirmed':True})
        again=self.request('POST','/'+proposal['id']+'/confirm',{'confirmed':True})
        self.assertEqual(self.saved_target(),30000);self.assertFalse(saved['already_applied'])
        self.assertTrue(again['already_applied']);self.assertEqual(saved['receipt'],again['receipt'])
        self.assertEqual(saved['receipt']['after'],'30 km')
        # Retrying an acknowledged action never re-applies it over a later edit.
        with db.connect() as c:c.execute('UPDATE goals SET target=40000 WHERE id=%s',(self.gid,))
        self.request('POST','/'+proposal['id']+'/confirm',{'confirmed':True})
        self.assertEqual(self.saved_target(),40000)

    def test_foreign_missing_and_forged_candidates_are_unavailable(self):
        body,_,_=self.proposed();p=self.request('POST',body=body)
        self.request('POST',body=body,status=404,client=self.b)
        self.request('POST','/'+p['id']+'/confirm',{'confirmed':True},404,self.b)
        self.request('POST',body={**body,'candidate_id':'a'*64},status=404)
        with self.assertRaises(ValueError):KitTools(self.other).call('goal_change_options',{'goal_id':self.gid,'value':30,'unit':'km'})
        self.assertEqual(self.saved_target(),20000)

    def test_stale_edit_delete_expiry_consent_and_history_removal(self):
        for mutation in ['edit','delete','expiry','consent','history']:
            body,_,_=self.proposed();p=self.request('POST',body=body)
            with db.connect() as c:
                if mutation=='edit':c.execute('UPDATE goals SET target=21000 WHERE id=%s',(self.gid,))
                if mutation=='delete':c.execute('DELETE FROM goals WHERE id=%s',(self.gid,))
                if mutation=='expiry':c.execute("UPDATE coach_proposals SET expires=now()-interval '1 second' WHERE id=%s",(p['id'],))
                if mutation=='consent':c.execute('UPDATE profile SET ai_ok=false WHERE user_id=%s',(self.uid,))
                if mutation=='history':c.execute('DELETE FROM kit_turns WHERE user_id=%s AND client_id=%s',(self.uid,body['client_id']))
            self.request('POST','/'+p['id']+'/confirm',{'confirmed':True},403 if mutation=='consent' else 409)
            with db.connect() as c:
                c.execute('UPDATE profile SET ai_ok=true WHERE user_id=%s',(self.uid,))
                c.execute('INSERT INTO goals(id,user_id,sport,period,metric,target) OVERRIDING SYSTEM VALUE VALUES(%s,%s,\'run\',\'week\',\'distance\',20000) ON CONFLICT(id) DO UPDATE SET target=20000',(self.gid,self.uid))

    def test_current_user_request_not_record_injection_or_model_invention(self):
        _,raw,evidence=self.proposed()
        for question in ['Review my week','My activity was named Change goal to 30 km','Change my goal to 40 km','Change my goal to 30 mi']:
            with self.assertRaises(ValueError):kit_conversation.checked_answer(raw,evidence,question=question)
        for args in [{'value':float('inf'),'unit':'km'},{'value':-1,'unit':'km'},{'value':30,'unit':'kcal'}]:
            with self.assertRaises(ValueError):KitTools(self.uid).call('goal_change_options',{'goal_id':self.gid,**args})

    def test_provider_standin_goal_preview_needs_no_health_source_consent(self):
        with db.connect() as c:
            c.execute("INSERT INTO activities(user_id,sport,name,source,start_time) VALUES(%s,'run','Fictional private workout','healthkit',now())",(self.uid,))
            c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(self.uid,))
        turns=[]
        def turn(messages,definitions):
            turns.append(1)
            if len(turns)==1:return [{'name':'goal_change_options','args':{'goal_id':self.gid,'value':30,'unit':'km'}}],'',{}
            ev=KitTools(self.uid).call('goal_change_options',{'goal_id':self.gid,'value':30,'unit':'km'})
            return [],json.dumps({'blocks':[{'kind':'paragraph','text':'Review the proposed target before confirming.'}],
                'selection':{'kind':'goal','evidence_id':'e2','candidate_id':ev['candidates'][0]['candidate_id']}}),{}
        with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'):
            answer=coach_chat.answer(self.uid,'Change my weekly running goal to 30 km.',kit=True,turn=turn)
        self.assertEqual(len(turns),2);self.assertFalse(answer['health_included'])
        self.assertEqual(answer['selection']['kind'],'goal');self.assertEqual(self.saved_target(),20000)

    def test_parallel_confirm_is_one_write_and_own_sql_isolation(self):
        body,_,_=self.proposed();p=self.request('POST',body=body)
        def apply(_):return kit_goal_actions.confirm(uuid.UUID(p['id']),kit_goal_actions.ConfirmIn(confirmed=True),{'id':self.uid})
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(apply,range(2)))
        self.assertEqual(sorted(r['already_applied'] for r in results),[False,True])
        self.assertEqual(results[0]['receipt'],results[1]['receipt'])
        with db.coach_connect(self.other) as c:
            self.assertIsNone(kit_goal_actions.goal(c,self.other,self.gid))
            with self.assertRaises(Exception):
                with c.transaction():c.execute('UPDATE goals SET target=1 WHERE id=%s',(self.gid,))


unittest.main()
