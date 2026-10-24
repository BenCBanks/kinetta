"""Signing up with an email (#232 D, 2026-10-24): the server owner chooses how new people get in.

KINETTA_SIGNUP: "invite" (the default: invite links only), "waitlist" (the public Join the beta form) or "open" (anyone
can make an account). KINETTA_MAX_ACCOUNTS caps open signup; when it's reached, the form turns into the waitlist.
Invite links from an administrator always work, cap or not. The cap counts real accounts, not zz_test ones, and is
checked under a table lock, so two people taking the last place at once can't both get in.

A new account works straight away, but stays out of other people's sight (api_social.unconfirmed) until its owner
opens the confirmation link emailed to them. Open signup needs email to be set up, since that link is the check.
"""
import os
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import Field, StrictBool
from . import db, auth, account_email
from .api_account import NewAccountIn, _create

router = APIRouter()
TEST_ACCOUNTS = 'zz\\_test%'       # throwaway test accounts never use up a place


def mode():
    m = os.environ.get('KINETTA_SIGNUP', 'invite').strip().lower()
    return m if m in ('invite', 'waitlist', 'open') else 'invite'


def cap():
    try: return max(0, int(os.environ.get('KINETTA_MAX_ACCOUNTS', '')))
    except ValueError: return None


def accounts(c):
    return c.execute('SELECT count(*) AS n FROM users WHERE login NOT LIKE %s', (TEST_ACCOUNTS,)).fetchone()['n']


def state(c):
    """What the public signup page should offer: the form, the waitlist, or neither."""
    n, most, m = accounts(c), cap(), mode()
    full = most is not None and n >= most
    can_open = m == 'open' and account_email.mail_ready()
    return {'mode': m, 'open': can_open and not full, 'full': can_open and full, 'accounts': n, 'cap': most}


def waitlist_open():
    """The public waitlist form is on in waitlist mode, and in open mode once the cap is reached."""
    if mode() == 'waitlist': return True
    if mode() != 'open': return False
    with db.connect() as c: return state(c)['full']


@router.get('/api/signup')
def signup_info():
    with db.connect() as c:
        s = state(c)
    return {'open': s['open'], 'full': s['full']}


class SignupIn(NewAccountIn):
    email: str = Field(max_length=120)
    age_ok: StrictBool = False        # "I'm 16 or older" (privacy policy)
    website: str | None = Field(None, max_length=200)     # hidden on the form: people leave it empty, bots fill it


@router.post('/api/signup')
def signup(body: SignupIn, request: Request, response: Response, background: BackgroundTasks):
    email = account_email._clean_email(body.email)
    if not body.age_ok: raise HTTPException(400, 'Kinetta is for people 16 or older')
    with db.connect() as c:
        if account_email.limited(c, 'signup-ip:' + auth.client_ip(request), 5, 60): raise HTTPException(429, 'Too many tries - wait an hour')
    if body.website: return {'ok': True}          # a bot: say nothing useful, make nothing
    with db.connect() as c:
        c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')     # the cap holds even for simultaneous signups
        s = state(c)
        if s['full']: raise HTTPException(409, {'code': 'full', 'message': 'Kinetta is full for now. Join the waitlist and we’ll let you know when there’s room.'})
        if not s['open']: raise HTTPException(404, 'Not found')
        uid = _create(c, body)
        c.execute('UPDATE users SET needs_email_confirm = true WHERE id = %s', (uid,))
        account_email.confirmation(background, c, uid, body.name.strip(), email)
        session = auth.new_session(c, uid, request.headers.get('user-agent'))
    auth.set_cookie(request, response, session)
    return {'ok': True, 'pending': email}
