"""Resolve only a thread message's unknown foods. No network calls under DB locks."""
import copy
import base64
import datetime as dt
import hashlib
import json
import re
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4
from fastapi import HTTPException
from . import db,meal_chat,food_photo,api_food,coach,ai_budget,food_thread
from .food_thread_models import ResolveIn
from . import food_thread_log as engine,food_thread_compose as C,food_thread_sources as S




def _unknown(result):
    return [p for p in result['parts'] if not p.get('logged') and p['status']=='unknown']


def _alias(c,uid,parts):
    phrase='\n'.join(p['text'] for p in parts)
    row=c.execute('SELECT templates FROM food_chat_aliases WHERE user_id=%s AND key=%s',(uid,C.alias_key(phrase))).fetchone()
    if not row or not isinstance(row['templates'],list) or not 1<=len(row['templates'])<=100:return None
    entries=[]
    try:
        for template in row['templates']:
            meal_chat.Pick.model_validate({k:template[k] for k in ('kind','id')})
            meal_chat.Portion.model_validate(template['portion']).clean()
            source=meal_chat.source_row(c,uid,template['kind'],template['id'])
            found,why=meal_chat.compute(c,uid,template['kind'],source,template['portion'])
            if why:return None
            entries+=found
    except (HTTPException,ValueError,KeyError,TypeError):return None
    return {'index':min(p['index'] for p in parts),'text':phrase,'status':'ready','templates':row['templates'],
            'entries':entries,'logged':False,'looked_up':True,'source':'your saved foods'}


def _replace_group(result,indices,new):
    result['parts']=[p for p in result['parts'] if p['index'] not in indices]+[new]
    result['parts'].sort(key=lambda p:p['index'])


def _stored(c,uid,message):
    result=C.card(c,uid,message)
    if not result:raise HTTPException(409,'This message has no unresolved food card')
    C.check_live(message,result)
    return result


def claim(uid,mid,body):
    with db.connect() as c:
        message=engine.locked_message(c,uid,mid)
        if message['state']=='pending':engine.process(c,uid,message)
        message=engine.locked_message(c,uid,mid);result=_stored(c,uid,message)
        unknown=_unknown(result)
        if not unknown:return {'done':C.write(c,uid,message,result)}
        media=(message.get('result') or {}).get('input') or {'kind':'text'}
        if (body.image or body.images) and media['kind']!='photo':
            raise HTTPException(409,'Use a new photo message for these images; this card keeps the foods already logged')
        if media['kind']=='text' and not any(p.get('skip_alias') for p in unknown):
            alias=_alias(c,uid,unknown)
            if alias:
                _replace_group(result,{p['index'] for p in unknown},alias)
                return {'done':C.write(c,uid,message,result)}
        raw_images=body.images or ([body.image] if body.image else [])
        if media['kind']=='photo' and not raw_images:
            for p in unknown:p.update({'looked_up':True,'question':'Add the photo again, or describe the food.','needs_photo':True})
            return {'done':C.write(c,uid,message,result)}
        digest=hashlib.sha256(json.dumps([[(p['index'],p['text'],p.get('lookup_revision')) for p in unknown],raw_images,body.allow_brand_estimate,body.part],sort_keys=True).encode()).hexdigest()
        old=c.execute('SELECT * FROM food_chat_jobs WHERE user_id=%s AND message_id=%s FOR UPDATE',(uid,mid)).fetchone()
        now=dt.datetime.now(dt.timezone.utc)
        if old and old['state']=='running' and old['expires']>now:
            return {'done':{**food_thread.answer_with(c,uid,message),'processing':True}}
        if old and old['input_hash']==digest and old['state'] in ('done','failed') and not body.retry:
            return {'done':C.write(c,uid,message,result)}
        if old and old['state']=='cancelled':raise HTTPException(409,'This message was cancelled')
        lease=uuid4()
        c.execute('''INSERT INTO food_chat_jobs(user_id,message_id,lease,expires,state,input_hash)
                     VALUES (%s,%s,%s,now()+interval '180 seconds','running',%s)
                     ON CONFLICT(user_id,message_id) DO UPDATE SET lease=excluded.lease,expires=excluded.expires,
                     state='running',input_hash=excluded.input_hash''',(uid,mid,lease,digest))
        result.pop('error',None);result['processing']=True
        food_thread.finish_reply(c,uid,message,result)
        return {'message':message,'result':copy.deepcopy(result),'media':media,'lease':lease}


def _catalog(food,part):
    parsed=meal_chat.read_part(part['text'],[])
    portion=part.get('portion_override') or parsed.get('portion')
    try:draft=S.catalog_draft(food,portion)
    except HTTPException:draft=None
    if draft:return {**part,'status':'ready','drafts':[draft],'entries':S.draft_entries([draft]),'looked_up':True}
    return {**part,'status':'quantity','catalog':part.get('catalog') or [food],'catalog_selected':part.get('catalog_selected',0),'looked_up':True,
            'question':'Which food and portion should I use?','source':food.get('source')}


def resolve_outside(uid,work,body):
    message,result=work['message'],work['result'];unknown=_unknown(result);media=work['media']
    updates=[];estimate=[]
    # Parsing normalizes punctuation, so also inspect the original untouched input.
    has_link=bool(re.search(r'https?://|www\.',message['body'],re.I))
    if media['kind']=='barcode':
        food=api_food.barcode(media['barcode'],user={'id':uid})
        if food.get('source')=='custom':
            return [{'indices':[p['index'] for p in unknown],'part':{**unknown[0],'status':'ready','looked_up':True,
                     'templates':[{'kind':'custom','id':food['id'],'portion':{'count':1}}]}}],None
        return [{'indices':[p['index'] for p in unknown],'part':_catalog(food,unknown[0])}],None
    if media['kind']=='photo':estimate=unknown
    else:
        # Long loose paragraphs stay intact for the estimator; public catalog
        # queries are short food words, never a truncated private conversation.
        # Classify links before *any* public database lookup, including tokenized URLs.
        short=[p for p in unknown if not has_link and 2<=len(p['text'])<=200 and not re.search(r'https?://|www\.',p['text'],re.I)]
        def lookup_part(part):
            try:return meal_chat.lookup(part['text'])
            except Exception:return {'kind':'none','foods':[]}
        with ThreadPoolExecutor(max_workers=4) as pool:
            lookups=dict(zip((p['index'] for p in short),pool.map(lookup_part,short)))
        for part in unknown:
            if has_link or re.search(r'https?://|www\.',part['text'],re.I):
                updates.append({'indices':[part['index']],'part':{**part,'looked_up':True,'recipe_url':True,
                                'question':'Import this recipe or add its nutrition.'}});continue
            lookup=lookups.get(part['index']) or {'kind':'none','foods':[]}
            if lookup['kind']=='brand' and not (body.allow_brand_estimate and (body.part is None or body.part==part['index'])):
                updates.append({'indices':[part['index']],'part':{**part,'status':'choose','looked_up':True,
                                'catalog':lookup['foods'],'question':'Which food and portion should I use?'}})
            elif lookup['kind']=='plain' and lookup['foods']:
                updates.append({'indices':[part['index']],'part':_catalog(lookup['foods'][0],part)})
            else:estimate.append(part)
    if estimate:
        text='\n'.join(p['text'] for p in estimate)
        if media['kind']=='photo':text=message['body'] if not message['body'].startswith('Photo of food') else ''
        if body.note:text=(text+'\n'+body.note).strip()
        if len(text)>4000:return updates,HTTPException(422,'That food note is too long; your original message is kept')
        # PhotoIn's public legacy note limit remains 2000. The permanent thread
        # already accepted 4000 characters; no one has to rewrite a saved message.
        estimate_body=ResolveIn(image=body.image,images=body.images,note=text or None)
        try:
            with ai_budget.scope(uid,message['client_id']):
                found=food_photo.estimate(estimate_body,user={'id':uid},strict=True)
            drafts=S.model_drafts(found)
        except Exception as error:return updates,error
        uncertain=bool(re.search(r"unclear|cannot tell|can't tell|portion (?:is )?(?:unknown|uncertain)|not visible",found.get('notes',''),re.I))
        merged={'index':min(p['index'] for p in estimate),'text':'\n'.join(p['text'] for p in estimate),
                'status':'quantity' if uncertain else 'ready','drafts':drafts,'entries':S.draft_entries(drafts),
                'logged':False,'looked_up':True,'source':'ai','learn_phrase':'\n'.join(p['text'] for p in estimate) if media['kind']=='text' else None,
                'estimated':True,'question':'Which food and portion should I use?' if uncertain else None,
                'scale_options':[{'label':'Smaller','factor':.5},{'label':'As estimated','factor':1},{'label':'Larger','factor':1.5}] if uncertain else []}
        updates.append({'indices':[p['index'] for p in estimate],'part':merged,'model':True})
    return updates,None


def complete(uid,mid,work,updates,error=None):
    with db.connect() as c:
        try:message=engine.locked_message(c,uid,mid)
        except HTTPException as e:
            if e.status_code==404:return {'handled':True,'cancelled':True,'messages':[]}
            raise
        job=c.execute('SELECT * FROM food_chat_jobs WHERE user_id=%s AND message_id=%s FOR UPDATE',(uid,mid)).fetchone()
        if not job or job['lease']!=work['lease'] or job['state']!='running' or message['state']=='cancelled':
            return {'handled':True,'cancelled':True,'messages':[]}
        result=_stored(c,uid,message);result['processing']=False
        original={p['index']:p for p in work['result']['parts']}
        for update in updates:
            current={p['index']:p for p in result['parts']}
            eligible=all(i in current and current[i]['status']=='unknown' and not current[i].get('logged') and
                         current[i]['text']==original[i]['text'] for i in update['indices'])
            if not eligible:continue
            if update.get('model') and not coach.allowed(uid,'food',connection=c):
                error=HTTPException(403,'AI access or consent changed. Search, scan or enter nutrition instead.');continue
            replacement=update['part']
            pending_portions=[current[i].get('pending_portion') for i in update['indices'] if current[i].get('pending_portion')]
            if len(update['indices'])==1 and pending_portions:
                try:
                    if replacement.get('drafts'):
                        S.apply_portion(replacement['drafts'],pending_portions[0],current[update['indices'][0]]['text'])
                        replacement.update({'status':'ready','entries':S.draft_entries(replacement['drafts'])})
                    elif replacement.get('catalog'):
                        draft=S.catalog_draft(replacement['catalog'][0],pending_portions[0])
                        if draft:replacement.update({'status':'ready','drafts':[draft],'entries':S.draft_entries([draft])})
                except HTTPException:
                    replacement['status']='quantity';replacement['question']='Which food and portion should I use?'
            if update.get('model'):
                original_estimate=copy.deepcopy(replacement)
                try:
                    with c.transaction(): C.ground_estimates(c,uid,replacement)
                except (HTTPException,ValueError,KeyError):
                    replacement=original_estimate
                    replacement.update({'status':'quantity','question':'Your saved food changed. Check this estimate and choose its portion.'})
            _replace_group(result,set(update['indices']),replacement)
        if error:
            detail=error.detail if isinstance(error,HTTPException) else 'The food could not be checked. Your text is kept; search or enter nutrition instead.'
            result['error']={'message':str(detail)[:500],'retryable':True}
            for part in _unknown(result):part.update({'looked_up':True,'question':'Which food and portion should I use?'})
        # Persist the successful source result before the separate atomic food
        # transaction. A failed food save can retry this stored result at no AI cost.
        c.execute('UPDATE food_chat_jobs SET state=%s WHERE user_id=%s AND message_id=%s',('failed' if error else 'done',uid,mid))
        food_thread.finish_reply(c,uid,message,result)
    with db.connect() as c:
        try:message=engine.locked_message(c,uid,mid);result=_stored(c,uid,message)
        except HTTPException as e:
            if e.status_code in (404,409):return {'handled':True,'cancelled':True,'messages':[]}
            raise
        return C.write(c,uid,message,result)


def resolve(uid,mid,body):
    if body.image or body.images:
        # Decode/limit/deduplicate before taking the account lock, not while
        # hashing arbitrary uploads inside a food transaction. No pixels persist.
        images=food_photo.image_batch(body.image,body.images)
        body=body.model_copy(update={'image':None,'images':[base64.b64encode(value).decode() for value in images]})
    work=claim(uid,mid,body)
    if 'done' in work:return work['done']
    updates=[];error=None
    try:updates,error=resolve_outside(uid,work,body)
    except Exception as exc:
        error=exc
        if not isinstance(exc,HTTPException):print('food thread resolution failed:',type(exc).__name__,flush=True)
    return complete(uid,mid,work,updates,error)
