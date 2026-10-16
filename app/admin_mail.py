"""Explicit beta responses through Resend. No delivery without configured sender/reply-to."""
import base64, datetime as dt, hashlib, hmac, json, os, time
import httpx
from fastapi import HTTPException
from . import db
from .admin_auth import unseal
from .api_beta import EMAIL_RE


def settings():
    sender=os.environ.get('KINETTA_MAIL_FROM','').strip();reply=os.environ.get('KINETTA_MAIL_REPLY_TO','').strip()
    key=db.secret('KINETTA_RESEND_KEY');webhook=db.secret('KINETTA_MAIL_WEBHOOK_SECRET')
    ready=bool(key and EMAIL_RE.fullmatch(sender) and EMAIL_RE.fullmatch(reply) and webhook)
    return {'ready':ready,'sender':sender or None,'reply_to':reply or None,'webhook':bool(webhook),
            'message': 'Email setup required: verified sender, monitored reply-to, provider key and signed webhook.' if not ready else 'Replies go to the monitored reply-to mailbox. Provider acceptance does not prove inbox delivery.'}


def deliver(mid):
    if not settings()['ready']:raise HTTPException(503,settings()['message'])
    # Lock the durable message across workers; crashes leave its idempotency key and first-attempt time intact.
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('beta-mail:'+str(mid),))
        row=c.execute('SELECT * FROM beta_responses WHERE id=%s FOR UPDATE',(mid,)).fetchone()
        if not row:raise HTTPException(404,'Response not found.')
        if row['state'] in ('accepted','delivered','bounced','cancelled'):return {'id':str(mid),'state':row['state']}
        if row['invite_id'] and not c.execute('SELECT 1 FROM invites WHERE id=%s AND expires>now() AND used_at IS NULL',(row['invite_id'],)).fetchone():
            c.execute("UPDATE beta_responses SET state='cancelled',error='Invitation expired, used or revoked. Prepare a fresh response.' WHERE id=%s",(mid,));return {'id':str(mid),'state':'cancelled'}
        if row['first_attempt'] and row['first_attempt']<dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=23):
            c.execute("UPDATE beta_responses SET state='uncertain',error='Retry window ended. Reconcile with provider before preparing another response.' WHERE id=%s",(mid,));return {'id':str(mid),'state':'uncertain'}
    # Commit first_attempt BEFORE network work so a lost acknowledgement cannot reset the safe retry window.
    with db.connect() as c:
        c.execute('UPDATE beta_responses SET first_attempt=coalesce(first_attempt,now()) WHERE id=%s',(mid,))
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('beta-mail:'+str(mid),))
        row=c.execute('SELECT * FROM beta_responses WHERE id=%s FOR UPDATE',(mid,)).fetchone()
        if row['state'] in ('accepted','delivered','bounced','cancelled'):return {'id':str(mid),'state':row['state']}
        try:
            cfg=settings()
            r=httpx.post('https://api.resend.com/emails',headers={'Authorization':'Bearer '+db.secret('KINETTA_RESEND_KEY'),'Idempotency-Key':'kinetta-beta-'+str(mid)},
                         json={'from':cfg['sender'],'to':[row['recipient']],'reply_to':cfg['reply_to'],'subject':row['subject'],'text':unseal(row['body'])},timeout=10)
            r.raise_for_status();pid=r.json()['id']
            if not isinstance(pid,str) or len(pid)>100:raise ValueError('Invalid provider receipt')
            c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('mail-event:'+pid,))
            events=c.execute('SELECT state FROM admin_mail_events WHERE provider_id=%s',(pid,)).fetchall()
            state='bounced' if any(e['state']=='bounced' for e in events) else 'delivered' if any(e['state']=='delivered' for e in events) else 'accepted'
            c.execute("UPDATE beta_responses SET state=%s,provider_id=%s,attempted=now(),error=NULL WHERE id=%s",(state,pid,mid));return {'id':str(mid),'state':state}
        except Exception:
            # Provider response text may contain recipients/credentials; never return it or put it in logs.
            c.execute("UPDATE beta_responses SET state='failed',attempted=now(),error='Provider did not confirm acceptance. Retry this same response within 23 hours.' WHERE id=%s",(mid,))
            return {'id':str(mid),'state':'failed'}


def webhook_event(raw,headers):
    secret=db.secret('KINETTA_MAIL_WEBHOOK_SECRET')
    if not secret:raise HTTPException(503,'Email setup required.')
    eid=headers.get('svix-id','');stamp=headers.get('svix-timestamp','')
    try:
        if not eid or len(eid)>200 or abs(time.time()-int(stamp))>300:raise ValueError()
        key=base64.b64decode(secret.removeprefix('whsec_'),validate=True)
        expected=base64.b64encode(hmac.new(key,eid.encode()+b'.'+stamp.encode()+b'.'+raw,hashlib.sha256).digest()).decode()
        if not any(hmac.compare_digest(sig,'v1,'+expected) for sig in headers.get('svix-signature','').split()):raise ValueError()
        event=json.loads(raw);kind=event['type'];pid=event['data']['email_id']
    except Exception:raise HTTPException(403,'Invalid email event signature.')
    if not isinstance(pid,str) or len(pid)>100:raise HTTPException(400,'Invalid event.')
    state={'email.delivered':'delivered','email.bounced':'bounced','email.failed':'bounced'}.get(kind)
    with db.connect() as c:
        c.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('mail-event:'+pid,))
        if not c.execute('INSERT INTO admin_mail_events (id,provider_id,state) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING RETURNING id',(eid,pid,state)).fetchone():return {'ok':True}
        if state:
            c.execute("UPDATE beta_responses SET state=%s WHERE provider_id=%s AND (state <> 'bounced' OR %s='bounced')",(state,pid,state))
    return {'ok':True}
