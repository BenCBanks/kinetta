"""Owner-bound Health weight input. Source samples never override a manual weigh-in."""
import datetime as dt
from uuid import UUID,uuid4
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException
from pydantic import AwareDatetime,BaseModel,Field,StrictBool,field_validator
from . import db
from .auth import current_user

router=APIRouter(prefix='/api/health/weights')

class Preference(BaseModel):
    model_config={'extra':'forbid'}
    enabled:StrictBool
    confirmed:StrictBool=False

class Sample(BaseModel):
    model_config={'extra':'forbid','allow_inf_nan':False}
    sample_id:UUID
    sampled_at:AwareDatetime
    kg:float=Field(ge=20,le=400)
    source_name:str=Field('Apple Health',max_length=200)
    source_bundle:str=Field('',max_length=200)

    @field_validator('kg',mode='before')
    @classmethod
    def numeric(cls,value):
        if isinstance(value,bool):raise ValueError('Use a measured weight in kilograms')
        return value

class Batch(BaseModel):
    model_config={'extra':'forbid'}
    epoch:UUID
    tz:str=Field(max_length=64)
    observed_at:AwareDatetime
    samples:list[Sample]=Field(default_factory=list,max_length=500)
    deleted:list[UUID]=Field(default_factory=list,max_length=500)


def profile(c,uid,lock=False):
    p=c.execute('SELECT tz,health_weight_read,health_weight_epoch,health_weight_last_synced,health_ai_ok,health_weight_ai_ok,weight_health_derived FROM profile WHERE user_id=%s'+(' FOR UPDATE' if lock else ''),(uid,)).fetchone()
    if not p:raise HTTPException(404,'Profile not found')
    return p


def status_data(c,uid):
    p=profile(c,uid)
    count=c.execute('SELECT count(*) AS n FROM health_weight_samples WHERE user_id=%s AND NOT deleted',(uid,)).fetchone()['n']
    has=bool(p['weight_health_derived']) or bool(c.execute("SELECT 1 FROM weights WHERE user_id=%s AND source='healthkit' LIMIT 1",(uid,)).fetchone())
    return {'enabled':p['health_weight_read'],'epoch':p['health_weight_epoch'],'tz':p['tz'] or db.DEFAULT_TZ,
            'last_sync':p['health_weight_last_synced'],'samples':count,'has_health_weight':has,
            'health_ai_ok':p['health_ai_ok'],'health_weight_ai_ok':p['health_weight_ai_ok']}


@router.get('')
def status(user=Depends(current_user)):
    with db.connect() as c:return status_data(c,user['id'])


@router.put('/preferences')
def preference(body:Preference,user=Depends(current_user)):
    if body.enabled and not body.confirmed:raise HTTPException(400,'Confirm reading Apple Health weight before enabling it')
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        p=profile(c,user['id'],True)
        if p['health_weight_read']!=body.enabled:
            c.execute('UPDATE profile SET health_weight_read=%s,health_weight_epoch=%s,health_weight_ai_ok=false WHERE user_id=%s',(body.enabled,uuid4(),user['id']))
            if body.enabled:rebuild(c,user['id'],p['tz'] or db.DEFAULT_TZ)
            else:
                c.execute("DELETE FROM weights WHERE user_id=%s AND source='healthkit'",(user['id'],))
                from .api_food import _latest_weight
                _latest_weight(c,user['id'])
        return status_data(c,user['id'])


def lift_exclusion(c,uid,day,tz):
    c.execute('DELETE FROM health_weight_exclusions WHERE user_id=%s AND day=%s',(uid,day))
    c.execute('UPDATE health_weight_samples SET excluded=false WHERE user_id=%s AND excluded AND (sampled_at AT TIME ZONE %s)::date=%s',(uid,tz,day))


def rebuild(c,uid,tz,*,days=None):
    """Project only touched days on normal pages; a zone change can rebuild all days."""
    if not profile(c,uid)['health_weight_read']:return
    days=sorted(set(days)) if days is not None else None
    if days==[]:return
    condition=' AND day=ANY(%s)' if days is not None else ''
    c.execute("DELETE FROM weights WHERE user_id=%s AND source='healthkit'"+condition,(uid,days) if days is not None else (uid,))
    extra='';params=[uid,tz,uid]
    if days is not None:
        zone=ZoneInfo(tz)
        start=dt.datetime.combine(days[0],dt.time(),zone).astimezone(dt.timezone.utc)
        end=dt.datetime.combine(days[-1]+dt.timedelta(days=1),dt.time(),zone).astimezone(dt.timezone.utc)
        extra=' AND s.sampled_at>=%s AND s.sampled_at<%s AND (s.sampled_at AT TIME ZONE %s)::date=ANY(%s)'
        params.extend([start,end,tz,days])
    c.execute('''INSERT INTO weights(user_id,day,kg,note,source,health_sample_id,source_name)
      SELECT %s,day,kg,NULL,'healthkit',sample_id,source_name FROM (
        SELECT DISTINCT ON (s.day) s.day,s.kg,s.sample_id,s.source_name FROM (
          SELECT (s.sampled_at AT TIME ZONE %s)::date AS day,s.*
          FROM health_weight_samples s WHERE s.user_id=%s AND NOT s.deleted AND NOT s.excluded'''+extra+'''
        ) s LEFT JOIN health_weight_exclusions e ON e.user_id=s.user_id AND e.day=s.day
        WHERE e.before_time IS NULL OR s.sampled_at>e.before_time
        ORDER BY s.day,s.sampled_at DESC,s.sample_id DESC) chosen
      ON CONFLICT(user_id,day) DO NOTHING''',params)
    from .api_food import _latest_weight
    _latest_weight(c,uid)


@router.post('')
def import_weights(body:Batch,user=Depends(current_user)):
    now=dt.datetime.now(dt.timezone.utc);tz=db.valid_tz(body.tz)
    if not tz:raise HTTPException(400,'Unknown time zone')
    if not now-dt.timedelta(days=7)<=body.observed_at<=now+dt.timedelta(minutes=5):raise HTTPException(400,'Read Apple Health weight again before syncing')
    ids=[s.sample_id for s in body.samples]
    if len(set(ids))!=len(ids) or len(set(body.deleted))!=len(body.deleted) or set(ids)&set(body.deleted):raise HTTPException(400,'Send each Health sample identity once')
    if any(s.sampled_at>body.observed_at+dt.timedelta(minutes=5) for s in body.samples):raise HTTPException(400,'A weight cannot be in the future')
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(user['id'],))
        p=profile(c,user['id'],True)
        if not p['health_weight_read']:raise HTTPException(409,'Apple Health weight sync is off')
        if p['health_weight_epoch']!=body.epoch or (p['tz'] or db.DEFAULT_TZ)!=tz:raise HTTPException(409,'Weight sync settings changed. Read Health again.')
        zone=ZoneInfo(tz)
        touched={sample.sampled_at.astimezone(zone).date() for sample in body.samples}
        if body.deleted:
            touched.update(row['sampled_at'].astimezone(zone).date() for row in c.execute('SELECT sampled_at FROM health_weight_samples WHERE user_id=%s AND sample_id=ANY(%s) AND sampled_at IS NOT NULL',(user['id'],body.deleted)))
        for sample in body.samples:
            old=c.execute('SELECT sampled_at,kg,source_name,source_bundle,deleted FROM health_weight_samples WHERE user_id=%s AND sample_id=%s',(user['id'],sample.sample_id)).fetchone()
            name=' '.join(sample.source_name.split()) or 'Apple Health';bundle=sample.source_bundle.strip()
            if old and not old['deleted'] and (old['sampled_at']!=sample.sampled_at or old['kg']!=sample.kg or old['source_name']!=name or old['source_bundle']!=bundle):
                # HealthKit samples are immutable; a changed measurement has a new UUID.
                if abs(float(old['kg'])-sample.kg)>.0001 or old['sampled_at']!=sample.sampled_at:raise HTTPException(409,'This Health sample identity already has another measurement')
            c.execute('''INSERT INTO health_weight_samples(user_id,sample_id,sampled_at,kg,source_name,source_bundle,observed_at)
              VALUES(%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(user_id,sample_id) DO UPDATE SET observed_at=greatest(health_weight_samples.observed_at,excluded.observed_at)
              WHERE NOT health_weight_samples.deleted''',(user['id'],sample.sample_id,sample.sampled_at,sample.kg,name,bundle,body.observed_at))
        for sample_id in body.deleted:
            c.execute('''INSERT INTO health_weight_samples(user_id,sample_id,deleted,observed_at) VALUES(%s,%s,true,%s)
              ON CONFLICT(user_id,sample_id) DO UPDATE SET deleted=true,sampled_at=NULL,kg=NULL,source_name=NULL,source_bundle=NULL,
              observed_at=greatest(health_weight_samples.observed_at,excluded.observed_at)''',(user['id'],sample_id,body.observed_at))
        rebuild(c,user['id'],tz,days=touched)
        c.execute('UPDATE profile SET health_weight_last_synced=now() WHERE user_id=%s',(user['id'],))
        return {'ok':True,'received':len(body.samples),'deleted':len(body.deleted),'sample_ids':ids,'deleted_ids':body.deleted,**status_data(c,user['id'])}
