"""Own-account durable storage. Callers serialize changes with the Kit account lock."""
from fastapi import HTTPException


def thread(c, uid, conversation_id):
    row = c.execute('SELECT * FROM kit_threads WHERE user_id=%s AND id=%s',
                    (uid, conversation_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Kit conversation unavailable')
    return row


def preserve(c, uid, visit_id=None):
    """Detach saved turns before visit cleanup, even if the rollout is later disabled.

    Ending a visit cancels work; it never silently retries a provider or erases history.
    Unlinked legacy turns keep their existing visit-cascade behavior.
    """
    c.execute("""UPDATE kit_turns t SET visit_id=NULL, lease=NULL, expires=NULL,
      state=CASE WHEN t.state IN ('pending','running') THEN 'failed' ELSE t.state END,
      error=CASE WHEN t.state IN ('pending','running')
        THEN 'This answer was interrupted. Tap Retry to try again.' ELSE t.error END
      FROM kit_visits v WHERE t.user_id=%s AND v.user_id=t.user_id AND v.id=t.visit_id
      AND t.conversation_id IS NOT NULL
      AND ((%s::uuid IS NOT NULL AND v.id=%s) OR (%s::uuid IS NULL
        AND (v.created<now()-interval '24 hours' OR v.ended IS NOT NULL)))""",
      (uid, visit_id, visit_id, visit_id))


def remove(c, uid, conversation_id=None):
    """Erase saved content and close visits before FK detaches their thread reference.

    Closed visits remain tombstones under the existing visit lifecycle: delayed work
    cannot reopen them or save an in-flight answer. Account deletion cascades all rows.
    """
    if conversation_id is not None:
        thread(c, uid, conversation_id)
    c.execute('''UPDATE kit_visits SET ended=coalesce(ended,now()) WHERE user_id=%s
      AND conversation_id IS NOT NULL AND (%s::uuid IS NULL OR conversation_id=%s)''',
      (uid, conversation_id, conversation_id))
    c.execute('DELETE FROM kit_threads WHERE user_id=%s AND (%s::uuid IS NULL OR id=%s)',
              (uid, conversation_id, conversation_id))
