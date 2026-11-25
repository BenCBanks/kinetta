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
        if NUMBER_WORD.search(advice_quantities(prose)):raise ClaimRejected('numeric_unsupported')


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
    return (tool=='period_compare' and path==['change','workouts','absolute']
            or tool=='training_plan' and path==['plan','runs']
            or tool=='goals' and len(path)==3 and path[0]=='activity_goals'
            and type(path[1]) is int and path[1]>=0 and path[2]=='target')


def goal_fact(tool,data,path,value,units):
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
    return kit_conversation.is_truncated(error) or isinstance(error,(ValidationError,json.JSONDecodeError,coach_chat.KitValidationError)) or str(error) in {
        'Unsupported measurement path','Weekly section topic does not match referenced fact',
        'Kit answers need a reason','Weekly review sections must each be one sentence',
        'Unverified digit or malformed reference','Unknown or mismatched numeric reference',
        'Claim does not match tool evidence','Invalid evidence path','Unknown evidence reference'}


def weekly_retry_prompt(error):
    return ('Your weekly review failed validation. '+coach_chat._kit_retry_feedback(error)+
            ' Return corrected JSON only with verdict, reason, facts, weekly_review (all three sections), '
            'selection:null, actions:[], follow_ups. Use the same evidence, no tools, at most three facts. '
            'Every placeholder must copy its fact evidence_id and global index exactly. Never guess a replacement. '
            'Use only supported numeric paths or omit a numeric claim; keep all sentences evidence-based.')


def weekly_system():
    return coach_chat.KIT_WEEKLY_SYSTEM+'''\nCopy each fact's evidence_id into its placeholder, including when a nutrition fact follows activity facts.
Period comparison change.workouts.absolute is a supported computed change. Protein fields remain food facts
regardless of the tool name. Do not write counts in words: cite a supported numeric fact or omit the count.
'''


def is_weekly_system(system):
    return system==weekly_system()
