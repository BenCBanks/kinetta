"""Own-account durable storage. Callers serialize changes with the Kit account lock."""
from fastapi import HTTPException


def thread(c, uid, conversation_id):
    row = c.execute('SELECT * FROM kit_threads WHERE user_id=%s AND id=%s',
                    (uid, conversation_id)).fetchone()
    if not row:
        row=c.execute('''SELECT draft_conversation_id AS id,user_id,created,created AS updated
          FROM kit_visits WHERE user_id=%s AND draft_conversation_id=%s
          AND ended IS NULL AND created>now()-interval '24 hours' LIMIT 1''',(uid,conversation_id)).fetchone()
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
    row = c.execute('SELECT coalesce(conversation_id,draft_conversation_id) AS conversation_id FROM kit_visits WHERE user_id=%s AND id=%s',
                    (uid, visit_id)).fetchone()
    return row['conversation_id'] if row else None


def scope(conversation_id, generation, visit_id):
    # Only fixed SQL, never a caller-supplied condition or account identifier.
    return (('conversation_id=%s', (conversation_id,)) if conversation_id else
            ('conversation_id IS NULL AND generation=%s AND visit_id IS NOT DISTINCT FROM %s::uuid', (generation, visit_id)))



def prune(c, uid):
    preserve(c, uid)
    c.execute("DELETE FROM kit_visits WHERE user_id=%s AND (created<now()-interval '24 hours' OR ended<now()-interval '24 hours')", (uid,))


def consents(c, uid):
    row = c.execute('SELECT health_ai_ok,health_weight_ai_ok,garmin_ai_ok FROM profile WHERE user_id=%s', (uid,)).fetchone()
    return {key:bool(row and row[column]) for key,column in
            [('health','health_ai_ok'),('weight','health_weight_ai_ok'),('garmin','garmin_ai_ok')]}


def permitted_history(answer, current):
    if not ((answer or {}).get('health_included') or (answer or {}).get('garmin_included')):
        return True
    saved = answer.get('history_consents')
    # Historical/older answers lack exact provenance. Never infer permission from
    # source records that the person may since have removed from their account.
    if saved is None:
        return all(current.values())
    return (isinstance(saved,dict) and saved.keys()==current.keys()
            and all(type(value) is bool and (not value or current[key]) for key,value in saved.items()))


MAX_TURNS=200
DAILY_TURNS=30
MAX_THREADS=500
MAX_VISITS=100
OPENS_PER_MINUTE=30
REMOVED_ANSWER='This answer was removed because its health data was removed or sharing was turned off.'


def capacity(c,uid):
    if c.execute('SELECT count(*) n FROM kit_threads WHERE user_id=%s',(uid,)).fetchone()['n']>=MAX_THREADS:
        raise HTTPException(429,'You have 500 saved chats. Delete a chat before starting another.')


def opening(c,uid,visit_id):
    # Caller holds the account lock. Idempotent retries consume neither cap nor rate.
    if c.execute('SELECT 1 FROM kit_visits WHERE id=%s',(visit_id,)).fetchone():return
    prune(c,uid)
    if c.execute('SELECT count(*) n FROM kit_visits WHERE user_id=%s',(uid,)).fetchone()['n']>=MAX_VISITS:
        raise HTTPException(429,'Too many open Kit visits. Please try again later.')
    row=c.execute("""UPDATE kit_conversations SET
      opens_count=CASE WHEN opens_at>now()-interval '1 minute' THEN opens_count+1 ELSE 1 END,
      opens_at=CASE WHEN opens_at>now()-interval '1 minute' THEN opens_at ELSE now() END
      WHERE user_id=%s RETURNING opens_count""",(uid,)).fetchone()
    if row['opens_count']>OPENS_PER_MINUTE:
        raise HTTPException(429,'Please wait a minute before opening another Kit chat.')


def materialize(c,uid,conversation_id):
    if c.execute('SELECT 1 FROM kit_threads WHERE user_id=%s AND id=%s',(uid,conversation_id)).fetchone():return
    thread(c,uid,conversation_id)
    capacity(c,uid)
    c.execute('INSERT INTO kit_threads(id,user_id) VALUES(%s,%s) ON CONFLICT DO NOTHING',(conversation_id,uid))
    if not c.execute('SELECT 1 FROM kit_threads WHERE user_id=%s AND id=%s',(uid,conversation_id)).fetchone():
        raise HTTPException(404,'Kit conversation unavailable')
    c.execute('UPDATE kit_visits SET conversation_id=%s,draft_conversation_id=NULL '
      'WHERE user_id=%s AND draft_conversation_id=%s',(conversation_id,uid,conversation_id))



def admit_turn(c,uid,condition,args):
    # Fixed account-bound scopes only; caller serializes on the account lock.
    if c.execute('SELECT count(*) n FROM kit_turns WHERE user_id=%s AND '+condition,(uid,*args)).fetchone()['n']>=MAX_TURNS:
        raise HTTPException(429,'This chat has 200 messages. Start a new chat to continue.')
    used=c.execute("SELECT requests FROM ai_daily_usage WHERE user_id=%s AND kind='kit_conversation' AND day=(now() AT TIME ZONE 'UTC')::date",(uid,)).fetchone()
    if used and used['requests']>=DAILY_TURNS:
        raise HTTPException(429,'You have reached the daily limit for Kit messages. Please try again tomorrow.')


def discard_unstarted(c,uid,row):
    c.execute('DELETE FROM kit_turns WHERE user_id=%s AND id=%s',(uid,row['id']))
    cid=row['conversation_id']
    if cid and not c.execute('SELECT 1 FROM kit_turns WHERE user_id=%s AND conversation_id=%s',(uid,cid)).fetchone():
        # Keep the active visit usable, but return the empty chat to temporary state.
        c.execute('UPDATE kit_visits SET draft_conversation_id=conversation_id,conversation_id=NULL WHERE user_id=%s AND conversation_id=%s',(uid,cid))
        c.execute('DELETE FROM kit_threads WHERE user_id=%s AND id=%s',(uid,cid))
