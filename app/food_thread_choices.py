"""Server-validated source/portion/manual choices for a composed food card."""
import copy
import datetime as dt
import re
import time
from fastapi import HTTPException
from . import nutrients as N
from . import meal_chat,food_thread,food_thread_log as engine
from . import food_thread_compose as C,food_thread_sources as S,food_thread_resolve as resolver


def choose(c,uid,message,index,pick=None,portion=None,catalog=None,factor=None,new=False):
    result=C.card(c,uid,message)
    if not result:return None
    C.check_live(message,result)
    part=next((p for p in result['parts'] if p['index']==index),None)
    if not part:raise HTTPException(422,'Choose a food in this card')
    if part.get('logged'):return food_thread.answer_with(c,uid,message)
    if part.get('entered_numbers'):raise HTTPException(409,'Use Review numbers on this card; nutrition numbers are not catalog foods')
    part=copy.deepcopy(part)
    if new:
        if part.get('drafts'):raise HTTPException(409,'Edit this estimate or Undo it before trying a different food')
        part={k:part[k] for k in ('index','text','logged') if k in part}
        part.update({'status':'unknown','looked_up':False,'item':{},'question':None,'skip_alias':True,'lookup_revision':time.time()})
    elif pick:
        meal_chat.source_row(c,uid,pick.kind,pick.id)  # reject foreign/deleted picks before resolution fallback
        resolved=meal_chat.resolve_data(c,uid,engine.ThreadResolveIn(parts=[engine.ThreadPartIn(text=part['text'],pick=pick,portion=portion)]),anchor=message['local_day'])
        item=resolved['items'][0];item['index']=index
        part=C.own_part(c,uid,item,resolved['issued'])
    elif catalog is not None and part.get('catalog'):
        if not 0<=catalog<len(part['catalog']):raise HTTPException(422,'Choose the product you meant')
        if portion:part['portion_override']=portion.clean()
        part=resolver._catalog(part['catalog'][catalog],part)
        part['catalog_selected']=catalog
    elif part.get('drafts'):
        if factor is not None:S.scale_drafts(part['drafts'],factor)
        elif portion:
            p=portion.clean()
            draft=part['drafts'][0]
            if 'share' in p:S.scale_drafts(part['drafts'],p['share'])
            else:
                if len(part['drafts'])!=1:raise HTTPException(422,'Choose a relative portion for the whole estimate or edit one food after logging')
                if 'grams' in p and not draft['food'].get('serving_g'):raise HTTPException(422,'This estimate has no known weight; choose a relative portion')
                target={k:v for k,v in p.items() if k in ('grams','count')}
                old=draft['portion'];g=draft['food'].get('serving_g')
                if 'grams' in target:factor=target['grams']/(old.get('grams') or g*old.get('count',1))
                else:factor=target['count']/(old.get('count') or old['grams']/g)
                S.scale_drafts([draft],factor);draft['portion']=target
        else:raise HTTPException(422,'Choose an estimated portion')
        part['entries']=S.draft_entries(part['drafts']);part['status']='ready'
    elif part.get('catalog'):
        selected=catalog if catalog is not None else part.get('catalog_selected')
        if selected is None or not 0<=selected<len(part['catalog']):raise HTTPException(422,'Choose the product you meant')
        if portion:part['portion_override']=portion.clean()
        part=resolver._catalog(part['catalog'][selected],part)
        if part['status']=='quantity':part['catalog_selected']=0
    elif portion and part.get('item',{}).get('kind'):
        item=part['item'];pick=meal_chat.Pick(kind=item['kind'],id=item['id'])
        return choose(c,uid,message,index,pick=pick,portion=portion)
    elif portion and part['status']=='unknown':
        part['pending_portion']=portion.clean();part['looked_up']=False
    else:raise HTTPException(422,'Choose a food, portion or search result')
    result['parts']=[part if p['index']==index else p for p in result['parts']]
    result.pop('error',None)
    return C.write(c,uid,message,result)


def manual(c,uid,message,body):
    if message['state']=='pending':
        C.begin(c,uid,message,engine.resolve(c,uid,message),aliases=False)
        message=engine.locked_message(c,uid,message['id'])
    result=C.card(c,uid,message)
    if not result:raise HTTPException(409,'Use a new food message for these nutrition numbers')
    C.check_live(message,result)
    if result.get('destination_required') and not result.get('destination_override'):raise HTTPException(409,'Choose the day and meal on this card before logging these numbers')
    part=next((p for p in result['parts'] if p['index']==body.part),None)
    if not part:raise HTTPException(422,'Choose the unresolved food for these numbers')
    if part.get('logged'):return food_thread.answer_with(c,uid,message)
    entries=[]
    for item in body.items:
        data=item.model_dump();missing=[k for k in meal_chat.NUM if data.get(k) is None]
        entries.append({'name':data['name'].strip(),'brand':None,'amount':data['amount'],'unit':data['unit'],
                        **{k:(data[k] if data.get(k) is not None else None if k in ('fiber_g',*N.EXTRA) else 0) for k in meal_chat.NUM},
                        'source':'quick','ref':{'origin':'manual','unknown_nutrients':missing}})
    if any(not e['name'] for e in entries):raise HTTPException(422,'Give the food a name')
    replacement={**part,'manual':True,'status':'ready','entries':entries,'looked_up':True}
    replacement.pop('drafts',None);replacement.pop('templates',None)
    result['parts']=[replacement if p['index']==body.part else p for p in result['parts']]
    return C.write(c,uid,message,result,force=not (message.get('result') or {}).get('review_only'),only={body.part})


def follow_up(c,uid,message):
    try:
        with c.transaction(): return _follow_up(c,uid,message)
    except HTTPException as error:
        if error.status_code not in (400,404,409,422):raise
        return None


def _follow_up(c,uid,message):
    """One short choice/portion answer updates its original card, not a new meal."""
    from . import food_thread_edit as edits
    previous=edits._context(c,uid,message)
    if not previous:return None
    result=C.card(c,uid,previous)
    if not result or not result.get('pending_count') or result.get('cancelled'):return None
    pending=[p for p in result['parts'] if p['status']!='ready' and not p.get('logged')]
    text=message['body'];words=set(meal_chat.name_words(text))
    portion,rest=meal_chat.amount(meal_chat.raw(meal_chat.LEAD.sub('',meal_chat.norm(text).strip())))
    pure=portion and rest is not None and all(t in meal_chat.FILLER or t in meal_chat.CORRECTION for t in rest)
    dest=edits._destination_info(text,message['local_day'])
    response=None
    if dest:
        response=edits.destination(c,uid,previous,dest.get('day') or dt.date.fromisoformat(result['day']),dest.get('meal') or result['meal'])
    elif len(pending)==1 and pending[0].get('description'):
        response=description_follow_up(c,uid,previous,message,result,pending[0],portion)
        if response is not None:return response
    elif pure and len(pending)==1:
        response=choose(c,uid,previous,pending[0]['index'],portion=meal_chat.Portion(**portion))
    else:
        hits=[]
        for part in pending:
            for i,food in enumerate(part.get('catalog',[])):
                if words and words<=set(meal_chat.name_words(food['name'])):hits.append((part['index'],i,None))
            for food in part.get('item',{}).get('choices',[]):
                if words and words<=set(meal_chat.name_words(food['name'])):hits.append((part['index'],None,meal_chat.Pick(kind=food['kind'],id=food['id'])))
        if len(hits)==1:
            index,catalog,pick=hits[0];response=choose(c,uid,previous,index,pick=pick,catalog=catalog)
    if response is None:return None
    answer=food_thread.finish_reply(c,uid,message,{'kind':'edit','text':'Updated that food card.','source':'code','targets_message':previous['id']})
    return {**response,'messages':response['messages']+answer['messages']}


def retained_parts(previous,result):
    return [p for p in result['parts'] if p['status']=='ready' and not p.get('logged')] if (previous.get('result') or {}).get('review_only') else []

def continued_kind(previous,result):
    return 'preview' if retained_parts(previous,result) else 'continued'

def description_follow_up(c,uid,previous,message,result,part,portion):
    # Restrict short filling replies to the question we actually asked. Unrelated
    # food, questions and paragraphs remain separate messages, never taco toppings.
    text=message['body'].strip()
    if part['description'].get('portion_only'):
        parsed=meal_chat.read_part(text,[])
        detail=part['description']['detail'];query=set(parsed.get('query') or [])
        if not portion or query and not query<=set(meal_chat.read_part(detail,[]).get('query') or []):return None
        said=text if query else text+' '+detail
        resolution=engine.resolve(c,uid,{**message,'body':said})
        response=C.begin(c,uid,message,resolution,destination={'day':result['day'],'meal':result['meal']})
        continued=food_thread.finish_reply(c,uid,previous,{**result,'kind':continued_kind(previous,result),'parts':retained_parts(previous,result),'pending_count':0,'can_resolve':False,'continued_to':message['id']})
        return {**response,'messages':continued['messages']+response['messages']}
    fillings={'chicken','beef','bean','pork','fish','shrimp','steak','veggie','vegetarian','cheese','carnitas','soft','hard','shell','crispy','grilled','pepperoni','mushroom','vegetable','fruit','yogurt','lentil','tomato'}
    parsed=meal_chat.read_part(text,[]);query=set(parsed.get('query') or [])
    if len(text)>120 or '\n' in text or re.search(r'https?://|www\.',text,re.I):return None
    food=part['description']['food']
    if not (query and (food in query or query<=fillings) or portion and not query):return None
    detail=part['description'].get('detail') or food
    said=text if food in query else text+' '+(food if query else detail)
    old=part['description'].get('portion') or {}
    if not portion:
        if old.get('count'):said=str(old['count'])+' '+said
        elif old.get('grams'):said=str(old['grams'])+' g '+said
    resolution=engine.resolve(c,uid,{**message,'body':said})
    resolution.update(day=result['day'],meal=result['meal'])
    if not portion and not old:
        # "Chicken" answers the filling question, not the amount question.
        # Keep the answer without silently treating it as one serving.
        waiting=engine.make_result(c,uid,message,resolution)
        waiting.update(day=result['day'],meal=result['meal'],composed=True,parts=[{'index':0,'text':said,'status':'description','logged':False,
                    'description':{'food':food,'detail':said},'question':'How many tacos did you have? You can also give their total weight.' if food=='taco' else f'How much {said} did you have? Give a count with its size, or a weight in grams.'}])
        response=C.write(c,uid,message,waiting)
    else:response=C.begin(c,uid,message,resolution,destination={'day':result['day'],'meal':result['meal']})
    continued=food_thread.finish_reply(c,uid,previous,{**result,'kind':continued_kind(previous,result),
                    'parts':retained_parts(previous,result),'pending_count':0,'can_resolve':False,'continued_to':message['id']})
    return {**response,'messages':continued['messages']+response['messages']}
