def day_goals(c,uid,start,end,*,ctx=None,exercise=None):
    """One goal policy for food/calendar/insights/Kit; batch plan data once per read."""
    from . import training_food
    ctx=ctx or context(c,uid)
    state=training_food.prepare(c,uid,ctx)
    exercise=exercise if exercise is not None else exercise_by_day(c,uid,ctx['tz'],start-dt.timedelta(days=28),end,ctx['kg'])
    custom={r['day']:r['kcal'] for r in c.execute('SELECT day,kcal FROM day_goals WHERE user_id=%s AND day BETWEEN %s AND %s',(uid,start,end))}
    out={};day=start
    while day<=end:
        usual=sum(v['kcal'] for d,v in exercise.items() if day-dt.timedelta(days=28)<=d<day)/28
        current=exercise.get(day) or {'kcal':0,'items':[]}
        t=training_food.facts(c,uid,day,ctx,exercise=current,custom=custom.get(day),prepared=state,usual=usual)
        out[day]={'kcal':round(t['kcal']) if t['kcal'] is not None else None,'extra':t['extra'],
            'custom':round(t['custom']) if t['custom'] is not None else None,'default':round(t['normal']) if t['normal'] is not None else None,'training':t}
        day+=dt.timedelta(days=1)
    return out
