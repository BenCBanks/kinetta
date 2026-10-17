"""An explicit, saved food-only Kit answer. No model call on history reads.

The existing tool coach/prompt is reused with a code-enforced food allowlist.
Per-account locks claim a durable lease, then all provider work runs outside it.
"""
import datetime as dt
import hashlib
import json
from uuid import uuid4
from fastapi import HTTPException
from . import ai_access,ai_budget,ai_release,coach,coach_chat,db,food_thread
from . import food_thread_log as engine
from .food_photo import brake


def response(c,uid,message,**extra):
    return {**food_thread.answer_with(c,uid,message),**extra}


def generate(uid,mid,*,refresh=False):
    with db.connect() as c:
        message=engine.locked_message(c,uid,mid)
        reply=engine.stored_reply(c,uid,message)
        result=(reply or {}).get('result') or {}
        if message['state']=='cancelled' or not reply or not (result.get('offer_kit') or result.get('intent')=='review'):
            raise HTTPException(409,'Ask a food question in the conversation first')
        if result.get('kit') and not refresh:return response(c,uid,message)
        if not ai_release.enabled('food'):raise HTTPException(503,'Kit food questions are not available yet. Your food log and numbers still work.')
        ai_access.require(uid,'coach',c)
        if not coach.allowed(uid,connection=c):raise HTTPException(400,coach.off())
        old=c.execute('SELECT * FROM food_chat_jobs WHERE user_id=%s AND message_id=%s FOR UPDATE',(uid,mid)).fetchone()
        now=dt.datetime.now(dt.timezone.utc)
        if old and old['state']=='running' and old['expires']>now:return response(c,uid,message,processing=True)
        lease=uuid4();question=f"Food question for logged day {message['local_day'].isoformat()} (the day meant by today in this message): {message['body']}"
        digest=hashlib.sha256((question+ai_release.fingerprint()).encode()).hexdigest()
        c.execute('''INSERT INTO food_chat_jobs(user_id,message_id,lease,expires,state,input_hash)
                     VALUES (%s,%s,%s,now()+interval '300 seconds','running',%s)
                     ON CONFLICT(user_id,message_id) DO UPDATE SET lease=excluded.lease,expires=excluded.expires,
                     state='running',input_hash=excluded.input_hash''',(uid,mid,lease,digest))
        result.pop('kit_error',None);result['kit_processing']=True
        food_thread.finish_reply(c,uid,message,result)
        reply_id=reply['id']
    answer=None;error=None
    try:
        # This counter can use a separate connection only after the account lock
        # commits; its foreign key must not wait on our own locked user row.
        brake(uid,limit=10,kind='coach_questions',what='questions for Kit')
        with ai_budget.scope(uid,message['client_id'],feature='food chat Kit'):
            answer=coach_chat.answer(uid,question,food_only=True)
    except HTTPException as exc:
        error=exc.detail if isinstance(exc.detail,str) else 'Kit is unavailable. Your food log is unchanged.'
    except ValueError as exc:
        error=str(exc)[:500]
    except Exception:
        error='Kit could not finish this answer. Your food log and code answer are kept; you can try again.'
    with db.connect() as c:
        try:message=engine.locked_message(c,uid,mid)
        except HTTPException as exc:
            if exc.status_code==404:return {'cancelled':True,'messages':[]}
            raise
        job=c.execute('SELECT * FROM food_chat_jobs WHERE user_id=%s AND message_id=%s FOR UPDATE',(uid,mid)).fetchone()
        reply=engine.stored_reply(c,uid,message)
        if not job or job['lease']!=lease or job['state']!='running' or message['state']=='cancelled' or not reply or reply['id']!=reply_id:
            if job and job['lease']==lease:c.execute("UPDATE food_chat_jobs SET state='cancelled' WHERE user_id=%s AND message_id=%s",(uid,mid))
            return {'cancelled':True,'messages':[]}
        result=dict(reply['result']);result['kit_processing']=False
        if not coach.allowed(uid,connection=c) or not ai_release.enabled('food'):
            answer=None;error='AI access or consent changed. Your food log and code answer are kept.'
        if answer:
            result['kit']={k:answer[k] for k in ('interpretation','facts','selection','limitations','prompt_version') if k in answer}
            result['kit_at']=dt.datetime.now(dt.timezone.utc).isoformat();result.pop('kit_error',None)
        else:result['kit_error']=error or 'Kit could not finish. Your food log is unchanged.'
        c.execute('UPDATE food_chat_jobs SET state=%s WHERE user_id=%s AND message_id=%s',('done' if answer else 'failed',uid,mid))
        return food_thread.finish_reply(c,uid,message,result)
