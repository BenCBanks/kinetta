"""Context and clarification contracts with provider stand-ins; fictional records only."""
import json
from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4
from app import coach_chat, db, kit_conversation, kit_coaching, kit_thread

profile={'evidence_id':'e1','tool':'profile','data':{'units':'metric'}}
raw={'blocks':[{'kind':'paragraph','text':'Choose when your next walk fits around work.'}],
     'facts':[], 'clarifying_question':'Which day would work for your next walk?'}
answer=kit_conversation.checked_answer(raw,[profile],question='What next?')
assert answer['answer_blocks'][-1]['text']==raw['clarifying_question']
assert answer['interpretation'].endswith(raw['clarifying_question'])
assert 'clarifying_question' not in answer,'the client needs no separate question renderer'
assert raw['blocks']==[{'kind':'paragraph','text':'Choose when your next walk fits around work.'}]
for question in ['Which day? What time?', 'Which day', 'Your recorded distance is 99 km?', 'You have diabetes?']:
    bad={**raw,'clarifying_question':question}
    try:kit_conversation.checked_answer(bad,[profile],question='What next?')
    except ValueError:pass
    else:raise AssertionError(question)
legacy={k:v for k,v in raw.items() if k!='clarifying_question'}
assert len(kit_conversation.checked_answer(legacy,[profile])['answer_blocks'])==1
repeat=deepcopy(raw);repeat['blocks'][0]['text']='Which activity works for you?'
try:kit_conversation.checked_answer(repeat,[profile])
except ValueError:pass
else:raise AssertionError('Repeated question')
# Goals still require an exact current-turn value and are labelled as a target.
goals={'evidence_id':'e2','tool':'goals','data':{'activity_goals':[{'sport':'walk','period':'week','metric':'count','target':3}]}}
example={'blocks':[{'kind':'paragraph','text':'Your saved walking target is {e2:0}. Choose a day for your next walk.'}],
         'facts':[{'evidence_id':'e2','path':['activity_goals',0,'target'],'value':3}]}
assert '3' in kit_conversation.checked_answer(example,[profile,goals])['interpretation']
unsupported=deepcopy(example);unsupported['facts'][0]['value']=7
try:kit_conversation.checked_answer(unsupported,[profile,goals])
except ValueError:pass
else:raise AssertionError('Remembered numbers are not fresh evidence')
# Real account/turn/memory selection, with the existing answer runner replaced by a stand-in.
uids=[];seen=[]
try:
    with db.connect() as c:
        for _ in range(2):
            uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                ('zz_test_context_'+uuid4().hex,'Fictional context')).fetchone()['id'];uids.append(uid)
            c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())',(uid,))
    def stand_in(uid,question,**kwargs):
        seen.append((question,kwargs));assert kwargs['active']()
        return kit_conversation.checked_answer(raw,[profile],question=question)
    with patch('app.ai_release.enabled',return_value=True),patch('app.coach.allowed',return_value=True), \
         patch('app.kit_thread.brake'),patch('app.coach_chat.answer',side_effect=stand_in), \
         patch('urllib.request.urlopen',side_effect=AssertionError('No provider network')):
        with db.connect() as c:
            c.execute("INSERT INTO activities(user_id,name,sport,source,start_time) VALUES(%s,'Fictional private Health walk','walk','healthkit',now())",(uids[0],))
        generation=kit_thread.read(user={'id':uids[0]},before=None,visit_id=None)['generation']
        with db.connect() as c:
            c.execute("INSERT INTO kit_memories(user_id,text,health_included) VALUES(%s,'I prefer walking.',false),(%s,'Private other memory.',false),(%s,'Health sensitive memory.',true)",(uids[0],uids[1],uids[0]))
        def send(question):
            cid=uuid4();kit_thread.create(kit_thread.MessageIn(client_id=cid,generation=generation,question=question),user={'id':uids[0]})
            return kit_thread.generate(cid,kit_thread.GenerationIn(generation=generation),user={'id':uids[0]})
        assert send('I prefer riding now. What next?')['state']=='answered'
        prompt,kwargs=seen[-1]
        assert 'I prefer walking.' in prompt and prompt.endswith('Question: I prefer riding now. What next?')
        assert 'Private other memory' not in prompt and 'Health sensitive memory' not in prompt
        send('Which day should I choose?')
        assert any(h['role']=='user' and 'I prefer riding now.' in h['text'] for h in seen[-1][1]['history'])
        with db.connect() as c:
            c.execute('UPDATE kit_conversations SET memory_enabled=false WHERE user_id=%s',(uids[0],))
        send('Where do I change my goal?')
        assert 'I prefer walking.' not in seen[-1][0] and 'I prefer riding now.' not in seen[-1][0]
        # Memory-off does not delete the explicitly retained current conversation.
        assert seen[-1][1]['history']
finally:
    if uids:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
print('Contextual coaching: exact targets, single checked question, current message precedence, own/consent-filtered memory, recent turns and opt-out PASS; no providers')
