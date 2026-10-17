"""Food-thread facts and feedback: arithmetic and reviewed phrases, never a model."""
import datetime as dt
import re

WEEKDAYS = ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
MEALS = {'breakfast':'breakfast','brunch':'lunch','lunch':'lunch','dinner':'dinner','supper':'dinner','snack':'snacks','snacks':'snacks'}
NUTRIENTS = {'protein':('protein_g','protein_target','g'),'carbs':('carbs_g','carbs_target','g'),
             'fat':('fat_g','fat_target','g'),'fiber':('fiber_g','fiber_target','g'),
             'calories':('kcal','kcal','kcal')}


def kcal(value):
    return round(float(value or 0) / 5) * 5


def num(value):
    return f'{round(float(value or 0)):,}'


def fmt(value,unit):
    return kcal(value) if unit=='kcal' else round(float(value or 0))


def classify(text, anchor):
    """Recognize questions only; ordinary food descriptions stay with the food engine."""
    text = re.sub(r'\s+', ' ', text.lower().replace('’', "'")).strip()
    kind = None
    food_question = bool(re.search(r'\b(?:how (?:much|many).*\bin (?:a |an |the )?|does .+ have)\b', text))
    if food_question:
        return {'kind':'advice','day':anchor,'meal':None,'nutrient':'calories','weekly':False,'average':False}
    if re.search(r'\b(?:what|which).*(?:did i (?:eat|have|log)|have i (?:eaten|had|logged)|was (?:my )?(?:breakfast|lunch|dinner))', text):
        kind = 'history'
    elif re.search(r'\b(?:am i doing (?:ok|okay|well)|how am i doing|was that (?:bad|okay|ok)|doing alright|on track)\b', text):
        kind = 'reassurance'
    elif re.search(r'\b(?:what (?:should|could|can) i eat|(?:dinner|lunch|breakfast|meal) ideas|suggest.*(?:food|dinner|protein))\b', text):
        kind = 'advice'
    elif re.search(r'\b(?:how much|how many|what are|what is|total|average|so far|left|remaining)\b', text):
        kind = 'burn' if re.search(r'\b(?:burned|burnt|burn)\b', text) else 'left' if re.search(r'\b(?:left|remaining)\b',text) else 'totals'
    elif re.search(r'\b(?:review|sum up|summary).*(?:day|today)\b', text):
        kind = 'review'
    if kind is None and re.fullmatch(r'(?:calories?|protein|carbs?|fat|fib(?:er|re)) (?:last week|this week|today|yesterday)\??',text):
        kind='totals'
    if kind is None:
        return None
    if kind in ('totals','left') and not re.search(r'^(?:(?:how|what)\b|(?:total|average|weekly)\b|(?:protein|carbs?|fat|fib(?:er|re)|calories?|cals?|kcal)\b|\d+(?:\.\d+)?\s+(?:calories?|protein|carbs?|fat)\s+(?:left|remaining)\b|(?:two|three|four|\d+) days ago\b)', text):
        return None
    nutrient = next((key for key,pattern in [('protein',r'\bprotein\b'),('carbs',r'\bcarb(?:s|ohydrates?)?\b'),('fat',r'\bfat\b'),('fiber',r'\bfib(?:er|re)\b'),('calories',r'\b(?:calories?|cals?|kcal)\b')] if re.search(pattern,text)),None)
    if kind in ('totals','left') and nutrient is None:
        return None
    days = []
    for match in re.finditer(r'\b(today|yesterday|\d{4}-\d{2}-\d{2}|(?:(?:last|this) )?(?:'+ '|'.join(WEEKDAYS) +r'))\b',text):
        word = match[0]
        if word == 'today': day = anchor
        elif word == 'yesterday': day = anchor - dt.timedelta(days=1)
        elif word[-3:].isalpha():
            weekday = word.split()[-1];ago = (anchor.weekday()-WEEKDAYS.index(weekday))%7
            if word.startswith('last ') and not ago:ago=7
            day=anchor-dt.timedelta(days=ago)
        else:
            try:day=dt.date.fromisoformat(word)
            except ValueError:return {'kind':'clarify','text':'Which date would you like to see?'}
        days.append(day)
    if len(set(days))>1 or 'tomorrow' in text:
        return {'kind':'clarify','text':'Which logged day would you like to see?'}
    meals={MEALS[m] for m in re.findall(r'\b('+ '|'.join(MEALS) +r')\b',text)}
    if kind=='history' and len(meals)>1:
        return {'kind':'clarify','text':'Which meal would you like to see?'}
    selected = days[0] if days else anchor
    if re.search(r'\blast week\b', text): selected = anchor-dt.timedelta(days=anchor.weekday()+1)
    ago = re.search(r'\b(two|three|four|\d+) days ago\b', text)
    if ago: selected = anchor-dt.timedelta(days={'two':2,'three':3,'four':4}.get(ago[1],int(ago[1]) if ago[1].isdigit() else 0))
    return {'kind':kind,'day':selected,'meal':next(iter(meals),None),'nutrient':nutrient or 'calories','weekly':bool(re.search(r'\bweek(?:ly)?\b',text)),'average':bool(re.search(r'\baverage\b',text))}


NUTRIENTS_KEYS=('kcal','protein_g','carbs_g','fat_g','fiber_g')


def snapshot(c, uid, day, question=None):
    # Sharing these readers keeps replies and feedback on the caller's transaction,
    # including a food write that has not committed yet. There is no second connection.
    from . import api_food, energy, nutrition_insights
    if question and question['kind']=='advice':
        return {'day':{'entries':[]},'needs':{'today':day},'profile':{}}
    profile = c.execute('SELECT units, food_chat_tone FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}
    week_start=day-dt.timedelta(days=day.weekday())
    unknown_sql=','.join(f"bool_or((CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array' THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? '{k}') AS {k}_unknown" for k in NUTRIENTS_KEYS)
    period_rows=c.execute(f'''SELECT day, sum(kcal) AS kcal, sum(protein_g) AS protein_g, sum(carbs_g) AS carbs_g, sum(fat_g) AS fat_g, sum(fiber_g) AS fiber_g, count(*) AS n, count(fiber_g) AS fiber_n,{unknown_sql} FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s GROUP BY day ORDER BY day''',(uid,week_start,day)).fetchall()
    D=api_food.day_data(c,uid,day.isoformat())
    tz=(c.execute('SELECT tz FROM profile WHERE user_id=%s',(uid,)).fetchone() or {}).get('tz')
    today=c.execute('SELECT (now() AT TIME ZONE %s)::date AS day',(db_tz(tz),)).fetchone()['day']
    deep = question is None or question['kind'] in ('review','reassurance')
    current = day == today
    return {'period_rows':period_rows,'day':D,
            'week':nutrition_insights.insights_data(c,uid,7) if deep and current else {'rows':[],'summary':{}},
            'needs':energy.tdee(c,uid) if deep and current else {'today':today}, 'profile':profile}


def db_tz(value):
    from . import db
    return db.valid_tz(value) or db.DEFAULT_TZ


def week_rows(S):
    today=S['needs']['today'];start=today-dt.timedelta(days=today.weekday())
    return [r for r in S['week']['rows'] if start.isoformat()<=r['day']<=today.isoformat() and r['eaten'] is not None]


def caution(S):
    resting=S['needs'].get('bmr');goal=S['day']['goal'].get('kcal')
    if resting and goal and goal<resting:
        return 'Your target is below estimated resting burn. Review your goal before using it to judge the day.'
    rows=[r for r in S['week']['rows'] if not r.get('today') and r.get('eaten') is not None]
    if resting and sum(r['eaten']<resting*.75 for r in rows)>=3:
        return 'Several logged days look low or incomplete. Check that meals are included and review whether your target fits.'
    rate=S['needs'].get('trend_kg_per_week');kg=S['needs'].get('kg')
    if rate is not None and kg and rate < -kg*.01:
        return 'Your measured weight trend is changing quickly. Use the weekly check-in to review your target.'
    return None


def feedback(S, added=None, seed=None, tone=None):
    """One grounded line; suppress praise whenever the records call for a check-in."""
    if seed is None: seed = sum(int(e.get('id') or 0) for e in S['day']['entries'])
    D=S['day'];T=D['totals'];goal=D['goal'].get('kcal');pt=D['targets'].get('protein_target');tone=tone or S['profile'].get('food_chat_tone','supportive')
    concern=caution(S)
    if concern:return concern
    if any(_missing(e,'protein_g') for e in D['entries']):
        return f"About {kcal(T['kcal']):,} kcal logged. Protein wasn’t provided for some foods, so that total is incomplete."
    if not D['entries']:return 'Nothing is logged for this day yet. Start with something you ate.'
    if tone=='numbers':
        return f"About {kcal(T['kcal']):,} kcal logged · {num(T['protein_g'])} g protein" + (f" · {kcal(goal):,} kcal goal." if goal else '.')
    variants=seed%3;added=added or {};p=round(float(added.get('protein_g') or 0));left=goal-T['kcal'] if goal else None
    if D['burned'].get('kcal') and seed%3==0:
        return f"Your recorded activities add about {kcal(D['burned']['kcal']):,} kcal burned; you’ve logged about {kcal(T['kcal']):,} kcal."
    rows=week_rows(S)
    if (added.get('kcal') or 0)>=700 and len(rows)>=3:
        avg=sum(r['eaten'] for r in rows)/len(rows)
        return f"That meal adds about {kcal(added['kcal']):,} kcal; your logged average across {len(rows)} days this week is about {kcal(avg):,} kcal."
    if p and pt and T['protein_g'] < pt:
        starts=(f'That adds {p} g of protein.',f'{p} g of protein added.',f'You’ve added {p} g of protein.')[variants]
        return f"{starts} You’re at {num(T['protein_g'])} of {num(pt)} g."
    if left is not None and left>0:
        starts=('Logged and counted.','Your log is up to date.','That’s in your log.')[variants]
        return f"{starts} About {kcal(left):,} kcal left toward your {kcal(goal):,} kcal goal."
    if len(rows)>=2:
        return f"You’ve logged food on {len(rows)} days this week; this day has about {kcal(T['kcal']):,} kcal logged."
    return f"That’s logged: about {kcal(T['kcal']):,} kcal and {num(T['protein_g'])} g protein for the day."


def _missing(entry,key):
    values=(entry.get('ref') or {}).get('unknown_nutrients')
    return entry.get(key) is None or (isinstance(values,list) and key in values)


def answer(question, S):
    D=S['day'];kind=question['kind'];day=question['day'];today=S['needs']['today']
    label='today' if day==today else day.strftime('%b %d, %Y')
    entries=D['entries'];result={'kind':'answer','intent':kind,'day':day.isoformat(),'source':'your food log','facts':{}}
    if kind=='history':
        entries=[e for e in entries if not question['meal'] or e['meal']==question['meal']]
        meal=question['meal'] or 'food'
        if not entries:text=f'No {meal} is logged for {label}.'
        else:
            names=', '.join(e['name'][:80] for e in entries[:12]);extra=f" and {len(entries)-12} more foods" if len(entries)>12 else ''
            text=f"For {meal} {'today' if label=='today' else 'on '+label}: {names}{extra}. About {kcal(sum(e['kcal'] for e in entries)):,} kcal logged."
        result['facts']['entries']=[{k:e[k] for k in ('id','name','kcal','source')} for e in entries[:12]]
        result['open_day']=day.isoformat()
    elif kind in ('totals','left'):
        nutrient=question['nutrient'];key,target_key,unit=NUTRIENTS[nutrient]
        def display(value): return fmt(value,unit)
        target=D['goal'].get('kcal') if key=='kcal' else D['targets'].get(target_key)
        if question.get('meal'):
            entries=[e for e in entries if e['meal']==question['meal']]
            value=sum(float(e.get(key) or 0) for e in entries)
        else: value=D['totals'].get(key)
        if any(_missing(e,key) for e in entries):value=None
        if question.get('weekly'):
            rows=S.get('period_rows',[])
            unknown=any(r.get(key+'_unknown') or (key=='fiber_g' and r['fiber_n']<r['n']) for r in rows)
            value=sum(float(r[key] or 0) for r in rows) if rows and not unknown else None
            if value is not None and question.get('average'):value/=len(rows)
            what='per logged day' if question.get('average') else 'logged'
            text=f"About {display(value):,} {unit}{' ' + nutrient if nutrient!='calories' else ''} {what} across {len(rows)} days in the week through {day.isoformat()}." if value is not None else (f'{nutrient.capitalize()} is missing for some foods in that week; the total is incomplete.' if unknown else 'No food is logged in that week yet.')
            if kind=='left':text+=' Targets are daily; open that day’s food log to see its remaining amount.'
            result['facts'].update({'nutrient':nutrient,'logged':value,'logged_days':len(rows),'target':None,'period':'week_to_date'})
            result['text']=text
            return result
        if question.get('meal') and kind=='left': target=None
        if not entries:text=f'Nothing is logged for {label} yet.'
        elif value is None:text=f'{nutrient.capitalize()} is unknown for some foods logged for {label}; the total is incomplete.'
        elif kind=='left' and target:
            remaining=target-value
            current='current ' if day!=today and not (key=='kcal' and D['goal'].get('custom') is not None) else ''
            text=f"About {display(abs(remaining)):,} {unit} {'left toward' if remaining>=0 else 'above'} your {current}{display(target):,} {unit}{' ' + nutrient if nutrient != 'calories' else ''} goal; {display(value):,} {unit} logged for {label}."
        else:
            text=f"About {display(value):,} {unit}{' ' + nutrient if nutrient != 'calories' else ''} logged for {label}." + (f' No {nutrient} goal is set.' if kind=='left' else '')
            if kind=='left' and not target:result['set_goal']=True
        result['facts'].update({'nutrient':nutrient,'logged':value if entries else None,'target':target})
    elif kind=='burn':
        B=D['burned'];value=B.get('day_burn');result['source']=B.get('source');result['facts']['burned']=value
        if value is None:text=f"Resting calories have not synced for {label}." + (f" Recorded activities add about {kcal(B['kcal']):,} kcal." if B.get('kcal') else ' No activity calories are recorded.')
        elif B.get('source')=='apple_health':text=f"Synced Apple Health resting calories plus recorded activities total about {kcal(value):,} kcal for {label}."
        elif B.get('source')=='imported':text=f"Imported daily burn is about {kcal(value):,} kcal for {label}."
        else:text=f"Estimated burn for the whole day is about {kcal(value):,} kcal for {label}, including recorded activities."
    elif kind=='advice':
        text='I can show your logged totals here. For food ideas, ask Kit with AI access and consent.'
        result['offer_kit']=True
    else:
        text=feedback(S)
        summary=S['week']['summary'];n=summary.get('logged',0)
        if n and summary.get('avg_eaten') is not None:
            text+=f" Across {n} sufficiently logged past days in the last week, you averaged about {kcal(summary['avg_eaten']):,} kcal."
        change=summary.get('trend_change_kg')
        if change is not None:
            imperial=S['profile'].get('units')=='imperial';value=abs(change)*(2.20462 if imperial else 1)
            text+=f" Your weight trend in this range is {'down' if change<0 else 'up' if change>0 else 'unchanged by'} {value:.1f} {'lb' if imperial else 'kg'}."
        result['facts']['past_logged_days']=n
        result['offer_kit']=kind=='reassurance'
    text=text.replace('About 0 kcal left toward','At your calorie goal; 0 kcal left toward')
    result['text']=text
    return result
