"""Password request admission: no database leases or worker threads while queued."""
import asyncio
import hashlib
import logging
import secrets
import re
import threading
import time
from collections import deque
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from . import auth, db

PUBLIC = {'/api/login', '/api/signup', '/api/setup', '/api/join', '/api/admin/login'}
PRIVATE = {'/api/account/password', '/api/password/reset', '/api/password/temporary',
           '/api/account/delete', '/api/admin/people'}
WAIT_SECONDS = 5
SOURCE_LIMIT = 60  # Unsuccessful + in-flight requests/minute per source and category; successes refund only themselves.
BUSY = 'Kinetta is busy. Please try again in a few seconds.'


def category(scope):
    path, method = scope['path'], scope['method']
    if method == 'POST':
        if path in PUBLIC: return 'public'
        if path in PRIVATE or re.fullmatch(r'/api/admin/people/\d+/temporary-password', path): return 'recovery'
    if method == 'PUT' and path == '/api/account/email': return 'recovery'


def source_prefix(request, kind):
    # Hash the source so it cannot introduce wildcard characters into the prefix lookup.
    source = hashlib.sha256(auth.client_ip(request).encode()).hexdigest()
    return 'password-work:' + kind + ':' + source + ':'


def source_attempt(request, kind):
    # Independent of usernames: congestion must not lock out a targeted account.
    # Commit before admission; failures, timeouts, disconnects and 503s retain their budget.
    prefix = source_prefix(request, kind)
    reservation = prefix + secrets.token_hex(16)
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (prefix,))
        n = c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE %s AND created>now()-interval '1 minute'", (prefix + '%',)).fetchone()['n']
        if n >= SOURCE_LIMIT: return None
        c.execute("DELETE FROM auth_attempts WHERE created<now()-interval '1 day'")
        c.execute('INSERT INTO auth_attempts(key) VALUES(%s)', (reservation,))
    return reservation


def source_success(reservation):
    # Refund only this successful request, never concurrent failures from a shared network.
    # Cleanup must not turn a committed sign-in into an error; any retained row expires in a minute.
    try:
        with db.connect() as c:
            c.execute('DELETE FROM auth_attempts WHERE key=%s', (reservation,))
    except Exception:
        logging.getLogger(__name__).warning('Password request budget cleanup failed; expires after one minute.')


class Admission:
    def __init__(self):
        self.lock = threading.Lock()
        self.active = self.public = self.waiting = self.public_waiting = 0

    def enter(self, kind):
        with self.lock:
            # One of two places is reserved for recovery/change, even during a login flood.
            if self.active >= 2 or (kind == 'public' and self.public >= 1): return False
            self.active += 1
            self.public += kind == 'public'
            return True

    def leave(self, kind):
        with self.lock:
            self.active -= 1
            self.public -= kind == 'public'

    def queue(self, kind, delta):
        with self.lock:
            if delta > 0 and (self.waiting >= 8 or (kind == 'public' and self.public_waiting >= 7)): return False
            self.waiting += delta
            self.public_waiting += delta if kind == 'public' else 0
            return True


admission = Admission()


class PasswordAdmission:
    def __init__(self, app): self.app = app

    async def __call__(self, scope, receive, send):
        kind = category(scope) if scope['type'] == 'http' else None
        if kind is None: return await self.app(scope, receive, send)
        messages = deque()
        disconnected = asyncio.Event()
        available = asyncio.Event()
        oversized = asyncio.Event()

        async def watch():
            size = 0
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect':
                    disconnected.set(); available.set()
                    return
                size += len(message.get('body', b''))
                if size > 16384 or len(messages) >= 256:
                    oversized.set(); available.set()
                    return
                messages.append(message); available.set()

        watcher = asyncio.create_task(watch())
        entered = queued = False
        try:
            reservation = await run_in_threadpool(source_attempt, Request(scope), kind)
            if reservation is None:
                return await JSONResponse({'detail': 'Too many tries. Wait a minute and try again.'}, 429,
                                          headers={'Retry-After': '60'})(scope, receive, send)
            deadline = time.monotonic() + WAIT_SECONDS
            while True:
                if disconnected.is_set():
                    return await JSONResponse({'detail': BUSY},503,headers={'Retry-After':'2'})(scope,receive,send)
                if watcher.done():
                    watcher.result()
                    return await JSONResponse({'detail': 'Password form is too large.'}, 413)(scope, receive, send)
                entered = admission.enter(kind)
                if entered: break
                if not queued:
                    queued = admission.queue(kind, 1)
                    if not queued: break
                if time.monotonic() >= deadline: break
                await asyncio.sleep(.01)
            if not entered:
                return await JSONResponse({'detail': BUSY}, 503, headers={'Retry-After': '2'})(scope, receive, send)
            if queued:
                admission.queue(kind, -1); queued = False
            if disconnected.is_set():
                return await JSONResponse({'detail': BUSY},503,headers={'Retry-After':'2'})(scope,receive,send)

            async def replay():
                # Keep the receiver alive through dispatch: cancelling receive at admission
                # can lose an in-flight body message at an ASGI middleware boundary.
                while not messages:
                    if oversized.is_set():
                        from fastapi import HTTPException
                        raise HTTPException(413, 'Password form is too large.')
                    if disconnected.is_set(): return {'type':'http.disconnect'}
                    available.clear()
                    await available.wait()
                return messages.popleft()

            async def response(message):
                nonlocal entered
                if message['type'] == 'http.response.start' and 200 <= message['status'] < 300:
                    await run_in_threadpool(source_success, reservation)
                await send(message)
                # Password work is over before the response. Device-email background
                # delivery must not occupy admission after the person is signed in.
                if message['type'] == 'http.response.body' and not message.get('more_body', False) and entered:
                    admission.leave(kind); entered = False

            await self.app(scope, replay, response)
        finally:
            watcher.cancel()
            try: await watcher
            except asyncio.CancelledError: pass
            if queued: admission.queue(kind, -1)
            if entered: admission.leave(kind)
