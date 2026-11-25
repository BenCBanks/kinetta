"""Unregistered, deterministic own-data comparison; callers still enforce AI/access/release gates."""
import datetime as dt
from typing import Literal
from pydantic import Field, model_validator
from . import db
from .coach_tools import ComparisonRange


class Compare(ComparisonRange):
    metric: Literal['workouts', 'distance_m', 'duration_s', 'protein_g']
    sport: str | None = Field(default=None, min_length=1, max_length=40, pattern=r'^[a-z][a-z0-9_]*$')

    @model_validator(mode='after')
    def food_scope(self):
        if self.metric == 'protein_g' and self.sport is not None:
            raise ValueError('A food comparison cannot be filtered by workout sport')
        return self


class OwnComparison:
    def __init__(self, authenticated_user_id):
        if type(authenticated_user_id) is not int or authenticated_user_id <= 0:
            raise ValueError('Authenticated account required')
        self._uid = authenticated_user_id

    def read(self, arguments):
        r = Compare.model_validate(arguments)
        with db.coach_connect(self._uid) as c:
            p = c.execute('''SELECT tz,health_ai_ok,garmin_ai_ok,
                (now() AT TIME ZONE tz)::date AS today FROM profile WHERE user_id=%s''', (self._uid,)).fetchone()
            if not p or r.end >= p['today']:
                raise ValueError('Use completed account-local dates before today')
            scope = {} if r.metric == 'protein_g' else {
                'health': bool(p['health_ai_ok']), 'garmin': bool(p['garmin_ai_ok'])}
            days = (r.end-r.start).days+1
            previous_end = r.start-dt.timedelta(days=1)
            previous_start = r.start-dt.timedelta(days=days)
            current = self._period(c, r, p, r.start, r.end, days)
            previous = self._period(c, r, p, previous_start, previous_end, days)
            # Discard rather than return a comparison computed across a consent change.
            if scope:
                latest = c.execute('SELECT health_ai_ok,garmin_ai_ok FROM profile WHERE user_id=%s', (self._uid,)).fetchone()
                if not latest or scope != {'health': bool(latest['health_ai_ok']), 'garmin': bool(latest['garmin_ai_ok'])}:
                    raise ValueError('Source consent changed; request a fresh comparison')
        a, b = current['value'], previous['value']
        delta = a-b if a is not None and b is not None else None
        return {'metric': r.metric, 'sport': r.sport, 'timezone': p['tz'], 'source_consents': scope,
                'current': current, 'previous': previous,
                'change': {'absolute': delta, 'percent': round(delta/b*100, 2) if delta is not None and b else None},
                'limitations': [
                    'Only this account’s permitted-source records are aggregated; denied sources and their counts are not returned.',
                    'No recorded workouts is zero recorded workouts, not proof of inactivity. Missing measurements are unknown.',
                    'Protein requires every calendar day logged with known values; even those logs can be partial.',
                    'Duration falls back to elapsed seconds only when moving seconds are absent. No causal or medical inference.']}

    def _period(self, c, r, p, start, end, days):
        if r.metric == 'protein_g':
            row = c.execute('''SELECT count(*) AS records,count(DISTINCT day) AS logged_days,
                sum(value) FILTER(WHERE NOT unknown) AS known_total,
                count(*) FILTER(WHERE unknown) AS unknown_measurements,0 AS elapsed_fallbacks
                FROM (SELECT day,protein_g::double precision AS value,
                  (protein_g IS NULL OR NOT (protein_g>=0 AND protein_g<'Infinity'::double precision)
                   OR (CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array'
                       THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? 'protein_g') AS unknown
                  FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s) entries''',
                  (self._uid, start, end)).fetchone()
        else:
            # Identifiers are fixed app expressions; every external value remains a SQL parameter.
            expression = {'workouts': '1', 'distance_m': 'distance_m',
                          'duration_s': 'coalesce(moving_s,elapsed_s)'}[r.metric]
            row = c.execute('''SELECT count(*) AS records,NULL::int AS logged_days,
                sum(value) FILTER(WHERE value>=0 AND value<'Infinity'::double precision) AS known_total,
                count(*) FILTER(WHERE value IS NULL OR NOT (value>=0 AND value<'Infinity'::double precision)) AS unknown_measurements,
                count(*) FILTER(WHERE moving_s IS NULL AND elapsed_s IS NOT NULL) AS elapsed_fallbacks
                FROM (SELECT ('''+expression+''')::double precision AS value,moving_s,elapsed_s
                  FROM activities WHERE user_id=%s AND NOT lift_open
                    AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s
                    AND (%s::text IS NULL OR sport=%s)
                    AND (%s OR (source<>'healthkit' AND healthkit_id IS NULL))
                    AND (%s OR source<>'garmin_connect')) workouts''',
                (self._uid, p['tz'], start, end, r.sport, r.sport,
                 bool(p['health_ai_ok']), bool(p['garmin_ai_ok']))).fetchone()
        known = row['records'] if r.metric == 'workouts' else row['known_total']
        complete = not row['unknown_measurements'] and (r.metric != 'protein_g' or row['logged_days'] == days)
        return {'start': start, 'end': end, 'calendar_days': days, 'value': known if complete else None,
                'known_total': known, 'records': row['records'], 'logged_days': row['logged_days'],
                'unknown_measurements': row['unknown_measurements'],
                'duration_elapsed_fallbacks': row['elapsed_fallbacks'] if r.metric == 'duration_s' else 0}
