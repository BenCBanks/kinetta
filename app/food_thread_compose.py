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
from . import nutrients as N
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


CATEGORIES={'taco','burrito','sandwich','salad','soup','curry','smoothie','pizza','chip','cereal'}
SIZES={'small','medium','large','big','regular','tall','grande','venti','jumbo','mini','kid','king'}
# Words that already say how much: an article ("a banana"), a household unit or a size.
IMPLIED=re.compile(r"^(?:a|an|one|another)\b|\b(?:\d|half|whole|couple|few|cups?|glass(?:es)?|bowls?|slices?|pieces?|plates?|cans?|bottles?|mugs?|scoops?|handfuls?|shots?|pints?|bars?|spoon\w*|tbsp|tsp|servings?|portions?|box(?:es)?|bags?|packets?|orders?|sides?|typical)\b")
NOT_SURE=['Not sure']
EXAMPLES={'chip':'tortilla chips','cereal':'Cheerios with milk','sandwich':'turkey on wheat','salad':'caesar with chicken','soup':'chicken noodle',
          'pizza':'2 slices of pepperoni','burrito':'chicken and rice','curry':'chicken tikka masala','smoothie':'banana and peanut butter'}
FILLINGS={'chicken','beef','bean','pork','fish','shrimp','steak','veggie','vegetarian','vegan','cheese','carnita','al','pastor','barbacoa','chorizo','soft','hard','shell','crispy','grilled','fried','tofu','turkey','egg','lamb','tuna','salmon','ham','sausage','mushroom','vegetable'}
# Words that answer "what kind of <dish>?": anything else is treated as a separate food.
TYPES={'taco':FILLINGS,'burrito':FILLINGS|{'breakfast','rice','bowl'},
       'sandwich':FILLINGS|{'blt','club','reuben','sub','wheat','white','rye','sourdough','peanut','butter','jelly','pb','j','melt','wrap','bread','lettuce','tomato','mayo'},
       'salad':FILLINGS|{'caesar','greek','cobb','garden','house','chef','side','caprese','kale','spinach','potato','pasta','fruit','dressing','ranch','lettuce','tomato','avocado'},
       'soup':FILLINGS|{'tomato','noodle','lentil','minestrone','clam','chowder','split','pea','potato','broccoli','cream','onion','french','ramen','pho','miso'},
       'pizza':FILLINGS|{'pepperoni','margherita','plain','hawaiian','supreme','meat','lover','bbq','white','thin','crust','deep','dish','slice','slices'},
       'curry':FILLINGS|{'red','green','yellow','thai','indian','tikka','masala','korma','vindaloo','butter','coconut','lentil','chickpea','potato','rice'},
       'chip':{'potato','tortilla','corn','kettle','bbq','sour','cream','onion','salt','vinegar','cheddar','plain','pita','veggie','bagel','doritos','lays','pringles','tostitos','fritos','cheetos','banana','apple'},
       'cereal':{'granola','oat','bran','corn','flake','frosted','cheerios','muesli','rice','krispies','chex','honey','nut','raisin','chocolate','sugar','plain','fruit','loops','puffs'},
       'smoothie':{'banana','strawberry','berry','mango','protein','green','peanut','butter','yogurt','milk','oat','spinach','pineapple','acai','chocolate','vanilla','fruit'}}
AMOUNT_REPLIES=['1','2','Small','Medium','Large','Not sure']


def has_amount(text):
    text=meal_chat.norm(text).strip()
    return bool(IMPLIED.search(text) or SIZES&set(meal_chat.toks(text)) or meal_chat.amount(meal_chat.raw(text))[0])


def spoken_food(text):
    """The food words as said, without leading fillers: 'some almonds' -> 'Almonds'."""
    words=re.sub(r'^(?:(?:some|the|my|a bit of|a little)\s+)+','',' '.join(text.split()),flags=re.I)
    return words[:1].upper()+words[1:]


def amount_question(food):
    return f'{spoken_food(food)} — about how much? For example “1”, “1 cup”, “a large one” or “150 g”.'


def description_question(part):
    # A category alone cannot identify a mixed dish. Ask before a generic catalog
    # match or estimator silently chooses a filling, size or number of tacos.
    if part['status']!='unknown' or part.get('item',{}).get('kind') or re.search(r'https?://|www\.',part['text'],re.I):return
    parsed=meal_chat.read_part(part['text'],[])
    portion=parsed.get('portion')
    if not portion and re.match(r'^(?:a|an|one)\b',meal_chat.norm(part['text']).strip()):portion={'count':1}
    query=parsed.get('query') or []
    food=query[0] if len(query)==1 and query[0] in CATEGORIES else None
    if not food:
        # Only a truly missing amount is asked; "a banana", "large fries" and
        # "glass of wine" already say how much, so they go straight to an estimate.
        if not has_amount(part['text']) and query and len(part['text'])<=200:
            part.update(status='description',description={'food':' '.join(query),'portion_only':True,'detail':part['text']},
                        question=amount_question(part['text']),replies=AMOUNT_REPLIES)
        return
    if food=='taco':
        question='What kind of taco was it? For example, chicken, beef or beans.' if portion else 'What kind of taco, and how many did you have? For example, “2 chicken tacos”.'
        replies=['Chicken','Beef','Fish','Veggie',*NOT_SURE]
    else:
        noun={'chip':'chips','cereal':'cereal'}.get(food,food)
        example=EXAMPLES.get(food,f'chicken {food}')
        question=f'What kind of {noun}? For example, “{example}”.'
        replies=NOT_SURE
    part.update(status='description',description={'food':food,'portion':portion},question=question,replies=replies)


def spoken(body,anchor):
    """A whole description without its day/meal words and opener: 'I had coffee with milk for breakfast' -> 'coffee with milk'."""
    s=meal_chat.LEAD.sub('',meal_chat.norm(body).strip())
    rest,_=meal_chat.when(s,anchor)
    if rest is None:return None
    rest=re.sub(r'^\s*(?:(?:i|we)\s+)?(?:just\s+)?(?:had|ate|have|got|grabbed|drank|eaten|log|add)\b\s*','',rest.strip())
    return ' '.join(rest.split()).strip(' ,.;!')


def merge_unknown(c,uid,message,result):
    """New foods from one sentence go to the estimator as the person said them.

    'Coffee with milk' or 'a burrito bowl with chicken, rice and beans' is one thing
    eaten, not separate foods that each need an amount. Own-food matches keep the
    per-food split, and so does the no-AI path, which searches one food at a time."""
    from . import coach
    parts=result['parts']
    if len(parts)<2 or any(p['status']!='unknown' or p.get('item',{}).get('kind') or p.get('logged') for p in parts):return
    # When every food has its own amount ("200 g rice, 1 medium banana") each is looked up exactly.
    if all(has_amount(p['text']) for p in parts):return
    said=spoken(message['body'],message['local_day'])
    if not said or len(said)>200 or not coach.allowed(uid,'food',connection=c):return
    result['parts']=[{'index':0,'text':said,'status':'unknown','item':{},'logged':False}]


def assume_typical(c,uid,result,assumed=()):
    """Owner decision (19 Oct 2026, competing with ChatGPT): when only the amount is missing and AI estimates are
    available, estimate a typical portion and say so on the card instead of asking. The person changes it in
    Review food before anything is logged. Without AI the catalogs need an amount, so the question stays."""
    from . import coach
    names=list(assumed)
    waiting=[p for p in result['parts'] if p['status']=='description' and (p.get('description') or {}).get('portion_only')]
    if waiting and coach.allowed(uid,'food',connection=c):
        for p in waiting:
            detail=p['description']['detail'];names.append(spoken_food(detail).lower())
            p.update(text='a typical serving of '+detail,status='unknown',item={},prefer_estimate=False)
            for k in ('description','question','replies'):p.pop(k,None)
    if names:result['assumed']=f"I assumed a typical portion of {', '.join(dict.fromkeys(names))}. Use − or + to change it."


def begin(c,uid,message,resolution,*,aliases=True,destination=None,assumed=()):
    result=engine.make_result(c,uid,message,resolution)
    if destination:result.update({k:destination[k] for k in ('day','meal') if destination.get(k)})
    result['composed']=True
    result['parts']=[own_part(c,uid,item,resolution['issued']) for item in resolution.get('items',[])]
    if (message.get('result') or {}).get('review_only'):
        categories=CATEGORIES
        for part in result['parts']:
            item=part.get('item',{});parsed=meal_chat.read_part(part['text'],[]);query=parsed.get('query') or []
            if item.get('kind') and len(query)==1 and query[0] in categories and list(meal_chat.name_words(item.get('name','')))!=query:
                part.update(status='unknown',item={});part.pop('entries',None)
            elif item.get('kind') and part['status']=='ready' and not has_amount(part['text']) and not re.search(r'\busual|\bsame|\bagain',part['text'],re.I):
                part.update(status='quantity',question=f'How much {item["name"]} did you have? Say grams or servings.')
                item.update(status='quantity',message=part['question'],options=[{'label':label,'portion':{'count':count}} for count,label in ((.5,'½ serving'),(1,'1 serving'),(2,'2 servings'))])
                part.pop('entries',None)
    if not result['parts']:
        # Keep unparsed paragraphs for the consent-gated estimator, not a request
        # for the person to rewrite them. The complete text remains in storage.
        result['parts']=[{'index':0,'text':message['body'],'status':'unknown','item':{},'logged':False}]
    text_input=(message.get('result') or {}).get('input',{}).get('kind','text')=='text'
    if text_input and not re.search(r'https?://|www\.',message['body'],re.I):merge_unknown(c,uid,message,result)
    from . import food_thread_resolve as resolver
    unresolved=[p for p in result['parts'] if p['status'] in ('unknown','choose')]
    if aliases and unresolved and (message.get('result') or {}).get('input',{}).get('kind','text')=='text':
        alias=resolver._alias(c,uid,unresolved)
        if alias:resolver._replace_group(result,{p['index'] for p in unresolved},alias)
    if (message.get('result') or {}).get('input',{}).get('kind','text')=='text' and not re.search(r'https?://|www\.',message['body'],re.I):
        for part in result['parts']:description_question(part)
        assume_typical(c,uid,result,assumed)
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
    cols=('name','brand','serving_label','serving_g',*N.ALL)
    origin=draft.get('origin_ref') or {}
    barcode=str(origin.get('id') or '') if origin.get('source')=='off' else ''
    barcode=barcode if re.fullmatch(r'\d{6,14}',barcode) else None
    fid=c.execute('''INSERT INTO custom_foods(user_id,name,brand,serving_label,serving_g,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,
                      origin,origin_notes,origin_model,origin_ref,barcode)
                      VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id''',
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
        # Legacy core zeros require unknown_nutrients; readers must honor coverage/N.known.
        e=N.storage(e)
        pos=c.execute('SELECT coalesce(max(position),0)+1 AS p FROM food_entries WHERE user_id=%s AND day=%s',(uid,result['day'])).fetchone()['p']
        row=c.execute('''INSERT INTO food_entries(user_id,day,meal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,source,ref,position,client_id)
                          VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
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
    if (message.get('result') or {}).get('review_only'):force=False
    check_live(message,result)
    auto=food_thread.preferences(c,uid)['auto_log'] and not (message.get('result') or {}).get('review_only')
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
            if (only is None or part['index'] in only) and part['status']=='ready' and not part.get('logged') and (force or not part.get('requires_tap')):added+=log_part(c,uid,message,result,part)
    for part in result['parts']:
        # Which estimate each preview row came from, so a row's − / + changes just that food.
        if part.get('drafts') and not part.get('logged'):part['entry_drafts']=[i for i,d in enumerate(part['drafts']) for _ in (d.get('own_entries') or [None])]
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
        question=(first or {}).get('question') or result.setdefault('question','Which food and portion should I use for the remaining items?')
    if first and (not question or len(question)>1000):question='Checking the remaining food. You can also search or enter its nutrition.'
    if ids:
        rows=c.execute('SELECT name,kcal FROM food_entries WHERE user_id=%s AND id=ANY(%s) ORDER BY id',(uid,ids)).fetchall()
        names=', '.join(r['name'] for r in rows[:3])+(' and more' if len(rows)>3 else '')
        result['text']=f"Added {names} · about {facts.kcal(sum(r['kcal'] for r in rows)):,} kcal."
        if question:result['text']+=' '+question
    elif ready and not pending:result['text']='Ready. Tap Add to log when you’ve added everything.' if (message.get('result') or {}).get('review_only') else 'Ready to log. Check the portions, then tap Log.'
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
