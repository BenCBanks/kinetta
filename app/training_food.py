"""Optional adult training-day food facts; no model, medical assessment or writes on read."""
import datetime as dt
SOURCE='https://www.dietitians.ca/DietitiansOfCanada/media/Documents/Resources/noap-position-paper.pdf'
RANGES=[{'label':'Light or low-intensity activity','min':3,'max':5},
        {'label':'About 1 hour of moderate exercise','min':5,'max':7},
        {'label':'1–3 hours of moderate-to-hard endurance training','min':6,'max':10}]


def policy(profile,year,active_plan,recent_workouts):
    born=profile.get('birth_year');age=year-born if isinstance(born,int) else None
    # Birth year alone cannot prove someone turning18 has already had their birthday.
    adult=(age is not None and age>=19) or (profile.get('training_food_adult_confirmed') is True and (age is None or age>=18))
    relevant=bool(active_plan or recent_workouts)
    default=bool(active_plan or profile.get('nutrition_goal')=='fuel_training')
    override=profile.get('training_day_targets')
    enabled=default if override is None else bool(override)
    return {'relevant':relevant,'adult':adult,'eligible':relevant and adult,
            'enabled':enabled,'default_enabled':default,'override':override,
            'reason':None if relevant and adult else 'under18' if age is not None and age<18 else 'adult_confirmation' if relevant else 'no_training'}


def target(normal,custom,recorded,planned,usual,enabled,eligible,*,current_day=True):
    """Never write or reduce a baseline, double-add a planned workout, or add usual exercise twice."""
    if normal is not None and normal<=0:normal=None
    baseline=custom if custom is not None else normal
    extra=0
    if baseline is not None and custom is None and current_day and enabled and eligible:
        extra=max(0,min(1500,round((max(recorded,planned)-usual)/10)*10))
        extra=min(extra,max(0,10000-baseline))
    return {'kcal':baseline+extra if baseline is not None else None,'extra':extra,
            'normal':normal,'custom':custom,'usual_exercise':round(usual),
            'planned_exercise':round(planned),'recorded_exercise':round(recorded)}


def planned(c,uid,day,kg):
    from . import plans
    p=c.execute('SELECT * FROM training_plans WHERE user_id=%s AND active',(uid,)).fetchone()
    if not p:return None,None
    mark=c.execute('SELECT done FROM plan_marks WHERE user_id=%s AND plan_id=%s AND day=%s',(uid,p['id'],day)).fetchone()
    if mark and mark['done'] is False:return p,None
    w=next((w for week in plans.build(p,plans.paces(None)) for w in week['workouts'] if w['day']==day),None)
    if not w:return p,None
    distance=float(w.get('dist') or 0)*(1.609344 if p['unit']=='mi' else 1)
    minutes=float(w.get('minutes') or distance*6) # planning estimate only, not a promised finishing pace
    kcal=kg*distance if distance else kg*5*minutes/60
    return p,{'title':w['title'],'type':w['type'],'estimated_kcal':round(kcal),'estimated_minutes':round(minutes),'distance_km':distance}


def facts(c,uid,day,ctx=None,info=None,exercise=None,normal=None,custom=None):
    from . import energy
    ctx=ctx or energy.context(c,uid);info=info or energy.tdee(c,uid)
    p=c.execute('SELECT birth_year,nutrition_goal,training_day_targets,training_food_adult_confirmed,kcal_target,training_target_average,training_target_kcal FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    active,session=planned(c,uid,day,ctx['kg'])
    rows=c.execute('''SELECT moving_s,elapsed_s FROM activities WHERE user_id=%s
        AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s''',(uid,ctx['tz'],ctx['today']-dt.timedelta(days=28),ctx['today'])).fetchall()
    pol=policy(p,ctx['today'].year,bool(active),bool(rows))
    if exercise is None:exercise=energy.exercise_by_day(c,uid,ctx['tz'],day,day,ctx['kg']).get(day) or {'kcal':0,'items':[]}
    normal=p.get('kcal_target') if normal is None else normal
    if custom is None:
        override=c.execute('SELECT kcal FROM day_goals WHERE user_id=%s AND day=%s',(uid,day)).fetchone()
        custom=override['kcal'] if override else None
    usual=float(info['avg_exercise'])
    if p.get('training_target_kcal')==normal and p.get('training_target_average') is not None:usual=max(usual,float(p['training_target_average']))
    result=target(normal,custom,float(exercise['kcal']),float(session['estimated_kcal']) if session else 0,
                  usual,pol['enabled'],pol['eligible'],current_day=day==ctx['today'])
    today_rows=c.execute('''SELECT sport,moving_s,elapsed_s FROM activities WHERE user_id=%s
        AND (start_time AT TIME ZONE %s)::date=%s''',(uid,ctx['tz'],day)).fetchall()
    seconds=sum(max(0,r['moving_s'] or r['elapsed_s'] or 0) for r in today_rows)
    planned_seconds=60*session['estimated_minutes'] if session else 0
    duration=max(seconds,planned_seconds)
    kind='long' if duration>=90*60 else 'easy' if duration else 'rest'
    return {**pol,**result,'day':day.isoformat(),'kind':kind,'minutes':round(duration/60),'recorded_minutes':round(seconds/60),
            'planned':session if pol['eligible'] else None,'source_url':SOURCE,
            'ranges':RANGES if pol['eligible'] else [],'units':'g carbohydrate per kg of body weight per day',
            'limits':'General guidance for healthy adults, not medical advice. These athlete ranges depend on intensity and individual needs; they are not prescribed macro targets.'}


def low_intake(training,eaten,burned,unknown_calories,hour):
    # A UI check-in on a recorded long day, not a diagnosis or proof of under-eating.
    if not training['eligible'] or training['recorded_minutes']<90 or hour<16:return None
    if unknown_calories or not eaten or burned is None or burned<=0 or eaten>=.6*burned:return None
    return 'Your log looks light for a long training day. If meals are missing, add them when you can; otherwise consider a meal or snack. Food logs and burn estimates can be incomplete.'
