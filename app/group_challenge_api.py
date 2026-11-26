"""Member-only group challenges; personal activities never leave the contribution calculator."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from . import db, groups as G, challenges, community_filter
from .auth import current_user

router = APIRouter()
MISSING = 'Challenge not found.'
FIELDS = ('title','metric','target','unit','sports','start_date','end_date','time_zone','note','training_for')


class ChallengeCreate(G.GroupCreate):
    id: UUID  # Client-generated retry key; one challenge and notice per successful creation.


class Sharing(BaseModel):
    model_config = ConfigDict(extra='forbid')
    share_total: StrictBool


class PeopleCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1,max_length=80,pattern=r'\S')
    time_zone: str = Field(min_length=1,max_length=80)


@router.post('/api/groups/people')
def create_people(body: PeopleCreate, request: Request, user=Depends(current_user)):
    # Required legacy columns are compatibility storage, never a real challenge.
    legacy = G.GroupCreate(title=body.title,time_zone=body.time_zone,goal_type='sessions',goal_target=1,goal_unit='sessions')
    return G._create_group(legacy,request,user,legacy_goal=False)


def _context(c, gid, uid, write=False, allow_closed=False):
    if write: challenges.account_locks(c, [uid])
    if not G._invite_accounts_ready(c, uid): raise HTTPException(404, MISSING)
    group = G._group(c, gid, uid, lock=write)
    if write:
        challenges.confirmed_for_challenge(c, uid)
        if group['closed_at'] and not allow_closed: raise HTTPException(409, 'This group is closed')
    return group


def _rows(c, gid, uid):
    return c.execute('''SELECT q.* FROM group_challenges q LEFT JOIN users u ON u.id=q.creator_id
        WHERE q.group_id=%s AND (q.creator_id IS NULL OR (NOT u.needs_email_confirm
          AND u.suspended_at IS NULL AND u.password_change_expires IS NULL
          AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=%s AND b.blocked=u.id)
            OR (b.user_id=u.id AND b.blocked=%s)))) ORDER BY q.created,q.id''',(gid,uid,uid)).fetchall()


def _one(c, group, uid, qid):
    return next((q for q in _rows(c, group['id'], uid) if str(q['id'])==str(qid)), None)


def _view(c, group, q, uid):
    members = c.execute('''SELECT m.user_id,u.login::text AS username,p.share_achievements AND s.share_total AS shares_total,
        s.share_total FROM group_members m JOIN group_challenge_members s USING(group_id,user_id)
        JOIN users u ON u.id=m.user_id JOIN profile p ON p.user_id=u.id
        WHERE s.challenge_id=%s AND m.status='active' AND NOT u.needs_email_confirm
          AND u.suspended_at IS NULL AND u.password_change_expires IS NULL
          AND NOT EXISTS(SELECT 1 FROM blocks b WHERE (b.user_id=%s AND b.blocked=u.id)
            OR (b.user_id=u.id AND b.blocked=%s)) ORDER BY u.login''',(q['id'],uid,uid)).fetchall()
    goal = dict(group,goal_type=q['metric'],goal_unit=q['unit'],goal_target=q['target'],goal_sports=q['sports'],
                goal_start_date=q['start_date'],event_date=q['end_date'],time_zone=q['time_zone'])
    now = min(G._now(),q['ended_at']) if q['ended_at'] else G._now()
    sharing = [m for m in members if m['shares_total']]
    values = G._contributions(c, goal, sharing, now)
    me = next((m for m in members if m['user_id']==uid), None)
    own = G._contributions(c, goal, [me] if me else [], now).get(uid,0)
    return {'id':str(q['id']), 'group_id':str(group['id']), **{k:q[k] for k in FIELDS},
            'legacy_goal':bool(q['legacy_group_id']), 'ended_at':q['ended_at'], 'can_manage':uid in (q['creator_id'],group['organizer_id']),
            'share_total':bool(me and me['share_total']), 'your_total':own,
            **({'total':round(sum(values.values()),3)} if sharing else {}),
            'members':[{'username':m['username'],'shares_total':bool(m['shares_total']),
                        **({'value':values.get(m['user_id'],0)} if m['shares_total'] else {})} for m in members]}


def _definition(body):
    G._valid_goal(body)
    G._validate_event_date(body.event_date,body.time_zone)
    start = body.goal_start_date or G._now().astimezone(G._zone(body.time_zone)).date()
    G._validate_goal_start(start,body.event_date,body.time_zone)
    for label,text in [('challenge title',body.title),('challenge note',body.note),('training goal',body.training_for)]:
        community_filter.check(text,label)
    return dict(zip(FIELDS,(body.title,body.goal_type,body.goal_target,body.goal_unit,body.goal_sports,
                           start,body.event_date,body.time_zone,body.note,body.training_for)))


@router.get('/api/groups/{group_id}/challenges')
def list_challenges(group_id: UUID, user=Depends(current_user)):
    with db.connect() as c:
        group = _context(c,group_id,user['id'])
        return [_view(c,group,q,user['id']) for q in _rows(c,group_id,user['id'])]


@router.get('/api/groups/{group_id}/challenges/{challenge_id}')
def detail(group_id: UUID, challenge_id: UUID, user=Depends(current_user)):
    with db.connect() as c:
        group = _context(c,group_id,user['id']);q = _one(c,group,user['id'],challenge_id)
        if not q: raise HTTPException(404,MISSING)
        return _view(c,group,q,user['id'])


@router.post('/api/groups/{group_id}/challenges')
def create(group_id: UUID, body: ChallengeCreate, user=Depends(current_user)):
    with db.connect() as c:
        group = _context(c,group_id,user['id'],True);definition = _definition(body)
        old = c.execute('SELECT * FROM group_challenges WHERE id=%s',(body.id,)).fetchone()
        if old:
            if old['group_id']!=group_id or old['creator_id']!=user['id'] or any(old[k]!=v for k,v in definition.items()):
                raise HTTPException(409,'Use a new challenge request')
            return _view(c,group,old,user['id'])
        if c.execute('SELECT count(*) AS n FROM group_challenges WHERE group_id=%s',(group_id,)).fetchone()['n']>=100:
            raise HTTPException(409,'This group has reached its challenge limit')
        from .signup import social_action
        social_action(c,user['id'],'comment')
        q = c.execute('''INSERT INTO group_challenges(id,group_id,creator_id,title,metric,target,unit,sports,
            start_date,end_date,time_zone,note,training_for) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT(id) DO NOTHING RETURNING *''',(body.id,group_id,user['id'],*definition.values())).fetchone()
        if not q: raise HTTPException(409,'Use a new challenge request')
        c.execute('''INSERT INTO group_challenge_members(challenge_id,group_id,user_id,joined_at)
            SELECT %s,group_id,user_id,joined_at FROM group_members WHERE group_id=%s AND status='active' ''',(q['id'],group_id))
        # The existing group feed/bell reaches members, respects mute/blocks, and needs no new push channel.
        text = f'New challenge: {q["title"]}. Sharing your total is on for this challenge. You can turn it off in the challenge.'
        update = c.execute('INSERT INTO group_updates(group_id,user_id,text) VALUES(%s,%s,%s) RETURNING id',
                           (group_id,user['id'],text)).fetchone()
        G._group_notice_members(c,group_id,user['id'],'group_update',update_id=update['id'])
        return _view(c,group,q,user['id'])


@router.put('/api/groups/{group_id}/challenges/{challenge_id}')
def edit(group_id: UUID, challenge_id: UUID, body: G.GroupCreate, user=Depends(current_user)):
    with db.connect() as c:
        group = _context(c,group_id,user['id'],True);q = _one(c,group,user['id'],challenge_id)
        if not q or user['id'] not in (q['creator_id'],group['organizer_id']): raise HTTPException(404,MISSING)
        if q['ended_at']: raise HTTPException(409,'This challenge has ended')
        d = _definition(body)
        q = c.execute('''UPDATE group_challenges SET title=%s,metric=%s,target=%s,unit=%s,sports=%s,
            start_date=%s,end_date=%s,time_zone=%s,note=%s,training_for=%s WHERE id=%s RETURNING *''',
            (*d.values(),challenge_id)).fetchone()
        if q['legacy_group_id']:
            c.execute('''UPDATE event_groups SET goal_type=%s,goal_target=%s,goal_unit=%s,goal_sports=%s,
                goal_start_date=%s,event_date=%s,time_zone=%s WHERE id=%s''',
                (q['metric'],q['target'],q['unit'],q['sports'],q['start_date'],q['end_date'],q['time_zone'],group_id))
        return _view(c,group,q,user['id'])


@router.post('/api/groups/{group_id}/challenges/{challenge_id}/end')
def end(group_id: UUID, challenge_id: UUID, user=Depends(current_user)):
    with db.connect() as c:
        group = _context(c,group_id,user['id'],True);q = _one(c,group,user['id'],challenge_id)
        if not q or user['id'] not in (q['creator_id'],group['organizer_id']): raise HTTPException(404,MISSING)
        c.execute('UPDATE group_challenges SET ended_at=coalesce(ended_at,%s) WHERE id=%s',(G._now(),challenge_id))
    return {'ok':True}


@router.post('/api/groups/{group_id}/challenges/{challenge_id}/sharing')
def share(group_id: UUID, challenge_id: UUID, body: Sharing, user=Depends(current_user)):
    with db.connect() as c:
        group = _context(c,group_id,user['id'],True,allow_closed=True);q = _one(c,group,user['id'],challenge_id)
        if not q: raise HTTPException(404,MISSING)
        changed = c.execute('''UPDATE group_challenge_members SET share_total=%s
            WHERE challenge_id=%s AND user_id=%s''',(body.share_total,challenge_id,user['id']))
        if not changed.rowcount: raise HTTPException(404,MISSING)
        if q['legacy_group_id']:
            c.execute('UPDATE group_members SET sharing_level=%s WHERE group_id=%s AND user_id=%s',
                      ('total_shared' if body.share_total else 'just_in',group_id,user['id']))
    return {'share_total':body.share_total}
