"""Explicit food choices/destination edits and code-only conversational corrections."""
import datetime as dt
import json
import math
import re
from fastapi import HTTPException
from . import api_dishes, meal_chat, food_thread, food_thread_facts as facts, food_thread_log as engine


def current_entries(c,uid,mid):
    return c.execute('''SELECT e.* FROM food_entries e JOIN food_chat_entries l
                        ON l.entry_id=e.id AND l.user_id=e.user_id
                        WHERE e.user_id=%s AND l.message_id=%s ORDER BY e.id FOR UPDATE OF e''',(uid,mid)).fetchall()


def card_result(c,uid,message,rows=None):
    reply=engine.stored_reply(c,uid,message)
    if reply:return dict(reply['result'])
    rows=rows if rows is not None else current_entries(c,uid,message['id'])
    if rows and message.get('result',{}).get('kind')=='log':
        return {'kind':'log','entry_ids':[r['id'] for r in rows],'day':str(rows[0]['day']),'meal':rows[0]['meal'],'source':'your food log','text':'Foods from your log.'}
    return None


def attach(c,uid,message,response,ids):
    for mid in (message['id'],response['messages'][-1]['id']):
        for eid in ids:c.execute('INSERT INTO food_chat_entries VALUES (%s,%s,%s) ON CONFLICT (message_id,entry_id) DO NOTHING',(uid,mid,eid))
    response['messages']=food_thread.message_entries(c,uid,response['messages'])
    return response


def choose(c,uid,message,part,pick=None,portion=None,select=None,omit=None):
    reply=engine.stored_reply(c,uid,message)
    if reply and reply['result']['kind'] in ('log','edit'):return food_thread.answer_with(c,uid,message)
    if not reply or reply['result']['kind'] not in ('needs','preview'):
        raise HTTPException(409,'Choose from the message’s unresolved foods')
    old=reply['result']
    if old.get('correction'):
        choices=old.get('choices',[])
        if select is None or not 0<=select<len(choices):raise HTTPException(422,'Choose a food from this question')
        return try_correction(c,uid,message,old['correction'],forced=choices[select])
    if old.get('reference') and not pick:
        from . import food_thread_refs as refs
        return refs.choose(c,uid,message,old,portion,omit)
    parts=old.get('resolution',{}).get('parts',[])
    if old.get('reference') and pick:
        selected=next((e for e in meal_chat.catalog_for(c,uid) if e['kind']==pick.kind and e['id']==pick.id),None)
        if not selected:raise HTTPException(404,'That food is not in your foods')
        parts=[{'text':selected['name'],'pick':pick.model_dump(),'portion':None,'removed':False,'new':False}];part=0
    if not 0<=part<len(parts):raise HTTPException(422,'Choose a food in this message')
    parts=[dict(p) for p in parts]
    if pick:
        if not any(e['kind']==pick.kind and e['id']==pick.id for e in meal_chat.catalog_for(c,uid)):
            raise HTTPException(404,'That food is not in your foods')
        parts[part]['pick']=pick.model_dump();parts[part]['new']=False
    if portion:parts[part]['portion']=portion.clean()
    if not pick and not portion:raise HTTPException(422,'Choose a food or portion')
    resolution=meal_chat.resolve_data(c,uid,engine.ThreadResolveIn(parts=parts),anchor=message['local_day'])
    result=engine.make_result(c,uid,message,resolution)
    result.update({k:old[k] for k in ('day','meal')})
    if old.get('destination_override'):result['destination_override']=True
    if result['kind']=='preview' and food_thread.preferences(c,uid)['auto_log']:
        return engine.commit_log(c,uid,message,result)
    return food_thread.finish_reply(c,uid,message,result)


def destination(c,uid,message,day,meal):
    reply=engine.stored_reply(c,uid,message)
    old=card_result(c,uid,message)
    if not old or old['kind'] not in ('needs','preview','log'):
        raise HTTPException(409,'Choose a food card to move')
    result={**old,'day':day.isoformat(),'meal':meal,'destination_override':True,
            'as_of':dt.datetime.now(dt.timezone.utc).isoformat()}
    rows=current_entries(c,uid,message['id'])
    if rows:
        pos=c.execute('SELECT coalesce(max(position),0)+1 AS p FROM food_entries WHERE user_id=%s AND day=%s',(uid,day)).fetchone()['p']
        for i,row in enumerate(rows):
            c.execute('UPDATE food_entries SET day=%s,meal=%s,position=%s,updated=now() WHERE id=%s AND user_id=%s',(day,meal,pos+i,row['id'],uid))
        result['feedback']=facts.feedback(facts.snapshot(c,uid,day),seed=message['id'])
    response=food_thread.finish_reply(c,uid,message,result)
    return attach(c,uid,message,response,[r['id'] for r in rows])


def _destination_info(text,anchor):
    s=meal_chat.LEAD.sub('',meal_chat.norm(text).strip())
    rest,info=meal_chat.when(s,anchor)
    if not isinstance(info,dict):return None
    if re.match(r'^(?:it|that) was\b',s):
        meals=meal_chat.MEAL_WORD.findall(s)
        if len(set(meals))==1:info['meal']=meal_chat.MEAL_WORDS[meals[0]]
        rest=re.sub(r'^(?:it|that) was\s+','',rest or '')
        rest=meal_chat.MEAL_WORD.sub('',rest)
    words=[w for w in meal_chat.toks(rest or '') if w not in meal_chat.FILLER and w not in meal_chat.CORRECTION]
    return info if not words and (info.get('day') or info.get('meal')) else None


def _intent(text,anchor):
    s=meal_chat.LEAD.sub('',meal_chat.norm(text).strip())
    destination=_destination_info(text,anchor)
    if destination:return {'destination':True,'text':s}
    removal=meal_chat.REMOVE.match(s)
    if removal:return {'remove':True,'words':meal_chat.name_words(removal['what'])}
    if not re.search(r'^(?:make|change|set|halve|double|actually|only|it was|that was)\b',text.lower().strip()):
        return None
    # LEAD removes ‘actually’; amount handles numeric and spoken quantities.
    negative=bool(re.search(r'-\s*\d',re.sub(r'\b\d{4}-\d{2}-\d{2}\b','',s)))
    portion,rest=meal_chat.amount(meal_chat.raw(s))
    if re.search(r'\bdouble\b',s):portion={'share':2}
    if not portion:
        _,info=meal_chat.when(s,anchor)
        if isinstance(info,dict) and (info.get('meal') or info.get('day')):
            return {'destination':True,'text':s}
        return None
    words=[meal_chat.stem(t) for t in (rest or []) if t not in meal_chat.FILLER and t not in meal_chat.CORRECTION and t not in meal_chat.COUNTS and t not in ('halve','double')]
    return {'invalid':'Use a positive amount to change a portion.','words':words} if negative else {'portion':portion,'words':words}


def _cards(c,uid):
    return c.execute(f'''SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND kind='user'
                         AND result->>'kind'='log'
                         ORDER BY coalesce((result->>'touched_at')::timestamptz,created) DESC,id DESC LIMIT 50 FOR UPDATE''',(uid,)).fetchall()


def _ask(c,uid,message,text,choices=None,intent=None):
    if not choices and intent and not intent.get('invalid'):
        choices=[]
        for root in _cards(c,uid):
            for row in current_entries(c,uid,root['id']):
                choices.append({'message_id':root['id'],'entry_id':row['id'],'name':row['name'],'day':row['day'].isoformat(),'meal':row['meal']})
                if len(choices)>=100:break
            if len(choices)>=100:break
    return food_thread.finish_reply(c,uid,message,{'kind':'needs','text':text,'choices':choices or [],'correction':intent,'source':'your food log','as_of':dt.datetime.now(dt.timezone.utc).isoformat()})


def _scale(c,uid,row,portion):
    # Preserve an existing manual edit: arithmetic uses the logged row, not the
    # original recipe/database values. Recipe snapshots can carry a whole weight.
    row=dict(row);row['ref']=dict(row['ref'] or {})
    if row['source']=='dish' and row['unit']=='serving' and row['ref'].get('weight_g'):
        row['ref']['serving']={'g':row['ref']['weight_g']}
    settled,_=meal_chat.settle(c,uid,{'kind':'food','row':row},portion)
    values,why=meal_chat.compute(c,uid,'food',row,settled)
    if why or meal_chat.too_big(values or []):raise HTTPException(400,why or 'That portion is too large')
    value=values[0]
    if value['amount']<=0 or any(not math.isfinite(float(value[k])) for k in api_dishes.NUM if value[k] is not None):raise HTTPException(400,'Use a measurable positive portion')
    return value


def try_correction(c,uid,message,intent=None,forced=None):
    intent=intent or _intent(message['body'],message['local_day'])
    if intent is None:return None
    if intent.get('invalid'):return _ask(c,uid,message,intent['invalid'],intent=intent)
    found=None
    explicit=(message.get('result') or {}).get('context')
    previous=_context(c,uid,message) if explicit else None
    bare=not intent.get('words')
    if explicit and bare and not previous and not forced:return _ask(c,uid,message,'That food card is no longer available. Which logged food should change?',intent=intent)
    for root in _cards(c,uid):
        if explicit and bare and not forced and root['id']!=previous['id']:continue
        if forced and root['id']!=forced['message_id']:continue
        rows=current_entries(c,uid,root['id'])
        if not rows:continue
        reply=engine.stored_reply(c,uid,root);groups=(reply['result'] if reply else {}).get('groups',[])
        words=set(intent.get('words',[]));matched=[r for r in rows if words and words<=set(meal_chat.name_words(r['name']))]
        group=next((g for g in groups if words and words<=set(meal_chat.name_words(g['name']))),None)
        group_alias=bool(group and not matched)
        if group and not matched:matched=[r for r in rows if r['id'] in group['ids']]
        if forced:
            matched=[r for r in rows if r['id']==forced['entry_id']];group_alias=False;group=next((g for g in groups if g['ids']==[forced['entry_id']]),None)
        elif not words:
            previous=_context(c,uid,message)
            if previous and previous['result']['kind']=='undone':return _ask(c,uid,message,'Which food should change?',[{'message_id':root['id'],'entry_id':r['id'],'name':r['name']} for r in rows],intent)
            if len(rows)==1:matched=rows
            elif len(groups)==1:matched=rows;group=groups[0];group_alias=group['name'] not in [r['name'] for r in rows]
            elif intent.get('destination'):matched=rows
            else:return _ask(c,uid,message,'Which food should change?',[{'message_id':root['id'],'entry_id':r['id'],'name':r['name']} for r in rows],intent)
        if matched:found=(root,reply,rows,matched,group,group_alias);break
    if found is None:return _ask(c,uid,message,'Which logged food would you like to change?')
    root,reply,rows,matched,group,group_alias=found
    if intent.get('destination'):
        info=_destination_info(intent['text'],message['local_day'])
        if not isinstance(info,dict):return _ask(c,uid,message,'Which day or meal would you like?')
        prior=card_result(c,uid,root,rows)
        day=info.get('day') or dt.date.fromisoformat(prior['day']);meal=info.get('meal') or prior['meal']
        destination(c,uid,root,day,meal)
        action='Moved that food card.'
    elif intent.get('remove'):
        c.execute('DELETE FROM food_entries WHERE user_id=%s AND id=ANY(%s)',(uid,[r['id'] for r in matched]));action='Removed '+', '.join(r['name'] for r in matched[:3])+(' and more' if len(matched)>3 else '')+'.'
    else:
        try:
            portion=intent['portion']
            if len(matched)>1 or group_alias:
                if group and 'share' in portion:factor=portion['share']
                elif group and 'count' in portion and 'count' in group.get('portion',{}):factor=portion['count']/group['portion']['count']
                else:return _ask(c,uid,message,'Which food should change?',[{'message_id':root['id'],'entry_id':r['id'],'name':r['name']} for r in matched],intent)
                changed=[(r,_scale(c,uid,r,{'share':factor})) for r in matched]
                for g in groups:
                    if g is group:g['portion']={k:(v*factor if isinstance(v,(int,float)) else v) for k,v in g['portion'].items()}
            else:
                changed=[(matched[0],_scale(c,uid,matched[0],portion))]
                if group and len(group['ids'])==1 and group['name']==matched[0]['name']:
                    value=changed[0][1]
                    group['portion']={'grams':value['amount']} if value['unit']=='g' else {'share':value['amount']} if value['unit']=='dish' else {'count':value['amount'],'unit':value['unit']}
        except HTTPException as error:
            if error.status_code!=400:raise
            return _ask(c,uid,message,str(error.detail),intent={**intent,'invalid':str(error.detail)})
        for row,value in changed:
            c.execute('''UPDATE food_entries SET amount=%s,unit=%s,kcal=%s,protein_g=%s,carbs_g=%s,fat_g=%s,fiber_g=%s,ref=%s,updated=now()
                         WHERE id=%s AND user_id=%s''',(value['amount'],value['unit'],*(value[k] for k in api_dishes.NUM),json.dumps(value.get('ref')),row['id'],uid))
        action='Updated '+', '.join(r['name'] for r in matched[:3])+(' and more' if len(matched)>3 else '')+'.'
    remaining=current_entries(c,uid,root['id']);ids=[r['id'] for r in remaining]
    old_result=card_result(c,uid,root,remaining) or {'source':'your food log','day':str(rows[0]['day']),'meal':rows[0]['meal']}
    old_result.update({'kind':'log' if remaining else 'undone','entry_ids':ids,'updated':True,'as_of':dt.datetime.now(dt.timezone.utc).isoformat()})
    if not intent.get('destination'):old_result['groups']=groups
    for g in old_result.get('groups',[]):g['ids']=[eid for eid in g['ids'] if eid in ids]
    old_result['groups']=[g for g in old_result.get('groups',[]) if g['ids']]
    if not intent.get('destination'):
        old_result['text']='Updated foods · about '+str(facts.kcal(sum(r['kcal'] for r in remaining)))+' kcal.' if remaining else 'Those foods were removed from your log.'
        old_result.pop('feedback',None)
    root_response=food_thread.finish_reply(c,uid,root,old_result)
    attach(c,uid,root,root_response,ids)
    c.execute('UPDATE food_chat_messages SET result=result || %s::jsonb WHERE id=%s AND user_id=%s',(json.dumps({'touched_at':dt.datetime.now(dt.timezone.utc).isoformat()}),root['id'],uid))
    result={'kind':'edit','text':action,'target_message':root['id'],'source':'your food log','as_of':dt.datetime.now(dt.timezone.utc).isoformat()}
    response=food_thread.finish_reply(c,uid,message,result)
    response['updated_message']=food_thread.message_entries(c,uid,[engine.stored_reply(c,uid,root)])[0]
    return response


def _context(c,uid,message):
    explicit=(message.get('result') or {}).get('context')
    if explicit:
        return c.execute(f"SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND kind='user' AND client_id=%s AND id<>%s AND result->>'kind' IN ('needs','preview','log','edit','undone')",(uid,explicit,message['id'])).fetchone()
    return c.execute(f'''SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND kind='user'
                           AND id<%s AND result->>'kind' IN ('needs','preview','log','edit','undone')
                           ORDER BY id DESC LIMIT 1''',(uid,message['id'])).fetchone()


def handle_pending(c,uid,message):
    previous=_context(c,uid,message)
    if not previous or previous['result']['kind'] not in ('needs','preview'):return None
    reply=engine.stored_reply(c,uid,previous);old=reply['result'] if reply else {}
    if old.get('composed'):return None
    portion,rest=meal_chat.amount(meal_chat.raw(meal_chat.LEAD.sub('',meal_chat.norm(message['body']).strip())))
    pure=portion and rest is not None and all(t in meal_chat.FILLER or t in meal_chat.CORRECTION for t in rest)
    words=set(meal_chat.name_words(message['body']))
    if old.get('correction'):
        if old['correction'].get('invalid') and pure:
            intent={k:v for k,v in old['correction'].items() if k!='invalid'};intent['portion']=portion
            return try_correction(c,uid,message,intent)
        matches=[i for i,x in enumerate(old.get('choices',[])) if words and words<=set(meal_chat.name_words(x['name']))]
        if len(matches)==1:
            response=try_correction(c,uid,message,old['correction'],forced=old['choices'][matches[0]])
            return response
        return None
    if old.get('reference',{}).get('kind')=='copy' and words:
        choices=old.get('choices',[])
        selected=[x for x in choices if set(meal_chat.name_words(x['name'])) and set(meal_chat.name_words(x['name']))<=words]
        if not selected:
            partial=[x for x in choices if words<=set(meal_chat.name_words(x['name']))]
            if len(partial)==1:selected=partial
        covered=set().union(*(set(meal_chat.name_words(x['name'])) for x in selected)) if selected else set()
        if selected and (words<=covered):
            from . import food_thread_refs as refs
            response=refs.choose(c,uid,message,old,omit=[x['entry_id'] for x in selected])
            response['updated_message']=_supersede(c,uid,previous,message['id']);return response
        if old['reference'].get('requires_omissions') and not pure and not re.match(r'^(?:also|and|i (?:also )?(?:had|ate)|log|add)\b',message['body'].lower()):
            from . import food_thread_refs as refs
            response=refs._question(c,uid,message,'Choose the logged foods to leave out.',old['reference'],choices,dt.date.fromisoformat(old['day']),old['meal'])
            response['updated_message']=_supersede(c,uid,previous,message['id']);return response
    if old.get('reference') and pure:
        from . import food_thread_refs as refs
        response=refs.choose(c,uid,message,old,meal_chat.Portion(**portion))
        response['updated_message']=_supersede(c,uid,previous,message['id']);return response
    if not old.get('resolution',{}).get('parts'):return None
    unresolved=next((x for x in old['resolution'].get('items',[]) if x['status']!='ready'),None)
    matches=[x for x in (unresolved or {}).get('choices',[]) if words and words<=set(meal_chat.name_words(x['name']))]
    intent=_intent(message['body'],message['local_day'])
    if not (pure or intent or len(matches)==1):return None
    parts=[dict(p) for p in old['resolution']['parts']]
    dest=_destination_info(message['body'],message['local_day'])
    if dest:
        resolution=dict(old['resolution']);resolution['day']=dest['day'].isoformat() if dest.get('day') else old['day'];resolution['meal']=dest.get('meal') or old['meal']
        result=engine.make_result(c,uid,message,resolution)
        response=food_thread.finish_reply(c,uid,message,result)
        response['updated_message']=_supersede(c,uid,previous,message['id']);return response
    if len(matches)==1:
        parts[unresolved['index']]['pick']={k:matches[0][k] for k in ('kind','id')};say=None
    elif pure and 'share' in portion:
        live=[x for x in old['resolution'].get('items',[]) if x['status']=='ready']
        if len(live)==1:
            index=live[0]['index'];parts[index]['portion']={k:(v*portion['share'] if isinstance(v,(int,float)) else v) for k,v in live[0]['portion'].items()};say=None
        else:say=message['body']
    else:say=message['body']
    resolution=meal_chat.resolve_data(c,uid,engine.ThreadResolveIn(parts=parts,say=say),anchor=message['local_day'])
    result=engine.make_result(c,uid,message,resolution)
    result['day']=resolution.get('day') or old['day'];result['meal']=resolution.get('meal') or old['meal']
    if result['kind']=='preview' and food_thread.preferences(c,uid)['auto_log']:response=engine.commit_log(c,uid,message,result)
    else:response=food_thread.finish_reply(c,uid,message,result)
    response['updated_message']=_supersede(c,uid,previous,message['id']);return response


def _supersede(c,uid,previous,next_mid):
    old=engine.stored_reply(c,uid,previous)
    result={**old['result'],'kind':'continued','text':'Details continued in the next message.','target_message':next_mid}
    return food_thread.finish_reply(c,uid,previous,result)['messages'][-1]
