"""Logging habits, not meal/intake advice. One observation per completed local day."""
import datetime as dt
import math
import statistics
from zoneinfo import ZoneInfo
MEALS=('breakfast','lunch','dinner')


def usual_times(rows,tz,now):
    zone=ZoneInfo(tz);today=now.astimezone(zone).date();observations={}
    for row in rows:
        day=row['day'];meal=row['meal'];at=row['created'].astimezone(zone)
        if meal not in MEALS or not today-dt.timedelta(days=28)<=day<today or at.date()!=day:continue
        minute=at.hour*60+at.minute
        if not 7*60<=minute<21*60:continue
        key=(meal,day)
        observations[key]=min(minute,observations.get(key,minute))
    out=[]
    for meal in MEALS:
        minutes=[value for (m,_),value in observations.items() if m==meal]
        suggested=int(math.floor((statistics.median(minutes)+7.5)/15)*15) if len(minutes)>=3 else None
        ready=suggested is not None and 7*60<=suggested<21*60
        out.append({'meal':meal,'days':len(minutes),'minute':suggested if ready else None,
                    'time':f'{suggested//60:02}:{suggested%60:02}' if ready else None,'ready':ready})
    return out


def due_meals(times,logged,tz,now):
    local=now.astimezone(ZoneInfo(tz));minute=local.hour*60+local.minute
    if not 7*60<=minute<21*60:return []
    return [r['meal'] for r in times if r['ready'] and r['meal'] not in logged and 0<=minute-r['minute']<5]
