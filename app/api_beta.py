"""Beta waitlist: a public "Join the beta" form (only when LANKKI_BETA_SIGNUP=1) and, for admins, the list of requests.

Nobody gets an account from the form. An admin reads the request on Me > People and taps "Invite", which makes a normal
one-time invite link to send them. Asking twice with the same email updates the first request (and says nothing about
whether it existed). The form is rate-limited per address and has a hidden field that only bots fill in.
"""
import os
import re
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from . import db, auth
from .auth import current_user
from .api_account import _admin, create_invite, InviteIn

router = APIRouter()
EMAIL_RE = re.compile(r'^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$', re.I)
MAX_WAITING = 500     # stop taking requests if this many are unanswered (keeps a flood from filling the disk)


def enabled(): return os.environ.get('LANKKI_BETA_SIGNUP', '') == '1'


class BetaIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    email: str = Field(min_length=3, max_length=120)
    phone: Literal['iphone', 'android', 'other']
    watch: str | None = Field(None, max_length=60)
    note: str | None = Field(None, max_length=300)
    website: str | None = Field(None, max_length=200)     # hidden on the form: people leave it empty, bots fill it


@router.get('/api/beta')
def beta_open(): return {'open': enabled()}


@router.post('/api/beta')
def beta_request(body: BetaIn, request: Request):
    if not enabled(): raise HTTPException(404, 'Not found')
    ip = auth.client_ip(request)
    if auth.too_many(ip, 'beta'): raise HTTPException(429, 'Too many tries - wait 15 minutes')
    auth.failed(ip, 'beta')          # every request counts, so one address can send only a few
    if body.website: return {'ok': True}
    email = body.email.strip()
    if not EMAIL_RE.match(email): raise HTTPException(400, 'Check your email address')
    clean = lambda v: (v or '').strip() or None
    with db.connect() as c:
        if c.execute("SELECT count(*) AS n FROM beta_requests WHERE status = 'new'").fetchone()['n'] >= MAX_WAITING:
            raise HTTPException(503, 'The beta is full right now - please try again later')
        c.execute("""INSERT INTO beta_requests (name, email, phone, watch, note) VALUES (%s, %s, %s, %s, %s)
                     ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone,
                       watch = EXCLUDED.watch, note = EXCLUDED.note
                     WHERE beta_requests.status = 'new'""",
                  (body.name.strip(), email, body.phone, clean(body.watch), clean(body.note)))
    return {'ok': True}


@router.get('/api/beta-requests')
def beta_list(user=Depends(current_user)):
    _admin(user)
    with db.connect() as c:
        return c.execute("""SELECT id, name, email, phone, watch, note, created FROM beta_requests
                            WHERE status = 'new' ORDER BY created""").fetchall()


@router.post('/api/beta-requests/{rid}/invite')
def beta_invite(rid: int, user=Depends(current_user)):
    _admin(user)
    with db.connect() as c:
        r = c.execute("SELECT name FROM beta_requests WHERE id = %s AND status = 'new'", (rid,)).fetchone()
    if not r: raise HTTPException(404, 'That request was already handled')
    inv = create_invite(InviteIn(note=r['name'][:60]), user)
    with db.connect() as c:
        c.execute("UPDATE beta_requests SET status = 'invited', invite_id = %s WHERE id = %s", (inv['id'], rid))
    return inv


@router.post('/api/beta-requests/{rid}/dismiss')
def beta_dismiss(rid: int, user=Depends(current_user)):
    _admin(user)
    with db.connect() as c:
        c.execute("UPDATE beta_requests SET status = 'dismissed' WHERE id = %s AND status = 'new'", (rid,))
    return {'ok': True}
