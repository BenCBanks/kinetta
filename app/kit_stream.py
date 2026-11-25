"""Authenticated checked-answer SSE; raw provider text never enters this transport."""
import asyncio
from contextvars import ContextVar
from contextlib import contextmanager
import json
from threading import Event
import time
from uuid import UUID
from fastapi import Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import StreamingResponse
from . import ai_access, ai_release, coach, db, workout_compare
from .auth import current_user

_stop = ContextVar('kit_stream_stop', default=None)
POLL_SECONDS = 1
HEARTBEAT_SECONDS = 10
TIMEOUT_SECONDS = 300


def cancelled():
    flag = _stop.get()
    return flag is not None and flag.is_set()


@contextmanager
def cancellation(flag):
    token = _stop.set(flag)
    try:yield
    finally:_stop.reset(token)


def current(uid, client_id, body):
    """Only an owned, current, still-readable answer may leave the server."""
    with db.connect() as c:
        row = c.execute('''SELECT t.* FROM kit_turns t
          JOIN kit_conversations q ON q.user_id=t.user_id AND q.generation=t.generation
          LEFT JOIN kit_visits v ON v.id=t.visit_id AND v.user_id=t.user_id
          WHERE t.user_id=%s AND t.client_id=%s AND t.generation=%s
          AND t.visit_id IS NOT DISTINCT FROM %s::uuid
          AND (t.visit_id IS NULL OR (v.ended IS NULL AND v.created>now()-interval '24 hours'))''',
          (uid, client_id, body.generation, body.visit_id)).fetchone()
        if not row:raise HTTPException(409, 'This Kit conversation is no longer available.')
        ai_access.require(uid, 'coach', c)
        if not coach.allowed(uid, connection=c) or not ai_release.enabled('kit'):
            raise HTTPException(403, 'Kit access changed.')
        answer = row.get('answer') or {}
        if answer.get('health_included') and not coach.health_ok(c, uid):
            raise HTTPException(403, 'Kit data sharing changed.')
    if answer.get('garmin_included') and not workout_compare.review_consents_still_valid(
            uid, {'health':False, 'garmin':True}):
        raise HTTPException(403, 'Kit data sharing changed.')
    return row


def frame(event, data):
    return 'event: '+event+'\ndata: '+json.dumps(jsonable_encoder(data), ensure_ascii=False,
                                               allow_nan=False, separators=(',', ':'))+'\n\n'


def checked_blocks(answer):
    blocks = answer.get('answer_blocks')
    if blocks is None:return []  # Dedicated weekly/workout/legacy answers use complete only.
    if not isinstance(blocks,list) or not 1 <= len(blocks) <= 10:
        raise ValueError('Invalid saved blocks')
    for block in blocks:
        if not isinstance(block,dict):raise ValueError('Invalid saved block')
        if block.get('kind')=='paragraph' and set(block)=={'kind','text'}:
            if not isinstance(block['text'],str) or not 1 <= len(block['text']) <= 1600:
                raise ValueError('Invalid saved paragraph')
        elif block.get('kind')=='list' and set(block)=={'kind','items'}:
            items = block['items']
            if not isinstance(items,list) or not 1 <= len(items) <= 6 or any(
                    not isinstance(item,str) or not 1 <= len(item) <= 600 for item in items):
                raise ValueError('Invalid saved list')
        else:raise ValueError('Invalid saved block kind')
    return blocks


def generate(uid, client_id, body, flag):
    from . import kit_thread
    with cancellation(flag):
        return kit_thread.generate(client_id, body, {'id':uid})


async def events(uid, client_id, body, request):
    from . import kit_thread
    stop = Event()
    worker = None
    began = heartbeat = time.monotonic()
    try:
        if await request.is_disconnected():return
        # A reconnect invokes the same lease-aware path, never a separate provider operation.
        worker = asyncio.create_task(asyncio.to_thread(generate, uid, client_id, body, stop))
        yield frame('start', {'version':1})
        while time.monotonic()-began < TIMEOUT_SECONDS:
            if await request.is_disconnected():return
            row = await asyncio.to_thread(current, uid, client_id, body)
            if row['state']=='answered':
                blocks = checked_blocks(row.get('answer') or {})  # Validate entire envelope before first block.
                for index, block in enumerate(blocks):
                    if await request.is_disconnected():return
                    await asyncio.to_thread(current, uid, client_id, body)
                    yield frame('block', {'index':index, 'block':block})
                if await request.is_disconnected():return
                row = await asyncio.to_thread(current, uid, client_id, body)
                yield frame('complete', {'message':kit_thread.public(row)})
                return
            if row['state']=='failed' and worker.done():
                yield frame('error', {'code':'answer_failed'})
                return
            if worker.done():
                # Surface infrastructure failures only as a closed public code, never exception text.
                result = worker.result()
                if result.get('cancelled'):
                    yield frame('error', {'code':'conversation_changed'})
                    return
            now = time.monotonic()
            if now-heartbeat >= HEARTBEAT_SECONDS:
                yield ': keep-alive\n\n'
                heartbeat = now
            await asyncio.sleep(POLL_SECONDS)
        yield frame('error', {'code':'answer_timeout'})
    except HTTPException:
        yield frame('error', {'code':'access_changed'})
    except asyncio.CancelledError:
        raise
    except Exception:
        yield frame('error', {'code':'stream_failed'})
    finally:
        stop.set()  # Provider may finish in flight; existing active/save guards discard its result.
        if worker is not None:
            worker.add_done_callback(lambda task: None if task.cancelled() else task.exception())


def install(router):
    from .kit_thread import GenerationIn
    @router.post('/messages/{client_id}/stream')
    async def stream(client_id:UUID, body:GenerationIn, request:Request, user=Depends(current_user)):
        await asyncio.to_thread(current, user['id'], client_id, body)
        return StreamingResponse(events(user['id'], client_id, body, request), media_type='text/event-stream',
                                 headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'})
