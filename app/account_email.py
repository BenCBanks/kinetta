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
from pathlib import Path
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
UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS = 14


def unconfirmed_account_delete_at(created):
    """Return the exact UTC-aware deadline used for unconfirmed-account deletion."""
    return created + dt.timedelta(days=UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS)


SENT = 'If that matches an account, we’ve sent a link to reset the password. Check your inbox and spam folder.'
RECOVERY_UNAVAILABLE = 'Email recovery isn’t available right now. For help signing in, email feedback@kinetta.app.'
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
DISPOSABLE_EMAIL_DOMAINS = frozenset(
    line.strip().lower() for line in Path(__file__).with_name('disposable_email_domains.txt').read_text().splitlines()
    if line.strip() and not line.lstrip().startswith('#')
)


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
    domain = v.rpartition('@')[2]
    ending = domain.rpartition('.')[2]
    if ending in BAD_EMAIL_ENDINGS:
        raise HTTPException(400, 'Did you mean .com? Check the email ending.')
    suggestion = email_suggestion(v)
    if suggestion and not confirm_typo:
        raise HTTPException(400, f"Did you mean {suggestion.rpartition('@')[2]}? Choose Keep my address to continue.")
    if any(domain == blocked or domain.endswith('.' + blocked) for blocked in DISPOSABLE_EMAIL_DOMAINS):
        raise HTTPException(400, 'Use an email address that can receive account messages.')
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
    text = admin_mail.format_plain_text_email(text)
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
    text = admin_mail.format_plain_text_email(text)
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
    if not r: raise HTTPException(404, 'This link has expired. Request a new one from the sign-in page.')
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
    if not mail_ready(): raise HTTPException(503, 'Email isn’t available right now. For help, email feedback@kinetta.app.')
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
    # Keep bearer tokens out of HTTP request paths and access logs. Fragments stay in the
    # browser; the client submits the token to the confirmation API in the request body.
    link = f"{_base()}/confirm-email#{token}"
    app = iphone_app() if welcome else None
    # Written the way Ben talks (2026-10-24): short, plain, signed by the team, always "we". No stock phrases.
    beta = (f"\n\nKinetta is in beta, and the iPhone app is the best way to use it. It records your runs, rides and walks "
            f"with GPS and brings in workouts from the Health app. To get it:\n"
            f"1. Install TestFlight (Apple's free app for betas) from the App Store.\n2. Open this link on your iPhone: {app}\n"
            f"3. Open Kinetta and log in with {email}.") if app else ''
    if welcome:
        subject, text = 'Confirm your email for Kinetta', (f"Open this link to confirm your email and finish setting up Kinetta:\n{link}\n\n"
            f"It works for {VERIFY_HOURS} hours. If you didn't sign up, ignore this email."
            f"{beta}\n\nAfter confirming, open Kinetta and sign in with {email}.")
    else:
        subject, text = 'Confirm your new email for Kinetta', (f"Open this link to confirm {email} as your email for Kinetta:\n{link}\n\n"
            f"It works for {VERIFY_HOURS} hours. If you didn't ask for this, you can ignore this email.")
    background.add_task(send_confirmation, email, subject, text + SIGNATURE, token_hash)


def _unconfirmed_delete_on(created, sent_at):
    """Give every final warning at least four days before deletion, including old backlog accounts."""
    return max(unconfirmed_account_delete_at(created), sent_at + dt.timedelta(days=4))


def _purge_unconfirmed_mode():
    value = os.environ.get('KINETTA_PURGE_UNCONFIRMED', 'log').strip().lower()
    return value if value in ('off', 'log', 'on') else 'log'


def send_due_confirmation_reminders(limit=100):
    """Send day-1, day-3 and final day-10 confirmation notices."""
    if not mail_ready(): return 0
    messages = []
    now = dt.datetime.now(dt.timezone.utc)
    final_warning_days = UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS - 4
    typo_domains = list(DOMAIN_TYPOS)
    typo_endings = list(BAD_EMAIL_ENDINGS)
    with db.connect() as c:
        reservation_lock(c)
        rows = c.execute("""SELECT id, email::text AS email, created,
                                   email_confirmation_reminder_count AS sent,
                                   email_confirmation_reminder_at AS reminded_at,
                                   unconfirmed_final_warning_at AS final_warning_at,
                                   unconfirmed_final_warning_sent_at AS final_warning_sent_at
          FROM users WHERE needs_email_confirm AND email_verified_at IS NULL AND suspended_at IS NULL AND is_admin=false AND email IS NOT NULL
            AND created >= (SELECT applied FROM schema_version WHERE version=109)
            AND NOT EXISTS (SELECT 1 FROM account_tokens t WHERE t.user_id=users.id AND t.kind='verify_email'
                              AND t.used_at IS NULL AND t.expires>now() AND lower(t.email)<>lower(users.email))
            -- Keep reminder exclusions in sync with email_suggestion(): do not warn a likely typo.
            AND split_part(lower(email::text),'@',2) <> ALL(%s::text[])
            AND substring(lower(email::text) from '[^.]+$') <> ALL(%s::text[])
            AND ((email_confirmation_reminder_count=0 AND created<=now()-interval '1 day')
              OR (email_confirmation_reminder_count=1 AND email_confirmation_reminder_at<=now()-interval '2 days')
              OR (created<=now()-make_interval(days=>%s)
                  AND (unconfirmed_final_warning_at IS NULL OR
                       (unconfirmed_final_warning_sent_at IS NULL AND
                        unconfirmed_final_warning_at<=now()-interval '1 hour'))))
          ORDER BY created, id LIMIT %s FOR UPDATE SKIP LOCKED""",
                       (typo_domains, typo_endings, final_warning_days, min(max(int(limit), 1), 100))).fetchall()
        for user in rows:
            deletion_at = unconfirmed_account_delete_at(user['created'])
            warned_at = now
            final_at = deletion_at - dt.timedelta(days=4)
            sent = user['sent']
            reminded_at = user['reminded_at']
            retry_claim = (user['final_warning_at'] is not None and user['final_warning_sent_at'] is None
                           and user['final_warning_at'] <= now - dt.timedelta(hours=1))
            if now >= final_at and (user['final_warning_at'] is None or retry_claim):
                kind = 'final'
                claim = c.execute("""UPDATE users SET unconfirmed_final_warning_at=%s
                                     WHERE id=%s AND needs_email_confirm AND email_verified_at IS NULL
                                       AND (unconfirmed_final_warning_at IS NULL OR
                                            (unconfirmed_final_warning_sent_at IS NULL AND
                                             unconfirmed_final_warning_at<=now()-interval '1 hour'))""",
                                  (warned_at, user['id']))
                if claim.rowcount != 1: continue
                deletion_at = _unconfirmed_delete_on(user['created'], warned_at)
            elif sent == 0 and now >= user['created'] + dt.timedelta(days=1):
                kind = 'first'
            elif sent == 1 and reminded_at and now >= reminded_at + dt.timedelta(days=2):
                kind = 'second'
                deletion_at = unconfirmed_account_delete_at(user['created'])
            else:
                continue
            message = _confirmation_reminder_message(c, user, kind, deletion_at)
            previous_count, previous_reminder_at = sent, reminded_at
            claimed_count = 2 if kind in ('second', 'final') else 1
            c.execute("""UPDATE users SET email_confirmation_reminder_count=%s,email_confirmation_reminder_at=%s
                         WHERE id=%s AND needs_email_confirm AND email_verified_at IS NULL""",
                      (claimed_count, warned_at, user['id']))
            messages.append((user['id'], kind, message, warned_at if kind == 'final' else None,
                             previous_count, previous_reminder_at))

    sent_count = 0
    for uid, kind, message, warning_claim, previous_count, previous_reminder_at in messages:
        email, subject, text, token_hash = message
        try:
            accepted = send_confirmation(email, subject, text, token_hash)
        except Exception:
            accepted = False
        with db.connect() as c:
            reservation_lock(c)
            current = c.execute("""SELECT id,email::text AS email FROM users WHERE id=%s AND needs_email_confirm
                                  AND email_verified_at IS NULL AND EXISTS(
                                    SELECT 1 FROM account_tokens WHERE user_id=users.id AND token_hash=%s
                                      AND kind='verify_email' AND used_at IS NULL AND expires>now()) FOR UPDATE""",
                                (uid, token_hash)).fetchone()
            if accepted and current:
                c.execute("""DELETE FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND used_at IS NULL
                              AND lower(email)=lower(%s) AND token_hash<>%s""", (uid, current['email'], token_hash))
                new_count = 2 if kind in ('second', 'final') else 1
                c.execute("""UPDATE users SET email_confirmation_reminder_count=%s,email_confirmation_reminder_at=now()
                             WHERE id=%s AND needs_email_confirm AND email_verified_at IS NULL""", (new_count, uid))
                if kind == 'final':
                    c.execute("""UPDATE users SET unconfirmed_final_warning_sent_at=now()
                                 WHERE id=%s AND needs_email_confirm AND email_verified_at IS NULL
                                   AND unconfirmed_final_warning_at=%s AND unconfirmed_final_warning_sent_at IS NULL""",
                              (uid, warning_claim))
                sent_count += 1
            else:
                # The staged token never replaced the previous live link; remove only the failed attempt.
                c.execute("DELETE FROM account_tokens WHERE user_id=%s AND kind='verify_email' AND token_hash=%s AND used_at IS NULL",
                          (uid, token_hash))
                c.execute("""UPDATE users SET email_confirmation_reminder_count=%s,email_confirmation_reminder_at=%s
                             WHERE id=%s AND needs_email_confirm AND email_verified_at IS NULL""",
                          (previous_count, previous_reminder_at, uid))
                if warning_claim:
                    c.execute("""UPDATE users SET unconfirmed_final_warning_at=NULL
                                 WHERE id=%s AND needs_email_confirm AND email_verified_at IS NULL
                                   AND unconfirmed_final_warning_at=%s""", (uid, warning_claim))
    return sent_count


def _confirmation_reminder_message(c, user, kind, deletion_at):
    # Stage a new token alongside the current one. It replaces the prior link only after delivery succeeds.
    token = secrets.token_urlsafe(32)
    token_hash = auth.token_hash(token)
    if kind == 'final':
        c.execute('INSERT INTO account_tokens (token_hash, user_id, kind, email, expires) VALUES (%s,%s,%s,%s,%s)',
                  (token_hash, user['id'], 'verify_email', user['email'], deletion_at + dt.timedelta(days=1)))
    else:
        c.execute('INSERT INTO account_tokens (token_hash, user_id, kind, email, expires) VALUES (%s,%s,%s,%s,now()+%s)',
                  (token_hash, user['id'], 'verify_email', user['email'], dt.timedelta(minutes=VERIFY_HOURS * 60)))
    link = f"{_base()}/confirm-email#{token}"
    deletion_date = f"{deletion_at.day} {deletion_at.strftime('%B %Y')} (UTC)"
    if kind == 'first':
        subject = 'Your Kinetta account needs one more step'
        text = (f"Confirm your email to keep your account: {link}. This link replaces earlier ones and works for {VERIFY_HOURS} hours. "
                "If you didn't sign up, ignore this email.")
    elif kind == 'second':
        subject = f'Confirm your Kinetta email by {deletion_date}'
        text = (f"Confirm your email to keep your account: {link}. This link replaces earlier ones and works for {VERIFY_HOURS} hours. "
                f"Accounts that aren't confirmed within {UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS} days are deleted on {deletion_date}. "
                "If you didn't sign up, ignore this email.")
    else:
        subject = f'Your Kinetta account will be deleted on {deletion_date}'
        text = (f"We haven't been able to confirm this email. Open this link before {deletion_date} to keep your account: {link}. "
                "If you didn't sign up, do nothing and it will be removed.")
    return user['email'], subject, text, token_hash


def purge_due_unconfirmed_accounts(limit=100):
    """Log or delete only eligible unconfirmed accounts after their warned deletion date."""
    limit = min(max(int(limit), 0), 100)
    mode = _purge_unconfirmed_mode()
    logger = logging.getLogger('uvicorn.error')
    if mode == 'off' or not mail_ready() or limit == 0:
        logger.info('Unconfirmed-account purge mode=%s eligible=0 deleted=0', mode)
        return 0
    now = dt.datetime.now(dt.timezone.utc)
    deadline_cutoff = now - dt.timedelta(days=UNCONFIRMED_ACCOUNT_DELETE_AFTER_DAYS)
    final_at_cutoff = now - dt.timedelta(days=4)
    typo_domains = list(DOMAIN_TYPOS)
    typo_endings = list(BAD_EMAIL_ENDINGS)
    candidates = []
    removed = []
    with db.connect() as c:
        reservation_lock(c)
        rows = c.execute("""SELECT id,sql_role,created,unconfirmed_final_warning_sent_at AS sent_at
          FROM users WHERE needs_email_confirm AND email_verified_at IS NULL AND suspended_at IS NULL AND is_admin=false
            AND email IS NOT NULL AND created >= (SELECT applied FROM schema_version WHERE version=109)
            AND NOT EXISTS (SELECT 1 FROM account_tokens t WHERE t.user_id=users.id AND t.kind='verify_email'
                              AND t.used_at IS NULL AND t.expires>now() AND lower(t.email)<>lower(users.email))
            AND email_confirmation_reminder_count=2 AND unconfirmed_final_warning_sent_at IS NOT NULL
            -- Never delete an account at an address email_suggestion() flags as likely mistyped.
            AND split_part(lower(email::text),'@',2) <> ALL(%s::text[])
            AND substring(lower(email::text) from '[^.]+$') <> ALL(%s::text[])
            AND created<=%s AND unconfirmed_final_warning_sent_at<=%s
            AND unconfirmed_final_warning_sent_at<=now()-interval '4 days'
          ORDER BY created,id LIMIT %s FOR UPDATE SKIP LOCKED""",
                         (typo_domains, typo_endings, deadline_cutoff, final_at_cutoff, limit)).fetchall()
        for row in rows:
            delete_on = _unconfirmed_delete_on(row['created'], row['sent_at'])
            if now < delete_on: continue
            candidates.append(row)
        if mode == 'on':
            from . import api_account
            from .admin_auth import audit
            for row in candidates:
                audit(c, None, 'account.purge_unconfirmed', row['id'])
                api_account.erase(c, row)
                removed.append(row['id'])
    if removed:
        from . import api_account
        for uid in removed: api_account.erase_files(uid)
    logger.warning('Unconfirmed-account purge mode=%s eligible=%d deleted=%d', mode, len(candidates), len(removed))
    return len(removed) if mode == 'on' else len(candidates)

def reminder_scheduler():
    """Check hourly; the first pass waits so app startup and tests never send mail immediately."""
    while True:
        time.sleep(3600)
        try:
            send_due_confirmation_reminders()
        except Exception:
            logging.getLogger('uvicorn.error').warning('Email confirmation reminder sweep unavailable')
        try:
            purge_due_unconfirmed_accounts()
        except Exception:
            logging.getLogger('uvicorn.error').warning('Unconfirmed account purge unavailable')


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
            f"The email on your Kinetta account (@{r['login']}) is now {r['email']}. If that wasn't you, email feedback@kinetta.app.")
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
        reservation_lock(c)
        col = 'email' if '@' in who else 'login'
        lookup = ('lower(COALESCE(u.email::text, pending.email::text)) = lower(%s)'
                  if col == 'email' else 'u.login = %s')
        u = c.execute(f'''SELECT u.id, u.name, COALESCE(u.email::text, pending.email::text) AS email
                          FROM users u
                          LEFT JOIN LATERAL (
                            SELECT t.email FROM account_tokens t
                            WHERE t.user_id = u.id AND t.kind = 'verify_email' AND t.used_at IS NULL
                            ORDER BY t.created DESC LIMIT 1
                          ) pending ON true
                          WHERE {lookup} AND u.email_verified_at IS NULL
                            AND u.needs_email_confirm AND u.suspended_at IS NULL
                            AND COALESCE(u.email::text, pending.email::text) IS NOT NULL
                          ORDER BY u.id
                          FOR UPDATE OF u''', (who,)).fetchone()
        if u and not email_recovery_limited(c, u['id']) and mail_ready():
            confirmation(background, c, u['id'], u['name'], u['email'], welcome=True)
    return {'ok': True, 'message': RESEND_SENT}


# ---------- forgot password ----------
class ForgotIn(BaseModel):
    login: str = Field(max_length=120)      # a username or email


@router.post('/api/password/forgot')
def forgot(body: ForgotIn, request: Request, background: BackgroundTasks):
    who = body.login.strip()
    email_available = mail_ready()
    with db.connect() as c:
        if limited(c, 'forgot-ip:' + auth.client_ip(request), 10, 15): raise HTTPException(429, 'Too many tries - wait 15 minutes')
        col = 'email' if '@' in who else 'login'
        u = c.execute(f'''SELECT id, name, login::text AS login, email,
                                 email_verified_at IS NOT NULL AS email_confirmed, needs_email_confirm
                          FROM users WHERE {col} = %s AND suspended_at IS NULL''',
                      (who,)).fetchone()
        # Resend and reset share at most three links an hour per account; the answer never says why nothing arrived.
        can_reset = u and u['email'] and (u['email_confirmed'] or u['needs_email_confirm'])
        if can_reset and not email_recovery_limited(c, u['id']) and email_available:
            send_reset(background, c, u, pending=not u['email_confirmed'])
    return {'ok': True, 'email_available': email_available,
            'message': SENT if email_available else RECOVERY_UNAVAILABLE}


def send_reset(background, c, u, by_admin=False, pending=False):
    """A single-use reset link to the account's email (u: id, name, login, email)."""
    # Bind pending resets to the address that received the proof-of-ownership link.
    token = _token(c, u['id'], 'reset_password', RESET_MINUTES, u['email'] if pending else None)
    if by_admin:
        text = ("Here's the password reset link you asked us for.\n"
                f"Open this link to choose a new password for your Kinetta account (@{u['login']}):\n{_base()}/reset-password#{token}\n\n"
                f"It works once, for {RESET_MINUTES} minutes. If you didn't ask for this, ignore this email and your password stays the same.")
    else:
        text = (f"Open this link to reset the password for your Kinetta account (@{u['login']}):\n{_base()}/reset-password#{token}\n\n"
                f"It works once, for {RESET_MINUTES} minutes. If you didn't ask for this, ignore this email and your password stays the same.")
    background.add_task(send, u['email'], 'Reset your Kinetta password', text)


class ResetIn(BaseModel):
    token: str = Field(max_length=100)
    password: str = Field(min_length=8, max_length=200)


class ResetCheckIn(BaseModel):
    token: str = Field(max_length=100)


@router.get('/api/password/reset/{token}')
def reset_info_legacy(token: str, request: Request):
    """Legacy path-token lookup kept for one release for cached app links.

    Remove after the next TestFlight build + 60 minutes; old shipped bundles may
    still open a valid reset link with the token in the path.
    """
    token_limit(request, 'reset-ip:', 30)
    with db.connect() as c:
        r = _open(c, token, 'reset_password')
    return {'login': r['login']}


@router.post('/api/password/reset/check')
def reset_info(body: ResetCheckIn, request: Request):
    """Check a reset token without putting it in a URL or access log."""
    token_limit(request, 'reset-ip:', 30)
    with db.connect() as c:
        r = _open(c, body.token, 'reset_password')
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
            raise HTTPException(404, 'This link has expired. Request a new one from the sign-in page.')
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
            f"The password for your Kinetta account (@{login}) was just changed, and your other phones and browsers were signed out. "
            f"If you didn't do this, reset your password now at {_base()}/forgot-password and email feedback@kinetta.app.")
