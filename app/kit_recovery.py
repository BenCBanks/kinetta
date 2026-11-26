"""Checked app-owned recovery for ordinary Kit replies; no rejected prose is retained."""
from contextvars import ContextVar
from functools import wraps
import json
import math
import re
import time

_attempt = ContextVar('kit_answer_attempt', default=None)
NON_HEALTH = frozenset({'profile','nutrition_summary','meal_options','meal_combinations','food_log',
                        'nutrition_days_vs_goal','stored_foods','goals','app_features'})
FAILURES = {
    'Kit could not verify that answer. Try again.': 'answer_verification',
    'Kit could not answer right now. Try again shortly.': 'answer_provider',
    'Kit did not return an answer': 'answer_provider',
    'Kit reached the answer limit. Ask a narrower question.': 'answer_limit',
    'Kit reached the tool limit. Ask a narrower question.': 'answer_limit',
    'Kit did not consult your data. Please try again.': 'answer_verification',
    'Unverified numeric symbol': 'answer_verification',
}


def remember(evidence, usage, began):
    state = _attempt.get()
    if state is not None:state.update(evidence=evidence, usage=usage, began=began)


def topic(question):
    if re.search(r'\bweight\b', question, re.I):return 'weight'
    if re.search(r'\b(?:food|meals?|nutrition|protein|sugar|sodium|fat|calories)\b', question, re.I):return 'food'
    if re.search(r'\bplan\b', question, re.I):return 'plan'
    if re.search(r'\b(?:runs?|rides?|walks?|workouts?|recovery|training)\b', question, re.I):return 'activity'
    return 'goal' if re.search(r'\bgoals?\b', question, re.I) else 'records'


STEPS = {
    'food': 'Open your food log and review the recorded portions and what you chose to log.',
    'weight': 'Open Progress to review your weight entries over time.',
    'plan': 'Open your training plan and review the next unfinished session before considering a change.',
    'activity': 'Open your activity history and choose the workout you want to review next.',
    'goal': 'Open your saved goals and choose the goal you want to work on next.',
    'records': 'Open the relevant record and choose the detail you want to review next.',
}


def fallback(uid, question, state, active, reason):
    from . import coach, coach_chat, db, kit_claims, kit_conversation
    if state.get('uid') != uid:raise ValueError('Recovery owner mismatch')
    if reason not in set(FAILURES.values()):raise ValueError('Unknown recovery reason')
    def permitted():
        if active is not None and not active():raise ValueError('This Kit visit ended. Start a fresh chat.')
        if not coach.allowed(uid):raise ValueError(coach.off())
    permitted()
    evidence = state['evidence']
    # The original readers bind uid and source consent. Recheck Health before replaying
    # sensitive measurements; never turn revoked consent into a partial disclosure.
    sensitive = any(e.get('tool') not in NON_HEALTH and 'data' in e and 'error' not in e for e in evidence)
    if sensitive:
        with db.coach_connect(uid) as c:
            if not coach.health_ok(c, uid):return kit_conversation.consent_answer()
    question = kit_conversation.user_question(question)
    context_reply = context_step(question, state.get('history') or [])
    kind = 'food' if context_reply and context_reply[0]=='food' else topic(question)
    facts, paragraphs = [], []
    def source(name):
        matches = kit_claims.successful(evidence, name)
        return matches[0] if len(matches) == 1 else None
    def add(entry, path, sentence):
        if entry is None:return
        value = entry['data']
        try:
            for key in path:value = value[key]
        except (KeyError, IndexError, TypeError):return
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:return
        slot = '{' + entry['evidence_id'] + ':' + str(len(facts)) + '}'
        facts.append(dict(evidence_id=entry['evidence_id'], path=path, value=value))
        paragraphs.append(sentence.replace('{}', slot))
    if kind == 'food':
        summary = source('nutrition_summary')
        if summary and type(summary['data'].get('logged_days')) is int and summary['data']['logged_days'] > 0:
            for field, sentence in (('kcal','Your known logged energy in the queried period was {}.'),
                                    ('protein_g','Your known logged protein in that period was {} protein.')):
                known = summary['data'].get('known_totals',{}).get(field)
                if known == 0 and summary['data'].get('totals',{}).get(field) is None:continue
                add(summary, ['known_totals',field], sentence)
        # Existing per-entry validation adds the checked count + "each" only when
        # every known row agrees. A row is never presented as the whole intake.
        if not facts:
            entries = source('food_log')
            if entries is not None:
                for field, noun in (('sugar_g','sugar'),('sodium_mg','sodium'),('protein_g','protein')):
                    if not re.search(r'\b'+noun+r'\b', question, re.I):continue
                    rows = entries['data'].get('foods', [])
                    for i, row in enumerate(rows):
                        fact = dict(tool='food_log', path=['foods',i,field], value=row.get(field))
                        if kit_claims.equal_known_entries(fact, entries):
                            add(entries, fact['path'], 'The recorded '+noun+' amount was {}.')
                            break
                    break
        if facts:paragraphs.append('Logged entries may cover only part of your intake; unlogged food is unknown.')
    elif kind == 'weight':
        entry = source('weight_trend')
        if entry and entry['data'].get('samples'):
            add(entry, ['samples',len(entry['data']['samples'])-1,'kg'], 'A returned weight entry was {}.')
            if facts:paragraphs.append('Short-term weight changes may reflect normal fluctuation.')
    elif kind == 'activity':
        runs = source('recent_runs')
        add(runs, ['totals','count'], 'The returned running records include {} workouts.')
        add(runs, ['totals','distance_m'], 'Their recorded distance was {}.')
        if not facts:
            activities=source('activities')
            if activities is not None:
                for i,sport in enumerate(activities['data'].get('totals_by_sport',[])):
                    noun={'run':'running','ride':'cycling','walk':'walking','swim':'swimming'}.get(sport.get('sport'))
                    if noun:add(activities,['totals_by_sport',i,'distance_m'],'Your recorded '+noun+' covered {}.')
                if any(a.get('distance_m') is None for a in activities['data'].get('activities',[])):
                    paragraphs.append('Some workout distances are unknown, so these are recorded subtotals.')
    step=('You could keep your next session easy, or take a rest day if you feel tired.'
          if kind=='activity' and re.search(r'\b(?:recovery|recovering|load)\b',question,re.I) else STEPS[kind])
    if len(facts)>1 and kind=='activity':paragraphs=[' '.join(paragraphs)]
    generic = dict(blocks=[dict(kind='paragraph',text='Let’s start with a practical next step.'),
                          dict(kind='paragraph',text=step)], facts=[])
    if context_reply:
        generic=dict(blocks=[dict(kind='paragraph',text=context_reply[1])],facts=[])
    raw = dict(blocks=[dict(kind='paragraph',text=p) for p in paragraphs+[step]], facts=facts) if paragraphs else generic
    charts = kit_claims.successful(evidence, 'chart_series')
    if (len(charts) == 1 and re.search(r'\b(?:chart|graph|plot)\b',question,re.I)
            and not re.search(r"\b(?:no|without|do not|don't) (?:a |the )?(?:chart|graph|plot)\b",question,re.I)):
        # The rejected model cannot choose points or prose. Reuse the one checked
        # app result with neutral wording, retaining the requested card and source flags.
        generic = dict(blocks=[dict(kind='paragraph',text='Your recorded workout measurements are shown so far.'),
                               dict(kind='paragraph',text=STEPS[kind])],facts=[],
                       chart=dict(evidence_id=charts[0]['evidence_id']))
        raw = generic
    try:checked = kit_conversation.checked_answer(raw, evidence, question=question)
    except ValueError:
        # Unsupported/ambiguous/missing units or an unusable fact stays excluded.
        checked = kit_conversation.checked_answer(generic, evidence, question=question)
    permitted()
    return dict(checked, app_fallback=True, fallback_reason=reason, usage=dict(state['usage']),
                latency_ms=round((time.monotonic()-state['began'])*1000),
                health_included=sensitive and bool(checked['facts'] or checked.get('chart')),
                tools_used=[e['tool'] for e in evidence], prompt_version='kit-numbers-4')


def safe(answer):
    @wraps(answer)
    def wrapped(uid, question, **kwargs):
        if not kwargs.get('kit') or kwargs.get('weekly_review') or kwargs.get('workout_review'):
            return answer(uid, question, **kwargs)
        from . import kit_claims, kit_conversation, coach
        token = _attempt.set(dict(uid=uid,history=kwargs.get('history') or []))
        try:
            try:return answer(uid, question, **kwargs)
            except ValueError as error:
                state = _attempt.get()
                if 'evidence' not in state:raise
                if kit_conversation.is_consent_error(error):return kit_conversation.consent_answer()
                reason = FAILURES.get(str(error))
                if reason is None and (isinstance(error,(kit_claims.ClaimRejected,json.JSONDecodeError))
                                       or kit_claims.weekly_retryable(error)):
                    reason = 'answer_verification'
                if reason is None:raise  # Cancellation, disabled AI and programming errors remain errors.
                return fallback(uid, question, state, kwargs.get('active'), reason)
        finally:_attempt.reset(token)
    return wrapped


def context_step(question, history):
    """Use explicit current availability, or a relevant user goal; never assistant guesses."""
    match=re.search(r"\bI can train on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) only\b",question,re.I)
    if match:
        day=match[1].capitalize()
        return 'activity', f'Let’s plan around Sunday only. You could set aside time on Sunday for an easy walk, then decide whether that schedule works for you.'.replace('Sunday',day)
    if not re.search(r'\b(?:that goal|logging|food)\b',question,re.I):return None
    latest=next((item.get('text','') for item in reversed(history) if item.get('role')=='user'), '')
    if re.search(r'\b(?:food logging|food logging routine|food-logging|logging food)\b',latest,re.I):
        return 'food', 'For your food-logging goal, you could log lunch right after eating today, including drinks and snacks. Which meal would be easiest for you to log regularly?'
    return None
