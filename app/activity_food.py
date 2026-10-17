"""Private combined activity/food facts. No target changes, models or shared feed data."""
import datetime as dt


def summarize(today,workouts,foods,protein_target):
    start=today-dt.timedelta(days=7)
    acts=[a for a in workouts if start<=a['day']<today]
    rows=[f for f in foods if start<=f['day']<today]
    days={r['day'] for r in rows};known={};unknown=set()
    for r in rows:
        missing=(r.get('ref') or {}).get('unknown_nutrients')
        if r.get('protein_g') is None or (isinstance(missing,list) and 'protein_g' in missing):unknown.add(r['day'])
        else:known[r['day']]=known.get(r['day'],0)+float(r['protein_g'])
    reached_days={day for day,total in known.items() if protein_target and total>=protein_target}
    unknown-=reached_days
    reached=len(reached_days)
    return {'start':start.isoformat(),'end':(today-dt.timedelta(days=1)).isoformat(),
            'workouts':len(acts),'distance_m':round(sum(max(0,a.get('distance_m') or 0) for a in acts)),
            'seconds':round(sum(max(0,a.get('moving_s') or a.get('elapsed_s') or 0) for a in acts)),
            'days_logged':len(days),'protein_target':float(protein_target) if protein_target else None,
            'protein_days_known':len(days-unknown),'protein_days_reached':reached,
            'protein_days_unknown':len(unknown)}


def read(c,uid):
    from . import energy
    ctx=energy.context(c,uid);today=ctx['today'];start=today-dt.timedelta(days=7)
    workouts=c.execute('''SELECT id,name,sport,source,distance_m,moving_s,elapsed_s,
        (start_time AT TIME ZONE %s)::date AS day FROM activities
        WHERE user_id=%s AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s''',
        (ctx['tz'],uid,ctx['tz'],start,today)).fetchall()
    foods=c.execute('SELECT day,protein_g,ref FROM food_entries WHERE user_id=%s AND day>=%s AND day<%s',(uid,start,today)).fetchall()
    week=summarize(today,workouts,foods,ctx.get('protein_target'))
    sources={a['id']:a['source'] for a in workouts}
    # Same transaction and energy calculation as the food log, including imported total-burn precedence.
    burned=energy.day_burn(c,uid,today,ctx=ctx)
    return {'week':week,'today':{'day':today.isoformat(),'items':[{**a,'source':sources.get(a['id'])} for a in burned['items']],'exercise_kcal':burned['kcal'],
            'estimated':burned['estimated'],'burn_source':burned['source'],'day_burn':burned['day_burn'],
            'included_in_day_burn':not burned['imported'],'food_href':'/food?d='+today.isoformat()}}
