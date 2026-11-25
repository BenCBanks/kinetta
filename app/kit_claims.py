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
NUMBER_WORD = re.compile(r'\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|dozen)\s+(?:\w+\s+)?(?:runs?|rides?|walks?|workouts?|sessions?|days?|weeks?|minutes?|hours?|grams?|calories?|miles?|kilomet(?:er|re)s?|reps?|sets?)\b|\b(?:twice|thrice)\b',re.I)


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


def validate(texts, facts, evidence, *, question='', reference):
    # Facts, values, paths and source identity are checked separately. Prose quality belongs
    # to evaluation, not nearest-word heuristics that mistake advice for a personal claim.
    for text in texts:
        prose = reference.sub('',text)
        if HEALTH.search(prose):raise ClaimRejected('health_claim')
        if NUMBER_WORD.search(advice_quantities(bound_logged_days(prose,evidence))):raise ClaimRejected('numeric_unsupported')



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
    return ' '.join(re.sub(r'\bfor one week\b','for a short trial',sentence,flags=re.I)
        if re.match(r'^(?:Pick|Try|Start|Consider|Focus on)\b',sentence,re.I)
        and not re.search(r'\b(?:logged|recorded|completed|was|were|had|did|took)\b',sentence,re.I)
        else sentence for sentence in sentences)


def weekly_boundary_words():
    return ('showing',)


def additional_measurement(tool, path):
    return (daily_nutrition_path(tool,path) or tool=='period_compare' and path==['change','workouts','absolute']
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
