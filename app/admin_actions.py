"""Replay-safe operator actions. Receipts contain identifiers/outcomes, never request bodies or credentials."""
import datetime as dt
import hashlib
import hmac
import json
import uuid
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict
from . import db
from .admin_auth import audit

class ActionIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    request_key: uuid.UUID
    requested_at: dt.datetime


def replay(c, user, body, action, target):
    # Serialize the small operator write volume, including role changes, before checking the current privilege.
    c.execute("SELECT pg_advisory_xact_lock(hashtext('admin-authorization'))")
    if not c.execute('SELECT id FROM users WHERE id=%s AND is_admin AND suspended_at IS NULL AND password_change_expires IS NULL FOR SHARE',(user['id'],)).fetchone():
        raise HTTPException(403, 'Administrator access was revoked.')
    key = str(body.request_key)
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))", ('admin-action:' + key,))
    # A keyed fingerprint lets us reject a changed password on the same retry ID without keeping a fast password hash.
    secret = db.secret('KINETTA_ADMIN_KEY')
    if not secret: raise HTTPException(503, 'Admin encryption key is unavailable.')
    digest = hmac.new(secret.encode(), json.dumps(body.model_dump(mode='json'), sort_keys=True).encode(), hashlib.sha256).hexdigest()
    old = c.execute('SELECT actor_id,action,target,fingerprint,result FROM admin_action_receipts WHERE request_key=%s', (key,)).fetchone()
    if old:
        if old['actor_id'] != user['id'] or old['action'] != action or old['target'] != str(target) or not hmac.compare_digest(old['fingerprint'], digest):
            raise HTTPException(409, 'This retry belongs to a different action. Open a new confirmation.')
        return digest, old['result']
    now = dt.datetime.now(dt.timezone.utc)
    if not body.requested_at.tzinfo or not now - dt.timedelta(hours=23) <= body.requested_at <= now + dt.timedelta(minutes=5):
        raise HTTPException(409, 'This confirmation expired. Review the current state and open a new one.')
    return digest, None


def complete(c, user, body, action, target, digest, **extra):
    result = {'ok': True, **extra, 'receipt': {'id': str(body.request_key), 'action': action, 'target': str(target),
                                               'at': dt.datetime.now(dt.timezone.utc).isoformat()}}
    c.execute('DELETE FROM admin_action_receipts WHERE created < now() - interval \'90 days\'')
    c.execute('INSERT INTO admin_action_receipts (request_key,actor_id,action,target,fingerprint,result) VALUES (%s,%s,%s,%s,%s,%s)',
              (body.request_key, user['id'], action, str(target), digest, json.dumps(result)))
    audit(c, user['id'], action, target)
    return result
