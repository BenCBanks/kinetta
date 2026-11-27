"""Cheap source-level admission before public enrollment body parsing/validation."""
import math
from fastapi import HTTPException
from fastapi.routing import APIRoute
from starlette.concurrency import run_in_threadpool
from . import auth, db

# Shared Wi-Fi headroom: ten people can each submit five times in one burst.
BURST, HOUR = 60, 240


def check(request):
    # Reuse exactly the existing trusted-proxy boundary. Never store form data.
    key = 'enrollment-source:' + auth.token_hash(auth.client_ip(request))
    retry = 0
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (key,))
        # Take one fresh timestamp after waiting, shared by both windows/expiry.
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
            if request.method == 'POST':
                # Runs before FastAPI reads/decodes the body, including malformed
                # JSON and Pydantic failures; SQL never blocks the event loop.
                await run_in_threadpool(check, request)
            return await handle(request)
        return limited
