"""Fictional latency guards: bounded Kit reads and prompt stream visibility."""
import asyncio
import time
import json
from contextvars import ContextVar
from threading import Barrier, Event, Lock
from unittest.mock import patch
from app import coach, coach_chat


calls=[]
parallel_read=Barrier(2,timeout=5)
marker=ContextVar("fictional_kit_latency",default=None)
marker.set("own-request")
def fake_tool(self, name, arguments, *, connection=None):
    calls.append(name)
    assert marker.get()=="own-request", "request context reaches every read worker"
    if name=='profile':
        return {'today':'2026-11-26','tz':'UTC','units':'imperial'}
    parallel_read.wait()  # Serial execution cannot reach both readers.
    time.sleep(.15)
    return {'features':[]} if name=='app_features' else {'activity_goals':[],'nutrition':{}}


def turn(messages, definitions):
    if len(messages)==1:
        return ([{'name':'goals','args':{}},{'name':'app_features','args':{}}], '', {})
    responses=[p['functionResponse'] for p in messages[-1]['parts']]
    assert [p['response']['evidence_id'] for p in responses]==['e2','e3'], responses
    assert [p['name'] for p in responses]==['goals','app_features'], responses
    return ([], '{"blocks":[{"kind":"paragraph","text":"A checked fictional answer."}],"facts":[]}',
            {'promptTokenCount':10,'candidatesTokenCount':8,'totalTokenCount':18})


started=time.monotonic()
with patch('app.coach.allowed',return_value=True), patch('app.coach.provider',return_value='gemini'), \
     patch('app.coach.health_ok',return_value=True), patch('app.kit_tools.KitTools.call',new=fake_tool):
    answer=coach_chat.answer(987,'How do I use my saved goals?',kit=True,turn=turn)
elapsed=time.monotonic()-started
assert calls[0]=='profile' and set(calls[1:])=={'goals','app_features'}, calls
assert answer['tools_used']==['profile','goals','app_features']
assert coach_chat.MAX_ROUNDS >= 2
print(f'Kit latency: two independent fictional reads overlap ({elapsed:.3f}s), evidence order and validation preserved PASS')


reads=[]
def repeated_tool(self,name,arguments,*,connection=None):
    if name=='profile':return {'today':'2026-11-26','tz':'UTC','units':'imperial'}
    reads.append(name)
    return {'reading':len(reads)}
def duplicate_turn(messages,definitions):
    if len(messages)==1:return ([{'id':'a','name':'goals','args':{}},{'id':'b','name':'goals','args':{}}],'',{})
    responses=[p['functionResponse'] for p in messages[-1]['parts']]
    assert [p['id'] for p in responses]==['a','b']
    assert [p['response']['evidence_id'] for p in responses]==['e2','e3']
    assert responses[0]['response']['data']==responses[1]['response']['data']=={'reading':1}
    return ([],json.dumps({'blocks':[{'kind':'paragraph','text':'Checked fictional duplicate read.'}],'facts':[]}),{})
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
     patch('app.kit_tools.KitTools.call',new=repeated_tool):
    coach_chat.answer(987,'Where can I find my saved goals?',kit=True,turn=duplicate_turn)
assert reads==['goals'],reads
print('Kit latency: distinct evidence IDs, provider call IDs, duplicate reuse and copied request context PASS')


inflight=peak=0
mutex=Lock()
names=['goals','app_features','food_log','nutrition_summary','stored_foods','meal_options']
def bounded_tool(self,name,arguments,*,connection=None):
    global inflight,peak
    assert marker.get()=="own-request"
    if name=='profile':return {'today':'2026-11-26','tz':'UTC','units':'imperial'}
    with mutex:
        inflight+=1
        peak=max(peak,inflight)
    time.sleep(.05)
    with mutex:inflight-=1
    return {}
def bounded_turn(messages,definitions):
    if len(messages)==1:return ([{'name':name,'args':{}} for name in names],'',{})
    responses=[p['functionResponse'] for p in messages[-1]['parts']]
    assert [p['name'] for p in responses]==names
    assert [p['response']['evidence_id'] for p in responses]==[f'e{i}' for i in range(2,8)]
    return ([],json.dumps({'blocks':[{'kind':'paragraph','text':'Checked fictional bounded reads.'}],'facts':[]}),{})
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'), \
     patch('app.kit_tools.KitTools.call',new=bounded_tool):
    coach_chat.answer(987,'How do I use the food log?',kit=True,turn=bounded_turn)
assert 1<peak<=4 and inflight==0,peak
print('Kit latency: six ordered reads never exceed four concurrent scoped workers PASS')


class Request:
    async def is_disconnected(self):
        return False


async def first_block_probe():
    import app.kit_stream as stream
    ready = Event()

    def fake_generate(*_args):
        time.sleep(.15)
        ready.set()
        return {'state': 'answered'}

    def fake_current(*_args):
        return {'state': 'answered' if ready.is_set() else 'running',
                'answer': {'answer_blocks': [{'kind': 'paragraph', 'text': 'Checked fictional block.'}]}}

    started = time.monotonic()
    with patch.object(stream, 'POLL_SECONDS', 60), patch.object(stream, 'generate', side_effect=fake_generate), patch.object(stream, 'current', side_effect=fake_current):
        async for chunk in stream.events(987, '00000000-0000-0000-0000-000000000001',
                                         type('Body', (), {'generation': 1, 'visit_id': None})(), Request()):
            if 'event: block' in chunk:
                # Initial read, completed-answer read, and mandatory pre-emit fence only.
                assert stream.current.call_count==3, stream.current.call_count
                return time.monotonic() - started
    raise AssertionError('stream ended without a first block')


async def completion_guard():
    # A deliberately long poll makes completion wakeup observable without a tight timing threshold.
    return await asyncio.wait_for(first_block_probe(),timeout=5)
first_block = asyncio.run(completion_guard())
print(f'Kit stream: first validated fictional block visible after {first_block:.3f}s with bounded polling PASS')

# The parallel path also uses real scoped SQL on fictional, distinct accounts.
from uuid import uuid4
from app import db
uids=[]
try:
    with db.connect() as c:
        for target in (2100,3100):
            uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                          ('zz_test_latency_'+uuid4().hex,'Fictional latency')).fetchone()['id']
            uids.append(uid)
            c.execute("INSERT INTO profile(user_id,tz,units,kcal_target) VALUES(%s,'UTC','metric',%s)",(uid,target))
    def sql_turn(messages,definitions):
        if len(messages)==1:return ([{'name':'profile','args':{}},{'name':'goals','args':{}}],'',{})
        responses=[p['functionResponse']['response'] for p in messages[-1]['parts']]
        assert [r['evidence_id'] for r in responses]==['e2','e3']
        assert responses[0]['data']['kcal_target']==2100
        assert responses[1]['data']['nutrition']['kcal_target']==2100
        assert '3100' not in json.dumps(responses)
        return ([],json.dumps({'blocks':[{'kind':'paragraph','text':'Checked own fictional profile.'}],'facts':[]}),{})
    with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',return_value='gemini'):
        coach_chat.answer(uids[0],'Where are my nutrition goals?',kit=True,turn=sql_turn)
    print('Kit latency: real concurrent scoped SQL retains own-account evidence isolation PASS')
finally:
    with db.connect() as c:
        for uid in uids:c.execute('DELETE FROM users WHERE id=%s',(uid,))
