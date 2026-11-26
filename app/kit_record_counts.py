"""Bind natural count wording to current, complete own-account tool evidence."""
import re

WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()
NUMBER = r'(?P<count>' + '|'.join(WORDS) + ')'


def bind(prose, evidence, *, weekly_review=False):
    from .kit_claims import successful, proof
    traces = []
    def apply(pattern, count, source, path):
        nonlocal prose
        if type(count) is not int:return
        def replace(m):
            prefix = prose[:m.start()]
            clause=re.split(r'[.!?;\n]',prefix)[-1]+re.split(r'[.!?;\n]',prose[m.start():])[0]
            if (WORDS.index(m['count'].lower()) != count
                    or re.search(r'(?:\b(?:'+ '|'.join(WORDS)+r'|thirty|hundred)|[-–—])\s*$',prefix,re.I)
                    or re.search(r'\b(?:not|never|previous|prior|before|yesterday|last)\b',clause,re.I)):
                return m[0]
            traces.append(proof(source,path,'recorded_count'))
            return 'recorded evidence'
        prose = re.sub(pattern,replace,prose,flags=re.I)
    # One complete day of food entries can establish logged meal slots, not eaten meals.
    logs = successful(evidence,'food_log'); profiles = successful(evidence,'profile')
    if len(logs)==1 and len(profiles)==1:
        source=logs[0];rows=source['data'].get('foods',[]);today=profiles[0]['data'].get('today')
        if (source['data'].get('next_before_id','unknown') is None and today
                and rows and all(row.get('day')==today and row.get('meal') for row in rows)):
            apply(r'\byou have logged '+NUMBER+r' meals today\b',len({r['meal'] for r in rows}),source,['foods'])
    periods=successful(evidence,'period_compare');nutrition=successful(evidence,'nutrition_adequacy')
    if not weekly_review or len(periods)!=1 or len(nutrition)!=1:return prose,traces
    current=periods[0]['data'].get('current',{});food=nutrition[0]['data']
    if (current.get('truncated') is not False or food.get('truncated') is not False
            or not all(current.get(k) is not None and current[k]==food.get(k) for k in ('start','end'))
            or type(food.get('logged_days')) is not int or food['logged_days']!=current.get('food_logged_days')):
        return prose,traces
    days=food['logged_days'];unlogged=food.get('unlogged_finished_days')
    if type(unlogged) is not int or unlogged!=current.get('food_unlogged_days'):return prose,traces
    # Do not infer sport or claim an entire day of intake was logged.
    logged_patterns = [
        r'\bnutrition logs? (?:shows? entries on|contains? entries on|covered) '+NUMBER+r' days?\b',
        r'\byou recorded (?:entries|food) on '+NUMBER+r' days?\b',
        r'\b(?:nutrition|food|food entries|meals|entries) (?:was|were) (?:recorded|logged) on (?:only )?'+NUMBER+r' days?\b',
        r'\bfood logging was recorded on '+NUMBER+r' days?\b',
        r'\b(?:only )?'+NUMBER+r' days? had logged meals\b',
        r'\byour nutrition logs show '+NUMBER+r' recorded days?\b',
    ]
    for pattern in logged_patterns:apply(pattern,days,nutrition[0],['logged_days'])
    for pattern in [r'\b(?:leaving|the remaining|because|the other) '+NUMBER+r' days? (?:were )?(?:unlogged|unrecorded|not logged)\b',
                    r'\bwith '+NUMBER+r' unlogged days?\b',
                    r'\bbecause '+NUMBER+r' days? had no logs\b']:
        apply(pattern,unlogged,nutrition[0],['unlogged_finished_days'])
    workouts=current.get('totals',{}).get('workouts')
    apply(r'\bcompleting '+NUMBER+r' sessions?\b',workouts,periods[0],['current','totals','workouts'])
    # 'one day of meals' is a count of logged dates, not proof of complete intake.
    apply(r'\byou recorded '+NUMBER+r' days? of meals\b',days,nutrition[0],['logged_days'])
    apply(r'\bfood entries were recorded on only '+NUMBER+r' days?\b',days,nutrition[0],['logged_days'])
    items=sum(d.get('items',0) for d in food.get('days',[]) if type(d.get('items')) is int)
    if items==1 and current.get('food_items')==1:
        prose=re.sub(r'\ba single logged meal\b',lambda m:(traces.append(proof(periods[0],['current','food_items'],'recorded_count')) or 'a logged meal'),prose,flags=re.I)
    apply(r'\b(?:across|of) (?:the )?'+NUMBER+r' days\b',current.get('calendar_days'),periods[0],['current','calendar_days'])
    if items==current.get('food_items'):
        apply(r'\b(?:only )?'+NUMBER+r' entr(?:y|ies)\b',items,periods[0],['current','food_items'])
    return prose,traces
