"""Signing up with an email (#232 D, 2026-10-24): the server owner chooses how new people get in.

KINETTA_SIGNUP: "invite" (the default: invite links only), "waitlist" (the public Join the beta form) or "open" (anyone
can make an account). KINETTA_MAX_ACCOUNTS caps open signup; when it's reached, the form turns into the waitlist.
Invite links from an administrator always work, cap or not. The cap counts every account and is
checked under a table lock, so two people taking the last place at once can't both get in.

A new account works straight away, but stays out of other people's sight (api_social.unconfirmed) until its owner
opens the confirmation link emailed to them. Open signup needs email to be set up, since that link is the check.
"""
import logging, os
from psycopg import Error as DatabaseError
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response
from pydantic import Field, StrictBool
from . import db, auth, account_email
from .api_account import NewAccountIn, _create

router = APIRouter()


def mode():
    m = os.environ.get('KINETTA_SIGNUP', 'invite').strip().lower()
    return m if m in ('invite', 'waitlist', 'open') else 'invite'


def cap():
    try: return max(0, int(os.environ.get('KINETTA_MAX_ACCOUNTS', '')))
    except ValueError: return None


def accounts(c):
    return c.execute('SELECT count(*) AS n FROM users').fetchone()['n']


def social_action(c, uid, kind):
    # Same transaction as the action: cancellation/deletion cannot refund a successful send.
    row = c.execute("SELECT signup_confirmed_at>now()-interval '7 days' AS limited FROM users WHERE id=%s", (uid,)).fetchone()
    if row and row['limited'] and account_email.limited(c, f'new-social:{kind}:{uid}', 10 if kind=='request' else 20, 1440):
        raise HTTPException(429, 'New accounts have a daily limit of 10 friend requests and 20 comments. Try again later.')


def admin_notice(c, *, waitlist_new=False):
    most = cap()
    if not waitlist_new and (most is None or accounts(c)*10 < most*9): return
    # One aggregate bell notice per administrator per rolling day; never email or push.
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended('signup-admin-notice',0))")
    for admin in c.execute('SELECT id FROM users WHERE is_admin AND suspended_at IS NULL ORDER BY id FOR KEY SHARE').fetchall():
        if not c.execute("SELECT 1 FROM notifications WHERE user_id=%s AND kind='signup_admin' AND created>now()-interval '1 day'", (admin['id'],)).fetchone():
            c.execute("INSERT INTO notifications(user_id,kind,actor_id) VALUES(%s,'signup_admin',%s)", (admin['id'],admin['id']))


def capacity_notice(*, waitlist_new=False):
    # Recipient foreign keys must never reverse an account/cap transaction's lock order.
    try:
        with db.connect() as c: admin_notice(c, waitlist_new=waitlist_new)
    except DatabaseError:
        logging.getLogger('uvicorn.error').warning('Sign-up administrator notice unavailable')


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
    return {'open': s['open'], 'full': s['full'], 'iphone_app': account_email.iphone_app()}   # TestFlight link, when published


class SignupIn(NewAccountIn):
    email: str = Field(max_length=120)
    age_ok: StrictBool = False        # "I'm 16 or older" (privacy policy)
    website: str | None = Field(None, max_length=200)     # hidden on the form: people leave it empty, bots fill it
    app: bool = False       # the iPhone app (#232 E): answer with the login token instead of setting a cookie
    card_code: str | None = Field(None,max_length=60)
    card_request: StrictBool = True
    friend_link: str | None = Field(None, max_length=40)    # a friend's invite link this signup came from (2026-10-25)


@router.post('/api/signup')
def signup(body: SignupIn, request: Request, response: Response, background: BackgroundTasks):
    email = account_email._clean_email(body.email)
    if not body.age_ok: raise HTTPException(400, 'Kinetta is for people 16 or older')
    account_email.enrollment_limit(request, email)
    if body.website: return {'ok': True}          # a bot: say nothing useful, make nothing
    # Existing capacity warnings must survive a later full/invalid signup response.
    capacity_notice()
    with db.connect() as c:
        account_email.reservation_lock(c)
        c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')     # the cap holds even for simultaneous signups
        s = state(c)
        if not s['open'] and not s['full']: raise HTTPException(404, 'Not found')
        account_email.require_available(c, email)
        if s['full']: raise HTTPException(409, {'code': 'full', 'message': 'Kinetta is full for now. Join the waitlist and we’ll let you know when there’s room.'})
        uid = _create(c, body)
        c.execute('UPDATE users SET needs_email_confirm = true WHERE id = %s', (uid,))
        # Kept until the email is confirmed (account_email.confirm_email), when the two become friends.
        if body.friend_link: c.execute('UPDATE profile SET friend_link = %s WHERE user_id = %s', (body.friend_link, uid))
        account_email.confirmation(background, c, uid, body.name.strip(), email, welcome=True)
        session = auth.new_session(c, uid, request.headers.get('user-agent'), channel='app' if body.app else 'web', app_version=request.headers.get('x-kinetta-version') if body.app else None)
        login = c.execute('SELECT login::text AS login FROM users WHERE id = %s', (uid,)).fetchone()['login']
    capacity_notice()
    if body.app: return {'ok': True, 'pending': email, 'login': login, 'token': session}
    auth.set_cookie(request, response, session)
    return {'ok': True, 'pending': email, 'login': login}
