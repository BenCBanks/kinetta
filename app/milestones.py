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
from . import db,recaps,analysis,achievement_tracks as tracks
from .auth import current_user

router=APIRouter(prefix='/api/milestones')
FIRST_DISTANCES=((5000,'5K'),(10000,'10K'),(21097.5,'half marathon'),(42195,'marathon'))
SPORTS={'run':'run','ride':'ride','walk':'walk','hike':'hike','swim':'swim','row':'rowing workout','ski':'ski workout','workout':'workout','other':'activity'}
IDLE_CHECK=dt.datetime(9999,1,1,tzinfo=dt.timezone.utc)
# A history import can contain many more earned tiers than a normal workout.
# Keep each transaction bounded; the worker leaves the account pending and picks
# up the next batch on its next pass.
TRACK_BATCH_SIZE=100


def _legacy_first_activity_sport(details):
    sport=details.get('sport')
    code='sport:walk-hike' if sport in ('walk','hike') else f'sport:{sport}'
    return code in tracks.LEGACY_FIRST_ACTIVITY_LABELS and details.get('target_m') is None


def candidates(c,uid,now,zone,units):
    """One background pass, coalesced across a batch of imports/edits. Only fixed facts leave this helper."""
    rows=c.execute('''SELECT id,sport,start_time,created,updated,distance_m,moving_s,elapsed_s,source,device
      FROM activities WHERE user_id=%s AND NOT lift_open ORDER BY start_time,id''',(uid,)).fetchall()
    today=now.astimezone(zone).date();next_check=IDLE_CHECK
    result={};eligible=[]
    def add(code,kind,title,rank,row,details):
        credit=recaps.garmin_source(row.get('source'),row.get('device'))
        details.setdefault('garmin_sources',[credit] if credit else [])
        details.setdefault('label',title)
        # Part C's feed uses the existing First rows as sport-track history.
        details.setdefault('big',kind in ('sport','first_distance'))
        if kind=='sport':
            sport=details.get('sport')
            track_code='sport:walk-hike' if sport in ('walk','hike') else f'sport:{sport}'
            if track_code in tracks.LEGACY_FIRST_ACTIVITY_LABELS:
                details['quiet']=True
                details['trigger']='first_activity'
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
    future=c.execute('SELECT min(day) AS day FROM food_entries WHERE user_id=%s AND day>%s',(uid,today)).fetchone()['day']
    if future:next_check=min(next_check,dt.datetime.combine(future,dt.time.min,zone))
    for priority,n in enumerate((7,30,100,365),1):
        if len(food)>=n:
            d=food[n-1];at=dt.datetime.combine(d['day'],dt.time.min,zone)
            add('food:'+str(n),'food_days',f'Logged food on {n} days',25+priority,{'start_time':at,'created':d['arrived']},{'amount':n,'unit':'days'})
    return result,next_check


def _number(row, key):
    """A finite, non-negative numeric activity field."""
    try:
        value = float(row.get(key) or 0)
    except (TypeError, ValueError):
        return 0.0
    return value if math.isfinite(value) and value >= 0 else 0.0


def _completed_activity_rows(c, uid, now):
    """Read the worker's completed activity facts in chronological order."""
    rows=c.execute('''SELECT id,sport,start_time,created,updated,distance_m,moving_s,elapsed_s,ascent_m,
                              source,device,lift_open
                       FROM activities WHERE user_id=%s AND NOT lift_open
                       ORDER BY start_time,id''',(uid,)).fetchall()
    out=[]
    for row in rows:
        if row['start_time']>now:
            continue
        duration=_number(row,'elapsed_s') or _number(row,'moving_s')
        if row['start_time']+dt.timedelta(seconds=duration)>now+dt.timedelta(minutes=1):
            continue
        out.append(row)
    return out


def _local_day(row, zone):
    return row['start_time'].astimezone(zone).date()


def _arrival(row, now):
    return row.get('updated') or row.get('created') or now


def _crossings(code, rows, amount, zone):
    """Return total and the first activity that crossed every reached tier."""
    total=0.0; seen=set(); crossing={}
    for row in rows:
        before=total; total+=max(0.0,float(amount(row)))
        for tier in tracks.tiers_for(code,total):
            if tier.threshold not in seen and tier.threshold>before:
                seen.add(tier.threshold);crossing[tier.threshold]=row
    return total,crossing


def _max_crossings(code, rows, amount, zone):
    """Return the maximum single-row value and the first row crossing tiers."""
    maximum=0.0;seen=set();crossing={}
    for row in rows:
        maximum=max(maximum,max(0.0,float(amount(row) or 0)))
        for tier in tracks.tiers_for(code,maximum):
            if tier.threshold not in seen:
                seen.add(tier.threshold);crossing[tier.threshold]=row
    return maximum,crossing


def _weeks_facts(rows, zone):
    """Best active-week run and the activity that reached each level."""
    by_week={}
    for row in rows:
        week=_local_day(row,zone)-dt.timedelta(days=_local_day(row,zone).weekday())
        by_week.setdefault(week,row)
    best=0;streak=0;previous=None;crossing={}
    for week in sorted(by_week):
        streak=streak+1 if previous is not None and week-previous==dt.timedelta(days=7) else 1
        previous=week
        if streak>best:
            before=best;best=streak
            for tier in tracks.tiers_for('consistency',best):
                if tier.threshold not in crossing and tier.threshold>before:
                    crossing[tier.threshold]=by_week[week]
    return float(best),crossing


def _full_years(start, now, zone):
    a=start.astimezone(zone);b=now.astimezone(zone)
    years=b.year-a.year-((b.month,b.day,b.hour,b.minute,b.second,b.microsecond)<(a.month,a.day,a.hour,a.minute,a.second,a.microsecond))
    return max(0,years)


def _anniversary(start, years, zone):
    local=start.astimezone(zone)
    try:
        return local.replace(year=local.year+years)
    except ValueError:  # 29 February: celebrate on 28 February in non-leap years.
        return local.replace(year=local.year+years,day=28)


def _personal_best_events(c, uid, rows_by_id):
    rows=c.execute('''SELECT b.id,b.activity_id,b.sport,b.distance_m,b.elapsed_s,b.start_time,
                             a.created,a.updated,a.source,a.device
                      FROM best_efforts b JOIN activities a ON a.id=b.activity_id AND a.user_id=b.user_id
                      WHERE b.user_id=%s ORDER BY b.start_time,b.id''',(uid,)).fetchall()
    best={};events=[];seen_activity=set()
    for row in rows:
        if row['activity_id'] not in rows_by_id:
            continue
        distance=_number(row,'distance_m');seconds=_number(row,'elapsed_s')
        if distance<=0 or seconds<=0:
            continue
        key=(row['sport'],round(distance,6))
        # Several standard efforts can be generated for one activity.  The
        # fastest one for a distance is that activity's single PR event.
        event_key=(row['activity_id'],key)
        prior=best.get(key)
        if event_key in seen_activity:
            if prior is not None and seconds<prior:
                best[key]=seconds
            continue
        seen_activity.add(event_key)
        if prior is None or seconds<prior:
            best[key]=seconds;events.append(row)
    return events


def _fastest_effort_facts(c, uid, rows_by_id):
    """Return Run fastest-ladder count and source activity for each level.

    Only persisted best-effort rows with their recorded distance and elapsed
    time qualify. There is deliberately no prediction between distances.
    """
    criteria = tracks.fastest_effort_spec('sport:run:fastest') or ()
    if not criteria:
        return 0, {}
    best = {}
    for row in c.execute('''SELECT activity_id,sport,distance_m,elapsed_s
                            FROM best_efforts
                            WHERE user_id=%s AND sport='run'
                            ORDER BY activity_id,id''', (uid,)).fetchall():
        activity = rows_by_id.get(row.get('activity_id'))
        if not activity:
            continue
        distance = _number(row, 'distance_m')
        elapsed = _number(row, 'elapsed_s')
        if distance <= 0 or elapsed <= 0:
            continue
        criterion = next((item for item in criteria if math.isclose(
            distance, item[1], rel_tol=0, abs_tol=0.5)), None)
        if not criterion:
            continue
        prior = best.get(criterion[1])
        if prior is None or elapsed < prior[0]:
            best[criterion[1]] = (elapsed, activity)
    found = {}
    for rank, (_name, distance, max_seconds) in enumerate(criteria, 1):
        candidate = best.get(distance)
        if candidate and candidate[0] <= max_seconds:
            found[float(rank)] = candidate[1]
    return len(found), found


def _tier_item(code,tier,row,zone,now,*,occurred=None,day=None):
    occurred=occurred or row['start_time']
    day=day or occurred.astimezone(zone).date()
    details={'track':code,'rank':tier.rank,'threshold':tier.threshold,'label':tier.label,'unit':tier.unit,
             'big':bool(tier.big),'quiet':tracks.is_quiet_level(code,tier.rank)}
    trigger=tracks.level_trigger(code,tier.rank)
    if trigger:details['trigger']=trigger
    if tier.unit=='m':details['value_m']=tier.threshold
    elif tier.unit=='kg':details['value_kg']=tier.threshold
    elif tier.unit=='seconds':details['value_s']=tier.threshold
    elif tier.unit=='weeks':details['value_weeks']=tier.threshold
    elif tier.unit=='years':details['value_years']=tier.threshold
    elif tier.unit=='sessions':details['value_sessions']=tier.threshold
    return {'code':f'trackt:{code}:{float(tier.threshold)!r}','kind':'track','title':tier.label,'rank':1000+tier.rank,
            'activity_id':row.get('id') if row else None,'day':day,'occurred':occurred,
            'arrival':_arrival(row,now) if row else now,'details':details,
            'garmin_source':recaps.garmin_source(row.get('source'),row.get('device')) if row else None}


def _state_item(code,value,tiers,first_row,zone,now):
    nxt=tracks.next_tier(code,value)
    details={'track':code,'label':tracks.track_label(code),'value':value,'unit':tracks.TRACK_UNITS.get(code,'count'),
             'level':max((tier.rank for tier in tiers),default=0),'big':False}
    if code in ('journey','climbing','sport:run','sport:ride','sport:walk-hike','sport:swim') or (tracks.sport_phase1_spec(code) and tracks.sport_phase1_spec(code)[1] == 'longest'):
        details['value_m']=value
    elif code=='lifted':details['value_kg']=value
    elif code=='active_time':details['value_s']=value
    if nxt:
        details['next_threshold']=nxt.threshold;details['next_label']=nxt.label;details['next_unit']=nxt.unit
    return {'code':f'track-state:{code}','kind':'track_state','title':tracks.track_label(code),'rank':0,
            'activity_id':None,'day':_local_day(first_row,zone),'occurred':first_row['start_time'],
            'arrival':now,'details':details,'garmin_source':None}


def _preserve_track_progress(c,uid,states):
    """Keep computed lifetime highs when an activity is later edited or deleted."""
    if not states:return
    previous={}
    for row in c.execute('''SELECT details,day,occurred FROM milestones
                            WHERE user_id=%s AND kind='track_state' AND valid''',(uid,)).fetchall():
        details=row.get('details') or {}
        code=details.get('track')
        if code:previous[code]={'details':details,'day':row.get('day'),'occurred':row.get('occurred')}
    for state in states:
        details=state['details'];code=details['track'];old=previous.get(code)
        if not old:continue
        old_details=old['details']
        try:old_value=float(old_details.get('value',0) or 0)
        except (TypeError,ValueError):old_value=0.0
        try:value=float(details.get('value',0) or 0)
        except (TypeError,ValueError):value=0.0
        if old_value>value:
            value=old_value;details['value']=value
            field={'journey':'value_m','climbing':'value_m','lifted':'value_kg','active_time':'value_s',
                   'sport:run':'value_m','sport:ride':'value_m','sport:walk-hike':'value_m','sport:swim':'value_m',
                   'consistency':'value_weeks','years_active':'value_years',
                   'sport:lift':'value_sessions'}.get(code)
            if not field and tracks.sport_phase1_spec(code):
                field = 'value_m' if tracks.sport_phase1_spec(code)[1] == 'longest' else 'value'
            if field:details[field]=value
            state['day']=old['day'];state['occurred']=old['occurred']
            nxt=tracks.next_tier(code,value)
            if nxt:
                details['next_threshold']=nxt.threshold;details['next_label']=nxt.label;details['next_unit']=nxt.unit
        details['level']=max((tier.rank for tier in tracks.tiers_for(code,value)),default=0)


def achievement_candidates(c,uid,now,zone):
    """Compute track state and tier rows.  Called only by the background worker."""
    rows=_completed_activity_rows(c,uid,now)
    if not rows:return [],[],False
    by_id={r['id']:r for r in rows}
    states=[];tiers=[]
    def add(code,value,crossing,started=True):
        if not started:return
        reached=tracks.tiers_for(code,value)
        states.append(_state_item(code,value,reached,rows[0],zone,now))
        for tier in reached:
            # Sport First rows are already durable catalog rows, including
            # distance-free indoor sessions. Count-based First tiers still
            # need their own threshold-keyed track row.
            if code.startswith('sport:') and tracks.level_trigger(code,tier.rank)=='first_activity':
                continue
            row=crossing.get(tier.threshold) or rows[-1]
            tiers.append(_tier_item(code,tier,row,zone,now))

    weeks,crossing=_weeks_facts(rows,zone);add('consistency',weeks,crossing)
    years=_full_years(rows[0]['start_time'],now,zone)
    year_crossing={}
    for n in range(1,years+1):
        anniversary=_anniversary(rows[0]['start_time'],n,zone)
        row=next((r for r in rows if r['start_time'].astimezone(zone)>=anniversary),rows[0])
        year_crossing[float(n)]=(row,anniversary)
    reached=tracks.tiers_for('years_active',years);states.append(_state_item('years_active',years,reached,rows[0],zone,now))
    for tier in reached:
        row,anniversary=year_crossing[tier.threshold]
        tiers.append(_tier_item('years_active',tier,row,zone,now,occurred=anniversary,day=anniversary.date()))

    total,crossing=_crossings('workouts',rows,lambda _r:1,zone);add('workouts',total,crossing)
    total,crossing=_crossings('active_time',rows,lambda r:_number(r,'moving_s') or _number(r,'elapsed_s'),zone);add('active_time',total,crossing)
    total,crossing=_crossings('journey',rows,lambda r:_number(r,'distance_m'),zone);add('journey',total,crossing,total>0)
    total,crossing=_crossings('climbing',rows,lambda r:_number(r,'ascent_m'),zone);add('climbing',total,crossing,total>0)

    lift_rows=c.execute('''SELECT a.id,coalesce(sum(CASE WHEN s.done AND NOT s.warmup
                   THEN coalesce(s.kg,0)*coalesce(s.reps,0) ELSE 0 END),0) AS volume_kg
                 FROM activities a LEFT JOIN lift_sets s ON s.activity_id=a.id AND s.user_id=a.user_id
                 WHERE a.user_id=%s AND NOT a.lift_open AND a.start_time<=%s
                 GROUP BY a.id''',(uid,now)).fetchall()
    volume={r['id']:_number(r,'volume_kg') for r in lift_rows}
    total,crossing=_crossings('lifted',[r for r in rows if volume.get(r['id'],0)>0],lambda r:volume.get(r['id'],0),zone)
    add('lifted',total,crossing,total>0)

    sport_rows={
        'run':[r for r in rows if r['sport']=='run'],
        'ride':[r for r in rows if r['sport']=='ride'],
        'walk-hike':[r for r in rows if r['sport'] in ('walk','hike')],
        'swim':[r for r in rows if r['sport']=='swim'],
        'lift':[r for r in rows if r['sport']=='workout' or volume.get(r['id'],0)>0],
    }
    for sport,subset in sport_rows.items():
        code='sport:'+sport
        amount=(lambda _r:1) if sport=='lift' else (lambda r:_number(r,'distance_m'))
        total,crossing=_crossings(code,subset,amount,zone);add(code,total,crossing,bool(subset))
        if sport in tracks.SPORT_TRACK_LABELS:
            count_code=f'sport:{sport}:workouts'
            count,crossing=_crossings(count_code,subset,lambda _r:1,zone)
            add(count_code,count,crossing,bool(subset))
            longest_code=f'sport:{sport}:longest'
            longest,crossing=_max_crossings(longest_code,subset,lambda r:_number(r,'distance_m'),zone)
            add(longest_code,longest,crossing,longest>0)

    fastest_count,fastest_crossing=_fastest_effort_facts(c,uid,by_id)
    add('sport:run:fastest',fastest_count,fastest_crossing,fastest_count>0)

    events=_personal_best_events(c,uid,by_id)
    if events:
        pb_crossing={}
        for n,event in enumerate(events,1):pb_crossing[float(n)]=event
        reached=tracks.tiers_for('personal_bests',len(events));states.append(_state_item('personal_bests',len(events),reached,rows[0],zone,now))
        for tier in reached:tiers.append(_tier_item('personal_bests',tier,pb_crossing.get(tier.threshold) or rows[-1],zone,now))
    _preserve_track_progress(c,uid,states)
    return states,tiers,True


def process(c,uid,now=None,*,push_ids=None):
    now=now or dt.datetime.now(dt.timezone.utc)
    # Erasure owns the account before personal rows. Never claim a state row before this account lock.
    if not c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE',(uid,)).fetchone():return False
    # Serialize workers without holding the row that activity/food dirty triggers need.
    if not c.execute("SELECT pg_try_advisory_xact_lock(hashtextextended('kinetta-milestones:'||%s::text,0)) AS claimed",(uid,)).fetchone()['claimed']:return False
    state=c.execute('SELECT * FROM milestone_state WHERE user_id=%s',(uid,)).fetchone()
    if not state:return False
    p=c.execute('SELECT tz,units,notify FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    zone=ZoneInfo(db.valid_tz(p.get('tz')) or db.DEFAULT_TZ);items,next_check=candidates(c,uid,now,zone,p.get('units') or 'imperial')
    track_states,track_tiers,track_started=achievement_candidates(c,uid,now,zone)
    latest=c.execute('SELECT generation FROM milestone_state WHERE user_id=%s FOR UPDATE SKIP LOCKED',(uid,)).fetchone()
    # A concurrent save stays dirty. Discard this scan rather than publish partial history.
    if not latest or latest['generation']!=state['generation']:return False
    # Seen/share timestamps survive invalidation, backfill, edits and retries: offers never resurrect.
    # Track tiers are durable history: an edit can hide an unshared offer from
    # the old milestone UI, but it must never revoke an earned tier.
    c.execute("""UPDATE milestones SET valid=false WHERE user_id=%s AND shared_at IS NULL
                 AND kind NOT IN ('track','track_state')
                 AND NOT (kind='sport' AND details->>'sport' IN ('run','ride','walk','hike','swim')
                          AND details->>'target_m' IS NULL)""",(uid,))
    existing_track_thresholds=set()
    for saved in c.execute("SELECT details FROM milestones WHERE user_id=%s AND kind='track'",(uid,)).fetchall():
        details=saved.get('details') or {}
        try:threshold=float(details.get('threshold'))
        except (TypeError,ValueError):continue
        track=details.get('track')
        if track and math.isfinite(threshold):existing_track_thresholds.add((track,threshold))
    existing_state_values={}
    for saved in c.execute("SELECT details FROM milestones WHERE user_id=%s AND kind='track_state' AND valid",(uid,)).fetchall():
        details=saved.get('details') or {};track=details.get('track')
        if not track:continue
        try:value=float(details.get('value',0) or 0)
        except (TypeError,ValueError):continue
        if math.isfinite(value):existing_state_values[track]=value
    missing_tracks=[]
    for item in track_tiers:
        details=item.get('details') or {}
        try:key=(details.get('track'),float(details.get('threshold')))
        except (TypeError,ValueError):continue
        if key not in existing_track_thresholds:missing_tracks.append(item)
    missing_tracks.sort(key=lambda r:(r['rank'],r['code']))
    track_pending=len(missing_tracks)>TRACK_BATCH_SIZE
    track_tiers=missing_tracks[:TRACK_BATCH_SIZE] if track_pending else missing_tracks
    all_items=list(items.values())+track_states+track_tiers
    new=[]

    def quiet_backfill(item):
        details=item.get('details') or {}
        if not details.get('quiet'):return False
        if item.get('kind')=='track':
            code=details.get('track')
            try:threshold=float(details.get('threshold'))
            except (TypeError,ValueError):return False
            previous=existing_state_values.get(code)
            if previous is not None and previous>=threshold:return True
            return any(saved_code==code and saved_threshold>threshold
                       for saved_code,saved_threshold in existing_track_thresholds)
        if item.get('kind')=='sport' and details.get('trigger')=='first_activity':
            sport=details.get('sport')
            code='sport:walk-hike' if sport in ('walk','hike') else f'sport:{sport}'
            return code in existing_state_values or any(saved_code==code for saved_code,_ in existing_track_thresholds)
        return False

    for e in all_items:
        if e['kind']=='track_state':
            # State rows are worker output, not notification offers.  Keeping
            # them in the existing milestones table avoids a request-time
            # history scan and keeps account deletion/RLS behaviour unchanged.
            c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,activity_id,day,occurred,details,garmin_source,silent)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,true)
              ON CONFLICT(user_id,code) DO UPDATE SET title=excluded.title,rank=excluded.rank,
                day=excluded.day,occurred=excluded.occurred,details=excluded.details,valid=true
              WHERE milestones.kind='track_state' AND milestones.shared_at IS NULL''',
              (uid,e['code'],e['kind'],e['title'],e['rank'],e['activity_id'],e['day'],e['occurred'],json.dumps(e['details']),e['garmin_source']))
            continue
        if e['kind']=='track':
            # A tier is immutable once it exists.  In particular, a corrected
            # or deleted source activity never creates a second copy.
            silent=not state['fresh'] or e['occurred']<now-dt.timedelta(days=7) or e['arrival']<state['baseline_at']
            silent=silent or quiet_backfill(e)
            row=c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,activity_id,day,occurred,details,garmin_source,silent)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT(user_id,code) DO NOTHING RETURNING id,(xmax=0) AS inserted''',
              (uid,e['code'],e['kind'],e['title'],e['rank'],e['activity_id'],e['day'],e['occurred'],json.dumps(e['details']),e['garmin_source'],
               silent)).fetchone()
            if row and row['inserted'] and not silent and not e['details'].get('quiet'):
                new.append((e['rank'],row['id']))
            continue
        silent=not state['fresh'] or e['occurred']<now-dt.timedelta(days=7) or e['arrival']<state['baseline_at']
        silent=silent or quiet_backfill(e)
        if e['kind']=='sport' and _legacy_first_activity_sport(e.get('details') or {}):
            row=c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,activity_id,day,occurred,details,garmin_source,silent)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT(user_id,code) DO UPDATE SET valid=true
              RETURNING id,(xmax=0) AS inserted''',
              (uid,e['code'],e['kind'],e['title'],e['rank'],e['activity_id'],e['day'],e['occurred'],json.dumps(e['details']),e['garmin_source'],silent)).fetchone()
        else:
            row=c.execute('''INSERT INTO milestones(user_id,code,kind,title,rank,activity_id,day,occurred,details,garmin_source,silent)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT(user_id,code) DO UPDATE SET valid=true,activity_id=excluded.activity_id,day=excluded.day,
                occurred=excluded.occurred,details=excluded.details,garmin_source=excluded.garmin_source
              WHERE milestones.shared_at IS NULL
              RETURNING id,(xmax=0) AS inserted''',
              (uid,e['code'],e['kind'],e['title'],e['rank'],e['activity_id'],e['day'],e['occurred'],json.dumps(e['details']),e['garmin_source'],silent)).fetchone()
        if row and row['inserted'] and not silent and not e['details'].get('quiet'):
            new.append((e['rank'],row['id']))
    day=now.astimezone(zone).date()
    from . import notify
    if new and notify._prefs(p.get('notify'))['milestones'] and state['last_push_day']!=day:
        mid=max(new,key=lambda x:x[0])[1]
        nid=c.execute("INSERT INTO notifications(user_id,actor_id,kind,milestone_id) VALUES(%s,%s,'milestone',%s) RETURNING id",(uid,uid,mid)).fetchone()['id']
        c.execute('UPDATE milestone_state SET last_push_day=%s WHERE user_id=%s',(day,uid))
        if push_ids is not None:push_ids.append(nid)
    if track_pending:
        # Leave one generation pending so the worker drains the next batch.
        processed=max(0,min(state['generation']-1,state['processed']))
        next_check=min(next_check,now+dt.timedelta(seconds=1))
        fresh=state['fresh']
    else:
        processed=state['generation'];fresh=False
    c.execute('UPDATE milestone_state SET processed=%s,fresh=%s,next_check=%s WHERE user_id=%s',(processed,fresh,next_check,uid))
    return True


def process_committed(uid,now=None):
    from . import notify
    push_ids=[]
    with db.connect() as c:result=process(c,uid,now,push_ids=push_ids)
    # Dispatch only after the transaction succeeds, however long its scan took.
    for nid in push_ids:threading.Thread(target=notify._push_later,args=(nid,),daemon=True).start()
    return result


def start_worker():
    stop=threading.Event()
    def loop():
        while not stop.wait(2):
            try:
                with db.connect() as c:ids=[r['user_id'] for r in c.execute('SELECT user_id FROM milestone_state WHERE generation>processed OR next_check<=now() ORDER BY changed LIMIT 20').fetchall()]
                for uid in ids:
                    if stop.is_set():break
                    process_committed(uid)
            except Exception as e:print('milestone worker:',type(e).__name__,flush=True)
    worker=threading.Thread(target=loop,daemon=True);worker.start();return stop,worker


VISIBLE="""m.valid AND m.kind<>'track' AND m.kind<>'track_state' AND NOT m.silent AND m.seen_at IS NULL AND m.occurred>=now()-interval '7 days'
 AND (m.activity_id IS NULL OR EXISTS(SELECT 1 FROM activities a WHERE a.id=m.activity_id AND a.user_id=m.user_id))"""

class Celebrate(BaseModel):
    activity_id:int

@router.post('/celebrate')
def celebrate(body:Celebrate,user=Depends(current_user)):
    if body.activity_id<=0:raise HTTPException(400,'Activity not found')
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR KEY SHARE',(user['id'],))
        state=c.execute('''SELECT generation>processed OR next_check<=now() AS pending
                           FROM milestone_state WHERE user_id=%s''',(user['id'],)).fetchone()
        if state and state['pending']:return {'items':[],'pending':True}
        rows=c.execute('''UPDATE milestones AS m
          SET details=(m.details-'_celebrated_at')||jsonb_build_object('_celebrated_at',now())
          WHERE m.user_id=%s AND m.activity_id=%s AND m.kind IN ('best','track','sport','first_distance')
            AND m.valid AND NOT m.silent AND m.seen_at IS NULL
            AND m.occurred>=now()-interval '48 hours'
            AND m.details->>'_celebrated_at' IS NULL
            AND EXISTS(SELECT 1 FROM activities a WHERE a.id=m.activity_id AND a.user_id=m.user_id
                       AND NOT a.lift_open AND a.created>=now()-interval '48 hours')
          RETURNING m.code,m.kind,m.title,m.rank,m.details-'_celebrated_at' AS details''',
          (user['id'],body.activity_id)).fetchall()
    rows.sort(key=lambda row:(row['rank'],row['title']),reverse=True)
    return {'items':rows,'pending':False}

@router.get('')
def recent(activity_id:int|None=None,day:dt.date|None=None,milestone_id:UUID|None=None,user=Depends(current_user)):
    with db.connect() as c:
        state=c.execute('SELECT generation>processed OR next_check<=now() AS pending FROM milestone_state WHERE user_id=%s',(user['id'],)).fetchone()
        if state and state['pending']:return {'items':[],'pending':True}
        rows=c.execute('''SELECT m.id,m.kind,m.title,m.rank,m.activity_id,m.day,m.occurred,m.details-'_celebrated_at' AS details,m.garmin_source,
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
