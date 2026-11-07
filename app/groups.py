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

from . import account_email, auth, community_filter, db, notify
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
    event_date: dt.date
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


class MemberAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    username: str = Field(min_length=1, max_length=60)


class GroupReport(BaseModel):
    model_config = ConfigDict(extra='forbid')
    reason: str = Field(pattern='^(spam|abuse|inappropriate|other)$')
    note: str | None = Field(None, max_length=500)


def _zone(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, TypeError):
        raise HTTPException(400, 'Choose a valid time zone')


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


def _contributions(c, group, members):
    zone = _zone(group['time_zone'])
    end = dt.datetime.combine(group['event_date'] + dt.timedelta(days=1), dt.time.min, zone).astimezone(UTC)
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
      FROM group_members m LEFT JOIN activities a ON a.user_id=m.user_id AND a.start_time>=m.joined_at
        AND a.start_time<least(%s::timestamptz,%s) AND NOT a.lift_open
      WHERE m.group_id=%s AND m.status='active' AND m.user_id=ANY(%s)
      GROUP BY m.user_id''', (end, dt.datetime.now(UTC), group['id'], visible_ids)).fetchall()
    divisor = (1609.344 if group['goal_unit'] == 'mi' else 1000) if group['goal_type'] == 'distance' else (
        0.3048 if group['goal_type'] == 'elevation' and group['goal_unit'] == 'ft' else 1)
    return {row['user_id']: round(float(row['raw'] or 0) / divisor, 3) for row in rows}


def _answer(c, group, uid):
    members = c.execute('''SELECT m.user_id,m.joined_at,u.login::text AS username,u.photo_v AS photo,
                                  coalesce(p.share_achievements,false) AS share_total
                           FROM group_members m JOIN users u ON u.id=m.user_id
                           LEFT JOIN profile p ON p.user_id=u.id
                           WHERE m.group_id=%s AND m.status='active' AND NOT u.needs_email_confirm
                             AND u.suspended_at IS NULL ORDER BY m.joined_at,m.user_id''', (group['id'],)).fetchall()
    visible = [member for member in members if not _blocked(c, uid, member['user_id'])]
    contributions = _contributions(c, group, visible)
    total = round(sum(contributions.values()), 3)
    member_count = len(visible)
    zone = _zone(group['time_zone'])
    today = dt.datetime.now(UTC).astimezone(zone).date()
    return {
        'id': str(group['id']), 'title': group['title'], 'event_date': group['event_date'].isoformat(),
        'time_zone': group['time_zone'], 'note': group['note'], 'goal_type': group['goal_type'],
        'goal_target': group['goal_target'], 'goal_unit': group['goal_unit'],
        **({'total': total} if member_count >= 3 else {'your_total': contributions.get(uid, 0)}),
        'days_to_event': max(0, (group['event_date'] - today).days),
        'members': [{'username': m['username'], 'photo': m['photo'] or False,
                     'organizer': m['user_id'] == group['organizer_id'],
                     **({'value': contributions.get(m['user_id'], 0)} if m['share_total'] else {'sharing_total_only': True})}
                    for m in visible],
        'member_count': member_count, 'is_organizer': uid == group['organizer_id'],
        'joining_closed': bool(group['joining_closed']), 'closed': bool(group['closed_at']),
    }


@router.post('/api/groups')
def create_group(body: GroupCreate, request: Request, user=Depends(current_user)):
    _valid_goal(body)
    zone = _zone(body.time_zone)
    if body.event_date < dt.datetime.now(UTC).astimezone(zone).date():
        raise HTTPException(400, 'Choose today or a future event date')
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
                            WHERE m.user_id=%s AND m.status='active' ORDER BY g.event_date,g.created''',
                         (user['id'],)).fetchall()
        return [_answer(c, row, user['id']) for row in rows]


@router.get('/api/groups/{group_id}')
def get_group(group_id: str, user=Depends(current_user)):
    with db.connect() as c:
        return _answer(c, _group(c, group_id, user['id']), user['id'])


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
