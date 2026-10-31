"""Accounts: first-run setup, invite links, your own account (name, login, password) and, for admins, managing people.

First run: while there are no accounts, the app shows "Create your account"; that first person becomes the admin.
Invites: an admin creates a one-time link (valid 7 days) and sends it; the person opens it and picks their own
username and password. Admins can also add someone with a first password, reset a forgotten password, or remove a person.
Changing your own password needs the current one and signs out every other phone/browser of that person.
"""
import datetime as dt
import os
import re
import secrets
import unicodedata
import shutil
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, Query
from pydantic import BaseModel, Field, StrictBool, ConfigDict
from psycopg import errors, sql
from . import db, auth, community_terms, community_filter
from .auth import current_user
from .admin_auth import admin_user, audit
from .profile_layout import ProfileLayout

router = APIRouter()
DATA = os.environ.get('FIT_DATA', '/data')
LOGIN_RE = re.compile(r'^[a-z][a-z0-9_]{1,29}$')
RESERVED_LOGINS = {'admin','administrator','support','kinetta','help','api','root','system','security','moderator','team','login','logout','signup','beta','privacy','terms','account','settings','static','www','me'}

def reserved_login(value):
    return re.sub(r'[0-9]+$', '', value) in RESERVED_LOGINS


def _clean_login(v, *, current=None):
    v = (v or '').strip().lower()
    if not LOGIN_RE.match(v): raise HTTPException(400, 'Username: 2-30 lowercase letters, numbers or _, starting with a letter')
    if reserved_login(v) and v != (current or '').strip().lower(): raise HTTPException(400, 'That username is reserved. Choose another.')
    community_filter.check(v, 'username')
    return v


def _clean_name(v):
    v = ' '.join((v or '').split())
    if not 1 <= len(v) <= 60: raise HTTPException(400, 'Name: 1-60 characters')
    community_filter.check(v, 'name')
    return v


class AccountIn(BaseModel):
    bio: str | None = Field(None, max_length=280)
    name: str | None = Field(None, max_length=60)
    login: str | None = Field(None, max_length=30)
    profile_layout: ProfileLayout | None = None


@router.put('/api/account')
def set_account(body: AccountIn, user=Depends(current_user)):
    vals = {}
    if body.name is not None: vals['name'] = _clean_name(body.name)
    if body.login is not None: vals['login'] = _clean_login(body.login, current=user['login'])
    layout=body.profile_layout.model_dump() if body.profile_layout is not None else None
    if vals or body.bio is not None or layout is not None:
        try:
            with db.connect() as c:
                if not c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],)).fetchone():
                    raise HTTPException(404,'Account not found.')
                if vals or body.bio:
                    community_filter.public(c, user['id'], ('bio', body.bio))
                if body.bio is not None:
                    c.execute('UPDATE profile SET bio = %s WHERE user_id = %s', (body.bio.strip(), user['id']))
                if layout is not None:
                    import json
                    c.execute('UPDATE profile SET profile_layout=%s::jsonb WHERE user_id=%s',(json.dumps(layout),user['id']))
                if vals: c.execute(f"UPDATE users SET {', '.join(f'{k} = %s' for k in vals)} WHERE id = %s", (*vals.values(), user['id']))
        except errors.UniqueViolation:
            raise HTTPException(409, 'That username is taken')
    return {'ok': True, **vals, **({'profile_layout':layout} if layout is not None else {})}


class PasswordIn(BaseModel):
    current: str = Field(max_length=200)
    new: str = Field(min_length=8, max_length=200)


@router.post('/api/account/password')
def set_password(body: PasswordIn, request: Request, background: BackgroundTasks, user=Depends(current_user)):
    ip = auth.client_ip(request)
    if auth.too_many(ip, user['login']): raise HTTPException(429, 'Too many tries - wait 15 minutes')
    try:
        with db.connect() as c:
            row = c.execute('SELECT pw_hash, email::text AS email FROM users WHERE id = %s', (user['id'],)).fetchone()
            stored = row['pw_hash']
            if not auth.check_pw(stored, body.current):
                raise auth.Failed(400, 'Current password is wrong')
            auth.check_new_password(body.new, user['login'])
            c.execute('UPDATE users SET pw_hash = %s WHERE id = %s', (auth.hash_pw(body.new), user['id']))
            c.execute('DELETE FROM admin_sessions WHERE user_id=%s',(user['id'],))
            c.execute('DELETE FROM admin_challenges WHERE user_id=%s',(user['id'],))
            # sign out everywhere else; this phone keeps its login
            c.execute('DELETE FROM sessions WHERE user_id = %s AND token_hash <> %s',
                      (user['id'], auth._h(auth.session_token(request) or '')))
    except auth.Failed as e:
        auth.failed(ip, user['login']); raise HTTPException(e.status, e.message)
    from .account_email import password_changed
    password_changed(background, row['email'], user['name'], user['login'])
    return {'ok': True}


def _admin(user):
    if not user.get('is_admin'): raise HTTPException(403, 'Only an admin can do that')


def people(user=Depends(admin_user)):
    _admin(user)
    with db.connect() as c:
        return c.execute("""SELECT login::text AS login, name, created, is_admin, pw_hash IS NOT NULL AS has_password
                            FROM users WHERE login NOT LIKE 'zz\\_test%%' ORDER BY id""").fetchall()


class PersonIn(BaseModel):
    login: str = Field(max_length=30)
    name: str = Field(max_length=60)
    password: str = Field(min_length=8, max_length=200)


def add_person(body: PersonIn, user=Depends(admin_user)):
    _admin(user)
    login, name = _clean_login(body.login), _clean_name(body.name)
    auth.check_new_password(body.password, login)
    try:
        with db.connect() as c:
            uid = c.execute('INSERT INTO users (login, name, pw_hash) VALUES (%s, %s, %s) RETURNING id',
                            (login, name, auth.hash_pw(body.password))).fetchone()['id']
            c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))
            audit(c,user['id'],'account.create_member',uid)
    except errors.UniqueViolation:
        raise HTTPException(409, 'That username is taken')
    return {'ok': True, 'login': login}


# ---------- admin: reset a password, remove a person (2026-10-10) ----------
class ResetIn(BaseModel):
    password: str = Field(min_length=8, max_length=200)


class RemoveIn(BaseModel):
    confirm: str = Field(max_length=30)     # the person's username, typed again


def _target(c, admin, login):
    t = c.execute('SELECT id, login::text AS login, name, is_admin, sql_role FROM users WHERE login = %s', (login,)).fetchone()
    if not t: raise HTTPException(404, 'No such person')
    if t['id'] == admin['id']: raise HTTPException(400, 'Use Me > Account for your own password')
    if t['is_admin']: raise HTTPException(400, "Admins can't be changed here")
    return t


def reset_password(login: str, body: ResetIn, user=Depends(admin_user)):
    """Admin sets a new password (e.g. forgotten); every phone of that person is signed out."""
    _admin(user)
    with db.connect() as c:
        t = _target(c, user, login)
        auth.check_new_password(body.password, t['login'])
        c.execute('UPDATE users SET pw_hash = %s WHERE id = %s', (auth.hash_pw(body.password), t['id']))
        c.execute('DELETE FROM sessions WHERE user_id = %s', (t['id'],))
        c.execute('DELETE FROM admin_sessions WHERE user_id=%s',(t['id'],))
        c.execute('DELETE FROM admin_challenges WHERE user_id=%s',(t['id'],))
        audit(c,user['id'],'account.password_reset',t['id'])
    return {'ok': True}


def remove_person(login: str, body: RemoveIn, user=Depends(admin_user)):
    """Admin removes a person and ALL their data (activities, food, weights, plans, uploaded files). Can't be undone,
    except from the nightly database backup."""
    _admin(user)
    with db.connect() as c:
        t = _target(c, user, login)
        if body.confirm.strip().lower() != t['login'].lower(): raise HTTPException(400, 'Type the username exactly to confirm')
        audit(c,user['id'],'account.remove',t['id'])
        erase(c, t)
    erase_files(t['id'])
    return {'ok': True}


def erase(c, t):
    """Delete a person and every row of theirs (all personal tables cascade from users), plus their beta request."""
    # Matchers lock accounts before segment rows. Take the exclusive account lock
    # first too, so their foreign-key/key-share locks cannot deadlock with erasure.
    c.execute('SELECT id FROM users WHERE id = %s FOR UPDATE', (t['id'],))
    c.execute("""DELETE FROM beta_requests WHERE invite_id IN (SELECT id FROM invites WHERE used_by = %s)""", (t['id'],))
    # A verified deletion request completes in the same transaction as the deletion; the account link is then cleared.
    for r in c.execute("UPDATE admin_data_requests SET status='completed',completed_at=now() WHERE user_id=%s AND kind='deletion' AND status='verified' RETURNING id", (t['id'],)).fetchall():
        audit(c, None, 'request.completed', r['id'])
    # Segments you created (#278/#286): published ones are taken down (definition, path and name wiped; a tombstone keeps
    # the ID from ever being reused), private ones deleted. Other people's workouts stay; only times on these courses go.
    from . import api_segments
    api_segments.take_down(c, [r['id'] for r in c.execute("SELECT id FROM segments WHERE creator_id = %s AND audience = 'everyone' AND status <> 'removed'", (t['id'],)).fetchall()], 'creator_deleted')
    c.execute("DELETE FROM segments WHERE creator_id = %s AND audience = 'me'", (t['id'],))
    c.execute('DELETE FROM users WHERE id = %s', (t['id'],))
    if t['sql_role']:
        try:
            with c.transaction():
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(t['sql_role'])))
        except Exception:
            pass    # the person is gone; a leftover SQL login can't see any rows


def erase_files(uid):
    """Their original activity files and uploads (call after the rows are gone)."""
    for d in (os.path.join(DATA, 'files', str(uid)), os.path.join(DATA, 'uploads', str(uid))):
        if os.path.isdir(d): shutil.rmtree(d, ignore_errors=True)


# ---------- first run + invite links ----------
INVITE_DAYS = 7


class NewAccountIn(BaseModel):
    terms_version: str | None = Field(None, max_length=64)
    challenge_code:str|None=Field(None,max_length=60)
    challenge_join:StrictBool=False
    card_code: str | None = Field(None,max_length=60)
    card_request: StrictBool = False
    name: str = Field(max_length=60)
    login: str | None = Field(None, max_length=30)      # optional: made from the name, and changeable any time
    password: str = Field(min_length=8, max_length=200)
    tz: str | None = Field(None, max_length=64)            # the phone's time zone (Intl API)
    units: str | None = Field(None, pattern='^(imperial|metric)$')
    share_default: str = Field('everyone', pattern='^(me|friends|everyone)$')


def suggest_login(c, name, taken=()):
    """A free username from a name, like a gamertag: "Zoë Smith" -> zoe, then zoe2, zoe3 (2026-10-24, Ben: people log in
    with their email and change their username whenever they like)."""
    word = (unicodedata.normalize('NFKD', name).encode('ascii', 'ignore').decode().lower().split() or [''])[0]
    base = re.sub(r'^[^a-z]+', '', re.sub(r'[^a-z0-9_]', '', word))[:26]
    if len(base) < 2 or reserved_login(base): base = 'mover'
    for n in range(1, 100000):
        cand = base if n == 1 else f'{base}{n}'
        if cand not in taken and not c.execute('SELECT 1 FROM users WHERE login = %s', (cand,)).fetchone(): return cand


@router.get('/api/account/username-availability')
def username_availability(request: Request, login: str = Query('', max_length=60)):
    """Only public handle availability; an unchanged handle comes from the authenticated session."""
    from . import account_email
    with db.connect() as c:
        hit = account_email.limited(c, 'username-ip:' + auth.client_ip(request), 60, 1)
    if hit: raise HTTPException(429, 'Too many checks. Wait a minute and try again.')
    who = None
    if auth.session_token(request):
        try: who = current_user(request)
        except HTTPException as error:
            if error.status_code != 401: raise
    value = login.strip().lower()
    try: value = _clean_login(value, current=who['login'] if who else None)
    except HTTPException as error:
        return {'login':value,'available':False,'reason':'reserved' if reserved_login(value) else 'invalid','message':error.detail}
    with db.connect() as c:
        taken = c.execute('SELECT 1 FROM users WHERE login=%s AND (%s::bigint IS NULL OR id<>%s)', (value,who['id'] if who else None,who['id'] if who else None)).fetchone()
        suggestion = suggest_login(c,value,taken={value}) if taken else None
    return {'login':value,'available':not bool(taken),'reason':'taken' if taken else None,'suggestion':suggestion}


def _create(c, body, is_admin=False):
    """Insert a person + their settings; returns the new id."""
    community_terms.check_agreement(body.terms_version)
    name, chosen = _clean_name(body.name), body.login and body.login.strip()
    login = _clean_login(chosen) if chosen else suggest_login(c, name)
    community_filter.check(login, 'username')
    auth.check_new_password(body.password, login)
    tz = db.valid_tz(body.tz) or db.DEFAULT_TZ
    tried = set()
    while True:
        try:
            with c.transaction():
                uid = c.execute('INSERT INTO users (login, name, pw_hash, is_admin) VALUES (%s, %s, %s, %s) RETURNING id',
                                (login, name, auth.hash_pw(body.password), is_admin)).fetchone()['id']
            break
        except errors.UniqueViolation:
            if chosen or len(tried) > 20: raise HTTPException(409, 'That username is taken')
            tried.add(login); login = suggest_login(c, name, tried)     # someone took the same suggestion at that moment
    # Kit (AI features) stays off until the person says yes; the welcome steps ask (owner, 2026-10-26).
    c.execute('INSERT INTO profile (user_id, tz, units, share_default, terms_version, terms_accepted_at) VALUES (%s, %s, %s, %s, %s, %s)', (uid, tz, body.units or 'imperial', body.share_default, community_terms.active_version(), dt.datetime.now(dt.timezone.utc) if community_terms.active_version() else None))
    if body.card_code:c.execute("INSERT INTO signup_join_intents(user_id,kind,code,want_request) VALUES(%s,'card',%s,%s)",(uid,body.card_code,body.card_request))
    if body.challenge_code and body.challenge_join:c.execute("INSERT INTO signup_join_intents(user_id,kind,code,want_request) VALUES(%s,'challenge',%s,true)",(uid,body.challenge_code))
    return uid


@router.get('/api/setup')
def setup_needed():
    """No login needed: tells the app to show "Create your account" on a brand-new server."""
    with db.connect() as c:
        return {'needed': not c.execute('SELECT 1 FROM users LIMIT 1').fetchone()}


@router.post('/api/setup')
def setup(body: NewAccountIn, request: Request, response: Response):
    """Creates the first account (the admin). Refused as soon as any account exists."""
    with db.connect() as c:
        c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')     # two first visitors at once: only one wins
        if c.execute('SELECT 1 FROM users LIMIT 1').fetchone(): raise HTTPException(409, 'This server is already set up - log in instead')
        uid = _create(c, body, is_admin=True)
        token = auth.new_session(c, uid, request.headers.get('user-agent'))
    auth.set_cookie(request, response, token)
    return {'ok': True}


_hash = auth.token_hash


class InviteIn(BaseModel):
    note: str | None = Field(None, max_length=60)      # who it's for, so the admin can tell links apart


def create_invite(body: InviteIn, user=Depends(admin_user)):
    _admin(user)
    token = secrets.token_urlsafe(24)
    with db.connect() as c:
        r = c.execute("INSERT INTO invites (token_hash, created_by, note, expires) VALUES (%s, %s, %s, now() + %s) RETURNING id, expires",
                      (_hash(token), user['id'], (body.note or '').strip()[:60] or None, dt.timedelta(days=INVITE_DAYS))).fetchone()
        audit(c,user['id'],'invite.create',r['id'])
    base = os.environ.get('KINETTA_PUBLIC_URL', '').rstrip('/')    # e.g. https://app.example.com - links work from anywhere
    return {'id': r['id'], 'path': '/join/' + token, 'url': base + '/join/' + token if base else None, 'expires': r['expires']}


def list_invites(user=Depends(admin_user)):
    _admin(user)
    with db.connect() as c:
        return c.execute("""SELECT id, note, created, expires FROM invites WHERE used_at IS NULL AND expires > now()
                            ORDER BY created DESC""").fetchall()


def _open_invite(c, token, lock=False):
    r = c.execute(f"""SELECT i.id, i.note, '@'||u.login::text AS inviter,
                      (SELECT card_code FROM beta_requests WHERE invite_id=i.id ORDER BY id DESC LIMIT 1) AS origin_card,
                      (SELECT card_request FROM beta_requests WHERE invite_id=i.id ORDER BY id DESC LIMIT 1) AS origin_request,
                      (SELECT challenge_code FROM beta_requests WHERE invite_id=i.id ORDER BY id DESC LIMIT 1) AS origin_challenge,
                      (SELECT challenge_join FROM beta_requests WHERE invite_id=i.id ORDER BY id DESC LIMIT 1) AS origin_challenge_join FROM invites i LEFT JOIN users u ON u.id = i.created_by
                      WHERE i.token_hash = %s AND i.used_at IS NULL AND i.expires > now(){' FOR UPDATE OF i' if lock else ''}""",
                  (_hash(token or ''),)).fetchone()
    if not r: raise HTTPException(404, 'This invite link has expired or was already used. Ask for a new one.')
    return r


@router.get('/api/join/{token}')
def invite_info(token: str):
    """No login needed: who sent the invite, so the join page can say so, and whether it can ask for an email."""
    from . import account_email
    with db.connect() as c:
        r = _open_invite(c, token)
    card=None
    if r.get('origin_card'):
        from . import cards
        try:
            with db.connect() as c:
                origin=cards.active(c,r['origin_card']);card={'code':r['origin_card'],'username':origin['login'],'allow_requests':origin['allow_requests'],'request_default':bool(r['origin_request'])}
        except HTTPException:pass
    challenge=None
    if r.get('origin_challenge'):
        from . import challenges
        try:
            with db.connect() as c:
                origin=challenges.accessible(c,r['origin_challenge']);challenge={'code':origin['code'],'title':challenges.title(origin),'join_default':bool(r['origin_challenge_join'])}
        except HTTPException:pass
    return {'inviter':r['inviter'],'email':account_email.mail_ready(),'card':card,'challenge':challenge}


class JoinIn(NewAccountIn):
    token: str = Field(max_length=100)
    email: str | None = Field(None, max_length=120)      # invited people log in with their email too, once confirmed


@router.post('/api/join')
def join(body: JoinIn, request: Request, response: Response, background: BackgroundTasks):
    from . import account_email
    email = account_email._clean_email(body.email) if body.email and body.email.strip() else None
    ip = auth.client_ip(request)
    if auth.too_many(ip, 'join'): raise HTTPException(429, 'Too many tries - wait 15 minutes')
    if email: account_email.enrollment_limit(request, email)
    try:
        with db.connect() as c:
            inv = _open_invite(c, body.token, lock=True)      # 404 for a bad link: counted below, after this connection
    except HTTPException:
        auth.failed(ip, 'join'); raise
    with db.connect() as c:
        if email: account_email.reservation_lock(c)
        inv = _open_invite(c, body.token, lock=True)
        if email:
            account_email.require_available(c, email)
            if not account_email.mail_ready(): raise HTTPException(503, 'Email isn’t set up on this Kinetta yet. Ask the person who runs it.')
        uid = _create(c, body)
        if not body.card_code and inv.get('origin_card'):c.execute("INSERT INTO signup_join_intents(user_id,kind,code,want_request) VALUES(%s,'card',%s,false)",(uid,inv['origin_card']))
        c.execute('UPDATE invites SET used_by = %s, used_at = now() WHERE id = %s', (uid, inv['id']))
        if email and account_email.mail_ready(): account_email.confirmation(background, c, uid, _clean_name(body.name), email, welcome=True)
        token = auth.new_session(c, uid, request.headers.get('user-agent'))
        login = c.execute('SELECT login::text AS login FROM users WHERE id = %s', (uid,)).fetchone()['login']
    from . import cards,challenges
    with db.connect() as c:cards.consume_signup(c,uid)
    with db.connect() as c:challenges.consume_signup(c,uid)
    auth.set_cookie(request, response, token)
    return {'ok': True, 'login': login}


class ExistingJoinIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: str = Field(min_length=1, max_length=100)


@router.post('/api/join/existing')
def join_existing(body: ExistingJoinIn, user=Depends(current_user)):
    """Explicit acceptance records the inviter; it does not create accounts, sessions or friend requests."""
    with db.connect() as c:
        if not c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE', (user['id'],)).fetchone(): raise HTTPException(404, 'Account not found.')
        invitation = c.execute('SELECT id,used_by,used_at,expires FROM invites WHERE token_hash=%s FOR UPDATE', (_hash(body.token),)).fetchone()
        if not invitation: raise HTTPException(404, 'This invitation is no longer available.')
        if invitation['used_at']:
            if invitation['used_by'] == user['id']: return {'ok':True,'already_accepted':True}
            raise HTTPException(404, 'This invitation is no longer available.')
        if invitation['expires'] <= dt.datetime.now(dt.timezone.utc): raise HTTPException(404, 'This invitation has expired.')
        c.execute('UPDATE invites SET used_by=%s,used_at=now() WHERE id=%s', (user['id'],invitation['id']))
    return {'ok':True,'already_accepted':False}


@router.get('/api/account/inviter')
def inviter(user=Depends(current_user)):
    """Whoever's invite link brought you here, for the welcome steps' "Become friends" (#232 F5). Nothing once you're
    already friends, or when either of you has blocked the other or that account is hidden."""
    from .api_social import unconfirmed
    with db.connect() as c:
        r = c.execute(f"""SELECT u.login::text AS login, u.name, u.photo_v AS photo FROM invites i JOIN users u ON u.id = i.created_by
            WHERE i.used_by = %(me)s AND u.id <> %(me)s AND NOT {unconfirmed('u.id')}
              AND NOT EXISTS (SELECT 1 FROM blocks b WHERE (b.user_id = u.id AND b.blocked = %(me)s) OR (b.user_id = %(me)s AND b.blocked = u.id))
              AND NOT EXISTS (SELECT 1 FROM friendships f WHERE f.status = 'accepted' AND %(me)s IN (f.requester, f.addressee) AND u.id IN (f.requester, f.addressee))
            ORDER BY i.used_at DESC LIMIT 1""", {'me': user['id']}).fetchone()
    return {'inviter': r}
