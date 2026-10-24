"""Signed-in devices (#232 I): where you're logged in, with a sign-out for each one or for all the others.

Each row is a login session. Only a rough device name from the browser's own label and the dates are shown; IP
addresses are never kept. The id handed to the phone is a short slice of the session's hash, never a login token."""
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import auth, db
from .api_admin import device
from .auth import current_user

router = APIRouter()
ID = 16


class DeviceIn(BaseModel):
    id: str = Field(min_length=ID, max_length=ID, pattern='^[0-9a-f]+$')


def _this(request):
    token = auth.session_token(request)
    return auth.token_hash(token) if token else ''


@router.get('/api/account/devices')
def devices(request: Request, user=Depends(current_user)):
    this = _this(request)
    with db.connect() as c:
        rows = c.execute('SELECT token_hash, agent, created, last_seen FROM sessions WHERE user_id = %s ORDER BY last_seen DESC',
                         (user['id'],)).fetchall()
    return [{'id': r['token_hash'][:ID], 'device': device(r['agent']), 'signed_in': r['created'], 'last_used': r['last_seen'],
             'this': r['token_hash'] == this} for r in rows]


@router.post('/api/account/devices/signout')
def sign_out_device(body: DeviceIn, request: Request, user=Depends(current_user)):
    if _this(request).startswith(body.id): raise HTTPException(400, 'Use Log out to sign out of this device.')
    with db.connect() as c:
        n = c.execute('DELETE FROM sessions WHERE user_id = %s AND left(token_hash, %s) = %s', (user['id'], ID, body.id)).rowcount
    if not n: raise HTTPException(404, 'That device is already signed out.')
    return {'ok': True}


@router.post('/api/account/devices/signout-others')
def sign_out_others(request: Request, user=Depends(current_user)):
    """After a lost phone: every other web and iPhone app login ends, and admin portal sessions too. This one stays."""
    with db.connect() as c:
        n = c.execute('DELETE FROM sessions WHERE user_id = %s AND token_hash <> %s', (user['id'], _this(request))).rowcount
        for t in ('admin_sessions', 'admin_challenges'): c.execute(f'DELETE FROM {t} WHERE user_id = %s', (user['id'],))
    return {'ok': True, 'signed_out': n}


def remember(c, background: BackgroundTasks, uid, agent):
    """After a password sign-in (#232 I): note the device, and email the person when it's one they haven't used before.
    Their very first device is only remembered. Off with Settings > Notifications > New sign-in emails."""
    from . import account_email
    name = device(agent)
    seen = c.execute('SELECT device FROM known_devices WHERE user_id = %s', (uid,)).fetchall()
    c.execute("""INSERT INTO known_devices (user_id, device) VALUES (%s, %s)
                 ON CONFLICT (user_id, device) DO UPDATE SET last_seen = now()""", (uid, name))
    if not seen or name in {r['device'] for r in seen}: return
    u = c.execute("""SELECT u.name, u.login::text AS login, u.email::text AS email, p.signin_email FROM users u
                     LEFT JOIN profile p ON p.user_id = u.id WHERE u.id = %s AND u.email_verified_at IS NOT NULL""", (uid,)).fetchone()
    if u and u['email'] and u['signin_email'] is not False and account_email.mail_ready():
        background.add_task(account_email.send, u['email'], 'New sign-in to your Kinetta account',
            f"Hi {u['name']},\n\nYour Kinetta account ({u['login']}) was just signed in to from a new device: {name}.\n\n"
            "If this was you, there's nothing to do. If it wasn't, open Kinetta, go to Settings > Password to change it, "
            "then Settings > Signed-in devices to sign out everything else, and reply to this email so we can help.\n\n"
            "You can turn these emails off in Settings > Notifications.")


class SigninEmailIn(BaseModel):
    on: bool


@router.get('/api/account/signin-email')
def signin_email(user=Depends(current_user)):
    with db.connect() as c:
        r = c.execute('SELECT signin_email FROM profile WHERE user_id = %s', (user['id'],)).fetchone()
    return {'on': bool(r and r['signin_email'])}


@router.put('/api/account/signin-email')
def set_signin_email(body: SigninEmailIn, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('UPDATE profile SET signin_email = %s WHERE user_id = %s', (body.on, user['id']))
    return {'on': body.on}
