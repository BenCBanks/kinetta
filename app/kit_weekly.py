"""Weekly-only count bindings and checked, application-owned failure recovery."""
from contextvars import ContextVar
from functools import wraps
import math
import re
import time

_attempt = ContextVar('kit_weekly_attempt', default=None)
WORDS = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split()


def remember(evidence, usage, began):
    state = _attempt.get()
    if state is not None:state.update(evidence=evidence, usage=usage, began=began)


def bind_counts(prose, evidence):
    from . import kit_claims
    periods = kit_claims.successful(evidence, 'period_compare')
    nutrition = kit_claims.successful(evidence, 'nutrition_adequacy')
    if len(periods) != 1 or len(nutrition) != 1:return prose
    current, food = periods[0]['data'].get('current', {}), nutrition[0]['data']
    if not all(current.get(k) is not None and current[k] == food.get(k) for k in ('start', 'end')):return prose
    count = food.get('logged_days')
    if type(count) is not int or type(current.get('food_logged_days')) is not int or current['food_logged_days'] != count:return prose
    def current_phrase(match):
        clause=re.split(r'[.!?]',prose[:match.start()])[-1]+prose[match.start():]
        clause=re.split(r'[.!?]',clause)[0]
        return not re.search(r'\b(?:not|never|previous|prior|before)\b',clause,re.I)
    pattern = r'\b(' + '|'.join(WORDS) + r') days?\b'
    def replace(match):
        before, after = prose[:match.start()], prose[match.end():]
        subject = re.search(r'(?:nutrition records were logged on|food (?:was )?logged on|nutrition logs cover only)\s*$', before, re.I)
        subject = subject or re.match(r'\s+had logged (?:entries|food)\b', after, re.I)
        compound = re.search(r'(?:\b(?:' + '|'.join(WORDS) + r')|-)\s*$', before, re.I)
        return 'recorded dates' if subject and not compound and current_phrase(match) and WORDS.index(match[1].lower()) == count else match[0]
    prose = re.sub(pattern, replace, prose, flags=re.I)
    workouts=current.get('totals',{}).get('workouts')
    if type(workouts) is int:
        prose=re.sub(r'\b('+'|'.join(WORDS)+r') logged sessions?\b',
                     lambda m:'recorded sessions' if WORDS.index(m[1].lower())==workouts and current_phrase(m)
                     and not re.search(r'(?:\b(?:'+'|'.join(WORDS)+r')|-)\s*$',prose[:m.start()],re.I) else m[0],prose,flags=re.I)
    # A proposed logging habit is not a statement about recorded intake or a dose.
    return re.sub(r'\b(A (?:helpful|practical) next step is (?:to choose|picking)) one (?:regular )?meal (?:each day to log|to log each day)\b',
                  r'\1 a routine meal to log daily', prose, flags=re.I)


def check_directions(text, facts, evidence):
    from . import kit_claims
    if not re.search(r'\bdown by\b',text,re.I):return []
    return kit_claims.claim_evidence([re.sub(r'\bdown by\b','lower by',text,flags=re.I)],evidence,facts)


def duration_delta(tool, data, path, value, units):
    if tool != 'period_compare' or path != ['change','duration_s','absolute']:return None
    from . import coach_chat
    _, display = coach_chat._kit_fact(tool, data, ['current','totals','duration_s'], abs(value), units)
    return 'Change in duration', ('-' if value < 0 else '') + display


def display_value(fact, text, facts):
    # A verified signed delta expressed as a reduction needs its magnitude, not a double negative.
    if fact['path'][:1] != ['change'] or fact['value'] >= 0:return fact['display_value']
    from .kit_conversation import REFERENCE
    for slot in REFERENCE.finditer(text):
        if int(slot[2]) == facts.index(fact) and slot[1] == fact['evidence_id'] and (re.search(r'\b(?:down|fell|decreased|dropped) by\s*$', text[:slot.start()], re.I)
                or re.match(r'\s+(?:fewer|less)\b',text[slot.end():],re.I)):
            return fact['display_value'].lstrip('-')
    return fact['display_value']


def fallback(uid, question, state, active):
    from . import coach, coach_chat, db, kit_conversation, kit_claims
    if active is not None and not active():raise ValueError('This Kit visit ended. Start a fresh chat.')
    if not coach.allowed(uid):raise ValueError(coach.off())
    with db.coach_connect(uid) as c:
        if not coach.health_ok(c, uid):return kit_conversation.consent_answer()
    evidence = state['evidence']
    profiles = kit_claims.successful(evidence, 'profile')
    if len(profiles) != 1:raise ValueError('Weekly profile unavailable')
    period = coach_chat._weekly_period(profiles[0]['data'].get('today'))
    start, end = period['start'].isoformat(), period['end'].isoformat()
    facts, paragraphs = [], []
    def add(entry, path, sentence):
        value = entry['data']
        for key in path:value = value.get(key) if isinstance(value, dict) else None
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:return
        slot = '{' + entry['evidence_id'] + ':' + str(len(facts)) + '}'
        facts.append(dict(evidence_id=entry['evidence_id'], path=path, value=value))
        paragraphs.append(sentence.replace('{}', slot))
    periods = kit_claims.successful(evidence, 'period_compare')
    if len(periods) == 1 and all(periods[0]['data'].get('current', {}).get(k) == v for k, v in (('start', start), ('end', end))):
        add(periods[0], ['current', 'totals', 'workouts'], 'You logged {} workout during this review period.' if periods[0]['data']['current'].get('totals',{}).get('workouts') == 1 else 'You logged {} workouts during this review period.')
        add(periods[0], ['current', 'totals', 'distance_m'], 'Your recorded distance was {}.')
    nutrition = kit_claims.successful(evidence, 'nutrition_adequacy')
    if len(nutrition) == 1 and all(nutrition[0]['data'].get(k) == v for k, v in (('start', start), ('end', end))):
        add(nutrition[0], ['logged_days'], 'Food was logged on {} day; logged entries may cover only part of your intake.' if nutrition[0]['data'].get('logged_days') == 1 else 'Food was logged on {} days; logged entries may cover only part of your intake.')
    if not paragraphs:paragraphs.append('Your recorded details are unavailable for this review period.')
    paragraphs.append('Review your activity log and add any missing meals before planning your next week.')
    raw = dict(blocks=[dict(kind='paragraph', text=p) for p in paragraphs], facts=facts)
    checked = kit_conversation.checked_answer(raw, evidence, question=question, weekly_review=True)
    return dict(checked, weekly_period=dict(start=start, end=end, label=period['label']),
                app_fallback=True, fallback_reason='weekly_verification', usage=dict(state['usage']),
                latency_ms=round((time.monotonic()-state['began'])*1000),
                health_included=bool(facts), tools_used=[e['tool'] for e in evidence], prompt_version='kit-numbers-4')


def safe(answer):
    @wraps(answer)
    def wrapped(uid, question, **kwargs):
        if not (kwargs.get('kit') and kwargs.get('weekly_review')):return answer(uid, question, **kwargs)
        from . import kit_claims
        token = _attempt.set({})
        try:
            try:return answer(uid, question, **kwargs)
            except ValueError as error:
                # Never turn cancellation, disabled AI, consent or arbitrary programming errors into a reply.
                recoverable = kit_claims.weekly_retryable(error) or str(error) in {
                    'Kit could not verify that weekly review. Try again.',
                    'Kit could not answer right now. Try again shortly.',
                    'Weekly review cannot request additional tools'}
                if not recoverable or not _attempt.get():raise
                return fallback(uid, question, _attempt.get(), kwargs.get('active'))
        finally:_attempt.reset(token)
    return wrapped
