"""Conservative Kit-only claim checks; rejection codes never contain provider prose."""
import json
import re
from pydantic import ValidationError
from typing import Literal
from . import coach_chat

Reason = Literal['numeric_unsupported','topic_unsupported','relation_unsupported','voice_invalid','health_claim']
CODES = frozenset(Reason.__args__)


class ClaimRejected(ValueError):
    def __init__(self, code: Reason):
        if code not in CODES:raise ValueError('Unknown claim rejection code')
        self.reason_code = code
        super().__init__(code)


HEALTH = re.compile(r'\b(?:you (?:have|are suffering from)|your (?:data|heart rate|workouts?) (?:proves?|confirms?|diagnoses?))\b[^.!?]*\b(?:diabetes|disease|illness|dehydration|overtraining|injury|deficiency)\b|\b(?:stop|skip|double|reduce) (?:your )?(?:medication|insulin|prescription)\b',re.I)
NUMBER_WORD = re.compile(r'\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|dozen)\s+(?:\w+\s+)?(?:runs?|rides?|walks?|workouts?|sessions?|servings?|entries|items?|meals?|days?|(?:meal|food) days?|weeks?|minutes?|hours?|grams?|calories?|miles?|kilomet(?:er|re)s?|reps?|sets?)\b|\b(?:twice|thrice)\b',re.I)


# Natural grammar can surround a slot; units, arithmetic and extra quantities cannot.
BOUNDARY_UNITS = frozenset(('g kg lb lbs oz mi km m cm ft in s sec secs min mins h hr hrs kcal bpm '
    'gram grams kilogram kilograms pound pounds ounce ounces mile miles kilometer kilometers kilometre kilometres '
    'meter meters metre metres foot feet inch inches second seconds minute minutes hour hours calorie calories '
    'percent percentage per '
    'watts watt w joules j kj kilojoules ml liters litres cups servings '
    'celsius fahrenheit degrees').split())
NUMBER_TOKEN = re.compile(r'^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|dozen)(?:-|$)')


def boundary_words(text):
    return {word for word in re.findall(r"[a-z]+(?:-[a-z]+)*",text.casefold())
            if word not in BOUNDARY_UNITS and not NUMBER_TOKEN.match(word)}


def validate(texts, facts, evidence, *, question='', reference, selection=None):
    # Facts, values, paths and source identity are checked separately. Prose quality belongs
    # to evaluation, not nearest-word heuristics that mistake advice for a personal claim.
    traces=[]
    for text in texts:
        counted,checks=food_count_phrase(text,facts,evidence);traces.extend(checks)
        prose = reference.sub('',counted)
        if HEALTH.search(prose):raise ClaimRejected('health_claim')
        if NUMBER_WORD.search(advice_quantities(bound_logged_days(prose,evidence))):raise ClaimRejected('numeric_unsupported')
    if eating_safety_answer(question) is not None:raise ClaimRejected('health_claim')
    return traces+claim_evidence(texts,evidence,facts,selection=selection)



def bound_logged_days(prose,evidence):
    # Bind explicit count+subject phrases to exactly one successful current-turn
    # source. Other measurements, compound number words and ambiguous ranges fail.
    words='zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()
    number='|'.join(words)
    def replace(pattern,count):
        nonlocal prose
        if type(count) is not int:return
        prose=re.sub(r'\b('+number+') '+pattern,
            lambda m:'recorded evidence was available' if words.index(m[1].casefold())==count
            and not re.search(r'(?:\b(?:'+number+r')|-)\s*$',prose[:m.start()],re.I) else m[0],prose,flags=re.I)
    sources=[e['data'] for e in evidence if e.get('tool')=='nutrition_adequacy'
             and isinstance(e.get('data'),dict) and 'error' not in e and 'error' not in e['data']]
    if len(sources)==1:
        replace(r'days? (?:had|has|have) (?:recorded|logged) (?:intake|food entries)\b',sources[0].get('logged_days'))
        replace(r'days? (?:were|are) unlogged\b',sources[0].get('unlogged_finished_days'))
        periods=[e['data'] for e in evidence if e.get('tool')=='period_compare'
                 and isinstance(e.get('data'),dict) and 'error' not in e and 'error' not in e['data']]
        if len(periods)==1:
            current=periods[0].get('current',{})
            workouts=current.get('totals',{}).get('workouts')
            days=sources[0].get('logged_days')
            if (type(workouts) is int and type(days) is int
                    and all(current.get(key) is not None and current[key]==sources[0].get(key)
                            for key in ('start','end'))):
                prose=re.sub(r'\bWith only ('+number+r') workouts? and ('+number+r') logged meal days?\b',
                    lambda m:'With the recorded workout and meal-day counts'
                    if (words.index(m[1].casefold()),words.index(m[2].casefold()))==(workouts,days)
                    else m[0],prose,flags=re.I)
    sources=[e['data'] for e in evidence if e.get('tool')=='strength_history'
             and isinstance(e.get('data'),dict) and 'error' not in e and 'error' not in e['data']]
    if len(sources)==1:
        summaries=sources[0].get('summary_by_exercise',[])
        for summary in summaries:
            exercise=summary.get('exercise')
            if isinstance(exercise,str) and exercise and sum(s.get('exercise')==exercise for s in summaries)==1:
                replace(r'completed sets of '+re.escape(exercise)+r'(?!\w)',summary.get('completed_sets'))
    return prose


def advice_quantities(prose):
    # A proposed logging habit is not a claim about recorded activity/intake. This narrow
    # phrase exemption never covers measurements, dose advice or past-tense quantities.
    sentences=re.split(r'(?<=[.!?])\s+|\n',prose)
    result=[]
    for sentence in sentences:
        if re.match(r'^(?:Pick|Try|Start|Consider|Focus on|To build consistency, focus on)\b',sentence,re.I) and not re.search(r'\b(?:logged|recorded|completed|was|were|had|did|took)\b',sentence,re.I):
            sentence=re.sub(r'\bfor one week\b','for a short trial',sentence,flags=re.I)
            sentence=re.sub(r'\bone (?:(?:specific|regular|routine) meal (?:each|every) day|anchor meal daily)\b','a routine meal daily',sentence,flags=re.I)
        result.append(sentence)
    return ' '.join(result)


def weekly_boundary_words():
    return ('showing',)


def additional_measurement(tool, path):
    return (daily_nutrition_path(tool,path) or tool=='nutrition_adequacy' and path==['logged_days']
            or tool=='meal_combinations' and len(path)==2 and path[0]=='remaining' and path[1] in coach_chat._NUTRIENTS
            or tool=='period_compare' and path==['change','workouts','absolute']
            or tool=='training_plan' and path==['plan','runs']
            or tool=='goals' and len(path)==3 and path[0]=='activity_goals'
            and type(path[1]) is int and path[1]>=0 and path[2]=='target')



def daily_nutrition_path(tool,path):
    return (tool=='nutrition_adequacy' and len(path)==4 and path[0]=='days'
            and type(path[1]) is int and path[1]>=0 and path[2] in {'kcal','protein_g'}
            and path[3] in {'logged_total','known_subtotal','target','difference'})


def goal_fact(tool,data,path,value,units):
    if daily_nutrition_path(tool,path):
        field={'logged_total':'comparable_day_subtotal','known_subtotal':'comparable_day_subtotal',
               'target':'comparable_target_subtotal','difference':'full_range_difference'}[path[3]]
        return coach_chat._kit_fact(tool,data,['summary',path[2],field],value,units)
    if tool!='goals' or not additional_measurement(tool,path):return None
    goal=data['activity_goals'][path[1]]
    metric=goal.get('metric')
    fields={'distance':'distance_m','time':'moving_s','elevation':'ascent_m','calories':'calories'}
    if metric=='count':
        label,display=coach_chat._kit_fact('recent_runs',{},['totals','count'],value,units)
    elif metric in fields:
        label,display=coach_chat._kit_fact('activity',{},[fields[metric]],value,units)
    else:raise ValueError('Unsupported goal measurement')
    return 'Saved '+label.lower()+' target',display


def weekly_fact_class(fact):
    if fact['tool']=='period_compare' and fact['path'][-1] in coach_chat._NUTRIENTS:return 'food'
    return None


def conversation_retry_prompt(error):
    return (coach_chat._kit_retry_prompt(error)+' Use the conversational blocks/facts JSON contract, not legacy '
            'verdict/reason. Correct unsupported claims or omit them; no extra tools or evidence.')


def weekly_retryable(error):
    from . import kit_conversation
    return kit_conversation.is_truncated(error) or isinstance(error,(ValidationError,json.JSONDecodeError,coach_chat.KitValidationError,ClaimRejected)) or str(error) in {
        'Unsupported measurement path','Weekly section topic does not match referenced fact',
        'Kit answers need a reason','Weekly review sections must each be one sentence',
        'Unverified digit or malformed reference','Unknown or mismatched numeric reference',
        'Conversational answers require blocks','Duplicated measurement wording',
        'Weekly reviews cannot propose changes or actions',
        'Claim does not match tool evidence','Invalid evidence path','Unknown evidence reference'}


def weekly_retry_prompt(error):
    from . import kit_conversation
    return conversation_retry_prompt(error)+' This is a weekly coaching reply: use blocks, not weekly_review/verdict/reason; selection null and actions empty.'


def weekly_system():
    from . import kit_conversation
    return kit_conversation.WEEKLY_SYSTEM


def is_weekly_system(system):
    return system==weekly_system()


def eating_safety_answer(question):
    if not re.search(r'\bstop eating\b|\b(?:should|can|could) i (?:not eat|eat nothing|starv\w*|skip all meals)\b',question or '',re.I):return None
    text="Please don’t stop eating or severely restrict food to lose weight. Talk with a doctor or registered dietitian about a safe approach that supports your health and training."
    return {'interpretation':text,'answer_blocks':[{'kind':'paragraph','text':text}],
            'facts':[],'actions':[],'follow_ups':[],'selection':None,'health_included':False,'eating_safety':True}


def successful(evidence,tool):
    return [e for e in evidence if e.get('tool')==tool and isinstance(e.get('data'),dict)
            and 'error' not in e and 'error' not in e['data']]


def proof(source,path,relation):
    return {'evidence_id':source['evidence_id'],'path':path,'relation':relation}


def food_count_phrase(prose,facts,evidence):
    # A count of equal logged servings is a collection claim, not one arbitrary food row.
    traces=[]
    pattern=r'\b(one|two|three|four|five|six|seven|eight|nine|ten) logged servings of ([a-z ]+?) each show (\{e[1-9][0-9]*:([0-7])\})'
    def replace(match):
        index=int(match[4]);count='one two three four five six seven eight nine ten'.split().index(match[1].lower())+1
        if index>=len(facts):return match[0]
        fact=facts[index];sources=successful(evidence,'food_log')
        source=next((e for e in sources if e['evidence_id']==fact['evidence_id']),None)
        if source is None or source['data'].get('next_before_id') is not None:return match[0]
        field=fact['path'][-1];foods=source['data'].get('foods',[])
        rows=[(i,f) for i,f in enumerate(foods) if re.search(r'\b'+re.escape(match[2])+r'\b',f.get('name',''),re.I)]
        if len(rows)!=count or any(f.get('amount')!=1 or f.get(field)!=fact['value'] or field in (f.get('unknown_nutrients') or []) for i,f in rows):return match[0]
        for i,f in rows:
            traces.extend([proof(source,['foods',i,key],'equal_servings') for key in ('name','amount',field)])
        return 'Recorded equal servings show '+match[3]
    return re.sub(pattern,replace,prose,flags=re.I),traces


METRICS = re.compile(r'\b(?:workouts?|sessions?|completed activity|recorded activity|distance|moving (?:time|duration)|training time|duration|pace|heart rate|weight|training load|fitness|sodium|protein|saturated fat|sugar|fibre|fiber|calories|intake)\b',re.I)
DIRECTIONS = re.compile(r'\b(?:more|higher|high|increas\w*|rose|ris(?:e|ing)|longer(?!-)|faster|quicker|better|improv\w*|stronger|fitter|less|fewer|lower|low|decreas\w*|dropp\w*|shorter|slower|worse|same|unchanged|usual|typical)\b',re.I)


def claim_clauses(text):
    for sentence in re.split(r'(?<=[.!?])\s+|\n',text):
        # Explicit general guidance is not a statement about this person's records.
        if (re.match(r'^General (?:guidance|advice)\b',sentence,re.I)
                and not re.search(r'\b(?:you|your|was|were|logged|recorded|completed|increased|decreased)\b|\{e',sentence,re.I)):
            continue
        yield from re.split(r'[,;]\s+|\s+(?:but|while)\s+',sentence)


def claim_evidence(texts,evidence,facts=(),*,selection=None):
    traces=[]
    def require(items):
        if not items:raise ClaimRejected('relation_unsupported')
        traces.extend(items)
    def nullable(field):
        results=[]
        for e in successful(evidence,'food_log'):
            for i,row in enumerate(e['data'].get('foods',[])):
                if field in row and (row[field] is None or field in (row.get('unknown_nutrients') or [])):
                    results.append(proof(e,['foods',i,field],'unknown'))
        return results
    for text in texts:
        for sentence in claim_clauses(text):
            lower=sentence.casefold()
            # Advice, limitations and questions are not assertions about a measured comparison.
            if re.match(r'^(?:to |a (?:helpful|practical) next step|building more movement into your week|pick |try |start |consider |focus |choose |use |open |head |save |expand |keep |let |balance |log |anchor |check |you (?:can|could|should) |how |what |should |could you )',lower) and not re.search(r'\b(?:was|were|rose|increased|decreased|reflects?|you (?:logged|recorded|completed))\b|\b(?:your|you|recorded|data)\b[^.!?]*\b(?:is|are)\b',lower):continue
            if 'higher than recorded' in lower and re.search(r'\b(?:may|might|could|can)\b',lower):
                require(nullable('fiber_g' if re.search(r'\bfib(?:re|er)\b',' '.join(texts),re.I) else 'protein_g'));continue
            if 'fluctuation' in lower and successful(evidence,'weight_trend'):
                if not re.search(r'\b(?:may|might|could|can)\b',lower):raise ClaimRejected('health_claim')
                require([proof(e,['limitations'],'possible_fluctuation') for e in successful(evidence,'weight_trend') if e['data'].get('limitations')]);continue  # A cause is unknown; use may/can, never a diagnosis.
            absent_target=False
            if re.search(r'\b(?:no|not|without|unset|none)\b',lower) and 'target' in lower:
                for name,field in {'saturated fat':'saturated_fat_target_g','sodium':'sodium_target_mg','sugar':'sugar_target_g','protein':'protein_target','calorie':'kcal_target'}.items():
                    if name+' target' in lower:
                        require([proof(e,[field],'not_set') for e in successful(evidence,'profile') if field in e['data'] and e['data'][field] is None]);absent_target=True
                if not absent_target and re.search(r'\b(?:you|your)\b',lower):raise ClaimRejected('relation_unsupported')
            for nutrient,field in (('sodium','sodium_mg'),('protein','protein_g'),('sugar','sugar_g'),('saturated fat','saturated_fat_g')):
                if re.search(r'\b(?:no|missing|unknown) '+nutrient+r'\b',lower):require(nullable(field))
            previous=bool(re.search(r'\b(?:before|previous|preceding|prior)\b',lower))
            if re.search(r'\bno (?:recorded )?workouts?\b|\bnone were recorded before\b',lower):
                period='previous' if previous else 'current'
                require([proof(e,[period,'totals','workouts'],'zero_recorded') for e in successful(evidence,'period_compare')
                         if e['data'].get(period,{}).get('totals',{}).get('workouts')==0])
            if re.search(r'\bno meals were logged\b',lower):
                require([proof(e,['logged_days'],'zero_recorded') for e in successful(evidence,'nutrition_adequacy') if e['data'].get('logged_days')==0])
            if re.search(r'\b(?:reduction option|option.*available to (?:trim|reduce))\b',lower):
                choices=[]
                for e in successful(evidence,'plan_options'):
                    for i,candidate in enumerate(e['data'].get('candidates',[])):
                        if selection and selection.get('kind')=='plan' and candidate.get('candidate_id')!=selection.get('candidate_id'):continue
                        for j,change in enumerate(candidate.get('changes',[])):
                            if 'easy run' not in lower or change.get('type')=='easy':choices.append(proof(e,['candidates',i,'changes',j],'available'))
                require(choices)
            directions=list(DIRECTIONS.finditer(re.sub(r'\bwithout adding more this week\b','without adding activity this week',sentence,flags=re.I)));metrics=list(METRICS.finditer(sentence))
            if not directions:
                if re.search(r'\b(?:compared with|compared to|versus|vs)\b',lower):
                    refs=[int(m[1]) for m in re.finditer(r'\{e[1-9][0-9]*:([0-7])\}',sentence)]
                    cited=[facts[i] for i in refs if i<len(facts)]
                    keys=[next((p for p in f['path'] if isinstance(p,str) and (p in coach_chat._NUTRIENTS or p in {'distance_m','duration_s','avg_hr','kg'})),None) for f in cited]
                    delta=any(f['path'][:1]==['change'] or f['path']==['endpoint_change_kg'] for f in cited)
                    require([{'evidence_id':f['evidence_id'],'path':f['path'],'relation':'comparison'} for f in cited]
                            if delta or len(cited)>=2 and None not in keys and len(set(keys))==1 else [])
                if re.search(r'\bnone\b',lower) and 'none were recorded before' not in lower:
                    raise ClaimRejected('relation_unsupported')
                continue
            if re.search(r'\b(?:can|could|may|might) help\b',lower):continue
            # Caution that a heavier set does not establish gains is not a personal improvement claim.
            if re.search(r'\balone does not (?:demonstrate|establish|prove)\b',lower):continue
            if not metrics:raise ClaimRejected('relation_unsupported')
            for metric in metrics:
                word=metric[0].lower();direction=min(directions,key=lambda m:abs(m.start()-metric.start()))[0].lower()
                if re.search(r'\bnot\b',lower):raise ClaimRejected('relation_unsupported')
                positive=bool(re.fullmatch(r'more|higher|high|increas\w*|rose|ris(?:e|ing)|longer|faster|quicker|better|improv\w*|stronger|fitter',direction))
                if re.fullmatch(r'better|improv\w*|stronger|fitter|worse',direction):raise ClaimRejected('relation_unsupported')
                sign=0 if direction in ('same','unchanged','usual','typical') else 1 if positive else -1
                field=('workouts' if re.search(r'workout|session|activity',word) else 'duration_s' if re.search(r'time|duration',word)
                       else 'distance_m' if word=='distance' else 'pace_s_per_km' if word=='pace' else 'avg_hr' if word=='heart rate' else None)
                sources=[]
                if word=='training load':
                    for e in successful(evidence,'plan_options'):
                        form=e['data'].get('facts',{}).get('latest_load',{}).get('form')
                        if type(form) in (int,float) and coach_chat.math.isfinite(form) and form < -20 and sign==1:
                            sources.append(proof(e,['facts','latest_load','form'],'app_high_load'))
                elif field:
                    if field=='pace_s_per_km' and direction in ('faster','quicker','slower'):sign=-sign
                    for e in successful(evidence,'period_compare'):
                        value=e['data'].get('change',{}).get(field,{}).get('absolute')
                        if type(value) in (int,float) and coach_chat.math.isfinite(value) and (value>0)-(value<0)==sign:
                            sources.append(proof(e,['change',field,'absolute'],'higher' if sign>0 else 'lower' if sign<0 else 'same'))
                require(sources)
    return traces
