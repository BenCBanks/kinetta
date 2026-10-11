"""Passwords (argon2), login sessions (random token in an HttpOnly cookie, only its hash stored)."""
import hashlib, secrets, time
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from fastapi import Request, HTTPException
from . import db

ph = PasswordHasher()
COOKIE = 'fit_session'
SESSION_DAYS = 180          # phones stay logged in; logging out ends it
_fails = {}                 # (ip, login) -> [times]  simple brute-force brake

def hash_pw(pw): return ph.hash(pw)

_DUMMY = ph.hash('not-a-real-password')

def check_pw(stored, pw):
    """Always does one full hash check, so a wrong name and a wrong password take the same time."""
    try: return ph.verify(stored or _DUMMY, pw) and bool(stored)
    except (VerifyMismatchError, InvalidHashError): return False

def _h(token): return hashlib.sha256(token.encode()).hexdigest()

def too_many(ip, login):
    now = time.time(); k = (ip, login.lower())
    if len(_fails) > 2000:      # forget old entries so this never grows without limit
        for key in [x for x, ts in _fails.items() if not ts or now - ts[-1] > 900]: _fails.pop(key, None)
    _fails[k] = [t for t in _fails.get(k, []) if now - t < 900]
    return len(_fails[k]) >= 8

def failed(ip, login): _fails.setdefault((ip, login.lower()), []).append(time.time())

def new_session(c, user_id, agent):
    c.execute(f"DELETE FROM sessions WHERE last_seen < now() - interval '{SESSION_DAYS} days'")   # tidy expired logins
    token = secrets.token_urlsafe(32)
    c.execute('INSERT INTO sessions (token_hash, user_id, agent) VALUES (%s, %s, %s)', (_h(token), user_id, (agent or '')[:200]))
    return token

def set_cookie(request, response, token):
    response.set_cookie(COOKIE, token, max_age=SESSION_DAYS * 86400, httponly=True, secure=request.url.scheme == 'https',
                        samesite='lax', path='/')


def end_session(c, token):
    if token: c.execute('DELETE FROM sessions WHERE token_hash = %s', (_h(token),))

def current_user(request: Request):
    """FastAPI dependency: the logged-in person, or 401. Every data endpoint must use this."""
    token = request.cookies.get(COOKIE)
    if not token: raise HTTPException(401, 'Not logged in')
    with db.connect() as c:
        row = c.execute(f"""SELECT u.id, u.login::text AS login, u.name, u.is_admin, s.last_seen < now() - interval '1 hour' AS stale
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = %s AND s.last_seen > now() - interval '{SESSION_DAYS} days'""", (_h(token),)).fetchone()
        if not row: raise HTTPException(401, 'Not logged in')
        if row['stale']: c.execute('UPDATE sessions SET last_seen = now() WHERE token_hash = %s', (_h(token),))
        return {'id': row['id'], 'login': row['login'], 'name': row['name'], 'is_admin': row['is_admin']}
