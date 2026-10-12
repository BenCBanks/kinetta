"""Notifications (2026-10-11): a list in the app (Me > Notifications, a number on the Me tab) for friend requests,
accepted requests, cheers, comments and shared dishes, and the same as phone notifications through Web Push when the
person turns them on (browsers, and the app added to an iPhone's home screen on iOS 16.4+).

- A notification row stores only who did what to which of your things; the words are put together when the list is
  read, so a renamed activity or a deleted comment shows correctly (deleted things take their notifications with them).
- Web Push needs a key pair for this server (VAPID). It's made on first use and kept in server_keys (no SQL login can
  read it). The push message holds the same short text as the list, so lock screens show "Sam sent cheers on your Morning Run".
- Push is sent from a background thread after the change is saved; a subscription the browser has dropped (404/410)
  is deleted.
"""
import json
from urllib.parse import urlsplit
import os
import threading

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from . import db
from .auth import current_user

router = APIRouter(prefix='/api')
KINDS = ('friend_request', 'friend_accepted', 'cheer', 'comment', 'dish_shared', 'report')   # report: admins only, in the app only
PUSH_KINDS = {'friends': ('friend_request', 'friend_accepted'), 'cheers': ('cheer',), 'comments': ('comment',), 'dishes': ('dish_shared',)}
MAX_SUBS = 10           # devices per person
_keys = {}
_lock = threading.Lock()


def add(c, user_id, kind, actor_id, activity_id=None, dish_id=None, comment_id=None):
    """Record a notification for user_id (never for your own actions; a repeat within a day isn't recorded twice),
    then push it to their phones in the background."""
    if not user_id or user_id == actor_id or kind not in KINDS: return
    if c.execute('SELECT 1 FROM blocks WHERE (user_id = %s AND blocked = %s) OR (user_id = %s AND blocked = %s)',
                 (user_id, actor_id, actor_id, user_id)).fetchone(): return   # blocked either way: nothing between them
    if kind != 'comment' and c.execute("""SELECT 1 FROM notifications WHERE user_id = %s AND kind = %s AND actor_id = %s
                                            AND activity_id IS NOT DISTINCT FROM %s AND dish_id IS NOT DISTINCT FROM %s
                                            AND created > now() - interval '1 day'""",
                                       (user_id, kind, actor_id, activity_id, dish_id)).fetchone():
        return
    nid = c.execute("""INSERT INTO notifications (user_id, kind, actor_id, activity_id, dish_id, comment_id)
                       VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""", (user_id, kind, actor_id, activity_id, dish_id, comment_id)).fetchone()['id']
    threading.Thread(target=_push_later, args=(nid,), daemon=True).start()


def drop(c, user_id, kind, actor_id):
    """A friend request that was cancelled or declined: its notification goes too."""
    c.execute('DELETE FROM notifications WHERE user_id = %s AND kind = %s AND actor_id = %s', (user_id, kind, actor_id))


# ---------- reading: the words are made here ----------
_LIST = """SELECT n.id, n.kind, n.created, n.read_at IS NOT NULL AS read, n.activity_id, n.dish_id, n.user_id,
             u.login::text AS login, u.name, a.name AS activity, d.name AS dish, cm.text AS comment
           FROM notifications n JOIN users u ON u.id = n.actor_id
           LEFT JOIN activities a ON a.id = n.activity_id LEFT JOIN dishes d ON d.id = n.dish_id LEFT JOIN comments cm ON cm.id = n.comment_id"""


def _words(r):
    who, act = r['name'], r['activity'] or 'activity'
    if r['kind'] == 'friend_request': return f'{who} wants to be friends', '/me/friends'
    if r['kind'] == 'friend_accepted': return f'{who} accepted your friend request', '/activity'
    if r['kind'] == 'cheer': return f'{who} sent cheers on your {act}', f"/activity/{r['activity_id']}"
    if r['kind'] == 'comment':
        snip = (r['comment'] or '').strip()
        return f'{who} commented on your {act}' + (f': "{snip[:80]}{"…" if len(snip) > 80 else ""}"' if snip else ''), f"/activity/{r['activity_id']}"
    if r['kind'] == 'report': return f'{who} reported something for the admins to look at', '/me/people'
    return f"{who} shared {r['dish'] or 'a dish'} with you", f"/food/cook/{r['dish_id']}"


def _item(r):
    text, link = _words(r)
    return {'id': r['id'], 'kind': r['kind'], 'text': text, 'link': link, 'created': r['created'], 'read': r['read'],
            'who': {'login': r['login'], 'name': r['name']}}


def unread(c, uid):
    return c.execute('SELECT count(*) AS n FROM notifications WHERE user_id = %s AND read_at IS NULL', (uid,)).fetchone()['n']


@router.get('/notifications')
def notifications(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute(_LIST + ' WHERE n.user_id = %s ORDER BY n.created DESC, n.id DESC LIMIT 60', (user['id'],)).fetchall()
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
        n = unread(c, user['id'])
    return {'items': [_item(r) for r in rows], 'unread': n, 'push': _prefs(p.get('notify')), 'push_ready': bool(_vapid())}


@router.get('/notifications/count')
def notifications_count(user=Depends(current_user)):
    """For the number on the Me tab (checked at most once a minute)."""
    from .api_social import waiting
    with db.connect() as c:
        return {'unread': unread(c, user['id']), 'friend_requests': waiting(c, user['id'])}


@router.post('/notifications/read')
def notifications_read(user=Depends(current_user)):
    with db.connect() as c:
        c.execute('UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL', (user['id'],))
    return {'unread': 0}


# ---------- phone notifications (Web Push) ----------
def _prefs(v):
    return {k: bool((v or {}).get(k, True)) for k in PUSH_KINDS}


def _vapid():
    """This server's push key pair (made once, kept in server_keys). None if pywebpush isn't installed."""
    if 'v' in _keys: return _keys['v']
    try:
        from py_vapid import Vapid02, b64urlencode
        from cryptography.hazmat.primitives import serialization
    except ImportError:
        _keys['v'] = None; return None
    with _lock, db.connect() as c:
        r = c.execute("SELECT value FROM server_keys WHERE name = 'vapid'").fetchone()
        if r: v = Vapid02.from_pem(r['value'].encode())
        else:
            v = Vapid02(); v.generate_keys()
            c.execute("INSERT INTO server_keys (name, value) VALUES ('vapid', %s) ON CONFLICT (name) DO NOTHING", (v.private_pem().decode(),))
            v = Vapid02.from_pem(c.execute("SELECT value FROM server_keys WHERE name = 'vapid'").fetchone()['value'].encode())
    pub = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    _keys['v'] = (v, b64urlencode(pub))
    return _keys['v']


@router.get('/push/key')
def push_key(user=Depends(current_user)):
    k = _vapid()
    if not k: raise HTTPException(404, 'Phone notifications are not available on this server')
    return {'key': k[1]}


# Where a phone's notifications may be delivered (2026-10-12 review): only the real push services. Any other https
# address would have the server send requests wherever a logged-in person pointed it, even inside the house network.
PUSH_HOSTS = ('fcm.googleapis.com', 'android.googleapis.com', 'push.apple.com', 'updates.push.services.mozilla.com',
              'push.services.mozilla.com', 'notify.windows.com')


def push_host_ok(url):
    try: u = urlsplit(url)
    except ValueError: return False
    host = (u.hostname or '').lower()
    return (u.scheme == 'https' and u.port in (None, 443) and not u.username and not u.password
            and any(host == h or host.endswith('.' + h) for h in PUSH_HOSTS))


class SubIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000, pattern=r'^https://')
    keys: dict


@router.post('/push/subscribe')
def subscribe(body: SubIn, user=Depends(current_user)):
    if not push_host_ok(body.endpoint): raise HTTPException(400, "That isn't a phone notification service this server sends to")
    p256, auth = body.keys.get('p256dh'), body.keys.get('auth')
    if not (isinstance(p256, str) and isinstance(auth, str) and 20 <= len(p256) <= 200 and 8 <= len(auth) <= 100):
        raise HTTPException(400, 'Not a push subscription')
    with db.connect() as c:
        # the same phone, logged in as someone else now: it moves to this person
        c.execute("""INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES (%s, %s, %s, %s)
                     ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created = now()""",
                  (user['id'], body.endpoint, p256, auth))
        c.execute("""DELETE FROM push_subscriptions WHERE user_id = %s AND id NOT IN (
                       SELECT id FROM push_subscriptions WHERE user_id = %s ORDER BY created DESC LIMIT %s)""", (user['id'], user['id'], MAX_SUBS))
    return {'ok': True}


class UnsubIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000)


@router.post('/push/unsubscribe')
def unsubscribe(body: UnsubIn, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM push_subscriptions WHERE user_id = %s AND endpoint = %s', (user['id'], body.endpoint))
    return {'ok': True}


class PrefsIn(BaseModel):
    friends: bool | None = None
    cheers: bool | None = None
    comments: bool | None = None
    dishes: bool | None = None


@router.put('/notifications/settings')
def settings(body: PrefsIn, user=Depends(current_user)):
    v = {k: x for k, x in body.model_dump().items() if x is not None}
    with db.connect() as c:
        c.execute("UPDATE profile SET notify = coalesce(notify, '{}') || %s::jsonb WHERE user_id = %s", (json.dumps(v), user['id']))
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
    return {'push': _prefs(p.get('notify'))}


def _push_later(nid):
    import time
    for _ in range(10):        # started before the change is committed: wait until the notification can be read
        time.sleep(0.5)
        try:
            if push(nid) is not None: return
        except Exception as e:
            print('push failed', nid, e, flush=True); return


def push(nid, send=None):
    """Send notification nid to the person's phones, if they want this kind. Returns how many were sent (None: not found yet).
    `send` replaces the network call in tests."""
    k = _vapid()
    if not k and not send: return 0
    with db.connect() as c:
        r = c.execute(_LIST + ' WHERE n.id = %s', (nid,)).fetchone()
        if not r: return None             # not committed yet (or deleted)
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (r['user_id'],)).fetchone() or {}
        want = _prefs(p.get('notify'))
        if not any(want[g] for g, kinds in PUSH_KINDS.items() if r['kind'] in kinds): return 0
        subs = c.execute('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = %s', (r['user_id'],)).fetchall()
        badge = unread(c, r['user_id'])
    text, link = _words(r)
    data = json.dumps({'title': 'Kinetta', 'body': text, 'url': link, 'badge': badge, 'tag': f"{r['kind']}-{nid}"})
    sent, gone = 0, []
    for s in subs:
        if not send and not push_host_ok(s['endpoint']): gone.append(s['id']); continue    # saved before the check: dropped
        info = {'endpoint': s['endpoint'], 'keys': {'p256dh': s['p256dh'], 'auth': s['auth']}}
        try:
            if send: send(info, data)
            else:
                from pywebpush import WebPushException, webpush
                try:
                    webpush(info, data, vapid_private_key=k[0], ttl=86400, timeout=10,
                            vapid_claims={'sub': os.environ.get('KINETTA_PUSH_CONTACT') or os.environ.get('KINETTA_PUBLIC_URL') or 'https://kinetta.app'})
                except WebPushException as e:
                    if e.response is not None and e.response.status_code in (404, 410): gone.append(s['id']); continue
                    raise
            sent += 1
        except Exception as e:
            print('push to one device failed', e, flush=True)
    if gone:
        with db.connect() as c: c.execute('DELETE FROM push_subscriptions WHERE id = ANY(%s)', (gone,))
    return sent
