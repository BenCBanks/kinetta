"""Cheap source-level admission before public enrollment body parsing/validation."""
import math
import logging
import threading
from psycopg.errors import LockNotAvailable, QueryCanceled
from psycopg_pool import PoolTimeout
from fastapi import HTTPException
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from . import auth, db

# Shared Wi-Fi headroom: ten people can each submit five times in one burst.
BURST, HOUR = 60, 240
PUBLIC_POSTS = {'/api/signup', '/api/beta'}
# Acquire before scheduling a worker, so a flood cannot queue unbounded work or
# occupy all eight database connections. This is per process, not a quota.
_slots = threading.BoundedSemaphore(2)


def busy():
    raise HTTPException(429, 'Sign-up is busy. Please try again.', headers={'Retry-After': '1'})


def check(request):
    # Reuse exactly the existing trusted-proxy boundary. Never store form data.
    key = 'enrollment-source:' + auth.token_hash(auth.client_ip(request))
    try:
        return _check(key)
    except (PoolTimeout, QueryCanceled, LockNotAvailable):
        busy()


def _check(key):
    retry = 0
    with db.pool().connection(timeout=.1) as c:
        c.execute("SET LOCAL statement_timeout='250ms'")
        c.execute("SET LOCAL lock_timeout='50ms'")
        if not c.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) AS ok', (key,)).fetchone()['ok']:
            busy()
        # One fresh timestamp shared by both windows/expiry; never wait for a source.
        at = c.execute('SELECT clock_timestamp() AS at').fetchone()['at']
        c.execute("DELETE FROM auth_attempts WHERE key=%s AND created<=%s-interval '1 hour'", (key, at))
        row = c.execute("""SELECT count(*) AS hourly,
            count(*) FILTER (WHERE created>%s-interval '5 minutes') AS burst,
            extract(epoch FROM min(created)+interval '1 hour'-%s) AS hour_wait,
            extract(epoch FROM min(created) FILTER (WHERE created>%s-interval '5 minutes')
                +interval '5 minutes'-%s) AS burst_wait
            FROM auth_attempts WHERE key=%s""", (at, at, at, at, key)).fetchone()
        if row['hourly'] >= HOUR: retry = max(retry, math.ceil(row['hour_wait']))
        if row['burst'] >= BURST: retry = max(retry, math.ceil(row['burst_wait']))
        if not retry:
            c.execute('INSERT INTO auth_attempts(key,created) VALUES(%s,%s)', (key, at))
    if retry:
        raise HTTPException(429, 'Too many sign-up attempts from this network. Please wait and try again.',
                            headers={'Retry-After': str(max(1, retry))})


class EnrollmentRoute(APIRoute):
    def get_route_handler(self):
        handle = super().get_route_handler()
        async def limited(request):
            if request.method == 'POST' and self.path in PUBLIC_POSTS:
                # Runs before FastAPI reads/decodes the body, including malformed
                # JSON and Pydantic failures; SQL never blocks the event loop.
                if not _slots.acquire(blocking=False):
                    busy()
                try:
                    await run_in_threadpool(check, request)
                finally:
                    _slots.release()
            return await handle(request)
        return limited


def cleanup():
    # Indexed, bounded maintenance runs even when a source never comes back.
    # SKIP LOCKED leaves concurrent admissions alone; a later pass retries them.
    with db.pool().connection(timeout=.1) as c:
        c.execute("SET LOCAL statement_timeout='500ms'")
        c.execute("SET LOCAL lock_timeout='50ms'")
        return c.execute("""DELETE FROM auth_attempts WHERE ctid IN (
            SELECT ctid FROM auth_attempts WHERE key LIKE 'enrollment-source:%'
            AND created<=now()-interval '1 hour' ORDER BY created LIMIT 2000
            FOR UPDATE SKIP LOCKED)""").rowcount


def start_cleanup():
    stop = threading.Event()
    def run():
        while not stop.is_set():
            try:
                cleanup()
            except Exception:
                logging.getLogger(__name__).warning('Enrollment counter cleanup deferred')
            stop.wait(60)
    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    return stop, worker
