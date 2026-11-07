"""Private in-app notifications and native iPhone alerts through APNs.

Rows store relationships and render the current activity/name when read. Native devices are tied to an authenticated
session; logout revokes them. Browser notification delivery has been retired.
"""
import json
import logging
from collections import Counter
import threading
import datetime as dt
import re
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .dish_access import NOTICE_VISIBLE
from . import apns, db, notification_words, notification_facts, reactions
from .auth import current_user, session_token, token_hash, SESSION_DAYS
from .activity_metrics import week_streak as activity_week_streak

# A stale or removed source cannot leave a pending private celebration in the bell or on a phone.
NOTICE_VISIBLE += " AND (n.kind<>'milestone' OR EXISTS(SELECT 1 FROM milestones m JOIN milestone_state ms ON ms.user_id=m.user_id WHERE m.id=n.milestone_id AND m.user_id=n.user_id AND m.valid AND NOT m.silent AND ms.generation=ms.processed AND (m.activity_id IS NULL OR EXISTS(SELECT 1 FROM activities ma WHERE ma.id=m.activity_id AND ma.user_id=m.user_id))))"

NOTICE_VISIBLE += " AND (n.challenge_id IS NULL OR EXISTS(SELECT 1 FROM challenges cq JOIN users cu ON cu.id=cq.user_id JOIN challenge_members cv ON cv.challenge_id=cq.id AND cv.user_id=n.user_id AND cv.status='active' JOIN challenge_members ca ON ca.challenge_id=cq.id AND ca.user_id=n.actor_id AND ca.status='active' WHERE cq.id=n.challenge_id AND NOT cu.needs_email_confirm AND cu.suspended_at IS NULL))"

NOTICE_VISIBLE += " AND (n.group_id IS NULL OR (n.kind IN ('group_update','group_cheer') AND EXISTS(SELECT 1 FROM group_members gm WHERE gm.group_id=n.group_id AND gm.user_id=n.user_id AND gm.status='active' AND NOT gm.notifications_muted) AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=n.user_id AND b.blocked=n.actor_id) OR (b.user_id=n.actor_id AND b.blocked=n.user_id))))"

NOTICE_VISIBLE += " AND (n.kind<>'activity_ready' OR EXISTS(SELECT 1 FROM activities own WHERE own.id=n.activity_id AND own.user_id=n.user_id))"

NOTICE_VISIBLE += " AND (n.kind<>'signup_admin' OR EXISTS(SELECT 1 FROM users admin WHERE admin.id=n.user_id AND admin.is_admin AND admin.suspended_at IS NULL))"

# Streak reminders are visible only during the same local week in which the owner can still act.
# The Saturday key is stable through timezone edits within a week and cannot collide with the
# Monday period used by weekly summaries in personal_notification_attempts.
NOTICE_VISIBLE += ''' AND (left(n.kind,16)<>'streak_reminder:' OR (
  n.actor_id=n.user_id AND p.notify->'personal'->>'streak'='true'
  AND n.kind ~ '^streak_reminder:[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND substring(n.kind from 17)=to_char((date_trunc('week',now() AT TIME ZONE coalesce(p.tz,'America/New_York'))::date+5),'YYYY-MM-DD')
  AND NOT EXISTS (SELECT 1 FROM activities sa WHERE sa.user_id=n.user_id AND NOT sa.lift_open
    AND sa.start_time <= now() AND sa.start_time+make_interval(secs=>greatest(coalesce(sa.elapsed_s,sa.moving_s,0),0)) <= now()
    AND date_trunc('week',sa.start_time AT TIME ZONE coalesce(p.tz,'America/New_York'))::date=date_trunc('week',now() AT TIME ZONE coalesce(p.tz,'America/New_York'))::date)
  AND EXISTS (SELECT 1 FROM activities sa WHERE sa.user_id=n.user_id AND NOT sa.lift_open
    AND sa.start_time <= now() AND sa.start_time+make_interval(secs=>greatest(coalesce(sa.elapsed_s,sa.moving_s,0),0)) <= now()
    AND date_trunc('week',sa.start_time AT TIME ZONE coalesce(p.tz,'America/New_York'))::date=date_trunc('week',now() AT TIME ZONE coalesce(p.tz,'America/New_York'))::date-7)
  AND EXISTS (SELECT 1 FROM activities sa WHERE sa.user_id=n.user_id AND NOT sa.lift_open
    AND sa.start_time <= now() AND sa.start_time+make_interval(secs=>greatest(coalesce(sa.elapsed_s,sa.moving_s,0),0)) <= now()
    AND date_trunc('week',sa.start_time AT TIME ZONE coalesce(p.tz,'America/New_York'))::date=date_trunc('week',now() AT TIME ZONE coalesce(p.tz,'America/New_York'))::date-14)
 ))'''

router = APIRouter(prefix='/api')
KINDS = ('friend_request', 'friend_accepted', 'cheer', 'comment', 'dish_shared', 'activity_ready', 'milestone','challenge_join','challenge_reminder','challenge_finished', 'monthly_summary', 'report', 'signup_admin')   # report: admins only, in the app only
PUSH_KINDS = {'friends': ('friend_request', 'friend_accepted'), 'cheers': ('cheer',), 'comments': ('comment',), 'dishes': ('dish_shared',), 'activities': ('activity_ready',), 'milestones': ('milestone',),'challenge_joins':('challenge_join',),'challenge_reminders':('challenge_reminder',),'challenge_finished':('challenge_finished',),'monthly_summary':('monthly_summary',)}
log = logging.getLogger('uvicorn.error')
CATCH_UP_KINDS = ('friend_request', 'friend_accepted', 'comment', 'cheer')
MAX_SUBS = 10           # devices per person
AUTO_SOURCES = ('apple', 'healthkit', 'garmin', 'garmin_connect')   # workouts that arrive without the person doing anything
SUMMARY_WINDOW = dt.timedelta(minutes=15)
SUMMARY_KIND = re.compile(r'^monthly_summary:(month|year):([0-9]{4}(?:-[0-9]{2})?)$')
STREAK_REMINDER_KIND = re.compile(r'^streak_reminder:([0-9]{4}-[0-9]{2}-[0-9]{2})$')


def streak_reminder_parts(kind):
    match = STREAK_REMINDER_KIND.fullmatch(kind or '')
    if not match:
        return None
    try:
        period = dt.date.fromisoformat(match.group(1))
    except ValueError:
        return None
    return period if period.weekday() == 5 else None


def streak_reminder_weeks(c, user_id, period, now=None):
    """Current owner-only completed-week streak, or zero when its local Saturday key expired."""
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Streak reminder time must include a timezone')
    profile = c.execute('''SELECT p.tz,p.notify FROM profile p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=%s AND u.suspended_at IS NULL AND NOT u.needs_email_confirm
      AND u.password_change_expires IS NULL''', (user_id,)).fetchone()
    if not profile or (profile['notify'] or {}).get('personal', {}).get('streak') is not True:
        return 0
    tz = db.valid_tz(profile['tz']) or db.DEFAULT_TZ
    zone = ZoneInfo(tz)
    local = now.astimezone(zone)
    monday = local.date() - dt.timedelta(days=local.weekday())
    if period != monday + dt.timedelta(days=5):
        return 0
    start = dt.datetime.combine(monday, dt.time.min, zone)
    end = dt.datetime.combine(monday + dt.timedelta(days=7), dt.time.min, zone)
    worked = c.execute('''SELECT EXISTS(SELECT 1 FROM activities WHERE user_id=%s AND NOT lift_open
      AND start_time >= %s AND start_time < %s AND start_time <= %s
      AND start_time+make_interval(secs=>greatest(coalesce(elapsed_s,moving_s,0),0)) <= %s) AS worked''',
                       (user_id, start, end, now, now)).fetchone()['worked']
    if worked:
        return 0
    weeks = [r['week'] for r in c.execute('''SELECT DISTINCT date_trunc('week',start_time AT TIME ZONE %s)::date AS week
      FROM activities WHERE user_id=%s AND NOT lift_open AND start_time < %s AND start_time <= %s
      AND start_time+make_interval(secs=>greatest(coalesce(elapsed_s,moving_s,0),0)) <= %s''',
                                            (tz, user_id, start, now, now)).fetchall()]
    return activity_week_streak(weeks, local.date())


def record_streak_reminder(c, user_id, period, now=None):
    """Atomically create one current-week owner-only bell row and its existing dedupe claim."""
    now = now or dt.datetime.now(dt.timezone.utc)
    kind = f'streak_reminder:{period.isoformat()}'
    if streak_reminder_parts(kind) != period:
        return None
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended('streak-reminder:'||%s::text||':'||%s::text,0))", (user_id, period))
    if streak_reminder_weeks(c, user_id, period, now) < 2:
        return None
    claim = c.execute('''INSERT INTO personal_notification_attempts(user_id,kind,period)
      VALUES(%s,'weekly',%s) ON CONFLICT DO NOTHING RETURNING user_id''', (user_id, period)).fetchone()
    if not claim:
        return None
    return c.execute('''INSERT INTO notifications(user_id,kind,actor_id,created)
      VALUES(%s,%s,%s,%s) RETURNING id''', (user_id, kind, user_id, now)).fetchone()['id']


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
        if kind=='cheer':c.execute('UPDATE notifications SET reaction_kind=%s,cancelled=false WHERE id=%s',(reaction_kind or 'clap',prior['id']))
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


def summary_parts(kind):
    """The notification stores only a validated period, never a summary snapshot."""
    match = SUMMARY_KIND.fullmatch(kind or '')
    if not match:
        return None
    period_type, period = match.groups()
    try:
        dt.date.fromisoformat(period + ('-01' if period_type == 'month' else '-01-01'))
    except ValueError:
        return None
    return period_type, period


def summary_kind(period_type, period):
    if period_type == 'month':
        if not re.fullmatch(r'\d{4}-\d{2}', period):
            raise ValueError('Invalid monthly summary period')
        dt.date.fromisoformat(period + '-01')
    elif period_type == 'year':
        if not re.fullmatch(r'\d{4}', period):
            raise ValueError('Invalid yearly summary period')
        dt.date.fromisoformat(period + '-01-01')
    else:
        raise ValueError('Invalid summary period type')
    return f'monthly_summary:{period_type}:{period}'


def summary_due(tz, now=None):
    """Return the previous calendar month, plus the previous year on 1 January, at local 9 am."""
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        raise ValueError('Summary schedule time must include a timezone')
    zone = ZoneInfo(db.valid_tz(tz) or db.DEFAULT_TZ)
    local = now.astimezone(zone)
    scheduled = dt.datetime.combine(local.date(), dt.time(9), zone).replace(fold=0)
    at = scheduled.astimezone(dt.timezone.utc)
    if at.astimezone(zone).replace(tzinfo=None) != scheduled.replace(tzinfo=None):
        return []
    if local.day != 1 or not dt.timedelta(0) <= now.astimezone(dt.timezone.utc) - at < SUMMARY_WINDOW:
        return []
    previous_month = local.date().replace(day=1) - dt.timedelta(days=1)
    due = [('month', previous_month.strftime('%Y-%m'))]
    if local.month == 1:
        due.append(('year', str(local.year - 1)))
    return due


def _summary_range(period_type, period, tz):
    zone = ZoneInfo(db.valid_tz(tz) or db.DEFAULT_TZ)
    if period_type == 'month':
        start = dt.date.fromisoformat(period + '-01')
        end = dt.date(start.year + (start.month == 12), start.month % 12 + 1, 1)
    elif period_type == 'year':
        start = dt.date.fromisoformat(period + '-01-01')
        end = dt.date(start.year + 1, 1, 1)
    else:
        raise ValueError('Invalid summary period type')
    return dt.datetime.combine(start, dt.time.min, zone), dt.datetime.combine(end, dt.time.min, zone)


def summary_facts(c, user_id, period_type, period, tz):
    """Read the person's own completed activities for the period, when the bell is opened."""
    lo, hi = _summary_range(period_type, period, tz)
    return c.execute('''SELECT count(*) AS activities,coalesce(sum(distance_m),0)::double precision AS distance_m,
          coalesce(sum(moving_s),0)::double precision AS time_s
        FROM activities WHERE user_id=%s AND NOT lift_open AND start_time>=%s AND start_time<%s''',
        (user_id, lo, hi)).fetchone()


def summary_detail(facts, units):
    count = int(facts['activities'] or 0)
    if not count:
        return ''
    distance = float(facts['distance_m'] or 0)
    if distance > 0:
        unit = 'mi' if units == 'imperial' else 'km'
        value = distance / (1609.344 if unit == 'mi' else 1000)
        number = f'{value:,.0f}' if value >= 10 else f'{value:,.1f}'
        return f'{number} {unit} · {count} {"workouts" if count != 1 else "workout"}'
    seconds = int(round(float(facts['time_s'] or 0)))
    duration = f'{seconds // 3600} h {seconds % 3600 // 60} min' if seconds >= 3600 else f'{max(1, seconds // 60)} min'
    return f'{duration} · {count} {"workouts" if count != 1 else "workout"}' if seconds else f'{count} {"workouts" if count != 1 else "workout"}'


def summary_title(period_type, period):
    if period_type == 'year':
        return f'Your {period} in review'
    month = dt.date.fromisoformat(period + '-01').strftime('%B')
    return f'Your {month} summary is ready'


def record_summary(c, user_id, period_type, period, *, created=None, enqueue=True):
    """Create one period-only bell item if the owner recorded a completed workout."""
    kind = summary_kind(period_type, period)
    c.execute("SELECT pg_advisory_xact_lock(hashtextextended('monthly-summary:'||%s::text||':'||%s,0))", (user_id, kind))
    if c.execute('SELECT 1 FROM notifications WHERE user_id=%s AND kind=%s LIMIT 1', (user_id, kind)).fetchone():
        return None
    profile = c.execute('''SELECT p.tz FROM profile p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=%s AND u.suspended_at IS NULL AND NOT u.needs_email_confirm
      AND u.password_change_expires IS NULL''', (user_id,)).fetchone()
    if not profile or not summary_facts(c, user_id, period_type, period, profile['tz'])['activities']:
        return None
    nid = c.execute('''INSERT INTO notifications(user_id,kind,actor_id,created)
      VALUES(%s,%s,%s,coalesce(%s,now())) RETURNING id''', (user_id, kind, user_id, created)).fetchone()['id']
    if enqueue:
        threading.Thread(target=_push_later, args=(nid,), daemon=True).start()
    return nid


def summary_tick(now=None):
    """Called by the existing notification worker; idempotency lives in the period-only bell row."""
    now = now or dt.datetime.now(dt.timezone.utc)
    with db.connect() as c:
        profiles = c.execute('''SELECT p.user_id,p.tz FROM profile p JOIN users u ON u.id=p.user_id
          WHERE u.suspended_at IS NULL AND NOT u.needs_email_confirm AND u.password_change_expires IS NULL''').fetchall()
    made = 0
    for profile in profiles:
        periods = summary_due(profile['tz'], now)
        for period_type, period in periods:
            try:
                with db.connect() as c:
                    fresh = c.execute('''SELECT p.tz FROM profile p JOIN users u ON u.id=p.user_id
                      WHERE p.user_id=%s AND u.suspended_at IS NULL AND NOT u.needs_email_confirm
                      AND u.password_change_expires IS NULL''', (profile['user_id'],)).fetchone()
                    if not fresh or (period_type, period) not in summary_due(fresh['tz'], now):
                        continue
                    if record_summary(c, profile['user_id'], period_type, period, created=now):
                        made += 1
            except Exception as error:
                log.info('monthly summary skipped: reason=%s', type(error).__name__)
    return made


# ---------- reading: the words are made here ----------
_LIST = """SELECT n.id, n.kind, n.reaction_kind, n.created, n.read_at IS NOT NULL AS read, n.activity_id, n.dish_id, n.user_id,n.challenge_id,q.code AS challenge_code,
             n.group_id,g.title AS group_title,
             u.login::text AS login, u.name, u.photo_v AS photo, recipient.name AS recipient_name,
             a.name AS activity, a.user_id AS activity_owner, a.updated, a.start_time, a.lift_open, a.distance_m::double precision AS distance_m, a.moving_s, a.elapsed_s, a.sport, a.sub_sport, a.sport_label,
             (a.sport='workout' AND EXISTS(SELECT 1 FROM lift_sets ls WHERE ls.activity_id=a.id AND ls.user_id=n.user_id)) AS has_lifts,
             p.units, p.tz, ms.generation, m.title AS milestone_title, d.name AS dish, cm.text AS comment
           FROM notifications n JOIN users u ON u.id = n.actor_id LEFT JOIN profile p ON p.user_id = n.user_id
           JOIN users recipient ON recipient.id=n.user_id LEFT JOIN milestone_state ms ON ms.user_id=n.user_id
           LEFT JOIN milestones m ON m.id=n.milestone_id AND m.user_id=n.user_id AND m.valid
           LEFT JOIN activities a ON a.id = n.activity_id LEFT JOIN dishes d ON d.id = n.dish_id LEFT JOIN comments cm ON cm.id = n.comment_id LEFT JOIN challenges q ON q.id=n.challenge_id LEFT JOIN event_groups g ON g.id=n.group_id"""


def _words(r):
    reminder = streak_reminder_parts(r['kind'])
    if reminder:
        return f"One workout keeps your {r.get('streak_weeks', 0)}-week streak.", '/track'
    summary = summary_parts(r['kind'])
    if summary:
        period_type, period = summary
        query = 'summary' if period_type == 'month' else 'year'
        return summary_title(period_type, period), f'/notifications?{query}={period}'
    if r['kind']=='signup_admin':return 'Sign-up capacity needs attention. Review accounts and the waitlist in Administration.', '/me/people'
    if r['kind']=='milestone':return notification_words.clean(r.get('milestone_title') or 'A milestone is ready to review',100), '/me/milestones'
    if r['kind'].startswith('challenge_'):
        text={'challenge_join':'@'+r['login']+' joined your challenge','challenge_reminder':'Three days left in your challenge','challenge_finished':'Your challenge finish picture is ready'}[r['kind']]
        return text,'/me/challenges/'+r['challenge_code']
    if r['kind'] in {'group_update','group_cheer'}:
        who = notification_words.clean(r['name'],40)
        title = notification_words.clean(r.get('group_title') or 'your group',80)
        action = 'posted an update' if r['kind'] == 'group_update' else 'cheered'
        return f'{who} {action} in {title}', f"/groups/{r['group_id']}"
    who, act = notification_words.clean(r['name'],40), notification_words.clean(r['activity'] or 'activity',90)
    if r['kind'] == 'activity_ready':
        title,body=notification_words.activity(r)
        return title+' · '+body, f"/activity/{r['activity_id']}?edit=1"
    if r['kind'] == 'friend_request': return f'{who} wants to be friends', '/me/friends'
    if r['kind'] == 'friend_accepted': return f'You and {who} are now friends', '/activity'
    if r['kind']=='cheer':
        kind=reactions.canonical(r.get('reaction_kind'))
        reaction=reactions.EMOJI.get(kind,'👏')
        return f"{who} reacted {reaction} to your {act}",f"/activity/{r['activity_id']}"
    if r['kind'] == 'comment':
        snip = notification_words.clean(r['comment'],80)
        return f'{who} commented on your {act}' + (f': "{snip}"' if snip else ''), f"/activity/{r['activity_id']}"
    if r['kind'] == 'report': return f'{who} reported something for the admins to look at', '/me/people'
    return f"{who} shared {r['dish'] or 'a meal'} with you", f"/food/cook/{r['dish_id']}"



def _item(r, detail=''):
    text, link = _words(r)
    summary = summary_parts(r['kind'])
    reminder = streak_reminder_parts(r['kind'])
    if r['kind'].startswith('challenge_'):r={**r,'name':'@'+r['login']}
    if r['kind']=='signup_admin':r={**r,'login':'','name':'Kinetta','photo':None}
    item = {'id': r['id'], 'kind': 'monthly_summary' if summary else 'streak_reminder' if reminder else r['kind'], 'text': text, 'link': link,
            'created': r['created'], 'read': r['read'], 'who': {'login': r['login'], 'name': r['name'], 'photo': r['photo']}}
    if summary:
        item.update({'period_type': summary[0], 'period': summary[1], 'detail': detail})
    return item


def unread(c, uid):
    return c.execute('SELECT count(*) AS n FROM notifications n JOIN profile p ON p.user_id=n.user_id WHERE n.user_id = %s AND n.read_at IS NULL AND '+NOTICE_VISIBLE, (uid,)).fetchone()['n']


@router.get('/notifications')
def notifications(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute(_LIST + ' WHERE n.user_id = %s AND '+NOTICE_VISIBLE+' ORDER BY n.created DESC, n.id DESC LIMIT 60', (user['id'],)).fetchall()
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
        n = unread(c, user['id'])
        items = []
        for row in rows:
            reminder = streak_reminder_parts(row['kind'])
            if reminder:
                weeks = streak_reminder_weeks(c, user['id'], reminder)
                if weeks < 2:
                    continue
                row = {**row, 'streak_weeks': weeks}
            parts = summary_parts(row['kind'])
            detail = summary_detail(summary_facts(c, user['id'], *parts, row['tz']), row['units']) if parts else ''
            items.append(_item(row, detail))
    return {'items': items, 'unread': n, 'push': _prefs(p.get('notify')), 'push_ready': apns.ready()}


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


def _push_preference(kind):
    if streak_reminder_parts(kind):
        return 'personal_streak'
    if summary_parts(kind):
        return 'monthly_summary'
    return next((name for name, kinds in PUSH_KINDS.items() if kind in kinds), None)


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
    monthly_summary: bool | None = None


@router.put('/notifications/settings')
def settings(body: PrefsIn, user=Depends(current_user)):
    v = {k: x for k, x in body.model_dump().items() if x is not None}
    with db.connect() as c:
        c.execute("UPDATE profile SET notify = coalesce(notify, '{}') || %s::jsonb WHERE user_id = %s", (json.dumps(v), user['id']))
        p = c.execute('SELECT notify FROM profile WHERE user_id = %s', (user['id'],)).fetchone() or {}
    return {'push': _prefs(p.get('notify'))}


def _push_words(r, facts=None, c=None):
    """Keep long activity/person text in the multiline body, not iOS's short title."""
    reminder = streak_reminder_parts(r['kind'])
    if reminder:
        weeks = streak_reminder_weeks(c, r['user_id'], reminder) if c else 0
        return 'Streak reminder', f'One workout keeps your {weeks}-week streak.'
    summary = summary_parts(r['kind'])
    if summary:
        period_type, period = summary
        profile = c.execute('SELECT tz,units FROM profile WHERE user_id=%s', (r['user_id'],)).fetchone() if c else None
        detail = ''
        if profile:
            values = summary_facts(c, r['user_id'], period_type, period, profile['tz'])
            detail = summary_detail(values, profile['units'])
        return summary_title(period_type, period), detail
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
    kind = 'streak_reminder' if streak_reminder_parts(kind) else kind if kind in (*KINDS, 'meal', 'plan', 'weekly') else 'unknown'
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
        facts=None;stamp=None
        if has_device:
            try:
                # Optional copy must never make a valid ordinary alert disappear.
                # The savepoint also recovers the outer transaction after SQL errors.
                with c.transaction():
                    asof=dt.datetime.now(dt.timezone.utc)
                    stamp=notification_facts.signature(row,asof)
                    facts=notification_facts.read(c,row,asof)
                    if facts:
                        after=c.execute(_LIST+' WHERE n.id=%s AND '+NOTICE_VISIBLE,(nid,)).fetchone()
                        if stamp!=notification_facts.signature(after):facts=None;stamp=None
            except Exception:
                facts=None;stamp=None
                log.info('push highlight skipped: reason=unavailable')
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
        preference = _push_preference(fresh['kind'])
        personal_streak = (prefs.get('notify') or {}).get('personal', {}).get('streak') is True
        if not preference or (not personal_streak if preference == 'personal_streak' else not _prefs(prefs.get('notify'))[preference]):
            prepare.reason = 'preference_off'
            return None
        current_facts=facts if stamp is not None and stamp==notification_facts.signature(fresh) else None
        title, body = _push_words(fresh,current_facts,conn)
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
