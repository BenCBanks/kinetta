"""Weekly target suggestions from own logs and weight. No AI, no implicit target writes."""
import datetime as dt
import hashlib,json,math
from uuid import uuid4
from fastapi import HTTPException
from . import db,energy


def suggestion(info,profile,year):
    """One shared calculation for the preview and explicit Accept revalidation."""
    base={'ready':False,'logged_days':info['logged_days'],'weigh_ins':info['weigh_ins'],'weigh_in_span_days':info.get('weigh_in_span_days',0)}
    goal=profile.get('nutrition_goal')
    if goal not in energy.NUTRITION_GOALS:return {**base,'reason':'Choose a goal for a weekly target suggestion.','action':'goal'}
    if profile.get('birth_year') and year-profile['birth_year']<18:return {**base,'reason':'Goal estimates are for adults aged 18 and over.','action':'food'}
    if info['observed'] is None or info['logged_days']<7 or info['weigh_ins']<3 or info.get('weigh_in_span_days',0)<10:return {**base,'reason':'Not enough data yet. Aim for at least 7 fully logged days and 3 weigh-ins spanning 10 days in the last 28 completed days.','action':'food' if info['logged_days']<7 else 'weight'}
    observed=float(info['observed']);resting=float(info.get('resting_burn',info['bmr']));kg=float(info['kg'])
    pace=float(profile.get('goal_pace_percent') or 0) if goal in ('lose_weight','build_muscle') else 0
    if not all(math.isfinite(v) for v in (observed,resting,kg,pace)) or not 0<=pace<=1 or observed<=0 or observed>10000 or resting<=0 or kg<=0:
        return {**base,'reason':'These records cannot support a target suggestion yet. Review your food and weight entries.','action':'food'}
    floor=math.ceil(resting/10)*10
    if floor>10000:return {**base,'reason':'These records need a manual goal review before a target can be suggested.','action':'goal'}
    change=kg*pace/100*energy.KCAL_PER_KG/7
    raw=observed-change if goal=='lose_weight' else observed+change if goal=='build_muscle' else observed
    kcal=max(floor,min(10000,round(raw/10)*10))
    return {**base,'ready':True,'goal':goal,'pace_percent':pace,'weight_kg':kg,
            'avg_intake':info['avg_intake'],'trend_kg_per_week':info['trend_kg_per_week'],
            'observed_burn':info['observed'],'estimated_burn':info['expected'],'avg_exercise':info['avg_exercise'],
            'resting_floor':floor,'floor_applied':raw<floor,'suggested_kcal':kcal,
            'requested_kg_per_week':round(kg*pace/100,3),'previous_kcal':profile.get('kcal_target'),
            'resting_source':profile.get('resting_source','formula'),'units':profile.get('units') or 'imperial',
            'period_days':28,'unknown_calorie_days':info.get('unknown_calorie_days',0),'method':'logged intake minus weight-change energy estimate',
            'limits':'Observed burn is inferred from food and weight, not directly measured. Water changes, incomplete food records and scale variation can affect it.'}


def fingerprint(profile,info):
    return hashlib.sha256(json.dumps({'profile':profile,'info':info},default=str,sort_keys=True,separators=(',',':')).encode()).hexdigest()


def _profile(c,uid,lock=False):
    return c.execute('''SELECT tz,units,nutrition_goal,goal_pace_percent,kcal_target,protein_target,carbs_target,fat_target,
                        fiber_target,weight_kg,height_cm,sex,birth_year,activity_factor,resting_source
                        FROM profile WHERE user_id=%s'''+(' FOR UPDATE' if lock else ''),(uid,)).fetchone() or {}


def _dates(c,profile):
    today=c.execute('SELECT (now() AT TIME ZONE %s)::date AS day',(profile.get('tz') or db.DEFAULT_TZ,)).fetchone()['day']
    return today,today-dt.timedelta(days=today.weekday())


def _make(c,uid,profile,today):
    unknown=[r['day'] for r in c.execute("SELECT DISTINCT day FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s AND (kcal IS NULL OR coalesce(ref->'unknown_nutrients','[]'::jsonb) ? 'kcal')",(uid,today-dt.timedelta(days=28),today-dt.timedelta(days=1)))]
    info=energy.tdee(c,uid,28,excluded_days=unknown);info['unknown_calorie_days']=len(unknown)
    ctx=energy.context(c,uid)
    info['kg']=float(ctx['kg']);info['resting_burn']=ctx['bmr'] or ctx['kg']*(20 if ctx['sex']=='female' else 22)
    dates=c.execute('SELECT min(day) AS first,max(day) AS last FROM weights WHERE user_id=%s AND day BETWEEN %s AND %s',(uid,today-dt.timedelta(days=28),today-dt.timedelta(days=1))).fetchone()
    info['weigh_in_span_days']=(dates['last']-dates['first']).days if dates['first'] and dates['last'] else 0
    data=suggestion(info,profile,today.year)
    return data,fingerprint(profile,info)


def _out(row):
    if not row:return None
    return {k:row[k] for k in ('id','week','state','data','baseline','created','updated','acted_at')}


def _history(c,uid):
    return [_out(r) for r in c.execute('SELECT * FROM nutrition_checkins WHERE user_id=%s ORDER BY week DESC LIMIT 8',(uid,))]


def _response(c,uid,week,current,readiness=None):
    return {'week':week,'next_week':week+dt.timedelta(days=7),'current':_out(current),'readiness':readiness,
            'history':_history(c,uid),'kcal_target':_profile(c,uid).get('kcal_target')}


def current(uid):
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',(uid,))
        p=_profile(c,uid);today,week=_dates(c,p)
        row=c.execute('SELECT * FROM nutrition_checkins WHERE user_id=%s AND week=%s FOR UPDATE',(uid,week)).fetchone()
        if row and row['state']!='pending':return _response(c,uid,week,row)
        data,baseline=_make(c,uid,p,today)
        if not data['ready']:return _response(c,uid,week,None,data)
        if row and row['baseline']==baseline:return _response(c,uid,week,row)
        row=c.execute('''INSERT INTO nutrition_checkins(id,user_id,week,data,baseline) VALUES (%s,%s,%s,%s,%s)
                         ON CONFLICT(user_id,week) DO UPDATE SET data=excluded.data,baseline=excluded.baseline,
                         updated=CASE WHEN nutrition_checkins.baseline<>excluded.baseline THEN now() ELSE nutrition_checkins.updated END
                         RETURNING *''',(uuid4(),uid,week,json.dumps(data),baseline)).fetchone()
        return _response(c,uid,week,row)


def act(uid,cid,action,baseline=None):
    with db.connect() as c:
        c.execute('SELECT id FROM users WHERE id=%s FOR NO KEY UPDATE',(uid,))
        p=_profile(c,uid,lock=True);today,week=_dates(c,p)
        row=c.execute('SELECT * FROM nutrition_checkins WHERE user_id=%s AND id=%s FOR UPDATE',(uid,cid)).fetchone()
        if not row:raise HTTPException(404,'Check-in not found')
        if row['week']!=week:raise HTTPException(409,'A new week has started. Review the latest check-in.')
        if row['state']!='pending':return _response(c,uid,week,row)
        if action=='accept':
            data,latest=_make(c,uid,p,today)
            if not data['ready'] or baseline!=row['baseline'] or latest!=row['baseline']:
                raise HTTPException(409,'Your records or goal changed. Review the updated check-in, then tap Accept again.')
            c.execute('UPDATE profile SET kcal_target=%s WHERE user_id=%s',(data['suggested_kcal'],uid))
        elif action!='later':raise ValueError('Unknown check-in action')
        row=c.execute('''UPDATE nutrition_checkins SET state=%s,acted_at=now(),updated=now()
                         WHERE user_id=%s AND id=%s RETURNING *''',('accepted' if action=='accept' else 'deferred',uid,cid)).fetchone()
        return _response(c,uid,week,row)
