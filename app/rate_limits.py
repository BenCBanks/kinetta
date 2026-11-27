"""Short database admission operations; no advisory-lock wait queue."""
import logging
import threading
from contextlib import contextmanager
from fastapi import HTTPException
from psycopg.errors import LockNotAvailable, QueryCanceled
from psycopg_pool import PoolTimeout
from . import db


def busy():
    raise HTTPException(503, 'Kinetta is busy. Please try again shortly.', headers={'Retry-After':'2'})


@contextmanager
def connection():
    try:
        with db.pool().connection(timeout=.1) as c:
            c.execute("""SELECT set_config(name, (CASE WHEN setting::int=0 THEN cap
                  ELSE least(setting::int,cap) END)::text, true)
                FROM pg_settings JOIN (VALUES ('statement_timeout',250),('lock_timeout',50))
                  AS limits(name,cap) USING(name)""")
            yield c
    except (PoolTimeout, QueryCanceled, LockNotAvailable):
        busy()


@contextmanager
def bounded(c):
    # Reading settings also starts the caller's outer transaction when idle.
    # A successful savepoint must not commit/release its reservation early.
    before = {r['name']:int(r['setting']) for r in c.execute(
        "SELECT name,setting FROM pg_settings WHERE name IN ('statement_timeout','lock_timeout')")}
    try:
        with c.transaction():
            values = [str(min(before[name], cap) if before[name] else cap)
                      for name, cap in (('statement_timeout',250),('lock_timeout',50))]
            settings = "SELECT set_config('statement_timeout',%s,true),set_config('lock_timeout',%s,true)"
            c.execute(settings, values)
            yield
            c.execute(settings, (str(before['statement_timeout']),str(before['lock_timeout'])))
    except (QueryCanceled, LockNotAvailable):
        busy()


def try_lock(c, key, *, legacy=False):
    # Preserve the existing namespace/hash, including admin's older hashtext keys.
    function = 'hashtext(%s)' if legacy else 'hashtextextended(%s,0)'
    if not c.execute('SELECT pg_try_advisory_xact_lock('+function+') AS ok', (key,)).fetchone()['ok']:
        busy()


def lock(c, key):
    with bounded(c): try_lock(c, key)


def cleanup():
    # Bounded background batches; row locks cannot make maintenance queue behind
    # requests. Old rows never count toward a live window even if a pass defers.
    with connection() as c:
        return sum(c.execute(f'''DELETE FROM {table} WHERE ctid IN (
            SELECT ctid FROM {table} WHERE created<now()-interval '{age}'
            LIMIT 500 FOR UPDATE SKIP LOCKED)''').rowcount for table, age in (
                ('auth_attempts','1 day'), ('admin_attempts','15 minutes')))


def start_cleanup():
    stop = threading.Event()
    def run():
        while not stop.is_set():
            try: cleanup()
            except Exception: logging.getLogger(__name__).warning('Rate counter cleanup deferred')
            stop.wait(60)
    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    return stop, worker
