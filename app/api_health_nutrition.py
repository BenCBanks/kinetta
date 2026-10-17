"""Private change journal for explicit native Health nutrition output; no Health calls here."""
import datetime as dt
import math
from uuid import UUID,uuid4
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException,Query
from pydantic import BaseModel,StrictBool
from . import db
from .auth import current_user
from .nutrients import CORE
router=APIRouter(prefix='/api/health/nutrition')

class Preference(BaseModel):
    model_config={'extra':'forbid'}
    enabled:StrictBool
    confirmed:StrictBool=False


def lock(c,uid):
    # Revisions must be assigned and read in commit order for each owner. A plain
    # sequence alone could let a later committed cursor skip an earlier transaction.
    c.execute('SELECT pg_advisory_xact_lock(155::integer,%s::integer)',(uid,))


def profile(c,uid):
    p=c.execute('SELECT tz,health_nutrition_write,health_nutrition_epoch FROM profile WHERE user_id=%s',(uid,)).fetchone()
    if not p:raise HTTPException(404,'Profile not found')
    return p


def data(p):return {'enabled':p['health_nutrition_write'],'epoch':p['health_nutrition_epoch'],'tz':p['tz'] or db.DEFAULT_TZ}


def invalidate(c,uid):
    """Re-enable/time-zone change replays all surviving days and prior deletions."""
    lock(c,uid)
    c.execute('''INSERT INTO health_nutrition_days(user_id,day)
      SELECT %s,day FROM food_entries WHERE user_id=%s GROUP BY day
      ON CONFLICT(user_id,day) DO NOTHING''',(uid,uid))
    c.execute("UPDATE health_nutrition_days SET revision=nextval('health_nutrition_revision'),changed_at=now() WHERE user_id=%s",(uid,))


@router.get('')
def status(user=Depends(current_user)):
    with db.connect() as c:return data(profile(c,user['id']))


@router.put('/preferences')
def preference(body:Preference,user=Depends(current_user)):
    if body.enabled and not body.confirmed:raise HTTPException(400,'Confirm writing your nutrition to Apple Health before enabling it')
    uid=user['id']
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR UPDATE',(uid,))
        lock(c,uid)
        p=profile(c,uid)
        if p['health_nutrition_write']!=body.enabled:
            c.execute('UPDATE profile SET health_nutrition_write=%s,health_nutrition_epoch=%s WHERE user_id=%s',(body.enabled,uuid4(),uid))
            if body.enabled:invalidate(c,uid)
        return data(profile(c,uid))


def totals(rows):
    result={};coverage={}
    for key in CORE:
        values=[]
        for r in rows:
            unknown=(r.get('ref') or {}).get('unknown_nutrients')
            n=r.get(key)
            if n is None or (isinstance(unknown,list) and key in unknown):continue
            n=float(n)
            if math.isfinite(n) and n>=0:values.append(n)
        coverage[key]={'known':len(values),'entries':len(rows)}
        # Partial totals must not masquerade as a complete day's Health intake.
        result[key]=math.fsum(values) if rows and len(values)==len(rows) else None
    return result,coverage


@router.get('/days')
def days(epoch:UUID,after:int=Query(0,ge=0,le=9007199254740991),limit:int=Query(50,ge=1,le=100),user=Depends(current_user)):
    uid=user['id']
    with db.connect() as c:
        lock(c,uid);p=profile(c,uid)
        if not p['health_nutrition_write']:raise HTTPException(409,'Apple Health nutrition writing is off')
        if p['health_nutrition_epoch']!=epoch:raise HTTPException(409,'Nutrition sharing changed. Refresh settings before writing.')
        changed=c.execute('SELECT day,revision FROM health_nutrition_days WHERE user_id=%s AND revision>%s ORDER BY revision LIMIT %s',(uid,after,limit+1)).fetchall()
        selected=changed[:limit];more=len(changed)>limit
        entries=c.execute('SELECT day,kcal,protein_g,carbs_g,fat_g,fiber_g,ref FROM food_entries WHERE user_id=%s AND day=ANY(%s) ORDER BY day,id',(uid,[r['day'] for r in selected])).fetchall() if selected else []
        grouped={}
        for r in entries:grouped.setdefault(r['day'],[]).append(r)
        out=[];zone=ZoneInfo(p['tz'] or db.DEFAULT_TZ)
        for row in selected:
            day=row['day'];values,coverage=totals(grouped.get(day,[]))
            out.append({'day':day,'revision':row['revision'],'start':dt.datetime.combine(day,dt.time.min,zone),
                'end':dt.datetime.combine(day+dt.timedelta(days=1),dt.time.min,zone),
                'deleted':not bool(grouped.get(day)), 'values':values,'coverage':coverage})
        return {**data(p),'days':out,'next':selected[-1]['revision'] if selected else after,'more':more}
