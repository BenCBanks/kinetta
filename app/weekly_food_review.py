"""Code-only observations of seven completed local days. No intake inference or model tools."""
import datetime as dt
import math
from collections import defaultdict
EXTRA=('sodium_mg','sugar_g','saturated_fat_g')

MEALS=('breakfast','lunch','dinner','snacks')
MEAL_LABELS={'breakfast':'breakfast','lunch':'lunch','dinner':'dinner','snacks':'snack time'}


def value(entry,key):
    v=entry.get(key);missing=(entry.get('ref') or {}).get('unknown_nutrients')
    return float(v) if type(v) in (int,float) and math.isfinite(v) and v>=0 and not (isinstance(missing,list) and key in missing) else None


def coverage(entries,key):
    values=[v for e in entries if (v:=value(e,key)) is not None]
    return {'recorded':round(sum(values),4 if key in EXTRA else 1) if values else None,'known_count':len(values),
            'unknown_count':len(entries)-len(values),'complete':bool(entries) and len(values)==len(entries),
            'unit':'kcal' if key=='kcal' else 'mg' if key=='sodium_mg' else 'g'}


def build(entries,today):
    start=today-dt.timedelta(days=7);end=today-dt.timedelta(days=1)
    rows=[e for e in entries if isinstance(e.get('day'),dt.date) and start<=e['day']<=end]
    logged=sorted({e['day'] for e in rows});by_meal=[]
    for meal in MEALS:
        subset=[e for e in rows if e['meal']==meal]
        if subset:by_meal.append({'meal':meal,'days':len({e['day'] for e in subset}),**coverage(subset,'protein_g')})
    nutrients={k:coverage(rows,k) for k in ('protein_g','fiber_g',*EXTRA)}
    foods=defaultdict(list)
    for e in rows:
        name=' '.join(str(e.get('name') or '').split())[:200]
        if name:foods[name.casefold()].append({**e,'name':name})
    top=[]
    for group in foods.values():
        c=coverage(group,'kcal')
        if c['recorded'] is not None and c['recorded']>0:
            top.append({'name':group[0]['name'],'logs':len(group),'days':len({e['day'] for e in group}),**c})
    top.sort(key=lambda f:(-f['recorded'],f['name'].casefold()))
    suggestions=[]
    # Describe records rather than diagnosing intake, judging food or prescribing
    # a nutrient threshold. Even complete source values do not prove a complete log.
    if rows:
        repeated=max(foods.values(),key=lambda g:(len(g),g[0]['name'].casefold()),default=[])
        if len(logged)<5 and repeated:
            suggestions.append({'kind':'logging','text':f"You logged food on {len(logged)} of these 7 days. When you eat {repeated[0]['name']} again, reusing its saved portion can make logging quicker."})
        protein=nutrients['protein_g'];known=[m for m in by_meal if m['recorded'] is not None]
        if len(logged)>=3 and protein['recorded'] and known:
            biggest=max(known,key=lambda m:m['recorded'])
            if biggest['recorded']/protein['recorded']>=.65:
                suggestions.append({'kind':'protein_spread','text':f"Most recorded protein was at {MEAL_LABELS[biggest['meal']]}. Look at the meal breakdown if you want to spread your usual protein foods across the day. Missing meals or values can change this picture."})
        missing=nutrients['fiber_g']['unknown_count']
        if missing>len(rows)/2:
            suggestions.append({'kind':'coverage','text':f"Fiber is unknown for {missing} logged food{'s' if missing!=1 else ''}. Add the packet or recipe value when it is handy to make the next review more useful."})
        elif any(nutrients[k]['unknown_count'] for k in EXTRA):
            suggestions.append({'kind':'coverage','text':'Some logged foods have no sodium, total sugar or saturated-fat value. Add a known label or recipe value when it is handy; blank does not mean zero.'})
        if not suggestions and top:
            suggestions.append({'kind':'usual','text':f"{top[0]['name']} was your biggest recorded calorie source. Check its saved portion if the amount or recipe has changed."})
    return {'start':start.isoformat(),'end':end.isoformat(),'days':7,'days_logged':len(logged),'entries':len(rows),
            'logged_dates':[d.isoformat() for d in logged],'protein_by_meal':by_meal,'nutrients':nutrients,
            'calories':coverage(rows,'kcal'),'top_foods':top[:5],'suggestions':suggestions[:2],
            'source':'Your food log · calculated without AI','note':'Recorded food only. Missing days, meals and nutrient values are not zero intake.'}
