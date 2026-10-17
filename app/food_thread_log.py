"""Food-thread logging from resolved own records. No provider or network work."""
import datetime as dt
import hashlib
import json
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from pydantic import Field, ValidationError
from . import db, meal_chat, food_thread, food_thread_facts as facts


class ThreadResolveIn(meal_chat.ResolveIn):
    # The permanent thread accepts longer paragraphs; the legacy endpoint keeps
    # its existing 400-character contract. Both use the same bounded parser.
    say: str | None = Field(None,max_length=4000)


def locked_message(c,uid,mid):
    c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,))
    message=c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE id=%s AND user_id=%s FOR UPDATE',(mid,uid)).fetchone()
    if not message:raise HTTPException(404,'Message not found')
    if message['kind']!='user':raise HTTPException(400,'Choose a message you sent')
    return message


def stored_reply(c,uid,message):
    return c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND reply_to=%s',(uid,message['id'])).fetchone()


def expected_meal(c,uid,captured):
    p=c.execute('SELECT tz FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    zone=db.valid_tz(p.get('tz')) or db.DEFAULT_TZ;hour=captured.astimezone(ZoneInfo(zone)).hour
    learned=c.execute('''SELECT meal,count(DISTINCT day) AS n FROM food_entries
                         WHERE user_id=%s AND created>now()-interval '60 days'
                         AND day=(created AT TIME ZONE %s)::date
                         AND extract(hour FROM created AT TIME ZONE %s)::int=%s
                         GROUP BY meal HAVING count(DISTINCT day)>=3 ORDER BY count(DISTINCT day) DESC,meal LIMIT 1''',(uid,zone,zone,hour)).fetchone()
    return learned['meal'] if learned else ('breakfast' if hour<10 else 'lunch' if hour<14 else 'snacks' if hour<17 else 'dinner' if hour<21 else 'snacks')


def resolve(c,uid,message):
    return meal_chat.resolve_data(c,uid,ThreadResolveIn(say=message['body']),anchor=message['local_day'])


def make_result(c,uid,message,resolution):
    day=resolution.get('day') or message['local_day'].isoformat()
    meal=resolution.get('meal') or expected_meal(c,uid,message['captured_at'])
    items=resolution.get('items',[])
    ready=resolution.get('status')=='ready' and bool(items)
    if ready:
        kcal=facts.kcal(sum(i['totals']['kcal'] for i in items))
        names=', '.join(i['name'] for i in items[:3])+(' and more' if len(items)>3 else '')
        text=f"{meal.capitalize()} · {names} · about {kcal:,} kcal from your foods. Tap Log to add it."
    else:
        first=next((i for i in items if i['status']!='ready'),None)
        text=(first or {}).get('message') or resolution.get('message') or 'Which food would you like to add?'
    return {'kind':'preview' if ready else 'needs','day':day,'meal':meal,'resolution':resolution,
            'text':text,'source':'your foods','as_of':dt.datetime.now(dt.timezone.utc).isoformat()}


def entry_digest(row):
    keys=('id','day','meal','name','brand','amount','unit','kcal','protein_g','carbs_g','fat_g','fiber_g','source','ref')
    return hashlib.sha256(json.dumps({k:row.get(k) for k in keys},default=str,sort_keys=True).encode()).hexdigest()


def needs_detail(c,uid,message,result,error):
    result={**result,'kind':'needs','text':'Check the portion before logging this food. What amount should I use?','validation_error':str(getattr(error,'detail','Check the portion.'))}
    result['resolution']={**result.get('resolution',{}),'status':'needs','message':result['text']}
    return food_thread.finish_reply(c,uid,message,result)


def commit_log(c,uid,message,result):
    resolution=result['resolution']
    if resolution.get('status')!='ready' or not resolution.get('items'):
        raise HTTPException(409,'This food still needs a detail before logging')
    body=meal_chat.ConfirmIn(items=[{k:item[k] for k in ('kind','id','portion','expected')} for item in resolution['items']],
                             issued=resolution['issued'],client_id=str(message['client_id']),
                             day=result['day'],meal=result['meal'],confirm=True)
    saved=meal_chat.confirm_data(c,uid,body)
    if not saved['ids']:raise HTTPException(400,'This food has no items to log yet')
    totals=c.execute('''SELECT sum(kcal) AS kcal,sum(protein_g) AS protein_g FROM food_entries
                        WHERE user_id=%s AND id=ANY(%s)''',(uid,saved['ids'])).fetchone()
    saved_rows=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=ANY(%s)',(uid,saved['ids'])).fetchall()
    result={**result,'kind':'log','entry_ids':saved['ids'],'entry_digests':{str(r['id']):entry_digest(r) for r in saved_rows},
            'text':result['text'].removesuffix(' Tap Log to add it.'),
            'feedback':facts.feedback(facts.snapshot(c,uid,body.day),dict(totals),seed=message['id']),
            'as_of':dt.datetime.now(dt.timezone.utc).isoformat()}
    response=food_thread.finish_reply(c,uid,message,result)
    for mid in (message['id'],response['messages'][-1]['id']):
        for eid in saved['ids']:
            c.execute('''INSERT INTO food_chat_entries(user_id,message_id,entry_id) VALUES (%s,%s,%s)
                         ON CONFLICT (message_id,entry_id) DO NOTHING''',(uid,mid,eid))
    response['messages']=food_thread.message_entries(c,uid,response['messages'])
    return response


def process(c,uid,message):
    if message['state']!='pending':return food_thread.answer_with(c,uid,message)
    question=facts.classify(message['body'],message['local_day'])
    if question is not None:return food_thread.answer_with(c,uid,message,question=question)
    resolution=resolve(c,uid,message);result=make_result(c,uid,message,resolution)
    p=food_thread.preferences(c,uid) or {}
    if result['kind']=='preview' and p.get('auto_log',True):
        try:
            with c.transaction(): return commit_log(c,uid,message,result)
        except (HTTPException,ValidationError) as error:
            if isinstance(error,HTTPException) and error.status_code not in (400,404,409,422): raise
            return needs_detail(c,uid,message,result,error)
    return food_thread.finish_reply(c,uid,message,result)


def explicit_log(c,uid,message):
    reply=stored_reply(c,uid,message)
    if not reply:raise HTTPException(409,'Open the message’s food details first')
    if reply['result'].get('kind')=='log':
        return food_thread.answer_with(c,uid,message),False
    if reply['result'].get('kind')!='preview':
        raise HTTPException(409,'Resolve the food’s details before logging')
    try:
        with c.transaction(): return commit_log(c,uid,message,reply['result']),False
    except HTTPException as error:
        if error.status_code not in (400,404,409,422):raise
        if error.status_code in (400,422): return needs_detail(c,uid,message,reply['result'],error),False
        # Keep the words and refresh the card, without logging a changed or expired
        # preview. The next explicit tap approves these refreshed details.
        result=make_result(c,uid,message,resolve(c,uid,message))
        if 'expired' in str(error.detail).lower():
            fields=lambda r:[{k:i.get(k) for k in ('kind','id','portion','totals')} for i in r.get('items',[])]
            if fields(result['resolution'])==fields(reply['result']['resolution']) and result['kind']=='preview':
                with c.transaction(): return commit_log(c,uid,message,result),False
        result['text']='The food details changed. '+result['text']
        response=food_thread.finish_reply(c,uid,message,result)
        response['changed']=True
        return response,True


def undo(c,uid,message):
    reply=stored_reply(c,uid,message)
    if not reply or reply['result'].get('kind') not in ('log','undone'):
        raise HTTPException(409,'Only logged foods have an Undo action')
    if reply['result']['kind']=='undone':
        return {**food_thread.answer_with(c,uid,message),'removed':0}
    ids=[row['entry_id'] for row in c.execute('SELECT entry_id FROM food_chat_entries WHERE user_id=%s AND message_id=%s',(uid,message['id']))]
    rows=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=ANY(%s) FOR UPDATE',(uid,ids)).fetchall() if ids else []
    unchanged=[r['id'] for r in rows if reply['result'].get('entry_digests',{}).get(str(r['id']))==entry_digest(r)]
    kept=len(rows)-len(unchanged)
    removed=c.execute('DELETE FROM food_entries WHERE user_id=%s AND id=ANY(%s) RETURNING id',(uid,unchanged)).fetchall() if unchanged else []
    result={**reply['result'],'kind':'undone','entry_ids':[], 'text':'Removed unchanged foods; later-edited foods were kept. Open your food log to review them.' if kept else 'Removed those foods from your food log.',
            'as_of':dt.datetime.now(dt.timezone.utc).isoformat()}
    result.pop('feedback',None)
    return {**food_thread.finish_reply(c,uid,message,result),'removed':len(removed),'kept':kept}
