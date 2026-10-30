"""Opt-in plan/summary conveniences. Generic APNs only; never AI or bell/feed rows."""
import datetime as dt
import json
import threading
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, StrictBool
from . import apns, db, meal_reminders, notify, plans
from .auth import current_user

router = APIRouter(prefix='/api/notifications/personal')
TIMES = ('07:00', '08:00', '12:00', '18:00', '20:00')
WINDOW = dt.timedelta(minutes=15)


def clock():
    return dt.datetime.now(dt.timezone.utc)


def preferences(value):
    raw = value.get('personal') if isinstance(value, dict) else None
    raw = raw if isinstance(raw, dict) else {}
    return {**raw, 'plan': raw.get('plan') is True, 'weekly': raw.get('weekly') is True,
            'plan_time': raw.get('plan_time') if raw.get('plan_time') in TIMES else '08:00'}


def profile(c, uid):
    return c.execute('''SELECT p.tz,p.notify FROM profile p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=%s AND u.suspended_at IS NULL AND NOT u.needs_email_confirm
      AND u.password_change_expires IS NULL''', (uid,)).fetchone()


def status_data(c, uid):
    p = profile(c, uid)
    if not p:
        raise HTTPException(404, 'Profile not found')
    cfg = preferences(p['notify'])
    return {k: cfg[k] for k in ('plan', 'weekly', 'plan_time')} | {
        'tz': db.valid_tz(p['tz']) or db.DEFAULT_TZ,
        'push_ready': apns.ready(), 'device_ready': meal_reminders.devices(c, uid)}


@router.get('')
def status(user=Depends(current_user)):
    with db.connect() as c:
        return status_data(c, user['id'])


class Preference(BaseModel):
    model_config = {'extra': 'forbid'}
    plan: StrictBool | None = None
    weekly: StrictBool | None = None
    plan_time: Literal['07:00', '08:00', '12:00', '18:00', '20:00'] | None = None
    confirmed: StrictBool = False


@router.put('')
def settings(body: Preference, user=Depends(current_user)):
    with db.connect() as c:
        row = c.execute('SELECT notify FROM profile WHERE user_id=%s FOR UPDATE', (user['id'],)).fetchone()
        if not row:
            raise HTTPException(404, 'Profile not found')
        cfg = preferences(row['notify'])
        now = clock().isoformat()
        for key in ('plan', 'weekly'):
            value = getattr(body, key)
            if value is None:
                continue
            if value and (not cfg[key] or not cfg.get(key + '_after')):
                if not body.confirmed:
                    raise HTTPException(400, 'Choose this notification explicitly before enabling it')
                if not apns.ready() or not meal_reminders.devices(c, user['id']):
                    raise HTTPException(409, 'Turn on iPhone notifications after server setup is complete')
                cfg[key + '_after'] = now
            cfg[key] = value
        if body.plan_time is not None and body.plan_time != cfg['plan_time']:
            cfg['plan_time'] = body.plan_time
            cfg['plan_after'] = now
        c.execute("UPDATE profile SET notify=(CASE WHEN jsonb_typeof(notify)='object' THEN notify ELSE '{}'::jsonb END)||%s::jsonb WHERE user_id=%s",
                  (json.dumps({'personal': cfg}), user['id']))
        return status_data(c, user['id'])


def due(p, now):
    """Cheap schedule check before history reads. Missing opt-in times stay silent."""
    cfg = preferences(p['notify'])
    zone = ZoneInfo(db.valid_tz(p['tz']) or db.DEFAULT_TZ)
    local = now.astimezone(zone)
    slots = []
    for kind, time in (('plan', cfg['plan_time']), ('weekly', '09:00')):
        if not cfg[kind] or (kind == 'weekly' and local.weekday() != 0):
            continue
        try:
            after = dt.datetime.fromisoformat(cfg[kind + '_after'])
            if after.tzinfo is None:
                continue
        except (KeyError, TypeError, ValueError):
            continue
        hour, minute = map(int, time.split(':'))
        scheduled = dt.datetime.combine(local.date(), dt.time(hour, minute), zone).replace(fold=0)
        at = scheduled.astimezone(dt.timezone.utc)
        # Nonexistent local wall times never silently become another time.
        if at.astimezone(zone).replace(tzinfo=None) != scheduled.replace(tzinfo=None):
            continue
        if at <= after or not dt.timedelta(0) <= now - at < WINDOW:
            continue
        period = local.date() if kind == 'plan' else local.date() - dt.timedelta(days=7)
        slots.append((kind, period, at))
    return slots


def eligible(c, uid, kind, period, tz):
    zone = ZoneInfo(tz)
    if kind == 'weekly':
        lo = dt.datetime.combine(period, dt.time.min, zone)
        hi = dt.datetime.combine(period + dt.timedelta(days=7), dt.time.min, zone)
        return c.execute('''SELECT EXISTS(SELECT 1 FROM activities WHERE user_id=%s AND NOT lift_open
          AND start_time>=%s AND start_time<%s) OR EXISTS(SELECT 1 FROM food_entries
          WHERE user_id=%s AND day>=%s AND day<%s) AS ok''',
                         (uid, lo, hi, uid, period, period + dt.timedelta(days=7))).fetchone()['ok']
    p = c.execute('SELECT * FROM training_plans WHERE user_id=%s AND active', (uid,)).fetchone()
    if not p:
        return False
    weeks = plans.build(p, plans.paces(None))
    plans.apply_adjustments(c, uid, p, weeks)
    workout = next((w for week in weeks for w in week['workouts'] if w['day'] == period), None)
    if not workout or workout['type'] == 'rest':
        return False
    mark = c.execute('SELECT done FROM plan_marks WHERE user_id=%s AND plan_id=%s AND day=%s',
                     (uid, p['id'], period)).fetchone()
    if mark:
        return not mark['done']
    lo = dt.datetime.combine(period, dt.time.min, zone)
    hi = dt.datetime.combine(period + dt.timedelta(days=1), dt.time.min, zone)
    actual = c.execute("SELECT count(*) AS n,coalesce(sum(distance_m),0) AS m FROM activities WHERE user_id=%s AND sport='run' AND start_time>=%s AND start_time<%s",
                       (uid, lo, hi)).fetchone()
    distance = workout['dist']
    return not (actual['n'] and (not distance or actual['m'] >= distance * (plans.MI if p['unit'] == 'mi' else 1000) * .98))


def deliver(uid, kind, period, send=None, now=None):
    if send is None and not apns.ready():
        notify.log_unconfigured(uid, kind)
        return 0
    def prepare(c):
        p = profile(c, uid)
        at = now or clock()
        if not p:
            return None
        if not preferences(p['notify'])[kind]:
            prepare.reason = 'preference_off'
            return None
        slot = next((s for s in due(p, at) if s[:2] == (kind, period)), None)
        if not slot:
            return None
        claim = c.execute('''SELECT 1 FROM personal_notification_attempts WHERE user_id=%s AND kind=%s AND period=%s
          AND attempted_at>now()-interval '5 minutes' ''', (uid, kind, period)).fetchone()
        if not claim or not eligible(c, uid, kind, period, db.valid_tz(p['tz']) or db.DEFAULT_TZ):
            return None
        return {'title': 'Today’s plan' if kind == 'plan' else 'Weekly summary',
                'body': 'You have a workout planned today. View it when you’re ready.' if kind == 'plan' else 'Your private progress summary is ready to view.',
                'url': '/plan' if kind == 'plan' else '/progress?section=activity&review=week',
                'badge': notify.unread(c, uid), 'tag': f'personal-{kind}-{period}',
                'expires_at': int((slot[2] + WINDOW).timestamp())}
    prepare.kind = kind
    return notify._deliver_native(uid, {}, prepare, send)


def tick(now=None, send=None):
    with db.connect() as c:
        c.execute("DELETE FROM personal_notification_attempts WHERE attempted_at<now()-interval '90 days'")
    if send is None and not apns.ready():
        return 0
    with db.connect() as c:
        users = c.execute('''SELECT p.user_id,p.tz,p.notify FROM profile p JOIN users u ON u.id=p.user_id
          WHERE (p.notify->'personal' @> '{"plan":true}' OR p.notify->'personal' @> '{"weekly":true}')
          AND u.suspended_at IS NULL AND NOT u.needs_email_confirm AND u.password_change_expires IS NULL
          ORDER BY p.user_id''').fetchall()
    count = 0
    for p in users:
        uid = p['user_id']
        try:
            for kind, period, _ in due(p, now or clock()):
                with db.connect() as c:
                    fresh = profile(c, uid)
                    if not fresh or not any(s[:2] == (kind, period) for s in due(fresh, now or clock())):
                        continue
                    if not meal_reminders.devices(c, uid) or not eligible(c, uid, kind, period, db.valid_tz(fresh['tz']) or db.DEFAULT_TZ):
                        continue
                    claimed = c.execute('''INSERT INTO personal_notification_attempts(user_id,kind,period) VALUES(%s,%s,%s)
                      ON CONFLICT DO NOTHING RETURNING user_id''', (uid, kind, period)).fetchone()
                if not claimed:
                    continue
                # The claim commits before network work; an uncertain send is never replayed.
                sent = deliver(uid, kind, period, send=send, now=now)
                with db.connect() as c:
                    c.execute('UPDATE personal_notification_attempts SET delivered=%s WHERE user_id=%s AND kind=%s AND period=%s',
                              (sent, uid, kind, period))
                count += sent
        except Exception as error:
            print('personal notification account skipped', type(error).__name__, flush=True)
    return count


def start_worker():
    stop = threading.Event()
    def run():
        while not stop.wait(60):
            try:
                tick()
            except Exception as error:
                print('personal notifications paused', type(error).__name__, flush=True)
    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    return stop, worker
