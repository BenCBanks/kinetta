"""Passwords (argon2), login sessions (random token in an HttpOnly cookie, only its hash stored)."""
import hashlib, os, secrets, time
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from fastapi import Request, HTTPException
from . import db

ph = PasswordHasher()
COOKIE = 'fit_session'
SESSION_DAYS = 180          # phones stay logged in; logging out ends it
# failed sign-in attempts are counted in the database (auth_attempts), so the limits survive restarts (2026-10-24)

def hash_pw(pw): return ph.hash(pw)

_DUMMY = ph.hash('not-a-real-password')

def check_pw(stored, pw):
    """Always does one full hash check, so a wrong name and a wrong password take the same time."""
    try: return ph.verify(stored or _DUMMY, pw) and bool(stored)
    except (VerifyMismatchError, InvalidHashError): return False

def token_hash(token):
    """How login, invite and connection tokens are stored: only this hash, never the token itself."""
    return hashlib.sha256(token.encode()).hexdigest()


_h = token_hash

# Brute-force brakes (15 minutes): 8 wrong passwords for one account from one place, 30 from one place in total,
# 50 for one account from everywhere (stops guessing from many addresses; phones already logged in are not affected).
WINDOW, PER_PAIR, PER_IP, PER_LOGIN = 900, 8, 30, 50


# 2026-10-12 review: CF-Connecting-IP is trusted only when the server says it sits behind Cloudflare
# (KINETTA_TRUST_CLOUDFLARE=1). Without Cloudflare in front, anyone could send that header and look like a new visitor
# on every guess.
TRUST_CF = os.environ.get('KINETTA_TRUST_CLOUDFLARE', '').strip().lower() in ('1', 'true', 'yes')


def client_ip(request):
    """The visitor's real address: Cloudflare's CF-Connecting-IP behind a Cloudflare Tunnel (visitors can't fake that
    one there), otherwise the address uvicorn got (a proxy's X-Forwarded-For counts only from FORWARDED_ALLOW_IPS)."""
    cf = request.headers.get('cf-connecting-ip') if TRUST_CF else None
    return (cf or (request.client.host if request.client else '')).strip()[:64]


class Failed(Exception):
    """A wrong password or code: raised inside a transaction and counted with failed() only after that connection is
    released, so a burst of wrong passwords can't tie up the small connection pool waiting for a second connection."""
    def __init__(self, status, message): super().__init__(message); self.status, self.message = status, message


def _keys(ip, login):
    login = (login or '').lower()
    return ('fail:pair:' + ip + ':' + login, 'fail:ip:' + ip, 'fail:login:' + login)


def too_many(ip, login):
    pair, by_ip, by_login = _keys(ip, login)
    with db.connect() as c:
        r = c.execute("""SELECT count(*) FILTER (WHERE key = %s) AS pair, count(*) FILTER (WHERE key = %s) AS ip,
                                count(*) FILTER (WHERE key = %s) AS login
                         FROM auth_attempts WHERE key IN (%s, %s, %s) AND created > now() - %s * interval '1 second'""",
                      (pair, by_ip, by_login, pair, by_ip, by_login, WINDOW)).fetchone()
    return r['pair'] >= PER_PAIR or r['ip'] >= PER_IP or r['login'] >= PER_LOGIN


def failed(ip, login):
    with db.connect() as c:
        c.execute("DELETE FROM auth_attempts WHERE created < now() - interval '1 day'")
        for key in _keys(ip, login): c.execute('INSERT INTO auth_attempts (key) VALUES (%s)', (key,))


# New passwords: at least 10 characters, not one of the passwords every attacker tries first, not the username.
COMMON = {'password', 'password1', 'password12', 'password123', 'passw0rd', '1234567890', '12345678910', 'qwertyuiop',
          'qwerty1234', '1q2w3e4r5t', 'iloveyou12', 'letmein123', 'welcome123', 'football12', 'baseball12', 'abc1234567',
          'changeme12', 'kinetta1234', 'kinettakinetta', 'running123', 'fitness123', 'summer2026', 'autumn2026', 'qwerty123456',
          '0987654321', '1111111111', 'aaaaaaaaaa', 'trustno1234', 'sunshine12', 'princess12', 'dragon1234', 'monkey1234'}


def check_new_password(pw, login=''):
    from fastapi import HTTPException
    if len(pw) < 10: raise HTTPException(400, 'Use at least 10 characters for the password')
    low = pw.lower()
    if low in COMMON or len(set(low)) < 4: raise HTTPException(400, 'That password is too easy to guess - try a short sentence')
    if login and login.lower() in low: raise HTTPException(400, "Don't put your username in your password")


def new_session(c, user_id, agent, channel='web'):
    c.execute(f"DELETE FROM sessions WHERE last_seen < now() - interval '{SESSION_DAYS} days'")   # tidy expired logins
    token = secrets.token_urlsafe(32)
    c.execute('INSERT INTO sessions (token_hash, user_id, agent) VALUES (%s, %s, %s)', (_h(token), user_id, (agent or '')[:200]))
    from .admin_usage import record_login
    record_login(c,user_id,channel)
    return token

def set_cookie(request, response, token):
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, secure=request.url.scheme == 'https',
                        samesite='lax', path='/')


def end_session(c, token):
    if token:
        c.execute('DELETE FROM admin_sessions WHERE user_id=(SELECT user_id FROM sessions WHERE token_hash=%s)',(_h(token),))
        c.execute('DELETE FROM admin_challenges WHERE user_id=(SELECT user_id FROM sessions WHERE token_hash=%s)',(_h(token),))
        c.execute('DELETE FROM sessions WHERE token_hash = %s', (_h(token),))

def session_token(request):
    """The browser sends its login in the cookie; the iPhone app (mobile/) sends the same kind of login token as
    `Authorization: Bearer <token>`, because its pages are not on the server's address and can't use the cookie."""
    a = request.headers.get('authorization', '')
    if a[:7].lower() == 'bearer ': return a[7:].strip()[:100] or None
    return request.cookies.get(COOKIE)


def current_user(request: Request):
    """FastAPI dependency: the logged-in person, or 401. Every data endpoint must use this."""
    token = session_token(request)
    if not token: raise HTTPException(401, 'Not logged in')
    with db.connect() as c:
        row = c.execute(f"""SELECT u.id, u.login::text AS login, u.name, u.is_admin, u.photo_v, s.last_seen < now() - interval '1 hour' AS stale
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = %s AND s.last_seen > now() - interval '{SESSION_DAYS} days' AND u.suspended_at IS NULL""", (_h(token),)).fetchone()
        if not row: raise HTTPException(401, 'Not logged in')
        expected = request.headers.get('x-kinetta-account')
        if expected is not None and expected != str(row['id']):
            raise HTTPException(409, {'code': 'account_changed', 'message': 'The account changed. Return to the account that saved this item to send it.'})
        if row['stale']: c.execute('UPDATE sessions SET last_seen = now() WHERE token_hash = %s', (_h(token),))
        request.state.user_id = row['id']       # for the API request log (request_log.py)
        return {'id': row['id'], 'login': row['login'], 'name': row['name'], 'is_admin': row['is_admin'], 'photo': row['photo_v']}
