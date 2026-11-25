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
    """Erase content, including legacy turns linked through a deleted visit."""
    if conversation_id is not None:
        thread(c, uid, conversation_id)
    c.execute('''DELETE FROM kit_turns WHERE user_id=%s AND (%s::uuid IS NULL
      OR conversation_id=%s OR visit_id IN (SELECT id FROM kit_visits WHERE user_id=%s
        AND coalesce(conversation_id,draft_conversation_id)=%s))''',
      (uid, conversation_id, conversation_id, uid, conversation_id))
    c.execute('''DELETE FROM kit_visits WHERE user_id=%s AND
      (%s::uuid IS NULL OR coalesce(conversation_id,draft_conversation_id)=%s)''',
      (uid, conversation_id, conversation_id))
    c.execute('DELETE FROM kit_threads WHERE user_id=%s AND (%s::uuid IS NULL OR id=%s)',
              (uid, conversation_id, conversation_id))


def visible(row):
    """Legacy unknown provenance is retained privately, never shown or replayed."""
    return row.get('replay_blocked_at') is None

def enabled():
    import os
    return os.environ.get('KINETTA_KIT_HISTORY_ENABLED') == '1'


def conversation(c, uid, visit_id):
    if visit_id is None:
        return None
    row = c.execute('SELECT conversation_id FROM kit_visits WHERE user_id=%s AND id=%s',
                    (uid, visit_id)).fetchone()
    return row['conversation_id'] if row else None


def scope(conversation_id, generation, visit_id):
    # Only fixed SQL, never a caller-supplied condition or account identifier.
    return (('conversation_id=%s', (conversation_id,)) if conversation_id else
            ('generation=%s AND visit_id IS NOT DISTINCT FROM %s::uuid', (generation, visit_id)))
