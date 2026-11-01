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
    v = (v or '').strip().lower()
    if len(v) > 120 or not EMAIL_RE.fullmatch(v): raise HTTPException(400, 'Check the email address')
    return v


EMAIL_EXISTS = "There's already a Kinetta account with this email"


def email_exists():
    raise HTTPException(409, {'code': 'email_exists', 'message': EMAIL_EXISTS,
                              'login': '/', 'reset': '/forgot-password'})


def reservation_lock(c):
    # Always before account, invitation and confirmation-token locks, including resends.
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended('kinetta-email-reservations',0))")


def require_available(c, email, uid=None, *, confirmation=False):
    """Pending addresses remain claimed when a link expires; replacing/deleting it releases the claim."""
    reservation_lock(c)
    if c.execute('SELECT 1 FROM users WHERE email=%s AND (%s::bigint IS NULL OR id<>%s)', (email,uid,uid)).fetchone():
        email_exists()
    if confirmation:
        return  # Legacy ambiguous pending accounts: the first valid confirmation wins the unique index.
    own = uid is not None and c.execute("""SELECT 1 FROM users WHERE id=%s AND email=%s
      UNION ALL SELECT 1 FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL AND lower(email)=%s LIMIT 1""", (uid,email,uid,email)).fetchone()
    if not own and c.execute("""SELECT 1 FROM account_tokens WHERE kind='verify_email' AND used_at IS NULL
      AND lower(email)=%s AND (%s::bigint IS NULL OR user_id<>%s) LIMIT 1""", (email,uid,uid)).fetchone():
        email_exists()


def enrollment_limit(request, email):
    # Commit rejected attempts too. Keep addresses out of the limiter key.
    with db.connect() as c:
        ip_hit = limited(c, 'signup-ip:' + auth.client_ip(request), 5, 60)
        email_hit = limited(c, 'signup-email:' + auth.token_hash(email), 5, 60)
    if ip_hit or email_hit: raise HTTPException(429, 'Too many tries - wait an hour')


def _base():
    return os.environ.get('KINETTA_PUBLIC_URL', '').rstrip('/')


def limited(c, key, most, minutes):
    """True once `key` has been tried `most` times in the last `minutes`; every call counts as a try."""
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ('rate:'+key,))
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


def _open(c, token, kind, *, lock_user=False):
    if lock_user:
        seed = c.execute("SELECT user_id FROM account_tokens WHERE token_hash=%s AND kind=%s", (auth.token_hash(token or ''),kind)).fetchone()
        if seed: c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (seed['user_id'],))
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
        hit = limited(c, f"email:{user['id']}", 5, 60)
    if hit: raise HTTPException(429, 'Too many tries - wait an hour')
    with db.connect() as c:
        reservation_lock(c)
        account = c.execute('SELECT pw_hash FROM users WHERE id=%s FOR UPDATE', (user['id'],)).fetchone()
        if not account: raise HTTPException(404, 'Account not found.')
        stored = account['pw_hash']
        if not auth.check_pw(stored, body.password): raise HTTPException(400, 'Your password is wrong')
        confirmation(background, c, user['id'], user['name'], email)
    return {'ok': True, 'pending': email}


SIGNATURE = '\n\nThe Kinetta team'


def iphone_app():
    """The iPhone app's TestFlight link, when this server publishes one (KINETTA_TESTFLIGHT_URL)."""
    url = os.environ.get('KINETTA_TESTFLIGHT_URL', '').strip()
    return url if url.startswith('https://testflight.apple.com/') else None


def confirmation(background, c, uid, name, email, welcome=False):
    """A fresh single-use link to confirm `email`, sent after the caller's transaction commits. A new account's email
    (welcome) also says Kinetta is in beta and how to get the iPhone app."""
    email = _clean_email(email)
    require_available(c, email, uid)
    link = f"{_base()}/confirm-email/{_token(c, uid, 'verify_email', VERIFY_HOURS * 60, email)}"
    app = iphone_app() if welcome else None
    # Written the way Ben talks (2026-10-24): short, plain, signed by the team, always "we". No stock phrases.
    beta = (f"\n\nKinetta is in beta, and the iPhone app is the best way to use it. It records your runs, rides and walks "
            f"with GPS and brings in your Apple Health workouts. To get it:\n"
            f"1. Install TestFlight (Apple's free app for betas) from the App Store.\n2. Open this link on your iPhone: {app}\n"
            f"3. Open Kinetta and log in with {email}.") if app else ''
    if welcome:
        subject, text = 'Welcome to Kinetta', (f"Hi {name},\n\nWelcome to Kinetta! Tap this link to confirm your email:\n{link}\n\n"
            f"It works for {VERIFY_HOURS} hours. Once it's confirmed, you can log in with this email and reset your password if you ever need to."
            f"{beta}\n\nIf you didn't sign up, you can ignore this email.")
    else:
        subject, text = 'Confirm your new email for Kinetta', (f"Hi {name},\n\nTap this link to confirm {email} as your email for Kinetta:\n{link}\n\n"
            f"It works for {VERIFY_HOURS} hours. If you didn't ask for this, you can ignore this email.")
    background.add_task(send, email, subject, text + SIGNATURE)


def pending(c, uid):
    """The address waiting for its confirmation link to be opened, if any."""
    r = c.execute("""SELECT email::text AS email FROM account_tokens WHERE user_id = %s AND kind = 'verify_email'
                     AND used_at IS NULL AND expires > now() ORDER BY created DESC LIMIT 1""", (uid,)).fetchone()
    return r and r['email']


class TokenIn(BaseModel):
    token: str = Field(max_length=100)


@router.post('/api/account/email/confirm')
def confirm_email(body: TokenIn, request: Request, background: BackgroundTasks):
    """No login needed: the link may be opened on another device."""
    with db.connect() as c:
        reservation_lock(c)
        if limited(c, 'confirm:' + auth.client_ip(request), 20, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        r = _open(c, body.token, 'verify_email', lock_user=True)
        r['email'] = _clean_email(r['email'])
        require_available(c, r['email'], r['user_id'], confirmation=True)
        try:
            with c.transaction():
                c.execute('UPDATE users SET email = %s, email_verified_at = now(), needs_email_confirm = false WHERE id = %s', (r['email'], r['user_id']))
        except errors.UniqueViolation:
            email_exists()
        c.execute('UPDATE account_tokens SET used_at = now() WHERE token_hash = %s', (r['token_hash'],))
        link = (c.execute('SELECT friend_link FROM profile WHERE user_id = %s', (r['user_id'],)).fetchone() or {}).get('friend_link')
        if link:     # signed up through a friend's invite link: friends now (an expired link just doesn't apply)
            from .api_social import join_by_link
            try:
                with c.transaction(): join_by_link(c, r['user_id'], link)
            except HTTPException: pass
            c.execute('UPDATE profile SET friend_link = NULL WHERE user_id = %s', (r['user_id'],))
    from . import cards,challenges
    with db.connect() as c:cards.consume_signup(c,r['user_id'])
    with db.connect() as c:joined=challenges.consume_signup(c,r['user_id'])
    if r['current'] and r['current'].lower() != r['email'].lower():
        background.add_task(send, r['current'], 'Your Kinetta email was changed',
            f"Hi {r['name']},\n\nThe email on your Kinetta account ({r['login']}) is now {r['email']}. "
            "If that wasn't you, reply to this email and we'll help sort it out." + SIGNATURE)
    return {'ok': True, 'email': r['email'],'challenge_joined':joined}


# ---------- forgot password ----------
class ForgotIn(BaseModel):
    login: str = Field(max_length=120)      # a username or a confirmed email


@router.post('/api/password/forgot')
def forgot(body: ForgotIn, request: Request, background: BackgroundTasks):
    who = body.login.strip()
    with db.connect() as c:
        if limited(c, 'forgot-ip:' + auth.client_ip(request), 10, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        col = 'email' if '@' in who else 'login'
        u = c.execute(f'SELECT id, name, login::text AS login, email FROM users WHERE {col} = %s AND email_verified_at IS NOT NULL AND suspended_at IS NULL',
                      (who,)).fetchone()
        # at most 3 links an hour per account, without telling the asker whether that's why nothing arrived
        if u and not limited(c, f"forgot:{u['id']}", 3, 60) and mail_ready(): send_reset(background, c, u)
    return {'ok': True, 'message': SENT}


def send_reset(background, c, u, by_admin=False):
    """A single-use reset link to the account's confirmed email (u: id, name, login, email)."""
    token = _token(c, u['id'], 'reset_password', RESET_MINUTES)
    who = "We're sending you a link to reset" if by_admin else 'Someone (hopefully you) asked to reset'
    background.add_task(send, u['email'], 'Reset your Kinetta password',
        f"Hi {u['name']},\n\n{who} the password for your Kinetta account ({u['login']}). "
        f"Tap this link to choose a new one:\n{_base()}/reset-password/{token}\n\n"
        f"It works once, for {RESET_MINUTES} minutes. If you didn't ask for this, ignore this email and your password stays as it is." + SIGNATURE)


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
        c.execute('UPDATE users SET pw_hash = %s, password_change_expires = NULL WHERE id = %s', (auth.hash_pw(body.password), r['user_id']))
        c.execute('DELETE FROM account_password_changes WHERE user_id=%s', (r['user_id'],))
        c.execute('UPDATE account_tokens SET used_at = now() WHERE token_hash = %s', (r['token_hash'],))
        # every phone, browser and admin portal session ends: whoever had the old password is out
        for t in ('sessions', 'admin_sessions', 'admin_challenges'): c.execute(f'DELETE FROM {t} WHERE user_id = %s', (r['user_id'],))
    password_changed(background, r['current'], r['name'], r['login'])
    return {'ok': True}


def password_changed(background, email, name, login):
    if email:
        background.add_task(send, email, 'Your Kinetta password was changed',
            f"Hi {name},\n\nThe password for your Kinetta account ({login}) was just changed, and your other phones and "
            "browsers were signed out. If that wasn't you, reply to this email right away." + SIGNATURE)
