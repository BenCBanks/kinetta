"""Durable brakes for legacy note requests, separate from model-facing text."""
from contextlib import contextmanager
from contextvars import ContextVar
from uuid import uuid4
from . import db

_current = ContextVar('coach_note_request', default=None)


def started():
    """Called immediately before the transport attempt, never on budget denial."""
    state = _current.get()
    if state is not None:
        state['started'] = True


@contextmanager
def note(uid, aid, limit):
    prefix = f'coach-note:{uid}:'
    key = f'{prefix}{aid}:{uuid4()}'
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))', (prefix,))
        c.execute("DELETE FROM auth_attempts WHERE key LIKE %s AND created <= now() - interval '1 day'", (prefix+'%',))
        # Preserve pre-existing successful requests once, at their original time.
        # Saved results of tracked generations never become a second charge.
        c.execute("""INSERT INTO auth_attempts(key,created)
            SELECT %s || a.id::text || ':legacy',a.ai_note_at FROM activities a
            WHERE a.user_id=%s AND a.ai_note_at > now() - interval '1 day'
            AND NOT EXISTS (SELECT 1 FROM auth_attempts r
                WHERE r.key LIKE %s || a.id::text || ':%%' AND r.created <= a.ai_note_at)""",
            (prefix, uid, prefix))
        count = c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key LIKE %s", (prefix+'%',)).fetchone()['n']
        if count >= limit:
            raise ValueError('Daily limit for Kit’s notes reached - try again tomorrow.')
        c.execute('INSERT INTO auth_attempts(key) VALUES(%s)', (key,))
    # The committed slot serializes concurrent workers while provider setup runs.
    # A normal pre-generation failure gives it back; a crash remains conservative.
    state = {'started': False}
    token = _current.set(state)
    try:
        yield
    finally:
        _current.reset(token)
        if not state['started']:
            with db.connect() as c:
                c.execute('DELETE FROM auth_attempts WHERE key=%s', (key,))
