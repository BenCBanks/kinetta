"""Server-validated source/portion/manual choices for a composed food card."""
import copy
import json
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


UNSURE=re.compile(r"(?:i'?m |i am )?(?:not sure|unsure|no idea|no clue|(?:i )?(?:don'?t|do not|dunno) (?:know|remember)|can'?t remember|idk|dunno|whatever|any|anything|doesn'?t matter|normal|regular|typical|average|the usual kind)")


def is_unsure(text):
    """'Not sure', 'no idea', 'whatever is normal': estimate a typical version (shared with the AI step)."""
    return bool(UNSURE.fullmatch(re.sub(r'\s+',' ',text.casefold().replace('’',"'")).strip(' .!?,')))


def conversational_help(c,uid,message):
    """Help and explicit estimate requests refer to food, never become new foods."""
    from . import food_thread_edit as edits,coach
    text=re.sub(r'\s+',' ',message['body'].casefold().replace('’',"'")).strip(' .!?,')
    # "Not sure" answers a food question (estimate a typical one); "what do you mean" asks about the question.
    unsure=is_unsure(text)
    confused=bool(re.fullmatch(r"(?:i (?:don'?t|do not) understand(?: (?:that|this|you|the question))?|(?:i (?:have )?)?no idea what you mean|what do you mean|(?:i'?m|i am) confused|huh|can you explain(?: (?:that|this))?|i (?:don'?t|do not) know what (?:you mean|that means)|what does that mean|help|help me|that makes no sense)",text))
    estimate=bool(re.fullmatch(r'(?:please )?(?:just |can you )?(?:estimate(?: (?:it|them|that|the calories|calories))?|guess|make a guess|use (?:an? )?ai(?: estimate)?|you (?:decide|pick|choose))(?: please| for me)?',text))
    if not confused and not estimate and not unsure:return None
    previous=edits._context(c,uid,message)
    result=C.card(c,uid,previous) if previous else None
    pending=[p for p in (result or {}).get('parts',[]) if p['status']!='ready' and not p.get('logged')]
    def reply(value):return food_thread.finish_reply(c,uid,message,{'kind':'answer','intent':'clarification_help','text':value,'source':'code'})
    if not result:return reply('Tell me the food and amount, for example “2 chicken tacos”. I’ll help work out the calories, then you can review before logging.')
    if not pending:return reply('Your food is ready. Tap Review food to check the amounts, choose a meal and confirm. Nothing is logged until you confirm.')
    part=pending[0]
    if part.get('description') and confused:
        return reply('I need one detail to estimate this food. '+(part.get('question') or 'How much did you have?')+' Or say “not sure” and I’ll estimate a typical one.')
    if part.get('description'):
        if not coach.allowed(uid,'food',connection=c):
            return reply((part.get('question') or 'How much did you eat?')+' Without AI estimates, a type and amount let me find it in the food database.')
        return typical(c,uid,previous,message,result,part)
    if estimate or unsure:
        if not coach.allowed(uid,'food',connection=c):return reply('AI estimates need AI access and your permission in Me → AI features. You can also tell me the total weight, or search for a food with the right serving size.')
        if part.get('item',{}).get('kind') or part.get('drafts'):return reply('I already have nutrition for this food. Tell me how much you ate, or check the amount shown on its card.')
        resolution=engine.resolve(c,uid,{**message,'body':part['text']})
        response=C.begin(c,uid,message,resolution,aliases=False,destination={'day':result['day'],'meal':result['meal']})
        message=engine.locked_message(c,uid,message['id'])
        fresh=C.card(c,uid,message)
        for p in fresh['parts']:
            if p['status']=='unknown':p.update(prefer_estimate=True,skip_alias=True,looked_up=False)
        response=C.write(c,uid,message,fresh)
        continued=food_thread.finish_reply(c,uid,previous,{**result,'kind':continued_kind(previous,result),'parts':retained_parts(previous,result),'pending_count':0,'can_resolve':False,'continued_to':message['id']})
        return {**response,'messages':continued['messages']+response['messages']}
    if part.get('catalog'):
        if coach.allowed(uid,'food',connection=c):return reply('I kept the food and amount you told me. That database entry is measured by weight. Say “estimate it” and I’ll estimate the calories, or tell me the total weight if you know it.')
        return reply('I kept the food and amount you told me. That database entry needs the total weight in grams. You can give that weight, or search for a result with a serving size that matches what you ate.')
    return reply('I kept your food details. '+(part.get('question') or 'Tell me the amount you ate, or use Search to find the food.'))


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
    text='Updated that food card.'
    if dest:
        day=dest.get('day') or dt.date.fromisoformat(result['day']);meal=dest.get('meal') or result['meal']
        text=f"Okay, {('snack' if meal=='snacks' else meal)} {when_label(day,message['local_day'])}."
    answer=food_thread.finish_reply(c,uid,message,{'kind':'edit','text':text,'source':'code','targets_message':previous['id']})
    return {**response,'messages':response['messages']+answer['messages']}


def retained_parts(previous,result):
    return [p for p in result['parts'] if p['status']=='ready' and not p.get('logged')] if (previous.get('result') or {}).get('review_only') else []

def continued_kind(previous,result):
    return 'preview' if retained_parts(previous,result) else 'continued'

def restate(c,uid,previous,message,result,said,assumed=()):
    """Answering a question continues the earlier card as one complete description."""
    resolution=engine.resolve(c,uid,{**message,'body':said})
    response=C.begin(c,uid,{**message,'body':said},resolution,destination={'day':result['day'],'meal':result['meal']},assumed=assumed)
    continued=food_thread.finish_reply(c,uid,previous,{**result,'kind':continued_kind(previous,result),'parts':retained_parts(previous,result),'pending_count':0,'can_resolve':False,'continued_to':message['id']})
    return {**response,'messages':continued['messages']+response['messages']}


def typical(c,uid,previous,message,result,part):
    """'Not sure' / 'just estimate it' to a food question: estimate a typical version and say so."""
    d=part['description'];food=d['food']
    if d.get('portion_only'):
        detail=d['detail']
        return restate(c,uid,previous,message,result,('a ' if detail.startswith('typical ') else 'a typical serving of ')+detail)
    count=(d.get('portion') or {}).get('count')
    if count:return restate(c,uid,previous,message,result,f'{meal_chat.fmt(count)} typical {food}')
    if d.get('portion'):return restate(c,uid,previous,message,result,f'a typical {food}, '+d.get('detail',food))
    # No count either: one typical one, stated on the card (owner decision: assume, say so, let them change it).
    return restate(c,uid,previous,message,result,f'a typical {food}',assumed=[food])


def wait_on(c,uid,previous,message,result,detail,food,question,replies):
    """The answer carries the next question; the earlier card is continued, so the question shows once, below the reply."""
    waiting=engine.make_result(c,uid,message,engine.resolve(c,uid,{**message,'body':detail}))
    waiting.update(day=result['day'],meal=result['meal'],composed=True,parts=[{'index':0,'text':detail,'status':'description','logged':False,
                   'description':{'food':food,'portion_only':True,'detail':detail},'question':question,'replies':replies}])
    response=C.write(c,uid,message,waiting)
    continued=food_thread.finish_reply(c,uid,previous,{**result,'kind':continued_kind(previous,result),
                    'parts':retained_parts(previous,result),'pending_count':0,'can_resolve':False,'continued_to':message['id']})
    return {**response,'messages':continued['messages']+response['messages']}


def ask_again(c,uid,previous,message,result,part,detail,question,replies):
    """A reply that adds detail but no amount refines the same food and asks for the amount once."""
    return wait_on(c,uid,previous,message,result,detail,part['description']['food'],question,replies)


def description_follow_up(c,uid,previous,message,result,part,portion):
    # A short reply answers the question we asked; unrelated food, questions and
    # paragraphs remain separate messages, never taco toppings.
    text=message['body'].strip()
    if len(text)>120 or '\n' in text or text.endswith('?') or re.search(r'https?://|www\.',text,re.I):return None
    if re.match(r'^(?:(?:i|we)\s+)?(?:also\s+)?(?:had|ate|drank)\b',meal_chat.norm(text)):return None
    parsed=meal_chat.read_part(text,[]);query=set(parsed.get('query') or [])
    sizes=query&C.SIZES;query-=C.SIZES|meal_chat.SPLIT|{'one','ones','it','them'}
    if part['description'].get('portion_only'):
        detail=part['description']['detail'];known=set(meal_chat.read_part(detail,[]).get('query') or [])
        if not (portion or sizes) and query and len(text)<=80:
            food=part['description']['food']
            if food in C.CATEGORIES and (detail.startswith('typical ') or query<=C.TYPES[food]):
                # "How many tacos?" answered with the filling: keep it and ask the count again.
                said=text if food in query else text+' '+food
                return ask_again(c,uid,previous,message,result,part,said,'How many did you have?' if food=='taco' else 'About how big was it?',['1','2','3'] if food=='taco' else ['Small','Medium','Large'])
            if query&known:
                # "Chicken sandwich" then "grilled chicken on wheat with lettuce": more detail about the same food.
                said=text if not known-query else f'{detail} ({text})'
                return ask_again(c,uid,previous,message,result,part,said,C.amount_question(said),C.AMOUNT_REPLIES)
        if not (portion or sizes) or query and not query<=known:return None
        if query:said=text
        elif portion:said=text+' '+detail
        else:said='1 '+' '.join(sorted(sizes))+' '+detail
        return restate(c,uid,previous,message,result,said)
    food=part['description']['food']
    if not (query or sizes or portion) or len(query)>6:return None
    if query and food not in query and not query<=C.TYPES.get(food,C.FILLINGS):return None   # 'banana' after 'taco' is a new food
    detail=part['description'].get('detail') or food
    if food in query or not query:said=text if food in query else text+' '+detail
    elif re.search(r'\bwith\b',text,re.I):said=re.sub(r'\s+with\b',f' {food} with',text,count=1,flags=re.I)   # caesar with chicken -> caesar salad with chicken
    else:said=text+' '+food
    old=part['description'].get('portion') or {}
    if not portion:
        if old.get('count'):said=meal_chat.fmt(old['count'])+' '+said
        elif old.get('grams'):said=meal_chat.fmt(old['grams'])+' g '+said
        elif old.get('share'):said={.5:'half',.25:'a quarter'}.get(old['share'],meal_chat.fmt(old['share']))+' of a '+said
    if not portion and not old and not sizes:
        # "Chicken" answers the filling question, not the amount question. With AI estimates a typical portion is
        # assumed and said on the card (owner decision); without, the amount is asked next.
        from . import coach
        if not coach.allowed(uid,'food',connection=c):
            return wait_on(c,uid,previous,message,result,said,food,'How many tacos did you have? You can also give their total weight.' if food=='taco' else C.amount_question(said),
                           ['1','2','3'] if food=='taco' else C.AMOUNT_REPLIES)
    return restate(c,uid,previous,message,result,said)


def _draft(c,uid,message):
    """The person's latest unconfirmed card in this conversation, if it can still change."""
    from . import food_thread_edit as edits
    previous=edits._context(c,uid,message)
    if not previous or previous['state']=='cancelled' or not (previous.get('result') or {}).get('review_only'):return None,None
    result=C.card(c,uid,previous)
    if not result or result.get('cancelled') or result.get('food_review') or result.get('kind') in ('reviewed','continued','undone','cancelled') or result.get('entry_ids'):return None,None
    return previous,result


def cancel_card(c,uid,previous):
    """Same effect as Cancel on the card: nothing from it is logged or retried."""
    reply=engine.stored_reply(c,uid,previous)
    c.execute("UPDATE food_chat_messages SET state='cancelled' WHERE id=%s AND user_id=%s",(previous['id'],uid))
    c.execute("UPDATE food_chat_jobs SET state='cancelled' WHERE message_id=%s AND user_id=%s",(previous['id'],uid))
    c.execute('INSERT INTO food_chat_cancellations(user_id,client_id) VALUES (%s,%s) ON CONFLICT DO NOTHING',(uid,previous['client_id']))
    if reply:
        result={**reply['result'],'cancelled':True,'pending_count':0,'can_resolve':False,'text':'Cancelled. Nothing from this message was logged.'}
        c.execute('UPDATE food_chat_messages SET body=%s,result=%s WHERE id=%s AND user_id=%s',(result['text'],json.dumps(result,default=str),reply['id'],uid))
    rows=c.execute(f'SELECT {food_thread.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND (id=%s OR reply_to=%s) ORDER BY id',(uid,previous['id'],previous['id'])).fetchall()
    return food_thread.message_entries(c,uid,rows)


CANCEL=re.compile(r"(?:cancel|never ?mind|nvm|forget (?:it|that|about it)|scratch that|start over|delete (?:that|it|this)|remove (?:that|it|this)|undo(?: that| it)?|ignore (?:that|it))(?: please)?")


def cancel_words(c,uid,message):
    text=re.sub(r'\s+',' ',message['body'].casefold().replace('’',"'")).strip(' .!?,')
    if not CANCEL.fullmatch(text):return None
    return cancel_latest(c,uid,message)


def cancel_latest(c,uid,message):
    previous,result=_draft(c,uid,message)
    if not previous:
        return food_thread.finish_reply(c,uid,message,{'kind':'answer','intent':'cancel','source':'code','text':'There’s nothing waiting to cancel. Logged food has Undo on its card.'})
    updated=cancel_card(c,uid,previous)
    answer=food_thread.finish_reply(c,uid,message,{'kind':'answer','intent':'cancel','source':'code','text':f'Okay, I removed “{previous["body"][:80]}”. Nothing was logged.','targets_message':previous['id']})
    return {'handled':True,'messages':updated+answer['messages']}


def draft_edit(c,uid,message,intent=None,dest=None):
    """'Actually 3 eggs', 'remove the toast' or 'it was lunch' change the unconfirmed card, before anything is logged.
    The AI understanding step passes the same intent/destination it read; otherwise the rules parse the words."""
    from . import food_thread_edit as edits
    previous,result=_draft(c,uid,message)
    if not previous:return None
    def done(response,text):
        answer=food_thread.finish_reply(c,uid,message,{'kind':'edit','text':text,'source':'code','targets_message':previous['id']})
        return {**response,'messages':response['messages']+answer['messages']}
    if intent is None and dest is None:dest=edits._destination_info(message['body'],message['local_day'])
    if dest:
        day=dest.get('day') or dt.date.fromisoformat(result['day']);meal=dest.get('meal') or result['meal']
        return done(edits.destination(c,uid,previous,day,meal),f"Okay, {('snack' if meal=='snacks' else meal)} {when_label(day,message['local_day'])}.")
    intent=intent or edits._intent(message['body'],message['local_day'])
    if not intent or intent.get('destination') or intent.get('invalid'):return None
    parts=[p for p in result['parts'] if not p.get('logged')]
    words=set(intent.get('words') or [])
    def names(p):return set(meal_chat.name_words(p['text']))|{w for e in p.get('entries') or [] for w in meal_chat.name_words(e['name'])}
    hits=[p for p in parts if words<=names(p)] if words else parts
    if len(hits)!=1 or hits[0].get('description'):return None
    part=hits[0];drafts=part.get('drafts') or []
    # One estimate can hold several foods ("2 eggs and toast"): change only the one named.
    named=[i for i,d in enumerate(drafts) if words and words<=set(meal_chat.name_words(d['food']['name']))]
    # Size and amount words don't name a food: "remove the coffee" means the whole "1 large coffee".
    whole=not words or not (set(meal_chat.name_words(part['text']))-words-C.SIZES-{'typical','serving'}) or bool(drafts) and len(named)==len(drafts)
    if intent.get('remove'):
        if not whole and named and len(named)<len(drafts):
            removed=', '.join(lower(drafts[i]['food']['name']) for i in named)
            kept={**part,'drafts':[d for i,d in enumerate(drafts) if i not in named]};kept['entries']=S.draft_entries(kept['drafts'])
            return done(C.write(c,uid,previous,{**result,'parts':[kept if p['index']==part['index'] else p for p in result['parts']]}),f'Removed {removed}.')
        if not whole:return separate(c,uid,message,previous)
        rest=[p for p in result['parts'] if p['index']!=part['index']]
        if not rest:return done({'messages':cancel_card(c,uid,previous)},f'Removed {spoken_label(part)}. Nothing was logged.')
        return done(C.write(c,uid,previous,{**result,'parts':rest}),f'Removed {spoken_label(part)}.')
    p=intent['portion']
    if drafts and len(drafts)==1:named=[0]
    if drafts and (not whole or len(drafts)==1):
        if len(named)!=1:return separate(c,uid,message,previous)
        draft=drafts[named[0]];old=draft['portion']
        if 'share' in p:factor=p['share']
        elif 'count' in p and 'count' in old:factor=p['count']/old['count']
        elif 'grams' in p and (old.get('grams') or draft['food'].get('serving_g')):factor=p['grams']/(old.get('grams') or draft['food']['serving_g']*old.get('count',1))
        else:return separate(c,uid,message,previous)
        part={**part,'drafts':copy.deepcopy(drafts)};S.scale_drafts([part['drafts'][named[0]]],factor);part['entries']=S.draft_entries(part['drafts'])
        name=lower(draft['food']['name'])
        return done(C.write(c,uid,previous,{**result,'parts':[part if x['index']==part['index'] else x for x in result['parts']]}),f'Changed {name} to {portion_text(p,name)}.')
    if drafts:
        old=meal_chat.amount(meal_chat.raw(part['text']))[0] or {}
        if 'share' in p:response=choose(c,uid,previous,part['index'],factor=p['share'])
        elif 'count' in p and old.get('count'):response=choose(c,uid,previous,part['index'],factor=p['count']/old['count'])
        elif 'grams' in p:response=choose(c,uid,previous,part['index'],portion=meal_chat.Portion(grams=p['grams']))
        else:return separate(c,uid,message,previous)
    elif part.get('item',{}).get('kind') and 'share' not in p:
        response=choose(c,uid,previous,part['index'],portion=meal_chat.Portion(**p))
    else:return separate(c,uid,message,previous)
    name=spoken_label(part)
    return done(response,f'Changed {name} to {portion_text(p,name)}.')


def separate(c,uid,message,previous):
    return food_thread.finish_reply(c,uid,message,{'kind':'answer','intent':'clarification_help','source':'code','targets_message':previous['id'],
            'text':'I can’t change that amount from here. Tap Review food to adjust it before logging.'})


def portion_text(p,name):
    if 'share' in p:return f'{meal_chat.fmt(p["share"])}×'
    if 'grams' in p:return f'{meal_chat.fmt(p["grams"])} g'
    return f'{meal_chat.fmt(p["count"])}'+(f' {p["unit"]}' if p.get('unit') else '')


def when_label(day,today):
    return 'today' if day==today else 'yesterday' if day==today-dt.timedelta(days=1) else day.strftime('%A %b %-d')


def spoken_label(part):
    entries=part.get('entries') or []
    return lower(entries[0]['name'] if len(entries)==1 else part['text'])


def lower(name):
    """'Large coffee' reads 'large coffee' mid-sentence; keep brands such as 'KIND bar'."""
    name=re.sub(r'^(?:an? )?typical (?:serving of )?','',name.strip(),flags=re.I)
    return name[:1].lower()+name[1:] if name[1:2].islower() else name
