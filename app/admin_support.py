"""Searchable audit receipts and a minimal request register, without support access to personal records."""
import datetime as dt
import uuid
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field, StrictBool
from . import db
from .admin_auth import admin_user, audit
from .admin_actions import ActionIn, replay, complete

router = APIRouter(prefix='/api/admin')


def term(value):
    return '%' + value.strip().replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_') + '%'


@router.get('/audit-history')
def history(q: str = Query('', max_length=120), action: str = Query('', max_length=80, pattern=r'^[a-z0-9_.-]*$'),
            outcome: Literal['', 'success', 'rejected', 'uncertain'] = '', days: int = Query(90, ge=1, le=365),
            before: int | None = Query(None, gt=0), user=Depends(admin_user)):
    with db.connect() as c:
        rows = c.execute('''SELECT a.id,a.action,a.target,a.created,a.outcome,u.login::text AS actor,u.name AS actor_name,
                  p.id AS account_id,p.login::text AS account_login,p.name AS account_name
            FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id
            LEFT JOIN users p ON (a.action LIKE 'account.%%' OR a.action LIKE 'role.%%') AND a.target=p.id::text
            WHERE a.created>=now()-%(days)s*interval '1 day' AND (%(before)s::bigint IS NULL OR a.id<%(before)s)
              AND (%(action)s='' OR a.action=%(action)s) AND (%(outcome)s='' OR a.outcome=%(outcome)s)
              AND (%(q)s='' OR concat_ws(' ',u.login,u.name,p.login,p.name,a.action,a.target) ILIKE %(term)s)
            ORDER BY a.id DESC LIMIT 51''', {'days': days, 'before': before, 'action': action, 'outcome': outcome, 'q': q.strip(), 'term': term(q)}).fetchall()
        actions = [r['action'] for r in c.execute('SELECT DISTINCT action FROM admin_audit ORDER BY action').fetchall()]
    return {'items': rows[:50], 'before': rows[49]['id'] if len(rows) > 50 else None, 'actions': actions, 'days': days}


def prune_requests(c):
    c.execute("DELETE FROM admin_data_requests WHERE completed_at<now()-interval '90 days'")


@router.get('/data-requests')
def requests(status: Literal['', 'received', 'verified', 'completed', 'declined'] = '', before: str | None = Query(None, max_length=36),
             user=Depends(admin_user)):
    try: cursor = uuid.UUID(before) if before else None
    except ValueError: raise HTTPException(400, 'Invalid request page.')
    with db.connect() as c:
        prune_requests(c)
        # UUID tie-breaker gives stable ordering when several requests arrive together.
        rows = c.execute('''SELECT r.*,u.name,u.login::text AS login,v.name AS recorded_by,b.name AS closed_by
            FROM admin_data_requests r LEFT JOIN users u ON u.id=r.user_id LEFT JOIN users v ON v.id=r.actor_id
            LEFT JOIN users b ON b.id=r.completed_by
            WHERE (%(status)s='' OR r.status=%(status)s) AND (%(cursor)s::uuid IS NULL OR
                  (r.received,r.id)<(SELECT received,id FROM admin_data_requests WHERE id=%(cursor)s))
            ORDER BY r.received DESC,r.id DESC LIMIT 51''', {'status': status, 'cursor': cursor}).fetchall()
    return {'items': rows[:50], 'before': str(rows[49]['id']) if len(rows) > 50 else None}


class RequestIn(ActionIn):
    user_id: int = Field(gt=0)
    kind: Literal['export', 'deletion', 'correction', 'other']


@router.post('/data-requests')
def add_request(body: RequestIn, user=Depends(admin_user)):
    with db.connect() as c:
        digest, old = replay(c, user, body, 'request.record', body.user_id)
        if old: return old
        if not c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE', (body.user_id,)).fetchone(): raise HTTPException(404, 'Account not found.')
        rid = uuid.uuid4()
        c.execute('INSERT INTO admin_data_requests(id,user_id,kind,actor_id) VALUES (%s,%s,%s,%s)', (rid, body.user_id, body.kind, user['id']))
        return complete(c, user, body, 'request.record', body.user_id, digest, request_id=str(rid))


class RequestUpdate(ActionIn):
    status: Literal['verified', 'completed', 'declined']
    method: Literal['signed_in', 'confirmed_email', 'identity_checked'] | None = None
    confirmed: StrictBool


@router.post('/data-requests/{rid}')
def update_request(rid: uuid.UUID, body: RequestUpdate, user=Depends(admin_user)):
    if not body.confirmed: raise HTTPException(400, 'Confirm the verification or completion evidence first.')
    action = 'request.' + body.status
    with db.connect() as c:
        digest, old = replay(c, user, body, action, rid)
        if old: return old
        r = c.execute('SELECT * FROM admin_data_requests WHERE id=%s FOR UPDATE', (rid,)).fetchone()
        if not r: raise HTTPException(404, 'Request not found.')
        if r['status'] in ('completed', 'declined'): raise HTTPException(409, 'This request is already closed. Refresh the register.')
        if body.status == 'verified':
            if not r['user_id'] or not body.method: raise HTTPException(400, 'Choose how the account owner was verified.')
            if body.method == 'confirmed_email' and not c.execute('SELECT 1 FROM users WHERE id=%s AND email_verified_at IS NOT NULL', (r['user_id'],)).fetchone():
                raise HTTPException(409, 'This account has no confirmed email.')
            c.execute("UPDATE admin_data_requests SET status='verified',method=%s,verified_at=now(),actor_id=%s WHERE id=%s", (body.method, user['id'], rid))
        else:
            if body.status == 'completed' and r['status'] != 'verified': raise HTTPException(409, 'Verify the account owner before recording completion.')
            if body.status == 'completed' and r['kind'] == 'deletion' and r['user_id']:
                raise HTTPException(409, 'The account still exists. Remove it through the confirmed account flow first.')
            c.execute('UPDATE admin_data_requests SET status=%s,completed_at=now(),completed_by=%s WHERE id=%s', (body.status, user['id'], rid))
        return complete(c, user, body, action, rid, digest)


# Fixed templates only: never log request bodies, URLs with user values, passwords or failure messages.
FAILURES = {
    '/api/admin/manage/{uid}/{action}':'account.manage',
    '/api/admin/readiness/{key}': 'readiness.record', '/api/admin/review/{rid}': 'report.decision',
    '/api/admin/people/{uid}/temporary-password': 'account.temporary_password',
    '/api/admin/people/{uid}/signout': 'account.sign_out_everywhere', '/api/admin/people/{uid}/reset-email': 'account.reset_email',
    '/api/admin/people/{uid}/suspend': 'account.suspend', '/api/admin/people/{uid}/restore': 'account.restore',
    '/api/admin/people/{uid}/role': 'role.change', '/api/admin/people/{login}/remove': 'account.remove',
    '/api/admin/data-requests': 'request.record', '/api/admin/data-requests/{rid}': 'request.update',
}


def rejected(request: Request, status):
    actor = getattr(request.state, 'admin_actor', None)
    route = getattr(request.scope.get('route'), 'path', '')
    if not actor or status < 400 or request.method != 'POST' or route not in FAILURES: return
    params = request.path_params
    target = str(params.get('uid') or params.get('rid') or '')
    # An invalid arbitrary parameter must not become a way to put private text in the audit log.
    if target and not (target.isdigit() or (len(target) == 36 and all(c in '0123456789abcdef-' for c in target))): target = ''
    try:
        with db.connect() as c: audit(c, actor, FAILURES[route], target or None, outcome='rejected' if status < 500 else 'uncertain')
    except Exception:
        pass  # An unavailable audit store must not turn the original error into a different, misleading result.
