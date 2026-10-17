"""Private, durable food conversation storage and deterministic processing (#122 D).

Text and owner-bound food links are kept; photos are not retained. Numbers answers
and fully resolved own-food logging use code only. Food/reply changes commit
together, with replay protection, an optional explicit Log tap and durable Undo.
Unknown-food processing and the visible thread follow separately.
"""
import datetime as dt
import json
from typing import Literal
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictBool, field_validator

from . import db
from .auth import current_user

router = APIRouter(prefix='/api/food/thread')
COLUMNS = 'id, client_id, kind, body, captured_at, created, local_day, state, reply_to, result'


class MessageIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    client_id: UUID
    body: str = Field(min_length=1, max_length=4000)
    captured_at: AwareDatetime | None = None

    @field_validator('body')
    @classmethod
    def text_only(cls, value):
        value = value.strip()
        if not value:
            raise ValueError('Write a message first')
        if 'data:image/' in value.lower():
            raise ValueError('Use the photo tool; images are not saved in the thread')
        return value


def preferences(c, uid):
    return c.execute('''SELECT food_chat_auto_log AS auto_log, food_chat_tone AS tone
                        FROM profile WHERE user_id = %s''', (uid,)).fetchone()


def message_entries(c, uid, messages):
    """Food links are bound to both owners in SQL and by composite foreign keys."""
    grouped = {}
    if messages:
        ids = [m['id'] for m in messages]
        rows = c.execute('''SELECT l.message_id, e.id, e.day, e.meal, e.name, e.amount, e.unit,
                              e.kcal, e.protein_g, e.carbs_g, e.fat_g, e.fiber_g, e.source
                            FROM food_chat_entries l JOIN food_entries e
                              ON e.id = l.entry_id AND e.user_id = l.user_id
                            WHERE l.user_id = %s AND l.message_id = ANY(%s)
                            ORDER BY e.id''', (uid, ids)).fetchall()
        for row in rows:
            grouped.setdefault(row.pop('message_id'), []).append(row)
    return [{**m, 'entries': grouped.get(m['id'], [])} for m in messages]


@router.get('')
def history(before: int | None = Query(None, gt=0), limit: int = Query(30, ge=1, le=100), user=Depends(current_user)):
    with db.connect() as c:
        rows = c.execute(f'''SELECT {COLUMNS} FROM food_chat_messages WHERE user_id = %s
                             AND (%s::bigint IS NULL OR id < %s)
                             ORDER BY id DESC LIMIT %s''', (user['id'], before, before, limit + 1)).fetchall()
        more = len(rows) > limit
        rows = list(reversed(rows[:limit]))
        return {'messages': message_entries(c, user['id'], rows),
                'before': rows[0]['id'] if more else None, 'has_more': more,
                'preferences': preferences(c, user['id'])}


@router.post('/messages')
def append(body: MessageIn, response: Response, user=Depends(current_user)):
    uid = user['id']
    with db.connect() as c:
        p = c.execute('SELECT tz FROM profile WHERE user_id = %s', (uid,)).fetchone() or {}
        captured = body.captured_at or dt.datetime.now(dt.timezone.utc)
        # A phone clock ahead of the server must not strand an offline message.
        now = dt.datetime.now(dt.timezone.utc)
        if captured > now + dt.timedelta(minutes=10):
            captured = now
        try:
            local_day = captured.astimezone(ZoneInfo(p.get('tz') or db.DEFAULT_TZ)).date()
        except (ValueError, OverflowError):
            raise HTTPException(400, 'Message time is outside the supported range')
        row = c.execute(f'''INSERT INTO food_chat_messages
                            (user_id, client_id, kind, body, captured_at, local_day, state)
                            VALUES (%s, %s, 'user', %s, %s, %s, 'pending')
                            ON CONFLICT (user_id, client_id) DO NOTHING RETURNING {COLUMNS}''',
                        (uid, body.client_id, body.body, captured, local_day)).fetchone()
        created = row is not None
        if not created:
            row = c.execute(f'SELECT {COLUMNS} FROM food_chat_messages WHERE user_id = %s AND client_id = %s',
                            (uid, body.client_id)).fetchone()
            if row['body'] != body.body or row['kind'] != 'user':
                raise HTTPException(409, 'That message identity was already used for different text')
        response.status_code = 201 if created else 200
        return {'message': message_entries(c, uid, [row])[0], 'created': created}


@router.delete('/messages/{mid}')
def remove(mid: int, user=Depends(current_user)):
    with db.connect() as c:
        found = c.execute('DELETE FROM food_chat_messages WHERE id = %s AND user_id = %s RETURNING id',
                          (mid, user['id'])).fetchone()
        if not found:
            raise HTTPException(404, 'Message not found')
    # Deleting conversation text is independent of deleting a logged food.
    return {'deleted': True, 'food_kept': True}


class PreferencesIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    auto_log: StrictBool | None = None
    tone: Literal['supportive', 'numbers'] | None = None


@router.get('/preferences')
def get_preferences(user=Depends(current_user)):
    with db.connect() as c:
        return preferences(c, user['id'])


@router.put('/preferences')
def set_preferences(body: PreferencesIn, user=Depends(current_user)):
    values = body.model_dump(exclude_unset=True)
    if not values or any(v is None for v in values.values()):
        raise HTTPException(422, 'Choose a logging or feedback preference')
    names = {'auto_log': 'food_chat_auto_log', 'tone': 'food_chat_tone'}
    with db.connect() as c:
        sets = ', '.join(names[key] + ' = %s' for key in values)
        c.execute(f'UPDATE profile SET {sets} WHERE user_id = %s', (*values.values(), user['id']))
        return preferences(c, user['id'])


class AnswerIn(BaseModel):
    model_config = ConfigDict(extra='forbid')


def finish_reply(c, uid, message, result):
    """The caller holds the account and message locks. Reply and state commit together."""
    row = c.execute(f'''INSERT INTO food_chat_messages
                        (user_id,client_id,kind,body,captured_at,local_day,state,reply_to,result)
                        VALUES (%s,%s,'reply',%s,%s,%s,'answered',%s,%s)
                        ON CONFLICT (user_id,reply_to) DO UPDATE SET body=excluded.body,result=excluded.result,state='answered' RETURNING {COLUMNS}''',
                    (uid,uuid4(),result['text'],message['captured_at'],message['local_day'],message['id'],json.dumps(result))).fetchone()
    updated = c.execute(f'''UPDATE food_chat_messages SET state='answered',result=%s
                             WHERE id=%s AND user_id=%s RETURNING {COLUMNS}''',
                        (json.dumps({'kind':result['kind'],'reply_id':row['id']}),message['id'],uid)).fetchone()
    return {'handled':True,'messages':message_entries(c,uid,[updated,row])}


def answer_with(c, uid, message):
    from . import food_thread_facts as facts
    if message['kind'] != 'user':
        raise HTTPException(400,'Only a message you sent can be answered')
    if message['state']=='answered':
        reply=c.execute(f'SELECT {COLUMNS} FROM food_chat_messages WHERE user_id=%s AND reply_to=%s',(uid,message['id'])).fetchone()
        return {'handled':True,'messages':message_entries(c,uid,[message]+([reply] if reply else []))}
    if message['state']!='pending':
        raise HTTPException(409,'This message is no longer pending')
    question=facts.classify(message['body'],message['local_day'])
    if question is None:
        return {'handled':False,'messages':message_entries(c,uid,[message])}
    if question['kind']=='clarify':
        result={'kind':'answer','intent':'clarify','text':question['text'],'source':'code'}
    else:
        result=facts.answer(question,facts.snapshot(c,uid,question['day']))
    result['as_of']=dt.datetime.now(dt.timezone.utc).isoformat()
    return finish_reply(c,uid,message,result)


@router.post('/messages/{mid}/answer')
def answer_message(mid: int, body: AnswerIn, user=Depends(current_user)):
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        message=c.execute(f'SELECT {COLUMNS} FROM food_chat_messages WHERE id=%s AND user_id=%s FOR UPDATE',(mid,user['id'])).fetchone()
        if not message:
            raise HTTPException(404,'Message not found')
        return answer_with(c,user['id'],message)


class LogIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    confirm: StrictBool


@router.post('/messages/{mid}/process')
def process_message(mid: int, body: AnswerIn, user=Depends(current_user)):
    from . import food_thread_log as engine
    with db.connect() as c:
        message=engine.locked_message(c,user['id'],mid)
        return engine.process(c,user['id'],message)


@router.post('/messages/{mid}/log')
def log_message(mid: int, body: LogIn, response: Response, user=Depends(current_user)):
    from . import food_thread_log as engine
    if body.confirm is not True:raise HTTPException(400,'Tap Log to confirm these foods')
    with db.connect() as c:
        message=engine.locked_message(c,user['id'],mid)
        result,changed=engine.explicit_log(c,user['id'],message)
        if changed:response.status_code=409
        return result


@router.post('/messages/{mid}/undo')
def undo_message(mid: int, body: AnswerIn, user=Depends(current_user)):
    from . import food_thread_log as engine
    with db.connect() as c:
        message=engine.locked_message(c,user['id'],mid)
        return engine.undo(c,user['id'],message)
