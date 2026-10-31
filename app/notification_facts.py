"""Optional workout highlights from fixed owner-only queries, once before delivery locks.

No private notes, food, routes, model calls or milestone-worker scans. A generation
fence lets delivery omit a highlight if committed history changes during preparation.
"""
import datetime as dt
import struct
from zoneinfo import ZoneInfo

from . import db, notification_words as words
from .analysis import efforts_for


def local_now(row, now=None):
    return (now or dt.datetime.now(dt.timezone.utc)).astimezone(ZoneInfo(db.valid_tz(row.get('tz')) or db.DEFAULT_TZ))


def real(value):
    return struct.unpack('!f',struct.pack('!f',value))[0]


def signature(row, now=None):
    if not row or row.get('generation') is None:return None
    return tuple(row.get(k) for k in ('user_id','activity_id','activity_owner','generation','updated','start_time','units','tz','sport','distance_m','elapsed_s','moving_s','lift_open'))+(local_now(row,now).date(),)


# Bounds also reject NaN/Infinity. Open or unfinished workouts cannot establish records.
_COMPLETED = """NOT a.lift_open AND a.start_time<=%(now)s
 AND coalesce(a.elapsed_s,a.moving_s,0)>0 AND coalesce(a.elapsed_s,a.moving_s,0)<=172800
 AND a.start_time+make_interval(secs=>coalesce(a.elapsed_s,a.moving_s,0))<=%(now)s+interval '1 minute'"""
_DISTANCE = "a.distance_m>=0 AND a.distance_m<'Infinity'::float8"


def read(c,row,now=None):
    """Return facts, not prose. Callers must recheck the signature after these reads.

    These describe committed records at preparation time, not an import-complete
    signal. Strength history is omitted: exercise/set-only edits lack this fence.
    """
    if row.get('kind')!='activity_ready' or row.get('activity_owner')!=row.get('user_id') or row.get('lift_open') or signature(row,now) is None:return None
    start=row.get('start_time');now=now or dt.datetime.now(dt.timezone.utc)
    seconds=words.number(row.get('elapsed_s') if row.get('elapsed_s') is not None else row.get('moving_s'))
    if not start or not seconds or seconds>172800 or start>now or start<now-dt.timedelta(days=1) or start+dt.timedelta(seconds=seconds)>now+dt.timedelta(minutes=1):return None
    if row.get('sport') not in ('run','ride','walk','hike','swim','row','ski'):return None
    local=local_now(row,now);at=start.astimezone(local.tzinfo)
    midnight=lambda day:dt.datetime.combine(day,dt.time(),local.tzinfo)
    year=midnight(at.date().replace(month=1,day=1));year_end=year.replace(year=year.year+1)
    month=midnight(at.date().replace(day=1));month_end=month.replace(year=month.year+1,month=1) if month.month==12 else month.replace(month=month.month+1)
    week=midnight(at.date()-dt.timedelta(days=at.weekday()));day=midnight(at.date())
    p={'uid':row['user_id'],'aid':row['activity_id'],'sport':row['sport'],'start':start,'now':now,
       'year':year,'year_end':year_end,'month':month,'month_end':month_end,'week':week,'day':day}
    prefix='(a.start_time,a.id)<(%(start)s,%(aid)s)'
    # One aggregate over this owner's completed history; no per-device rescans.
    stats=c.execute(f"""SELECT
      count(*) FILTER(WHERE a.sport=%(sport)s AND {prefix}) AS prior_count,
      max(a.start_time) FILTER(WHERE a.sport=%(sport)s AND {prefix}) AS previous,
      count(*) FILTER(WHERE a.sport=%(sport)s AND {prefix} AND a.start_time>=%(day)s) AS earlier_today,
      count(*) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(year)s AND a.start_time<%(year_end)s) AS year_count,
      count(*) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(year)s AND a.start_time<%(year_end)s AND coalesce(({_DISTANCE}),false)=false) AS year_missing,
      max(a.distance_m::double precision) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(year)s AND a.start_time<%(year_end)s AND {_DISTANCE}) AS year_max,
      count(*) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(month)s AND a.start_time<%(month_end)s) AS month_count,
      count(*) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(month)s AND a.start_time<%(month_end)s AND coalesce(({_DISTANCE}),false)=false) AS month_missing,
      max(a.distance_m::double precision) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(month)s AND a.start_time<%(month_end)s AND {_DISTANCE}) AS month_max,
      count(*) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(week)s AND {prefix}) AS week_count,
      count(*) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(week)s AND {prefix} AND {_DISTANCE}) AS week_known,
      coalesce(sum(a.distance_m::double precision) FILTER(WHERE a.sport=%(sport)s AND a.start_time>=%(week)s AND {prefix} AND {_DISTANCE}),0) AS week_distance,
      count(*) FILTER(WHERE a.start_time>=%(year)s AND {prefix} AND coalesce(({_DISTANCE}),false)=false) AS year_unknown,
      coalesce(sum(a.distance_m::double precision) FILTER(WHERE a.start_time>=%(year)s AND {prefix} AND {_DISTANCE}),0) AS year_distance
      FROM activities a WHERE a.user_id=%(uid)s AND a.id<>%(aid)s AND {_COMPLETED}""",p).fetchone()
    facts={'user_id':row['user_id'],'activity_id':row['activity_id'],'bests':[],'longest':{},'milestones':[]}
    for period in ('year','month'):
        facts['longest'][period]={'count':stats[period+'_count'],'unknown':stats[period+'_missing'],'previous_m':stats[period+'_max'],
          'current':at.year==local.year and (period=='year' or at.month==local.month),'label':str(at.year) if period=='year' else at.strftime('%B %Y')}
    # The shipped column is PostgreSQL real (float32), including fractional miles.
    labels={real(metres):label for metres,label in efforts_for(row['sport'])}
    efforts=c.execute(f"""SELECT b.distance_m, min(b.elapsed_s::double precision) FILTER(WHERE b.activity_id=%(aid)s) AS seconds,
          min(b.elapsed_s::double precision) FILTER(WHERE b.activity_id<>%(aid)s) AS previous
          FROM best_efforts b JOIN activities a ON a.id=b.activity_id AND a.user_id=b.user_id
          WHERE b.user_id=%(uid)s AND b.sport=%(sport)s AND a.sport=%(sport)s AND b.distance_m=ANY(%(distances)s::real[])
          AND b.elapsed_s>0 AND b.elapsed_s<'Infinity'::float8 AND {_COMPLETED} GROUP BY b.distance_m""",{**p,'distances':list(labels)}).fetchall() if labels else []
    for effort in efforts:
        label=labels.get(real(effort['distance_m']))
        if label and effort['seconds'] and effort['previous']:facts['bests'].append({'label':label,**effort})
    count=stats['prior_count']+1
    if count in (100,250,500,1000):facts['milestones'].append({'kind':'sport_count','amount':count})
    known_metres=words.number(row.get('distance_m'));metres=known_metres or 0
    divisor,unit=(1000,'km') if row.get('units')=='metric' else (1609.344,'mi')
    before=stats['year_distance']/divisor;after=before+metres/divisor
    crossed=[n for n in (100,250,500,1000,2000) if before<n<=after]
    if crossed and not stats['year_unknown'] and known_metres is not None:facts['milestones'].append({'kind':'year_distance','amount':max(crossed),'unit':unit,'year':at.year})
    if week.date()==local.date()-dt.timedelta(days=local.weekday()):
        facts['weekly']={'count':stats['week_count']+1,'distance_m':stats['week_distance']+metres if stats['week_known']==stats['week_count'] and known_metres is not None else None}
    if stats['previous']:facts['break_days']=(at.date()-stats['previous'].astimezone(local.tzinfo).date()).days
    facts['first_today']=stats['earlier_today']==0
    return facts
