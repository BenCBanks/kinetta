"""Beta waitlist: a public "Join the beta" form (only when KINETTA_BETA_SIGNUP=1) and, for admins, the list of requests.

Nobody gets an account from the form. An admin reads the request on Me > People and taps "Invite", which makes a normal
one-time invite link to send them. Asking twice with the same email updates the first request (and says nothing about
whether it existed). The form is rate-limited per address and has a hidden field that only bots fill in.
"""
import os
import re
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StrictBool
from . import db, auth
from .auth import current_user
from .admin_auth import admin_user
from .api_account import _admin, create_invite, InviteIn

router = APIRouter()
EMAIL_RE = re.compile(r'^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$', re.I)
MAX_WAITING = 500     # stop taking requests if this many are unanswered (keeps a flood from filling the disk)


def enabled():
    from . import signup      # the waitlist also opens in waitlist mode, and when open signup is full (#232)
    return os.environ.get('KINETTA_BETA_SIGNUP', '') == '1' or signup.waitlist_open()


class BetaIn(BaseModel):
    challenge_code:str|None=Field(None,max_length=60)
    challenge_join:StrictBool=False
    card_code: str | None = Field(None,max_length=60)
    card_request: StrictBool = False
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
    from . import account_email
    email = account_email._clean_email(body.email)
    account_email.enrollment_limit(request, email, waitlist=True)
    if body.website: return {'ok': True}
    clean = lambda v: (v or '').strip() or None
    with db.connect() as c:
        account_email.require_available(c, email)
        fresh = not c.execute('SELECT 1 FROM beta_requests WHERE lower(email)=%s', (email,)).fetchone()
        if c.execute("SELECT count(*) AS n FROM beta_requests WHERE status = 'new'").fetchone()['n'] >= MAX_WAITING:
            raise HTTPException(503, 'The beta is full right now - please try again later')
        origin=None
        if body.card_code:
            from . import cards
            try:origin=cards.active(c,body.card_code)['code']
            except HTTPException:pass
        challenge=None
        if body.challenge_code:
            from . import challenges
            try:challenge=challenges.accessible(c,body.challenge_code)['code']
            except HTTPException:pass
        c.execute("""INSERT INTO beta_requests (name, email, phone, watch, note,card_code,card_request,challenge_code,challenge_join) VALUES (%s, %s, %s, %s, %s,%s,%s,%s,%s)
                     ON CONFLICT (lower(email)) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone,
                       watch = EXCLUDED.watch, note = EXCLUDED.note,card_code=EXCLUDED.card_code,card_request=EXCLUDED.card_request,challenge_code=EXCLUDED.challenge_code,challenge_join=EXCLUDED.challenge_join
                     WHERE beta_requests.status = 'new'""",
                  (body.name.strip(), email, body.phone, clean(body.watch), clean(body.note),origin,body.card_request if origin else False,challenge,body.challenge_join if challenge else False))
    if fresh:
        from .signup import capacity_notice
        capacity_notice(waitlist_new=True)
    return {'ok': True}


def beta_invite(rid: int, user=Depends(admin_user)):
    _admin(user)
    with db.connect() as c:
        r = c.execute("SELECT name FROM beta_requests WHERE id = %s AND status = 'new'", (rid,)).fetchone()
    if not r: raise HTTPException(404, 'That request was already handled')
    inv = create_invite(InviteIn(note=r['name'][:60]), user)
    with db.connect() as c:
        c.execute("UPDATE beta_requests SET status = 'invited', invite_id = %s WHERE id = %s", (inv['id'], rid))
    return inv
