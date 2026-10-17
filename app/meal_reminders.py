"""Optional private APNs logging reminders. No bell/feed rows, AI, or intake judgments."""
import datetime as dt
import threading
import time
from zoneinfo import ZoneInfo
from fastapi import APIRouter,Depends,HTTPException
from pydantic import BaseModel,StrictBool
from . import apns,db,notify
from .auth import current_user,SESSION_DAYS
from .meal_reminder_times import usual_times,due_meals
router=APIRouter(prefix='/api/food/reminders')

class Preference(BaseModel):
    model_config={'extra':'forbid'}
    enabled:StrictBool
    confirmed:StrictBool=False


def devices(c,uid):
    return c.execute(f'''SELECT 1 FROM native_push_devices d JOIN sessions s ON s.token_hash=d.session_hash
      WHERE d.user_id=%s AND s.user_id=d.user_id AND s.last_seen>now()-interval '{SESSION_DAYS} days' LIMIT 1''',(uid,)).fetchone() is not None


def times(c,uid,tz,now):
    today=now.astimezone(ZoneInfo(tz)).date()
    rows=c.execute('''SELECT day,meal,min(created) AS created FROM food_entries WHERE user_id=%s AND day>=%s AND day<%s
      AND day=(created AT TIME ZONE %s)::date AND extract(hour FROM created AT TIME ZONE %s)>=7
      AND extract(hour FROM created AT TIME ZONE %s)<21 GROUP BY day,meal''',(uid,today-dt.timedelta(days=28),today,tz,tz,tz)).fetchall()
    return usual_times(rows,tz,now)


def status_data(c,uid):
    p=c.execute('SELECT tz,food_reminders FROM profile WHERE user_id=%s',(uid,)).fetchone()
    if not p:raise HTTPException(404,'Profile not found')
    tz=p['tz'] or db.DEFAULT_TZ
    return {'enabled':p['food_reminders'],'push_ready':apns.ready(),'device_ready':devices(c,uid),
        'times':times(c,uid,tz,dt.datetime.now(dt.timezone.utc)), 'tz':tz,
        'note':'Around your usual logging times, 7 am–9 pm only. Already logged meals stay quiet. No streaks or calorie reminders.'}


@router.get('')
def status(user=Depends(current_user)):
    with db.connect() as c:return status_data(c,user['id'])


@router.put('')
def preference(body:Preference,user=Depends(current_user)):
    if body.enabled and not body.confirmed:raise HTTPException(400,'Choose meal-time reminders explicitly before enabling them')
    with db.connect() as c:
        if body.enabled and (not apns.ready() or not devices(c,user['id'])):raise HTTPException(409,'Turn on iPhone notifications after the server notification setup is complete')
        c.execute('UPDATE profile SET food_reminders=%s WHERE user_id=%s',(body.enabled,user['id']))
        return status_data(c,user['id'])


def tick(now=None,send=None):
    # Missing production APNs settings cannot consume a reminder or start delivery.
    if send is None and not apns.ready():return 0
    now=now or dt.datetime.now(dt.timezone.utc);claims=[]
    with db.connect() as c:
        users=c.execute('SELECT user_id,tz FROM profile WHERE food_reminders ORDER BY user_id').fetchall()
        for user in users:
            uid=user['user_id'];tz=user['tz'] or db.DEFAULT_TZ
            if not devices(c,uid):continue
            day=now.astimezone(ZoneInfo(tz)).date()
            logged={r['meal'] for r in c.execute('SELECT DISTINCT meal FROM food_entries WHERE user_id=%s AND day=%s',(uid,day)).fetchall()}
            for meal in due_meals(times(c,uid,tz,now),logged,tz,now):
                claimed=c.execute('''INSERT INTO meal_reminder_attempts(user_id,day,meal) VALUES(%s,%s,%s)
                  ON CONFLICT(user_id,day,meal) DO NOTHING RETURNING user_id''',(uid,day,meal)).fetchone()
                if claimed:claims.append((uid,day,meal))
    count=0
    for uid,day,meal in claims:
        # Text contains no food names, amounts, targets, weight or Health records.
        payload={'title':f'Log {meal}?','body':'Open your food chat when it suits you.','url':f'/food/describe?meal={meal}',
                 'badge':0,'tag':f'meal-{day}-{meal}'}
        delivered=notify.private_meal_push(uid,day,meal,payload,send=send)
        with db.connect() as c:c.execute('UPDATE meal_reminder_attempts SET delivered=%s WHERE user_id=%s AND day=%s AND meal=%s',(delivered,uid,day,meal))
        count+=delivered
    return count


def scheduler():
    while True:
        time.sleep(60)
        try:tick()
        except Exception as error:print('meal reminders paused',type(error).__name__,flush=True)
