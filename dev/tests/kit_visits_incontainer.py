"""Real PostgreSQL visit/memory/privacy regressions; all model answers are stand-ins."""
import json,threading,uuid,zipfile,tempfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi.testclient import TestClient
from app import auth,db,kit_memory,api_account
from app.main import app
from app.api_mydata import _write_export
from app.coach_chat import answer as real_answer
root='/api/coach/conversation';uids=[];seen=[]
def request(client,method,path,body=None,status=200):
    r=client.request(method,root+path,json=body)
    assert r.status_code==status,(path,r.status_code,r.text[:400])
    return r.json()
def response(uid,question,**kw):
    seen.append((uid,question,kw))
    return {'interpretation':'Keep your current goals in view.','facts':[],'health_included':False,'actions':[]}
try:
    clients=[]
    for suffix in ['a','b']:
        name='zz_test_visits_'+suffix+uuid.uuid4().hex[:8]
        with db.connect() as c:
            uid=c.execute('INSERT INTO users(login,name,pw_hash) VALUES (%s,%s,%s) RETURNING id',(name,'Fictional visit tester',auth.hash_pw('green kettle after morning walk'))).fetchone()['id'];uids.append(uid)
            c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(uid,))
            assert c.execute('SELECT share_default FROM profile WHERE user_id=%s',(uid,)).fetchone()['share_default']=='everyone'
        client=TestClient(app);client.headers['Origin']='http://testserver';client.headers['Content-Type']='application/json';assert client.post('/api/login',json={'login':name,'password':'green kettle after morning walk'}).status_code==200;clients.append(client)
    a,b=clients;uid,other=uids
    from app.api_account import _create,NewAccountIn
    original=api_account.reserved_login
    with patch.object(api_account,'reserved_login',side_effect=lambda v,**kw:original(v,allow_test=True)),db.connect() as c:
        chosen=_create(c,NewAccountIn(name='Fictional private signup',login='zz_test_choice_'+uuid.uuid4().hex[:8],password='green kettle after morning walk',share_default='me'));uids.append(chosen)
        assert c.execute('SELECT share_default FROM profile WHERE user_id=%s',(chosen,)).fetchone()['share_default']=='me'

    def visit(client=a):
        ident=str(uuid.uuid4());v=request(client,'POST','/visits',{'visit_id':ident});assert v['visit_id']==ident;return v
    def body(v,text):return {'client_id':str(uuid.uuid4()),'generation':v['generation'],'visit_id':v['visit_id'],'question':text}
    def ask(v,text):
        message=body(v,text);request(a,'POST','/messages',message)
        answer=request(a,'POST','/messages/'+message['client_id']+'/answer',{'generation':v['generation'],'visit_id':v['visit_id']});assert answer['state']=='answered';return message
    assert TestClient(app).get(root+'/memory').status_code==401
    with patch('app.coach.provider',return_value='gemini'),patch('app.ai_release.enabled',return_value=True),patch('app.coach_chat.answer',side_effect=response),patch('app.kit_thread.brake'),patch('urllib.request.urlopen',side_effect=AssertionError('No network')):
        first=visit();second=visit();foreign=visit(b)
        request(a,'POST','/visits',{'visit_id':first['visit_id']}) # lost start acknowledgement is idempotent
        request(b,'POST','/visits',{'visit_id':first['visit_id']},409)
        message=ask(first,'I prefer vegetarian meals. What could I eat tonight?')
        assert len(request(a,'GET','?visit_id='+first['visit_id'])['messages'])==1
        assert not request(a,'GET','?visit_id='+second['visit_id'])['messages']
        assert not request(b,'GET','?visit_id='+foreign['visit_id'])['messages']
        request(b,'GET','?visit_id='+first['visit_id'],status=409)
        memory=request(a,'GET','/memory');assert memory['memories'][0]['text']=='I prefer vegetarian meals.'
        assert 'What could' not in memory['memories'][0]['text'],'question is not a saved preference'
        assert not request(b,'GET','/memory')['memories']
        ask(second,'What should I focus on?')
        assert 'I prefer vegetarian meals.' in seen[-1][1] and not seen[-1][2]['history'],'new visit has saved context, not the prior transcript'
        # Closing one visit leaves another device's visit open, and rejects old sends.
        request(a,'POST','/visits/'+first['visit_id']+'/end')
        request(a,'POST','/messages',body(first,'I run in the morning.'),409)
        assert request(a,'GET','?visit_id='+second['visit_id'])['messages']
        with db.connect() as c:assert not c.execute('SELECT 1 FROM kit_turns WHERE user_id=%s AND visit_id=%s',(uid,first['visit_id'])).fetchone()
        # A leave can reach the server before its opening request. Never resurrect that visit.
        early=str(uuid.uuid4());request(a,'POST','/visits/'+early+'/end');request(a,'POST','/visits',{'visit_id':early},409)
        # Forgetting a foreign memory is a no-op; owner memory remains.
        mid=memory['memories'][0]['id'];request(b,'DELETE','/memory/'+str(mid));assert request(a,'GET','/memory')['memories']
        request(a,'DELETE','/memory/'+str(mid));assert not request(a,'GET','/memory')['memories']
        third=visit();ask(third,'Can you review my food?');assert 'Remembered user statements' not in seen[-1][1]
        ask(third,"I'm training for a short race.");assert request(a,'GET','/memory')['memories'][0]['text']=="I'm training for a short race."
        request(a,'PUT','/memory',{'enabled':False});assert not request(a,'GET','/memory')['memories']
        ask(third,'I prefer evening walks.');assert not request(a,'GET','/memory')['memories']
        request(a,'PUT','/memory',{'enabled':'true'},422);request(a,'PUT','/memory',{'enabled':True})
        # Memory is bounded, exact user wording, not generated answers/questions/uncertainty.
        with db.connect() as c:
            for n in range(15):kit_memory.remember(c,uid,'I prefer fictional routine '+str(n)+'.')
            for text in ['What should I eat?','I might try running.','I prefer this?','A made-up assistant conclusion','I prefer '+('x'*410)]:kit_memory.remember(c,uid,text)
        rows=request(a,'GET','/memory')['memories'];assert len(rows)==12
        assert all(row['text'].startswith('I prefer fictional routine ') for row in rows)
        request(a,'DELETE','/memory');assert not request(a,'GET','/memory')['memories']
        # Do not restore a forgotten memory or an ended visit after a slow answer.
        started=threading.Event();release=threading.Event()
        def slow(*args,**kw):started.set();assert release.wait(10);return response(*args,**kw)
        pending=body(third,'I train on Sundays.');request(a,'POST','/messages',pending)
        with patch('app.coach_chat.answer',side_effect=slow),ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(request,a,'POST','/messages/'+pending['client_id']+'/answer',{'generation':third['generation'],'visit_id':third['visit_id']});assert started.wait(10)
            request(a,'DELETE','/memory');release.set();assert future.result()['state']=='answered'
        assert not request(a,'GET','/memory')['memories']
        started.clear();release.clear();pending=body(third,'I train in the evenings.');request(a,'POST','/messages',pending)
        with patch('app.coach_chat.answer',side_effect=slow),ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(request,a,'POST','/messages/'+pending['client_id']+'/answer',{'generation':third['generation'],'visit_id':third['visit_id']});assert started.wait(10)
            request(a,'POST','/visits/'+third['visit_id']+'/end');release.set();assert future.result()['cancelled']
        assert not request(a,'GET','/memory')['memories']
        # Consent revoked before/while remembered Health context is sent is respected.
        with db.connect() as c:
            c.execute("INSERT INTO activities(user_id,sport,source,name,start_time) VALUES (%s,'walk','healthkit','Fictional Health walk',now())",(uid,))
            kit_memory.remember(c,uid,'I prefer a gentle recovery walk.',True)
        fourth=visit();ask(fourth,'Help me choose my next step.');assert 'gentle recovery' not in seen[-1][1]
        with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(uid,))
        ask(fourth,'What can I try?');assert 'gentle recovery' in seen[-1][1]
        started.clear();release.clear();pending=body(fourth,'Help with my routine.');request(a,'POST','/messages',pending)
        with patch('app.coach_chat.answer',side_effect=slow),ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(request,a,'POST','/messages/'+pending['client_id']+'/answer',{'generation':fourth['generation'],'visit_id':fourth['visit_id']});assert started.wait(10)
            with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(uid,))
            release.set();result=future.result();assert result['state']=='failed' and not result['answer']
        # Leaving during a provider round prevents a second paid round, not just late rendering.
        fifth=visit();pending=body(fifth,'Help me use Kinetta.');request(a,'POST','/messages',pending);turns=[]
        def end_during_turn(messages,definitions,**kwargs):
            turns.append(True);request(a,'POST','/visits/'+fifth['visit_id']+'/end')
            return [{'name':'profile','args':{},'id':'one'}],'',{}
        with patch('app.coach_chat.answer',side_effect=real_answer),patch('app.coach_chat._gemini_turn',side_effect=end_during_turn):
            result=request(a,'POST','/messages/'+pending['client_id']+'/answer',{'generation':fifth['generation'],'visit_id':fifth['visit_id']})
            assert result['cancelled'] and len(turns)==1
        # A permission change during profile preloading must stop the FIRST provider call.
        # No remembered Health context may slip through between the history read and transport.
        with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=true WHERE user_id=%s',(uid,))
        sixth=visit();pending=body(sixth,'Help me choose a routine.');request(a,'POST','/messages',pending)
        from app.kit_tools import KitTools
        original_call=KitTools.call
        def revoke_after_profile(self,name,args):
            value=original_call(self,name,args)
            if name=='profile':
                with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(uid,))
            return value
        with patch('app.coach_chat.answer',side_effect=real_answer),patch('app.kit_tools.KitTools.call',new=revoke_after_profile),patch('app.coach_chat._gemini_turn') as transport:
            result=request(a,'POST','/messages/'+pending['client_id']+'/answer',{'generation':sixth['generation'],'visit_id':sixth['visit_id']})
            assert result['state']=='failed' and not result['answer'] and not transport.called
            assert 'Apple Health' in result['error']
        # Memory is personal exported data; visits/messages/memories cascade on account deletion.
        with tempfile.NamedTemporaryFile(suffix='.zip') as f:
            _write_export(uid,f.name)
            with zipfile.ZipFile(f.name) as z:assert 'data/kit_memories.jsonl' in z.namelist() and 'data/kit_visits.jsonl' in z.namelist()
        with db.connect() as c:
            for name in ['kit_visits','kit_memories']:
                assert c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s',(name,)).fetchone()['relrowsecurity']
                assert c.execute("SELECT 1 FROM pg_policies WHERE tablename=%s AND policyname='own_rows'",(name,)).fetchone()
                assert c.execute('SELECT has_table_privilege(\'fit_readers\',%s,\'SELECT\') AS ok',(name,)).fetchone()['ok']
            c.execute('DELETE FROM users WHERE id=%s',(uid,))
            assert not c.execute('SELECT 1 FROM kit_memories WHERE user_id=%s',(uid,)).fetchone()
            assert not c.execute('SELECT 1 FROM kit_visits WHERE user_id=%s',(uid,)).fetchone()
    print('Kit visits/memory: fresh sessions, independent devices, tombstones, exact/bounded preferences, off/forget/races, Health revocation, RLS/export/delete, new sharing default PASS')
finally:
    for uid in uids:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
