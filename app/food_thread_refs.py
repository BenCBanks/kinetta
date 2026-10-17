"""Own-log references with arithmetic; an unknown remainder asks for an amount."""
import datetime as dt
import hashlib
import json
import re
from fastapi import HTTPException
from . import nutrients as N
from . import api_dishes, meal_chat, food_thread, food_thread_log as engine, food_thread_facts as facts


def stamp(rows):
    return hashlib.sha256(json.dumps([[r['id'],r['updated'].astimezone(dt.timezone.utc).isoformat(),r['amount'],r['unit'],[r[k] for k in api_dishes.NUM]] for r in rows],default=str).encode()).hexdigest()


def insert(c,uid,message,rows,day,meal):
    pos=c.execute('SELECT coalesce(max(position),0)+1 AS p FROM food_entries WHERE user_id=%s AND day=%s',(uid,day)).fetchone()['p']
    ids=[]
    for i,row in enumerate(rows):
        # Legacy core zeros require unknown_nutrients; readers must honor coverage/N.known.
        row=N.storage(row)
        ids.append(c.execute('''INSERT INTO food_entries(user_id,day,meal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,source,ref,position,client_id)
                                 VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
                             (uid,day,meal,row['name'],row.get('brand'),row['amount'],row['unit'],*(row[k] for k in api_dishes.NUM),row['source'],json.dumps(row.get('ref')),pos+i,f"{message['client_id']}-{i:02d}")).fetchone()['id'])
    return ids


def save(c,uid,message,rows,day,meal):
    if not rows:raise HTTPException(400,'Choose at least one food to copy')
    if meal_chat.too_big(rows):raise HTTPException(400,'That amount is too large')
    result={'kind':'log','entry_ids':insert(c,uid,message,rows,day,meal),'day':str(day),'meal':meal,
            'text':f"{meal.capitalize()} · {', '.join(r['name'] for r in rows[:3])} · about {facts.kcal(sum(r['kcal'] for r in rows)):,} kcal from your log.",
            'source':'your food log','as_of':dt.datetime.now(dt.timezone.utc).isoformat()}
    saved=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=ANY(%s)',(uid,result['entry_ids'])).fetchall()
    result['entry_digests']={str(r['id']):engine.entry_digest(r) for r in saved}
    result['feedback']=facts.feedback(facts.snapshot(c,uid,day),{k:sum(r[k] or 0 for r in rows) for k in ('kcal','protein_g')},seed=message['id'])
    response=food_thread.finish_reply(c,uid,message,result)
    food_thread.link_entries(c,uid,[message,response['messages'][-1]],result['entry_ids'])
    response['messages']=food_thread.message_entries(c,uid,response['messages']);return response


def _question(c,uid,message,text,reference,choices,day=None,meal=None):
    return food_thread.finish_reply(c,uid,message,{'kind':'needs','text':text,'reference':reference,'choices':choices,
        'day':str(day or message['local_day']),'meal':meal or engine.expected_meal(c,uid,message['captured_at']),
        'source':'your food log','as_of':dt.datetime.now(dt.timezone.utc).isoformat()})


def handle(c,uid,message):
    text=meal_chat.norm(message['body']).strip()
    copying=re.match(r'^(?:for (?:breakfast|lunch|dinner|supper|snacks?)[, ]+)?(?:same as|copy)\s+(.+)',text)
    if copying:
        source_text=re.split(r'\bfor (?:breakfast|lunch|dinner|supper|snacks?)\b',copying[1],maxsplit=1)[0]
        if not re.search(r'\b(?:today|yesterday|'+ '|'.join(facts.WEEKDAYS) +r'|breakfast|lunch|dinner|supper|snacks?|\d{4}-\d{2}-\d{2})\b',source_text):return None
        _,info=meal_chat.when(source_text,message['local_day'])
        if not isinstance(info,dict):return _question(c,uid,message,'Which logged meal would you like to copy?',{'kind':'copy'},[])
        meals=meal_chat.MEAL_WORD.findall(source_text);source_meal=meal_chat.MEAL_WORDS[meals[0]] if meals else info.get('meal')
        source_day=info.get('day') or message['local_day']
        rows=c.execute('''SELECT * FROM food_entries WHERE user_id=%s AND day=%s AND (%s::text IS NULL OR meal=%s)
                          ORDER BY position,id FOR UPDATE''',(uid,source_day,source_meal,source_meal)).fetchall()
        if not rows:return _question(c,uid,message,'No foods were logged for that meal. Which food would you like to add?',{'kind':'copy'},[])
        dest=re.search(r'\bfor (breakfast|lunch|dinner|supper|snacks?)\b',text)
        meal=meal_chat.MEAL_WORDS[dest[1]] if dest else engine.expected_meal(c,uid,message['captured_at'])
        exclusion=re.search(r'\b(?:but no|but without|without|minus)\s+(.+)',text)
        omit=[];unknown=False
        if exclusion:
            words=re.sub(r'\s+for (?:breakfast|lunch|dinner|supper|snacks?).*','',exclusion[1])
            for word in re.split(r',|\band\b|\bplus\b',words):
                wanted=set(meal_chat.name_words(word));found=[r['id'] for r in rows if wanted==set(meal_chat.name_words(r['name']))]
                if found:omit+=found
                else:unknown=True
        if unknown:
            return _question(c,uid,message,'Which logged foods should I leave out?',{'kind':'copy','ids':[r['id'] for r in rows],'expected':stamp(rows),'omit':omit,'requires_omissions':True},
                             [{'entry_id':r['id'],'name':r['name']} for r in rows],meal=meal)
        chosen=[r for r in rows if r['id'] not in omit]
        if not chosen:return _question(c,uid,message,'That leaves no foods to copy. What would you like to add?',{'kind':'copy'},[])
        if not (food_thread.preferences(c,uid) or {}).get('auto_log',True):
            return preview(c,uid,message,chosen,{'kind':'copy','ids':[r['id'] for r in rows],'expected':stamp(rows),'omit':omit},message['local_day'],meal)
        return save(c,uid,message,chosen,message['local_day'],meal)
    rest=re.search(r'\b(?:the )?(?:rest|remainder) of (?:the |my )?(.+)',text)
    if rest:
        wanted=set(meal_chat.name_words(rest[1]))
        rows=c.execute('SELECT * FROM food_entries WHERE user_id=%s ORDER BY created DESC,id DESC LIMIT 300',(uid,)).fetchall()
        row=next((r for r in rows if wanted and wanted<=set(meal_chat.name_words(r['name']))),None)
        if not row:return _question(c,uid,message,'Which logged food was left?',{'kind':'remaining'},[])
        options=[{'name':f"Same amount as last time · {row['amount']:g} {row['unit']}",'portion':{'grams':row['amount']} if row['unit']=='g' else {'count':row['amount'],'unit':row['unit']}}]
        ref=row['ref'] or {};whole=(ref.get('serving') or {}).get('g') if row['source']!='dish' else None
        if row['unit']=='g' and whole and 0<row['amount']<whole:
            options.insert(0,{'name':f"{whole-row['amount']:g} g · if it is the same batch",'portion':{'grams':whole-row['amount']}})
        elif row['unit']=='serving' and 0<row['amount']<1:
            options.insert(0,{'name':f"{1-row['amount']:g} serving · rest of one serving",'portion':{'count':1-row['amount'],'unit':'serving'}})
        return _question(c,uid,message,'How much was left?',{'kind':'remaining','source_id':row['id'],'expected':stamp([row])},options)
    return None


def choose(c,uid,message,result,portion=None,omit=None):
    reference=result['reference'];kind=reference['kind']
    if kind=='copy':
        ids=reference.get('ids',[])
        rows=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=ANY(%s) ORDER BY id FOR UPDATE',(uid,ids)).fetchall()
        # Compare in the original order, which can differ from id after a move.
        by_id={r['id']:r for r in rows};ordered=[by_id[i] for i in ids if i in by_id]
        if len(ordered)!=len(ids) or stamp(ordered)!=reference.get('expected'):
            fresh={**reference,'ids':[r['id'] for r in ordered],'expected':stamp(ordered),'omit':[i for i in reference.get('omit',[]) if i in by_id]}
            response=_question(c,uid,message,'The meal changed. Which foods should I leave out?',fresh,[{'entry_id':r['id'],'name':r['name']} for r in ordered],dt.date.fromisoformat(result['day']),result['meal'])
            response['changed']=True;return response
        omissions=set(reference.get('omit',[]))|set(omit or [])
        if not omissions<=set(ids):raise HTTPException(422,'Choose foods from this meal')
        candidates=[r for r in ordered if r['id'] not in omissions]
        ref={**reference,'omit':list(omissions)}
        if portion:
            value=portion.clean()
            if 'share' in value:ref['scale']=ref.get('scale',1)*value['share']
            elif 'count' in value and not value.get('unit'):ref['scale']=value['count']
            else:raise HTTPException(400,'Use a fraction of the meal, or choose individual foods by weight')
        if ref.get('requires_omissions') and omit is None:
            return _question(c,uid,message,'Which logged foods should I leave out?',ref,[{'entry_id':r['id'],'name':r['name']} for r in ordered],dt.date.fromisoformat(result['day']),result['meal'])
        ref.pop('requires_omissions',None)
        if ref.get('scale',1)!=1:
            from . import food_thread_edit as edits
            candidates=[edits._scale(c,uid,row,{'share':ref['scale']}) for row in candidates]
        if not (food_thread.preferences(c,uid) or {}).get('auto_log',True):return preview(c,uid,message,candidates,ref,dt.date.fromisoformat(result['day']),result['meal'])
        return save(c,uid,message,candidates,dt.date.fromisoformat(result['day']),result['meal'])
    if kind=='remaining':
        if portion is None:raise HTTPException(422,'Choose the amount that was left')
        row=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=%s FOR UPDATE',(uid,reference.get('source_id'))).fetchone()
        if not row or stamp([row])!=reference.get('expected'):
            fresh={**reference,'expected':stamp([row]) if row else None}
            choices=[{'name':f"Same amount as last time · {row['amount']:g} {row['unit']}",'portion':{'grams':row['amount']} if row['unit']=='g' else {'count':row['amount'],'unit':row['unit']}}] if row else []
            response=_question(c,uid,message,'That food changed. How much was left?' if row else 'That food was removed. Which food would you like?',fresh,choices,dt.date.fromisoformat(result['day']),result['meal'])
            response['changed']=True;return response
        from . import food_thread_edit as edits
        value=edits._scale(c,uid,row,portion.clean())
        ref={**reference,'portion':portion.clean()}
        if not (food_thread.preferences(c,uid) or {}).get('auto_log',True):return preview(c,uid,message,[value],ref,dt.date.fromisoformat(result['day']),result['meal'])
        return save(c,uid,message,[value],dt.date.fromisoformat(result['day']),result['meal'])
    raise HTTPException(422,'Choose a reference from your food log')


def preview(c,uid,message,rows,reference,day,meal):
    if not rows:raise HTTPException(400,'Choose at least one food to copy')
    result={'kind':'preview','reference':reference,'day':str(day),'meal':meal,'source':'your food log',
            'preview_entries':[{k:r.get(k) for k in ('name','amount','unit',*N.ALL,'source')} for r in rows],
            'text':f"{meal.capitalize()} · about {facts.kcal(sum(r['kcal'] for r in rows)):,} kcal from your log. Tap Log to add it.",
            'as_of':dt.datetime.now(dt.timezone.utc).isoformat()}
    return food_thread.finish_reply(c,uid,message,result)


def confirm(c,uid,message,result):
    ref=dict(result['reference']);day=dt.date.fromisoformat(result['day']);meal=result['meal'];changed=False
    if ref['kind']=='copy':
        rows=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=ANY(%s) ORDER BY id FOR UPDATE',(uid,ref['ids'])).fetchall()
        by_id={r['id']:r for r in rows};ordered=[by_id[i] for i in ref['ids'] if i in by_id]
        changed=len(ordered)!=len(ref['ids']) or stamp(ordered)!=ref['expected']
        ref['ids']=[r['id'] for r in ordered];ref['expected']=stamp(ordered)
        candidates=[r for r in ordered if r['id'] not in ref.get('omit',[])]
        if ref.get('scale',1)!=1:
            from . import food_thread_edit as edits
            candidates=[edits._scale(c,uid,row,{'share':ref['scale']}) for row in candidates]
    else:
        row=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=%s FOR UPDATE',(uid,ref.get('source_id'))).fetchone()
        if not row:
            return _question(c,uid,message,'That logged food was removed. Which food would you like to add?',{'kind':'remaining'},[]),True
        changed=stamp([row])!=ref['expected'];ref['expected']=stamp([row])
        from . import food_thread_edit as edits
        candidates=[edits._scale(c,uid,row,ref['portion'])]
    if not candidates:return _question(c,uid,message,'Those foods are no longer available. Which food would you like to add?',{'kind':'copy'},[]),True
    if changed:
        response=preview(c,uid,message,candidates,ref,day,meal);response['changed']=True;return response,True
    return save(c,uid,message,candidates,day,meal),False
