"""Explicit unknown-ingredient estimates reuse the existing food estimator and consent."""
import datetime as dt
import hashlib,json
from uuid import UUID,uuid4
from fastapi import HTTPException
from pydantic import BaseModel,Field,StrictBool
from . import db,food_photo,food_thread_sources as S,ai_budget,ai_access,coach,recipe_schema

class EstimateIn(BaseModel):
    model_config={'extra':'forbid'}
    candidate:int=Field(ge=0,le=4)
    index:int=Field(ge=0,le=59)
    client_id:UUID
    confirmed:StrictBool


def key(candidate,text):return str(candidate)+':'+hashlib.sha256(recipe_schema.text(text).encode()).hexdigest()


def resolve(identity,body,user):
    from . import recipe_import as R
    uid=user['id']
    if body.confirmed is not True:raise HTTPException(400,'Choose Estimate to send only this unmatched ingredient to AI')
    ai_access.require(uid,'food')
    if not coach.allowed(uid,'food'):raise HTTPException(403,coach.off())
    with db.connect() as c:
        row=R._expire(c,R._owned(c,uid,identity,True))
        if row['state']!='ready':raise HTTPException(409,'This draft is no longer ready')
        data=row['data'];candidates=data.get('candidates') or []
        if body.candidate>=len(candidates):raise HTTPException(422,'Choose a recipe in this draft')
        review=data.get('review');lines=(review['input']['lines'] if review and review['input']['candidate']==body.candidate else candidates[body.candidate]['ingredients'])
        if body.index>=len(lines):raise HTTPException(422,'Choose an ingredient in this draft')
        line=recipe_schema.text(lines[body.index]);entry_key=key(body.candidate,line)
        if entry_key in data.get('estimates',{}):return {'done':True,'replayed':True}
        jobs=data.get('estimate_jobs') or {};request=str(body.client_id);old=jobs.get(request);now=dt.datetime.now(dt.timezone.utc)
        if old:
            if old['key']!=entry_key:raise HTTPException(409,'This estimate identity belongs to another ingredient')
            if old['state']=='running' and dt.datetime.fromisoformat(old['expires'])>now:return {'processing':True}
            if old['state']=='done':return {'done':True,'replayed':True}
            raise HTTPException(409,'That estimate attempt ended. Tap Retry for a new attempt, or enter nutrition.')
        if len(jobs)>=30:raise HTTPException(429,'This draft has had 30 estimate attempts. Search or enter nutrition instead.')
        if any(job['state']=='running' and dt.datetime.fromisoformat(job['expires'])>now for job in jobs.values()):return {'processing':True}
        match=R._match(c,uid,[{**candidates[body.candidate],'ingredients':[line]}])[0]['matches'][0]
        if match['status']=='ready':raise HTTPException(409,'This ingredient now matches your foods. Review the recipe again.')
        lease=str(uuid4());jobs[request]={'key':entry_key,'state':'running','lease':lease,'expires':(now+dt.timedelta(seconds=300)).isoformat()}
        data={**data,'estimate_jobs':jobs};c.execute('UPDATE recipe_link_drafts SET data=%s WHERE user_id=%s AND id=%s',(json.dumps(data),uid,identity))
    error=None;entries=[]
    try:
        with ai_budget.scope(uid,body.client_id,feature='recipe ingredient'):
            estimate=food_photo.estimate(food_photo.PhotoIn(note=line),user=user,strict=True)
        entries=S.draft_entries(S.model_drafts(estimate))
    except HTTPException as e:error=(e.status_code,str(e.detail))
    except Exception:error=(503,'This ingredient could not be estimated. Search or enter nutrition instead.')
    with db.connect() as c:
        row=R._expire(c,R._owned(c,uid,identity,True));data=row['data'];jobs=data.get('estimate_jobs') or {};job=jobs.get(request)
        if row['state']!='ready' or not job or job.get('lease')!=lease:return {'cancelled':True}
        if not coach.allowed(uid,'food'):error=(403,'AI access or consent changed. Search or enter nutrition instead.')
        if dt.datetime.fromisoformat(job['expires'])<=dt.datetime.now(dt.timezone.utc):error=(409,'That estimate took too long. Review before trying again.')
        job['state']='failed' if error else 'done'
        if not error:data['estimates']={**data.get('estimates',{}),entry_key:{'entries':entries,'source':'ai','text':line,'status':'ready'}}
        c.execute('UPDATE recipe_link_drafts SET data=%s WHERE user_id=%s AND id=%s',(json.dumps(data),uid,identity))
    if error:raise HTTPException(*error)
    return {'done':True,'replayed':False}
