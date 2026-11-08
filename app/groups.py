"""Private event groups: explicit invitations, member-only details and aggregate-only progress."""
import datetime as dt
import hashlib
import hmac
import os
import secrets
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import account_email, auth, community_filter, db, notify, reactions
from .auth import current_user

router = APIRouter()
UTC = dt.timezone.utc
INVITE_TTL = dt.timedelta(days=30)
INVITE_UNAVAILABLE = 'This group invite is not available.'
GROUP_MISSING = 'Group not found.'
KINDS = {'distance', 'elevation', 'long_outings', 'sessions'}
UNITS = {'km', 'mi', 'm', 'ft', 'outings', 'sessions'}
MAX_MEMBERS = 50
LONG_OUTING_SECONDS = 3600


class GroupCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=80)
    event_date: dt.date | None = None
    time_zone: str = Field(min_length=1, max_length=80)
    note: str = Field('', max_length=280)
    goal_type: str
    goal_target: float = Field(gt=0, le=1_000_000, allow_inf_nan=False)
    goal_unit: str

    @field_validator('title')
    @classmethod
    def title_not_blank(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Enter a group name')
        return value

    @field_validator('note')
    @classmethod
    def clean_note(cls, value):
        return value.strip()


class GroupEventDate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    event_date: dt.date | None


class MemberAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=60)


class GroupReport(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: str = Field(pattern='^(spam|abuse|inappropriate|other)$')
    note: str | None = Field(None, max_length=500)


class GroupStripPreference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    muted: bool


class GroupUpdateCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=200)

    @field_validator('text')
    @classmethod
    def clean_text(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Write an update first')
        return value


class GroupReaction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: str = Field(min_length=1, max_length=32)

    @field_validator('kind')
    @classmethod
    def allowed_kind(cls, value):
        kind = reactions.canonical(value)
        if kind not in reactions.KINDS:
            raise ValueError('Choose a reaction from the list')
        return kind


class GroupRecapConsent(BaseModel):
    model_config = ConfigDict(extra='forbid')
    consent: bool


class GroupNotificationPreference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    muted: bool


def _now():
    return dt.datetime.now(UTC)


def _zone(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, TypeError):
        raise HTTPException(400, 'Choose a valid time zone')


def _validate_event_date(event_date, time_zone, now=None):
    if event_date is None:
        return
    today = (now or _now()).astimezone(_zone(time_zone)).date()
    try:
        latest = today.replace(year=today.year + 5)
    except ValueError:  # February 29 reaches February 28 five years later.
        latest = today.replace(year=today.year + 5, day=28)
    if not today <= event_date <= latest:
        raise HTTPException(422, 'Choose an event date from today through five years from now')


def _local_week_window(zone_name, now):
    zone = _zone(zone_name)
    local_day = now.astimezone(zone).date()
    monday = local_day - dt.timedelta(days=local_day.weekday())
    next_monday = monday + dt.timedelta(days=7)
    start = dt.datetime.combine(monday, dt.time.min, zone).astimezone(UTC)
    end = dt.datetime.combine(next_monday, dt.time.min, zone).astimezone(UTC)
    return local_day, start, end


def _group_id(value):
    if isinstance(value, UUID):
        return value
    try:
        return UUID(value)
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(404, GROUP_MISSING)


def _valid_goal(body):
    if body.goal_type not in KINDS:
        raise HTTPException(400, 'Choose a group goal')
    units = {'distance': {'km', 'mi'}, 'elevation': {'m', 'ft'},
             'long_outings': {'outings'}, 'sessions': {'sessions'}}
    if body.goal_unit not in units[body.goal_type]:
        raise HTTPException(400, 'Choose units that match the group goal')
    if body.goal_type in {'long_outings', 'sessions'} and body.goal_target != int(body.goal_target):
        raise HTTPException(400, 'Choose a whole number for this goal')


def _token_hash(token):
    return hashlib.sha256(token.encode('utf-8')).digest()


def _invite_link(token, request):
    base = os.environ.get('KINETTA_PUBLIC_URL', '').rstrip('/') or str(request.base_url).rstrip('/')
    return f'{base}/group-invite/{token}'


def _new_invite(c, group, request):
    token = secrets.token_bytes(16).hex()
    generation = group['invite_generation'] + 1
    c.execute('UPDATE group_invites SET revoked_at=now() WHERE group_id=%s AND revoked_at IS NULL', (group['id'],))
    c.execute('''UPDATE event_groups SET invite_generation=%s,joining_closed=false
                 WHERE id=%s''', (generation, group['id']))
    c.execute('''INSERT INTO group_invites(group_id,generation,token_hash,expires_at)
                 VALUES(%s,%s,%s,%s)''', (group['id'], generation, _token_hash(token), dt.datetime.now(UTC) + INVITE_TTL))
    return _invite_link(token, request)


def _invite(c, token):
    digest = _token_hash(token or '')
    row = c.execute('''SELECT i.*,g.title,g.event_date,g.time_zone,g.closed_at,g.joining_closed,
                              g.invite_generation,g.organizer_id
                       FROM group_invites i JOIN event_groups g ON g.id=i.group_id
                       WHERE i.token_hash=%s''', (digest,)).fetchone()
    stored = bytes(row['token_hash']) if row else bytes(32)
    matched = hmac.compare_digest(digest, stored)
    now = dt.datetime.now(UTC)
    if (not row or not matched or row['revoked_at'] is not None or row['expires_at'] <= now
            or row['generation'] != row['invite_generation'] or row['joining_closed'] or row['closed_at']):
        raise HTTPException(404, INVITE_UNAVAILABLE)
    return row


def _active_member(c, group_id, uid, lock=False):
    return c.execute('''SELECT * FROM group_members WHERE group_id=%s AND user_id=%s AND status='active' '''
                     + ('FOR UPDATE' if lock else ''), (group_id, uid)).fetchone()


def _group(c, group_id, uid, lock=False):
    group_id = _group_id(group_id)
    row = c.execute('''SELECT g.* FROM event_groups g JOIN group_members m ON m.group_id=g.id
                       WHERE g.id=%s AND m.user_id=%s AND m.status='active' '''
                    + ('FOR UPDATE OF g' if lock else ''), (group_id, uid)).fetchone()
    if not row:
        raise HTTPException(404, GROUP_MISSING)
    return row


def _blocked(c, first, second):
    return bool(c.execute('''SELECT 1 FROM blocks WHERE (user_id=%s AND blocked=%s)
                             OR (user_id=%s AND blocked=%s) LIMIT 1''',
                          (first, second, second, first)).fetchone())


def _contributions(c, group, members, now=None):
    now = now or _now()
    zone = _zone(group['time_zone'])
    event_date = group['event_date']
    group_start = group['created'] if event_date is None else None
    end = (dt.datetime.combine(event_date + dt.timedelta(days=1), dt.time.min, zone).astimezone(UTC)
           if event_date else now)
    visible_ids = [member['user_id'] for member in members]
    if not visible_ids:
        return {}
    measures = {
        'distance': "sum(a.distance_m) FILTER(WHERE a.distance_m>0 AND a.distance_m<'Infinity'::real)",
        'elevation': "sum(a.ascent_m) FILTER(WHERE a.ascent_m>0 AND a.ascent_m<'Infinity'::real)",
        'long_outings': f"count(a.id) FILTER(WHERE coalesce(a.moving_s,a.elapsed_s,0)>={LONG_OUTING_SECONDS})",
        'sessions': 'count(a.id)',
    }
    rows = c.execute(f'''SELECT m.user_id,coalesce({measures[group['goal_type']]},0) AS raw
      FROM group_members m LEFT JOIN activities a ON a.user_id=m.user_id
        AND a.start_time>=greatest(m.joined_at,coalesce(%s::timestamptz,m.joined_at))
        AND a.start_time<least(%s::timestamptz,%s) AND NOT a.lift_open
      WHERE m.group_id=%s AND m.status='active' AND m.user_id=ANY(%s)
      GROUP BY m.user_id''', (group_start, end, now, group['id'], visible_ids)).fetchall()
    divisor = (1609.344 if group['goal_unit'] == 'mi' else 1000) if group['goal_type'] == 'distance' else (
        0.3048 if group['goal_type'] == 'elevation' and group['goal_unit'] == 'ft' else 1)
    return {row['user_id']: round(float(row['raw'] or 0) / divisor, 3) for row in rows}


def _weekly_contributions(c, group, members, now):
    local_day, start, week_end = _local_week_window(group['time_zone'], now)
    zone = _zone(group['time_zone'])
    event_date = group['event_date']
    group_start = group['created'] if event_date is None else None
    event_end = (dt.datetime.combine(event_date + dt.timedelta(days=1), dt.time.min, zone).astimezone(UTC)
                 if event_date else now)
    end = min(week_end, event_end, now)
    visible_ids = [member['user_id'] for member in members]
    if not visible_ids or end <= start:
        return local_day, {}
    measures = {
        'distance': "sum(a.distance_m) FILTER(WHERE a.distance_m>0 AND a.distance_m<'Infinity'::real)",
        'elevation': "sum(a.ascent_m) FILTER(WHERE a.ascent_m>0 AND a.ascent_m<'Infinity'::real)",
        'long_outings': f"count(a.id) FILTER(WHERE coalesce(a.moving_s,a.elapsed_s,0)>={LONG_OUTING_SECONDS})",
        'sessions': 'count(a.id)',
    }
    rows = c.execute(f'''SELECT m.user_id,coalesce({measures[group['goal_type']]},0) AS raw
      FROM group_members m LEFT JOIN activities a ON a.user_id=m.user_id
        AND a.start_time>=greatest(m.joined_at,coalesce(%s::timestamptz,m.joined_at),%s::timestamptz)
        AND a.start_time<%s::timestamptz AND NOT a.lift_open
      WHERE m.group_id=%s AND m.status='active' AND m.user_id=ANY(%s)
      GROUP BY m.user_id''', (group_start, start, end, group['id'], visible_ids)).fetchall()
    divisor = (1609.344 if group['goal_unit'] == 'mi' else 1000) if group['goal_type'] == 'distance' else (
        0.3048 if group['goal_type'] == 'elevation' and group['goal_unit'] == 'ft' else 1)
    return local_day, {row['user_id']: round(float(row['raw'] or 0) / divisor, 3) for row in rows}


def _answer(c, group, uid):
    members = c.execute('''SELECT m.user_id,m.joined_at,m.recap_consent,m.notifications_muted,
                                  u.login::text AS username,u.photo_v AS photo,
                                  coalesce(p.share_achievements,false) AS share_total
                           FROM group_members m JOIN users u ON u.id=m.user_id
                           LEFT JOIN profile p ON p.user_id=u.id
                           WHERE m.group_id=%s AND m.status='active' AND NOT u.needs_email_confirm
                             AND u.suspended_at IS NULL ORDER BY m.joined_at,m.user_id''', (group['id'],)).fetchall()
    visible = [member for member in members if not _blocked(c, uid, member['user_id'])]
    now = _now()
    contributions = _contributions(c, group, visible, now)
    local_day, weekly = _weekly_contributions(c, group, visible, now)
    total = round(sum(contributions.values()), 3)
    member_count = len(visible)
    zone = _zone(group['time_zone'])
    today = now.astimezone(zone).date()
    event_date = group['event_date']
    days_to_event = max(0, (event_date - today).days) if event_date else None
    week_total = round(sum(weekly.values()), 3)
    week_contributors = sum(value > 0 for value in weekly.values())
    me = next(member for member in members if member['user_id'] == uid)
    return {
        'id': str(group['id']), 'title': group['title'],
        'event_date': event_date.isoformat() if event_date else None,
        'time_zone': group['time_zone'], 'note': group['note'], 'goal_type': group['goal_type'],
        'goal_target': group['goal_target'], 'goal_unit': group['goal_unit'],
        **({'total': total} if member_count >= 3 else {'your_total': contributions.get(uid, 0)}),
        **({'this_week_total': week_total, 'this_week_contributors': week_contributors}
           if member_count >= 3 else {'your_this_week_total': weekly.get(uid, 0)}),
        'week_start': (local_day - dt.timedelta(days=local_day.weekday())).isoformat(),
        'days_to_event': days_to_event,
        'weeks_to_event': (days_to_event + 6) // 7 if days_to_event is not None else None,
        'event_state': ('ongoing' if event_date is None else
                        'upcoming' if today < event_date else 'today' if today == event_date else 'complete'),
        'members': [{'username': m['username'], 'photo': m['photo'] or False,
                     'organizer': m['user_id'] == group['organizer_id'],
                     **({'value': contributions.get(m['user_id'], 0)} if member_count >= 3 and m['share_total']
                        else {'sharing_total_only': True} if not m['share_total'] else {})}
                    for m in visible],
        'member_count': member_count, 'is_organizer': uid == group['organizer_id'],
        'recap_consent': bool(me['recap_consent']), 'notifications_muted': bool(me['notifications_muted']),
        'joining_closed': bool(group['joining_closed']), 'closed': bool(group['closed_at']),
    }


def _reaction_summary(rows, uid):
    counts = {kind: 0 for kind in reactions.KINDS}
    mine = None;order=[]
    for row in rows:
        if row['kind'] in counts:
            counts[row['kind']] += 1
            if row['kind'] not in order:order.append(row['kind'])
        if row['user_id'] == uid:
            mine = row['kind']
    return {'my_reaction': mine, 'reactions': counts,'reaction_order':order}


def _group_updates(c, group, uid):
    updates = c.execute('''SELECT u.id,u.user_id,u.text,u.created,p.login::text AS username,p.name,p.photo_v AS photo
        FROM group_updates u JOIN users p ON p.id=u.user_id
        WHERE u.group_id=%s AND NOT p.needs_email_confirm AND p.suspended_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=%s AND b.blocked=u.user_id)
            OR (b.user_id=u.user_id AND b.blocked=%s))
        ORDER BY u.created DESC,u.id DESC LIMIT 30''', (group['id'], uid, uid)).fetchall()
    if not updates:
        return []
    ids = [row['id'] for row in updates]
    reactions_by_id = {update_id: [] for update_id in ids}
    rows = c.execute('''SELECT r.update_id,r.user_id,r.kind,r.created FROM group_update_reactions r
        JOIN group_updates u ON u.id=r.update_id
        JOIN group_members m ON m.group_id=u.group_id AND m.user_id=r.user_id AND m.status='active'
        JOIN users p ON p.id=r.user_id AND NOT p.needs_email_confirm AND p.suspended_at IS NULL
        WHERE r.update_id=ANY(%s) AND NOT EXISTS(SELECT 1 FROM blocks b
          WHERE (b.user_id=%s AND b.blocked=r.user_id) OR (b.user_id=r.user_id AND b.blocked=%s))
        ORDER BY r.created,r.user_id''',
                       (ids, uid, uid)).fetchall()
    for row in rows:
        reactions_by_id[row['update_id']].append(row)
    return [{'id': row['id'], 'username': row['username'], 'name': row['name'], 'photo': row['photo'] or False,
             'text': row['text'], 'created': row['created'], 'can_delete': row['user_id'] == uid or uid == group['organizer_id'],
             'can_report': row['user_id'] != uid,
             **_reaction_summary(reactions_by_id[row['id']], uid)} for row in updates]


def _weekly_reaction_rows(c, group, uid, week_start):
    return c.execute('''SELECT r.user_id,r.kind,r.created FROM group_weekly_reactions r
        JOIN group_members m ON m.group_id=r.group_id AND m.user_id=r.user_id AND m.status='active'
        JOIN users p ON p.id=r.user_id AND NOT p.needs_email_confirm AND p.suspended_at IS NULL
        WHERE r.group_id=%s AND r.week_start=%s AND NOT EXISTS(SELECT 1 FROM blocks b
          WHERE (b.user_id=%s AND b.blocked=r.user_id) OR (b.user_id=r.user_id AND b.blocked=%s))
        ORDER BY r.created,r.user_id''',
                       (group['id'], week_start, uid, uid)).fetchall()


def _group_recap(c, group, uid, answer, now):
    if group['event_date'] is None:
        return None
    today = now.astimezone(_zone(group['time_zone'])).date()
    if today <= group['event_date']:
        return None
    members = c.execute('''SELECT m.user_id,m.joined_at,m.recap_consent,u.login::text AS username
        FROM group_members m JOIN users u ON u.id=m.user_id
        WHERE m.group_id=%s AND m.status='active' AND NOT u.needs_email_confirm AND u.suspended_at IS NULL''',
                        (group['id'],)).fetchall()
    visible = [member for member in members if not _blocked(c, uid, member['user_id'])]
    contributions = _contributions(c, group, visible, now)
    participants = [member['username'] for member in visible
                    if member['recap_consent'] and contributions.get(member['user_id'], 0) > 0]
    return {'event_date': group['event_date'].isoformat(), 'participants': participants,
            **({'total': answer['total']} if 'total' in answer else {'your_total': answer['your_total']})}


def _group_notice(c, group_id, recipient, actor, kind, update_id=None, week_start=None):
    if recipient == actor or _blocked(c, recipient, actor):
        return
    member = c.execute('''SELECT notifications_muted FROM group_members
                          WHERE group_id=%s AND user_id=%s AND status='active' ''', (group_id, recipient)).fetchone()
    if not member or member['notifications_muted']:
        return
    c.execute('''INSERT INTO notifications(user_id,kind,actor_id,group_id,group_update_id,group_week_start)
        VALUES(%s,%s,%s,%s,%s,%s)
        ON CONFLICT(user_id,group_id) WHERE group_id IS NOT NULL AND kind IN ('group_update','group_cheer')
        DO UPDATE SET kind=EXCLUDED.kind,actor_id=EXCLUDED.actor_id,group_update_id=EXCLUDED.group_update_id,
          group_week_start=EXCLUDED.group_week_start,created=now(),read_at=NULL,cancelled=false,push_pending=false''',
                 (recipient, kind, actor, group_id, update_id, week_start))


def _group_notice_members(c, group_id, actor, kind, update_id=None, week_start=None):
    members = c.execute('''SELECT m.user_id FROM group_members m JOIN users u ON u.id=m.user_id
        WHERE m.group_id=%s AND m.status='active' AND NOT u.needs_email_confirm AND u.suspended_at IS NULL''',
                        (group_id,)).fetchall()
    for member in members:
        _group_notice(c, group_id, member['user_id'], actor, kind, update_id, week_start)


def _group_reaction_people(c, group, uid, update_id=None, week_start=None):
    if update_id is not None:
        rows = c.execute('''SELECT u.login::text AS login,u.name,u.photo_v AS photo,r.kind,r.user_id
            FROM group_update_reactions r JOIN group_updates x ON x.id=r.update_id
            JOIN group_members m ON m.group_id=x.group_id AND m.user_id=r.user_id AND m.status='active'
            JOIN users u ON u.id=r.user_id AND NOT u.needs_email_confirm AND u.suspended_at IS NULL
            WHERE r.update_id=%s AND NOT EXISTS(SELECT 1 FROM blocks b
              WHERE (b.user_id=%s AND b.blocked=r.user_id) OR (b.user_id=r.user_id AND b.blocked=%s))
            ORDER BY r.created,r.user_id''', (update_id, uid, uid)).fetchall()
    else:
        rows = c.execute('''SELECT u.login::text AS login,u.name,u.photo_v AS photo,r.kind,r.user_id
            FROM group_weekly_reactions r JOIN group_members m ON m.group_id=r.group_id
              AND m.user_id=r.user_id AND m.status='active'
            JOIN users u ON u.id=r.user_id AND NOT u.needs_email_confirm AND u.suspended_at IS NULL
            WHERE r.group_id=%s AND r.week_start=%s AND NOT EXISTS(SELECT 1 FROM blocks b
              WHERE (b.user_id=%s AND b.blocked=r.user_id) OR (b.user_id=r.user_id AND b.blocked=%s))
            ORDER BY r.created,r.user_id''', (group['id'], week_start, uid, uid)).fetchall()
    return [{'login': row['login'], 'name': row['name'], 'photo': row['photo'] or False, 'kind': row['kind']}
            for row in rows]


def _update_reaction_rows(c, group, uid, update_id):
    return c.execute('''SELECT r.user_id,r.kind,r.created FROM group_update_reactions r
        JOIN group_updates u ON u.id=r.update_id
        JOIN group_members m ON m.group_id=u.group_id AND m.user_id=r.user_id AND m.status='active'
        JOIN users p ON p.id=r.user_id AND NOT p.needs_email_confirm AND p.suspended_at IS NULL
        WHERE r.update_id=%s AND NOT EXISTS(SELECT 1 FROM blocks b
          WHERE (b.user_id=%s AND b.blocked=r.user_id) OR (b.user_id=r.user_id AND b.blocked=%s))
        ORDER BY r.created,r.user_id''',
                       (update_id, uid, uid)).fetchall()


def _visible_update(c, group, uid, update_id):
    row = c.execute('''SELECT u.id,u.user_id,u.text,u.created,p.login::text AS username
        FROM group_updates u JOIN users p ON p.id=u.user_id
        WHERE u.id=%s AND u.group_id=%s AND NOT p.needs_email_confirm AND p.suspended_at IS NULL
          AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=%s AND b.blocked=u.user_id)
            OR (b.user_id=u.user_id AND b.blocked=%s))''', (update_id, group['id'], uid, uid)).fetchone()
    if not row:
        raise HTTPException(404, 'Group update not found')
    return row


def _group_detail(c, group, uid, answer):
    updates = _group_updates(c, group, uid)
    week_start = dt.date.fromisoformat(answer['week_start'])
    weekly_rows = _weekly_reaction_rows(c, group, uid, week_start)
    result = {'updates': updates, 'weekly_reaction': _reaction_summary(weekly_rows, uid)}
    if answer['event_state'] == 'complete':
        result['recap'] = _group_recap(c, group, uid, answer, _now())
    return result


@router.post('/api/groups')
def create_group(body: GroupCreate, request: Request, user=Depends(current_user)):
    _valid_goal(body)
    _validate_event_date(body.event_date, body.time_zone)
    with db.connect() as c:
        from . import challenges
        challenges.account_locks(c, [user['id']])
        challenges.confirmed_for_challenge(c, user['id'])
        community_filter.check(body.title, 'group name')
        community_filter.check(body.note, 'group note')
        group = c.execute('''INSERT INTO event_groups(organizer_id,title,event_date,time_zone,note,goal_type,goal_target,goal_unit)
                             VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
                          (user['id'], body.title, body.event_date, body.time_zone, body.note, body.goal_type,
                           body.goal_target, body.goal_unit)).fetchone()
        c.execute("INSERT INTO group_members(group_id,user_id) VALUES(%s,%s)", (group['id'], user['id']))
        invite_url = _new_invite(c, group, request)
        return {**_answer(c, group, user['id']), 'invite_url': invite_url}


@router.get('/api/groups')
def list_groups(user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute('''SELECT g.* FROM event_groups g JOIN group_members m ON m.group_id=g.id
                            WHERE m.user_id=%s AND m.status='active' ORDER BY g.event_date ASC NULLS LAST,g.created''',
                         (user['id'],)).fetchall()
        return [_answer(c, row, user['id']) for row in rows]


@router.get('/api/groups/activity-strip')
def group_activity_strip(user=Depends(current_user)):
    with db.connect() as c:
        preference = c.execute('SELECT group_strip_muted FROM profile WHERE user_id=%s', (user['id'],)).fetchone()
        muted = bool(preference and preference['group_strip_muted'])
        rows = c.execute('''SELECT g.* FROM event_groups g JOIN group_members m ON m.group_id=g.id
                            WHERE m.user_id=%s AND m.status='active' ORDER BY g.event_date ASC NULLS LAST,g.created''',
                         (user['id'],)).fetchall()
        now = _now()
        upcoming = [row for row in rows if row['event_date'] is None or
                    row['event_date'] >= now.astimezone(_zone(row['time_zone'])).date()]
        upcoming.sort(key=lambda row: (row['event_date'] is None,
                                       dt.datetime.combine(row['event_date'], dt.time.min,
                                                           _zone(row['time_zone'])).astimezone(UTC)
                                       if row['event_date'] else row['created'], row['created']))
        if muted or not upcoming:
            return {'muted': muted, 'has_upcoming': bool(upcoming)}
        answer = _answer(c, upcoming[0], user['id'])
        keys = ('id', 'title', 'event_date', 'time_zone', 'goal_type', 'goal_target', 'goal_unit', 'event_state',
                'member_count', 'days_to_event', 'weeks_to_event', 'total', 'your_total')
        return {'muted': False, 'has_upcoming': True, 'more_count': len(upcoming) - 1,
                'next': {key: answer[key] for key in keys if key in answer}}


@router.post('/api/groups/activity-strip')
def set_group_activity_strip(body: GroupStripPreference, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('''INSERT INTO profile(user_id,group_strip_muted) VALUES(%s,%s)
                     ON CONFLICT(user_id) DO UPDATE SET group_strip_muted=EXCLUDED.group_strip_muted''',
                  (user['id'], body.muted))
    return {'muted': body.muted}


@router.get('/api/groups/{group_id}')
def get_group(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        answer = _answer(c, group, user['id'])
        return {**answer, **_group_detail(c, group, user['id'], answer)}


@router.patch('/api/groups/{group_id}/event-date')
def update_group_event_date(group_id: str, body: GroupEventDate, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        if group['closed_at']:
            raise HTTPException(409, 'This group is closed')
        now = _now()
        if group['event_date'] is not None and now.astimezone(_zone(group['time_zone'])).date() > group['event_date']:
            raise HTTPException(409, 'This group has ended and its event date cannot be changed')
        _validate_event_date(body.event_date, group['time_zone'], now)
        updated = c.execute('UPDATE event_groups SET event_date=%s WHERE id=%s RETURNING *',
                            (body.event_date, group['id'])).fetchone()
        return _answer(c, updated, user['id'])


@router.post('/api/groups/{group_id}/updates')
def create_group_update(group_id: str, body: GroupUpdateCreate, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'], lock=True)
        if group['closed_at']:
            raise HTTPException(409, 'This group is closed')
        from . import challenges
        challenges.confirmed_for_challenge(c, user['id'])
        community_filter.public(c, user['id'], ('group update', body.text))
        from .signup import social_action
        social_action(c, user['id'], 'comment')
        row = c.execute('''INSERT INTO group_updates(group_id,user_id,text) VALUES(%s,%s,%s) RETURNING id''',
                        (group['id'], user['id'], body.text)).fetchone()
        _group_notice_members(c, group['id'], user['id'], 'group_update', update_id=row['id'])
        return next(update for update in _group_updates(c, group, user['id']) if update['id'] == row['id'])


@router.delete('/api/groups/{group_id}/updates/{update_id}')
def delete_group_update(group_id: str, update_id: int, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'], lock=True)
        row = _visible_update(c, group, user['id'], update_id)
        if row['user_id'] != user['id'] and group['organizer_id'] != user['id']:
            raise HTTPException(404, 'Group update not found')
        c.execute('DELETE FROM group_updates WHERE id=%s AND group_id=%s', (update_id, group['id']))
    return {'ok': True}


@router.post('/api/groups/{group_id}/updates/{update_id}/report')
def report_group_update(group_id: str, update_id: int, body: GroupReport, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        update = _visible_update(c, group, user['id'], update_id)
        if update['user_id'] == user['id']:
            raise HTTPException(400, "You can't report your own update")
        if c.execute("SELECT count(*) AS n FROM reports WHERE reporter=%s AND status='open'", (user['id'],)).fetchone()['n'] >= 20:
            raise HTTPException(429, 'You have a lot of reports waiting - the admins will get to them')
        what = f'Group update in {group["title"]} by @{update["username"]}: "{update["text"]}"'
        rid = c.execute('''INSERT INTO reports(reporter,person,kind,what,reason,note,group_id)
            VALUES(%s,%s,'group',%s,%s,%s,%s) RETURNING id''',
                        (user['id'], update['user_id'], what[:1000], body.reason,
                         (body.note or '').strip() or None, group['id'])).fetchone()['id']
        for admin in c.execute('SELECT id FROM users WHERE is_admin AND id<>%s', (user['id'],)).fetchall():
            notify.add(c, admin['id'], 'report', user['id'])
    return {'ok': True, 'id': rid}


@router.post('/api/groups/{group_id}/updates/{update_id}/reaction')
def react_to_group_update(group_id: str, update_id: int, body: GroupReaction, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        if group['closed_at']:
            raise HTTPException(409, 'This group is closed')
        update = _visible_update(c, group, user['id'], update_id)
        changed = c.execute('''INSERT INTO group_update_reactions(update_id,user_id,kind) VALUES(%s,%s,%s)
            ON CONFLICT(update_id,user_id) DO UPDATE SET kind=EXCLUDED.kind
            WHERE group_update_reactions.kind<>EXCLUDED.kind RETURNING user_id''',
                            (update_id, user['id'], body.kind)).fetchone()
        if changed:
            _group_notice(c, group['id'], update['user_id'], user['id'], 'group_cheer', update_id=update_id)
        return _reaction_summary(_update_reaction_rows(c, group, user['id'], update_id), user['id'])


@router.delete('/api/groups/{group_id}/updates/{update_id}/reaction')
def remove_group_update_reaction(group_id: str, update_id: int, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        _visible_update(c, group, user['id'], update_id)
        c.execute('DELETE FROM group_update_reactions WHERE update_id=%s AND user_id=%s', (update_id, user['id']))
        return _reaction_summary(_update_reaction_rows(c, group, user['id'], update_id), user['id'])


@router.get('/api/groups/{group_id}/updates/{update_id}/reactions')
def group_update_reaction_people(group_id: str, update_id: int, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        _visible_update(c, group, user['id'], update_id)
        return {'cheers': _group_reaction_people(c, group, user['id'], update_id=update_id)}


def _current_group_week(group, now):
    local_day = now.astimezone(_zone(group['time_zone'])).date()
    if group['event_date'] is not None and local_day > group['event_date']:
        raise HTTPException(409, 'This group event has ended')
    return local_day - dt.timedelta(days=local_day.weekday())


@router.post('/api/groups/{group_id}/weekly-reaction')
def react_to_group_week(group_id: str, body: GroupReaction, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        if group['closed_at']:
            raise HTTPException(409, 'This group is closed')
        week_start = _current_group_week(group, _now())
        changed = c.execute('''INSERT INTO group_weekly_reactions(group_id,week_start,user_id,kind)
            VALUES(%s,%s,%s,%s) ON CONFLICT(group_id,week_start,user_id) DO UPDATE SET kind=EXCLUDED.kind
            WHERE group_weekly_reactions.kind<>EXCLUDED.kind RETURNING user_id''',
                            (group['id'], week_start, user['id'], body.kind)).fetchone()
        if changed:
            _group_notice_members(c, group['id'], user['id'], 'group_cheer', week_start=week_start)
        return _reaction_summary(_weekly_reaction_rows(c, group, user['id'], week_start), user['id'])


@router.delete('/api/groups/{group_id}/weekly-reaction')
def remove_group_week_reaction(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        week_start = _current_group_week(group, _now())
        c.execute('DELETE FROM group_weekly_reactions WHERE group_id=%s AND week_start=%s AND user_id=%s',
                  (group['id'], week_start, user['id']))
        return _reaction_summary(_weekly_reaction_rows(c, group, user['id'], week_start), user['id'])


@router.get('/api/groups/{group_id}/weekly-reactions')
def group_week_reaction_people(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        week_start = _current_group_week(group, _now())
        return {'cheers': _group_reaction_people(c, group, user['id'], week_start=week_start)}


@router.post('/api/groups/{group_id}/recap-consent')
def set_group_recap_consent(group_id: str, body: GroupRecapConsent, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        c.execute('UPDATE group_members SET recap_consent=%s WHERE group_id=%s AND user_id=%s AND status=\'active\'',
                  (body.consent, group['id'], user['id']))
    return {'consent': body.consent}


@router.post('/api/groups/{group_id}/notifications')
def set_group_notification_mute(group_id: str, body: GroupNotificationPreference, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'], lock=True)
        c.execute('UPDATE group_members SET notifications_muted=%s WHERE group_id=%s AND user_id=%s',
                  (body.muted, group['id'], user['id']))
        if body.muted:
            c.execute("DELETE FROM notifications WHERE user_id=%s AND group_id=%s AND kind IN ('group_update','group_cheer')",
                      (user['id'], group['id']))
    return {'muted': body.muted}


@router.get('/api/group-invites/{token}')
def invite_preview(token: str, request: Request):
    _limit_invite_preview(request)
    with db.connect() as c:
        _invite(c, token)
    return {'available': True}


def _limit_invite_ip(c, request):
    ip = auth.client_ip(request)
    ip_hash = hashlib.sha256(ip.encode('utf-8')).hexdigest()
    return account_email.limited(c, f'group-invite-ip:{ip_hash}', 40, 15)


def _limit_invite_preview(request):
    with db.connect() as c:
        by_ip = _limit_invite_ip(c, request)
    if by_ip:
        raise HTTPException(429, 'Too many invite attempts. Wait 15 minutes.')


def _limit_accept(request, uid):
    with db.connect() as c:
        by_user = account_email.limited(c, f'group-accept-user:{uid}', 10, 15)
        by_ip = _limit_invite_ip(c, request)
    if by_user or by_ip:
        raise HTTPException(429, 'Too many invite attempts. Wait 15 minutes.')


@router.post('/api/group-invites/{token}/accept')
def accept_invite(token: str, request: Request, user=Depends(current_user)):
    _limit_accept(request, user['id'])
    with db.connect() as c:
        invitation = _invite(c, token)
        group_id = invitation['group_id']
        from . import challenges
        other_ids = [r['user_id'] for r in c.execute("SELECT user_id FROM group_members WHERE group_id=%s AND status='active'", (group_id,)).fetchall()]
        challenges.account_locks(c, [user['id'], *other_ids])
        group_id = _group_id(group_id)
        group = c.execute('SELECT * FROM event_groups WHERE id=%s FOR UPDATE', (group_id,)).fetchone()
        invitation = _invite(c, token)
        challenges.confirmed_for_challenge(c, user['id'])
        if not group or group['closed_at'] or group['joining_closed']:
            raise HTTPException(404, INVITE_UNAVAILABLE)
        if _active_member(c, group_id, user['id']):
            return _answer(c, group, user['id'])
        prior = c.execute('SELECT * FROM group_members WHERE group_id=%s AND user_id=%s FOR UPDATE', (group_id, user['id'])).fetchone()
        if prior and prior['status'] == 'removed' and invitation['generation'] <= prior['removed_invite_generation']:
            raise HTTPException(404, INVITE_UNAVAILABLE)
        count = c.execute("SELECT count(*) AS n FROM group_members WHERE group_id=%s AND status='active'", (group_id,)).fetchone()['n']
        if count >= MAX_MEMBERS:
            raise HTTPException(409, 'This group already has 50 members')
        if any(_blocked(c, user['id'], other) for other in other_ids):
            raise HTTPException(404, INVITE_UNAVAILABLE)
        c.execute('''INSERT INTO group_members(group_id,user_id,status,joined_at,removed_invite_generation)
                     VALUES(%s,%s,'active',now(),NULL)
                     ON CONFLICT(group_id,user_id) DO UPDATE SET status='active',joined_at=now(),removed_invite_generation=NULL''',
                  (group_id, user['id']))
        group = c.execute('SELECT * FROM event_groups WHERE id=%s', (group_id,)).fetchone()
        return _answer(c, group, user['id'])


def _organizer_group(c, group_id, uid, lock=False):
    group = _group(c, group_id, uid, lock)
    if group['organizer_id'] != uid:
        raise HTTPException(404, GROUP_MISSING)
    return group


@router.post('/api/groups/{group_id}/invites')
def rotate_invite(group_id: str, request: Request, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        if group['closed_at']:
            raise HTTPException(409, 'This group is closed')
        return {'invite_url': _new_invite(c, group, request)}


@router.post('/api/groups/{group_id}/stop-joining')
def stop_joining(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        c.execute('UPDATE event_groups SET joining_closed=true WHERE id=%s', (group['id'],))
        c.execute('UPDATE group_invites SET revoked_at=now() WHERE group_id=%s AND revoked_at IS NULL', (group['id'],))
    return {'ok': True}


@router.post('/api/groups/{group_id}/transfer')
def transfer_organizer(group_id: str, body: MemberAction, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        target = c.execute('''SELECT u.id FROM users u JOIN group_members m ON m.user_id=u.id
                              WHERE m.group_id=%s AND m.status='active' AND lower(u.login)=lower(%s)
                                AND NOT u.needs_email_confirm AND u.suspended_at IS NULL''',
                           (group['id'], body.username.strip())).fetchone()
        if not target or target['id'] == user['id'] or _blocked(c, user['id'], target['id']):
            raise HTTPException(404, 'Choose an active group member')
        c.execute('UPDATE event_groups SET organizer_id=%s WHERE id=%s', (target['id'], group['id']))
    return {'ok': True}


@router.post('/api/groups/{group_id}/close')
def close_group(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        c.execute('UPDATE event_groups SET closed_at=now(),joining_closed=true WHERE id=%s', (group['id'],))
        c.execute('UPDATE group_invites SET revoked_at=now() WHERE group_id=%s AND revoked_at IS NULL', (group['id'],))
    return {'ok': True}


@router.post('/api/groups/{group_id}/remove')
def remove_member(group_id: str, body: MemberAction, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        target = c.execute('''SELECT u.id FROM users u JOIN group_members m ON m.user_id=u.id
                              WHERE m.group_id=%s AND m.status='active' AND lower(u.login)=lower(%s)''',
                           (group['id'], body.username.strip())).fetchone()
        if not target or target['id'] == user['id']:
            raise HTTPException(404, 'Group member not found')
        c.execute("UPDATE group_members SET status='removed',removed_invite_generation=%s WHERE group_id=%s AND user_id=%s",
                  (group['invite_generation'], group['id'], target['id']))
        c.execute('DELETE FROM notifications WHERE user_id=%s AND group_id=%s', (target['id'], group['id']))
    return {'ok': True}


@router.post('/api/groups/{group_id}/leave')
def leave_group(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'], lock=True)
        count = c.execute("SELECT count(*) AS n FROM group_members WHERE group_id=%s AND status='active'", (group['id'],)).fetchone()['n']
        if group['organizer_id'] == user['id'] and count > 1:
            raise HTTPException(409, 'Transfer organizer before leaving this group')
        if group['organizer_id'] == user['id']:
            c.execute('UPDATE event_groups SET closed_at=coalesce(closed_at,now()),joining_closed=true WHERE id=%s', (group['id'],))
            c.execute('UPDATE group_invites SET revoked_at=now() WHERE group_id=%s AND revoked_at IS NULL', (group['id'],))
        c.execute("UPDATE group_members SET status='left',removed_invite_generation=NULL WHERE group_id=%s AND user_id=%s",
                  (group['id'], user['id']))
        c.execute('DELETE FROM notifications WHERE user_id=%s AND group_id=%s', (user['id'], group['id']))
    return {'ok': True}


@router.post('/api/groups/{group_id}/report')
def report_group(group_id: str, body: GroupReport, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        n = c.execute("SELECT count(*) AS n FROM reports WHERE reporter=%s AND status='open'", (user['id'],)).fetchone()['n']
        if n >= 20:
            raise HTTPException(429, 'You have a lot of reports waiting - the admins will get to them')
        rid = c.execute('''INSERT INTO reports(reporter,person,kind,what,reason,note,group_id)
                           VALUES(%s,%s,'group',%s,%s,%s,%s) RETURNING id''',
                        (user['id'], group['organizer_id'], 'Group: ' + group['title'], body.reason,
                         (body.note or '').strip() or None, group['id'])).fetchone()['id']
        for admin in c.execute('SELECT id FROM users WHERE is_admin AND id<>%s', (user['id'],)).fetchall():
            notify.add(c, admin['id'], 'report', user['id'])
    return {'ok': True, 'id': rid}
