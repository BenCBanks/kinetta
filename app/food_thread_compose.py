"""Atomic partial-ready thread food cards; unresolved parts never become zero food.

Only authenticated callers supply uid. Network resolution happens elsewhere. Ready
parts use stable per-part identities; later choices cannot recreate earlier food.
"""
import copy
import datetime as dt
import hashlib
import json
import re
import time
from uuid import UUID,uuid5
from fastapi import HTTPException
from pydantic import ValidationError
from . import meal_chat,food_thread,food_thread_log as engine,food_thread_facts as facts


def alias_key(text):
    return hashlib.sha256('\n'.join(' '.join(line.casefold().split()) for line in text.splitlines()).encode()).hexdigest()


def own_part(c,uid,item,issued):
    part={'index':item['index'],'text':item['text'],'status':item['status'],'item':dict(item),'issued':issued,'logged':False}
    if item['status']=='ready':
        source=meal_chat.source_row(c,uid,item['kind'],item['id'])
        entries,why=meal_chat.compute(c,uid,item['kind'],source,item['portion'])
        if why:raise HTTPException(409,why)
        part['entries']=entries
    return part


def begin(c,uid,message,resolution,*,aliases=True):
    result=engine.make_result(c,uid,message,resolution)
    result['composed']=True
    result['parts']=[own_part(c,uid,item,resolution['issued']) for item in resolution.get('items',[])]
    if not result['parts']:
        # Keep unparsed paragraphs for the consent-gated estimator, not a request
        # for the person to rewrite them. The complete text remains in storage.
        result['parts']=[{'index':0,'text':message['body'],'status':'unknown','item':{},'logged':False}]
    from . import food_thread_resolve as resolver
    unresolved=[p for p in result['parts'] if p['status'] in ('unknown','choose')]
    if aliases and unresolved and (message.get('result') or {}).get('input',{}).get('kind','text')=='text':
        alias=resolver._alias(c,uid,unresolved)
        if alias:resolver._replace_group(result,{p['index'] for p in unresolved},alias)
    return write(c,uid,message,result)


def card(c,uid,message):
    reply=engine.stored_reply(c,uid,message)
    result=(reply or {}).get('result') or {}
    if not result.get('composed'):return None
    return dict(result)


def check_live(message,result):
    if message['state']=='cancelled' or result.get('kind') in ('undone','continued','cancelled'):
        raise HTTPException(409,'This food message is no longer waiting to log')


def fresh_own(c,uid,part):
    item=part['item'];row=meal_chat.source_row(c,uid,item['kind'],item['id'])
    snap=meal_chat.snapshot({'kind':item['kind'],'row':row})
    expected=meal_chat.fingerprint(uid,item['kind'],item['id'],item['portion'],snap,part['issued'])
    if expected!=item['expected'] or time.time()-part['issued']>900:
        issued=int(time.time());item['expected']=meal_chat.fingerprint(uid,item['kind'],item['id'],item['portion'],snap,issued)
        part['issued']=issued
        part['entries'],why=meal_chat.compute(c,uid,item['kind'],row,item['portion'])
        if why:raise HTTPException(409,why)
        return False
    return True


def fresh_templates(c,uid,part):
    entries=[];fresh=True;issued=int(time.time())
    for template in part['templates']:
        row=meal_chat.source_row(c,uid,template['kind'],template['id'])
        old_issued=template.get('issued',issued)
        snap=meal_chat.snapshot({'kind':template['kind'],'row':row})
        current=meal_chat.fingerprint(uid,template['kind'],template['id'],template['portion'],snap,old_issued)
        if template.get('expected') and (template['expected']!=current or issued-old_issued>900):fresh=False
        template['issued']=issued
        template['expected']=meal_chat.fingerprint(uid,template['kind'],template['id'],template['portion'],snap,issued)
        pieces,why=meal_chat.compute(c,uid,template['kind'],row,template['portion'])
        if why:raise HTTPException(409,why)
        entries+=pieces
    part['entries']=entries
    return fresh


def ground_estimates(c,uid,part):
    """Vision/text can identify a food/portion; stored nutrition wins on a clear match."""
    catalog=meal_chat.catalog_for(c,uid);issued=int(time.time())
    for draft in part.get('drafts',[]):
        f=draft['food'];p=draft['portion']
        grams=p.get('grams') or (f.get('serving_g') or 0)*p.get('count',1)
        portion={'grams':grams} if grams else p
        item=meal_chat.item_for(c,uid,{'text':f['name'],'pick':None,'portion':portion,'new':True,'saved_day':None},catalog,issued)
        if item['status']!='ready':continue
        draft['own']={k:item[k] for k in ('kind','id','portion','expected')}
        draft['own']['issued']=issued
        original=draft.get('learn_portion') or p
        original_size=original.get('grams') or (f.get('serving_g') or 0)*original.get('count',1)
        ratio=original_size/grams if grams and original_size else original.get('count',1)/p.get('count',1)
        draft['learn_own_portion']={k:(v*ratio if k in ('grams','count','share') else v) for k,v in item['portion'].items()}
    fresh_drafts(c,uid,part)
    return part


def fresh_drafts(c,uid,part):
    fresh=True
    for draft in part.get('drafts',[]):
        if not draft.get('own'):continue
        wrapper={'templates':[draft['own']]}
        if not fresh_templates(c,uid,wrapper):fresh=False
        draft['own']=wrapper['templates'][0]
        draft['own_entries']=wrapper['entries']
        for entry in draft['own_entries']:
            entry['ref']={**(entry.get('ref') or {}),'estimated_portion':True}
    from . import food_thread_sources as sources
    part['entries']=sources.draft_entries(part.get('drafts',[]))
    return fresh


def _custom(c,uid,draft):
    values=draft['food']
    cols=('name','brand','serving_label','serving_g','kcal','protein_g','carbs_g','fat_g','fiber_g')
    origin=draft.get('origin_ref') or {}
    barcode=str(origin.get('id') or '') if origin.get('source')=='off' else ''
    barcode=barcode if re.fullmatch(r'\d{6,14}',barcode) else None
    fid=c.execute('''INSERT INTO custom_foods(user_id,name,brand,serving_label,serving_g,kcal,protein_g,carbs_g,fat_g,fiber_g,
                      origin,origin_notes,origin_model,origin_ref,barcode)
                      VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
                      (uid,*(values.get(k) for k in cols),draft['origin'],draft.get('notes'),draft.get('model'),json.dumps(draft.get('origin_ref')),barcode)).fetchone()['id']
    row=meal_chat.source_row(c,uid,'custom',fid)
    entries,why=meal_chat.compute(c,uid,'custom',row,draft['portion'])
    if why or meal_chat.too_big(entries):raise HTTPException(422,why or 'Check the portion amount')
    for entry in entries:
        entry['source']='ai' if draft['origin']=='ai' else (draft.get('origin_ref') or {}).get('source','custom')
        entry['ref']={**(entry['ref'] or {}),'custom_food_id':fid,'origin':draft['origin'],
                      'origin_notes':draft.get('notes'),'origin_model':draft.get('model'),'origin_ref':draft.get('origin_ref')}
    return fid,entries


def _insert(c,uid,message,result,part,entries):
    prefix=str(uuid5(UUID(str(message['client_id'])),f"thread-part-{part['index']}"))
    ids=[]
    for i,e in enumerate(entries):
        pos=c.execute('SELECT coalesce(max(position),0)+1 AS p FROM food_entries WHERE user_id=%s AND day=%s',(uid,result['day'])).fetchone()['p']
        row=c.execute('''INSERT INTO food_entries(user_id,day,meal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,source,ref,position,client_id)
                          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                          ON CONFLICT (user_id,client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING id''',
                          (uid,result['day'],result['meal'],e['name'],e.get('brand'),e['amount'],e['unit'],*(e.get(k) for k in meal_chat.NUM),
                           e.get('source','quick'),json.dumps(e.get('ref'),default=str),pos,f'{prefix}-{i:02d}')).fetchone()
        if not row:raise HTTPException(409,'That food part was already saved; refresh its card')
        ids.append(row['id'])
    return ids


def log_part(c,uid,message,result,part):
    groups=[];templates=[];alias_templates=[]
    if part.get('manual'):
        entries=part['entries']
        groups=[{'name':e['name'],'offset':i,'count':1,'portion':{'count':e['amount']}} for i,e in enumerate(entries)]
    elif part.get('drafts'):
        entries=[]
        for draft in part['drafts']:
            start=len(entries)
            if draft.get('own'):
                template={k:draft['own'][k] for k in ('kind','id','portion')}
                row=meal_chat.source_row(c,uid,template['kind'],template['id'])
                pieces,why=meal_chat.compute(c,uid,template['kind'],row,template['portion'])
                if why:raise HTTPException(409,why)
                for entry in pieces:entry['ref']={**(entry.get('ref') or {}),'estimated_portion':True}
                templates.append(template)
                alias_templates.append({**template,'portion':draft.get('learn_own_portion') or template['portion']})
            else:
                fid,pieces=_custom(c,uid,draft)
                templates.append({'kind':'custom','id':fid,'portion':draft['portion']})
                alias_templates.append({'kind':'custom','id':fid,'portion':draft.get('learn_portion') or draft['portion']})
            entries+=pieces
            groups.append({'name':draft['food']['name'],'offset':start,'count':len(pieces),'portion':draft['portion']})
    elif part.get('templates'):
        entries=[]
        for template in part['templates']:
            row=meal_chat.source_row(c,uid,template['kind'],template['id'])
            pieces,why=meal_chat.compute(c,uid,template['kind'],row,template['portion'])
            if why:raise HTTPException(409,why)
            start=len(entries);entries+=pieces
            groups.append({'name':row['name'],'offset':start,'count':len(pieces),'portion':template['portion']})
        templates=part['templates']
    else:
        item=part['item'];row=meal_chat.source_row(c,uid,item['kind'],item['id'])
        entries,why=meal_chat.compute(c,uid,item['kind'],row,item['portion'])
        if why:raise HTTPException(409,why)
        templates=[{k:item[k] for k in ('kind','id','portion')}]
        groups=[{'name':item['name'],'offset':0,'count':len(entries),'portion':item['portion']}]
    if not entries or any(not isinstance(e.get('amount'),(int,float)) or e['amount']<=0 for e in entries) or meal_chat.too_big(entries):raise HTTPException(422,'Check the food amount')
    ids=_insert(c,uid,message,result,part,entries)
    for group in groups:
        result.setdefault('groups',[]).append({'name':group['name'],'ids':ids[group['offset']:group['offset']+group['count']],'portion':group['portion']})
    if part.get('drafts') and part.get('learn_phrase'):
        phrase=part['learn_phrase']
        c.execute('''INSERT INTO food_chat_aliases(user_id,key,templates) VALUES (%s,%s,%s)
                     ON CONFLICT(user_id,key) DO UPDATE SET templates=excluded.templates''',
                     (uid,alias_key(phrase),json.dumps(alias_templates)))
    part['logged']=True;part['entry_ids']=ids;part['templates']=templates
    part.pop('drafts',None)
    return ids


def write(c,uid,message,result,*,force=False,only=None):
    check_live(message,result)
    saved=copy.deepcopy(result)
    try:
        with c.transaction():return _write(c,uid,message,result,force=force,only=only)
    except (HTTPException,ValidationError) as error:
        if isinstance(error,HTTPException) and error.status_code not in (400,404,409,422):raise
        saved.update({'processing':False,'error':{'message':'The food details changed. Check this card or enter its nutrition.','retryable':True}})
        return food_thread.finish_reply(c,uid,message,saved)


def _write(c,uid,message,result,*,force=False,only=None):
    check_live(message,result)
    auto=food_thread.preferences(c,uid)['auto_log']
    added=[];changed=False
    for part in result['parts']:
        if only is not None and part['index'] not in only:continue
        if part['status']!='ready' or part.get('logged'):continue
        if part.get('drafts'):
            if not fresh_drafts(c,uid,part):changed=True
        elif part.get('templates'):
            if not fresh_templates(c,uid,part):changed=True
        elif (auto or force) and not part.get('drafts') and not part.get('manual') and not fresh_own(c,uid,part):
            changed=True
    # Explicit review never saves newly changed numbers in the same tap.
    if changed and force:
        result['text']='The food details changed. Check the amounts, then tap Log again.'
        response=food_thread.finish_reply(c,uid,message,result);response['changed']=True;return response
    if auto or force:
        for part in result['parts']:
            if (only is None or part['index'] in only) and part['status']=='ready' and not part.get('logged'):added+=log_part(c,uid,message,result,part)
    linked=[r['entry_id'] for r in c.execute('SELECT entry_id FROM food_chat_entries WHERE user_id=%s AND message_id=%s',(uid,message['id']))]
    ids=list(dict.fromkeys(linked+added));pending=[p for p in result['parts'] if p['status']!='ready']
    ready=[p for p in result['parts'] if p['status']=='ready' and not p.get('logged')]
    result['kind']='log' if ids else 'preview' if ready and not pending else 'needs'
    result['source']='your food log' if ids else 'food sources'
    result['entry_ids']=ids;result['pending_count']=len(pending)
    result['can_resolve']=any(p['status']=='unknown' and not p.get('looked_up') for p in pending)
    first=pending[0] if pending else None
    question=(first or {}).get('question') or (first or {}).get('item',{}).get('message')
    if pending and not (first or {}).get('needs_photo') and any(p.get('looked_up') or p['status'] in ('choose','quantity') for p in pending):
        question=result.setdefault('question','Which food and portion should I use for the remaining items?')
    if first and (not question or len(question)>1000):question='Checking the remaining food. You can also search or enter its nutrition.'
    if ids:
        rows=c.execute('SELECT name,kcal FROM food_entries WHERE user_id=%s AND id=ANY(%s) ORDER BY id',(uid,ids)).fetchall()
        names=', '.join(r['name'] for r in rows[:3])+(' and more' if len(rows)>3 else '')
        result['text']=f"Added {names} · about {facts.kcal(sum(r['kcal'] for r in rows)):,} kcal."
        if question:result['text']+=' '+question
    elif ready and not pending:result['text']='Ready to log. Check the portions, then tap Log.'
    else:result['text']=question or 'Choose a food or enter its nutrition.'
    if added:
        rows=c.execute('SELECT * FROM food_entries WHERE user_id=%s AND id=ANY(%s)',(uid,added)).fetchall()
        result['entry_digests']={**result.get('entry_digests',{}),**{str(r['id']):engine.entry_digest(r) for r in rows}}
        totals=c.execute('SELECT sum(kcal) AS kcal,sum(protein_g) AS protein_g FROM food_entries WHERE user_id=%s AND id=ANY(%s)',(uid,added)).fetchone()
        result['feedback']=facts.feedback(facts.snapshot(c,uid,dt.date.fromisoformat(str(result['day']))),dict(totals),seed=message['id'])
    response=food_thread.finish_reply(c,uid,message,result)
    for mid in (message['id'],response['messages'][-1]['id']):
        for eid in added:c.execute('INSERT INTO food_chat_entries VALUES (%s,%s,%s) ON CONFLICT(message_id,entry_id) DO NOTHING',(uid,mid,eid))
    response['messages']=food_thread.message_entries(c,uid,response['messages'])
    return response
