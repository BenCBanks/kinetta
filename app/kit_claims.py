"""Conservative Kit-only claim checks; rejection codes never contain provider prose."""
import json
import math
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


TOPICS = {
    'protein_g':r'protein', 'carbs_g':r'carbs?|carbohydrates?', 'fat_g':r'fat',
    'kcal':r'calories?|kcal|energy intake', 'weight_kg':r'weight|body mass',
    'pace_s_per_km':r'pace', 'speed_mps':r'speed', 'avg_hr':r'heart rate|pulse',
    'distance_m':r'distance|mileage', 'duration_s':r'duration|moving time|elapsed time',
    'ascent_m':r'climb(?:ing)?|elevation gain', 'avg_temp':r'temperature',
    'workouts':r'workouts?|sessions?',
}
METRIC = re.compile(r'\b('+'|'.join('(?P<m'+str(i)+'>'+words+')' for i,words in enumerate(TOPICS.values()))+r')\b',re.I)
RELATION = re.compile(r'\b(faster|quicker|slower|higher|lower|more|less|longer|shorter|same|increased|decreased)\b',re.I)
UNVERIFIED = re.compile(r'\b(?:better|worse|improv\w*|stronger|fitter|healthier|recovered|overtrained|consistent|steady|typical|best|personal record|new record|further|farther|weaker|most|least|worst|drop\w*|rose|ris\w*|fell|fall\w*)\b',re.I)
PERSONAL = re.compile(r"\b(?:you(?:r| are| were| have|'re|'ve)?|this (?:run|ride|walk|swim|workout))\b",re.I)
FEELING = re.compile(r'\b(?:you|your (?:run|ride|walk|swim|workout))\s+(?:felt|feel|feels|are|were)\s+(?:very\s+)?(tired|harder|easier|strong|weak|good|bad|tough|steady)\b',re.I)
HONEST = re.compile(r"\b(?:can(?:not|['’]t) tell how (?:it|you) felt|add a note[^.!?]*)",re.I)
HEALTH = re.compile(r'\b(?:you (?:have|are suffering from)|your (?:data|heart rate|workouts?) (?:proves?|confirms?|diagnoses?))\b[^.!?]*\b(?:diabetes|disease|illness|dehydration|overtraining|injury|deficiency)\b|\b(?:stop|skip|double|reduce) (?:your )?(?:medication|insulin|prescription)\b',re.I)
NUMBER_WORD = re.compile(r'\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|dozen)\s+(?:\w+\s+)?(?:runs?|rides?|walks?|workouts?|sessions?|days?|weeks?|minutes?|hours?|grams?|calories?|miles?|kilomet(?:er|re)s?|reps?|sets?)\b|\b(?:twice|thrice)\b',re.I)


# Natural grammar can surround a slot; units, arithmetic and extra quantities cannot.
BOUNDARY_UNITS = frozenset(('g kg lb lbs oz mi km m cm ft in s sec secs min mins h hr hrs kcal bpm '
    'gram grams kilogram kilograms pound pounds ounce ounces mile miles kilometer kilometers kilometre kilometres '
    'meter meters metre metres foot feet inch inches second seconds minute minutes hour hours calorie calories '
    'protein carbs carbohydrate carbohydrates fat sodium sugar fibre fiber pace speed percent percentage per '
    'over under times divided multiply plus minus watts watt w joules j kj kilojoules ml liters litres cups servings '
    'celsius fahrenheit degrees').split())
NUMBER_TOKEN = re.compile(r'^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|half|quarter|dozen)(?:-|$)')


def boundary_words(text):
    return {word for word in re.findall(r"[a-z]+(?:-[a-z]+)*",text.casefold())
            if word not in BOUNDARY_UNITS and not NUMBER_TOKEN.match(word)}


def field(fact):
    path = fact['path']
    key = path[-2] if path[:1]==['change'] else path[-1]
    return {'moving_s':'duration_s','elapsed_s':'duration_s','kg':'weight_kg','weight_kg':'weight_kg',
            'protein_target':'protein_g','kcal_target':'kcal','carbs_target':'carbs_g','fat_target':'fat_g'}.get(key,key)


def nearest_metric(text, start, end):
    words = list(METRIC.finditer(text))
    if not words:return None
    word = min(words,key=lambda m:max(m.start()-end,start-m.end(),0))
    return list(TOPICS)[int(next(k[1:] for k,v in word.groupdict().items() if k.startswith('m') and v))]


def relation_sign(metric, facts, evidence):
    # Read only complete app-computed deltas from this turn; a known subtotal isn't a full-period change.
    ids = {f['evidence_id'] for f in facts if field(f)==metric}
    values = []
    for ev in evidence:
        if ev.get('evidence_id') not in ids or ev.get('tool')!='period_compare' or 'error' in ev:continue
        delta = ev['data'].get('change',{}).get(metric,{}).get('absolute')
        if type(delta) in (int,float) and math.isfinite(delta):values.append((delta>0)-(delta<0))
    return values[0] if values and len(set(values))==1 else None


def validate(texts, facts, evidence, *, question='', reference):
    # Only current own records and the actual user message may support a feeling; old memory is not evidence.
    notes = [question]
    for ev in evidence:
        if ev.get('tool')=='activity' and 'error' not in ev:
            notes.extend(str(ev.get('data',{}).get(k) or '') for k in ('notes','description'))
    for text in texts:
        prose = reference.sub('',text)
        if HEALTH.search(prose):raise ClaimRejected('health_claim')
        if NUMBER_WORD.search(prose):raise ClaimRejected('numeric_unsupported')
        for match in FEELING.finditer(HONEST.sub('',prose)):
            if not any(re.search(r'\b(?:felt|feel|feels|feeling|was|am)\s+(?:very\s+)?'+match[1]+r'\b',note,re.I)
                       and not re.match(r'\s*(?:did|do|does|could|would|am|was)\b',note,re.I)
                       and not re.search(r"\b(?:not|never|didn['’]t|don['’]t)\b[^.!?]*\b"+match[1]+r'\b',note,re.I) for note in notes):
                raise ClaimRejected('voice_invalid')
        for clause in re.split(r'[.!?;\n]|,|\b(?:but|while)\b',text):
            stripped = reference.sub('',clause)
            stripped = re.sub(r'\bmost recent\b','recent',stripped,flags=re.I)
            if reference.search(clause) and re.search(r'\b(?:because|caused|proves?|proof)\b',stripped,re.I):
                raise ClaimRejected('relation_unsupported')
            if PERSONAL.search(stripped) and UNVERIFIED.search(stripped):
                # A generic suggestion is different from an asserted personal result.
                if not re.match(r'\s*(?:to\b|try\b|consider\b|add\b|if\b|you (?:can|could|might)\b)',stripped,re.I):
                    raise ClaimRejected('relation_unsupported')
            for slot in reference.finditer(clause):
                fact = facts[int(slot[2])]
                topic = nearest_metric(clause,slot.start(),slot.end())
                if topic and field(fact)!=topic:raise ClaimRejected('topic_unsupported')
            if not reference.search(clause) and re.search(r'^(?:\s*)(?:try|choose|consider|aim|if|to)\b|\b(?:can|could|might|may)\b',stripped,re.I):
                continue
            for relation in RELATION.finditer(stripped):
                metric = nearest_metric(stripped,relation.start(),relation.end())
                if not metric:
                    if PERSONAL.search(stripped):raise ClaimRejected('relation_unsupported')
                    continue
                sign = relation_sign(metric,facts,evidence)
                word = relation[1].lower()
                expected = 0 if word=='same' else -1 if word in {'lower','less','shorter','decreased'} else 1
                if word in {'faster','quicker','slower'}:
                    if metric not in {'pace_s_per_km','speed_mps'}:raise ClaimRejected('relation_unsupported')
                    expected = (-1 if word!='slower' else 1)*(1 if metric=='pace_s_per_km' else -1)
                if sign is None or sign!=expected:raise ClaimRejected('relation_unsupported')


def additional_measurement(tool, path):
    return tool=='period_compare' and path==['change','workouts','absolute']


def weekly_fact_class(fact):
    if fact['tool']=='period_compare' and fact['path'][-1] in coach_chat._NUTRIENTS:return 'food'
    return None


def weekly_retryable(error):
    return isinstance(error,(ValidationError,json.JSONDecodeError,coach_chat.KitValidationError)) or str(error) in {
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
