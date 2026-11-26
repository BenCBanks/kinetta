"""Application-owned optional training visual; no generated points or new provider call."""
import copy
from functools import wraps
import re
from types import SimpleNamespace


def requested(question):
    from .kit_conversation import user_question
    text = user_question(question)
    return bool(re.search(r'\b(?:(?:review|assess|look over) my training|training review)\b', text, re.I)
                and not re.search(r"\b(?:no|without|skip|do not|don't) (?:a |the |any )?(?:chart|graph|plot|visual)\b", text, re.I))


def checked_scope(texts, question):
    # An empty log cannot prove a complete real-world absence of training.
    # Keep this absolute claim out of training reviews, including chart opt-outs.
    from . import kit_claims
    from .kit_conversation import user_question
    if re.search(r'\b(?:(?:review|assess|look over) my training|training review)\b',user_question(question),re.I):
        if any(re.search(r'\bcomplete lack\b',text,re.I) for text in texts):
            raise kit_claims.ClaimRejected('relation_unsupported')


def visual(series, profile):
    from . import kit_charts
    data = copy.deepcopy(series)
    if (data.get('metric') != 'distance' or data.get('aggregate') != 'sum'
            or data.get('group_by') != 'week' or data.get('truncated') is not False):return {}
    # A week with no measured distance is unknown, not evidence of zero training.
    for point in data['points']:
        if point['n'] <= point['missing']:point['value'] = None
    measured = [p for p in data['points'] if p['value'] is not None]
    if len(measured) < 3 or not any(p['value'] > 0 for p in measured):return {}
    evidence = [dict(evidence_id='e1',tool='profile',data=profile),
                dict(evidence_id='e2',tool=kit_charts.CHART_TOOL,data=data)]
    # Validate/format the app's card separately from the independently checked prose.
    answer = SimpleNamespace(chart=SimpleNamespace(evidence_id='e2'),
                             blocks=[SimpleNamespace(text='Your recorded distance so far.')])
    checked = kit_charts.checked_chart(answer,evidence,dict(facts=[]))
    checked['chart']['presentation'] = 'weekly_totals'
    for point in checked['chart']['points']:
        if point['plot_value'] is None:point['display_value'] = 'No distance recorded'
    return checked


def attach(answer):
    @wraps(answer)
    def wrapped(uid, question, **kwargs):
        result = answer(uid, question, **kwargs)
        if (not kwargs.get('kit') or kwargs.get('weekly_review') or kwargs.get('workout_review')
                or not requested(question) or result.get('chart') or result.get('consent_refused')):return result
        from . import coach, db, kit_charts
        from .kit_tools import KitTools
        active = kwargs.get('active')
        def current():
            if active is not None and not active():raise ValueError('This Kit visit ended. Start a fresh chat.')
            if not coach.allowed(uid):raise ValueError(coach.off())
        current()
        try:
            tools = KitTools(uid)
            profile = tools.call('profile',{})
            series = tools.call('chart_series',dict(metric='distance',aggregate='sum',group_by='week',
                                                  period_unit='weeks',period_count=6,sport='all'))
            card = visual(series,profile)
        except ValueError:
            # An unavailable/denied optional reader must not replace the checked reply.
            current()
            return result
        current()
        if not card:return result
        with db.coach_connect(uid) as c:
            if not coach.health_ok(c,uid) or not kit_charts.consent_still_valid(c,uid,card):return result
        current()
        return {**result,**card,'health_included':True,
                'garmin_included':bool(result.get('garmin_included') or card.get('garmin_included')),
                'tools_used':list(dict.fromkeys([*result.get('tools_used',[]),'profile','chart_series']))}
    return wrapped
