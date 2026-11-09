"""Email on accounts (#232 A–C, 2026-10-24): add or change your address, confirm it from a link, and reset a forgotten
password by email.

An address counts only after its owner opens the confirmation link sent to it, so nobody can claim someone else's email.
Links are single-use and only their hash is stored (like invites). "Forgot password" answers the same way whether or not
an account matches, and sends from the background, so it never reveals who has an account. Attempts are counted in the
database (auth_attempts), so the limits survive restarts. Messages are plain text and never contain a password.
"""
import datetime as dt
import logging
import os
import secrets
import time
import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StrictBool
from psycopg import errors
from . import db, auth, admin_mail
from .api_beta import EMAIL_RE
from .auth import current_user

router = APIRouter()
VERIFY_HOURS, RESET_MINUTES = 24, 60
SENT = 'If that matches an account, we’ve sent a link to reset the password. Check your inbox and spam folder.'
RESEND_SENT = 'If that account is waiting for confirmation, we’ve sent a new link. Check your inbox and spam folder.'
DOMAIN_TYPOS = {
    'gmai.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gamil.com': 'gmail.com',
    'gnail.com': 'gmail.com', 'gmal.com': 'gmail.com', 'gmail.con': 'gmail.com',
    'gmail.cmo': 'gmail.com', 'gmail.vom': 'gmail.com', 'yaho.com': 'yahoo.com',
    'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com', 'hotmal.com': 'hotmail.com',
    'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com', 'outlok.com': 'outlook.com',
    'outllok.com': 'outlook.com', 'outlook.con': 'outlook.com', 'iclould.com': 'icloud.com',
    'icloud.con': 'icloud.com',
}
BAD_EMAIL_ENDINGS = {'con': 'com', 'cmo': 'com', 'vom': 'com'}
COUNTRY_TLDS = frozenset('ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw'.split())
COMMON_TLDS = frozenset('aero academy agency app art asia biz blog cafe camera careers cat charity church city cloud club com company computer coop design dev digital doctor email edu finance fitness flowers food fun games global gov group guru health homes house info int jobs law legal life link live mil mobi museum name net news online org page photography photo pizza place pro pub recipes run science services shop site social software solutions space store studio tech technology tel today travel tv university website wiki world xyz zone eu uk'.split())
KNOWN_TLDS = COUNTRY_TLDS | COMMON_TLDS


def email_suggestion(email):
    """Return a likely correction for common address typos, without changing the address silently."""
    local, sep, domain = (email or '').strip().lower().rpartition('@')
    if not sep or not local or not domain: return None
    corrected = DOMAIN_TYPOS.get(domain)
    if corrected is None:
        ending = domain.rpartition('.')
        if ending[1] and ending[2] in BAD_EMAIL_ENDINGS:
            corrected = ending[0] + '.' + BAD_EMAIL_ENDINGS[ending[2]]
    return f'{local}@{corrected}' if corrected and corrected != domain else None


def _clean_email(v):
    v = (v or '').strip().lower()
    if len(v) > 120 or not EMAIL_RE.fullmatch(v): raise HTTPException(400, 'Check the email address')
    return v


def check_new_email(v, confirm_typo=False):
    """Validate a newly entered address; common domain suggestions need an explicit owner choice."""
    v = _clean_email(v)
    ending = v.rpartition('@')[2].rpartition('.')[2]
    if ending in BAD_EMAIL_ENDINGS:
        raise HTTPException(400, 'Did you mean .com? Check the email ending.')
    if ending not in KNOWN_TLDS:
        raise HTTPException(400, 'Check the email ending.')
    suggestion = email_suggestion(v)
    if suggestion and not confirm_typo:
        raise HTTPException(400, f"Did you mean {suggestion.rpartition('@')[2]}? Choose Keep my address to continue.")
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


def enrollment_limit(request, email, *, waitlist=False):
    # Commit rejected attempts too. Keep addresses out of the limiter key.
    with db.connect() as c:
        purpose = 'waitlist' if waitlist else 'signup'
        ip_hit = limited(c, purpose+'-ip:' + auth.client_ip(request), 10 if waitlist else 20, 60)
        email_hit = limited(c, purpose+'-email:' + auth.token_hash(email), 3 if waitlist else 5, 60)
    if ip_hit or email_hit: raise HTTPException(429, 'Too many tries - wait an hour')


def token_limit(request, purpose, most):
    # Failure of token lookup/validation must not undo the rate accounting.
    with db.connect() as c:
        hit = limited(c, purpose + auth.client_ip(request), most, 15)
    if hit: raise HTTPException(429, 'Too many tries - wait 15 minutes')


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


def email_recovery_limited(c, uid):
    """Resend and forgot share one per-account budget so neither path can double the sends."""
    return limited(c, f'email-recovery:{uid}', 3, 60)


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


def send_confirmation(to, subject, text, token_hash):
    """Send a confirmation message and remember its provider ID for a signed bounce event."""
    cfg = admin_mail.settings()
    if not cfg['ready']: return False
    try:
        r = httpx.post('https://api.resend.com/emails', headers={'Authorization': 'Bearer ' + db.secret('KINETTA_RESEND_KEY')},
                       json={'from': cfg['sender'], 'to': [to], 'reply_to': cfg['reply_to'], 'subject': subject, 'text': text}, timeout=10)
        if not r.is_success: return False
        pid = r.json().get('id')
        if isinstance(pid, str) and 0 < len(pid) <= 100:
            with db.connect() as c:
                c.execute("""UPDATE account_tokens SET resend_id=%s,
                             bounced_at=CASE WHEN EXISTS (SELECT 1 FROM admin_mail_events WHERE provider_id=%s AND state='bounced') THEN now() ELSE NULL END
                           WHERE token_hash=%s AND kind='verify_email' AND used_at IS NULL""", (pid, pid, token_hash))
        return True
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return False


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
    r = c.execute("""SELECT t.token_hash, t.user_id, t.email, u.login::text AS login, u.name, u.email AS current,
                            u.email_verified_at IS NOT NULL AS email_confirmed, u.needs_email_confirm, u.signup_guard
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
    confirm_typo: StrictBool = False


@router.put('/api/account/email')
def set_email(body: EmailIn, request: Request, background: BackgroundTasks, user=Depends(current_user)):
    """Sends a confirmation link to the new address; the account uses it only after the link is opened."""
    email = check_new_email(body.email, body.confirm_typo)
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
    token = _token(c, uid, 'verify_email', VERIFY_HOURS * 60, email)
    token_hash = auth.token_hash(token)
    link = f"{_base()}/confirm-email/{token}"
    app = iphone_app() if welcome else None
    # Written the way Ben talks (2026-10-24): short, plain, signed by the team, always "we". No stock phrases.
    beta = (f"\n\nKinetta is in beta, and the iPhone app is the best way to use it. It records your runs, rides and walks "
            f"with GPS and brings in workouts from the Health app. To get it:\n"
            f"1. Install TestFlight (Apple's free app for betas) from the App Store.\n2. Open this link on your iPhone: {app}\n"
            f"3. Open Kinetta and log in with {email}.") if app else ''
    if welcome:
        subject, text = 'Welcome to Kinetta', (f"Hi {name},\n\nWelcome to Kinetta! Tap this link to confirm your email:\n{link}\n\n"
            f"It works for {VERIFY_HOURS} hours. Once it's confirmed, you can log in with this email and reset your password if you ever need to."
            f"{beta}\n\nIf you didn't sign up, you can ignore this email.")
    else:
        subject, text = 'Confirm your new email for Kinetta', (f"Hi {name},\n\nTap this link to confirm {email} as your email for Kinetta:\n{link}\n\n"
            f"It works for {VERIFY_HOURS} hours. If you didn't ask for this, you can ignore this email.")
    background.add_task(send_confirmation, email, subject, text + SIGNATURE, token_hash)


def send_due_confirmation_reminders(limit=100):
    """Claim the first or second due reminder and send a fresh confirmation link."""
    if not mail_ready(): return 0
    messages = []
    with db.connect() as c:
        reservation_lock(c)
        rows = c.execute("""SELECT id, name, email::text AS email, email_confirmation_reminder_count AS sent
          FROM users WHERE needs_email_confirm AND email_verified_at IS NULL AND suspended_at IS NULL AND email IS NOT NULL
            AND created >= (SELECT applied FROM schema_version WHERE version=109)
            AND ((email_confirmation_reminder_count=0 AND created<=now()-interval '1 day')
              OR (email_confirmation_reminder_count=1 AND email_confirmation_reminder_at<=now()-interval '2 days'))
          ORDER BY created, id LIMIT %s FOR UPDATE SKIP LOCKED""", (limit,)).fetchall()
        for user in rows:
            if email_suggestion(user['email']): continue
            token = _token(c, user['id'], 'verify_email', VERIFY_HOURS * 60, user['email'])
            token_hash = auth.token_hash(token)
            link = f"{_base()}/confirm-email/{token}"
            c.execute("""UPDATE users SET email_confirmation_reminder_count=email_confirmation_reminder_count+1,
                         email_confirmation_reminder_at=now()
                       WHERE id=%s AND needs_email_confirm AND email_verified_at IS NULL""", (user['id'],))
            messages.append((user['email'], 'Please confirm your Kinetta email',
                f"Hi {user['name']},\n\nYour Kinetta account is waiting for you to confirm this email address. Open this link:\n{link}\n\n"
                f"It works for {VERIFY_HOURS} hours. If you didn't sign up, you can ignore this email." + SIGNATURE, token_hash))
    for email, subject, text, token_hash in messages:
        send_confirmation(email, subject, text, token_hash)
    return len(messages)


def reminder_scheduler():
    """Check hourly; the first pass waits so app startup and tests never send mail immediately."""
    while True:
        time.sleep(3600)
        try:
            send_due_confirmation_reminders()
        except Exception:
            logging.getLogger('uvicorn.error').warning('Email confirmation reminder sweep unavailable')


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
    token_limit(request, 'confirm:', 20)
    with db.connect() as c:
        reservation_lock(c)
        r = _open(c, body.token, 'verify_email', lock_user=True)
        r['email'] = _clean_email(r['email'])
        require_available(c, r['email'], r['user_id'], confirmation=True)
        try:
            with c.transaction():
                c.execute("""UPDATE users SET email=%s, email_verified_at=now(), needs_email_confirm=false,
                  signup_confirmed_at=CASE WHEN signup_guard AND signup_confirmed_at IS NULL THEN now() ELSE signup_confirmed_at END WHERE id=%s""", (r['email'], r['user_id']))
        except errors.UniqueViolation:
            email_exists()
        c.execute('UPDATE account_tokens SET used_at = now() WHERE token_hash = %s', (r['token_hash'],))
        _join_signup_friend(c, r['user_id'])
    joined = _consume_signup(r['user_id'])
    if r['current'] and r['current'].lower() != r['email'].lower():
        background.add_task(send, r['current'], 'Your Kinetta email was changed',
            f"Hi {r['name']},\n\nThe email on your Kinetta account ({r['login']}) is now {r['email']}. "
            "If that wasn't you, reply to this email and we'll help sort it out." + SIGNATURE)
    return {'ok': True, 'email': r['email'],'challenge_joined':joined}


@router.get('/api/account/email/status')
def confirmation_status(user=Depends(current_user)):
    """Only the signed-in owner can learn whether their active confirmation message bounced."""
    with db.connect() as c:
        row = c.execute("""SELECT EXISTS (
              SELECT 1 FROM account_tokens t JOIN users u ON u.id=t.user_id
              WHERE u.id=%s AND t.kind='verify_email' AND t.used_at IS NULL AND t.bounced_at IS NOT NULL
            ) AS bounced""", (user['id'],)).fetchone()
    return {'bounced': bool(row['bounced'])}


# ---------- resend confirmation ----------
class ResendConfirmationIn(BaseModel):
    login: str = Field(max_length=120)      # email or username; the response never says whether either matched


@router.post('/api/account/email/resend')
def resend_confirmation(body: ResendConfirmationIn, request: Request, background: BackgroundTasks):
    who = body.login.strip()
    with db.connect() as c:
        if limited(c, 'confirm-resend-ip:' + auth.client_ip(request), 10, 15):
            raise HTTPException(429, 'Too many tries - wait 15 minutes')
        col = 'email' if '@' in who else 'login'
        u = c.execute(f'''SELECT id, name, email FROM users WHERE {col} = %s
                          AND email_verified_at IS NULL AND needs_email_confirm AND email IS NOT NULL
                          AND suspended_at IS NULL''', (who,)).fetchone()
        if u and not email_recovery_limited(c, u['id']) and mail_ready():
            confirmation(background, c, u['id'], u['name'], u['email'], welcome=True)
    return {'ok': True, 'message': RESEND_SENT}


# ---------- forgot password ----------
class ForgotIn(BaseModel):
    login: str = Field(max_length=120)      # a username or email


@router.post('/api/password/forgot')
def forgot(body: ForgotIn, request: Request, background: BackgroundTasks):
    who = body.login.strip()
    with db.connect() as c:
        if limited(c, 'forgot-ip:' + auth.client_ip(request), 10, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        col = 'email' if '@' in who else 'login'
        u = c.execute(f'''SELECT id, name, login::text AS login, email,
                                 email_verified_at IS NOT NULL AS email_confirmed, needs_email_confirm
                          FROM users WHERE {col} = %s AND suspended_at IS NULL''',
                      (who,)).fetchone()
        # Resend and reset share at most three links an hour per account; the answer never says why nothing arrived.
        can_reset = u and u['email'] and (u['email_confirmed'] or u['needs_email_confirm'])
        if can_reset and not email_recovery_limited(c, u['id']) and mail_ready():
            send_reset(background, c, u, pending=not u['email_confirmed'])
    return {'ok': True, 'message': SENT}


def send_reset(background, c, u, by_admin=False, pending=False):
    """A single-use reset link to the account's email (u: id, name, login, email)."""
    # Bind pending resets to the address that received the proof-of-ownership link.
    token = _token(c, u['id'], 'reset_password', RESET_MINUTES, u['email'] if pending else None)
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
    token_limit(request, 'reset-ip:', 30)
    with db.connect() as c:
        r = _open(c, token, 'reset_password')
    return {'login': r['login']}


@router.post('/api/password/reset')
def reset(body: ResetIn, request: Request, background: BackgroundTasks):
    token_limit(request, 'reset-ip:', 30)
    email_confirmed = False
    with db.connect() as c:
        # Keep the email-reservation lock before user/token locks, as in email confirmation.
        reservation_lock(c)
        r = _open(c, body.token, 'reset_password', lock_user=True)
        # A pending reset link proves ownership of the address it was sent to. It cannot reset an account
        # after that account's email has changed to someone else's address.
        if r['email'] and (not r['current'] or _clean_email(r['email']) != _clean_email(r['current'])):
            raise HTTPException(404, 'This link has expired or was already used. Ask for a new one.')
        auth.check_new_password(body.password, r['login'])
        if (r['email'] and r['current'] and not r['email_confirmed'] and r['needs_email_confirm']
                and _clean_email(r['email']) == _clean_email(r['current'])):
            require_available(c, r['email'], r['user_id'], confirmation=True)
            email_confirmed = True
        try:
            c.execute('''UPDATE users SET pw_hash = %s, password_change_expires = NULL,
                         email_verified_at = CASE WHEN %s THEN now() ELSE email_verified_at END,
                         needs_email_confirm = CASE WHEN %s THEN false ELSE needs_email_confirm END,
                         signup_confirmed_at = CASE WHEN %s AND signup_guard AND signup_confirmed_at IS NULL THEN now() ELSE signup_confirmed_at END
                         WHERE id = %s''', (auth.hash_pw(body.password), email_confirmed, email_confirmed,
                                            email_confirmed, r['user_id']))
        except errors.UniqueViolation:
            if email_confirmed: email_exists()
            raise
        c.execute('DELETE FROM account_password_changes WHERE user_id=%s', (r['user_id'],))
        c.execute('UPDATE account_tokens SET used_at = now() WHERE token_hash = %s', (r['token_hash'],))
        if email_confirmed:
            c.execute("UPDATE account_tokens SET used_at = now() WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL", (r['user_id'],))
        # every phone, browser and admin portal session ends: whoever had the old password is out
        for t in ('sessions', 'admin_sessions', 'admin_challenges'): c.execute(f'DELETE FROM {t} WHERE user_id = %s', (r['user_id'],))
        if email_confirmed:
            # A reset link proves inbox ownership, not consent to choices made on the signup form.
            # Remove them so the background signup worker cannot apply them later.
            c.execute('UPDATE profile SET friend_link=NULL WHERE user_id=%s', (r['user_id'],))
            c.execute("DELETE FROM signup_join_intents WHERE user_id=%s AND kind IN ('card','challenge')", (r['user_id'],))
    password_changed(background, r['current'], r['name'], r['login'])
    if email_confirmed: return {'ok': True, 'email_confirmed': True}
    return {'ok': True}


def _join_signup_friend(c, uid):
    link = (c.execute('SELECT friend_link FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}).get('friend_link')
    if not link: return
    from .api_social import join_by_link
    try:
        with c.transaction(): join_by_link(c, uid, link)
    except HTTPException:
        pass
    c.execute('UPDATE profile SET friend_link = NULL WHERE user_id = %s', (uid,))


def _consume_signup(uid):
    from . import cards, challenges
    with db.connect() as c: cards.consume_signup(c, uid)
    with db.connect() as c: return challenges.consume_signup(c, uid)


def password_changed(background, email, name, login):
    if email:
        background.add_task(send, email, 'Your Kinetta password was changed',
            f"Hi {name},\n\nThe password for your Kinetta account ({login}) was just changed, and your other phones and "
            "browsers were signed out. If that wasn't you, reply to this email right away." + SIGNATURE)
