"""Own activity-goal target only: preview, fenced confirmation and durable retry receipt."""
import json
import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import Field
from . import ai_access, db
from .auth import current_user
from .api_coach import ConfirmIn
from .coach_proposals import fingerprint
from .coach_tools import Empty
from .food_photo import brake
from .kit_goal_contract import GoalChange

router = APIRouter(prefix='/goal-proposals')
FACTORS = {'distance': {'km': 1000, 'mi': 1609.344, 'm': 1},
           'time': {'hours': 3600, 'minutes': 60}, 'elevation': {'m': 1, 'ft': 0.3048},
           'count': {'activities': 1}, 'calories': {'kcal': 1}}


def goal(c, uid, gid, *, lock=False):
    return c.execute('SELECT id,sport,period,metric,target FROM goals WHERE user_id=%s AND id=%s'
                     + (' FOR UPDATE' if lock else ''), (uid, gid)).fetchone()


def options(c, uid, body):
    old = goal(c, uid, body.goal_id)
    if not old: raise ValueError('Goal unavailable')
    factor = FACTORS.get(old['metric'], {}).get(body.unit)
    target = body.value * factor if factor else 0
    if not 0 < target <= 1e9 or old['metric'] == 'count' and not target.is_integer():
        raise ValueError('Choose a supported target and unit')
    if target == old['target']: raise ValueError('The target is already set to that value')
    baseline = fingerprint(old)
    candidate = {'goal': old, 'value': body.value, 'unit': body.unit, 'target': target,
                 'before': f"{old['target'] / factor:g} {body.unit}",
                 'after': f"{body.value:g} {body.unit}"}
    candidate['candidate_id'] = fingerprint(candidate)
    return {'candidates': [candidate], 'baseline': baseline}


class Create(Empty):
    client_id: uuid.UUID
    candidate_id: str = Field(min_length=64, max_length=64)


def access(c, uid):
    c.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE', (uid,))
    ai_access.require(uid, 'coach', c)
    allowed = c.execute('SELECT ai_ok AND ai_adult_at IS NOT NULL AS ok FROM profile WHERE user_id=%s FOR SHARE', (uid,)).fetchone()
    if not allowed or not allowed['ok']: raise HTTPException(403, 'Turn on Kit before confirming this proposal.')


@router.post('')
def create(body: Create, user=Depends(current_user)):
    uid = user['id']
    brake(uid, limit=15, kind='kit_goal_proposals', what='goal proposals')
    pid = uuid.uuid5(body.client_id, body.candidate_id)
    with db.connect() as c:
        access(c, uid)
        row = c.execute("""SELECT question,answer FROM kit_turns WHERE user_id=%s AND client_id=%s
          AND state='answered' AND invalidated_at IS NULL AND replay_blocked_at IS NULL""", (uid, body.client_id)).fetchone()
        selected = (row['answer'] or {}).get('selection') if row else None
        if not selected or selected.get('kind') != 'goal' or selected.get('candidate_id') != body.candidate_id:
            raise HTTPException(404, 'Proposal unavailable')
        candidate = selected['candidate']
        existing = c.execute('SELECT payload,status FROM coach_proposals WHERE id=%s AND user_id=%s', (pid, uid)).fetchone()
        if existing: return {'id': str(pid), **existing}
        try: fresh = options(c, uid, GoalChange(goal_id=candidate['goal']['id'], value=candidate['value'], unit=candidate['unit']))
        except ValueError: raise HTTPException(409, 'Your goal changed. Ask Kit for a fresh proposal.') from None
        if fresh['candidates'][0] != candidate:
            raise HTTPException(409, 'Your goal changed. Ask Kit for a fresh proposal.')
        c.execute("DELETE FROM coach_proposals WHERE user_id=%s AND expires<now() AND status='pending'", (uid,))
        if c.execute("SELECT count(*) AS n FROM coach_proposals WHERE user_id=%s AND status='pending'", (uid,)).fetchone()['n'] >= 50:
            raise HTTPException(429, 'Too many pending proposals. Try again later.')
        payload = {'candidate': candidate, 'client_id': str(body.client_id)}
        c.execute("INSERT INTO coach_proposals(id,user_id,kind,payload,baseline) VALUES(%s,%s,'goal',%s,%s)",
                  (pid, uid, json.dumps(payload), fresh['baseline']))
    return {'id': str(pid), 'status': 'pending', 'payload': payload}


@router.post('/{pid}/confirm')
def confirm(pid: uuid.UUID, body: ConfirmIn, user=Depends(current_user)):
    uid = user['id']
    with db.connect() as c:
        access(c, uid)
        c.execute('SELECT pg_advisory_xact_lock(%s)', (-uid,))
        row = c.execute("SELECT *,expires<now() AS expired FROM coach_proposals WHERE id=%s AND user_id=%s AND kind='goal' FOR UPDATE", (pid, uid)).fetchone()
        if not row: raise HTTPException(404, 'Proposal unavailable')
        if row['status'] == 'applied':
            return {'status': 'applied', 'already_applied': True, 'receipt': row['payload']['receipt']}
        if row['expired'] or row['status'] != 'pending':
            raise HTTPException(409, 'This proposal expired. Ask Kit for a fresh proposal.')
        candidate = row['payload']['candidate']
        source = c.execute('SELECT answer FROM kit_turns WHERE user_id=%s AND client_id=%s AND invalidated_at IS NULL AND replay_blocked_at IS NULL',
                           (uid, row['payload']['client_id'])).fetchone()
        if not source or ((source['answer'] or {}).get('selection') or {}).get('candidate_id') != candidate['candidate_id']:
            raise HTTPException(409, 'This proposal is no longer available. Ask Kit again.')
        old = goal(c, uid, candidate['goal']['id'], lock=True)
        if not old or fingerprint(old) != row['baseline']:
            raise HTTPException(409, 'Your goal changed. Ask Kit for a fresh proposal.')
        c.execute('UPDATE goals SET target=%s WHERE user_id=%s AND id=%s', (candidate['target'], uid, old['id']))
        receipt = {'proposal_id': str(pid), 'goal_id': old['id'], 'before': candidate['before'],
                   'after': candidate['after'], 'saved_at': c.execute('SELECT now() AS at').fetchone()['at'].isoformat()}
        c.execute("UPDATE coach_proposals SET status='applied',payload=payload || %s::jsonb WHERE id=%s AND user_id=%s",
                  (json.dumps({'receipt': receipt}), pid, uid))
    return {'status': 'applied', 'already_applied': False, 'receipt': receipt}
