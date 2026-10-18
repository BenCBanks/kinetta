"""Admin-only authentication metadata and aggregate usage. Never record request bodies."""
import datetime as dt
import functools
import inspect
from fastapi import APIRouter,Depends,HTTPException,Query
from typing import Literal
from . import db

router=APIRouter(prefix='/api/admin')

def record_login(c,uid,channel='web',outcome='success',stage='session'):
    # A bounded retention window also applies on quiet servers when the portal is read.
    c.execute("DELETE FROM admin_login_events WHERE created<now()-interval '90 days'")
    c.execute('INSERT INTO admin_login_events(user_id,channel,outcome,stage) VALUES (%s,%s,%s,%s)',(uid,channel,outcome,stage))

def opened(c,uid):
    c.execute("INSERT INTO admin_account_days(user_id,day) VALUES (%s,(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING",(uid,))

def audit_attempt(channel,stage='password'):
    """Failures commit after the rejected authentication transaction has unwound."""
    def decorate(fn):
        signature=inspect.signature(fn)
        @functools.wraps(fn)
        def wrapped(*args,**kwargs):
            from . import auth
            bound=signature.bind(*args,**kwargs).arguments
            request=bound.get('request');body=bound.get('body')
            with db.connect() as c:
                if hasattr(body,'login'):
                    row=c.execute('SELECT id FROM users WHERE login=%s',(body.login.strip(),)).fetchone()
                else:
                    row=c.execute('SELECT user_id AS id FROM admin_challenges WHERE token_hash=%s AND expires>now()',(auth.token_hash(request.cookies.get('kinetta_admin_pending','')),)).fetchone()
            uid=row['id'] if row else None
            actual='app' if channel=='web' and getattr(body,'app',False) else channel
            try:result=fn(*args,**kwargs)
            except HTTPException as error:
                if error.status_code in (401,429):
                    with db.connect() as c:record_login(c,uid,actual,'limited' if error.status_code==429 else 'failure',stage)
                raise
            if channel=='admin' and stage=='password' and not result.get('signed_in'):
                with db.connect() as c:record_login(c,uid,actual,'challenge',stage)
            return result
        return wrapped
    return decorate

# Keep the same separate portal-session/MFA boundary as every admin screen.
from .admin_auth import admin_user

@router.get('/logins')
def logins(days:int=Query(30,ge=1,le=90),before:int|None=Query(None,gt=0),
           outcome:Literal['success','failure','limited','challenge']|None=None,
           account:int|None=Query(None,gt=0),user=Depends(admin_user)):
    with db.connect() as c:
        c.execute("DELETE FROM admin_login_events WHERE created<now()-interval '90 days'")
        rows=c.execute("""SELECT e.id,e.created,e.channel,e.outcome,e.stage,u.login::text AS login,u.name
          FROM admin_login_events e LEFT JOIN users u ON u.id=e.user_id
          WHERE e.created>=now()-make_interval(days=>%s)
            AND (%s::bigint IS NULL OR e.id<%s)
            AND (%s::text IS NULL OR e.outcome=%s)
            AND (%s::bigint IS NULL OR e.user_id=%s)
          ORDER BY e.id DESC LIMIT 51""",(days,before,before,outcome,outcome,account,account)).fetchall()
        since=c.execute('SELECT started_at FROM admin_metrics_state WHERE singleton').fetchone()['started_at']
    return {'items':rows[:50],'before':rows[49]['id'] if len(rows)>50 else None,'since':since,'retention_days':90}

@router.get('/usage')
def usage(days:int=Query(30,ge=1,le=90),user=Depends(admin_user)):
    with db.connect() as c:
        today=c.execute("SELECT (now() AT TIME ZONE 'UTC')::date AS day").fetchone()['day'];start=today-dt.timedelta(days=days-1)
        since=c.execute('SELECT started_at FROM admin_metrics_state WHERE singleton').fetchone()['started_at']
        c.execute("DELETE FROM admin_account_days WHERE day<(now() AT TIME ZONE 'UTC')::date-365")
        counts=c.execute("""SELECT (SELECT count(*) FROM users) AS accounts,
          (SELECT count(*) FROM users WHERE created>=%s::date AT TIME ZONE 'UTC') AS new_accounts,
          (SELECT count(DISTINCT user_id) FROM admin_account_days WHERE day>=%s) AS active_accounts,
          (SELECT count(*) FROM admin_login_events WHERE outcome='success' AND created>=%s::date AT TIME ZONE 'UTC') AS signins""",(start,start,start)).fetchone()
        active={r['day']:r['n'] for r in c.execute('SELECT day,count(*) AS n FROM admin_account_days WHERE day>=%s GROUP BY day',(start,))}
        workouts={r['day']:r['n'] for r in c.execute("SELECT (created AT TIME ZONE 'UTC')::date AS day,count(*) AS n FROM activities WHERE created>=%s::date AT TIME ZONE 'UTC' GROUP BY 1",(start,))}
        food={r['day']:r['n'] for r in c.execute("SELECT (created AT TIME ZONE 'UTC')::date AS day,count(*) AS n FROM food_entries WHERE created>=%s::date AT TIME ZONE 'UTC' GROUP BY 1",(start,))}
        imports=c.execute("SELECT count(*) FILTER(WHERE status='done') AS completed,count(*) FILTER(WHERE status='failed') AS failed FROM imports WHERE created>=%s::date AT TIME ZONE 'UTC'",(start,)).fetchone()
        sources=c.execute("SELECT source,count(*) AS n FROM activities WHERE created>=%s::date AT TIME ZONE 'UTC' GROUP BY source ORDER BY count(*) DESC,source",(start,)).fetchall()
    rows=[]
    for ago in range(days):
        day=start+dt.timedelta(days=ago)
        rows.append({'day':day,'active':active.get(day,0) if day>=since.astimezone(dt.timezone.utc).date() else None,'workouts':workouts.get(day,0),'food_entries':food.get(day,0)})
    return {'days':days,'since':since,'zone':'UTC','counts':{**counts,'workouts':sum(workouts.values()),'food_entries':sum(food.values())},'daily':rows,'imports':imports,'sources':sources}
