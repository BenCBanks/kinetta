"""One-hour fallback passwords can only open a ten-minute password-change challenge, never an app session."""
import datetime as dt
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from . import auth, db
from .admin_auth import admin_user
from .admin_actions import ActionIn, replay, complete

router = APIRouter()

class TemporaryIn(ActionIn):
    password: str = Field(min_length=10, max_length=200)
    confirm: str = Field(max_length=30)


@router.post('/api/admin/people/{uid}/temporary-password')
def temporary(uid: int, body: TemporaryIn, user=Depends(admin_user)):
    with db.connect() as c:
        digest, old = replay(c, user, body, 'account.temporary_password', uid)
        if old: return old
        p = c.execute('SELECT id,login::text AS login,is_admin,email_verified_at FROM users WHERE id=%s FOR UPDATE', (uid,)).fetchone()
        if not p: raise HTTPException(404, 'Account not found.')
        if p['is_admin'] or uid == user['id']: raise HTTPException(409, 'Use the administrator recovery process for an administrator.')
        if p['email_verified_at']: raise HTTPException(409, 'This account has a confirmed email. Send a password reset link instead.')
        if body.confirm != p['login']: raise HTTPException(400, 'Type the account username exactly.')
        auth.check_new_password(body.password, p['login'])
        expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
        c.execute('UPDATE users SET pw_hash=%s,password_change_expires=%s WHERE id=%s', (auth.hash_pw(body.password), expires, uid))
        revoke(c, uid)
        c.execute('DELETE FROM account_tokens WHERE user_id=%s AND kind=\'reset_password\'', (uid,))
        return complete(c, user, body, 'account.temporary_password', uid, digest, expires=expires.isoformat())


def revoke(c, uid):
    for table in ('sessions', 'admin_sessions', 'admin_challenges', 'account_password_changes'):
        c.execute(f'DELETE FROM {table} WHERE user_id=%s', (uid,))


def challenge(c, uid, expires):
    now = dt.datetime.now(dt.timezone.utc)
    if expires <= now: raise auth.Failed(401, 'This temporary password expired. Ask the person who runs Kinetta for a new one.')
    token = secrets.token_urlsafe(32)
    c.execute('DELETE FROM account_password_changes WHERE user_id=%s OR expires<=now()', (uid,))
    c.execute('INSERT INTO account_password_changes(token_hash,user_id,expires) VALUES (%s,%s,%s)',
              (auth.token_hash(token), uid, min(expires, now + dt.timedelta(minutes=10))))
    return {'password_change_required': True, 'change_token': token}


class ChangeIn(BaseModel):
    change_token: str = Field(min_length=20, max_length=100)
    password: str = Field(min_length=10, max_length=200)
    password_confirm: str = Field(min_length=10, max_length=200)


@router.post('/api/password/temporary')
def change(body: ChangeIn, request: Request):
    ip = auth.client_ip(request)
    if auth.too_many(ip, 'temporary-change'): raise HTTPException(429, 'Too many tries - wait 15 minutes')
    if body.password != body.password_confirm: raise HTTPException(400, 'The passwords do not match.')
    try:
        with db.connect() as c:
            p = c.execute('''SELECT u.id,u.login::text AS login,u.pw_hash FROM account_password_changes t JOIN users u ON u.id=t.user_id
                 WHERE t.token_hash=%s AND t.expires>now() AND u.password_change_expires>now() AND u.suspended_at IS NULL
                 FOR UPDATE OF u,t''', (auth.token_hash(body.change_token),)).fetchone()
            if not p: raise auth.Failed(401, 'This password-change step expired or was already used. Log in again to start a new one.')
            auth.check_new_password(body.password, p['login'])
            if auth.check_pw(p['pw_hash'], body.password): raise HTTPException(400, 'Choose a different password from the temporary one.')
            c.execute('UPDATE users SET pw_hash=%s,password_change_expires=NULL WHERE id=%s', (auth.hash_pw(body.password), p['id']))
            revoke(c, p['id'])
            c.execute("DELETE FROM account_tokens WHERE user_id=%s AND kind='reset_password'", (p['id'],))
            from .admin_auth import audit
            audit(c, p['id'], 'account.temporary_password_changed', p['id'])
    except auth.Failed as e:
        auth.failed(ip, 'temporary-change'); raise HTTPException(e.status, e.message)
    return {'ok': True}   # Deliberately no cookie/token. Sign in normally with the new password.
