"""Signed-in devices (#232 I): where you're logged in, with a sign-out for each one or for all the others.

Each row is a login session. Only a rough device name from the browser's own label and the dates are shown; IP
addresses are never kept. The id handed to the phone is a short slice of the session's hash, never a login token."""
from fastapi import APIRouter, Depends, HTTPException, Request
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
