"""Bounded memory of the person's own words, never model-invented facts or measurements."""
import re
from . import coach

LIMIT = 12
# Keep preference/routine/goal statements automatically. Do not save every question,
# uncertain idea, quoted command or an assistant's interpretation as a personal fact.
STATEMENT = re.compile(r"^(?:I(?: am |[’']m | prefer | avoid | eat | follow | train | run | ride | walk | work | can(?:not|[’']t) | don[’']t | do not | have | want | need )|My (?:goal|aim|schedule|routine|diet|preference|available days)\b)", re.I)


def remember(c, uid, question, health_included=False):
    text = question.strip()
    if len(text) > 400 or '?' in text or not STATEMENT.search(text):
        return
    if re.search(r"\b(?:remember|forget|ignore|instruction|system|maybe|might|perhaps|not sure)\b", text, re.I):
        return
    c.execute("""INSERT INTO kit_memories(user_id,text,health_included) VALUES (%s,%s,%s)
      ON CONFLICT(user_id,text) DO UPDATE SET updated=now(),health_included=kit_memories.health_included OR excluded.health_included""", (uid,text,health_included))
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
