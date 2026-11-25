"""Bounded own-account chart measurements, reusable by future deterministic tools."""
import datetime as dt
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import coach, db
from .auth import current_user


class SeriesRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    metric: Literal['distance', 'time', 'pace', 'ascent', 'avg_hr', 'calories', 'workouts'] = 'distance'
    aggregate: Literal['sum', 'average', 'max'] = 'sum'
    group_by: Literal['workout', 'day', 'week', 'month'] = 'week'
    period_unit: Literal['days', 'weeks'] = 'weeks'
    period_count: int = Field(default=12, ge=1, le=52)
    sport: Literal['all', 'run', 'ride', 'walk', 'hike', 'swim', 'strength'] = 'all'

    @model_validator(mode='after')
    def compatible(self):
        if self.metric in ('pace', 'avg_hr') and self.aggregate == 'sum':
            raise ValueError('Pace and heart rate cannot be summed')
        if self.metric == 'workouts' and self.aggregate != 'sum':
            raise ValueError('Workouts supports sum only')
        return self


# Only application-owned expressions enter SQL. Caller values are always parameters.
MEASUREMENTS = {
    'distance': ('distance_m', 'm'), 'time': ('coalesce(moving_s, elapsed_s)', 's'),
    'ascent': ('ascent_m', 'm'), 'avg_hr': ('avg_hr', 'bpm'),
    'calories': ('calories', 'kcal'), 'workouts': ('1', 'workouts'),
    'pace': ('CASE WHEN distance_m>0 AND elapsed_s>0 THEN elapsed_s::double precision*1000/distance_m END', 's/km'),
}
GROUPS = {'day': 'local_day', 'week': "date_trunc('week', local_day)::date",
          'month': "date_trunc('month', local_day)::date", 'workout': 'start_time, id'}
AGGREGATES = {'sum': 'sum(value)', 'average': 'sum(value*weight)/nullif(sum(weight) FILTER(WHERE value IS NOT NULL),0)', 'max': 'max(value)'}


def _bucket(day, group):
    if group == 'week': return day - dt.timedelta(days=day.weekday())
    return day.replace(day=1) if group == 'month' else day


def _next(day, group):
    if group == 'month': return (day.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return day + dt.timedelta(days=7 if group == 'week' else 1)


def read_series(c, user_id, request, *, now=None):
    """Authenticated identity and read-only RLS scope also apply to internal callers."""
    with db.coach_scope(c, user_id):
        if not coach.health_ok(c, user_id): raise HTTPException(403, coach.HEALTH_NO)
        profile = c.execute('SELECT tz FROM profile WHERE user_id=%s', (user_id,)).fetchone() or {}
        tz = ZoneInfo(db.valid_tz(profile.get('tz')) or db.DEFAULT_TZ)
        now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(tz)
        today = now.date()
        start = (today - dt.timedelta(days=request.period_count-1) if request.period_unit == 'days'
                 else _bucket(today, 'week') - dt.timedelta(weeks=request.period_count-1))
        buckets = []
        if request.group_by != 'workout':
            day = _bucket(start, request.group_by)
            while day <= today:
                buckets.append(day)
                day = _next(day, request.group_by)
            limit = {'day': 30, 'week': 26, 'month': 12}[request.group_by]
            if len(buckets) > limit: raise HTTPException(422, f'Use at most {limit} {request.group_by} points')
        expression, unit = MEASUREMENTS[request.metric]
        # Pace is distance-weighted and HR time-weighted; unknown durations remain missing.
        weight = 'distance_m' if request.metric == 'pace' else 'coalesce(moving_s,elapsed_s)' if request.metric == 'avg_hr' else '1'
        group = GROUPS[request.group_by]
        selected_group = 'start_time AS bucket,id' if request.group_by == 'workout' else group+' AS bucket'
        order = 'bucket DESC,id DESC' if request.group_by == 'workout' else 'bucket DESC'
        value_sql = AGGREGATES[request.aggregate]
        rows = c.execute(f'''WITH scoped AS (
            SELECT id,start_time,(start_time AT TIME ZONE %(tz)s)::date AS local_day,
                ({expression})::double precision AS measurement,({weight})::double precision AS weight
            FROM activities WHERE user_id=%(uid)s AND NOT lift_open
              AND start_time>=%(start)s AND start_time<=%(now)s
              AND (%(sport)s='all' OR sport=%(sport)s)
        ), measured AS (
            SELECT *,CASE WHEN measurement>=0 AND measurement<'Infinity'::float8
                AND weight>0 AND weight<'Infinity'::float8 THEN measurement END AS value FROM scoped
        ) SELECT {selected_group},count(*) AS n,count(*) FILTER(WHERE value IS NULL) AS missing,
            {value_sql} AS value,sum(value*weight) AS weighted_sum,
            sum(weight) FILTER(WHERE value IS NOT NULL) AS weight_sum,sum(value) AS total
          FROM measured GROUP BY {group} ORDER BY {order}
          {'LIMIT 31' if request.group_by == 'workout' else ''}''',
            {'tz': str(tz), 'uid': user_id, 'start': dt.datetime.combine(start,dt.time.min,tz),
             'now': now, 'sport': request.sport}).fetchall()
    truncated = request.group_by == 'workout' and len(rows) > 30
    rows = list(reversed(rows[:30] if request.group_by == 'workout' else rows))
    empty_value = 0 if request.aggregate == 'sum' else None
    if buckets:
        by_start = {row['bucket']: row for row in rows}
        plotted = [(day, by_start.get(day)) for day in buckets]
    else:
        plotted = [(row['bucket'], row) for row in rows]
    points = [{'start': day.isoformat(), 'value': float(row['value']) if row and row['value'] is not None else (empty_value if not row else None),
               'n': row['n'] if row else 0, 'missing': row['missing'] if row else 0,
               'in_progress': request.group_by != 'workout' and _next(day, request.group_by) > today}
              for day, row in plotted]
    values = [point['value'] for point in points if point['value'] is not None and point['n'] > point['missing']]
    if request.aggregate == 'average':
        numerator = sum(float(row['weighted_sum'] or 0) for row in rows)
        denominator = sum(float(row['weight_sum'] or 0) for row in rows)
        overall = numerator/denominator if denominator else None
    elif request.aggregate == 'max': overall = max(values) if values else None
    else: overall = sum(float(row['total'] or 0) for row in rows) if values else (0 if not rows else None)
    first, last = (values[0], values[-1]) if values else (None, None)
    change = last-first if len(values) > 1 else None
    mean = sum(abs(value) for value in values)/len(values) if values else 0
    direction = None if change is None else 'flat' if change == 0 or abs(change) < mean*.1 else 'up' if change > 0 else 'down'
    return {**request.model_dump(), 'timezone': str(tz), 'start': start.isoformat(), 'end': today.isoformat(), 'unit': unit,
            'points': points, 'truncated': truncated, 'summary': {'overall': overall, 'first': first, 'last': last,
            'highest': max(values) if values else None, 'lowest': min(values) if values else None,
            'change': change, 'direction': direction}, 'workouts': sum(row['n'] for row in rows),
            'missing': sum(row['missing'] for row in rows)}


def series(query: Annotated[SeriesRequest, Query()], user=Depends(current_user)):
    with db.coach_connect(user['id']) as c:
        return read_series(c, user['id'], query)
