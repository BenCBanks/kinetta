"""An opt-in code note, once per local day. History reads never invoke AI."""
import datetime as dt
import json
from uuid import uuid5,NAMESPACE_URL
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from . import db,food_thread,food_thread_facts as facts


def note(S):
    D=S['day'];entries=D['entries'];T=D['totals'];concern=facts.caution(S)
    if not entries:return 'No food is logged for this day yet. Start with a meal you ate, using your usuals or the composer.'
    protein_unknown=any(facts._missing(e,'protein_g') for e in entries)
    kcal_unknown=any(facts._missing(e,'kcal') for e in entries)
    calories='Calories are incomplete' if kcal_unknown else f"About {facts.kcal(T['kcal']):,} kcal logged"
    protein='protein is incomplete' if protein_unknown else f"{facts.num(T['protein_g'])} g protein"
    text=f'{calories}; {protein}.'
    resting=S['needs'].get('bmr')
    if not concern and resting and not kcal_unknown and T['kcal']<resting*.75:concern='The logged day looks low or incomplete. Check that meals are included and review whether your target fits.'
    if concern:return text+' '+concern
    if kcal_unknown or protein_unknown:idea='One idea: fill in missing nutrition from the label when you have it.'
    elif D['targets'].get('protein_target') and T['protein_g']<D['targets']['protein_target']:idea='One idea: include one of your usual protein foods with a meal tomorrow.'
    else:idea='One idea: save a meal you enjoyed to make the next log quicker.'
    if S['profile'].get('food_chat_tone')=='numbers':return text+' '+idea
    return 'You kept a record of what you ate. '+text+' '+idea


def create(uid,*,now=None):
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,))
        p=c.execute('SELECT tz,food_chat_daily_note FROM profile WHERE user_id=%s',(uid,)).fetchone()
        if not p or p['food_chat_daily_note']=='off':raise HTTPException(409,'Turn on the optional daily note in Food chat settings first')
        instant=now or dt.datetime.now(dt.timezone.utc);day=instant.astimezone(ZoneInfo(p['tz'] or db.DEFAULT_TZ)).date()
        key=uuid5(NAMESPACE_URL,f'kinetta:food-daily-note:{uid}:{day.isoformat()}')
        if c.execute('SELECT 1 FROM food_chat_cancellations WHERE user_id=%s AND client_id=%s',(uid,key)).fetchone():return {'messages':[],'deleted':True}
        old=c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND client_id=%s',(uid,key)).fetchone()
        if old:return food_thread.answer_with(c,uid,old)
        S=facts.snapshot(c,uid,day);as_of=instant.isoformat()
        result={'kind':'answer','intent':'review','daily_note':True,'text':note(S),'as_of':as_of}
        root=c.execute(f'''INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state,result)
                          VALUES (%s,%s,'user',%s,%s,%s,'pending',%s) RETURNING {food_thread.COLUMNS}''',
                       (uid,key,f'Review my food for {day.isoformat()}.',instant,day,json.dumps({'daily_note':True}))).fetchone()
        return food_thread.finish_reply(c,uid,root,result)
