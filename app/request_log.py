"""One row per API call (2026-10-24, the owner's request): who, when, which endpoint, the result and how long it took.

The endpoint is its pattern (/api/activities/{aid}), never the values, query string or body, and no IP address is
kept. Successful optional aggregate-counter calls bypass this account-linked history so it cannot become a
second usage event log. Other rows are written after the response has gone, on a worker thread, so logging never slows or breaks a request,
and anything older than 90 days is deleted. Only the server owner's all-people SQL login can read them (migration 70).
"""
import asyncio
import random
import uuid
from . import db

KEEP_DAYS = 90


def channel(request):
    if request.url.path.startswith('/api/admin'): return 'portal'
    return 'app' if request.headers.get('authorization', '')[:7].lower() == 'bearer ' else 'web'


def route(request):
    r = request.scope.get('route')
    return getattr(r, 'path', None) or 'unmatched'


def _write(row):
    try:
        with db.connect() as c:
            c.execute("""INSERT INTO api_requests (user_id, method, route, status, duration_ms, channel, request_id)
                         VALUES (%(user_id)s, %(method)s, %(route)s, %(status)s, %(duration_ms)s, %(channel)s, %(request_id)s)""", row)
            if random.random() < 0.002:
                c.execute('DELETE FROM api_requests WHERE created < now() - %s * interval \'1 day\'', (KEEP_DAYS,))
    except Exception:
        pass      # a full disk or a deleted account mid-request must never turn into an error for the person


def record(request, status, duration_ms, request_id):
    if status==204 and route(request)=='/api/features/open':return
    row = {'user_id': getattr(request.state, 'user_id', None), 'method': request.method, 'route': route(request)[:200],
           'status': status, 'duration_ms': max(0, int(duration_ms)), 'channel': channel(request), 'request_id': request_id}
    asyncio.get_running_loop().run_in_executor(None, _write, row)


def new_id():
    return str(uuid.uuid4())
