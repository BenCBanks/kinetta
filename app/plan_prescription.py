"""Versioned prescriptions for new plans. Distances/segments have one canonical source.

The 10% session/15% week screens are conservative product bounds, not a medical
injury-prevention guarantee. Legacy schedules remain in plans.py unchanged.
"""
import copy
import datetime as dt
import math

VERSION = 2
MI = 1609.344


def logged_break(history):
    """Missing answers cannot erase a two-week gap in the user's recorded running."""
    today = dt.date.fromisoformat(history['as_of'])
    days = sorted({dt.date.fromisoformat(str(r['day'])) for r in history['recent_runs']})
    gaps = [(after, (after-before).days-1) for before, after in zip(days, days[1:])
            if (after-before).days > 14 and after > today-dt.timedelta(days=28)]
    resumed, length = max(gaps, default=(None, 0))
    return {'observed_break_days': length, 'resumed_on': str(resumed) if resumed else None}


def running_history(c, uid, tz, today):
    rows = c.execute('''SELECT DISTINCT start_time, distance_m, coalesce(moving_s,elapsed_s) AS seconds,
        (start_time AT TIME ZONE %s)::date AS day FROM activities
        WHERE user_id=%s AND sport='run' AND NOT lift_open AND distance_m>0
        AND coalesce(moving_s,elapsed_s)>0 AND start_time<now()
        AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s''',
        (tz, uid, tz, today-dt.timedelta(days=56), today-dt.timedelta(days=1))).fetchall()
    gap = logged_break({'as_of': str(today), 'recent_runs': rows})
    # Pre-break volume/long runs cannot establish the returning runner's present base.
    since = dt.date.fromisoformat(gap['resumed_on']) if gap['resumed_on'] else today-dt.timedelta(days=56)
    usable = [r for r in rows if r['day'] >= since]
    recent = [r for r in usable if r['day'] >= today-dt.timedelta(days=28)]
    blocks = [sum(float(r['distance_m']) for r in recent
                  if today-dt.timedelta(days=7*(i+1)) <= r['day'] < today-dt.timedelta(days=7*i)) for i in range(4)]
    return {'as_of': today.isoformat(), 'source': 'logged_running',
            'weekly_m': sum(blocks)/4, 'week_totals_m': blocks,
            'run_days_per_week': len({r['day'] for r in recent})/4,
            'longest_m': max((float(r['distance_m']) for r in usable if r['day'] >= today-dt.timedelta(days=30)), default=0),
            'days_since_run': (today-max(r['day'] for r in rows)).days if rows else None,
            **gap,
            'recent_runs': [{'day':r['day'].isoformat(), 'distance_m':float(r['distance_m'])} for r in rows]}


def readiness(history, level, runs, table, break_days=None):
    """Unknown logging is not proof of inactivity; never silently invent a base."""
    reasons = []
    gap = logged_break(history)
    if level != 'first':
        minimum = table['vol'][0]*MI
        if history['week_totals_m'][0] < minimum*.75:
            reasons.append('Your last week of logged running is below this plan’s starting base. Rebuild consistent easy running or choose an easier plan.')
        if history['weekly_m'] < minimum:
            reasons.append('The logged four-week average is below this level’s starting distance. Choose an easier plan or build a base first.')
        if sum(v >= minimum*.75 for v in history['week_totals_m']) < 3 or history['run_days_per_week'] < min(runs, table['runs'][0])*.75:
            reasons.append('This plan needs a consistent recent running base. Add missing runs, or choose the run/walk plan.')
        if (history['days_since_run'] is None or history['days_since_run'] > 7
                or (break_days or 0) >= 14 or gap['observed_break_days'] >= 14):
            reasons.append('After time off, rebuild consistent easy running before starting this race plan.')
        if history['longest_m'] < table['long'][0]*MI/1.1:
            reasons.append('The first long run is above your recent longest run. Build up before starting this plan.')
    return {'eligible': not reasons, 'reasons': reasons, 'history': history,
            'reported_break_days': break_days, **gap,
            'basis': 'Logged training supports these checks; missing logs remain unknown.'}


def fresh_paces(c, uid, tz, today, history, original_paces, race_m, goal_s, break_days):
    # A recent representative effort is necessary, not proof that every recorded run was a race.
    # Use effort cues throughout the four-week return window, including on older clients.
    if (break_days or 0) >= 14 or logged_break(history)['observed_break_days'] >= 14:
        return {}
    rows = c.execute('''SELECT b.distance_m,b.elapsed_s FROM best_efforts b JOIN activities a
        ON a.id=b.activity_id AND a.user_id=b.user_id WHERE b.user_id=%s AND b.sport='run'
        AND b.distance_m>=1609 AND b.elapsed_s>0 AND NOT a.lift_open AND b.start_time<now()
        AND (b.start_time AT TIME ZONE %s)::date BETWEEN %s AND %s''',
        (uid,tz,today-dt.timedelta(days=28),today)).fetchall()
    from . import analysis
    values = [analysis.vdot(r['distance_m'],r['elapsed_s']) for r in rows]
    values = [v for v in values if math.isfinite(v) and 25<=v<=85]
    v = round(max(values),1) if values and history['days_since_run'] is not None and history['days_since_run']<=7 else None
    P = original_paces(v)
    if goal_s and v and goal_s >= analysis.race_time(v,race_m)*.95:
        P['goal'] = goal_s/(race_m/1000)
    return P


def _display(m, unit):
    return f'{m/(MI if unit=="mi" else 1000):.2f}'.rstrip('0').rstrip('.')+' '+unit


def _distance(step):
    if step['kind']=='repeats':
        return step['repeat']*step['distance_m']+max(0,step['repeat']-1)*step['recovery_m']
    return step.get('distance_m',0)


def session(kind, target_m, unit, P, pace_text, week, race):
    """All prose, recorder metadata and totals derive from these exact segments."""
    steps = []; target_m = max(100,math.floor(target_m/100)*100)
    if kind=='intervals':
        rep = (400,800,1000)[week%3] if race=='5k' else (800,1000,1600)[week%3]
        recovery = 200 if rep==400 else 400
        n = min(8, int((target_m-2000+recovery)//(rep+recovery)))
        if n>=3:
            steps=[{'kind':'easy','distance_m':1000}, {'kind':'repeats','distance_m':rep,'repeat':n,'recovery_m':recovery,'pace_key':'intervals'}, {'kind':'easy','distance_m':1000}]
        else: kind='easy'
    if kind in ('hills','fartlek'):
        rep,recovery=(200,300) if kind=='hills' else (100,100)
        n=min(6,int((target_m-2000+recovery)//(rep+recovery)))
        if n>=3:
            work={'kind':'repeats','distance_m':rep,'repeat':n,'recovery_m':recovery,'effort':'controlled uphill effort' if kind=='hills' else 'relaxed quicker effort'}
            steps=[{'kind':'easy','distance_m':1000},work,{'kind':'easy','distance_m':target_m-1000-_distance(work)}]
        else:kind='easy'
    if kind=='tempo':  # duration-bounded quality with a clear aerobic surround
        if target_m>=4000:
            key='tempo'
            work=min(target_m-2000,3000, int(1200/(P.get(key) or 480)*1000/100)*100)
            steps=[{'kind':'easy','distance_m':1000},{'kind':'tempo','distance_m':work,'pace_key':'tempo'},{'kind':'easy','distance_m':target_m-1000-work}]
            kind='tempo'
        else:kind='easy'
    if not steps:
        if kind=='long_pace':kind='long'  # no third quality session while building long-run distance
        steps=[{'kind':kind,'distance_m':target_m}]
    m=sum(_distance(s) for s in steps)
    def text(s):
        if s['kind']=='repeats':
            effort=s.get('effort') or 'controlled'+pace_text(P,'intervals',unit)
            return f"{s['repeat']} × {_display(s['distance_m'],unit)} at {effort}, with {_display(s['recovery_m'],unit)} easy between repeats"
        key='tempo' if s['kind']=='tempo' else 'recovery' if s['kind']=='recovery' else 'easy'
        effort='comfortably hard' if key=='tempo' else 'very easy' if key=='recovery' else 'conversational effort'
        return f"{_display(s['distance_m'],unit)} at {effort}{pace_text(P,key,unit)}"
    names={'easy':'Easy run','recovery':'Recovery run','long':'Long run','medium_long':'Steady run','tempo':'Tempo run','intervals':'Intervals','hills':'Hill repeats','fartlek':'Relaxed pickups'}
    return {'type':kind,'title':names[kind]+' '+_display(m,unit),'dist':m/(MI if unit=='mi' else 1000),'distance_m':m,'segments':steps,'detail':'; '.join(text(s) for s in steps)+'. Slow down for hills or heat; effort comes first.'}


def make(settings, P, history, legacy_build, pace_text):
    """Use the existing periodization as a template, then bound physical workload."""
    p={**settings,'unit':'mi','start_vol':history['weekly_m']/MI}
    template=legacy_build(p,{})
    start=dt.date.fromisoformat(str(p['start_day']));race_day=dt.date.fromisoformat(str(p['race_day']))
    recent=[(dt.date.fromisoformat(r['day']),r['distance_m']) for r in history['recent_runs']]
    # Readiness is checked again against the planned start; a distant race is not a licence to extrapolate fitness.
    previous_week=min(history['weekly_m'],history['week_totals_m'][0]);last_stress=None;weeks=[]
    for i,wk in enumerate(template):
        workouts=[]
        if p['level']=='first':
            for w in wk['workouts']:
                if w['type']=='race':continue
                # Protect race recovery even when the race is early in the final week.
                if w['day']>=race_day-dt.timedelta(days=1):continue
                if i==7:
                    w={**w,'title':'Run 25 min','minutes':35,'detail':'5 min walk, run 25 minutes at an easy effort, then 5 min walk. Walk breaks are welcome.'}
                if i==8:
                    w={**w,'title':'Run 30 min','minutes':40,'detail':'5 min walk, run 30 minutes at an easy effort, then 5 min walk. Walk breaks are welcome.'}
                intervals=w.get('track_intervals')
                seconds=round(w['minutes']*60)
                # Use unrounded time for run/walk prescriptions (e.g. 32.5 minutes).
                if intervals:
                    seconds=600+round(intervals['repeat']*(intervals['run_min']+intervals['walk_min'])*60)
                    w={**w,'detail':f"5 min walk, then {intervals['repeat']} × (run {intervals['run_min']:g} min, walk {intervals['walk_min']:g} min), then 5 min walk. {seconds/60:g} min total at easy effort."}
                workouts.append({**w,'minutes':seconds/60,'duration_s':seconds,'segments':[
                    {'kind':'walk','duration_s':300},
                    {'kind':'runwalk','repeat':intervals['repeat'],'run_s':round(intervals['run_min']*60),'walk_s':round(intervals['walk_min']*60)} if intervals else {'kind':'run','duration_s':seconds-600},
                    {'kind':'walk','duration_s':300}]})
        else:
            eligible=[w for w in wk['workouts'] if w['type']!='race' and w['day']<race_day-dt.timedelta(days=1)
                      and not(w['type'] in ('long','long_pace','medium_long','tempo','hills','intervals','fartlek') and w['day']>=race_day-dt.timedelta(days=3))]
            # Keep the longest slot on the long-run day even for a high starting base.
            # The legacy template can allocate more of its residual budget to an easy day.
            eligible=[dict(w) for w in eligible]
            long=next((w for w in eligible if w['type'] in ('long','long_pace')),None)
            if long:
                biggest=max(eligible,key=lambda w:w['dist'])
                if biggest['dist']>long['dist']:biggest['dist'],long['dist']=long['dist'],biggest['dist']
            wanted=sum(w['dist']*MI for w in eligible)
            growth=.8 if wk['phase']=='Cutback' else .75 if wk['phase'] in ('Taper','Race week') else 1.15
            cap=min(wanted,previous_week*growth)
            # Scale the whole week once, never fill a negative budget with minimum-distance extras.
            scale=min(1,cap/wanted) if wanted else 0
            for w in eligible:
                target=w['dist']*MI*scale
                day=w['day'];prior=[m for d,m in recent if day-dt.timedelta(days=30)<=d<day]
                limit=max(prior,default=history['longest_m'])*1.10
                target=min(target,limit)
                kind=w['type'];stress=kind in ('long','long_pace','medium_long','tempo','hills','intervals','fartlek')
                if stress and last_stress and (day-last_stress).days<2:kind='easy';stress=False
                if stress:last_stress=day
                if target<100:continue
                made=session(kind,target,settings['unit'],P,pace_text,i,p['race'])
                # Quantization must never increase the session beyond its measured load limit.
                assert made['distance_m']<=target+1e-6
                workouts.append({'day':day,**made});recent.append((day,made['distance_m']))
            previous_week=sum(w['distance_m'] for w in workouts)
        if wk['n']==p['weeks']:
            m={'5k':5000,'10k':10000,'half':21097.5,'marathon':42195}[p['race']]
            workouts.append({'day':race_day,'type':'race','title':'Race: '+{'5k':'5K','10k':'10K','half':'Half marathon','marathon':'Marathon'}[p['race']],
                             'dist':m/(MI if settings['unit']=='mi' else 1000),'distance_m':m,'segments':[{'kind':'race','distance_m':m}],
                             'detail':'Start comfortably. Adjust to conditions and use walk breaks if needed.'})
        weeks.append({**wk,'workouts':sorted(workouts,key=lambda w:w['day'])})
    return {'version':VERSION,'paces':P,'history':history,'weeks':[
        {**wk,'start':str(wk['start']),'workouts':[{**w,'day':str(w['day'])} for w in wk['workouts']]} for wk in weeks]}


def weeks(snapshot):
    out=copy.deepcopy(snapshot['weeks'])
    for wk in out:
        wk['start']=dt.date.fromisoformat(wk['start'])
        for w in wk['workouts']:w['day']=dt.date.fromisoformat(w['day'])
    return out


def validate(snapshot, settings, table):
    """Creation-time backstop: a race cannot make an inadequate build look complete.

    The distance floors are conservative product screens, not clinical clearance.
    A race-week with no other running is intentional for an early-week race.
    """
    training = [[w for w in wk['workouts'] if w['type'] != 'race'] for wk in snapshot['weeks']]
    if any(not ws for ws in training[:-1]):
        return ['This schedule has an empty training week. Build a consistent base or choose another plan.']
    if settings['level'] == 'first':
        return []
    totals = [sum(w.get('distance_m', 0) for w in ws) for ws in training]
    if any(not math.isfinite(v) or v < table['vol'][0]*MI*.5 for v in totals[:-1]):
        return ['This schedule drops below a useful training base. Rebuild easy running before starting this plan.']
    race_m = next(w['distance_m'] for wk in snapshot['weeks'] for w in wk['workouts'] if w['type'] == 'race')
    longest = max((w['distance_m'] for ws in training for w in ws if w['type'] == 'long'), default=0)
    # At least a race-distance week and a long run of 60% of the race distance.
    # Otherwise lengthen the build or establish more logged running before approval.
    if max(totals) < race_m or longest < race_m*.6:
        return ['This build does not reach enough running for the race distance. Build a stronger base or choose a shorter race.']
    return []
