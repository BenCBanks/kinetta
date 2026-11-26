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
from . import ai_access, ai_release, coach, db, kit_history, workout_compare
from .auth import current_user

_stop = ContextVar('kit_stream_stop', default=None)
POLL_SECONDS = 1
HEARTBEAT_SECONDS = 10
TIMEOUT_SECONDS = 300


def capabilities():
    return {'stream_supported':True}


def cancelled_reply():
    return {'cancelled':True}


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
        from . import kit_thread
        kit_thread.locked(c, uid, body.generation, body.visit_id)
        conversation_id = kit_history.conversation(c, uid, body.visit_id)
        row = c.execute('''SELECT * FROM kit_turns WHERE user_id=%s AND client_id=%s
          AND replay_blocked_at IS NULL AND invalidated_at IS NULL
          AND (conversation_id=%s OR (conversation_id IS NULL AND generation=%s
            AND visit_id IS NOT DISTINCT FROM %s::uuid))''',
          (uid, client_id, conversation_id, body.generation, body.visit_id)).fetchone()
        if not row:raise HTTPException(409, 'This Kit conversation is no longer available.')
        if conversation_id and not kit_history.enabled():
            raise HTTPException(403, 'Kit access changed.')
        ai_access.require(uid, 'coach', c)
        if not coach.allowed(uid, connection=c) or not ai_release.enabled('kit'):
            raise HTTPException(403, 'Kit access changed.')
        answer = row.get('answer') or {}
        if not kit_history.permitted_history(answer, kit_history.consents(c, uid)):
            raise HTTPException(403, 'Kit data sharing changed.')
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
            if not isinstance(block['text'],str) or not block['text'].strip() or not 1 <= len(block['text']) <= 1600:
                raise ValueError('Invalid saved paragraph')
        elif block.get('kind')=='list' and set(block)=={'kind','items'}:
            items = block['items']
            if not isinstance(items,list) or not 1 <= len(items) <= 6 or any(
                    not isinstance(item,str) or not item.strip() or not 1 <= len(item) <= 600 for item in items):
                raise ValueError('Invalid saved list')
        else:raise ValueError('Invalid saved block kind')
    return blocks


def generate(uid, client_id, body, flag):
    from . import kit_thread
    with cancellation(flag):
        return kit_thread.generate(client_id, body, {'id':uid})


def rejection(result):
    """Carry only closed pre-generation rejection metadata, never provider/error text."""
    status = getattr(result, 'status_code', None)
    if status in (429, 503):
        return {'code':'rate_limited' if status==429 else 'unavailable',
                'status':status, 'restore_draft':True}
    return None


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
            if worker.done():
                rejected = rejection(worker.result())
                if rejected:
                    yield frame('error', rejected)
                    return
            row = await asyncio.to_thread(current, uid, client_id, body)
            if row['state']=='answered':
                blocks = checked_blocks(row.get('answer') or {})  # Validate entire envelope before first block.
                for index, block in enumerate(blocks):
                    if await request.is_disconnected():return
                    await asyncio.to_thread(current, uid, client_id, body)
                    yield frame('block', {'index':index, 'block':block})
                if await request.is_disconnected():return
                row = await asyncio.to_thread(current, uid, client_id, body)
                if row['state']!='answered':raise HTTPException(409, 'Kit answer changed.')
                yield frame('complete', {'message':kit_thread.public(row)})
                return
            if row['state']=='failed' and worker.done():
                yield frame('error', {'code':'answer_failed'})
                return
            if worker.done():
                # Surface infrastructure failures only as a closed public code, never exception text.
                result = worker.result()
                if not isinstance(result, dict) or result.get('cancelled'):
                    yield frame('error', {'code':'conversation_changed'})
                    return
            now = time.monotonic()
            if now-heartbeat >= HEARTBEAT_SECONDS:
                yield ': keep-alive\n\n'
                heartbeat = now
            await asyncio.sleep(POLL_SECONDS)
        yield frame('error', {'code':'answer_timeout'})
    except HTTPException as error:
        # discard_unstarted commits before generate returns. A read may see the
        # missing row first; briefly join that result to retain its quota status.
        if worker is not None and not worker.done() and error.status_code==409:
            await asyncio.wait({worker}, timeout=.05)
        rejected = rejection(error)
        if worker is not None and worker.done() and not worker.cancelled():
            try:rejected = rejection(worker.result()) or rejected
            except Exception:pass
        yield frame('error', rejected or {'code':'access_changed'})
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
