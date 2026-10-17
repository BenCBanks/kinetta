"""Atomic, neutral conversation receipts for deliberate list/picker logging.

One card per food, with a stable owner-bound identity. Replay after Undo/removal
must not resurrect food, and deleting only the text must not resurrect the text.
No network/provider work and no new personal tables.
"""
import datetime as dt
import json
from uuid import uuid5, NAMESPACE_URL
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from . import nutrients as N
from . import db

ENTRY = 'id, day, meal, name, brand, amount, unit, kcal, protein_g, carbs_g, fat_g, fiber_g, sodium_mg, sugar_g, saturated_fat_g, source, ref, client_id'


def identity(uid,client_id):
    return uuid5(NAMESPACE_URL,f'kinetta:food-receipt:{uid}:client:{client_id}')


def guard(c,uid,client_id):
    """Caller holds the account lock; return False only for deliberately deleted text."""
    if not client_id:return True
    key=identity(uid,client_id)
    root=c.execute('SELECT id,result FROM food_chat_messages WHERE user_id=%s AND client_id=%s',(uid,key)).fetchone()
    removed=c.execute('SELECT 1 FROM food_chat_cancellations WHERE user_id=%s AND client_id=%s',(uid,key)).fetchone()
    if not root and not removed:return True
    exists=c.execute('SELECT id FROM food_entries WHERE user_id=%s AND client_id=%s',(uid,client_id)).fetchone()
    if not exists:
        raise HTTPException(409,{'code':'entry_cancelled','message':'This food was already removed. Start a new log if you want to add it again.'})
    return not bool(removed)


def create(c,uid,ids,captured_at=None):
    from . import food_thread,food_thread_facts as facts
    rows=c.execute(f'SELECT {ENTRY} FROM food_entries WHERE user_id=%s AND id=ANY(%s) ORDER BY id',(uid,ids)).fetchall()
    now=dt.datetime.now(dt.timezone.utc);captured=captured_at or now
    if captured.tzinfo is None:raise HTTPException(422,'Capture time needs a time zone')
    if captured>now+dt.timedelta(minutes=10):captured=now
    p=c.execute('SELECT tz FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    try:local_day=captured.astimezone(ZoneInfo(p.get('tz') or db.DEFAULT_TZ)).date()
    except (ValueError,OverflowError):raise HTTPException(400,'Capture time is outside the supported range')
    messages=[]
    for i,entry in enumerate(rows):
        key=identity(uid,entry['client_id']) if entry['client_id'] else uuid5(NAMESPACE_URL,f"kinetta:food-receipt:{uid}:entry:{entry['id']}")
        if not guard(c,uid,entry['client_id']):continue
        existing=c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND client_id=%s',(uid,key)).fetchone()
        if existing:
            reply=c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND reply_to=%s',(uid,existing['id'])).fetchone()
            messages += [existing]+([reply] if reply else [])
            continue
        metadata={'receipt':{'client_id':entry['client_id'],'source':entry['source']}}
        root=c.execute(f'''INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state,result)
                            VALUES (%s,%s,'user',%s,%s,%s,'pending',%s) RETURNING {food_thread.COLUMNS}''',
                       (uid,key,'Logged '+entry['name'],captured,local_day,json.dumps(metadata))).fetchone()
        result={'kind':'log','text':'Saved from your food picker.','day':entry['day'].isoformat(),'meal':entry['meal'],
                'entry_ids':[entry['id']],'logged_unknown':[k for k in N.ALL if entry[k] is None or (isinstance((entry.get('ref') or {}).get('unknown_nutrients'),list) and k in entry['ref']['unknown_nutrients'])],'logged_totals':{k:entry[k] for k in N.ALL},'source':'your food log','as_of':now.isoformat()}
        if i==len(rows)-1:result['feedback']=facts.feedback(facts.snapshot(c,uid,entry['day']),seed=root['id'])
        saved=food_thread.finish_reply(c,uid,root,result)
        for mid in (root['id'],saved['messages'][-1]['id']):
            c.execute('INSERT INTO food_chat_entries(user_id,message_id,entry_id) VALUES (%s,%s,%s) ON CONFLICT DO NOTHING',(uid,mid,entry['id']))
        messages += food_thread.message_entries(c,uid,saved['messages'])
    return food_thread.message_entries(c,uid,messages)
