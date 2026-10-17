"""Logging-habit timing: no advice, provider, database or device."""
import datetime as dt,sys
from pathlib import Path
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from app.meal_reminder_times import usual_times,due_meals
now=dt.datetime(2026,10,17,12,16,tzinfo=dt.timezone.utc);rows=[]
for ago in (1,2,3):
 day=now.date()-dt.timedelta(days=ago)
 for _ in range(10):rows.append({'day':day,'meal':'lunch','created':dt.datetime.combine(day,dt.time(12,13),dt.timezone.utc)})
result=usual_times(rows,'UTC',now);lunch=next(r for r in result if r['meal']=='lunch');assert lunch['days']==3 and lunch['time']=='12:15'
assert due_meals(result,set(),'UTC',now)==['lunch'];assert due_meals(result,{'lunch'},'UTC',now)==[]
assert due_meals(result,set(),'UTC',now+dt.timedelta(minutes=5))==[]
assert not any(r['ready'] for r in usual_times(rows[:20],'UTC',now)) # many foods on2days is not3days
late=[dict(r,created=now) for r in rows];assert not any(r['ready'] for r in usual_times(late,'UTC',now))
night=[dict(r,created=r['created'].replace(hour=2)) for r in rows];assert not any(r['ready'] for r in usual_times(night,'UTC',now))
assert not due_meals(result,set(),'America/New_York',now) # same instant is breakfast time
print('Reminder time rules: one observation/day,3-day threshold, median/15min, local-date/import guards, daytime quiet hours, already-logged/no-late catchup PASS')
