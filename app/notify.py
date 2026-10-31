"""Private in-app notifications and native iPhone alerts through APNs.

Rows store relationships and render the current activity/name when read. Native devices are tied to an authenticated
session; logout revokes them. Browser notification delivery has been retired.
"""
import json
import logging
from collections import Counter
import threading
import datetime as dt
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .dish_access import NOTICE_VISIBLE
from . import apns, db, notification_words, notification_facts
from .auth import current_user, session_token, token_hash, SESSION_DAYS

# A stale or removed source cannot leave a pending private celebration in the bell or on a phone.
NOTICE_VISIBLE += " AND (n.kind<>'milestone' OR EXISTS(SELECT 1 FROM milestones m JOIN milestone_state ms ON ms.user_id=m.user_id WHERE m.id=n.milestone_id AND m.user_id=n.user_id AND m.valid AND NOT m.silent AND ms.generation=ms.processed AND (m.activity_id IS NULL OR EXISTS(SELECT 1 FROM activities ma WHERE ma.id=m.activity_id AND ma.user_id=m.user_id))))"

NOTICE_VISIBLE += " AND (n.challenge_id IS NULL OR EXISTS(SELECT 1 FROM challenges cq JOIN users cu ON cu.id=cq.user_id JOIN challenge_members cv ON cv.challenge_id=cq.id AND cv.user_id=n.user_id AND cv.status='active' JOIN challenge_members ca ON ca.challenge_id=cq.id AND ca.user_id=n.actor_id AND ca.status='active' WHERE cq.id=n.challenge_id AND NOT cu.needs_email_confirm AND cu.suspended_at IS NULL))"

NOTICE_VISIBLE += " AND (n.kind<>'activity_ready' OR EXISTS(SELECT 1 FROM activities own WHERE own.id=n.activity_id AND own.user_id=n.user_id))"

router = APIRouter(prefix='/api')
KINDS = ('friend_request', 'friend_accepted', 'cheer', 'comment', 'dish_shared', 'activity_ready', 'milestone','challenge_join','challenge_reminder','challenge_finished', 'report')   # report: admins only, in the app only
PUSH_KINDS = {'friends': ('friend_request', 'friend_accepted'), 'cheers': ('cheer',), 'comments': ('comment',), 'dishes': ('dish_shared',), 'activities': ('activity_ready',), 'milestones': ('milestone',),'challenge_joins':('challenge_join',),'challenge_reminders':('challenge_reminder',),'challenge_finished':('challenge_finished',)}
log = logging.getLogger('uvicorn.error')
CATCH_UP_KINDS = ('friend_request', 'friend_accepted', 'comment', 'cheer')
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
_LIST = """SELECT n.id, n.kind, n.reaction_kind, n.created, n.read_at IS NOT NULL AS read, n.activity_id, n.dish_id, n.user_id,n.challenge_id,q.code AS challenge_code,
             u.login::text AS login, u.name, u.photo_v AS photo, recipient.name AS recipient_name,
             a.name AS activity, a.user_id AS activity_owner, a.updated, a.start_time, a.lift_open, a.distance_m, a.moving_s, a.elapsed_s, a.sport, a.sub_sport, a.sport_label,
             (a.sport='workout' AND EXISTS(SELECT 1 FROM lift_sets ls WHERE ls.activity_id=a.id AND ls.user_id=n.user_id)) AS has_lifts,
             p.units, p.tz, ms.generation, m.title AS milestone_title, d.name AS dish, cm.text AS comment
           FROM notifications n JOIN users u ON u.id = n.actor_id LEFT JOIN profile p ON p.user_id = n.user_id
           JOIN users recipient ON recipient.id=n.user_id LEFT JOIN milestone_state ms ON ms.user_id=n.user_id
           LEFT JOIN milestones m ON m.id=n.milestone_id AND m.user_id=n.user_id AND m.valid
           LEFT JOIN activities a ON a.id = n.activity_id LEFT JOIN dishes d ON d.id = n.dish_id LEFT JOIN comments cm ON cm.id = n.comment_id LEFT JOIN challenges q ON q.id=n.challenge_id"""


def _words(r):
    if r['kind']=='milestone':return notification_words.clean(r.get('milestone_title') or 'A milestone is ready to review',100), '/me/milestones'
    if r['kind'].startswith('challenge_'):
        text={'challenge_join':'@'+r['login']+' joined your challenge','challenge_reminder':'Three days left in your challenge','challenge_finished':'Your challenge finish picture is ready'}[r['kind']]
        return text,'/me/challenges/'+r['challenge_code']
    who, act = notification_words.clean(r['name'],40), notification_words.clean(r['activity'] or 'activity',90)
    if r['kind'] == 'activity_ready':
        title,body=notification_words.activity(r)
        return title+' · '+body, f"/activity/{r['activity_id']}?edit=1"
    if r['kind'] == 'friend_request': return f'{who} wants to be friends', '/me/friends'
    if r['kind'] == 'friend_accepted': return f'You and {who} are now friends', '/activity'
    if r['kind']=='cheer':
        action={'cheer':'cheered','applause':'applauded','strong':'sent Strong for'}.get(r.get('reaction_kind') or 'cheer','cheered')
        return f"{who} {action} your {act}",f"/activity/{r['activity_id']}"
    if r['kind'] == 'comment':
        snip = notification_words.clean(r['comment'],80)
        return f'{who} commented on your {act}' + (f': "{snip}"' if snip else ''), f"/activity/{r['activity_id']}"
    if r['kind'] == 'report': return f'{who} reported something for the admins to look at', '/me/people'
    return f"{who} shared {r['dish'] or 'a meal'} with you", f"/food/cook/{r['dish_id']}"



def _item(r):
    text, link = _words(r)
    if r['kind'].startswith('challenge_'):r={**r,'name':'@'+r['login']}
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
    from .api_social import waiting, _friend_rows
    with db.connect() as c:
        return {'unread': unread(c, user['id']), 'friend_requests': waiting(c, user['id']), 'friend_count':sum(r['status']=='accepted' for r in _friend_rows(c,user['id']))}


@router.post('/notifications/read')
def notifications_read(user=Depends(current_user)):
    with db.connect() as c:
        c.execute('UPDATE notifications SET read_at = now() WHERE user_id = %s AND read_at IS NULL', (user['id'],))
    return {'unread': 0}


# ---------- phone notifications (Web Push) ----------
def _prefs(v):
    return {k: bool((v or {}).get(k, k not in ('milestones','challenge_joins','challenge_reminders','challenge_finished'))) for k in PUSH_KINDS}


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
        _push_lock(c, user['id'])
        # One installation moves to the current person on login; it cannot keep delivering to the previous account.
        c.execute("""INSERT INTO native_push_devices (token, environment, user_id, session_hash)
                     VALUES (%s, %s, %s, %s) ON CONFLICT (token, environment)
                     DO UPDATE SET user_id = excluded.user_id, session_hash = excluded.session_hash, created = now()""",
                  (body.token, body.environment, user['id'], session))
        c.execute("""DELETE FROM native_push_devices WHERE user_id = %s AND (token, environment) NOT IN
                     (SELECT token, environment FROM native_push_devices WHERE user_id = %s ORDER BY created DESC LIMIT %s)""",
                  (user['id'], user['id'], MAX_SUBS))
    _catch_up(user['id'])
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
    challenge_joins: bool | None = None
    challenge_reminders: bool | None = None
    challenge_finished: bool | None = None


@router.put('/notifications/settings')
def settings(body: PrefsIn, user=Depends(current_user)):
    v = {k: x for k, x in body.model_dump().items() if x is not None}
    with db.connect() as c:
        c.execute("UPDATE profile SET notify = coalesce(notify, '{}') || %s::jsonb WHERE user_id = %s", (json.dumps(v), user['id']))
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
    return {'push': _prefs(p.get('notify'))}


def _push_words(r, facts=None):
    """Keep long activity/person text in the multiline body, not iOS's short title."""
    text,_=_words(r)
    titles={'friend_request':'Friend request','friend_accepted':'You’re now friends',
            'cheer':'New reaction','comment':'New comment','dish_shared':'Meal shared',
            'activity_ready':'Workout saved','milestone':'Milestone'}
    if r['kind']=='activity_ready':
        return notification_words.activity(r,facts)
    if r['kind']=='comment':
        lead=f"{notification_words.clean(r['name'],40)} commented on your {notification_words.clean(r['activity'] or 'activity',90)}"
        return 'New comment', lead+(f"\n{notification_words.clean(r['comment'],450)}" if r.get('comment') else '')
    return titles.get(r['kind'],'Kinetta'),text


def _push_log(kind, reason, devices, accepted=0):
    # Only fixed kinds/reasons and counts: exception messages can contain token URLs or private text.
    kind = kind if kind in (*KINDS, 'meal', 'plan', 'weekly') else 'unknown'
    if reason:
        log.info('push skipped: kind=%s reason=%s devices=%d', kind, reason, devices)
    else:
        log.info('push accepted: kind=%s devices=%d accepted=%d', kind, devices, accepted)


def log_unconfigured(uid, kind):
    with db.connect() as c:
        devices = c.execute('SELECT count(*) AS n FROM native_push_devices WHERE user_id=%s', (uid,)).fetchone()['n']
    _push_log(kind, 'apns_not_configured', devices)


def _push_lock(c, uid):
    # Order delivery and device registration so a replacement cannot miss the retired-token mark.
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended('native-push:'||%s::text,0))", (uid,))


def _push_later(nid):
    import time
    for _ in range(10):        # wait for the notification's creating transaction to commit
        time.sleep(0.5)
        try:
            with db.connect() as c:
                exists = c.execute('SELECT kind FROM notifications WHERE id=%s', (nid,)).fetchone()
            if not exists: continue
            push(nid)
            return
        except Exception as error:
            _push_log('unknown', 'send_error:'+type(error).__name__, 0)
            return


class _DeliveryCount(int):
    def __new__(cls, accepted, all_retired=False):
        result = super().__new__(cls, accepted)
        result.all_retired = all_retired
        return result


def push(nid, send=None, *, catchup=False):
    """Deliver native alerts; catchup is a previously claimed, recent unread social notice."""
    with db.connect() as c:
        row = c.execute(_LIST+' WHERE n.id=%s', (nid,)).fetchone()
        if not row: return None
        # Optional history reads happen once, before the user's delivery lock and
        # every device/session row lock. A fresh generation check discards stale facts.
        can_highlight=row['kind']=='activity_ready' and (send is not None or apns.ready())
        has_device=can_highlight and c.execute('SELECT 1 FROM native_push_devices WHERE user_id=%s LIMIT 1',(row['user_id'],)).fetchone()
        facts=notification_facts.read(c,row) if has_device else None
        stamp=notification_facts.signature(row) if facts else None
        if facts:
            after=c.execute(_LIST+' WHERE n.id=%s AND '+NOTICE_VISIBLE,(nid,)).fetchone()
            if stamp!=notification_facts.signature(after):facts=None;stamp=None
        _push_lock(c, row['user_id'])
        return _push(c, nid, send, catchup, facts, stamp)


def _push(c, nid, send, catchup, facts=None, stamp=None):
    row = c.execute('SELECT kind,user_id FROM notifications WHERE id=%s', (nid,)).fetchone()
    if not row: return None
    uid, kind = row['user_id'], row['kind']
    devices = c.execute('SELECT count(*) AS n FROM native_push_devices WHERE user_id=%s', (uid,)).fetchone()['n']
    eligible = " AND n.read_at IS NULL AND n.created>now()-interval '10 minutes'" if catchup else ''
    def prepare(conn):
        fresh = conn.execute(_LIST+' WHERE n.id=%s AND '+NOTICE_VISIBLE+eligible, (nid,)).fetchone()
        if not fresh or (catchup and fresh['kind'] not in CATCH_UP_KINDS):
            prepare.reason = 'not_visible'
            return None
        prefs = conn.execute('SELECT notify FROM profile WHERE user_id=%s', (uid,)).fetchone() or {}
        if not any(_prefs(prefs.get('notify'))[g] for g,kinds in PUSH_KINDS.items() if fresh['kind'] in kinds):
            prepare.reason = 'preference_off'
            return None
        current_facts=facts if stamp is not None and stamp==notification_facts.signature(fresh) else None
        title, body = _push_words(fresh,current_facts)
        _, link = _words(fresh)
        return {'title':title[:180], 'body':body[:600], 'url':link, 'badge':unread(conn,uid), 'tag':f'{kind}-{nid}'}
    prepare.kind = kind
    payload = prepare(c)
    if payload is None:
        _push_log(kind, prepare.reason, devices)
        return None if prepare.reason == 'not_visible' else 0
    if send is None and not apns.ready():
        _push_log(kind, 'apns_not_configured', devices)
        return 0
    result = _deliver_native(uid, payload, prepare, send)
    if result:
        c.execute('UPDATE notifications SET push_pending=false WHERE id=%s AND user_id=%s', (nid,uid))
    elif not catchup and kind in CATCH_UP_KINDS and getattr(result, 'all_retired', False):
        c.execute('UPDATE notifications SET push_pending=true WHERE id=%s AND user_id=%s', (nid,uid))
    return int(result)


def _catch_up(uid, send=None):
    # Claim durably BEFORE APNs: parallel/repeated registrations and a crash after acceptance cannot resend it.
    with db.connect() as c:
        _push_lock(c, uid)
        rows = c.execute('UPDATE notifications SET push_pending=false WHERE user_id=%s AND push_pending RETURNING id', (uid,)).fetchall()
    for row in rows:
        try: push(row['id'], send=send, catchup=True)
        except Exception as error: _push_log('unknown', 'send_error:'+type(error).__name__, 0)


def _deliver_native(uid,payload,prepare,send):
    """One shared device/session/transfer/token-removal boundary for native pushes."""
    kind = getattr(prepare, 'kind', payload.get('tag', '').split('-')[0])
    with db.connect() as c:subs=c.execute('SELECT token,environment FROM native_push_devices WHERE user_id=%s',(uid,)).fetchall()
    count, reasons = 0, Counter()
    if not subs: reasons['no_device'] += 1
    for device in subs:
        with db.connect() as c:
            current=c.execute(f"""SELECT d.* FROM native_push_devices d JOIN sessions s ON s.token_hash=d.session_hash
              WHERE d.token=%s AND d.environment=%s AND d.user_id=%s AND s.user_id=d.user_id
              AND s.last_seen>now()-interval '{SESSION_DAYS} days' FOR UPDATE OF d""",(device['token'],device['environment'],uid)).fetchone()
            if not current:
                reasons['no_current_session'] += 1
                continue
            ready=prepare(c)
            if ready is None:
                reasons[getattr(prepare, 'reason', 'not_visible')] += 1
                continue
            try:
                accepted=send(device,ready) if send else apns.deliver(device,ready)
                if accepted is False:
                    c.execute('DELETE FROM native_push_devices WHERE token=%s AND environment=%s',(device['token'],device['environment']))
                    reasons['token_retired'] += 1
                else:count+=1
            except Exception as error:reasons['send_error:'+type(error).__name__] += 1
    for reason in reasons: _push_log(kind, reason, len(subs))
    if count: _push_log(kind, None, len(subs), count)
    return _DeliveryCount(count, bool(subs) and reasons == {'token_retired':len(subs)})


def private_meal_push(uid,day,meal,payload,send=None):
    """Private nudge with a final non-locking preference/date/meal check per device."""
    if send is None and not apns.ready():
        log_unconfigured(uid, 'meal')
        return 0
    def prepare(c):
        p=c.execute("""SELECT tz FROM profile WHERE user_id=%s AND food_reminders
          AND NOT EXISTS(SELECT 1 FROM food_entries WHERE user_id=%s AND day=%s AND meal=%s)
          AND EXISTS(SELECT 1 FROM meal_reminder_attempts WHERE user_id=%s AND day=%s AND meal=%s AND attempted_at>now()-interval '5 minutes')""",(uid,uid,day,meal,uid,day,meal)).fetchone()
        if not p:return None
        local=dt.datetime.now(dt.timezone.utc).astimezone(ZoneInfo(db.valid_tz(p['tz']) or db.DEFAULT_TZ))
        if local.date()!=day or not 7<=local.hour<21:return None
        return {**payload,'badge':unread(c,uid),'expires_at':int(dt.datetime.now(dt.timezone.utc).timestamp())+300}
    prepare.kind = 'meal'
    return _deliver_native(uid,payload,prepare,send)
