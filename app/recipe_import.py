"""Explicit authenticated recipe-link reads. Network work never holds a database lock."""
import datetime as dt
import json
from uuid import UUID
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,Field
from . import db,recipe_fetch,recipe_schema
from .auth import current_user

router=APIRouter(prefix='/api/recipe-links')
DAILY_LIMIT=30


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
        c.execute("UPDATE recipe_link_drafts SET state='cancelled',data='{}',error_code='expired',error_message='This draft expired. Read the link again to start a new draft.' WHERE user_id=%s AND id=%s",(row['user_id'],row['id']))
        return _owned(c,row['user_id'],row['id'])
    if row['state']=='pending' and row['created']<now-dt.timedelta(seconds=30):
        c.execute("UPDATE recipe_link_drafts SET state='failed',error_code='timeout',error_message='This read was interrupted. Try again to start a new draft.' WHERE user_id=%s AND id=%s",(row['user_id'],row['id']))
        return _owned(c,row['user_id'],row['id'])
    return row


def _out(row):
    return {'id':str(row['id']),'state':row['state'],'url':row['url'],'candidates':row['data'].get('candidates',[]),
            'error_code':row['error_code'],'message':row['error_message'],'expires':row['expires'],
            'saved_dish_id':row['saved_dish_id'],'retry_after':2 if row['state']=='pending' else None}


def _claim(uid,body):
    try:url=recipe_fetch.checked_url(body.url)[0]
    except recipe_fetch.RecipeFetchError as e:raise HTTPException(422,str(e)) from None
    with db.connect() as c:
        # Same-person concurrent reads and rate checks serialize; no network here.
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,))
        old=c.execute('SELECT * FROM recipe_link_drafts WHERE user_id=%s AND id=%s FOR UPDATE',(uid,body.client_id)).fetchone()
        if old:
            if old['url']!=url:raise HTTPException(409,'This draft identity belongs to another link. Start a new draft.')
            return _expire(c,old),False
        # Count attempts including failed/discarded reads; changing UUID cannot evade the cap.
        count=c.execute("SELECT count(*) AS n FROM recipe_link_drafts WHERE user_id=%s AND created >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'",(uid,)).fetchone()['n']
        if count>=DAILY_LIMIT:raise HTTPException(429,'You have read 30 recipe links today. Try again tomorrow, or use a screenshot or type the recipe.')
        # Expired drafts lose parsed text when their owner next starts a read.
        c.execute("UPDATE recipe_link_drafts SET data='{}' WHERE user_id=%s AND expires<=now() AND data<>'{}'::jsonb",(uid,))
        row=c.execute('INSERT INTO recipe_link_drafts(user_id,id,url) VALUES(%s,%s,%s) RETURNING *',(uid,body.client_id,url)).fetchone()
        return row,True


def _match(c,uid,candidates):
    """Reuse own-food matching without calling catalog providers or models."""
    from . import cook_chat,meal_chat
    memory=cook_chat.memory(c,uid);catalog=meal_chat.catalog_for(c,uid)
    for recipe in candidates:
        matched=[]
        for text in recipe['ingredients'][:60]:
            # Prior recipe ingredient measurements keep their established units.
            known=cook_chat.from_memory(text,memory)
            if known:
                matched.append({'text':text,'status':'ready','source':'your recipe ingredients','ingredients':known})
                continue
            result=meal_chat.item_for(c,uid,{'text':text,'new':False},catalog)
            if result.get('status')=='ready':
                source=meal_chat.source_row(c,uid,result['kind'],result['id'])
                entries,why=meal_chat.compute(c,uid,result['kind'],source,result['portion'])
                if why:result={'text':text,'status':'quantity','message':why}
                else:result.update({'entries':entries,'source':'your saved foods'})
            matched.append(result)
        recipe['matches']=matched
        recipe['ingredient_limit_exceeded']=len(recipe['ingredients'])>60
    return candidates


@router.post('/read')
def read(body:ReadIn,user=Depends(current_user)):
    row,fresh=_claim(user['id'],body)
    if not fresh:return _out(row)
    error=None;candidates=[]
    try:
        page=recipe_fetch.fetch(row['url'])
        candidates=recipe_schema.parse(page['html'],page['url'])
        del page
        if not candidates:raise recipe_fetch.RecipeFetchError('no_recipe','No structured recipe was found. Try a recipe screenshot or paste the ingredients.')
        with db.connect() as c:candidates=_match(c,user['id'],candidates)
    except recipe_fetch.RecipeFetchError as e:error=(e.code,str(e))
    except recipe_schema.RecipeSchemaError as e:error=('complex',str(e))
    except Exception:
        # Store no exception text: a page, URL or private food might be in it.
        error=('unavailable','This recipe could not be read. Try again, use a screenshot or paste ingredients.')
    with db.connect() as c:
        row=_expire(c,_owned(c,user['id'],body.client_id,True))
        if row['state']=='pending':
            c.execute('UPDATE recipe_link_drafts SET state=%s,data=%s,error_code=%s,error_message=%s WHERE user_id=%s AND id=%s',
                      ('failed' if error else 'ready',json.dumps({'candidates':candidates}) if not error else '{}',error[0] if error else None,error[1] if error else None,user['id'],body.client_id))
        return _out(_owned(c,user['id'],body.client_id))


@router.get('/{identity}')
def get(identity:UUID,user=Depends(current_user)):
    with db.connect() as c:return _out(_expire(c,_owned(c,user['id'],identity,True)))


@router.delete('/{identity}')
def discard(identity:UUID,user=Depends(current_user)):
    with db.connect() as c:
        row=_owned(c,user['id'],identity,True)
        # A saved recipe is independent; discarding its preview never deletes food.
        if row['state']!='saved':c.execute("UPDATE recipe_link_drafts SET state='cancelled',data='{}',error_code=NULL,error_message=NULL WHERE user_id=%s AND id=%s",(user['id'],identity))
        return _out(_owned(c,user['id'],identity))
