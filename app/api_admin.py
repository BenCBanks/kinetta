"""Operator-only portal APIs. No personal health records or provider credentials returned."""
import datetime as dt, hashlib, json, os, secrets, uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ConfigDict
from typing import Literal
from . import db, auth, api_account, api_social, admin_mail
from .admin_auth import admin_user, audit, seal

router=APIRouter(prefix='/api/admin')


@router.get('/overview')
def overview(user=Depends(admin_user)):
    with db.connect() as c:
        counts=c.execute("SELECT (SELECT count(*) FROM users) AS accounts,(SELECT count(*) FROM users WHERE is_admin) AS administrators,(SELECT count(*) FROM beta_requests WHERE status='new') AS pending_requests,(SELECT count(*) FROM reports WHERE status='open') AS reports,(SELECT count(*) FROM imports WHERE status='failed' AND created>now()-interval '1 day') AS failed_imports,(SELECT count(*) FROM connections WHERE status LIKE 'sync failed:%%') AS connection_failures").fetchone()
        from . import signup
        signup_state=signup.state(c)       # mode and real accounts against the cap (#232)
    return {**counts,'email':admin_mail.settings(),'signup':signup_state}


@router.get('/people')
def people(user=Depends(admin_user)):
    with db.connect() as c:
        return c.execute("SELECT u.id,u.login::text AS login,u.name,u.created,u.is_admin,EXISTS(SELECT 1 FROM admin_mfa m WHERE m.user_id=u.id) AS mfa_enabled FROM users u ORDER BY u.created DESC LIMIT 1000").fetchall()


class RoleIn(BaseModel):
    model_config=ConfigDict(extra='forbid')
    administrator:bool=Field(strict=True)
    confirm:str=Field(max_length=30)


@router.post('/people/{uid}/role')
def role(uid:int,body:RoleIn,user=Depends(admin_user)):
    with db.connect() as c:
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
    r=api_account.reset_password(login,body,user)
    return r


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
    r=api_social.report_done(rid,remove,user)
    return r


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
