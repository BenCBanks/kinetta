"""Fixed aggregate feature reports; no account/content drill-down or event history."""
import calendar
import datetime as dt
import hashlib
import hmac
import os
import secrets
import threading
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, StrictBool
from . import db
from .auth import current_user
from .admin_auth import admin_user
from .api_account import _admin

router = APIRouter()
VIEWS = ('insights', 'heatmap', 'fitness', 'explore', 'kit', 'settings',
         'settings_account', 'settings_privacy', 'settings_notifications', 'settings_data',
         'share_picture', 'kit_conversation')
LOCK = 44420261101
CONSENT_VERSION = '2026-11-01-v1'


def enabled():
    return os.environ.get('KINETTA_FEATURE_METRICS', '').strip() == '1'


def allowed(c,uid,write=False):
    if not enabled():return False
    # Fence withdrawal until this collection/stamp transaction finishes. Withdrawal only locks the profile.
    lock='UPDATE' if write else 'SHARE'
    row=c.execute(f'SELECT feature_metrics_ok FROM profile WHERE user_id=%s FOR {lock}',(uid,)).fetchone()
    return bool(row and row['feature_metrics_ok'])


def month_before(day, months):
    year, month = divmod(day.year * 12 + day.month - 1 - months, 12)
    return day.replace(year=year, month=month + 1,
                       day=min(day.day, calendar.monthrange(year, month + 1)[1]))


def cleanup(c):
    # Serialize midnight rotation with collection. Use wall time after acquiring the lock.
    c.execute('SELECT pg_advisory_xact_lock(%s)', (LOCK,))
    today = c.execute("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date AS day").fetchone()['day']
    c.execute('DELETE FROM admin_feature_keys WHERE day<>%s', (today,))
    c.execute('DELETE FROM admin_feature_salts WHERE day<>%s', (today,))
    c.execute('DELETE FROM admin_feature_counts WHERE day<%s', (month_before(today, 13),))
    return today


def collect(c, uid, feature):
    if feature not in VIEWS or not allowed(c,uid):
        return
    today = cleanup(c)
    c.execute('INSERT INTO admin_feature_state(singleton,started) VALUES(true,%s) ON CONFLICT DO NOTHING', (today,))
    c.execute('INSERT INTO admin_feature_salts(day,secret) VALUES(%s,%s) ON CONFLICT DO NOTHING', (today, secrets.token_bytes(32)))
    salt = c.execute('SELECT secret FROM admin_feature_salts WHERE day=%s', (today,)).fetchone()['secret']
    key = hmac.new(bytes(salt), f'{feature}:{uid}'.encode(), hashlib.sha256).digest()
    # Repeated refreshes/retries cannot inflate an open more than once per30seconds.
    old = c.execute('SELECT opened FROM admin_feature_keys WHERE day=%s AND feature=%s AND digest=%s',
                    (today, feature, key)).fetchone()
    if old and not c.execute("SELECT %s<clock_timestamp()-interval '30 seconds' AS ready", (old['opened'],)).fetchone()['ready']:
        return
    c.execute('INSERT INTO admin_feature_keys(day,feature,digest) VALUES(%s,%s,%s) '
              'ON CONFLICT(day,feature,digest) DO UPDATE SET opened=clock_timestamp()', (today, feature, key))
    c.execute('INSERT INTO admin_feature_counts(feature,day,people,opens) VALUES(%s,%s,1,1) '
              'ON CONFLICT(feature,day) DO UPDATE SET people=admin_feature_counts.people+%s,opens=admin_feature_counts.opens+1',
              (feature, today, 0 if old else 1))


class Event(BaseModel):
    model_config = ConfigDict(extra='forbid')
    feature: Literal['insights','heatmap','fitness','explore','kit','settings','settings_account',
                     'settings_privacy','settings_notifications','settings_data','share_picture','kit_conversation',
                     'welcome_complete','health_setup']


@router.get('/api/features/state')
def state(user=Depends(current_user)):
    with db.connect() as c:
        row=c.execute('SELECT feature_metrics_ok FROM profile WHERE user_id=%s',(user['id'],)).fetchone()
    participating=bool(row and row['feature_metrics_ok'])
    return {'enabled':enabled() and participating,'available':enabled(),'participating':participating,'version':CONSENT_VERSION}


@router.post('/api/features/open', status_code=204)
def opened(body: Event, user=Depends(current_user)):
    if enabled():
        with db.connect() as c:
            if not allowed(c,user['id'],write=body.feature in ('welcome_complete','health_setup')):return Response(status_code=204)
            if body.feature in ('welcome_complete','health_setup'):
                day = cleanup(c)
                c.execute('INSERT INTO admin_feature_state(singleton,started) VALUES(true,%s) ON CONFLICT DO NOTHING', (day,))
                # Fixed profile states, not an event stream. Deleted with the account.
                column = 'welcome_completed_day' if body.feature == 'welcome_complete' else 'health_setup_day'
                c.execute(f'UPDATE profile SET {column}=coalesce({column},%s) WHERE user_id=%s', (day, user['id']))
            else:
                collect(c, user['id'], body.feature)
    return Response(status_code=204)


class Preferences(BaseModel):
    model_config=ConfigDict(extra='forbid')
    enabled:StrictBool
    version:str|None=None


@router.put('/api/features/preferences')
def preferences(body:Preferences,user=Depends(current_user)):
    if body.enabled:
        if not enabled():raise HTTPException(409,'Optional usage counts are unavailable right now.')
        if body.version!=CONSENT_VERSION:raise HTTPException(409,'Read the current usage-count explanation before turning it on.')
    with db.connect() as c:
        c.execute('UPDATE profile SET feature_metrics_ok=%s,feature_metrics_at=CASE WHEN %s THEN now() ELSE NULL END, '
                  'feature_metrics_version=%s,welcome_completed_day=CASE WHEN %s THEN welcome_completed_day ELSE NULL END, '
                  'health_setup_day=CASE WHEN %s THEN health_setup_day ELSE NULL END WHERE user_id=%s',
                  (body.enabled,body.enabled,CONSENT_VERSION if body.enabled else None,body.enabled,body.enabled,user['id']))
    return {'participating':body.enabled,'enabled':body.enabled and enabled(),'version':CONSENT_VERSION}


# Every identifier/category here is code-owned. Neither the model nor the request supplies SQL.
EVENTS = """
WITH participants AS MATERIALIZED (SELECT user_id FROM profile WHERE feature_metrics_ok),
a AS MATERIALIZED (SELECT id,user_id,created,sport,source FROM activities WHERE user_id IN(SELECT user_id FROM participants) AND created>=%(start)s AND created<%(end)s),
f AS MATERIALIZED (SELECT id,user_id,created,source,entry_method FROM food_entries WHERE user_id IN(SELECT user_id FROM participants) AND created>=%(start)s AND created<%(end)s),
events AS (
 SELECT 'activity_source_'||CASE WHEN source IN ('track','lift') THEN 'track' WHEN source IN ('healthkit','apple') THEN 'health'
 WHEN source IN ('garmin','garmin_connect') THEN 'garmin' WHEN source='manual' THEN 'manual' ELSE 'upload' END AS feature,user_id,created AS at FROM a
 UNION ALL SELECT 'activity_sport_'||CASE WHEN source='lift' THEN 'lift' WHEN sport IN ('run','walk','hike','ride','swim') THEN sport ELSE 'other' END,user_id,created FROM a
 UNION ALL SELECT 'lifting',user_id,created FROM a WHERE source='lift'
 UNION ALL SELECT 'intervals',a.user_id,a.created FROM a WHERE EXISTS(SELECT 1 FROM activity_intervals i WHERE i.activity_id=a.id AND i.user_id=a.user_id)
 UNION ALL SELECT 'food',user_id,created FROM f
 UNION ALL SELECT 'food_method_'||coalesce(entry_method,'unknown'),user_id,created FROM f
 UNION ALL SELECT 'recipes',user_id,created FROM dishes WHERE created>=%(start)s AND created<%(end)s
 UNION ALL SELECT 'weight',user_id,day::timestamp AT TIME ZONE 'UTC' FROM weights WHERE day>=%(start)s::date AND day<%(end)s::date
 UNION ALL SELECT 'friends',requester,accepted FROM friendships WHERE status='accepted' AND accepted>=%(start)s AND accepted<%(end)s
 UNION ALL SELECT 'friends',addressee,accepted FROM friendships WHERE status='accepted' AND accepted>=%(start)s AND accepted<%(end)s
 UNION ALL SELECT 'reactions',user_id,created FROM cheers WHERE created>=%(start)s AND created<%(end)s
 UNION ALL SELECT 'comments',user_id,created FROM comments WHERE created>=%(start)s AND created<%(end)s
 UNION ALL SELECT 'challenges_started',user_id,created FROM challenges WHERE created>=%(start)s AND created<%(end)s
 UNION ALL SELECT 'challenges_joined',user_id,joined FROM challenge_members WHERE joined>=%(start)s AND joined<%(end)s
 UNION ALL SELECT 'segments',creator_id,created FROM segments WHERE creator_id IS NOT NULL AND created>=%(start)s AND created<%(end)s
 UNION ALL SELECT 'kit_retained',user_id,created FROM kit_conversations WHERE created>=%(start)s AND created<%(end)s
), permitted AS (SELECT e.* FROM events e JOIN participants p USING(user_id))
"""
LABELS = {
    **{'activity_source_'+k: 'Activities · '+v for k,v in [('track','Track'),('health','Apple Health'),('garmin','Garmin'),('manual','manual'),('upload','file/other import')]},
    **{'activity_sport_'+s: 'Activities · '+s for s in ('run','walk','hike','ride','lift','swim','other')},
    'lifting':'Logged lifting sessions','intervals':'Activities using intervals','food':'Food entries',
    **{'food_method_'+k:'Food · '+v for k,v in [('describe','describe/chat'),('search','search'),('barcode','barcode'),('photo','photo'),('recipe','recipe'),('copy_yesterday','copy yesterday'),('copy_other','copy other'),('manual','manual'),('mixed','mixed review'),('other','other'),('unknown','method unavailable')]},'recipes':'Recipes created',
    'weight':'Dated weigh-ins','friends':'Accepted friend connections','reactions':'Reactions','comments':'Comments',
    'challenges_started':'Challenges started','challenges_joined':'Challenge memberships','segments':'Segments created',
    'kit_retained':'Retained legacy Kit conversations',
}


def cell(people, uses):
    return {'people': people if people >= 3 else None, 'uses': uses if people >= 3 else None,
            'state': 'counted' if people >= 3 else 'fewer than 3'}


def periods(today, period):
    end = today + dt.timedelta(days=1)
    start = month_before(end, 12) if period == '12m' else end - dt.timedelta(days=int(period))
    previous = month_before(start, 12) if period == '12m' else start - (end-start)
    return start, end, previous


def record_rows(c, start, end, previous, bucket):
    stamp=lambda day:dt.datetime.combine(day,dt.time(),dt.timezone.utc)
    args={'start':stamp(previous),'end':stamp(end),'current':stamp(start),'bucket':bucket}
    totals=c.execute(EVENTS+"""SELECT feature,at>=%(current)s AS current,count(DISTINCT user_id) AS people,count(*) AS uses
        FROM permitted GROUP BY feature,current""",args).fetchall()
    trends=c.execute(EVENTS+"""SELECT feature,date_trunc(%(bucket)s,at AT TIME ZONE 'UTC')::date AS day,
        count(DISTINCT user_id) AS people,count(*) AS uses FROM permitted WHERE at>=%(current)s GROUP BY 1,2""",args).fetchall()
    lookup={(r['feature'],r['current']):r for r in totals};trend_lookup={(r['feature'],r['day']):r for r in trends}
    days=[];day=start
    while day<end:
        value=day.replace(day=1) if bucket=='month' else day-dt.timedelta(days=day.weekday()) if bucket=='week' else day
        if value not in days:days.append(value)
        day+=dt.timedelta(days=1)
    result=[]
    for feature,label in LABELS.items():
        current=cell(**{k:lookup.get((feature,True),{}).get(k,0) for k in ('people','uses')})
        old=cell(**{k:lookup.get((feature,False),{}).get(k,0) for k in ('people','uses')})
        if feature.startswith('activity_') or feature in ('lifting','intervals'):
            for flag,value in ((True,current),(False,old)):
                if any((key.startswith('activity_') or key in ('lifting','intervals')) and active==flag and row['uses']>0 and row['people']<3 for (key,active),row in lookup.items()):
                    value.update(people=None,uses=None,state='activity breakdown hidden for small groups')
        if feature=='food':
            for flag,value in ((True,current),(False,old)):
                if any(key.startswith('food_method_') and active==flag and row['uses']>0 and row['people']<3 for (key,active),row in lookup.items()):
                    value.update(people=None,uses=None,state='total hidden for small method groups')
        cells=[{'day':d,**cell(**{k:trend_lookup.get((feature,d),{}).get(k,0) for k in ('people','uses')})} for d in days]
        # A range total and every other bucket must not reveal a suppressed remainder by subtraction.
        if current['uses'] is None or any(x['uses'] is None for x in cells):
            cells=[{'day':d,'people':None,'uses':None,'state':'trend hidden for small groups'} for d in days]
        result.append({'feature':feature,'label':label,**current,'metric':'people','change':
            current['uses']-old['uses'] if current['uses'] is not None and old['uses'] is not None else None,'trend':cells,'kind':'records'})
    return result


def view_rows(c, start, end, previous, started, today):
    data=c.execute('SELECT feature,day,people,opens FROM admin_feature_counts WHERE day>=%s AND day<%s ORDER BY day,feature',(max(previous,month_before(today,13)),end)).fetchall()
    rows=[]
    for feature in VIEWS:
        values=[r for r in data if r['feature']==feature];current=[r for r in values if start<=r['day']<end and r['people']>=3]
        old=[r for r in values if previous<=r['day']<start and r['people']>=3]
        complete=started is not None and previous>=started and previous>=month_before(today,13)
        known=len(current)==(end-start).days and len(old)==(start-previous).days
        rows.append({'feature':'view_'+feature,'label':feature.replace('_',' ').capitalize()+(' made' if feature=='share_picture' else ' · opens'),
            'metric':'user-days','kind':'daily counters','people':sum(r['people'] for r in current) if current else None,
            'uses':sum(r['opens'] for r in current) if current else None,'state':'visible days only' if current else 'fewer than 3 / not tracked',
            'change':sum(r['opens'] for r in current)-sum(r['opens'] for r in old) if complete and known else None,
            'trend':[{'day':r['day'],'uses':r['opens'],'people':r['people'],'state':'counted'} for r in current]})
    return rows


def funnel(c, start, end, today, started):
    data=c.execute("""WITH cohort AS (SELECT id,(created AT TIME ZONE 'UTC')::date AS day FROM users WHERE id IN(SELECT user_id FROM profile WHERE feature_metrics_ok) AND created>=%s AND created<%s)
      SELECT count(*) AS accounts,
      count(*) FILTER(WHERE p.welcome_completed_day IS NOT NULL) AS welcome,
      count(*) FILTER(WHERE p.health_setup_day IS NOT NULL OR EXISTS(SELECT 1 FROM connections x WHERE x.user_id=u.id AND x.kind='garmin_connect')) AS health,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM activities a WHERE a.user_id=u.id)) AS activity,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM food_entries f WHERE f.user_id=u.id)) AS food,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM friendships f WHERE f.status='accepted' AND u.id IN(f.requester,f.addressee))) AS friend,
      count(*) FILTER(WHERE u.day<=%s-14) AS eligible,
      count(*) FILTER(WHERE u.day<=%s-14 AND EXISTS(SELECT 1 FROM admin_account_days d WHERE d.user_id=u.id AND d.day BETWEEN u.day+7 AND u.day+13)) AS week2
      FROM cohort u LEFT JOIN profile p ON p.user_id=u.id""",(dt.datetime.combine(start,dt.time(),dt.timezone.utc),dt.datetime.combine(end,dt.time(),dt.timezone.utc),today,today)).fetchone()
    items=[]
    for key,label in [('accounts','Accounts created'),('welcome','Welcome completed while participating'),('health','Health setup / Garmin connected'),('activity','First retained activity'),('food','First retained food'),('friend','Accepted friend'),('week2','Returned in week 2')]:
        denominator=data['eligible'] if key=='week2' else data['accounts'];n=data[key]
        coverage=(started is not None and start>=started) if key in ('welcome','health') else True
        if key=='week2':
            old_since=c.execute("SELECT (started_at AT TIME ZONE 'UTC')::date AS day FROM admin_metrics_state WHERE singleton").fetchone()['day']
            coverage=start>=old_since and start>=today-dt.timedelta(days=365)
        visible=coverage and n>=3 and denominator>=3 and (denominator==n or denominator-n>=3)
        items.append({'key':key,'label':label,'count':n if visible else None,'eligible':denominator if visible else None,
            'percent':round(100*n/denominator,1) if visible else None,'state':'counted' if visible else 'unavailable history' if not coverage else 'fewer than 3'})
    return items


@router.get('/api/admin/features')
def features(period: Literal['7','30','90','12m']='30', bucket: Literal['day','week','month']='week',user=Depends(admin_user)):
    _admin(user)
    with db.connect() as c:
        c.execute("SET LOCAL statement_timeout='900ms'")
        today=cleanup(c);start,end,previous=periods(today,period)
        saved=c.execute('SELECT started FROM admin_feature_state WHERE singleton').fetchone();started=saved['started'] if saved else None
        rows=record_rows(c,start,end,previous,bucket)
        rows+=view_rows(c,start,end,previous,started,today)
        for key,label,query in [
            ('plans','Active training plans', 'SELECT count(DISTINCT user_id) AS people,count(*) AS uses FROM training_plans WHERE active AND user_id IN(SELECT user_id FROM profile WHERE feature_metrics_ok)'),
            ('leaderboards','Leaderboard opt-in', 'SELECT count(*) AS people,count(*) AS uses FROM profile WHERE feature_metrics_ok AND segment_boards'),
            ('notify_plan','Planned-workout alerts on',"SELECT count(*) AS people,count(*) AS uses FROM profile WHERE feature_metrics_ok AND notify->'personal'->'plan'='true'::jsonb"),
            ('notify_weekly','Weekly-summary alerts on',"SELECT count(*) AS people,count(*) AS uses FROM profile WHERE feature_metrics_ok AND notify->'personal'->'weekly'='true'::jsonb"),
            ('notifications','Push registered', 'SELECT count(DISTINCT user_id) AS people,count(*) AS uses FROM (SELECT user_id FROM push_subscriptions UNION ALL SELECT user_id FROM native_push_devices) s WHERE user_id IN(SELECT user_id FROM profile WHERE feature_metrics_ok)')]:
            count=c.execute(query).fetchone();rows.append({'feature':key,'label':label,**cell(**count),'metric':'people','kind':'current state','change':None,'trend':[]})
        return {'period':period,'bucket':bucket,'start':start,'end':end-dt.timedelta(days=1),'zone':'UTC',
            'collection_enabled':enabled(),'tracking_since':started,'retention_months':13,'rows':rows,'funnel':funnel(c,start,end,today,started),
            'notes':['Only people who opted into improvement counts contribute to record reports and the signup cohort. This voluntary sample is not all accounts.',
                'Existing records count retained data, not deleted history. Current-state rows are not historical actions.',
                'Food methods are forward-only action labels when collection is enabled. Older records/clients remain method unavailable; nutrition provenance is never used to guess a method.',
                'Opens within30seconds are coalesced. Daily view summaries include only days with at least3 people. Across days the metric is user-days, not distinct people. Hidden days and unavailable previous periods have no change.',
                'Trends are hidden if any bucket is small, so totals cannot reveal a hidden bucket. Counts are not a guarantee of anonymity.',
                'Funnel steps are independent. Setup steps before participation are unknown; Apple permission completion does not prove read permission. Week2 excludes accounts under14days old.',
                'No account drill-down, private text, locations, raw sources or questions are returned.']}


def start_cleanup():
    stop=threading.Event()
    def run():
        while not stop.is_set():
            try:
                with db.connect() as c:cleanup(c)
            except Exception:
                pass  # Optional metrics cannot stop the app; reads also enforce retention.
            stop.wait(60)
    worker=threading.Thread(target=run,daemon=True);worker.start()
    return stop,worker
