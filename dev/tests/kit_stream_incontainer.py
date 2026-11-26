"""Fictional SSE transport and real ownership/lease/save path with provider stand-ins."""
import asyncio
import copy
import json
from threading import Event
from unittest.mock import patch
from uuid import uuid4
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from app import kit_thread, kit_stream

body=kit_thread.GenerationIn(generation=uuid4())
client=uuid4()
row={'state':'answered','answer':{'answer_blocks':[
    {'kind':'paragraph','text':'Your checked answer.'}, {'kind':'list','items':['A checked next step.']} ]}}


class Request:
    def __init__(self, disconnect=False):self.disconnect=disconnect
    async def is_disconnected(self):return self.disconnect


async def collect(*, request=None, rows=None, generate=None):
    request=request or Request()
    with patch.object(kit_stream,'current',side_effect=rows if rows is not None else lambda *args:copy.deepcopy(row)), \
         patch.object(kit_stream,'generate',side_effect=generate or (lambda *args:{})), \
         patch.object(kit_thread,'public',side_effect=lambda r:r),patch.object(kit_stream,'POLL_SECONDS',.001):
        return [event async for event in kit_stream.events(99,client,body,request)]


def parsed(events):
    return [(event.split('\n')[0],json.loads(event.split('data: ',1)[1])) for event in events if event.startswith('event: ')]


async def transport_checks():
    got=parsed(await collect());assert [x[0] for x in got]==['event: start','event: block','event: block','event: complete']
    assert got[1][1]=={'index':0,'block':row['answer']['answer_blocks'][0]}
    # Reconnect receives the entire persisted checked answer; indexes replace, never append blindly.
    again=parsed(await collect());assert again[1:]==got[1:]
    denied=parsed(await collect(rows=HTTPException(403,'private secret')))
    assert denied[-1]==('event: error',{'code':'access_changed'})
    assert 'private secret' not in str(denied)
    # Quota discards the pending row; preserve only typed status, including a
    # read that races ahead of the worker's response after its deletion commits.
    import time
    for status in (429,503):
        def reject(*args):
            time.sleep(.01)
            return JSONResponse(status_code=status,content={'detail':'private provider detail'})
        quota=parsed(await collect(rows=HTTPException(409,'missing row'),generate=reject))
        assert quota[-1]==('event: error',{'code':'rate_limited' if status==429 else 'unavailable','status':status,'restore_draft':True})
        assert 'private provider detail' not in str(quota)
    # Consent changes between blocks: no later block or complete is emitted.
    limited=parsed(await collect(rows=[row,row,HTTPException(403,'revoked')]))
    assert [x[0] for x in limited]==['event: start','event: block','event: error']
    malformed=copy.deepcopy(row);malformed['answer']['answer_blocks'][1]={'kind':'script','text':'private raw model output'}
    invalid=parsed(await collect(rows=lambda *args:malformed))
    assert [x[0] for x in invalid]==['event: start','event: error']
    assert 'private raw model output' not in str(invalid)
    assert await collect(request=Request(True))==[]
    failed=parsed(await collect(rows=lambda *args:{'state':'failed','error':'raw provider text'}))
    assert failed[-1][1]=={'code':'answer_failed'} and 'raw provider' not in str(failed)
    # Heartbeats reveal no answer content; bounded timeout never exposes pending provider text.
    with patch.object(kit_stream,'HEARTBEAT_SECONDS',0),patch.object(kit_stream,'TIMEOUT_SECONDS',.004):
        pending=await collect(rows=lambda *args:{'state':'running','answer':{'raw':'secret'}})
    assert ': keep-alive\n\n' in pending and parsed(pending)[-1][1]=={'code':'answer_timeout'}
    # A failed prior attempt may still be visible while this request acquires its retry lease.
    retried=parsed(await collect(rows=[{'state':'failed'},row,row,row,row]))
    assert retried[-1][0]=='event: complete'
    # Closing an active generator sets the worker-local cancellation flag.
    stop_seen=Event()
    def wait_for_close(uid,client,body,flag):
        with kit_stream.cancellation(flag):
            flag.wait(1)
            if kit_stream.cancelled():stop_seen.set()
        return {}
    with patch.object(kit_stream,'generate',side_effect=wait_for_close):
        stream=kit_stream.events(99,client,body,Request())
        assert (await anext(stream)).startswith('event: start')
        await asyncio.sleep(.01);await stream.aclose();await asyncio.sleep(.02)
    assert stop_seen.is_set()
    # A retained specialized review has no ordinary blocks; final saved envelope is still available.
    specialized=parsed(await collect(rows=lambda *args:{'state':'answered','answer':{'weekly_review':{'safe':'checked'}}}))
    assert [x[0] for x in specialized]==['event: start','event: complete']


asyncio.run(transport_checks())
flag=Event()
with kit_stream.cancellation(flag):
    assert not kit_stream.cancelled();flag.set()
    with patch.object(kit_thread.db,'connect',side_effect=AssertionError('No query after cancellation')):
        assert kit_thread.still_active(1,uuid4(),uuid4(),uuid4()) is False
assert not kit_stream.cancelled()
assert any(route.path=='/api/coach/conversation/messages/{client_id}/stream' for route in kit_thread.router.routes)
print('Kit stream: event ordering, reconnect, closed errors, consent change, invalid envelope, timeout, cancellation PASS')

# Real SQL ownership, lease idempotency and checked persistence in a disposable app only.
from app import db
uids=[];calls=[]
try:
    with db.connect() as c:
        for _ in range(2):
            uid=c.execute('INSERT INTO users(login,name) VALUES (%s,%s) RETURNING id',
                ('zz_test_stream_'+uuid4().hex,'Fictional stream account')).fetchone()['id'];uids.append(uid)
            c.execute("INSERT INTO profile(user_id,tz,ai_ok,ai_adult_at) VALUES (%s,'UTC',true,now())",(uid,))
    def provider(uid,question,**kwargs):
        calls.append(1)
        assert kwargs['active']()
        return {'answer_blocks':[{'kind':'paragraph','text':'A checked fictional answer.'}],
                'interpretation':'A checked fictional answer.','facts':[]}
    with patch('app.ai_release.enabled',return_value=True),patch('app.coach.allowed',return_value=True), \
         patch('app.kit_thread.brake'),patch('app.coach_chat.answer',side_effect=provider):
        generation=kit_thread.read(user={'id':uids[0]},before=None,visit_id=None)['generation']
        b=kit_thread.GenerationIn(generation=generation);cid=uuid4()
        kit_thread.create(kit_thread.MessageIn(client_id=cid,generation=generation,question='A fictional question'),user={'id':uids[0]})
        try:kit_stream.current(uids[1],cid,b)
        except HTTPException as error:assert error.status_code==409
        else:raise AssertionError('Foreign row emitted')
        result=kit_stream.generate(uids[0],cid,b,Event())
        assert result['state']=='answered' and kit_stream.current(uids[0],cid,b)['state']=='answered'
        kit_stream.generate(uids[0],cid,b,Event());assert len(calls)==1,'Replay must not pay again'
        with db.connect() as c:
            c.execute("UPDATE kit_turns SET state='running',lease=%s,expires=now()+interval '5 minutes' WHERE user_id=%s AND client_id=%s",(uuid4(),uids[0],cid))
        assert kit_stream.generate(uids[0],cid,b,Event())['state']=='running' and len(calls)==1
        with db.connect() as c:
            c.execute("UPDATE kit_turns SET state='answered',answer=answer || %s::jsonb WHERE user_id=%s AND client_id=%s",(json.dumps({'health_included':True,'garmin_included':True}),uids[0],cid))
        with patch('app.coach.health_ok',return_value=False):
            try:kit_stream.current(uids[0],cid,b)
            except HTTPException as error:assert error.status_code==403
            else:raise AssertionError('Revoked Health answer emitted')
        with patch('app.coach.health_ok',return_value=True),patch('app.workout_compare.review_consents_still_valid',return_value=False):
            try:kit_stream.current(uids[0],cid,b)
            except HTTPException as error:assert error.status_code==403
            else:raise AssertionError('Revoked Garmin answer emitted')
        with patch('app.coach.allowed',return_value=False):
            try:kit_stream.current(uids[0],cid,b)
            except HTTPException as error:assert error.status_code==403
            else:raise AssertionError('Revoked access emitted')
        # Database invalidation is irreversible: exercise it on separate fictional rows.
        for field in ('replay_blocked_at','invalidated_at'):
            blocked_id=uuid4()
            with db.connect() as c:
                c.execute("INSERT INTO kit_turns(user_id,client_id,generation,question,state,answer) VALUES(%s,%s,%s,'Fictional archived answer','answered',%s)",
                          (uids[0],blocked_id,generation,json.dumps(result['answer'])))
                c.execute('UPDATE kit_turns SET '+field+'=now() WHERE user_id=%s AND client_id=%s',(uids[0],blocked_id))
            try:kit_stream.current(uids[0],blocked_id,b)
            except HTTPException as error:assert error.status_code==409
            else:raise AssertionError('Quarantined/invalidated answer emitted')
        # A disconnect after the last provider check still cannot persist answer or memory.
        cancelled_id=uuid4();flag=Event()
        kit_thread.create(kit_thread.MessageIn(client_id=cancelled_id,generation=generation,question='Another fictional question'),user={'id':uids[0]})
        def disconnect(*args,**kwargs):
            result=provider(*args,**kwargs);flag.set();return result
        with patch('app.coach_chat.answer',side_effect=disconnect):
            assert kit_stream.generate(uids[0],cancelled_id,b,flag)=={'cancelled':True}
        with db.connect() as c:
            lost=c.execute('SELECT state,answer,lease FROM kit_turns WHERE user_id=%s AND client_id=%s',(uids[0],cancelled_id)).fetchone()
            assert lost['state']=='failed' and lost['answer'] is None and lost['lease'] is None
        kit_thread.clear(kit_thread.ClearIn(generation=generation,confirmed=True),user={'id':uids[0]})
        try:kit_stream.current(uids[0],cid,b)
        except HTTPException as error:assert error.status_code==409
        else:raise AssertionError('Cleared chat emitted')
finally:
    with db.connect() as c:
        for uid in uids:c.execute('DELETE FROM users WHERE id=%s',(uid,))
print('Kit stream: real SQL own-account/clear guards, persisted checks and single generation on replay PASS')

# Authenticated POST contract, HTTP headers and real SSE framing; provider work blocked.
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.auth import current_user
app=FastAPI();app.include_router(kit_thread.router)
with TestClient(app) as client_http:
    response=client_http.post('/api/coach/conversation/messages/'+str(client)+'/stream',json=body.model_dump(mode='json'))
    assert response.status_code==401
app.dependency_overrides[current_user]=lambda:{'id':99}
with patch.object(kit_stream,'current',return_value=row),patch.object(kit_stream,'generate',return_value={}), \
     patch.object(kit_thread,'public',side_effect=lambda r:r),TestClient(app) as client_http:
    response=client_http.post('/api/coach/conversation/messages/'+str(client)+'/stream',json=body.model_dump(mode='json'))
    assert response.status_code==200 and response.headers['content-type'].startswith('text/event-stream')
    assert response.headers['cache-control']=='no-store' and response.headers['x-accel-buffering']=='no'
    assert 'event: block' in response.text and 'event: complete' in response.text
    assert 'data: '+json.dumps({'text':'line\n\nwith event: fake'},separators=(',',':')) in kit_stream.frame('block',{'text':'line\n\nwith event: fake'})
print('Kit stream: actual authenticated HTTP/SSE headers/framing PASS')
