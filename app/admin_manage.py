"""Confirmed account actions with durable replay receipts. Existing legacy routes remain separate compatibility paths."""
from typing import Literal
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import Field, StrictBool
from . import db, account_email, api_account
from .admin_auth import admin_user
from .admin_actions import ActionIn, replay, complete

router = APIRouter(prefix='/api/admin')
ACTIONS = {'reset-email':'account.reset_email','signout':'account.sign_out_everywhere','suspend':'account.suspend',
           'restore':'account.restore','role':'role.change','remove':'account.remove'}

class ManageIn(ActionIn):
    confirm: str = Field(max_length=30)
    reason: str | None = Field(None, max_length=300)
    administrator: StrictBool | None = None


@router.post('/manage/{uid}/{action}')
def manage(uid: int, action: Literal['reset-email','signout','suspend','restore','role','remove'], body: ManageIn,
           background: BackgroundTasks, user=Depends(admin_user)):
    with db.connect() as c:
        digest, old = replay(c, user, body, ACTIONS[action], uid)
        if old: result = old
        else:
            if action == 'role': c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
            p = c.execute('SELECT id,login::text AS login,name,is_admin,email,email_verified_at,sql_role,suspended_at,password_change_expires FROM users WHERE id=%s FOR UPDATE', (uid,)).fetchone()
            if not p: raise HTTPException(404, 'Account not found.')
            if body.confirm != p['login']: raise HTTPException(400, 'Type the account username exactly.')
            if action in ('reset-email','suspend','restore','remove') and (p['is_admin'] or uid == user['id']):
                raise HTTPException(409, 'Change the administrator role first; use personal settings for your own account.')
            if action == 'reset-email':
                if not p['email_verified_at']: raise HTTPException(409, 'This account has no confirmed email.')
                if not account_email.mail_ready(): raise HTTPException(503, 'Email is not set up on this server.')
                account_email.send_reset(background, c, p, by_admin=True)
            if action in ('signout','suspend','role','remove'):
                for table in ('sessions','admin_sessions','admin_challenges','account_password_changes'):
                    # A role change must not sign ordinary app sessions out; match the existing role contract.
                    if action == 'role' and table in ('sessions','account_password_changes'): continue
                    c.execute(f'DELETE FROM {table} WHERE user_id=%s', (uid,))
            if action == 'suspend':
                if not (body.reason or '').strip(): raise HTTPException(400, 'Write a short private reason.')
                c.execute('UPDATE users SET suspended_at=coalesce(suspended_at,now()),suspended_reason=%s WHERE id=%s', (body.reason.strip(), uid))
            if action == 'restore': c.execute('UPDATE users SET suspended_at=NULL,suspended_reason=NULL WHERE id=%s', (uid,))
            if action == 'role':
                if body.administrator is None: raise HTTPException(400, 'Choose the new role.')
                if body.administrator and (p['suspended_at'] or p['password_change_expires']):
                    raise HTTPException(409, 'Restore the account and finish password recovery before promoting it.')
                if not body.administrator and p['is_admin'] and c.execute('SELECT count(*) AS n FROM users WHERE is_admin').fetchone()['n'] <= 1:
                    raise HTTPException(409, 'The last administrator cannot be removed.')
                c.execute('UPDATE users SET is_admin=%s WHERE id=%s', (body.administrator, uid))
            if action == 'remove': api_account.erase(c, p)
            if action in ('suspend','restore') and p['email_verified_at']:
                background.add_task(account_email.send, p['email'], 'Your Kinetta account was '+('suspended' if action=='suspend' else 'restored'),
                    'Hi '+p['name']+',\n\nYour Kinetta account was '+('suspended while a report is reviewed. Your data is kept.' if action=='suspend' else 'restored. You can sign in again.')+'\n\nReply to this email if you need help.')
            result = complete(c, user, body, ACTIONS[action], uid, digest)
    if action == 'remove': api_account.erase_files(uid)  # Safe to repeat after a lost response; IDs are never reused.
    return result
