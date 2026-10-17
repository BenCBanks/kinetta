"""Explicit authenticated recipe-link reads. Network work never holds a database lock."""
import datetime as dt
import json
import time
import threading
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from . import db,recipe_fetch,recipe_schema
from .auth import current_user

router=APIRouter(prefix='/api/recipe-links')
DAILY_LIMIT=30

MATCH_LIMIT=20
WORKER_LIMIT=recipe_fetch.TIME_LIMIT+MATCH_LIMIT+5

def worker_key(uid,identity):
    import hashlib
    return int.from_bytes(hashlib.sha256(f'recipe:{uid}:{identity}'.encode()).digest()[:8],'big',signed=True)


def purge(c):
    # Rate identities need only the current UTC window. Saved meals are independent.
    c.execute("DELETE FROM recipe_link_drafts WHERE created < date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'")
    c.execute("UPDATE recipe_link_drafts SET url='',data='{}',state=CASE WHEN state='saved' THEN state ELSE 'cancelled' END WHERE expires<=now() AND (url<>'' OR data<>'{}'::jsonb)")


def cleanup(stop):
    while not stop.is_set():
        try:
            with db.connect() as c:purge(c)
        except Exception:pass # next bounded pass retries; never log private draft contents
        stop.wait(300)


class ReadIn(BaseModel):
    client_id:UUID
    url:str=Field(min_length=1,max_length=2048)


def _owned(c,uid,identity,lock=False):
    row=c.execute('SELECT * FROM recipe_link_drafts WHERE user_id=%s AND id=%s'+(' FOR UPDATE' if lock else ''),(uid,identity)).fetchone()
    if not row:raise HTTPException(404,'Recipe draft not found')
    return row


def _expire(c,row):
    now=dt.datetime.now(dt.timezone.utc)
    if row['state'] in ('pending','ready') and row['expires']<=now:
        c.execute("UPDATE recipe_link_drafts SET state='cancelled',url='',data='{}',error_code='expired',error_message='This draft expired. Read the link again to start a new draft.' WHERE user_id=%s AND id=%s",(row['user_id'],row['id']))
        return _owned(c,row['user_id'],row['id'])
    if row['state']=='pending' and row['created']<now-dt.timedelta(seconds=300 if row['url']=='photo:recipe' else WORKER_LIMIT) and c.execute('SELECT pg_try_advisory_xact_lock(%s) AS gone',(worker_key(row['user_id'],row['id']),)).fetchone()['gone']:
        c.execute("UPDATE recipe_link_drafts SET state='failed',data='{}',error_code='timeout',error_message='This read was interrupted. Try again to start a new draft.' WHERE user_id=%s AND id=%s",(row['user_id'],row['id']))
        return _owned(c,row['user_id'],row['id'])
    return row


def _out(row):
    return {'id':str(row['id']),'state':row['state'],'url':row['url'],'candidates':row['data'].get('candidates',[]),
            'error_code':row['error_code'],'message':row['error_message'],'expires':row['expires'],
            'saved_dish_id':row['saved_dish_id'],'review':row['data'].get('review'),'retry_after':2 if row['state']=='pending' else None}


def _claim(uid,body,*,photo=False,digest=None):
    try:url='photo:recipe' if photo else recipe_fetch.checked_url(body.url)[0]
    except recipe_fetch.RecipeFetchError as e:raise HTTPException(422,str(e)) from None
    with db.connect() as c:
        # Same-person concurrent reads and rate checks serialize; no network here.
        c.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',(uid,))
        purge(c)
        old=c.execute('SELECT * FROM recipe_link_drafts WHERE user_id=%s AND id=%s FOR UPDATE',(uid,body.client_id)).fetchone()
        if old:
            if old['state']=='cancelled':return old,False
            if old['url']!=url or (digest and old['data'].get('input_hash') and old['data']['input_hash']!=digest):raise HTTPException(409,'This draft identity belongs to another link. Start a new draft.')
            old=_expire(c,old)
            if old['state']=='failed' and old['error_code'] in ('busy','timeout'):
                count=c.execute("SELECT count(*) AS n FROM recipe_link_drafts WHERE user_id=%s AND coalesce(error_code,'') NOT IN ('busy','timeout')",(uid,)).fetchone()['n']
                if count>=DAILY_LIMIT:raise HTTPException(429,f'The {DAILY_LIMIT} recipe-read allowance resets at midnight UTC.')
                return c.execute("UPDATE recipe_link_drafts SET state='pending',created=now(),data='{}',error_code=NULL,error_message=NULL WHERE user_id=%s AND id=%s RETURNING *",(uid,body.client_id)).fetchone(),True
            return old,False
        # Count attempts including failed/discarded reads; changing UUID cannot evade the cap.
        count=c.execute("SELECT count(*) AS n FROM recipe_link_drafts WHERE user_id=%s AND coalesce(error_code,'') NOT IN ('busy','timeout') AND created >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",(uid,)).fetchone()['n']
        if count>=DAILY_LIMIT:raise HTTPException(429,f'You have read {DAILY_LIMIT} recipe links in this UTC day. Try after midnight UTC, or use a screenshot or type the recipe.')
        # Expired drafts lose parsed text when their owner next starts a read.

        row=c.execute('INSERT INTO recipe_link_drafts(user_id,id,url,data) VALUES(%s,%s,%s,%s) RETURNING *',(uid,body.client_id,url,json.dumps({'input_hash':digest} if digest else {}))).fetchone()
        return row,True


def _match(c,uid,candidates):
    """Reuse own-food matching without calling catalog providers or models."""
    from . import cook_chat,meal_chat
    deadline=time.monotonic()+MATCH_LIMIT
    c.execute("SET LOCAL statement_timeout='2s'")
    memory=cook_chat.memory(c,uid);catalog=meal_chat.catalog_for(c,uid)
    for recipe in candidates:
        matched=[]
        for text in recipe['ingredients'][:60]:
            if time.monotonic()>deadline:raise recipe_fetch.RecipeFetchError('timeout','Ingredient matching took too long. Try again.')
            # Prior recipe ingredient measurements keep their established units.
            known=cook_chat.from_memory(text,memory)
            if known:
                matched.append({'text':text,'status':'ready','source':'your recipe ingredients','ingredients':known})
                continue
            try:result=meal_chat.item_for(c,uid,{'text':text,'new':False},catalog)
            except HTTPException as exc:
                if exc.status_code!=404:raise
                result={'text':text,'status':'unknown','message':'This saved food is no longer available.'}
            if result.get('status')=='ready':
                totals=result['totals'];portion=result['portion']
                result['entries']=[{'name':result['name'],**totals,'amount':portion.get('grams') or portion.get('count') or 1,
                                    'unit':'g' if portion.get('grams') else 'serving','source':'saved',
                                    'ref':{'unknown_nutrients':[k for k,v in totals.items() if v is None]}}]
                result['source']='your saved foods'
            if 'choices' in result:result['choices']=[{k:v for k,v in choice.items() if k in ('id','kind','name','detail')} for choice in result['choices'][:3]]
            matched.append(result)
        recipe['matches']=matched
        recipe['ingredient_limit_exceeded']=len(recipe['ingredients'])>60
    return candidates


@router.post('/read')
def read(body:ReadIn,user=Depends(current_user)):
    row,fresh=_claim(user['id'],body)
    if not fresh:return _out(row)
    key=worker_key(user['id'],body.client_id)
    with db.connect() as worker:
        locked=worker.execute('SELECT pg_try_advisory_lock(%s) AS ok',(key,)).fetchone()['ok']
        worker.commit()
        if not locked:return _out(row)
        try:return _read_work(worker,user['id'],body,row)
        finally:
            worker.rollback()
            worker.execute('SELECT pg_advisory_unlock(%s)',(key,));worker.commit()


def _read_work(c,uid,body,row):
    error=None;candidates=[]
    try:
        page=recipe_fetch.fetch(row['url'])
        candidates=recipe_schema.parse(page['html'],page['url'])
        del page
        if not candidates:raise recipe_fetch.RecipeFetchError('no_recipe','No structured recipe was found. Try a recipe screenshot or paste the ingredients.')
        candidates=_match(c,uid,candidates)
        c.commit()
    except recipe_fetch.RecipeFetchError as e:error=(e.code,str(e))
    except recipe_schema.RecipeSchemaError as e:error=('complex',str(e))
    except Exception:error=('unavailable','This recipe could not be read. Try again, use a screenshot or paste ingredients.')
    c.rollback()
    row=_owned(c,uid,body.client_id,True)
    if row['state']=='pending':
        c.execute('UPDATE recipe_link_drafts SET state=%s,data=%s,error_code=%s,error_message=%s WHERE user_id=%s AND id=%s',
                  ('failed' if error else 'ready',json.dumps({'candidates':candidates}) if not error else '{}',error[0] if error else None,error[1] if error else None,uid,body.client_id))
    result=_out(_owned(c,uid,body.client_id))
    c.commit()
    return result


@router.get('/{identity}')
def get(identity:UUID,user=Depends(current_user)):
    with db.connect() as c:return _out(_expire(c,_owned(c,user['id'],identity,True)))


@router.delete('/{identity}')
def discard(identity:UUID,user=Depends(current_user)):
    with db.connect() as c:
        row=_owned(c,user['id'],identity,True)
        # A saved recipe is independent; discarding its preview never deletes food.
        if row['state']!='saved':c.execute("UPDATE recipe_link_drafts SET state='cancelled',url='',data='{}',error_code=NULL,error_message=NULL WHERE user_id=%s AND id=%s",(user['id'],identity))
        return _out(_owned(c,user['id'],identity))


from .recipe_review import ReviewIn,SaveIn


@router.post('/{identity}/review')
def review(identity:UUID,body:ReviewIn,user=Depends(current_user)):
    from . import recipe_review as V
    with db.connect() as c:
        row=_expire(c,_owned(c,user['id'],identity,True))
        if row['state']!='ready':raise HTTPException(409,'This draft is no longer ready. Read the link again if needed.')
        result=V.build(c,user['id'],row,body)
        data={**row['data'],'review':result}
        c.execute('UPDATE recipe_link_drafts SET data=%s WHERE user_id=%s AND id=%s',(json.dumps(data),user['id'],identity))
        return result


@router.post('/{identity}/save')
def save(identity:UUID,body:SaveIn,user=Depends(current_user)):
    from . import recipe_review as V,api_dishes as D
    if body.confirmed is not True:raise HTTPException(400,'Tap Save recipe to keep this draft')
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        row=_expire(c,_owned(c,user['id'],identity,True))
        if row['state']=='saved':
            if row['data'].get('saved_baseline')!=body.baseline:raise HTTPException(409,'That save identity belongs to an earlier review')
            if row['saved_dish_id'] is None:raise HTTPException(410,'This saved recipe was deleted; start a new draft to save it again')
            return {'dish':D._view(c,user['id'],D._get(c,user['id'],row['saved_dish_id'])),'replayed':True}
        if row['state']!='ready':raise HTTPException(409,'This draft is no longer ready')
        old=row['data'].get('review')
        if not old or old['baseline']!=body.baseline:raise HTTPException(409,'Review this recipe before saving')
        fresh=V.build(c,user['id'],row,V.ReviewIn.model_validate(old['input']))
        if fresh['baseline']!=old['baseline']:raise HTTPException(409,'An ingredient changed. Review the updated nutrition, then tap Save again.')
        if c.execute('SELECT count(*) AS n FROM dishes WHERE user_id=%s',(user['id'],)).fetchone()['n']>=D.MAX_DISHES:raise HTTPException(400,'Delete a saved recipe before adding another')
        source={k:fresh[k] for k in ('servings','pending','sources','basis','source_url','yield_text','ingredient_lines','site_nutrition','site_recipe_changed')}
        source['import_id']=str(identity)
        known_columns=','.join('known_'+k for k in D.KNOWN)
        placeholders=','.join(['%s']*(3+len(D.KNOWN)))
        did=c.execute(f"INSERT INTO dishes(user_id,name,items,{known_columns},serving,servings,recipe_source) VALUES({placeholders},'one',1,%s) RETURNING id",
                      (user['id'],fresh['name'],json.dumps(V.with_ids(fresh['items'])),*[fresh['totals'][k] for k in D.KNOWN],json.dumps(source))).fetchone()['id']
        c.execute("UPDATE recipe_link_drafts SET state='saved',saved_dish_id=%s,data=%s WHERE user_id=%s AND id=%s",(did,json.dumps({'saved_baseline':body.baseline,**({'input_hash':row['data']['input_hash']} if row['data'].get('input_hash') else {})}),user['id'],identity))
        return {'dish':D._view(c,user['id'],D._get(c,user['id'],did)),'replayed':False}


from .recipe_estimate import EstimateIn


@router.post('/{identity}/estimate')
def estimate_ingredient(identity:UUID,body:EstimateIn,user=Depends(current_user)):
    from . import recipe_estimate
    return recipe_estimate.resolve(identity,body,user)


from .recipe_photo import PhotoDraftIn


@router.post('/photo')
def photo_draft(body:PhotoDraftIn,user=Depends(current_user)):
    from . import recipe_photo
    return recipe_photo.read(body,user)
