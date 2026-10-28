"""Private in-app notifications and native iPhone alerts through APNs.

Rows store relationships and render the current activity/name when read. Native devices are tied to an authenticated
session; logout revokes them. Browser notification delivery has been retired.
"""
import json
import threading
import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .dish_access import NOTICE_VISIBLE
from . import apns, db, reactions
from .auth import current_user, session_token, token_hash, SESSION_DAYS

# A stale or removed source cannot leave a pending private celebration in the bell or on a phone.
NOTICE_VISIBLE += " AND (n.kind<>'milestone' OR EXISTS(SELECT 1 FROM milestones m JOIN milestone_state ms ON ms.user_id=m.user_id WHERE m.id=n.milestone_id AND m.user_id=n.user_id AND m.valid AND NOT m.silent AND ms.generation=ms.processed AND (m.activity_id IS NULL OR EXISTS(SELECT 1 FROM activities ma WHERE ma.id=m.activity_id AND ma.user_id=m.user_id))))"

router = APIRouter(prefix='/api')
KINDS = ('friend_request', 'friend_accepted', 'cheer', 'comment', 'dish_shared', 'activity_ready', 'milestone', 'report')   # report: admins only, in the app only
PUSH_KINDS = {'friends': ('friend_request', 'friend_accepted'), 'cheers': ('cheer',), 'comments': ('comment',), 'dishes': ('dish_shared',), 'activities': ('activity_ready',), 'milestones': ('milestone',)}
MAX_SUBS = 10           # devices per person
AUTO_SOURCES = ('apple', 'healthkit', 'garmin', 'garmin_connect')   # workouts that arrive without the person doing anything


def add(c, user_id, kind, actor_id, activity_id=None, dish_id=None, comment_id=None,reaction_kind=None):
    """Record a notification for user_id (never for your own actions; a repeat within a day isn't recorded twice),
    then push it to their phones in the background."""
    if not user_id or user_id == actor_id or kind not in KINDS: return
    if c.execute('SELECT 1 FROM blocks WHERE (user_id = %s AND blocked = %s) OR (user_id = %s AND blocked = %s)',
                 (user_id, actor_id, actor_id, user_id)).fetchone(): return   # blocked either way: nothing between them
    prior=None
    if kind!='comment':
        prior=c.execute("""SELECT id FROM notifications WHERE user_id=%s AND kind=%s AND actor_id=%s
          AND activity_id IS NOT DISTINCT FROM %s AND dish_id IS NOT DISTINCT FROM %s
          AND created>now()-interval '1 day' ORDER BY id DESC LIMIT 1""",(user_id,kind,actor_id,activity_id,dish_id)).fetchone()
    if prior:
        if kind=='cheer':c.execute('UPDATE notifications SET reaction_kind=%s,cancelled=false WHERE id=%s',(reaction_kind or 'cheer',prior['id']))
        return
    nid=c.execute("""INSERT INTO notifications(user_id,kind,actor_id,activity_id,dish_id,comment_id,reaction_kind)
      VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id""",(user_id,kind,actor_id,activity_id,dish_id,comment_id,reaction_kind if kind=='cheer' else None)).fetchone()['id']
    threading.Thread(target=_push_later, args=(nid,), daemon=True).start()



def activity_loaded(c, user_id, activity_id):
    """Celebrate only a new, completed workout from the last day, privately to its owner.

    Called in the activity's transaction; duplicates/enrichment and old bulk imports stay quiet.
    Lock the activity so concurrent retries cannot create two notifications.
    """
    a = c.execute("""SELECT id FROM activities WHERE id = %s AND user_id = %s AND NOT lift_open
                     AND start_time <= now() AND start_time > now() - interval '1 day'
                     AND start_time + make_interval(secs => coalesce(elapsed_s, moving_s, 0)) <= now() + interval '1 minute'
                     FOR UPDATE""", (activity_id, user_id)).fetchone()
    if not a: return
    p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user_id,)).fetchone() or {}
    if not _prefs(p.get('notify'))['activities']: return      # switched off: no alert and nothing under the bell
    if c.execute("SELECT 1 FROM notifications WHERE user_id = %s AND activity_id = %s AND kind = 'activity_ready'",
                 (user_id, activity_id)).fetchone(): return
    nid = c.execute("""INSERT INTO notifications (user_id, kind, actor_id, activity_id)
                       VALUES (%s, 'activity_ready', %s, %s) RETURNING id""",
                    (user_id, user_id, activity_id)).fetchone()['id']
    threading.Thread(target=_push_later, args=(nid,), daemon=True).start()


def drop(c, user_id, kind, actor_id):
    """A friend request that was cancelled or declined: its notification goes too."""
    c.execute('DELETE FROM notifications WHERE user_id = %s AND kind = %s AND actor_id = %s', (user_id, kind, actor_id))


# ---------- reading: the words are made here ----------
_LIST = """SELECT n.id, n.kind, n.reaction_kind, n.created, n.read_at IS NOT NULL AS read, n.activity_id, n.dish_id, n.user_id,
             u.login::text AS login, u.name, u.photo_v AS photo, a.name AS activity, a.distance_m, a.moving_s, a.elapsed_s, a.sport, a.sport_label, p.units, d.name AS dish, cm.text AS comment
           FROM notifications n JOIN users u ON u.id = n.actor_id LEFT JOIN profile p ON p.user_id = n.user_id
           LEFT JOIN activities a ON a.id = n.activity_id LEFT JOIN dishes d ON d.id = n.dish_id LEFT JOIN comments cm ON cm.id = n.comment_id"""


def _words(r):
    if r['kind']=='milestone':return 'A milestone is ready to review', '/me/milestones'
    who, act = r['name'], r['activity'] or 'activity'
    if r['kind'] == 'activity_ready':
        return f"Nice work! {act} saved — {_activity_summary(r)}", f"/activity/{r['activity_id']}"
    if r['kind'] == 'friend_request': return f'{who} wants to be friends', '/me/friends'
    if r['kind'] == 'friend_accepted': return f'{who} accepted your friend request', '/activity'
    if r['kind']=='cheer':
        label='cheers' if r.get('reaction_kind') in (None,'cheer') else reactions.LABELS[r['reaction_kind']]
        return f"{who} sent {label} on your {act}",f"/activity/{r['activity_id']}"
    if r['kind'] == 'comment':
        snip = (r['comment'] or '').strip()
        return f'{who} commented on your {act}' + (f': "{snip[:80]}{"…" if len(snip) > 80 else ""}"' if snip else ''), f"/activity/{r['activity_id']}"
    if r['kind'] == 'report': return f'{who} reported something for the admins to look at', '/me/people'
    return f"{who} shared {r['dish'] or 'a meal'} with you", f"/food/cook/{r['dish_id']}"



def _activity_summary(r):
    """Deterministic lock-screen summary in the person's chosen units; no AI calls."""
    parts = []
    if r.get('distance_m'):
        metric = r.get('units') == 'metric'
        distance = r['distance_m'] / (1000 if metric else 1609.344)
        parts.append(f"{distance:.2f} {'km' if metric else 'mi'}")
    seconds = r.get('moving_s') or r.get('elapsed_s')
    if seconds:
        minutes = max(1, round(seconds / 60))
        hours, mins = divmod(minutes, 60)
        parts.append(f'{hours} h {mins} min' if hours and mins else f'{hours} h' if hours else f'{mins} min')
    return ' · '.join(parts) or 'workout saved'


def _item(r):
    text, link = _words(r)
    return {'id': r['id'], 'kind': r['kind'], 'text': text, 'link': link, 'created': r['created'], 'read': r['read'],
            'who': {'login': r['login'], 'name': r['name'], 'photo': r['photo']}}


def unread(c, uid):
    return c.execute('SELECT count(*) AS n FROM notifications n WHERE n.user_id = %s AND n.read_at IS NULL AND '+NOTICE_VISIBLE, (uid,)).fetchone()['n']


@router.get('/notifications')
def notifications(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute(_LIST + ' WHERE n.user_id = %s AND '+NOTICE_VISIBLE+' ORDER BY n.created DESC, n.id DESC LIMIT 60', (user['id'],)).fetchall()
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
        n = unread(c, user['id'])
    return {'items': [_item(r) for r in rows], 'unread': n, 'push': _prefs(p.get('notify')), 'push_ready': apns.ready()}


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
    return {k: bool((v or {}).get(k, k!='milestones')) for k in PUSH_KINDS}


# Older app copies get an explicit retirement response; no browser endpoint sends traffic.
@router.get('/push/key')
@router.post('/push/subscribe')
def browser_retired(user=Depends(current_user)):
    raise HTTPException(410, 'Phone notifications are now available only in the native iPhone app')


@router.post('/push/unsubscribe')
def browser_unsubscribe(user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM push_subscriptions WHERE user_id = %s', (user['id'],))
    return {'ok': True}


class DeviceIn(BaseModel):
    token: str = Field(min_length=64, max_length=200, pattern=r'^[0-9a-f]+$')
    environment: str = Field(pattern=r'^(production|sandbox)$')


def native_session(request):
    if not request.headers.get('authorization', '').lower().startswith('bearer '):
        raise HTTPException(400, 'Register notifications from the native iPhone app')
    return token_hash(session_token(request) or '')


@router.post('/push/ios')
def native_subscribe(body: DeviceIn, request: Request, user=Depends(current_user)):
    session = native_session(request)
    with db.connect() as c:
        # One installation moves to the current person on login; it cannot keep delivering to the previous account.
        c.execute("""INSERT INTO native_push_devices (token, environment, user_id, session_hash)
                     VALUES (%s, %s, %s, %s) ON CONFLICT (token, environment)
                     DO UPDATE SET user_id = excluded.user_id, session_hash = excluded.session_hash, created = now()""",
                  (body.token, body.environment, user['id'], session))
        c.execute("""DELETE FROM native_push_devices WHERE user_id = %s AND (token, environment) NOT IN
                     (SELECT token, environment FROM native_push_devices WHERE user_id = %s ORDER BY created DESC LIMIT %s)""",
                  (user['id'], user['id'], MAX_SUBS))
    return {'ok': True}


@router.delete('/push/ios')
def native_unsubscribe(request: Request, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('DELETE FROM native_push_devices WHERE user_id = %s AND session_hash = %s', (user['id'], native_session(request)))
    return {'ok': True}


class PrefsIn(BaseModel):
    friends: bool | None = None
    cheers: bool | None = None
    comments: bool | None = None
    dishes: bool | None = None
    activities: bool | None = None
    milestones: bool | None = None


@router.put('/notifications/settings')
def settings(body: PrefsIn, user=Depends(current_user)):
    v = {k: x for k, x in body.model_dump().items() if x is not None}
    with db.connect() as c:
        c.execute("UPDATE profile SET notify = coalesce(notify, '{}') || %s::jsonb WHERE user_id = %s", (json.dumps(v), user['id']))
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
    return {'push': _prefs(p.get('notify'))}


def _push_words(r):
    """Keep long activity/person text in the multiline body, not iOS's short title."""
    text,_=_words(r)
    titles={'friend_request':'Friend request','friend_accepted':'Friend request accepted',
            'cheer':'New reaction','comment':'New comment','dish_shared':'Meal shared',
            'activity_ready':'Workout saved','milestone':'Milestone'}
    if r['kind']=='activity_ready':
        return 'Workout saved', f"{r['activity'] or 'Your workout'}\n{_activity_summary(r)}"
    if r['kind']=='comment':
        lead=f"{r['name']} commented on your {r['activity'] or 'activity'}"
        return 'New comment', lead+(f"\n{r['comment'].strip()}" if r.get('comment') else '')
    return titles.get(r['kind'],'Kinetta'),text


def _push_later(nid):
    import time
    for _ in range(10):        # started before the change is committed: wait until the notification can be read
        time.sleep(0.5)
        try:
            if push(nid) is not None: return
        except Exception as e:
            print('push failed', nid, type(e).__name__, flush=True); return


def push(nid, send=None):
    """Deliver only to native iPhone registrations. `send(device, payload)` replaces APNs in tests."""
    if not send and not apns.ready(): return 0
    with db.connect() as c:
        r = c.execute(_LIST + ' WHERE n.id = %s AND '+NOTICE_VISIBLE, (nid,)).fetchone()
        if not r: return None
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (r['user_id'],)).fetchone() or {}
        want = _prefs(p.get('notify'))
        if not any(want[g] for g, kinds in PUSH_KINDS.items() if r['kind'] in kinds): return 0
        badge = unread(c, r['user_id'])
    text, link = _words(r)
    title, body = _push_words(r)
    payload = {'title': title[:180], 'body': body[:600], 'url': link, 'badge': badge, 'tag': f"{r['kind']}-{nid}"}
    def prepare(c):
        fresh=c.execute(_LIST+' WHERE n.id=%s AND '+NOTICE_VISIBLE,(nid,)).fetchone()
        if not fresh:return None
        prefs=c.execute('SELECT notify FROM profile WHERE user_id=%s',(r['user_id'],)).fetchone() or {}
        if not any(_prefs(prefs.get('notify'))[g] for g,kinds in PUSH_KINDS.items() if fresh['kind'] in kinds):return None
        title,body=_push_words(fresh)
        return {**payload,'title':title[:180],'body':body[:600]}
    return _deliver_native(r['user_id'],payload,prepare,send)


def _deliver_native(uid,payload,prepare,send):
    """One shared device/session/transfer/token-removal boundary for native pushes."""
    with db.connect() as c:subs=c.execute('SELECT token,environment FROM native_push_devices WHERE user_id=%s',(uid,)).fetchall()
    count=0
    for device in subs:
        with db.connect() as c:
            current=c.execute(f"""SELECT d.* FROM native_push_devices d JOIN sessions s ON s.token_hash=d.session_hash
              WHERE d.token=%s AND d.environment=%s AND d.user_id=%s AND s.user_id=d.user_id
              AND s.last_seen>now()-interval '{SESSION_DAYS} days' FOR UPDATE OF d""",(device['token'],device['environment'],uid)).fetchone()
            if not current:continue
            ready=prepare(c)
            if ready is None:continue
            try:
                accepted=send(device,ready) if send else apns.deliver(device,ready)
                if accepted is False:c.execute('DELETE FROM native_push_devices WHERE token=%s AND environment=%s',(device['token'],device['environment']))
                else:count+=1
            except Exception as error:print('native push failed',type(error).__name__,flush=True)
    return count


def private_meal_push(uid,day,meal,payload,send=None):
    """Private nudge with a final non-locking preference/date/meal check per device."""
    if send is None and not apns.ready():return 0
    def prepare(c):
        p=c.execute("""SELECT tz FROM profile WHERE user_id=%s AND food_reminders
          AND NOT EXISTS(SELECT 1 FROM food_entries WHERE user_id=%s AND day=%s AND meal=%s)
          AND EXISTS(SELECT 1 FROM meal_reminder_attempts WHERE user_id=%s AND day=%s AND meal=%s AND attempted_at>now()-interval '5 minutes')""",(uid,uid,day,meal,uid,day,meal)).fetchone()
        if not p:return None
        local=dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo(db.valid_tz(p['tz']) or db.DEFAULT_TZ))
        if local.date()!=day or not 7<=local.hour<21:return None
        return {**payload,'badge':unread(c,uid),'expires_at':int(dt.datetime.now(dt.timezone.utc).timestamp())+300}
    return _deliver_native(uid,payload,prepare,send)
