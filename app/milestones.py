"""Private, once-only milestones. Imports enqueue cheap owner jobs; requests never scan history."""
import datetime as dt
import json
import math
import threading
from uuid import UUID
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel
from typing import Literal
from . import db,recaps,analysis
from .auth import current_user

router=APIRouter(prefix='/api/milestones')
FIRST_DISTANCES=((5000,'5K'),(10000,'10K'),(21097.5,'half marathon'),(42195,'marathon'))
SPORTS={'run':'run','ride':'ride','walk':'walk','hike':'hike','swim':'swim','row':'rowing workout','ski':'ski workout','workout':'workout','other':'activity'}


def candidates(c,uid,now,zone,units):
    """One background pass, coalesced across a batch of imports/edits. Only fixed facts leave this helper."""
    rows=c.execute('''SELECT id,sport,start_time,created,updated,distance_m,moving_s,elapsed_s,source,device
      FROM activities WHERE user_id=%s AND NOT lift_open ORDER BY start_time,id''',(uid,)).fetchall()
    today=now.astimezone(zone).date();next_check=dt.datetime.combine(today+dt.timedelta(days=1),dt.time.min,zone)
    result={};eligible=[]
    def add(code,kind,title,rank,row,details):
        credit=recaps.garmin_source(row.get('source'),row.get('device'))
        details.setdefault('garmin_sources',[credit] if credit else [])
        result[code]={'code':code,'kind':kind,'title':title,'rank':rank,'activity_id':row.get('id'),
          'day':row['start_time'].astimezone(zone).date(),'occurred':row['start_time'],
          'arrival':row.get('updated') or row['created'],'details':details,
          'garmin_source':recaps.garmin_source(row.get('source'),row.get('device'))}
    first=set();distance_first=set();year_totals={};year_sources={};weeks={};factor=1609.344 if units=='imperial' else 1000;unit='mi' if units=='imperial' else 'km'
    for r in rows:
        duration=r['elapsed_s'] or r['moving_s'] or 0
        elapsed=float(duration) if math.isfinite(duration) and 0<=duration<=172800 else 0
        end=r['start_time']+dt.timedelta(seconds=elapsed)
        if end>now+dt.timedelta(minutes=1) or r['start_time']>now:
            next_check=min(next_check,max(end,r['start_time'])+dt.timedelta(seconds=1));continue
        eligible.append(r);sport=r['sport'];day=r['start_time'].astimezone(zone).date();year=day.year
        distance=float(r['distance_m']) if r['distance_m'] is not None and math.isfinite(r['distance_m']) and r['distance_m']>=0 else None
        duration=r['moving_s'] or r['elapsed_s'];seconds=float(duration) if duration is not None and math.isfinite(duration) and duration>=0 else None
        credit=recaps.garmin_source(r['source'],r['device']);year_sources.setdefault(year,set())
        if credit:year_sources[year].add(credit)
        if sport in SPORTS and sport not in first:
            first.add(sport);add('sport:'+sport,'sport','First '+SPORTS[sport]+' on Kinetta',20,r,{'sport':sport,'distance_m':distance,'seconds':seconds})
        if sport in ('run','walk'):
            for priority,(target,label) in enumerate(FIRST_DISTANCES,1):
                if (distance or 0)>=target and (sport,target) not in distance_first:
                    distance_first.add((sport,target));add(f'first:{sport}:{target:g}','first_distance','First '+label,60+priority,r,{'sport':sport,'distance_m':distance,'target_m':target,'seconds':seconds})
        before=year_totals.get(year,0);after=before+(distance or 0);year_totals[year]=after
        for priority,target in enumerate((100,250,500,1000,2000),1):
            if before<target*factor<=after:add(f'year:{year}:{unit}:{target}','year_distance',f'{target:,} '+('miles' if unit=='mi' else 'km')+f' in {year}',40+priority,r,{'amount':target,'unit':unit,'year':year,'garmin_sources':sorted(year_sources[year])})
        week=day-dt.timedelta(days=day.weekday());entry=weeks.setdefault(week,{'row':r,'sources':set()})
        if credit:entry['sources'].add(credit)
    streak=0;previous=None;reached=set();week_sources=set()
    for week,entry in sorted(weeks.items()):
        consecutive=previous is not None and week-previous==dt.timedelta(days=7)
        streak=streak+1 if consecutive else 1;previous=week
        if not consecutive:week_sources=set()
        week_sources.update(entry['sources']);r=entry['row']
        for priority,n in enumerate((4,12,26,52),1):
            if streak>=n and n not in reached:reached.add(n);add('weeks:'+str(n),'activity_weeks',f'{n} active weeks in a row',30+priority,r,{'amount':n,'unit':'weeks','garmin_sources':sorted(week_sources)})
    # Match existing standard-effort records. Within one local day only its best record is offered.
    by_id={r['id']:r for r in eligible};best={};daily={}
    for b in c.execute('''SELECT activity_id,sport,distance_m,label,elapsed_s FROM best_efforts
      WHERE user_id=%s ORDER BY start_time,activity_id,id''',(uid,)).fetchall():
        r=by_id.get(b['activity_id']);key=(b['sport'],float(b['distance_m']));seconds=float(b['elapsed_s'])
        if not r or not math.isfinite(seconds) or seconds<=0 or key[1] not in {d for d,_ in analysis.efforts_for(b['sport'])}:continue
        prior=best.get(key);best[key]=min(prior,seconds) if prior is not None else seconds
        if prior is not None and seconds<prior:
            day=r['start_time'].astimezone(zone).date();daily[(*key,day)]=(b,r)
    for b,r in daily.values():
        b['label']=dict(analysis.efforts_for(b['sport']))[float(b['distance_m'])]
        priority=next(n for n,(distance,_) in enumerate(analysis.efforts_for(b['sport'])) if distance==b['distance_m'])
        add(f"best:{b['sport']}:{b['distance_m']:g}:{r['id']}",'best','New '+b['label']+' best',100+priority,r,{'sport':b['sport'],'distance_m':b['distance_m'],'seconds':b['elapsed_s'],'label':b['label']})
    food=c.execute('SELECT day,min(created) AS arrived FROM food_entries WHERE user_id=%s AND day<=%s GROUP BY day ORDER BY day',(uid,today)).fetchall()
    for priority,n in enumerate((7,30,100,365),1):
        if len(food)>=n:
            d=food[n-1];at=dt.datetime.combine(d['day'],dt.time.min,zone)
            add('food:'+str(n),'food_days',f'Logged food on {n} days',25+priority,{'start_time':at,'created':d['arrived']},{'amount':n,'unit':'days'})
    return result,next_check


def process(c,uid,now=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    # Erasure owns the account before personal rows. Never claim a state row before this account lock.
    if not c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE',(uid,)).fetchone():return False
    state=c.execute('SELECT * FROM milestone_state WHERE user_id=%s FOR UPDATE SKIP LOCKED',(uid,)).fetchone()
    if not state:return False
    p=c.execute('SELECT tz,units,notify FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    zone=ZoneInfo(db.valid_tz(p.get('tz')) or db.DEFAULT_TZ);items,next_check=candidates(c,uid,now,zone,p.get('units') or 'imperial')
    # Seen/share timestamps survive invalidation, backfill, edits and retries: offers never resurrect.
    c.execute('UPDATE milestones SET valid=false WHERE user_id=%s AND shared_at IS NULL',(uid,))
    new=[]
    for e in items.values():
        silent=not state['fresh'] or e['occurred']<now-dt.timedelta(days=7) or e['arrival']<state['baseline_at']
        row=c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,activity_id,day,occurred,details,garmin_source,silent)
          VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
          ON CONFLICT(user_id,code) DO UPDATE SET valid=true,activity_id=excluded.activity_id,day=excluded.day,
            occurred=excluded.occurred,details=excluded.details,garmin_source=excluded.garmin_source
          WHERE milestones.shared_at IS NULL
          RETURNING id,(xmax=0) AS inserted''',(uid,e['code'],e['kind'],e['title'],e['rank'],e['activity_id'],e['day'],e['occurred'],json.dumps(e['details']),e['garmin_source'],silent)).fetchone()
        if row and row['inserted'] and not silent:new.append((e['rank'],row['id']))
    day=now.astimezone(zone).date()
    from . import notify
    if new and notify._prefs(p.get('notify'))['milestones'] and state['last_push_day']!=day:
        mid=max(new,key=lambda x:x[0])[1]
        nid=c.execute("INSERT INTO notifications(user_id,actor_id,kind,milestone_id) VALUES(%s,%s,'milestone',%s) RETURNING id",(uid,uid,mid)).fetchone()['id']
        c.execute('UPDATE milestone_state SET last_push_day=%s WHERE user_id=%s',(day,uid))
        threading.Thread(target=notify._push_later,args=(nid,),daemon=True).start()
    c.execute('UPDATE milestone_state SET processed=generation,fresh=false,next_check=%s WHERE user_id=%s',(next_check,uid))
    return True


def start_worker():
    stop=threading.Event()
    def loop():
        while not stop.wait(2):
            try:
                with db.connect() as c:ids=[r['user_id'] for r in c.execute('SELECT user_id FROM milestone_state WHERE generation>processed OR next_check<=now() ORDER BY changed LIMIT 20').fetchall()]
                for uid in ids:
                    if stop.is_set():break
                    with db.connect() as c:process(c,uid)
            except Exception as e:print('milestone worker:',type(e).__name__,flush=True)
    worker=threading.Thread(target=loop,daemon=True);worker.start();return stop,worker


VISIBLE="""m.valid AND NOT m.silent AND m.seen_at IS NULL AND m.occurred>=now()-interval '7 days'
 AND (m.activity_id IS NULL OR EXISTS(SELECT 1 FROM activities a WHERE a.id=m.activity_id AND a.user_id=m.user_id))"""

@router.get('')
def recent(activity_id:int|None=None,day:dt.date|None=None,milestone_id:UUID|None=None,user=Depends(current_user)):
    with db.connect() as c:
        state=c.execute('SELECT generation>processed OR next_check<=now() AS pending FROM milestone_state WHERE user_id=%s',(user['id'],)).fetchone()
        if state and state['pending']:return {'items':[],'pending':True}
        rows=c.execute('''SELECT m.id,m.kind,m.title,m.rank,m.activity_id,m.day,m.occurred,m.details,m.garmin_source,
          coalesce(a.visibility='me',false) AS private_activity FROM milestones m
          LEFT JOIN activities a ON a.id=m.activity_id AND a.user_id=m.user_id
          WHERE m.user_id=%s AND '''+VISIBLE+''' AND (%s::bigint IS NULL OR m.activity_id=%s)
          AND (%s::date IS NULL OR (m.kind='food_days' AND m.day=%s)) AND (%s::uuid IS NULL OR m.id=%s) ORDER BY m.rank DESC,m.occurred DESC LIMIT 100''',(user['id'],activity_id,activity_id,day,day,milestone_id,milestone_id)).fetchall()
    return {'items':rows,'pending':False}

class Seen(BaseModel):
    action:Literal['dismiss','shared']

@router.post('/{mid}/seen')
def seen(mid:UUID,body:Seen,user=Depends(current_user)):
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE',(user['id'],))
        row=c.execute('SELECT id FROM milestones WHERE id=%s AND user_id=%s',(mid,user['id'])).fetchone()
        if not row:raise HTTPException(404,'Not found')
        c.execute('''UPDATE milestones SET seen_at=coalesce(seen_at,now()),
          shared_at=CASE WHEN %s='shared' THEN coalesce(shared_at,now()) ELSE shared_at END WHERE id=%s AND user_id=%s''',(body.action,mid,user['id']))
    return {'ok':True}
