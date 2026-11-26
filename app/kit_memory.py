"""Bounded memory of the person's own words, never model-invented facts or measurements."""
import re
from typing import Literal
from fastapi import HTTPException
from pydantic import Field, field_validator
from .coach_tools import Empty
from . import coach

LIMIT = 12
# Keep preference/routine/goal statements automatically. Do not save every question,
# uncertain idea, quoted command or an assistant's interpretation as a personal fact.
STATEMENT = re.compile(r"^(?:I(?: am |[’']m | prefer | avoid | eat | follow | train | run | ride | walk | work | can(?:not|[’']t) | don[’']t | do not | have | want | need )|My (?:goal|aim|schedule|routine|diet|preference|available days)\b)", re.I)


def remember(c, uid, question, health_included=False):
    # Retain a clear statement even when the next sentence asks a question:
    # "I'm vegetarian. What could I eat?" keeps only "I'm vegetarian."
    statements=[]
    for part in re.split(r'(?<=[.!?])\s+|\n+',question):
        text=part.strip()
        if not text or len(text)>400 or '?' in text or not STATEMENT.search(text):continue
        if re.search(r"\b(?:remember|forget|ignore|instruction|system|maybe|might|perhaps|not sure)\b",text,re.I):continue
        statements.append(text)
        if len(statements)==3:break
    for text in statements:
        c.execute("""INSERT INTO kit_memories(user_id,text,health_included,kind) VALUES (%s,%s,%s,%s)
          ON CONFLICT(user_id,text) DO UPDATE SET updated=now(),health_included=kit_memories.health_included OR excluded.health_included""",(uid,text,health_included,kind(text)))

    c.execute("""DELETE FROM kit_memories WHERE user_id=%s AND id NOT IN
      (SELECT id FROM kit_memories WHERE user_id=%s ORDER BY updated DESC,id DESC LIMIT %s)""", (uid,uid,LIMIT))


def context(c, uid):
    settings = c.execute('SELECT memory_enabled,memory_version FROM kit_conversations WHERE user_id=%s', (uid,)).fetchone()
    if not settings['memory_enabled']:
        return [],settings['memory_version'],False
    rows=c.execute("""SELECT text,updated,health_included FROM kit_memories WHERE user_id=%s
      AND updated>now()-interval '180 days' ORDER BY updated DESC,id DESC LIMIT %s""", (uid,LIMIT)).fetchall()
    health=coach.health_ok(c,uid)
    allowed=[row for row in rows if health or not row['health_included']]
    return [{'said_at':str(row['updated'].date()),'user_said':row['text']} for row in allowed],settings['memory_version'],any(row['health_included'] for row in allowed)


def kind(text):
    if re.search(r"^(?:My (?:goal|aim)|I (?:want|need))\b",text,re.I):return 'goal'
    if re.search(r"^(?:My (?:schedule|routine|available days)|I (?:train|run|ride|walk|work))\b",text,re.I):return 'routine'
    return 'preference'


class MemoryIn(Empty):
    text: str = Field(min_length=1,max_length=400)
    kind: Literal['goal','preference','routine']
    version: int = Field(ge=0,strict=True)

    @field_validator('text')
    @classmethod
    def words(cls,text):
        text=text.strip()
        if not text:raise ValueError('Write a detail to remember')
        return text


def changed(c,uid):
    # The caller holds the same account lock as generation. Stop old-memory output,
    # including an answer already in flight; nothing is silently retried.
    c.execute('UPDATE kit_conversations SET memory_version=memory_version+1 WHERE user_id=%s',(uid,))
    c.execute("""UPDATE kit_turns SET state='failed',lease=NULL,expires=NULL,
      error='Kit memory changed. Tap Retry to use the updated details.'
      WHERE user_id=%s AND state IN ('pending','running')""",(uid,))


def save(c,uid,body,memory_id=None):
    settings=c.execute('SELECT memory_enabled,memory_version FROM kit_conversations WHERE user_id=%s',(uid,)).fetchone()
    if not settings['memory_enabled']:raise HTTPException(409,'Turn on Kit memory before saving a detail.')
    if settings['memory_version']!=body.version:raise HTTPException(409,'Kit memory changed. Reload before saving.')
    consent=c.execute(coach.ADULT_OK,(uid,)).fetchone()
    if not consent or not consent['ai_ok']:raise HTTPException(403,'Review Kit permissions before saving a detail.')
    old=None
    if memory_id is not None:
        old=c.execute('SELECT * FROM kit_memories WHERE user_id=%s AND id=%s',(uid,memory_id)).fetchone()
        if not old:raise HTTPException(404,'Kit memory not found')
        if old['health_included'] and not coach.health_ok(c,uid):
            raise HTTPException(403,'Review Health data permissions before editing this detail; you can still forget it.')
    if c.execute('SELECT 1 FROM kit_memories WHERE user_id=%s AND text=%s AND (%s::bigint IS NULL OR id<>%s)',(uid,body.text,memory_id,memory_id)).fetchone():
        raise HTTPException(409,'Kit already remembers that detail.')
    if old:
        row=c.execute("""UPDATE kit_memories SET text=%s,kind=%s,source='edit',updated=now()
          WHERE user_id=%s AND id=%s RETURNING id""",(body.text,body.kind,uid,memory_id)).fetchone()
    else:
        if c.execute('SELECT count(*) AS n FROM kit_memories WHERE user_id=%s',(uid,)).fetchone()['n']>=LIMIT:
            raise HTTPException(409,'Forget a detail before adding another.')
        row=c.execute("""INSERT INTO kit_memories(user_id,text,kind,source) VALUES (%s,%s,%s,'user')
          RETURNING id""",(uid,body.text,body.kind)).fetchone()
    changed(c,uid)
    return {'ok':True,'id':row['id'],'version':body.version+1}
