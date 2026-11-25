"""Private event groups: explicit invitations, member-only details and aggregate-only progress."""
import datetime as dt
import hashlib
import hmac
import os
import secrets
import threading
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

from . import account_email, auth, community_filter, db, notify, reactions
from .group_limits import MAX_MEMBERS
from .parsers import SPORTS as ACTIVITY_SPORTS
from .auth import current_user

router = APIRouter()
UTC = dt.timezone.utc
INVITE_TTL = dt.timedelta(days=30)
INVITE_UNAVAILABLE = 'This group invite is not available.'
GROUP_MISSING = 'Group not found.'
KINDS = {'distance', 'elevation', 'long_outings', 'sessions'}
UNITS = {'km', 'mi', 'm', 'ft', 'outings', 'sessions'}
GROUP_SPORTS = tuple(ACTIVITY_SPORTS)
MAX_LIVE_INVITES = 20
LONG_OUTING_SECONDS = 3600
_GROUP_TOTAL_SHARING_SQL = "(m.sharing_level='total_shared' AND coalesce(p.share_achievements,false))"


class GroupCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=80)
    event_date: dt.date | None = None
    time_zone: str = Field(min_length=1, max_length=80)
    note: str = Field('', max_length=280)
    goal_type: str
    goal_target: float = Field(gt=0, le=1_000_000, allow_inf_nan=False)
    goal_unit: str
    goal_sports: list[str] = Field(default_factory=lambda: list(GROUP_SPORTS), min_length=1, max_length=len(GROUP_SPORTS))
    goal_start_date: dt.date | None = None
    training_for: str = Field('', max_length=80)

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

    @field_validator('goal_sports')
    @classmethod
    def valid_goal_sports(cls, value):
        if len(set(value)) != len(value) or any(sport not in GROUP_SPORTS for sport in value):
            raise ValueError('Choose one or more valid sports')
        return [sport for sport in GROUP_SPORTS if sport in value]

    @field_validator('training_for')
    @classmethod
    def clean_training_for(cls, value):
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


class GroupInviteAction(BaseModel):
    """Invite sheet action: opening preserves links; an explicit renewal rotates them."""
    model_config = ConfigDict(extra='forbid')
    rotate: StrictBool = False


class GroupLinkJoin(BaseModel):
    model_config = ConfigDict(extra='forbid')
    # Omitted by older clients must fail closed; current invite screens send an
    # explicit value from the visible, default-on sharing switch.
    share_total: StrictBool = False


class GroupFriendInviteCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=60)

    @field_validator('username')
    @classmethod
    def clean_username(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Enter a username')
        return value


class GroupFriendInviteAccept(BaseModel):
    model_config = ConfigDict(extra='forbid')
    share_total: StrictBool = False


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


class GroupMondayRecapPreference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    enabled: StrictBool


class GroupSharingPreference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    level: str = Field(pattern='^(total_shared|just_in)$')


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


def _goal_start_at(group):
    return dt.datetime.combine(group['goal_start_date'], dt.time.min, _zone(group['time_zone'])).astimezone(UTC)


def _validate_goal_start(goal_start_date, event_date, time_zone):
    today = _now().astimezone(_zone(time_zone)).date()
    try:
        one_year_ago = today.replace(year=today.year - 1)
    except ValueError:
        one_year_ago = today.replace(year=today.year - 1, day=28)
    if goal_start_date < one_year_ago:
        raise HTTPException(422, 'Choose a goal start date within the past year')
    if event_date is None and goal_start_date > today:
        raise HTTPException(422, 'An ongoing group cannot start in the future')
    if event_date is not None and goal_start_date > event_date:
        raise HTTPException(422, 'The goal start date must be on or before the event date')


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


def _new_invite(c, group, request, *, rotate=True):
    token = secrets.token_bytes(16).hex()
    generation = group['invite_generation'] + 1
    if rotate:
        c.execute('UPDATE group_invites SET revoked_at=now() WHERE group_id=%s AND revoked_at IS NULL', (group['id'],))
        c.execute('''UPDATE event_groups SET invite_generation=%s,joining_closed=false
                     WHERE id=%s''', (generation, group['id']))
    else:
        c.execute('UPDATE event_groups SET invite_generation=%s WHERE id=%s', (generation, group['id']))
    c.execute('''INSERT INTO group_invites(group_id,generation,token_hash,expires_at)
                 VALUES(%s,%s,%s,%s)''', (group['id'], generation, _token_hash(token), dt.datetime.now(UTC) + INVITE_TTL))
    c.execute('''UPDATE group_invites SET revoked_at=now()
                 WHERE id IN (
                   SELECT id FROM group_invites
                   WHERE group_id=%s AND revoked_at IS NULL AND expires_at>now()
                   ORDER BY created_at DESC,id DESC OFFSET %s
                 )''', (group['id'], MAX_LIVE_INVITES))
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
            or row['joining_closed'] or row['closed_at']):
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


def _accepted_friends(c, uid):
    return c.execute('''SELECT u.id,u.login FROM friendships f
        JOIN users u ON u.id=CASE WHEN f.requester=%s THEN f.addressee ELSE f.requester END
        WHERE f.status='accepted' AND (f.requester=%s OR f.addressee=%s)
          AND NOT u.needs_email_confirm AND u.suspended_at IS NULL AND u.password_change_expires IS NULL
          AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=%s AND b.blocked=u.id)
            OR (b.user_id=u.id AND b.blocked=%s))
        ORDER BY u.login''', (uid,uid,uid,uid,uid)).fetchall()


def _friend_pair(c, first, second):
    return bool(c.execute('''SELECT 1 FROM friendships WHERE status='accepted'
        AND ((requester=%s AND addressee=%s) OR (requester=%s AND addressee=%s))''',
        (first,second,second,first)).fetchone())


def _invite_accounts_ready(c, *ids):
    rows=c.execute('''SELECT id FROM users WHERE id=ANY(%s) AND NOT needs_email_confirm
        AND suspended_at IS NULL AND password_change_expires IS NULL''',(list(ids),)).fetchall()
    return {row['id'] for row in rows}==set(ids)


def _friend_invite_unavailable(c, invite, invitee_id, *, check_capacity=True):
    if (not invite or invite['invitee_id']!=invitee_id or invite['status']!='pending'
            or invite['expires_at']<=_now()):
        return True
    group=c.execute('SELECT * FROM event_groups WHERE id=%s',(invite['group_id'],)).fetchone()
    if not group or group['closed_at'] or group['joining_closed']:
        return True
    if not c.execute("SELECT 1 FROM group_members WHERE group_id=%s AND user_id=%s AND status='active'",
                     (group['id'],invite['inviter_id'])).fetchone():
        return True
    if not _invite_accounts_ready(c,invite['inviter_id'],invitee_id):
        return True
    if not _friend_pair(c,invite['inviter_id'],invitee_id):
        return True
    prior=c.execute('SELECT status FROM group_members WHERE group_id=%s AND user_id=%s',
                    (group['id'],invitee_id)).fetchone()
    # A removed person can only return with a fresh organizer link.
    if prior and prior['status']=='removed':
        return True
    members=[r['user_id'] for r in c.execute("SELECT user_id FROM group_members WHERE group_id=%s AND status='active'",
                                               (group['id'],)).fetchall()]
    if any(_blocked(c,invitee_id,member) for member in members):
        return True
    if check_capacity:
        count=c.execute("SELECT count(*) AS n FROM group_members WHERE group_id=%s AND status='active'",
                        (group['id'],)).fetchone()['n']
        if count>=MAX_MEMBERS:
            return True
    return False


def _clear_friend_invite_notices(c, invite_ids):
    ids=list(invite_ids)
    if ids:
        c.execute("DELETE FROM notifications WHERE kind='group_invite' AND group_friend_invite_id=ANY(%s)",(ids,))


def _revoke_friend_invites(c, group_id, inviter_id=None, invitee_id=None):
    params=[group_id]
    where="group_id=%s AND status IN ('pending','declined')"
    if inviter_id is not None:
        where+=' AND inviter_id=%s'
        params.append(inviter_id)
    if invitee_id is not None:
        where+=' AND invitee_id=%s'
        params.append(invitee_id)
    rows=c.execute("UPDATE group_friend_invites SET status='revoked',responded_at=NULL WHERE "+where+' RETURNING id',params).fetchall()
    _clear_friend_invite_notices(c,[r['id'] for r in rows])


def _revoke_friend_invites_between(c, first_id, second_id):
    rows=c.execute("""UPDATE group_friend_invites SET status='revoked',responded_at=NULL
        WHERE status IN ('pending','declined') AND
          ((inviter_id=%s AND invitee_id=%s) OR (inviter_id=%s AND invitee_id=%s))
        RETURNING id""",(first_id,second_id,second_id,first_id)).fetchall()
    _clear_friend_invite_notices(c,[r['id'] for r in rows])


def _consume_pending_friend_invites(c, group_id, invitee_id):
    rows=c.execute('''UPDATE group_friend_invites SET status='accepted',responded_at=now()
        WHERE group_id=%s AND invitee_id=%s AND status='pending' AND expires_at>now() RETURNING id''',
        (group_id,invitee_id)).fetchall()
    _clear_friend_invite_notices(c,[r['id'] for r in rows])


def _contributions(c, group, members, now=None):
    now = now or _now()
    zone = _zone(group['time_zone'])
    event_date = group['event_date']
    group_start = _goal_start_at(group)
    end = (dt.datetime.combine(event_date + dt.timedelta(days=1), dt.time.min, zone).astimezone(UTC)
           if event_date else now)
    visible_ids = [member['user_id'] for member in members]
    if not visible_ids:
        return {}
    # All selected means legacy/unlisted sport values still count for old groups.
    all_sports = set(group['goal_sports']) == set(GROUP_SPORTS)
    measures = {
        'distance': "sum(a.distance_m) FILTER(WHERE a.distance_m>0 AND a.distance_m<'Infinity'::real)",
        'elevation': "sum(a.ascent_m) FILTER(WHERE a.ascent_m>0 AND a.ascent_m<'Infinity'::real)",
        'long_outings': f"count(a.id) FILTER(WHERE coalesce(a.moving_s,a.elapsed_s,0)>={LONG_OUTING_SECONDS})",
        'sessions': 'count(a.id)',
    }
    rows = c.execute(f'''SELECT m.user_id,coalesce({measures[group['goal_type']]},0) AS raw
      FROM group_members m LEFT JOIN activities a ON a.user_id=m.user_id
        AND a.start_time>=greatest(m.joined_at,%s::timestamptz)
        AND a.start_time<least(%s::timestamptz,%s) AND (%s::boolean OR a.sport=ANY(%s::text[]))
        AND a.visibility<>'me' AND NOT a.lift_open
      WHERE m.group_id=%s AND m.status='active' AND m.user_id=ANY(%s)
      GROUP BY m.user_id''', (group_start, end, now, all_sports, group['goal_sports'], group['id'], visible_ids)).fetchall()
    divisor = (1609.344 if group['goal_unit'] == 'mi' else 1000) if group['goal_type'] == 'distance' else (
        0.3048 if group['goal_type'] == 'elevation' and group['goal_unit'] == 'ft' else 1)
    return {row['user_id']: round(float(row['raw'] or 0) / divisor, 3) for row in rows}


def _weekly_contributions(c, group, members, now):
    return _period_contributions(c, group, members, now)


def _period_contributions(c, group, members, now, monday=None):
    local_day, current_start, current_end = _local_week_window(group['time_zone'], now)
    if monday is None:
        start, week_end = current_start, current_end
    else:
        zone = _zone(group['time_zone'])
        start = dt.datetime.combine(monday, dt.time.min, zone).astimezone(UTC)
        week_end = dt.datetime.combine(monday + dt.timedelta(days=7), dt.time.min, zone).astimezone(UTC)
    zone = _zone(group['time_zone'])
    event_date = group['event_date']
    group_start = _goal_start_at(group)
    event_end = (dt.datetime.combine(event_date + dt.timedelta(days=1), dt.time.min, zone).astimezone(UTC)
                 if event_date else now)
    end = min(week_end, event_end, now)
    visible_ids = [member['user_id'] for member in members]
    if not visible_ids or end <= start:
        return local_day, {}
    # Keep the all-sports interpretation identical in lifetime and weekly totals.
    all_sports = set(group['goal_sports']) == set(GROUP_SPORTS)
    measures = {
        'distance': "sum(a.distance_m) FILTER(WHERE a.distance_m>0 AND a.distance_m<'Infinity'::real)",
        'elevation': "sum(a.ascent_m) FILTER(WHERE a.ascent_m>0 AND a.ascent_m<'Infinity'::real)",
        'long_outings': f"count(a.id) FILTER(WHERE coalesce(a.moving_s,a.elapsed_s,0)>={LONG_OUTING_SECONDS})",
        'sessions': 'count(a.id)',
    }
    rows = c.execute(f'''SELECT m.user_id,coalesce({measures[group['goal_type']]},0) AS raw
      FROM group_members m LEFT JOIN activities a ON a.user_id=m.user_id
        AND a.start_time>=greatest(m.joined_at,%s::timestamptz,%s::timestamptz)
        AND a.start_time<%s::timestamptz AND (%s::boolean OR a.sport=ANY(%s::text[]))
        AND a.visibility<>'me' AND NOT a.lift_open
      WHERE m.group_id=%s AND m.status='active' AND m.user_id=ANY(%s)
      GROUP BY m.user_id''', (group_start, start, end, all_sports, group['goal_sports'], group['id'], visible_ids)).fetchall()
    divisor = (1609.344 if group['goal_unit'] == 'mi' else 1000) if group['goal_type'] == 'distance' else (
        0.3048 if group['goal_type'] == 'elevation' and group['goal_unit'] == 'ft' else 1)
    return (monday if monday is not None else local_day), {row['user_id']: round(float(row['raw'] or 0) / divisor, 3) for row in rows}


def _answer(c, group, uid):
    members = c.execute(f'''SELECT m.user_id,m.joined_at,m.recap_consent,m.notifications_muted,m.monday_recap_enabled,m.sharing_level,
                                   u.login::text AS username,u.photo_v AS photo,
                                   {_GROUP_TOTAL_SHARING_SQL} AS share_total
                            FROM group_members m JOIN users u ON u.id=m.user_id
                            LEFT JOIN profile p ON p.user_id=u.id
                            WHERE m.group_id=%s AND m.status='active' AND NOT u.needs_email_confirm
                              AND u.suspended_at IS NULL ORDER BY m.joined_at,m.user_id''', (group['id'],)).fetchall()
    visible = [member for member in members if not _blocked(c, uid, member['user_id'])]
    visible.sort(key=lambda member: (member['user_id'] != uid, member['username'].casefold(), member['user_id']))
    sharing = [member for member in visible if member['share_total']]
    now = _now()
    contributions = _contributions(c, group, sharing, now)
    local_day, weekly = _weekly_contributions(c, group, sharing, now)
    total = round(sum(contributions.values()), 3)
    member_count = len(visible)
    sharing_member_count = len(sharing)
    zone = _zone(group['time_zone'])
    today = now.astimezone(zone).date()
    event_date = group['event_date']
    days_to_event = max(0, (event_date - today).days) if event_date else None
    week_total = round(sum(weekly.values()), 3)
    me = next(member for member in members if member['user_id'] == uid)
    monday = local_day - dt.timedelta(days=local_day.weekday())
    local_now = now.astimezone(zone)
    recap_available = local_now.weekday() != 0 or local_now.timetz().replace(tzinfo=None) >= dt.time(9, 0)
    previous_monday = monday - dt.timedelta(days=7) if recap_available else None
    recap_week = (_period_contributions(c, group, sharing, now, previous_monday)[1]
                  if previous_monday is not None and member_count >= 3 else {})
    own_total = contributions.get(uid, 0) if me['share_total'] else _contributions(c, group, [me], now).get(uid, 0)
    own_week = weekly.get(uid, 0) if me['share_total'] else _weekly_contributions(c, group, [me], now)[1].get(uid, 0)
    has_shared_totals = bool(sharing)
    visible_total = total if has_shared_totals else own_total
    weeks_to_event = (days_to_event + 6) // 7 if days_to_event is not None else None
    weekly_target = (round(max(0, float(group['goal_target']) - visible_total) / weeks_to_event, 1)
                     if has_shared_totals and weeks_to_event and weeks_to_event > 0 else None)
    return {
        'id': str(group['id']), 'title': group['title'],
        'event_date': event_date.isoformat() if event_date else None,
        'time_zone': group['time_zone'], 'note': group['note'], 'goal_type': group['goal_type'],
        'goal_target': group['goal_target'], 'goal_unit': group['goal_unit'],
        'goal_sports': list(group['goal_sports']), 'goal_start_date': group['goal_start_date'].isoformat(),
        'training_for': group['training_for'], 'weekly_target': weekly_target,
        'weekly_target_scope': 'group' if weekly_target is not None else None,
        **({'total': total, 'sharing_member_count': sharing_member_count}
           if has_shared_totals else {'your_total': own_total}),
        **({'this_week_total': week_total}
           if has_shared_totals else {'your_this_week_total': own_week}),
        'week_start': (local_day - dt.timedelta(days=local_day.weekday())).isoformat(),
        'monday_recap': ({'week_start': previous_monday.isoformat(), 'total': round(sum(recap_week.values()), 3)}
                         if previous_monday is not None and member_count >= 3 else None),
        'days_to_event': days_to_event,
        'weeks_to_event': weeks_to_event,
        'event_state': ('ongoing' if event_date is None else
                        'upcoming' if today < event_date else 'today' if today == event_date else 'complete'),
        'sharing_level': me['sharing_level'],
        'members': [{'username': m['username'], 'photo': m['photo'] or False,
                     'organizer': m['user_id'] == group['organizer_id'],
                     **({'value': contributions.get(m['user_id'], 0)} if m['share_total'] else {}),
                     'shares_total': bool(m['share_total'])}
                    for m in visible],
        'member_count': member_count, 'is_organizer': uid == group['organizer_id'],
        'recap_consent': bool(me['recap_consent']), 'notifications_muted': bool(me['notifications_muted']),
        'monday_recap_enabled': bool(me['monday_recap_enabled']),
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
    members = c.execute(f'''SELECT m.user_id,m.joined_at,m.recap_consent,m.sharing_level,
                                   u.login::text AS username,
                                   {_GROUP_TOTAL_SHARING_SQL} AS share_total
        FROM group_members m JOIN users u ON u.id=m.user_id
        LEFT JOIN profile p ON p.user_id=u.id
        WHERE m.group_id=%s AND m.status='active' AND NOT u.needs_email_confirm AND u.suspended_at IS NULL''',
                        (group['id'],)).fetchall()
    visible_members = [member for member in members if not _blocked(c, uid, member['user_id'])]
    visible = [member for member in visible_members if member['share_total']]
    contributions = _contributions(c, group, visible, now)
    participants = [member['username'] for member in visible
                    if member['recap_consent'] and contributions.get(member['user_id'], 0) > 0]
    if len(visible_members) < 3 or 'total' not in answer:
        me = next((member for member in members if member['user_id'] == uid), None)
        own = _contributions(c, group, [me], now).get(uid, 0) if me else 0
        return {'event_date': group['event_date'].isoformat(), 'participants': participants, 'your_total': own}
    return {'event_date': group['event_date'].isoformat(), 'participants': participants,
            'total': answer['total']}


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
    start_date = body.goal_start_date or _now().astimezone(_zone(body.time_zone)).date()
    _validate_goal_start(start_date, body.event_date, body.time_zone)
    with db.connect() as c:
        from . import challenges
        challenges.account_locks(c, [user['id']])
        challenges.confirmed_for_challenge(c, user['id'])
        community_filter.check(body.title, 'group name')
        community_filter.check(body.note, 'group note')
        community_filter.check(body.training_for, 'training goal')
        group = c.execute('''INSERT INTO event_groups(organizer_id,title,event_date,time_zone,note,goal_type,goal_target,goal_unit,
                                                      goal_sports,goal_start_date,training_for)
                             VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
                          (user['id'], body.title, body.event_date, body.time_zone, body.note, body.goal_type,
                           body.goal_target, body.goal_unit, body.goal_sports, start_date, body.training_for)).fetchone()
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
                'member_count', 'sharing_member_count', 'days_to_event', 'weeks_to_event', 'total', 'your_total')
        return {'muted': False, 'has_upcoming': True, 'more_count': len(upcoming) - 1,
                'next': {key: answer[key] for key in keys if key in answer}}


@router.post('/api/groups/activity-strip')
def set_group_activity_strip(body: GroupStripPreference, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('UPDATE profile SET group_strip_muted=%s WHERE user_id=%s', (body.muted, user['id']))
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
        if body.event_date is None and group['goal_start_date'] > now.astimezone(_zone(group['time_zone'])).date():
            raise HTTPException(422, 'An ongoing group cannot start in the future')
        if body.event_date is not None and body.event_date < group['goal_start_date']:
            raise HTTPException(422, 'The event date must be on or after the goal start date')
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


@router.post('/api/groups/{group_id}/monday-recap')
def set_group_monday_recap(group_id: str, body: GroupMondayRecapPreference, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'], lock=True)
        changed = c.execute('''UPDATE group_members SET monday_recap_enabled=%s
                               WHERE group_id=%s AND user_id=%s AND status='active' RETURNING user_id''',
                            (body.enabled, group['id'], user['id'])).fetchone()
        if not changed:
            raise HTTPException(404, GROUP_MISSING)
        if not body.enabled:
            c.execute("DELETE FROM notifications WHERE user_id=%s AND group_id=%s AND kind='group_monday_recap'",
                      (user['id'], group['id']))
    return {'enabled': body.enabled}


@router.post('/api/groups/{group_id}/sharing')
def set_group_sharing_level(group_id: str, body: GroupSharingPreference, user=Depends(current_user)):
    with db.connect() as c:
        group = _group(c, group_id, user['id'])
        updated = c.execute('UPDATE group_members SET sharing_level=%s WHERE group_id=%s AND user_id=%s AND status=\'active\'',
                            (body.level, group['id'], user['id']))
        if updated.rowcount != 1:
            raise HTTPException(404, GROUP_MISSING)
    return {'level': body.level}


def monday_recap_tick(now=None):
    """Create one private bell alert per opted-in member when a group's local Monday recap opens."""
    now = now or _now()
    with db.connect() as c:
        groups = c.execute('''SELECT g.id,g.time_zone FROM event_groups g WHERE g.closed_at IS NULL
          AND (SELECT count(*) FROM group_members active
               WHERE active.group_id=g.id AND active.status='active')>=3
          AND EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.status='active'
            AND m.monday_recap_enabled AND NOT m.notifications_muted) ORDER BY g.id''').fetchall()
    sent = 0
    for group in groups:
        zone = _zone(group['time_zone'])
        local = now.astimezone(zone)
        if local.weekday() != 0 or local.timetz().replace(tzinfo=None) < dt.time(9, 0):
            continue
        current_monday = local.date()
        last_monday = current_monday - dt.timedelta(days=7)
        with db.connect() as c:
            claim = c.execute('''INSERT INTO group_monday_recaps(group_id,week_start) VALUES(%s,%s)
                                 ON CONFLICT DO NOTHING RETURNING group_id''',
                              (group['id'], last_monday)).fetchone()
            if not claim:
                continue
            members = c.execute('''SELECT m.user_id FROM group_members m JOIN users u ON u.id=m.user_id
                WHERE m.group_id=%s AND m.status='active' AND m.monday_recap_enabled AND NOT m.notifications_muted
                  AND NOT u.needs_email_confirm AND u.suspended_at IS NULL AND u.password_change_expires IS NULL
                ORDER BY m.user_id''', (group['id'],)).fetchall()
            for member in members:
                inserted = c.execute('''INSERT INTO notifications(user_id,kind,actor_id,group_id,group_week_start)
                    VALUES(%s,'group_monday_recap',%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id''',
                                     (member['user_id'], member['user_id'], group['id'], last_monday)).fetchone()
                sent += 1 if inserted else 0
    return sent


def start_worker():
    stop = threading.Event()

    def run():
        while not stop.wait(60):
            try:
                monday_recap_tick()
            except Exception as error:
                print('group Monday recap paused', type(error).__name__, flush=True)

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    return stop, worker


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
def accept_invite(token: str, request: Request, body: GroupLinkJoin = GroupLinkJoin(), user=Depends(current_user)):
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
            _consume_pending_friend_invites(c,group_id,user['id'])
            return _answer(c, group, user['id'])
        prior = c.execute('SELECT * FROM group_members WHERE group_id=%s AND user_id=%s FOR UPDATE', (group_id, user['id'])).fetchone()
        if prior and prior['status'] == 'removed' and invitation['generation'] <= prior['removed_invite_generation']:
            raise HTTPException(404, INVITE_UNAVAILABLE)
        count = c.execute("SELECT count(*) AS n FROM group_members WHERE group_id=%s AND status='active'", (group_id,)).fetchone()['n']
        if count >= MAX_MEMBERS:
            raise HTTPException(409, 'This group already has 50 members')
        if any(_blocked(c, user['id'], other) for other in other_ids):
            raise HTTPException(404, INVITE_UNAVAILABLE)
        sharing_level='total_shared' if body.share_total else 'just_in'
        c.execute('''INSERT INTO group_members(group_id,user_id,status,joined_at,removed_invite_generation,sharing_level)
                     VALUES(%s,%s,'active',now(),NULL,%s)
                     ON CONFLICT(group_id,user_id) DO UPDATE SET status='active',joined_at=now(),removed_invite_generation=NULL,
                       sharing_level=EXCLUDED.sharing_level,monday_recap_enabled=false ''',
                  (group_id, user['id'],sharing_level))
        _consume_pending_friend_invites(c,group_id,user['id'])
        group = c.execute('SELECT * FROM event_groups WHERE id=%s', (group_id,)).fetchone()
        return _answer(c, group, user['id'])


@router.get('/api/groups/{group_id}/friends')
def group_friends(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group=_group(c,group_id,user['id'])
        friends=_accepted_friends(c,user['id'])
        rows=[]
        for friend in friends:
            membership=c.execute('SELECT status FROM group_members WHERE group_id=%s AND user_id=%s',
                                 (group['id'],friend['id'])).fetchone()
            if membership and membership['status']=='active':
                state='member'
            else:
                hold=c.execute('''SELECT 1 FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s
                    AND status IN ('pending','declined') AND expires_at>now() LIMIT 1''',
                    (group['id'],friend['id'])).fetchone()
                state='invited' if hold else 'none'
            rows.append({'username':friend['login'],'state':state})
        count=c.execute("SELECT count(*) AS n FROM group_members WHERE group_id=%s AND status='active'",
                        (group['id'],)).fetchone()['n']
        can_invite=not group['closed_at'] and not group['joining_closed'] and count<MAX_MEMBERS
        return {'friends':rows,'can_invite':can_invite}


@router.post('/api/groups/{group_id}/friend-invites')
def create_friend_invite(group_id: str, body: GroupFriendInviteCreate, user=Depends(current_user)):
    from . import challenges
    group_id=_group_id(group_id)
    with db.connect() as c:
        # Check membership before resolving the submitted username so a
        # non-member cannot use this endpoint as an account-existence oracle.
        _group(c,group_id,user['id'])
        candidate=c.execute('''SELECT id,login FROM users WHERE lower(login)=lower(%s)
            AND NOT needs_email_confirm AND suspended_at IS NULL AND password_change_expires IS NULL''',
            (body.username,)).fetchone()
        if not candidate or candidate['id']==user['id']:
            raise HTTPException(404,INVITE_UNAVAILABLE)
        members=[r['user_id'] for r in c.execute("SELECT user_id FROM group_members WHERE group_id=%s AND status='active'",
                                                 (group_id,)).fetchall()]
        challenges.account_locks(c,[user['id'],candidate['id'],*members])
        group=_group(c,group_id,user['id'],lock=True)
        challenges.confirmed_for_challenge(c,user['id'])
        if group['closed_at'] or group['joining_closed']:
            raise HTTPException(409,'This group is not accepting members')
        count=c.execute("SELECT count(*) AS n FROM group_members WHERE group_id=%s AND status='active'",
                        (group_id,)).fetchone()['n']
        if count>=MAX_MEMBERS:
            raise HTTPException(409,'This group already has 50 members')
        if not _invite_accounts_ready(c,user['id'],candidate['id']) or not _friend_pair(c,user['id'],candidate['id']):
            raise HTTPException(404,INVITE_UNAVAILABLE)
        membership=c.execute('SELECT status FROM group_members WHERE group_id=%s AND user_id=%s FOR UPDATE',
                             (group_id,candidate['id'])).fetchone()
        if membership and membership['status'] in ('active','removed'):
            raise HTTPException(404,INVITE_UNAVAILABLE)
        active_ids=[r['user_id'] for r in c.execute("SELECT user_id FROM group_members WHERE group_id=%s AND status='active'",
                                                    (group_id,)).fetchall()]
        if any(_blocked(c,candidate['id'],member) for member in active_ids):
            raise HTTPException(404,INVITE_UNAVAILABLE)
        expired=c.execute('''UPDATE group_friend_invites SET status='expired'
            WHERE group_id=%s AND invitee_id=%s AND status IN ('pending','declined') AND expires_at<=now()
            RETURNING id''',(group_id,candidate['id'])).fetchall()
        _clear_friend_invite_notices(c,[r['id'] for r in expired])
        held=c.execute('''SELECT status FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s
            AND status IN ('pending','declined') AND expires_at>now() FOR UPDATE''',
            (group_id,candidate['id'])).fetchone()
        if held:
            # A declined invitation stays quiet and holds the pair until the original expiry.
            return {'state':'invited'}
        c.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s,0))',('group-friend-invite:'+str(user['id']),))
        sent=c.execute('''SELECT count(DISTINCT invitee_id) AS n FROM group_friend_invites
            WHERE inviter_id=%s AND created_at>now()-interval '24 hours' ''',(user['id'],)).fetchone()['n']
        if sent>=30:
            raise HTTPException(429,'Too many group invitations. Try again tomorrow.')
        invite=c.execute('''INSERT INTO group_friend_invites(group_id,inviter_id,invitee_id,expires_at)
            VALUES(%s,%s,%s,now()+interval '30 days') RETURNING id''',
            (group_id,user['id'],candidate['id'])).fetchone()
        notify.add_group_invite(c,candidate['id'],user['id'],group_id,invite['id'])
        return {'state':'invited'}


@router.get('/api/group-friend-invites/{invite_id}')
def friend_invite_preview(invite_id: int, request: Request, user=Depends(current_user)):
    _limit_invite_preview(request)
    with db.connect() as c:
        from . import challenges
        challenges.confirmed_for_challenge(c,user['id'])
        invite=c.execute('SELECT * FROM group_friend_invites WHERE id=%s',(invite_id,)).fetchone()
        if _friend_invite_unavailable(c,invite,user['id']):
            raise HTTPException(404,INVITE_UNAVAILABLE)
        group=c.execute('SELECT title FROM event_groups WHERE id=%s',(invite['group_id'],)).fetchone()
        inviter=c.execute('SELECT login FROM users WHERE id=%s',(invite['inviter_id'],)).fetchone()
        return {'title':group['title'],'inviter':inviter['login'],'expires_at':invite['expires_at']}


@router.post('/api/group-friend-invites/{invite_id}/accept')
def accept_friend_invite(invite_id: int, body: GroupFriendInviteAccept, request: Request, user=Depends(current_user)):
    _limit_accept(request,user['id'])
    from . import challenges
    with db.connect() as c:
        seed=c.execute('SELECT group_id,invitee_id FROM group_friend_invites WHERE id=%s',(invite_id,)).fetchone()
        if not seed or seed['invitee_id']!=user['id']:
            raise HTTPException(404,INVITE_UNAVAILABLE)
        members=[r['user_id'] for r in c.execute("SELECT user_id FROM group_members WHERE group_id=%s AND status='active'",
                                                 (seed['group_id'],)).fetchall()]
        challenges.account_locks(c,[user['id'],*members])
        group=c.execute('SELECT * FROM event_groups WHERE id=%s FOR UPDATE',(seed['group_id'],)).fetchone()
        invite=c.execute('SELECT * FROM group_friend_invites WHERE id=%s FOR UPDATE',(invite_id,)).fetchone()
        challenges.confirmed_for_challenge(c,user['id'])
        if _active_member(c,seed['group_id'],user['id']):
            return _answer(c,group,user['id'])
        prior=c.execute('SELECT status FROM group_members WHERE group_id=%s AND user_id=%s FOR UPDATE',
                        (seed['group_id'],user['id'])).fetchone()
        if prior and prior['status']=='removed':
            raise HTTPException(404,INVITE_UNAVAILABLE)
        if _friend_invite_unavailable(c,invite,user['id']):
            raise HTTPException(404,INVITE_UNAVAILABLE)
        sharing_level='total_shared' if body.share_total else 'just_in'
        c.execute('''INSERT INTO group_members(group_id,user_id,status,joined_at,removed_invite_generation,sharing_level)
            VALUES(%s,%s,'active',now(),NULL,%s)
            ON CONFLICT(group_id,user_id) DO UPDATE SET status='active',joined_at=now(),removed_invite_generation=NULL,
              sharing_level=EXCLUDED.sharing_level,monday_recap_enabled=false''',
            (seed['group_id'],user['id'],sharing_level))
        c.execute("UPDATE group_friend_invites SET status='accepted',responded_at=now() WHERE id=%s AND status='pending'",
                  (invite_id,))
        _clear_friend_invite_notices(c,[invite_id])
        group=c.execute('SELECT * FROM event_groups WHERE id=%s',(seed['group_id'],)).fetchone()
        return _answer(c,group,user['id'])


@router.post('/api/group-friend-invites/{invite_id}/decline')
def decline_friend_invite(invite_id: int, request: Request, user=Depends(current_user)):
    _limit_accept(request,user['id'])
    with db.connect() as c:
        invite=c.execute('SELECT * FROM group_friend_invites WHERE id=%s AND invitee_id=%s FOR UPDATE',
                         (invite_id,user['id'])).fetchone()
        if not invite or invite['status']!='pending' or invite['expires_at']<=_now():
            raise HTTPException(404,INVITE_UNAVAILABLE)
        c.execute("UPDATE group_friend_invites SET status='declined',responded_at=now() WHERE id=%s",(invite_id,))
        _clear_friend_invite_notices(c,[invite_id])
        return {'ok':True}


def _organizer_group(c, group_id, uid, lock=False):
    group = _group(c, group_id, uid, lock)
    if group['organizer_id'] != uid:
        raise HTTPException(404, GROUP_MISSING)
    return group


@router.post('/api/groups/{group_id}/invites')
def rotate_invite(group_id: str, body: GroupInviteAction, request: Request, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        if group['closed_at']:
            raise HTTPException(409, 'This group is closed')
        # The current client exposes "Make a new invite" only when joining is stopped;
        # keep that explicit action working while ordinary Invite opens stay non-rotating.
        rotate = body.rotate or bool(group['joining_closed'])
        return {'invite_url': _new_invite(c, group, request, rotate=rotate)}


@router.post('/api/groups/{group_id}/stop-joining')
def stop_joining(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        group = _organizer_group(c, group_id, user['id'], lock=True)
        c.execute('UPDATE event_groups SET joining_closed=true WHERE id=%s', (group['id'],))
        c.execute('UPDATE group_invites SET revoked_at=now() WHERE group_id=%s AND revoked_at IS NULL', (group['id'],))
        _revoke_friend_invites(c,group['id'])
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
        _revoke_friend_invites(c,group['id'])
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
        c.execute("UPDATE group_members SET status='removed',removed_invite_generation=%s,monday_recap_enabled=false WHERE group_id=%s AND user_id=%s",
                  (group['invite_generation'], group['id'], target['id']))
        _revoke_friend_invites(c,group['id'],inviter_id=target['id'])
        _revoke_friend_invites(c,group['id'],invitee_id=target['id'])
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
            _revoke_friend_invites(c,group['id'])
        else:
            _revoke_friend_invites(c,group['id'],inviter_id=user['id'])
        c.execute("UPDATE group_members SET status='left',removed_invite_generation=NULL,monday_recap_enabled=false WHERE group_id=%s AND user_id=%s",
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
