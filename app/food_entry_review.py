"""One held food draft -> optional private recipe + explicitly confirmed food log.

Reviews reuse owner-bound chat storage. Source changes require another review;
recipe, log, source consumption and receipt commit in the same transaction.
"""
import copy
import datetime as dt
import hashlib
import json
import secrets
from typing import Literal
from uuid import UUID,uuid4,uuid5
from fastapi import APIRouter,Depends,HTTPException,Response
from pydantic import BaseModel,ConfigDict,Field,StrictBool
from . import db,nutrients as N,api_dishes as D,api_food as F,food_thread as T
from . import food_thread_compose as C,food_thread_log as E
from .auth import current_user

router=APIRouter(prefix='/api/food/thread/reviews')
class Strict(BaseModel):
    model_config=ConfigDict(extra='forbid')
class ItemsIn(Strict):
    draft_id:UUID
    client_id:UUID
    items:list[F.EntryIn]=Field(min_length=1,max_length=60)
class DishIn(Strict):
    draft_id:UUID
    client_id:UUID
    did:int=Field(gt=0)
    portion:D.PortionIn
class ReviewIn(Strict):
    draft_id:UUID
    client_id:UUID
    messages:list[int]=Field(min_length=1,max_length=60)
class ConfirmIn(Strict):
    confirm:StrictBool
    save_recipe:StrictBool=False
    log_today:StrictBool=True
    name:str|None=Field(None,max_length=80)
    meal:Literal['breakfast','lunch','dinner','snacks']|None=None
    basis:Literal['amounts','servings','weight']='amounts'
    servings:float|None=Field(None,gt=0,le=50)
    total_g:float|None=Field(None,gt=0,le=30000)
    whole:StrictBool=True
    portion:float|None=Field(None,gt=0,le=20000)


def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,default=str,separators=(',',':')).encode()).hexdigest()


def root(c,uid,key,request,text):
    c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,))
    if c.execute('SELECT 1 FROM food_chat_cancellations WHERE user_id=%s AND client_id=%s',(uid,key)).fetchone():
        raise HTTPException(409,{'code':'message_cancelled','message':'This draft was removed. Start a new food entry.'})
    old=c.execute(f'SELECT {T.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND client_id=%s FOR UPDATE',(uid,key)).fetchone()
    if old:
        if (old.get('result') or {}).get('review_request')!=request:raise HTTPException(409,'This draft identity belongs to a different request')
        return old,False
    day=D._today(c,uid).date()
    row=c.execute(f'''INSERT INTO food_chat_messages(user_id,client_id,kind,body,captured_at,local_day,state,result)
                    VALUES(%s,%s,'user',%s,now(),%s,'pending',%s) RETURNING {T.COLUMNS}''',
                  (uid,key,text,day,json.dumps({'review_only':True,'review_request':request,'draft_id':request['draft_id']}))).fetchone()
    return row,True


def dish_entry(c,uid,did,portion):
    p=D.PortionIn.model_validate(portion)
    if sum(v is not None for v in (p.grams,p.share,p.count))!=1:raise HTTPException(422,'Choose one recipe amount')
    d=D._seen(c,uid,did);totals=D._totals(d);weight=D._weight(d)
    if totals['kcal'] is None:raise HTTPException(422,'Add the missing recipe nutrition first')
    if p.grams is not None:
        if not weight:raise HTTPException(422,'This recipe has no total weight. Choose servings or enter its weight.')
        factor,amount,unit=p.grams/weight,p.grams,'g'
    elif p.count is not None:factor,amount,unit=p.count/D.serving_count(d,viewer=uid),p.count,'serving'
    else:factor,amount,unit=p.share,p.share,'dish'
    values={k:N.rounded(k,v*factor) if v is not None else None for k,v in totals.items()}
    entry={'name':d['name'],'brand':None,'amount':amount,'unit':unit,**values,'source':'dish',
           'ref':{'dish_id':did,'weight_g':weight,'dish_kcal':totals['kcal'],
                  'review_grams':weight*factor if weight else None,'unknown_nutrients':[k for k,v in values.items() if v is None]}}
    return N.storage(entry)


@router.post('/items')
def stage_items(body:ItemsIn,user=Depends(current_user)):
    values=[]
    for item in body.items:
        if 'kcal' not in item.model_fields_set:raise HTTPException(422,'Enter calories for this food')
        value=item.model_dump(mode='json',exclude={'client_id'});ref=value.get('ref') or {}
        missing=set(ref.get('unknown_nutrients') or [])|{k for k in N.ALL if k not in item.model_fields_set or getattr(item,k) is None}
        value['ref']={**ref,'unknown_nutrients':sorted(missing)};values.append(value)
    if len(json.dumps(values))>150000:raise HTTPException(422,'Add fewer foods at a time')
    for e in values:
        if not e['name'].strip():raise HTTPException(422,'Give the food a name')
        e['name']=e['name'].strip()
    request={'items':values,'draft_id':str(body.draft_id)}
    with db.connect() as c:
        m,created=root(c,user['id'],body.client_id,request,'Added for review: '+', '.join(e['name'] for e in values)[:600])
        if not created:return T.answer_with(c,user['id'],m)
        result={'composed':True,'day':str(m['local_day']),'meal':values[0]['meal'],
                'parts':[{'index':0,'text':m['body'],'status':'ready','manual':True,'entries':values,'logged':False}]}
        return C.write(c,user['id'],m,result)


@router.post('/dish')
def stage_dish(body:DishIn,user=Depends(current_user)):
    request={'did':body.did,'portion':body.portion.model_dump(mode='json',exclude={'client_id'}),'draft_id':str(body.draft_id)}
    with db.connect() as c:
        m,created=root(c,user['id'],body.client_id,request,'Recipe portion for review')
        if not created:return T.answer_with(c,user['id'],m)
        entry=dish_entry(c,user['id'],body.did,request['portion'])
        result={'composed':True,'day':str(m['local_day']),'meal':body.portion.meal,
                'parts':[{'index':0,'text':entry['name'],'status':'ready','manual':True,'entries':[entry],
                          'recipe_pick':request,'logged':False}]}
        return C.write(c,user['id'],m,result)


def collect(c,uid,ids):
    entries=[];sources=[]
    for mid in sorted(set(ids)):
        m=T.locked_message(c,uid,mid)
        if not (m.get('result') or {}).get('review_only'):raise HTTPException(409,'Use the new food draft for this review')
        reply=E.stored_reply(c,uid,m);result=copy.deepcopy((reply or {}).get('result') or {})
        if m['state']=='cancelled' or result.get('kind') in ('undone','reviewed','cancelled'):
            raise HTTPException(409,'A selected food was removed or already saved. Refresh the draft.')
        if result.get('food_review'):raise HTTPException(422,'Choose food messages, not another review')
        parts=result.get('parts',[])
        if any(p['status']!='ready' and not p.get('logged') for p in parts):raise HTTPException(409,'Answer the remaining food questions before reviewing')
        for part in parts:
            if part.get('logged'):raise HTTPException(409,'A selected food is already logged')
            if part.get('entered_numbers') and not part.get('manual'):raise HTTPException(409,'Review the entered nutrition numbers first')
            if part.get('recipe_pick'):
                pick=part['recipe_pick'];part['entries']=[dish_entry(c,uid,pick['did'],pick['portion'])]
            elif part.get('drafts'):C.fresh_drafts(c,uid,part)
            elif part.get('templates'):C.fresh_templates(c,uid,part)
            elif not part.get('manual'):C.fresh_own(c,uid,part)
            entries+=copy.deepcopy(part.get('entries') or [])
        if parts:sources.append((m,result))
    if not entries:raise HTTPException(409,'Add a food and finish its details first')
    if len(entries)>D.MAX_ITEMS:raise HTTPException(422,'Review up to 60 foods at a time')
    if any(not N.known(e,'kcal') for e in entries):raise HTTPException(422,'Enter missing calories before logging these foods')
    values={k:N.rounded(k,sum(e[k] for e in entries)) if all(N.known(e,k) for e in entries) else None for k in N.ALL}
    if any(v is not None and v>N.ENTRY_MAX.get(k,20000 if k=='kcal' else 2000) for k,v in values.items()):raise HTTPException(422,'Review a smaller amount of food')
    def grams(e):
        if e.get('unit')=='g':return e['amount']
        ref=e.get('ref') or {}
        if ref.get('review_grams'):return ref['review_grams']
        if ref.get('serving',{}).get('g') and e.get('unit')=='serving':return e['amount']*ref['serving']['g']
        return None
    weights=[grams(e) for e in entries]
    public={'foods':entries,'totals':values,'known_weight_g':sum(weights) if all(g is not None for g in weights) else None,
            'names':', '.join(e['name'] for e in entries)[:200]}
    return public,sources,digest({'sources':[m['id'] for m,_ in sources],'foods':entries})


@router.post('')
def prepare(body:ReviewIn,user=Depends(current_user)):
    uid=user['id'];request={'messages':sorted(set(body.messages)),'draft_id':str(body.draft_id)}
    with db.connect() as c:
        m,created=root(c,uid,body.client_id,request,'Food review')
        if not created:return {'review':(E.stored_reply(c,uid,m) or {}).get('result'), 'id':m['id']}
        public,sources,signature=collect(c,uid,request['messages'])
        if any((source.get('result') or {}).get('draft_id')!=str(body.draft_id) for source,_ in sources):raise HTTPException(409,'These foods belong to different drafts')
        result={'kind':'food_review','food_review':True,'text':'Review these foods before saving.',
                **public,'signature':signature,'sources':request['messages'],'expires':(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=1)).isoformat()}
        T.finish_reply(c,uid,m,result)
        return {'review':result,'id':m['id']}


def recipe_items(foods):
    items=[]
    for e in foods:
        ref=e.get('ref') or {}
        grams=e['amount'] if e['unit']=='g' else ref.get('review_grams')
        if grams is None and e['unit']=='serving':grams=((ref.get('serving') or {}).get('g') or 0)*e['amount']
        values={k:e.get(k) if N.known(e,k) else None for k in N.ALL}
        items.append({'id':secrets.token_hex(4),'name':e['name'],'grams':grams or None,'amount':f"{e['amount']:g} {e['unit']}",**values,
                      'per100':{k:v*100/grams if v is not None else None for k,v in values.items()} if grams else None,
                      'source':e['source'],'ref':ref})
    return items


@router.post('/{mid:int}/confirm')
def confirm(mid:int,body:ConfirmIn,response:Response,user=Depends(current_user)):
    if not body.confirm:raise HTTPException(400,'Confirm the food review before saving')
    if not (body.save_recipe or body.log_today):raise HTTPException(422,'Choose whether to log food or save a recipe')
    if body.log_today and body.meal is None:raise HTTPException(422,'Which meal would you like to log it to?')
    if body.save_recipe and (not (body.name or '').strip() or body.basis=='amounts'):raise HTTPException(422,'Name the recipe and choose servings or cooked weight')
    if body.basis=='servings' and body.servings is None:raise HTTPException(422,'How many servings does the whole recipe make?')
    if body.basis=='weight' and body.total_g is None:raise HTTPException(422,'What is the whole cooked weight?')
    if not body.whole and (body.basis=='amounts' or body.portion is None):raise HTTPException(422,'Choose how much of the recipe you ate')
    if body.basis=='servings' and body.portion is not None and body.portion>20:raise HTTPException(422,'Log up to 20 servings at once')
    uid=user['id'];request=body.model_dump(mode='json');request_key=digest(request)
    with db.connect() as c:
        m=T.locked_message(c,uid,mid);r=(E.stored_reply(c,uid,m) or {}).get('result') or {}
        if not r.get('food_review'):raise HTTPException(404,'Food review not found')
        if r.get('confirmed'):
            if r['confirmed']!=request_key:raise HTTPException(409,'This review was already saved with different choices')
            return {**T.answer_with(c,uid,m),'replayed':True,'recipe_id':r.get('recipe_id')}
        if m['state']=='cancelled' or r.get('kind')!='food_review' or dt.datetime.fromisoformat(r['expires'])<dt.datetime.now(dt.timezone.utc):raise HTTPException(409,'This review is no longer waiting. Review the food again.')
        public,sources,signature=collect(c,uid,r['sources'])
        if signature!=r['signature']:
            fresh={**r,**public,'signature':signature,'text':'Food details changed. Review the updated numbers before confirming.'}
            T.finish_reply(c,uid,m,fresh);response.status_code=409
            return {'changed':True,'detail':fresh['text'],'review':fresh,'id':mid}
        factor=1 if body.whole else body.portion/(body.servings if body.basis=='servings' else body.total_g)
        values={k:N.rounded(k,v*factor) if v is not None else None for k,v in public['totals'].items()}
        recipe_id=None;name=(body.name or '').strip() or public['names'];day=D._today(c,uid).date()
        if body.save_recipe:
            if c.execute('SELECT count(*) AS n FROM dishes WHERE user_id=%s',(uid,)).fetchone()['n']>=D.MAX_DISHES:raise HTTPException(409,'Your recipe library is full. Remove a recipe first.')
            recipe_id=c.execute('''INSERT INTO dishes(user_id,name,items,serving,servings,yield_servings,cooked_g)
                                    VALUES(%s,%s,%s,%s,1,%s,%s) RETURNING id''',
                                (uid,name,json.dumps(recipe_items(public['foods'])),'one' if body.basis=='servings' else 'portion',body.servings,body.total_g)).fetchone()['id']
        ids=[];entry_digests={}
        if body.log_today:
            # Keep one-off foods as the actual entered amounts; a selected recipe portion is one aggregate entry.
            foods=public['foods'] if body.basis=='amounts' else [{'name':name,'brand':None,'amount':(body.servings if body.basis=='servings' else body.total_g) if body.whole else body.portion,
                    'unit':'serving' if body.basis=='servings' else 'g',**values,'source':'dish' if recipe_id else 'quick',
                    'ref':{'dish_id':recipe_id,'unknown_nutrients':[k for k,v in values.items() if v is None]}}]
            for index,food in enumerate(foods):
                e=N.storage(food)
                validated=F.EntryIn.model_validate({**e,'day':day,'meal':body.meal})
                e=validated.model_dump(mode='json');key=str(uuid5(UUID(str(m['client_id'])),f'review-food-{index}'))
                pos=c.execute('SELECT coalesce(max(position),0)+1 AS p FROM food_entries WHERE user_id=%s AND day=%s',(uid,day)).fetchone()['p']
                row=c.execute('''INSERT INTO food_entries(user_id,day,meal,name,brand,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,source,ref,position,client_id)
                    VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *''',
                    (uid,day,body.meal,e['name'],e.get('brand'),e['amount'],e['unit'],*[e[k] for k in N.ALL],e['source'],json.dumps(e.get('ref')),pos,key)).fetchone()
                ids.append(row['id']);entry_digests[str(row['id'])]=E.entry_digest(row)
                c.execute('INSERT INTO food_chat_entries(user_id,message_id,entry_id) VALUES(%s,%s,%s)',(uid,mid,row['id']))
        messages=[]
        for source,result in sources:
            result.update(kind='reviewed',parts=[],pending_count=0,can_resolve=False,text='Included in your completed food review.',completed_review=mid)
            messages+=T.finish_reply(c,uid,source,result)['messages']
        text=(f'Saved {name} to My Recipes. ' if recipe_id else '')+(f'Logged to {body.meal} today.' if ids else 'Nothing was added to your food log.')
        result={**r,'kind':'log' if ids else 'answer','confirmed':request_key,'recipe_id':recipe_id,'entry_ids':ids,'entry_digests':entry_digests,'logged_totals':values,'logged_unknown':[k for k,v in values.items() if v is None],'day':str(day),'meal':body.meal,'text':text}
        saved=T.finish_reply(c,uid,m,result)
        T.link_entries(c,uid,saved['messages'],ids)
        saved['messages']=T.message_entries(c,uid,saved['messages'])
        return {**saved,'messages':messages+saved['messages'],'recipe_id':recipe_id}


@router.get('/draft/{draft_id}')
def draft(draft_id:UUID,user=Depends(current_user)):
    uid=user['id']
    with db.connect() as c:
        T.purge_old(c,uid)
        roots=c.execute(f"SELECT {T.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND kind='user' AND result->>'draft_id'=%s ORDER BY id LIMIT 100",(uid,str(draft_id))).fetchall()
        replies=c.execute(f"SELECT {T.COLUMNS} FROM food_chat_messages WHERE user_id=%s AND reply_to=ANY(%s) ORDER BY id",(uid,[m['id'] for m in roots])).fetchall() if roots else []
        return {'messages':T.message_entries(c,uid,sorted(roots+replies,key=lambda m:m['id'])),'preferences':T.preferences(c,uid),'has_more':False,'before':None}
