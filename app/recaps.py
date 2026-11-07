"""Owner-only period facts for deliberately shared pictures. No new storage, tracking, AI or other-account reads."""
import datetime as dt
import re
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException,Query
from . import db,energy
from .auth import current_user

router=APIRouter(prefix='/api')
PERIODS=('week','month','year','this_week','last_week','this_month','last_month','this_year')


def _period(period,offset):
    """Return the calendar period and its distance back from the current one."""
    if not isinstance(offset,int) or isinstance(offset,bool) or not 0<=offset<=24:
        raise ValueError('Recap offset must be between 0 and 24')
    aliases={
      'this_week':('week',0),'last_week':('week',1),
      'this_month':('month',0),'last_month':('month',1),
      'this_year':('year',0),
    }
    if period in aliases:
        if offset:raise ValueError('Offset is only used with week, month or year')
        kind,back=aliases[period]
    else:
        kind,back=period,offset
    if kind not in ('week','month','year'):
        raise ValueError('Unknown recap period')
    if back>24:raise ValueError('Recap period is out of range')
    return kind,back


def dates(period,today,offset=0):
    kind,back=_period(period,offset)
    if kind=='week':
        start=today-dt.timedelta(days=today.weekday()+7*back)
        return start,start+dt.timedelta(days=7)
    if kind=='month':
        month_index=today.year*12+today.month-1-back
        year,month0=divmod(month_index,12)
        if year<1:raise ValueError('Recap period is out of range')
        start=dt.date(year,month0+1,1)
        end=dt.date(year+1,1,1) if month0==11 else dt.date(year,month0+2,1)
        return start,end
    year=today.year-back
    if year<1:raise ValueError('Recap period is out of range')
    return dt.date(year,1,1),dt.date(year+1,1,1)


def garmin_source(source,device):
    """Use a known model, never a custom device nickname, as picture attribution."""
    value=re.sub(r'[_\s]+',' ',device or '').strip()
    model=re.fullmatch(r'(?:Garmin )?((?:Forerunner|f[eē]nix|v[ií]voactive|v[ií]vosmart|Edge|Venu|Enduro|Instinct|epix|Lily|Approach|MARQ|tactix|Descent|D2)(?: [A-Za-z0-9+.-]+){0,5})',value,re.I)
    if model:
        tail=model[1].split(' ')[1:]
        labels={'pro','plus','music','sapphire','solar','amoled','edition','s','x','gen','sport','titanium','classic','sq','athlete','adventurer','captain','commander','aviator','golfer'}
        if all(re.fullmatch(r'\d[0-9A-Za-z+.-]*',x) or x.lower() in labels for x in tail):return 'Garmin '+model[1]
    if source=='garmin_connect' or re.search(r'\bgarmin\b',value,re.I):return 'Garmin'
    return None


def facts(c,uid,period,now=None,offset=0):
    kind,back=_period(period,offset)
    profile=c.execute('SELECT tz,units,protein_target FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    tz=db.valid_tz(profile.get('tz')) or db.DEFAULT_TZ;zone=ZoneInfo(tz)
    today=(now or dt.datetime.now(dt.timezone.utc)).astimezone(zone).date()
    start,end=dates(period,today,offset)
    lo=dt.datetime.combine(start,dt.time.min,zone);hi=dt.datetime.combine(end,dt.time.min,zone)
    # Same date_trunc/week boundary, rows and moving-time sums as Progress /progress/volume.
    rows=c.execute('''SELECT id,sport,visibility,distance_m,moving_s,source,device,
                       (start_time AT TIME ZONE %s)::date AS day
                     FROM activities WHERE user_id=%s AND NOT lift_open AND start_time>=%s AND start_time<%s ORDER BY start_time,id''',(tz,uid,lo,hi)).fetchall()
    days={};sports={};sources=set()
    for r in rows:
        day=days.setdefault(r['day'],{'day':r['day'],'activities':0,'distance_m':0,'time_s':0})
        distance=float(r['distance_m'] or 0);seconds=float(r['moving_s'] or 0)
        day['activities']+=1;day['distance_m']+=distance;day['time_s']+=seconds
        sports[r['sport']]=sports.get(r['sport'],0)+seconds
        credit=garmin_source(r['source'],r['device'])
        if credit:sources.add(credit)
    highlights=[]
    shared=[r for r in rows if r['visibility']!='me' and (r['distance_m'] or 0)>0]
    if shared:
        longest=max(shared,key=lambda r:r['distance_m'])
        highlights.append({'kind':'longest','sport':longest['sport'],'distance_m':longest['distance_m']})
    # Same strict new-best progression as /records/history, before filtering private highlights.
    # Private earlier records still establish the person's true best; they are never named in the output.
    records=c.execute('''SELECT sport,label,elapsed_s,start_time FROM (
        SELECT b.sport,b.label,b.elapsed_s,b.start_time,a.visibility,
          min(b.elapsed_s) OVER(PARTITION BY b.sport,b.distance_m ORDER BY b.start_time,b.activity_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior
        FROM best_efforts b JOIN activities a ON a.id=b.activity_id AND a.user_id=b.user_id
        WHERE b.user_id=%s AND b.start_time<%s) x
      WHERE start_time>=%s AND visibility<>'me' AND (prior IS NULL OR elapsed_s<prior)
      ORDER BY start_time DESC,elapsed_s LIMIT 1''',(uid,hi,lo)).fetchall()
    highlights.extend({'kind':'record','sport':r['sport'],'label':r['label'],'elapsed_s':r['elapsed_s']} for r in records)
    # The Activity feed is already private to its owner, so it can show a private PR.
    # Keep it separate from `highlights`, which is deliberately safe to put in a shared picture.
    owner_best_effort=c.execute('''SELECT sport,label,elapsed_s FROM (
        SELECT b.sport,b.label,b.elapsed_s,b.start_time,
          min(b.elapsed_s) OVER(PARTITION BY b.sport,b.distance_m ORDER BY b.start_time,b.activity_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) AS prior
        FROM best_efforts b WHERE b.user_id=%s AND b.start_time<%s) x
      WHERE start_time>=%s AND (prior IS NULL OR elapsed_s<prior)
      ORDER BY start_time DESC,elapsed_s LIMIT 1''',(uid,hi,lo)).fetchone()
    food=c.execute(f'''SELECT day,count(*) AS entries,
         CASE WHEN bool_or({energy.unknown_sql('protein_g')}) THEN NULL ELSE sum(protein_g) END AS protein
       FROM food_entries WHERE user_id=%s AND day>=%s AND day<%s GROUP BY day''',(uid,start,end)).fetchall()
    target=profile.get('protein_target')
    protein_days=sum(r['protein'] is not None and r['protein']>=target for r in food) if target and target>0 else None
    weeks={r['week'] for r in c.execute("SELECT DISTINCT date_trunc('week',start_time AT TIME ZONE %s)::date AS week FROM activities WHERE user_id=%s AND NOT lift_open AND start_time<%s",(tz,uid,hi)).fetchall()}
    at=min(today,end-dt.timedelta(days=1));week=at-dt.timedelta(days=at.weekday())
    if week not in weeks:week-=dt.timedelta(days=7)
    streak=0
    while week in weeks:streak+=1;week-=dt.timedelta(days=7)
    return {'period':period,'start':start,'end':end,'today':today,'tz':tz,'units':profile.get('units') or 'imperial',
      'activities':len(rows),'active_days':len(days),'distance_m':sum(d['distance_m'] for d in days.values()),
      'time_s':sum(d['time_s'] for d in days.values()),'top_sport':max(sports,key=sports.get) if sports else None,
      'days':list(days.values()),'highlights':highlights[:2],'owner_best_effort':owner_best_effort,'streak_weeks':streak,
      'food':{'logged_days':len(food),'protein_goal_days':protein_days},'garmin_sources':sorted(sources),
      'monthly_offer':kind=='month' and back==1 and today.day<=7 and (len(rows)>=3 or len(food)>=7),
      'offset':offset}


@router.get('/recaps')
def recap(period:str=Query('this_month',pattern='^(week|month|year|this_week|last_week|this_month|last_month|this_year)$'),offset:int=Query(0,ge=0,le=24),user=Depends(current_user)):
    try:
        with db.connect() as c:return facts(c,user['id'],period,offset=offset)
    except ValueError as error:
        raise HTTPException(status_code=422,detail=str(error)) from error
