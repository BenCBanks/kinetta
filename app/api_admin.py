"""Operator-only portal APIs. No personal health records or provider credentials returned."""
import datetime as dt, hashlib, json, os, secrets, uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from . import db, auth, api_account, api_social, admin_mail
from .admin_auth import admin_user, audit, seal, mfa_required

router=APIRouter(prefix='/api/admin')


@router.get('/overview')
def overview(user=Depends(admin_user)):
    with db.connect() as c:
        counts=c.execute("SELECT (SELECT count(*) FROM users) AS accounts,(SELECT count(*) FROM users WHERE is_admin) AS administrators,(SELECT count(*) FROM beta_requests WHERE status='new') AS pending_requests,(SELECT count(*) FROM reports WHERE status='open') AS reports,(SELECT count(*) FROM imports WHERE status='failed' AND created>now()-interval '1 day') AS failed_imports,(SELECT count(*) FROM connections WHERE status LIKE 'sync failed:%%') AS connection_failures").fetchone()
        from . import signup
        signup_state=signup.state(c)       # mode and real accounts against the cap (#232)
    return {**counts,'email':admin_mail.settings(),'signup':signup_state,'mfa':mfa_required()}


# ---------- finding and supporting people (#233, 2026-10-24) ----------
# Support information only: never routes, workouts, food, weight, body details, messages or photos.
STATUS="CASE WHEN u.suspended_at IS NOT NULL THEN 'suspended' WHEN u.needs_email_confirm THEN 'unconfirmed' ELSE 'active' END"
PAGE=50


@router.get('/people')
def people(q:str=Query('',max_length=120),role:Literal['','admin','member']='',status:Literal['','active','unconfirmed','suspended']='',
           tests:bool=False,page:int=Query(1,ge=1,le=1000),issue:Literal['','connections','imports','reports']='',
           sort:Literal['joined','active','name']='joined',joined_after:dt.date|None=None,active_since:dt.date|None=None,user=Depends(admin_user)):
    where,args=['TRUE'],{'limit':PAGE,'offset':(page-1)*PAGE}
    if q.strip():
        where.append('(u.name ILIKE %(m)s OR u.login ILIKE %(m)s OR u.email ILIKE %(m)s)')
        args['m']='%'+q.strip().replace('\\','\\\\').replace('%','\\%').replace('_','\\_')+'%'
    if role:where.append('u.is_admin' if role=='admin' else 'NOT u.is_admin')
    if status:where.append(f'{STATUS} = %(status)s');args['status']=status
    if not tests:where.append("u.login NOT LIKE 'zz\\_test%%'")

    if issue=='reports':where.append("EXISTS(SELECT 1 FROM reports r WHERE r.person=u.id AND r.status='open')")
    if issue=='imports':where.append("EXISTS(SELECT 1 FROM imports i WHERE i.user_id=u.id AND i.status='failed' AND i.created>now()-interval '1 day')")
    if issue=='connections':where.append("EXISTS(SELECT 1 FROM connections x WHERE x.user_id=u.id AND x.status LIKE 'sync failed:%%')")
    if joined_after:where.append("u.created >= %(joined)s::date AT TIME ZONE 'UTC'");args['joined']=joined_after
    if active_since:where.append("EXISTS(SELECT 1 FROM admin_account_days d WHERE d.user_id=u.id AND d.day>=%(active)s)");args['active']=active_since
    order={'joined':'u.created DESC,u.id DESC','active':'last_active DESC NULLS LAST,u.id DESC','name':'lower(u.name),u.id'}[sort]
    w=' AND '.join(where)
    with db.connect() as c:
        total=c.execute(f'SELECT count(*) AS n FROM users u WHERE {w}',args).fetchone()['n']
        rows=c.execute(f"""SELECT u.id,u.login::text AS login,u.name,u.email::text AS email,u.email_verified_at IS NOT NULL AS email_confirmed,
            u.is_admin,u.created,{STATUS} AS status,EXISTS(SELECT 1 FROM admin_mfa m WHERE m.user_id=u.id) AS mfa_enabled,
            (SELECT max(day) FROM admin_account_days d WHERE d.user_id=u.id) AS last_active,
            (SELECT count(*) FROM reports r WHERE r.person=u.id AND r.status='open') AS open_reports
            FROM users u WHERE {w} ORDER BY {order} LIMIT %(limit)s OFFSET %(offset)s""",args).fetchall()
    return {'total':total,'page':page,'pages':max(1,-(-total//PAGE)),'rows':rows}


def device(agent):
    """A rough device description from a browser's own label; IP addresses are never kept."""
    a=agent or ''
    where='iPhone' if 'iPhone' in a or 'iPad' in a else 'Android' if 'Android' in a else 'Mac' if 'Macintosh' in a else 'Windows' if 'Windows' in a else 'Linux' if 'Linux' in a else 'Other'
    if where=='iPhone' and 'Safari' not in a:return 'iPhone app'
    what='Edge' if 'Edg/' in a else 'Chrome' if 'Chrome' in a or 'CriOS' in a else 'Firefox' if 'Firefox' in a or 'FxiOS' in a else 'Safari' if 'Safari' in a else 'browser'
    return f'{where} · {what}'


def _person(c,uid):
    p=c.execute(f"""SELECT u.id,u.login::text AS login,u.name,u.email::text AS email,u.email_verified_at IS NOT NULL AS email_confirmed,
        u.is_admin,u.created,{STATUS} AS status,u.suspended_at,u.suspended_reason,u.password_change_expires,
        EXISTS(SELECT 1 FROM admin_mfa m WHERE m.user_id=u.id) AS mfa_enabled FROM users u WHERE u.id=%s""",(uid,)).fetchone()
    if not p:raise HTTPException(404,'Account not found.')
    return p


@router.get('/people/{uid}')
def person(uid:int,user=Depends(admin_user)):
    with db.connect() as c:
        p=_person(c,uid)
        p['last_active']=c.execute('SELECT max(day) AS d FROM admin_account_days WHERE user_id=%s',(uid,)).fetchone()['d']
        p['active_days_30']=c.execute("SELECT count(*) AS n FROM admin_account_days WHERE user_id=%s AND day>current_date-30",(uid,)).fetchone()['n']
        p['devices']=[{'device':device(r['agent']),'signed_in':r['created'],'last_used':r['last_seen'],'app_version':r['app_version']} for r in
                      c.execute('SELECT agent,created,last_seen,app_version FROM sessions WHERE user_id=%s ORDER BY last_seen DESC',(uid,)).fetchall()]
        p['connections']=c.execute('SELECT kind,status,last_sync,last_count FROM connections WHERE user_id=%s ORDER BY kind',(uid,)).fetchall()
        p['imports']=c.execute('SELECT status,created,added,failed FROM imports WHERE user_id=%s ORDER BY created DESC LIMIT 5',(uid,)).fetchall()
        p['counts']=c.execute("""SELECT (SELECT count(*) FROM activities WHERE user_id=%(u)s) AS activities,
            (SELECT count(*) FROM food_entries WHERE user_id=%(u)s) AS food_entries,
            (SELECT count(*) FROM activity_photos WHERE user_id=%(u)s) AS photos,
            (SELECT coalesce(sum(requests),0) FROM ai_daily_usage WHERE user_id=%(u)s AND day>=date_trunc('month',current_date)) AS ai_requests_this_month,
            (SELECT count(*) FROM reports WHERE reporter=%(u)s) AS reports_filed,
            (SELECT coalesce(sum(octet_length(img)+octet_length(thumb)),0) FROM activity_photos WHERE user_id=%(u)s) +
            (SELECT coalesce(sum(octet_length(img)),0) FROM profile_photos WHERE user_id=%(u)s) AS photo_bytes""",{'u':uid}).fetchone()
        p['reports']=c.execute('SELECT id,what,reason,status,created FROM reports WHERE person=%s ORDER BY created DESC LIMIT 20',(uid,)).fetchall()
        p['invited']=c.execute('SELECT i.note,i.used_at,u.name AS by FROM invites i LEFT JOIN users u ON u.id=i.created_by WHERE i.used_by=%s',(uid,)).fetchone()
        p['audit']=c.execute("""SELECT a.action,a.created,u.login::text AS by FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id
            WHERE a.target=%s ORDER BY a.created DESC LIMIT 20""",(str(uid),)).fetchall()
    return p


class PersonAction(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirm:str=Field(max_length=30)
    reason:str|None=Field(None,max_length=300)


def _target(c,uid,body,user,members_only=True):
    p=_person(c,uid)
    if body.confirm!=p['login']:raise HTTPException(400,'Type the account username exactly.')
    if members_only and (p['is_admin'] or p['id']==user['id']):raise HTTPException(409,'Change the administrator role first.')
    return p


@router.post('/people/{uid}/signout')
def sign_out_everywhere(uid:int,body:PersonAction,user=Depends(admin_user)):
    """After a lost phone or a suspected break-in: every web, iPhone app and portal session of that account ends."""
    with db.connect() as c:
        p=_target(c,uid,body,user,members_only=False)
        for t in ('sessions','admin_sessions','admin_challenges'):c.execute(f'DELETE FROM {t} WHERE user_id=%s',(uid,))
        audit(c,user['id'],'account.sign_out_everywhere',uid)
    return {'ok':True}


@router.post('/people/{uid}/reset-email')
def reset_email(uid:int,body:PersonAction,background:BackgroundTasks,user=Depends(admin_user)):
    """Emails the person their own reset link, so no administrator ever chooses or knows their password."""
    from . import account_email
    with db.connect() as c:
        p=_target(c,uid,body,user)
        if not p['email_confirmed']:raise HTTPException(409,'This account has no confirmed email. Use Reset password instead.')
        if not account_email.mail_ready():raise HTTPException(503,'Email isn’t set up on this server.')
        account_email.send_reset(background,c,p,by_admin=True)
        audit(c,user['id'],'account.reset_email',uid)
    return {'ok':True}


@router.post('/people/{uid}/suspend')
def suspend(uid:int,body:PersonAction,background:BackgroundTasks,user=Depends(admin_user)):
    """Stops sign-in and hides the account from everyone else while a report is looked into; nothing is deleted."""
    from . import account_email
    reason=(body.reason or '').strip()
    if not reason:raise HTTPException(400,'Write a short private reason.')
    with db.connect() as c:
        p=_target(c,uid,body,user)
        if p['status']=='suspended':return {'ok':True}
        c.execute('UPDATE users SET suspended_at=now(),suspended_reason=%s WHERE id=%s',(reason,uid))
        for t in ('sessions','admin_sessions','admin_challenges'):c.execute(f'DELETE FROM {t} WHERE user_id=%s',(uid,))
        audit(c,user['id'],'account.suspend',uid)
    if p['email_confirmed']:background.add_task(account_email.send,p['email'],'Your Kinetta account is suspended',
        f"Hi {p['name']},\n\nYour Kinetta account ({p['login']}) has been suspended, so you can't log in for now and other "
        "people can't see your activities. Nothing has been deleted. To ask about it, reply to this email.")
    return {'ok':True}


@router.post('/people/{uid}/restore')
def restore(uid:int,body:PersonAction,background:BackgroundTasks,user=Depends(admin_user)):
    from . import account_email
    with db.connect() as c:
        p=_target(c,uid,body,user)
        c.execute('UPDATE users SET suspended_at=NULL,suspended_reason=NULL WHERE id=%s',(uid,))
        audit(c,user['id'],'account.restore',uid)
    if p['status']=='suspended' and p['email_confirmed']:background.add_task(account_email.send,p['email'],'Your Kinetta account is back',
        f"Hi {p['name']},\n\nYour Kinetta account ({p['login']}) is active again. You can log in as usual.")
    return {'ok':True}


class RoleIn(BaseModel):
    model_config=ConfigDict(extra='forbid')
    administrator:bool=Field(strict=True)
    confirm:str=Field(max_length=30)


@router.post('/people/{uid}/role')
def role(uid:int,body:RoleIn,user=Depends(admin_user)):
    with db.connect() as c:
        c.execute("SELECT pg_advisory_xact_lock(hashtext('admin-authorization'))")
        c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
        if not c.execute('SELECT 1 FROM users WHERE id=%s AND is_admin',(user['id'],)).fetchone():raise HTTPException(403,'Administrator access was revoked.')
        t=c.execute('SELECT login::text AS login,is_admin FROM users WHERE id=%s FOR UPDATE',(uid,)).fetchone()
        if not t:raise HTTPException(404,'Account not found.')
        if body.confirm!=t['login']:raise HTTPException(400,'Type the account username exactly.')
        if not body.administrator and t['is_admin'] and c.execute('SELECT count(*) AS n FROM users WHERE is_admin').fetchone()['n']<=1:raise HTTPException(409,'The last administrator cannot be removed.')
        c.execute('UPDATE users SET is_admin=%s WHERE id=%s',(body.administrator,uid))
        c.execute('DELETE FROM admin_sessions WHERE user_id=%s',(uid,));c.execute('DELETE FROM admin_challenges WHERE user_id=%s',(uid,))
        audit(c,user['id'],'role.administrator' if body.administrator else 'role.member',uid)
    return {'ok':True}


@router.post('/people')
def add(body:api_account.PersonIn,user=Depends(admin_user)):
    r=api_account.add_person(body,user)
    return r


@router.post('/people/{login}/password')
def password(login:str,body:api_account.ResetIn,user=Depends(admin_user)):
    raise HTTPException(409, 'Reload administration and use the expiring fallback password flow.')


@router.post('/people/{login}/remove')
def remove(login:str,body:api_account.RemoveIn,user=Depends(admin_user)):
    r=api_account.remove_person(login,body,user)
    return r


@router.get('/invites')
def invites(user=Depends(admin_user)):return api_account.list_invites(user)


@router.post('/invites')
def invite(body:api_account.InviteIn,user=Depends(admin_user)):
    r=api_account.create_invite(body,user)
    return r


@router.delete('/invites/{iid}')
def revoke(iid:int,user=Depends(admin_user)):
    with db.connect() as c:
        c.execute("UPDATE beta_responses SET state='cancelled' WHERE invite_id=%s AND state IN ('queued','failed','uncertain')",(iid,))
        if c.execute('SELECT 1 FROM invites WHERE id=%s AND used_at IS NULL FOR UPDATE',(iid,)).fetchone():
            # The applicant no longer has a working link, so the request is unanswered again (before the delete nulls invite_id).
            c.execute("UPDATE beta_requests SET status='new' WHERE invite_id=%s AND status='invited'",(iid,))
            c.execute('DELETE FROM invites WHERE id=%s AND used_at IS NULL',(iid,))
        audit(c,user['id'],'invite.revoke',iid)
    return {'ok':True}


@router.get('/reports')
def reports(user=Depends(admin_user)):return api_social.reports(user)


@router.post('/reports/{rid}/done')
def report_done(rid:int,remove:bool=False,user=Depends(admin_user)):
    raise HTTPException(409, 'Review the reported item and choose a specific action in the current portal.')


@router.get('/audit')
def events(user=Depends(admin_user)):
    with db.connect() as c:
        return c.execute('SELECT a.id,a.action,a.target,a.created,u.login::text AS actor FROM admin_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200').fetchall()


@router.get('/beta')
def beta(user=Depends(admin_user)):
    with db.connect() as c:
        return c.execute("""SELECT b.*,i.expires AS invite_expires,i.used_at AS joined_at,i.used_by AS account_id,
                   (SELECT state FROM beta_responses r WHERE r.request_id=b.id ORDER BY r.created DESC LIMIT 1) AS response_state
                   FROM beta_requests b LEFT JOIN invites i ON i.id=b.invite_id ORDER BY b.created DESC LIMIT 1000""").fetchall()


@router.get('/beta/{rid}/responses')
def responses(rid:int,user=Depends(admin_user)):
    with db.connect() as c:
        return c.execute('SELECT id,kind,recipient,subject,state,created,attempted,error FROM beta_responses WHERE request_id=%s ORDER BY created DESC LIMIT 100',(rid,)).fetchall()


class Draft(BaseModel):
    model_config=ConfigDict(extra='forbid')
    kind:Literal['invite','waitlist','decline','clarify','reply']
    subject:str=Field(min_length=1,max_length=150)
    message:str=Field(min_length=1,max_length=5000)
    confirm_email:str=Field(min_length=3,max_length=120)
    request_key:uuid.UUID


@router.post('/beta/{rid}/responses')
def response(rid:int,body:Draft,user=Depends(admin_user)):
    cfg=admin_mail.settings()
    if not cfg['ready']:raise HTTPException(503,cfg['message'])
    fingerprint=hashlib.sha256(json.dumps([body.kind,body.subject,body.message,body.confirm_email],ensure_ascii=False).encode()).hexdigest()
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('beta-response:'+str(rid),))
        old=c.execute('SELECT id,request_id,actor_id,fingerprint,body,state FROM beta_responses WHERE id=%s',(body.request_key,)).fetchone()
        if old:
            from .admin_auth import unseal
            if old['request_id']!=rid or old['actor_id']!=user['id'] or old['fingerprint']!=fingerprint:raise HTTPException(409,'That request key belongs to a different response.')
            return {'id':str(old['id']),'state':old['state'],'body':unseal(old['body'])}
        b=c.execute('SELECT * FROM beta_requests WHERE id=%s FOR UPDATE',(rid,)).fetchone()
        if not b:raise HTTPException(404,'Request not found.')
        if body.confirm_email!=b['email']:raise HTTPException(409,'Confirm the current recipient address.')
        n=c.execute("SELECT count(*) AS n FROM beta_responses WHERE created>now()-interval '1 hour'").fetchone()['n']
        if n>=50:raise HTTPException(429,'Hourly response limit reached.')
        if c.execute("SELECT 1 FROM beta_responses WHERE request_id=%s AND created>now()-interval '1 minute'",(rid,)).fetchone():raise HTTPException(429,'Wait a minute before preparing another response.')
        c.execute("UPDATE beta_responses SET state='cancelled' WHERE request_id=%s AND state IN ('queued','failed','uncertain')",(rid,))
        text=body.message;iid=None
        if body.kind=='invite':
            base=os.environ.get('KINETTA_PUBLIC_URL','').rstrip('/')
            if not base.startswith('https://'):raise HTTPException(503,'Configure the public HTTPS account URL before inviting.')
            if b['invite_id']:
                existing=c.execute('SELECT used_at FROM invites WHERE id=%s FOR UPDATE',(b['invite_id'],)).fetchone()
                if existing and existing['used_at']:raise HTTPException(409,'This applicant already joined.')
                c.execute('DELETE FROM invites WHERE id=%s AND used_at IS NULL',(b['invite_id'],))
            token=secrets.token_urlsafe(24)
            iid=c.execute("INSERT INTO invites (token_hash,created_by,note,expires) VALUES (%s,%s,%s,now()+interval '7 days') RETURNING id",(auth.token_hash(token),user['id'],b['name'][:60])).fetchone()['id']
            text+='\n\nCreate your Kinetta member account (single-use link, valid 7 days):\n'+base+'/join/'+token+'\n\nYou can use Kinetta in your browser after creating your account.'
            tf=os.environ.get('KINETTA_TESTFLIGHT_URL','')
            if tf.startswith('https://testflight.apple.com/join/'):text+='\nFor the iPhone beta, install TestFlight and Kinetta separately: '+tf+'\nSign in with the same Kinetta account.'
            else:text+='\nAn account invitation does not grant Apple TestFlight access. Contact the beta organizer for iPhone installation access.'
            c.execute("UPDATE beta_requests SET status='invited',invite_id=%s WHERE id=%s",(iid,rid))
        elif body.kind in ('waitlist','decline'):
            # A waitlisted or declined applicant's earlier, unused invitation link stops working too.
            if b['invite_id']:
                if c.execute('SELECT 1 FROM invites WHERE id=%s AND used_at IS NOT NULL',(b['invite_id'],)).fetchone():raise HTTPException(409,'This applicant already joined.')
                c.execute('DELETE FROM invites WHERE id=%s AND used_at IS NULL',(b['invite_id'],));audit(c,user['id'],'invite.revoke',b['invite_id'])
            c.execute('UPDATE beta_requests SET status=%s,invite_id=NULL WHERE id=%s',('waitlisted' if body.kind=='waitlist' else 'declined',rid))
        c.execute('INSERT INTO beta_responses (id,request_id,actor_id,kind,fingerprint,recipient,subject,body,invite_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)',(body.request_key,rid,user['id'],body.kind,fingerprint,b['email'],body.subject,seal(text),iid))
        audit(c,user['id'],'beta.response_queued',rid)
    return {'id':str(body.request_key),'state':'queued','body':text}


@router.post('/responses/{mid}/send')
def send(mid:uuid.UUID,user=Depends(admin_user)):
    result=admin_mail.deliver(mid)
    with db.connect() as c:audit(c,user['id'],'beta.response_'+result['state'],mid)
    return result


@router.post('/email-events')
async def email_events(request:Request):
    raw=b''
    async for chunk in request.stream():
        raw+=chunk
        if len(raw)>65536:raise HTTPException(413,'Event too large.')
    return admin_mail.webhook_event(raw,request.headers)

class DeleteRequest(BaseModel):
    confirm_email:str=Field(min_length=3,max_length=120)

@router.post('/beta/{rid}/delete')
def delete_request(rid:int,body:DeleteRequest,user=Depends(admin_user)):
    with db.connect() as c:
        b=c.execute('SELECT email,invite_id FROM beta_requests WHERE id=%s FOR UPDATE',(rid,)).fetchone()
        if not b:raise HTTPException(404,'Request not found.')
        if body.confirm_email!=b['email']:raise HTTPException(400,'Type the applicant email exactly.')
        c.execute('DELETE FROM beta_requests WHERE id=%s',(rid,))
        if b['invite_id']:c.execute('DELETE FROM invites WHERE id=%s AND used_at IS NULL',(b['invite_id'],))
        audit(c,user['id'],'beta.delete',rid)
    return {'ok':True}
