"""Durable member budgets. Call inside the action transaction, after access checks.

Acquire lock() before any existing account/group locks. Never used by blocking.
Receipts keep hashes and result IDs, not posted text or search terms.
"""
import hashlib
import json
import math
import logging
import threading
from fastapi import HTTPException
from . import rate_limits

BUDGETS = {
    'comment': ((6, 60), (100, 86400)),
    'friend': ((5, 60), (30, 86400)),
    'invite': ((30, 86400),),
    'group': ((5, 86400),),
    'group_challenge': ((10, 86400),),
    'reaction': ((60, 60), (500, 86400)),
    'search': ((30, 60), (1000, 86400)),
    'report': ((10, 3600), (50, 86400)),
    'reaction_notice': ((1, 3600),),
}
PAIR_BUDGETS = {'comment': (10, 3600), 'invite': (3, 86400)}
RECEIPT_CAP = 10000


def lock(c, uid):
    with rate_limits.bounded(c):
        if not c.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) AS ok',
                         ('member-action:' + str(uid),)).fetchone()['ok']:
            rate_limits.busy()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()


def refused(seconds):
    seconds = max(1, math.ceil(seconds))
    # Keep the header value in the plain message too: older web/iPhone clients
    # display detail but do not expose response headers.
    raise HTTPException(429, f'Too many requests. Try again in {seconds} seconds.',
                        headers={'Retry-After': str(seconds)})


def _receipt_room(c, uid):
    row = c.execute('''SELECT count(*) AS n,extract(epoch FROM min(expires)-now()) AS wait
        FROM member_action_receipts WHERE user_id=%s AND expires>now()''', (uid,)).fetchone()
    if row['n'] >= RECEIPT_CAP: refused(row['wait'])


def _wait(c, uid, kind, cap, seconds, recipient=None):
    row = c.execute('''SELECT count(*) AS n,
        extract(epoch FROM min(created)+make_interval(secs=>%s)-now()) AS wait
        FROM member_action_events WHERE user_id=%s AND kind=ANY(%s)
        AND created>now()-make_interval(secs=>%s)
        AND (%s::bigint IS NULL OR recipient_id=%s)''',
                    (seconds, uid, [kind, 'comment_delivery'] if kind == 'comment' and recipient is not None else [kind],
                     seconds, recipient, recipient)).fetchone()
    return float(row['wait']) if row['n'] >= cap else 0


def claim(c, uid, kind, target='', *, recipient=None, payload=None, request_key=None, quiet=False, unchanged=False):
    """Reserve once, or return a matching committed receipt/quiet duplicate.

    All limits, receipt and action writes roll back together. Replays must be
    authorized by the caller again and must render current data, never a snapshot.
    For unchanged reactions, the caller holds the existing reaction row lock;
    keep any retry receipt but do not reserve a write budget/event.
    """
    lock(c, uid)
    fingerprint = digest([kind, target, payload])
    target_hash = digest(target)
    if request_key is not None:
        old = c.execute('''SELECT fingerprint,result FROM member_action_receipts
            WHERE user_id=%s AND client_id=%s AND expires>now()''', (uid, request_key)).fetchone()
        if old:
            if old['fingerprint'] != fingerprint:
                raise HTTPException(409, 'This retry belongs to a different action. Please start again.')
            return {'replayed': True, 'result': old['result']}
    duplicate = None
    if quiet:
        duplicate = c.execute('''SELECT result FROM member_action_events WHERE user_id=%s AND kind=%s
            AND target_hash=%s AND payload_hash=%s AND created>now()-interval '60 seconds'
            ORDER BY id DESC LIMIT 1''', (uid, kind, target_hash, digest(payload))).fetchone()
    if not duplicate and not unchanged:
        waits = [_wait(c, uid, kind, cap, seconds,
                       recipient if kind == 'reaction_notice' else None)
                 for cap, seconds in BUDGETS[kind]]
        if recipient is not None and recipient != uid and kind in PAIR_BUDGETS:
            cap, seconds = PAIR_BUDGETS[kind]
            waits.append(_wait(c, uid, kind, cap, seconds, recipient))
        if max(waits): refused(max(waits))
    if request_key is not None:
        _receipt_room(c, uid)
        c.execute('DELETE FROM member_action_receipts WHERE user_id=%s AND expires<=now()', (uid,))
        c.execute('''INSERT INTO member_action_receipts(user_id,client_id,fingerprint,result)
            VALUES(%s,%s,%s,%s)''', (uid, request_key, fingerprint, duplicate['result'] if duplicate else None))
    if duplicate:
        return {'replayed': True, 'result': duplicate['result']}
    if unchanged:
        return {'replayed': False, 'id': None, 'user_id': uid, 'request_key': request_key}
    event = c.execute('''INSERT INTO member_action_events(user_id,kind,target_hash,payload_hash,recipient_id)
        VALUES(%s,%s,%s,%s,%s) RETURNING id''', (uid, kind, target_hash, digest(payload), recipient)).fetchone()
    return {'replayed': False, 'id': event['id'], 'user_id': uid, 'request_key': request_key}


def finish(c, claim, result):
    if claim['replayed']: return
    value = str(result)
    if claim['id'] is not None:
        c.execute('UPDATE member_action_events SET result=%s WHERE id=%s AND user_id=%s',
                  (value, claim['id'], claim['user_id']))
    if claim['request_key'] is not None:
        c.execute('UPDATE member_action_receipts SET result=%s WHERE user_id=%s AND client_id=%s',
                  (value, claim['user_id'], claim['request_key']))


def comment_recipients(c, uid, recipients):
    """Group updates share the cross-surface recipient cap, one actor action."""
    lock(c, uid)
    recipients = sorted(set(recipients) - {uid})
    waits = [_wait(c, uid, 'comment', 10, 3600, recipient) for recipient in recipients]
    if waits and max(waits): refused(max(waits))
    for recipient in recipients:
        c.execute('''INSERT INTO member_action_events(user_id,kind,target_hash,payload_hash,recipient_id)
            VALUES(%s,'comment_delivery',%s,%s,%s)''', (uid, digest('delivery'), digest(None), recipient))


def cooldown(c, uid, recipient, seconds=None):
    # The pair upsert serializes writers; a decline must not take the sender's admission lock.
    if seconds is not None:
        c.execute('''INSERT INTO member_pair_cooldowns(user_id,recipient_id,expires)
            VALUES(%s,%s,now()+make_interval(secs=>%s)) ON CONFLICT(user_id,recipient_id)
            DO UPDATE SET expires=greatest(member_pair_cooldowns.expires,EXCLUDED.expires)''',
                  (uid, recipient, seconds))
    else:
        lock(c, uid)
        row = c.execute('''SELECT extract(epoch FROM expires-now()) AS wait FROM member_pair_cooldowns
            WHERE user_id=%s AND recipient_id=%s AND expires>now()''', (uid, recipient)).fetchone()
        if row: refused(row['wait'])


def notice(c, actor, recipient):
    # Suppression is quiet; individual reactions are still saved.
    lock(c, actor)
    if _wait(c, actor, 'reaction_notice', 1, 3600, recipient): return False
    claim(c, actor, 'reaction_notice', recipient, recipient=recipient)
    return True


def report(c, uid, table, where, params, request_key=None):
    """Fixed internal SQL only. Recheck item visibility before calling."""
    assert table in ('reports', 'route_reports', 'segment_reports')
    lock(c, uid)
    target = [table, where, params]
    if request_key is not None:
        saved = c.execute('''SELECT fingerprint,result FROM member_action_receipts
            WHERE user_id=%s AND client_id=%s AND expires>now()''', (uid, request_key)).fetchone()
        if saved:
            if saved['fingerprint'] != digest(['report', target, None]):
                raise HTTPException(409, 'This retry belongs to a different action. Please start again.')
            return int(saved['result'])
    previous = c.execute(f'SELECT id FROM {table} WHERE reporter=%s AND status=\'open\' AND {where} ORDER BY id LIMIT 1',
                         (uid, *params)).fetchone()
    if previous:
        # Existing open report is the receipt even when the caller uses a new key.
        if request_key is not None:
            _receipt_room(c, uid)
            c.execute('DELETE FROM member_action_receipts WHERE user_id=%s AND client_id=%s', (uid, request_key))
            c.execute('''INSERT INTO member_action_receipts(user_id,client_id,fingerprint,result)
                VALUES(%s,%s,%s,%s)''', (uid, request_key, digest(['report', target, None]), str(previous['id'])))
        return previous['id']
    n = c.execute(f"SELECT count(*) AS n FROM {table} WHERE reporter=%s AND status='open'", (uid,)).fetchone()['n']
    if n >= 20:
        raise HTTPException(429, 'Your earlier reports are waiting for review.', headers={'Retry-After': '3600'})
    claim(c, uid, 'report', target, request_key=request_key)
    return None


def report_saved(c, uid, key, rid):
    if key is not None:
        c.execute('UPDATE member_action_receipts SET result=%s WHERE user_id=%s AND client_id=%s', (str(rid), uid, key))


def cleanup():
    # Three fixed, indexed batches; quiet accounts expire too. No content rows.
    with rate_limits.connection() as c:
        for table, predicate in (('member_action_receipts', 'expires<=now()'),
                                 ('member_action_events', "created<=now()-interval '8 days'"),
                                 ('member_pair_cooldowns', 'expires<=now()')):
            c.execute(f'''DELETE FROM {table} WHERE ctid IN (SELECT ctid FROM {table}
                WHERE {predicate} LIMIT 2000 FOR UPDATE SKIP LOCKED)''')


def start_cleanup():
    stop = threading.Event()
    def run():
        while not stop.is_set():
            try: cleanup()
            except Exception: logging.getLogger(__name__).warning('Member counter cleanup deferred')
            stop.wait(60)
    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    return stop, worker
