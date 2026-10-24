"""Email on accounts (#232 A–C, 2026-10-24): add or change your address, confirm it from a link, and reset a forgotten
password by email.

An address counts only after its owner opens the confirmation link sent to it, so nobody can claim someone else's email.
Links are single-use and only their hash is stored (like invites). "Forgot password" answers the same way whether or not
an account matches, and sends from the background, so it never reveals who has an account. Attempts are counted in the
database (auth_attempts), so the limits survive restarts. Messages are plain text and never contain a password.
"""
import datetime as dt
import os
import secrets
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from psycopg import errors
from . import db, auth, admin_mail
from .api_beta import EMAIL_RE
from .auth import current_user

router = APIRouter()
VERIFY_HOURS, RESET_MINUTES = 24, 60
SENT = 'If that matches an account with a confirmed email, we’ve sent a link to reset the password. Check your inbox and spam folder.'


def _clean_email(v):
    v = (v or '').strip()
    if len(v) > 120 or not EMAIL_RE.fullmatch(v): raise HTTPException(400, 'Check the email address')
    return v


def _base():
    return os.environ.get('KINETTA_PUBLIC_URL', '').rstrip('/')


def limited(c, key, most, minutes):
    """True once `key` has been tried `most` times in the last `minutes`; every call counts as a try."""
    c.execute("DELETE FROM auth_attempts WHERE created < now() - interval '1 day'")
    n = c.execute("SELECT count(*) AS n FROM auth_attempts WHERE key = %s AND created > now() - %s",
                  (key, dt.timedelta(minutes=minutes))).fetchone()['n']
    c.execute('INSERT INTO auth_attempts (key) VALUES (%s)', (key,))
    return n >= most


def send(to, subject, text):
    """One plain-text message through the configured provider. Returns False (never raises) when it couldn't be sent."""
    cfg = admin_mail.settings()
    if not cfg['ready']: return False
    try:
        r = httpx.post('https://api.resend.com/emails', headers={'Authorization': 'Bearer ' + db.secret('KINETTA_RESEND_KEY')},
                       json={'from': cfg['sender'], 'to': [to], 'reply_to': cfg['reply_to'], 'subject': subject, 'text': text}, timeout=10)
        return r.is_success
    except httpx.HTTPError:
        return False      # the provider's answer may contain addresses or keys: never log it


def _token(c, uid, kind, minutes, email=None):
    token = secrets.token_urlsafe(32)
    c.execute('DELETE FROM account_tokens WHERE user_id = %s AND kind = %s AND used_at IS NULL', (uid, kind))   # one live link each
    c.execute('INSERT INTO account_tokens (token_hash, user_id, kind, email, expires) VALUES (%s, %s, %s, %s, now() + %s)',
              (auth.token_hash(token), uid, kind, email, dt.timedelta(minutes=minutes)))
    return token


def _open(c, token, kind):
    r = c.execute("""SELECT t.token_hash, t.user_id, t.email, u.login::text AS login, u.name, u.email AS current
                     FROM account_tokens t JOIN users u ON u.id = t.user_id
                     WHERE t.token_hash = %s AND t.kind = %s AND t.used_at IS NULL AND t.expires > now() FOR UPDATE OF t""",
                  (auth.token_hash(token or ''), kind)).fetchone()
    if not r: raise HTTPException(404, 'This link has expired or was already used. Ask for a new one.')
    return r


def mail_ready():
    return admin_mail.settings()['ready'] and bool(_base())


# ---------- your email ----------
class EmailIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


@router.put('/api/account/email')
def set_email(body: EmailIn, request: Request, background: BackgroundTasks, user=Depends(current_user)):
    """Sends a confirmation link to the new address; the account uses it only after the link is opened."""
    email = _clean_email(body.email)
    if not mail_ready(): raise HTTPException(503, 'Email isn’t set up on this Kinetta yet. Ask the person who runs it.')
    with db.connect() as c:
        if limited(c, f"email:{user['id']}", 5, 60): raise HTTPException(429, 'Too many tries - wait an hour')
        stored = c.execute('SELECT pw_hash FROM users WHERE id = %s', (user['id'],)).fetchone()['pw_hash']
        if not auth.check_pw(stored, body.password): raise HTTPException(400, 'Your password is wrong')
        token = _token(c, user['id'], 'verify_email', VERIFY_HOURS * 60, email)
    link = f'{_base()}/confirm-email/{token}'
    background.add_task(send, email, 'Confirm your email for Kinetta',
        f"Hi {user['name']},\n\nOpen this link to confirm this is your email address for Kinetta:\n{link}\n\n"
        f"It works once and expires in {VERIFY_HOURS} hours. You'll then be able to log in with this address and reset "
        "your password if you forget it.\n\nIf you didn't ask for this, ignore this email; nothing changes.")
    return {'ok': True, 'pending': email}


class TokenIn(BaseModel):
    token: str = Field(max_length=100)


@router.post('/api/account/email/confirm')
def confirm_email(body: TokenIn, request: Request, background: BackgroundTasks):
    """No login needed: the link may be opened on another device."""
    with db.connect() as c:
        if limited(c, 'confirm:' + auth.client_ip(request), 20, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        r = _open(c, body.token, 'verify_email')
        try:
            with c.transaction():
                c.execute('UPDATE users SET email = %s, email_verified_at = now() WHERE id = %s', (r['email'], r['user_id']))
        except errors.UniqueViolation:
            raise HTTPException(409, 'That email is already used by another Kinetta account.')
        c.execute('UPDATE account_tokens SET used_at = now() WHERE token_hash = %s', (r['token_hash'],))
    if r['current'] and r['current'].lower() != r['email'].lower():
        background.add_task(send, r['current'], 'Your Kinetta email was changed',
            f"Hi {r['name']},\n\nThe email on your Kinetta account ({r['login']}) is now {r['email']}. "
            "If you didn't do this, reply to this email straight away.")
    return {'ok': True, 'email': r['email']}


# ---------- forgot password ----------
class ForgotIn(BaseModel):
    login: str = Field(max_length=120)      # a username or a confirmed email


@router.post('/api/password/forgot')
def forgot(body: ForgotIn, request: Request, background: BackgroundTasks):
    who = body.login.strip()
    with db.connect() as c:
        if limited(c, 'forgot-ip:' + auth.client_ip(request), 10, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        col = 'email' if '@' in who else 'login'
        u = c.execute(f'SELECT id, name, login::text AS login, email FROM users WHERE {col} = %s AND email_verified_at IS NOT NULL',
                      (who,)).fetchone()
        # at most 3 links an hour per account, without telling the asker whether that's why nothing arrived
        if u and not limited(c, f"forgot:{u['id']}", 3, 60) and mail_ready():
            token = _token(c, u['id'], 'reset_password', RESET_MINUTES)
            background.add_task(send, u['email'], 'Reset your Kinetta password',
                f"Hi {u['name']},\n\nSomeone asked to reset the password for your Kinetta account ({u['login']}). "
                f"To choose a new one, open this link:\n{_base()}/reset-password/{token}\n\n"
                f"It works once and expires in {RESET_MINUTES} minutes. If you didn't ask, ignore this email; your password stays the same.")
    return {'ok': True, 'message': SENT}


class ResetIn(BaseModel):
    token: str = Field(max_length=100)
    password: str = Field(min_length=8, max_length=200)


@router.get('/api/password/reset/{token}')
def reset_info(token: str, request: Request):
    """Whether a reset link still works, so the page can say so before someone types a new password."""
    with db.connect() as c:
        if limited(c, 'reset-ip:' + auth.client_ip(request), 30, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        r = _open(c, token, 'reset_password')
    return {'login': r['login']}


@router.post('/api/password/reset')
def reset(body: ResetIn, request: Request, background: BackgroundTasks):
    with db.connect() as c:
        if limited(c, 'reset-ip:' + auth.client_ip(request), 30, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        r = _open(c, body.token, 'reset_password')
        auth.check_new_password(body.password, r['login'])
        c.execute('UPDATE users SET pw_hash = %s WHERE id = %s', (auth.hash_pw(body.password), r['user_id']))
        c.execute('UPDATE account_tokens SET used_at = now() WHERE token_hash = %s', (r['token_hash'],))
        # every phone, browser and admin portal session ends: whoever had the old password is out
        for t in ('sessions', 'admin_sessions', 'admin_challenges'): c.execute(f'DELETE FROM {t} WHERE user_id = %s', (r['user_id'],))
    password_changed(background, r['current'], r['name'], r['login'])
    return {'ok': True}


def password_changed(background, email, name, login):
    if email:
        background.add_task(send, email, 'Your Kinetta password was changed',
            f"Hi {name},\n\nThe password for your Kinetta account ({login}) was just changed, and other phones and "
            "browsers were signed out. If you didn't do this, reply to this email straight away.")
