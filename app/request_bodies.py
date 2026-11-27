"""Bound anonymous receipt before framework JSON or multipart parsing."""
import asyncio
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from fastapi import HTTPException
from psycopg.errors import LockNotAvailable, QueryCanceled
from psycopg_pool import PoolTimeout
from starlette.requests import Request
from starlette.responses import JSONResponse
from . import auth, db

ANONYMOUS_BYTES = 64 * 1024
BODY_SECONDS, IDLE_SECONDS = 30, 10
BODY_MESSAGES = 1024
_readers = threading.BoundedSemaphore(8)
_recovery_reader = threading.BoundedSemaphore(1)
_session_slots = threading.BoundedSemaphore(2)
_session_waiters = threading.BoundedSemaphore(32)
SESSION_WAIT_SECONDS = 5
_session_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='body-session')
BUSY = 'Kinetta is busy. Please try again shortly.'
TOO_LARGE = 'Request is too large. Sign in before uploading data.'


def session_exists(token):
    # Read-only permission for a larger body, never authorization to data. Route
    # dependencies still recheck current session, account, ownership and consent.
    with db.pool().connection(timeout=1) as c:
        c.execute("SET LOCAL statement_timeout='250ms'")
        c.execute("SET LOCAL lock_timeout='50ms'")
        return bool(c.execute(f'''SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id
          WHERE s.token_hash=%s AND s.last_seen>now()-interval '{auth.SESSION_DAYS} days'
          AND u.suspended_at IS NULL AND u.password_change_expires IS NULL''', (auth.token_hash(token),)).fetchone())


async def signed_in(request):
    token = auth.session_token(request)
    if not token or len(token) > 100: return False
    # A normal upload burst must not compete for anonymous body readers or be
    # refused just because both lookup workers are briefly active. Queue only
    # coroutines: no thread or database connection is held while waiting.
    slots, waiters = _session_slots, _session_waiters
    queued = False
    deadline = time.monotonic() + SESSION_WAIT_SECONDS
    try:
        while True:
            if queued and time.monotonic() >= deadline: raise HTTPException(503, BUSY, headers={'Retry-After':'2'})
            if slots.acquire(False): break
            if not queued:
                queued = waiters.acquire(False)
                if not queued: raise HTTPException(503, BUSY, headers={'Retry-After':'2'})
            if time.monotonic() >= deadline: raise HTTPException(503, BUSY, headers={'Retry-After':'2'})
            await asyncio.sleep(.002)
    finally:
        if queued: waiters.release()
    try: future = _session_executor.submit(session_exists, token)
    except BaseException:
        slots.release()
        raise
    # Cancellation must not free the slot while its database worker is running.
    future.add_done_callback(lambda _: slots.release())
    try: return await asyncio.wrap_future(future)
    except (PoolTimeout, QueryCanceled, LockNotAvailable):
        raise HTTPException(503, BUSY, headers={'Retry-After':'2'}) from None


def route_receives(path):
    # Keep raw receivers under their existing authentication and byte caps
    # (Garmin ping is public). Preserve signed bytes and webhook receipt behavior.
    return path in ('/api/garmin/notify', '/api/ingest/apple', '/api/admin/email-events') or bool(
        re.fullmatch(r'/api/garmin/push/[^/]+|/api/strava-import/uploads/[0-9a-fA-F-]{36}/pieces/[0-9]+', path))


def recovery_body(scope):
    # Match #1637's reserved recovery category without importing that open PR.
    path, method = scope['path'], scope['method']
    return (method == 'POST' and (path in ('/api/account/password', '/api/password/reset',
            '/api/password/temporary', '/api/account/delete', '/api/admin/people') or bool(
            re.fullmatch(r'/api/admin/people/\d+/temporary-password', path)))) or (
            method == 'PUT' and path == '/api/account/email')


class BodyLimits:
    def __init__(self, app): self.app = app

    async def __call__(self, scope, receive, send):
        if (scope['type'] != 'http' or scope['method'] not in ('POST','PUT','PATCH','DELETE')
                or not scope['path'].startswith('/api/') or route_receives(scope['path'])):
            return await self.app(scope, receive, send)
        request = Request(scope)
        content = request.headers.get('content-type','').split(';',1)[0].strip().lower()
        length = request.headers.get('content-length', '')
        large = length.isascii() and length.isdecimal() and (len(length) > 20 or int(length) > ANONYMOUS_BYTES)
        try:
            if await signed_in(request): return await self.app(scope, receive, send)
            if content == 'multipart/form-data' or large:
                raise HTTPException(401 if content == 'multipart/form-data' else 413,
                                    'Not logged in' if content == 'multipart/form-data' else TOO_LARGE)
            readers = _readers
            if not readers.acquire(False):
                readers = _recovery_reader
                if not recovery_body(scope) or not readers.acquire(False):
                    raise HTTPException(503, BUSY, headers={'Retry-After':'2'})
            body = bytearray()
            try:
                async with asyncio.timeout(BODY_SECONDS):
                    for _ in range(BODY_MESSAGES):
                        message = await asyncio.wait_for(receive(), IDLE_SECONDS)
                        if message['type'] == 'http.disconnect': return
                        chunk = message.get('body', b'')
                        if len(body) + len(chunk) > ANONYMOUS_BYTES:
                            raise HTTPException(413, TOO_LARGE)
                        body.extend(chunk)
                        if not message.get('more_body', False): break
                    else: raise HTTPException(413, 'Too many upload fragments. Please try again.')
            finally: readers.release()
        except TimeoutError:
            return await self.reject(scope, receive, send, HTTPException(408, 'Upload took too long. Please try again.'))
        except HTTPException as error:
            return await self.reject(scope, receive, send, error)
        delivered = False
        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {'type':'http.request', 'body':bytes(body), 'more_body':False}
            return await receive()
        await self.app(scope, replay, send)

    async def reject(self, scope, receive, send, error):
        await JSONResponse({'detail':error.detail}, error.status_code,
                           headers={'Connection':'close', **(error.headers or {})})(scope, receive, send)
