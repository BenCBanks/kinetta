"""Fence uncertain privacy writes, including requests arriving after their phone timed out.

A short-lived, signed ticket carries the account row's PostgreSQL revision. Reserving a
new ticket invalidates older requests. The advisory lock spans the endpoint's actual
transactions, not the HTTP client's wait. Status is GET-only and cannot claim settlement
while an accepted write is running, or an unused ticket could still arrive.
No schema/state table: xmin changes on each reservation/consumption; tickets expire in 15s.
"""
import asyncio
import base64
from contextlib import contextmanager
import hashlib
import hmac
import json
import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from . import auth, db

router = APIRouter(prefix='/api/privacy-save')
HEADER = 'X-Kinetta-Privacy-Ticket'
TTL = 15
_places = threading.BoundedSemaphore(3)  # leave pool capacity for the endpoint's own transaction
_NAMESPACE = 1263555158


def _key():
    key = db.secret('FIT_APP_PASSWORD')
    if not key:
        raise HTTPException(503, 'Saved setting could not be checked. Try again.')
    return key.encode()


def _encode(payload):
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(',', ':')).encode()).decode().rstrip('=')
    return raw + '.' + hmac.new(_key(), raw.encode(), hashlib.sha256).hexdigest()


def _decode(ticket, uid):
    try:
        raw, signature = ticket.split('.')
        if not hmac.compare_digest(signature, hmac.new(_key(), raw.encode(), hashlib.sha256).hexdigest()):
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4)))
        if data['uid'] != uid:
            raise ValueError()
        return data
    except (ValueError, KeyError, TypeError):
        raise HTTPException(409, {'code': 'privacy_save_pending', 'message': 'Saved setting not confirmed. Retry.'})


@contextmanager
def _locked(uid):
    if not _places.acquire(blocking=False):
        raise HTTPException(503, {'code': 'privacy_save_pending', 'message': 'Saved setting not confirmed. Retry.'})
    try:
        with db.pool().connection(timeout=1) as c:
            if not c.execute('SELECT pg_try_advisory_lock(%s,%s) AS ok', (_NAMESPACE, uid)).fetchone()['ok']:
                raise HTTPException(409, {'code': 'privacy_save_pending', 'message': 'Saved setting not confirmed. Retry.'})
            try:
                c.commit()  # keep only the session advisory lock, never a row lock during the endpoint
                yield c
            finally:
                c.rollback()
                c.execute('SELECT pg_advisory_unlock(%s,%s)', (_NAMESPACE, uid))
                c.commit()
    finally:
        _places.release()


def _revision(c, uid, advance=False):
    # photo_v is unchanged. Avoid UPDATE OF name, which runs the name-normalisation trigger.
    sql = ('UPDATE users SET photo_v=photo_v WHERE id=%s RETURNING xmin::text AS revision' if advance
           else 'SELECT xmin::text AS revision FROM users WHERE id=%s')
    row = c.execute(sql, (uid,)).fetchone()
    if not row:
        raise HTTPException(401, 'Not logged in')
    return row['revision']


class Reservation(BaseModel):
    path: str = Field(max_length=300, pattern=r'^/api/[^?#]+$')
    method: str = Field(pattern=r'^(POST|PUT|PATCH|DELETE)$')


@router.post('')
def reserve(body: Reservation, user=Depends(auth.current_user)):
    if body.path.startswith('/api/privacy-save'):
        raise HTTPException(400, 'Invalid setting')
    with _locked(user['id']) as c:
        revision = _revision(c, user['id'], advance=True)
        c.commit()
        return {'ticket': _encode({'uid': user['id'], 'revision': revision, 'until': time.time()+TTL,
                                  'path': body.path, 'method': body.method})}


@router.get('')
def settled(ticket: str, user=Depends(auth.current_user)):
    data = _decode(ticket, user['id'])
    with _locked(user['id']) as c:
        # A never-arrived request stays unknown until it expires. GET never cancels or replays it.
        if _revision(c, user['id']) == data['revision'] and time.time() <= data['until']:
            raise HTTPException(409, {'code': 'privacy_save_pending', 'message': 'Saved setting not confirmed. Retry.'})
    return {'settled': True}


@contextmanager
def write(request):
    user = auth.current_user(request)
    data = _decode(request.headers[HEADER], user['id'])
    if request.url.path != data['path'] or request.method != data['method']:
        raise HTTPException(409, {'code': 'privacy_save_pending', 'message': 'Saved setting not confirmed. Retry.'})
    with _locked(user['id']) as c:
        if time.time() > data['until'] or _revision(c, user['id']) != data['revision']:
            raise HTTPException(409, 'Saved setting changed. Check it and try again.')
        try:
            yield
        finally:
            # Even validation/HTTP errors consume the ticket: no later duplicate can apply it.
            _revision(c, user['id'], advance=True)
            c.commit()


async def guarded(request, call_next):
    from starlette.concurrency import run_in_threadpool
    import anyio
    # Finish a small bounded body before occupying a DB connection or an account fence.
    from fastapi.responses import JSONResponse
    async def body():
        chunks, size = [], 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > 65536:
                raise HTTPException(413, 'Setting is too large')
            chunks.append(chunk)
        request._body = b''.join(chunks)  # Starlette's cached request replays this to call_next.
    try:
        await asyncio.wait_for(body(), timeout=5)
    except asyncio.TimeoutError:
        return JSONResponse({'detail': 'Setting timed out. Try again.'}, status_code=408)
    except HTTPException as error:
        return JSONResponse({'detail': error.detail}, status_code=error.status_code)
    manager = write(request)
    try:
        await run_in_threadpool(manager.__enter__)
    except HTTPException as error:
        from fastapi.responses import JSONResponse
        return JSONResponse({'detail': error.detail}, status_code=error.status_code)
    # A disconnected/aborted client must not release the fence while its endpoint still runs.
    with anyio.CancelScope(shield=True):
        try:
            return await call_next(request)
        finally:
            await run_in_threadpool(manager.__exit__, None, None, None)
