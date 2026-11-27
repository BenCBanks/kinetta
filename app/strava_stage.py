"""Saved pending step and a single explicitly requested, verified-email reminder."""
import hashlib
import secrets
from . import account_email, db, strava_upload as uploads
from fastapi import HTTPException

REMINDER_SUBJECT='Your Strava history import'
REMINDER_TEXT='Ready to continue bringing your Strava history into Kinetta?\n\nContinue: {resume}\n\nStop this reminder: {stop}'


def read(uid):
    with db.connect() as c:
        stage=c.execute('SELECT state,upload_id,reminder_opt_in,reminder_due,reminder_attempted,reminder_sent,expires FROM strava_import_stage WHERE user_id=%s',(uid,)).fetchone()
        upload=uploads.output(uploads.owned(c,uid,stage['upload_id'])) if stage and stage['upload_id'] else None
        return {'stage':stage,'upload':upload,'current_audience':uploads.current_audience(c,uid),'chunk_size':uploads.CHUNK,'max_size':uploads.MAX_UPLOAD}


def save(uid,opt_in):
    with db.connect() as c:
        uploads.account(c,uid)
        active=c.execute("SELECT 1 FROM strava_uploads WHERE user_id=%s AND state='importing'",(uid,)).fetchone()
        if active:raise HTTPException(409,'Your history is already importing')
        user=c.execute('SELECT email,email_verified_at FROM users WHERE id=%s',(uid,)).fetchone()
        if opt_in and (not user['email'] or not user['email_verified_at']):raise HTTPException(409,'Confirm your email before requesting a reminder')
        if opt_in and not account_email.mail_ready():raise HTTPException(503,'Email reminders are unavailable right now')
        c.execute("INSERT INTO strava_import_stage(user_id) VALUES(%s) ON CONFLICT(user_id) DO NOTHING",(uid,))
        c.execute("""UPDATE strava_import_stage SET state='requested',reminder_opt_in=%s,
          reminder_due=CASE WHEN %s AND reminder_attempted IS NULL THEN coalesce(reminder_due,now()+interval '24 hours') ELSE NULL END,
          updated=now(),expires=now()+interval '90 days' WHERE user_id=%s""",(opt_in,opt_in,uid))
    return read(uid)


def cancel(uid):
    with db.connect() as c:
        uploads.account(c,uid)
        ids=[r['id'] for r in c.execute('SELECT id FROM strava_uploads WHERE user_id=%s AND state=ANY(%s) FOR UPDATE',(uid,list(uploads.ACTIVE))).fetchall()]
        c.execute("UPDATE strava_uploads SET state='cancelled',updated=now() WHERE user_id=%s AND state=ANY(%s)",(uid,list(uploads.ACTIVE)))
        c.execute("UPDATE strava_import_stage SET state='cancelled',reminder_opt_in=false,reminder_due=NULL,stop_hash=NULL,updated=now() WHERE user_id=%s",(uid,))
    import shutil
    for identity in ids:shutil.rmtree(uploads.path(uid,identity).parent,ignore_errors=True)
    return {'ok':True}


def stop(token):
    with db.connect() as c:
        c.execute('UPDATE strava_import_stage SET reminder_opt_in=false,reminder_due=NULL,stop_hash=NULL WHERE stop_hash=%s',(hashlib.sha256(token.encode()).hexdigest(),))
    return {'ok':True}


def send_reminder():
    if not account_email.mail_ready():return False
    # Claim before sending, so an uncertain provider response or process crash can never send twice.
    with db.connect() as c:
        row=c.execute("""SELECT user_id FROM strava_import_stage WHERE state='requested' AND reminder_opt_in
          AND reminder_due<=now() AND reminder_attempted IS NULL AND expires>now() ORDER BY reminder_due LIMIT 1""").fetchone()
        if not row:return False
        uid=row['user_id'];uploads.account(c,uid)
        stage=c.execute("SELECT * FROM strava_import_stage WHERE user_id=%s FOR UPDATE",(uid,)).fetchone()
        if not stage or stage['state']!='requested' or not stage['reminder_opt_in'] or stage['reminder_attempted']:return False
        token=secrets.token_urlsafe(32)
        c.execute('UPDATE strava_import_stage SET reminder_attempted=now(),stop_hash=%s WHERE user_id=%s',(hashlib.sha256(token.encode()).hexdigest(),uid))
    # Locks also serialize import/cancel/account deletion against the actual send. Re-read verified identity here.
    with db.connect() as c:
        uploads.account(c,uid)
        stage=c.execute('SELECT * FROM strava_import_stage WHERE user_id=%s FOR UPDATE',(uid,)).fetchone()
        user=c.execute('SELECT email,email_verified_at,suspended_at FROM users WHERE id=%s',(uid,)).fetchone()
        if (not stage or not stage['reminder_opt_in'] or stage['state']!='requested' or not stage['stop_hash']
                or not user['email'] or not user['email_verified_at'] or user['suspended_at']):return False
        base=account_email._base()
        text=REMINDER_TEXT.format(resume=base+'/me/connections?strava=resume',stop=base+'/api/strava-import/reminders/stop?token='+token)
        sent=account_email.send(user['email'],REMINDER_SUBJECT,text)
        c.execute('UPDATE strava_import_stage SET reminder_sent=%s,reminder_opt_in=false,reminder_due=NULL WHERE user_id=%s',(sent,uid))
        return sent
