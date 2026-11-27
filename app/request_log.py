"""Best-effort API diagnostics: fixed route metadata only, never bodies, values or IPs.

One writer and 64 outstanding rows bound work independently of the request executor.
The newest 100,000 rows are retained for up to 90 days; old rows are pruned in bounded
batches. Overload drops diagnostics, never the person's request. Owner-only SQL
access and deletion behavior are unchanged (migration 70); admin audit is separate.
"""
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from . import db

KEEP_DAYS, MAX_ROWS, PRUNE_BATCH = 90, 100_000, 500
PENDING = 64
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='request-diagnostics')
_pending = threading.BoundedSemaphore(PENDING)
_counts_lock = threading.Lock()
_counts = {'pending': 0, 'written': 0, 'dropped': 0}
_cleanup_after = 0


def channel(request):
    if request.url.path.startswith('/api/admin'): return 'portal'
    return 'app' if request.headers.get('authorization', '')[:7].lower() == 'bearer ' else 'web'


def route(request):
    r = request.scope.get('route')
    return getattr(r, 'path', None) or 'unmatched'


def stats():
    # Aggregate process counters only; reset at restart, no per-account history.
    with _counts_lock: return dict(_counts)


def _write(row):
    global _cleanup_after
    try:
        with db.pool().connection(timeout=.1) as c:
            c.execute("SET LOCAL statement_timeout='250ms'")
            c.execute("SET LOCAL lock_timeout='50ms'")
            # Serialize the row cap across app processes without waiting on a lock.
            if not c.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('request-diagnostics',0)) AS ok").fetchone()['ok']:
                return False
            now = time.monotonic()
            if now >= _cleanup_after:
                removed = c.execute("""DELETE FROM api_requests WHERE id IN
                    (SELECT id FROM api_requests WHERE created<now()-%s*interval '1 day'
                     ORDER BY created LIMIT %s)""", (KEEP_DAYS, PRUNE_BATCH)).rowcount
            else: removed = None
            def count():
                return c.execute('SELECT count(*) AS n FROM (SELECT 1 FROM api_requests LIMIT %s) bounded',
                                 (MAX_ROWS + 1,)).fetchone()['n']
            n = count()
            if n >= MAX_ROWS:
                # Existing oversized tables converge in small batches. Do not
                # add rows while they remain over the cap, even after a restart.
                c.execute('DELETE FROM api_requests WHERE id IN (SELECT id FROM api_requests ORDER BY id LIMIT %s)',
                          (PRUNE_BATCH if n > MAX_ROWS else 1,))
                if count() >= MAX_ROWS: return False
            c.execute("""INSERT INTO api_requests (user_id, method, route, status, duration_ms, channel, request_id)
                         VALUES (%(user_id)s, %(method)s, %(route)s, %(status)s, %(duration_ms)s, %(channel)s, %(request_id)s)""", row)
        if removed is not None: _cleanup_after = now + (1 if removed == PRUNE_BATCH else 60)
        return True
    except Exception:
        return False  # disk, pool, deleted account or DB failure cannot break a response


def enqueue(row):
    if not _pending.acquire(False):
        with _counts_lock: _counts['dropped'] += 1
        return False
    with _counts_lock: _counts['pending'] += 1
    def completed(future):
        try: ok = bool(future.result())
        except Exception: ok = False
        with _counts_lock:
            _counts['pending'] -= 1
            _counts['written' if ok else 'dropped'] += 1
        _pending.release()
    try: future = _executor.submit(_write, row)
    except Exception:
        with _counts_lock:
            _counts['pending'] -= 1
            _counts['dropped'] += 1
        _pending.release()
        return False
    future.add_done_callback(completed)
    return True


def record(request, status, duration_ms, request_id):
    if status==204 and route(request)=='/api/features/open':return
    row = {'user_id': getattr(request.state, 'user_id', None), 'method': request.method[:10], 'route': route(request)[:200],
           'status': status, 'duration_ms': min(2**31-1, max(0, int(duration_ms))), 'channel': channel(request), 'request_id': request_id}
    enqueue(row)


def new_id():
    return str(uuid.uuid4())
