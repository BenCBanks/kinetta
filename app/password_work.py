"""Password request admission: no database leases or worker threads while queued."""
import asyncio
import hashlib
import logging
import secrets
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from psycopg.errors import LockNotAvailable, QueryCanceled
from psycopg_pool import PoolTimeout
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from . import auth, db

PUBLIC = {'/api/login', '/api/signup', '/api/setup', '/api/join', '/api/admin/login'}
PRIVATE = {'/api/account/password', '/api/password/reset', '/api/password/temporary',
           '/api/account/delete', '/api/admin/people'}
WAIT_SECONDS = 5
BODY_SECONDS = 5
BODY_LIMIT = 16384
BODY_MESSAGES = 256
COUNTER_WAIT_SECONDS = 1
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


class SourceBusy(Exception):
    pass


@contextmanager
def source_connection():
    with db.pool().connection(timeout=.1) as c:
        c.execute("SET LOCAL statement_timeout='250ms'")
        c.execute("SET LOCAL lock_timeout='50ms'")
        yield c


def source_attempt(request, kind):
    # Independent of usernames; commit before reading/decoding the body or hashing.
    prefix = source_prefix(request, kind)
    reservation = prefix + secrets.token_hex(16)
    try:
        with source_connection() as c:
            if not c.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) AS ok', (prefix,)).fetchone()['ok']:
                raise SourceBusy()
            n = c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE %s AND created>now()-interval '1 minute'", (prefix + '%',)).fetchone()['n']
            if n >= SOURCE_LIMIT: return None
            c.execute('INSERT INTO auth_attempts(key) VALUES(%s)', (reservation,))
    except (PoolTimeout, QueryCanceled, LockNotAvailable):
        raise SourceBusy() from None
    return reservation


def source_success(reservation):
    # This runs only for an admitted request (at most two), after its route transaction.
    # A short cleanup failure cannot turn a committed sign-in into an error.
    try:
        with source_connection() as c:
            c.execute('DELETE FROM auth_attempts WHERE key=%s', (reservation,))
    except Exception:
        logging.getLogger(__name__).warning('Password request budget cleanup failed; expires after one minute.')


class Admission:
    def __init__(self, places=2, public_places=1):
        self.places, self.public_places = places, public_places
        self.lock = threading.Lock()
        self.active = self.public = self.waiting = self.public_waiting = 0

    def enter(self, kind):
        with self.lock:
            # One of two places is reserved for recovery/change, even during a login flood.
            if self.active >= self.places or (kind == 'public' and self.public >= self.public_places): return False
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
body_readers = Admission(16, 15)
counter_workers = Admission()
_counter_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix='password-source')


async def source_check(request, kind):
    # At most two submitted jobs, with one reserved for recovery. Eight async waiters
    # get at most one second, with no worker thread or DB lease, before a plain retry.
    # A 100ms queue deadline rejected healthy eight-login bursts on shared runners;
    # SQL/pool waits and the number of workers/waiters remain independently bounded.
    # Release on actual completion, not coroutine cancellation while a thread still runs.
    queued = False
    deadline = time.monotonic() + COUNTER_WAIT_SECONDS
    try:
        while True:
            if queued and time.monotonic() >= deadline: raise SourceBusy()
            if counter_workers.enter(kind): break
            if not queued:
                queued = counter_workers.queue(kind, 1)
                if not queued: raise SourceBusy()
            if time.monotonic() >= deadline: raise SourceBusy()
            await asyncio.sleep(.001)
    finally:
        if queued: counter_workers.queue(kind, -1)
    try:
        future = _counter_executor.submit(source_attempt, request, kind)
    except BaseException:
        counter_workers.leave(kind)
        raise
    future.add_done_callback(lambda _: counter_workers.leave(kind))
    return await asyncio.wrap_future(future)


class PasswordAdmission:
    def __init__(self, app): self.app = app

    async def __call__(self, scope, receive, send):
        kind = category(scope) if scope['type'] == 'http' else None
        if kind is None: return await self.app(scope, receive, send)
        deadline = time.monotonic() + BODY_SECONDS
        try:
            reservation = await source_check(Request(scope), kind)
        except SourceBusy:
            return await JSONResponse({'detail': BUSY}, 503,
                                      headers={'Retry-After':'2','Connection':'close'})(scope,receive,send)
        if reservation is None:
            return await JSONResponse({'detail': 'Too many tries. Wait a minute and try again.'}, 429,
                                      headers={'Retry-After':'60','Connection':'close'})(scope,receive,send)
        if not body_readers.enter(kind):
            return await JSONResponse({'detail': BUSY},503,
                                      headers={'Retry-After':'2','Connection':'close'})(scope,receive,send)
        reading = True
        entered = queued = False
        body = bytearray()
        complete = asyncio.Event()
        disconnected = asyncio.Event()
        oversized = False

        async def watch():
            nonlocal oversized
            count = 0
            while True:
                message = await receive()
                if message['type'] == 'http.disconnect':
                    disconnected.set(); complete.set()
                    return
                count += 1
                chunk = message.get('body', b'')
                if count > BODY_MESSAGES or len(body) + len(chunk) > BODY_LIMIT:
                    oversized = True; complete.set()
                    return
                body.extend(chunk)
                if not message.get('more_body', False): complete.set()

        watcher = asyncio.create_task(watch())
        watcher.add_done_callback(lambda _: complete.set())
        try:
            # A fixed total deadline, not an idle timeout: dribbling bytes cannot renew it.
            try:
                await asyncio.wait_for(complete.wait(), max(0, deadline-time.monotonic()))
            except asyncio.TimeoutError:
                return await JSONResponse({'detail':'Password form took too long. Please try again.'},408,
                                          headers={'Connection':'close'})(scope,receive,send)
            if watcher.done(): watcher.result()
            if oversized:
                return await JSONResponse({'detail':'Password form is too large.'},413,
                                          headers={'Connection':'close'})(scope,receive,send)
            if disconnected.is_set():
                return await JSONResponse({'detail':BUSY},503,headers={'Retry-After':'2','Connection':'close'})(scope,receive,send)
            body_readers.leave(kind); reading = False
            deadline = time.monotonic() + WAIT_SECONDS
            while True:
                if disconnected.is_set():
                    return await JSONResponse({'detail':BUSY},503,headers={'Retry-After':'2','Connection':'close'})(scope,receive,send)
                if watcher.done(): watcher.result()
                entered = admission.enter(kind)
                if entered: break
                if not queued:
                    queued = admission.queue(kind, 1)
                    if not queued: break
                if time.monotonic() >= deadline: break
                await asyncio.sleep(.01)
            if not entered:
                return await JSONResponse({'detail': BUSY},503,headers={'Retry-After':'2'})(scope,receive,send)
            if queued:
                admission.queue(kind, -1); queued = False
            if disconnected.is_set():
                return await JSONResponse({'detail':BUSY},503,headers={'Retry-After':'2','Connection':'close'})(scope,receive,send)
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {'type':'http.request','body':bytes(body),'more_body':False}
                await disconnected.wait()
                return {'type':'http.disconnect'}

            async def response(message):
                nonlocal entered
                if message['type'] == 'http.response.start' and 200 <= message['status'] < 300:
                    await run_in_threadpool(source_success, reservation)
                await send(message)
                # Device-email background delivery must not retain password admission.
                if message['type'] == 'http.response.body' and not message.get('more_body', False) and entered:
                    admission.leave(kind); entered = False

            await self.app(scope, replay, response)
        finally:
            watcher.cancel()
            try: await watcher
            except asyncio.CancelledError: pass
            finally:
                if reading: body_readers.leave(kind)
                if queued: admission.queue(kind, -1)
                if entered: admission.leave(kind)
