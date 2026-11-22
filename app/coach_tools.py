"""Bounded application tools. The authenticated account is bound once, outside the model's schemas.

Structured records stay in PostgreSQL. Every tool uses fixed SQL, WHERE user_id and a restricted RLS role.
Tool outputs are evidence; notes/names are untrusted data, never tool instructions.
"""
import datetime as dt
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from . import db, plans, energy
from .api_dishes import _out as dish_out


class Empty(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Range(Empty):
    start: dt.date
    end: dt.date

    @model_validator(mode='after')
    def bounded(self):
        if not 0 <= (self.end - self.start).days <= 730: raise ValueError('Use an ordered date range of at most two years')
        return self


class Activity(Empty):
    activity_id: int = Field(gt=0)


class Day(Empty):
    day: dt.date


class ComparisonRange(Range):
    @model_validator(mode='after')
    def comparable(self):
        days = (self.end - self.start).days + 1
        if days > 366 or self.start.toordinal() <= days:
            raise ValueError('Use up to 366 calendar days with room for a preceding equal period')
        return self


class Trend(Empty):
    metric: Literal['distance_m', 'duration_s', 'workouts', 'protein_g', 'kcal']
    window: int = Field(ge=2, le=366, strict=True)
    end: dt.date

    @model_validator(mode='after')
    def bounded(self):
        if self.end.toordinal() < self.window:
            raise ValueError('Window must fit within the calendar')
        return self


TOOLS = {
    'profile': (Empty, 'Read the current account time zone, units and nutrition targets; no identifying information.'),
    'period_compare': (ComparisonRange, 'Compare own recorded workouts, distance, duration and protein with the preceding equal-length period. Inclusive account-local dates, at most 366 days. Exact aggregates, missing counts and known subtotals; protein changes require logging on every day in both periods. No causal or medical conclusions.'),
    'trend': (Trend, 'Daily own recorded distance, duration, workout count, protein or calories over 2–366 inclusive local calendar days ending on end. Exact daily aggregates and least-squares slope per calendar day over known days only. Missing measurements/intake stay unknown. Uncertainty flags describe sparse, missing or variable observations, not statistical confidence or health status.'),
    'nutrition_summary': (Range, 'Exact SQL totals and average calories/protein/carbs/fat per logged day, inclusive dates. Missing days are unlogged, not zero intake. Use for averages since training began.'),
    'recent_runs': (Range, 'Recent running measurements including duration, distance, pace, heart rate, temperature and effort. At most 100 rows; exact aggregate counts report truncation. Easy effort is not inferred from missing data.'),
    'activity': (Activity, 'Own activity measurements by ID. Missing and other-account IDs are both not found. Never request someone else\'s data.'),
    'comparable_routes': (Activity, 'Same-route measurements for an own activity, in chronological order. Compare observed pace, heart rate and temperature, not unsupported causes.'),
    'weight_trend': (Range, 'Recorded weights in kg, with sample count and endpoint change. Endpoint change is not a trend model and missing weights stay missing.'),
    'training_load': (Range, 'Daily fitness/fatigue/form using the same 42/7-day load formula as the app. Missing effort limits interpretation; no medical diagnoses.'),
    'training_plan': (Empty, 'Current deterministic training settings and workouts, completed/missed status and race date. Read only; useful to find the date training began.'),
    'plan_options': (Empty, 'Read backend-generated permitted plan adjustments. Choose an existing candidate ID; never invent workouts, distances or scheduling rules.'),
    'meal_combinations': (Day, 'Read ranked combinations of existing saved dishes and usual foods, with SQL-backed quantities/macros and remaining targets. Choose an existing candidate ID, never supply nutrition numbers.'),
    'meal_options': (Day, 'Remaining recorded daily targets and own saved dishes/usual foods with deterministic quantities and macros. Only existing food values; no invented nutrition.'),
}


FOOD_TOOLS=frozenset({'profile','nutrition_summary','meal_combinations','meal_options'})
FOOD_NUM=('kcal','protein_g','carbs_g','fat_g','fiber_g')

def specifications(food_only=False):
    return [{'name': name, 'description': description, 'input_schema': model.model_json_schema()}
            for name, (model, description) in TOOLS.items() if not food_only or name in FOOD_TOOLS]


def load_curve(rows, end, start=None):
    by_day = {r['d']: float(r['load'] or 0) for r in rows}
    if not by_day: return []
    day, ctl, atl, out = min(by_day), 0.0, 0.0, []
    while day <= end:
        load = by_day.get(day, 0)
        ctl += (load - ctl) / 42; atl += (load - atl) / 7
        if start is None or day >= start:
            out.append({'day': day.isoformat(), 'load': round(load, 1), 'fitness': round(ctl, 1),
                        'fatigue': round(atl, 1), 'form': round(ctl - atl, 1)})
        day += dt.timedelta(days=1)
    return out


class AccountTools:
    def __init__(self, authenticated_user_id):
        if type(authenticated_user_id) is not int or authenticated_user_id <= 0: raise ValueError('Authenticated account required')
        self._uid = authenticated_user_id

    def call(self, name, arguments, *, connection=None):
        if not isinstance(name, str) or name not in TOOLS: raise ValueError('Unknown coach tool')
        parsed = TOOLS[name][0].model_validate(arguments)
        context = db.coach_scope(connection, self._uid) if connection is not None else db.coach_connect(self._uid)
        with context as c:
            return getattr(self, '_' + name)(c, parsed)

    def _profile(self, c, _):
        return c.execute('SELECT tz, units, max_hr, rest_hr, kcal_target, protein_target, carbs_target, fat_target FROM profile WHERE user_id = %s', (self._uid,)).fetchone() or {}

    def _period_compare(self, c, r):
        days = (r.end - r.start).days + 1
        previous_end = r.start - dt.timedelta(days=1)
        previous_start = r.start - dt.timedelta(days=days)
        tz = self._profile(c, Empty()).get('tz') or db.DEFAULT_TZ

        def period(start, end):
            # Aggregate the full range in SQL; no row limit can silently undercount.
            activity = c.execute('''SELECT count(*) AS workouts,
                count(DISTINCT (start_time AT TIME ZONE %s)::date) AS workout_days,
                sum(distance_m::double precision) AS distance_m,
                sum(coalesce(moving_s, elapsed_s)::double precision) AS duration_s,
                count(*) FILTER (WHERE distance_m IS NULL) AS distance_unknown,
                count(*) FILTER (WHERE moving_s IS NULL AND elapsed_s IS NULL) AS duration_unknown,
                count(*) FILTER (WHERE moving_s IS NULL AND elapsed_s IS NOT NULL) AS elapsed_fallbacks
                FROM activities WHERE user_id=%s AND NOT lift_open
                AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s''',
                (tz, self._uid, tz, start, end)).fetchone()
            food = c.execute('''SELECT count(*) AS items, count(DISTINCT day) AS logged_days,
                sum(protein_g::double precision) FILTER (WHERE NOT unknown) AS protein_g,
                count(*) FILTER (WHERE unknown) AS protein_unknown
                FROM (SELECT day, protein_g, (protein_g IS NULL OR
                    (CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array'
                     THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? 'protein_g') AS unknown
                    FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s) AS entries''',
                (self._uid, start, end)).fetchone()
            missing = {'distance_m': activity['distance_unknown'], 'duration_s': activity['duration_unknown'],
                       'protein_g': food['protein_unknown']}
            known = {key: activity[key] for key in ('distance_m', 'duration_s')}
            known['protein_g'] = food['protein_g']
            totals = {key: value if not missing[key] else None for key, value in known.items()}
            if food['logged_days'] != days:
                totals['protein_g'] = None
            totals['workouts'] = activity['workouts']
            return {'start': start, 'end': end, 'calendar_days': days, 'totals': totals,
                    'known_totals': known, 'unknown_measurement_counts': missing,
                    'workout_days': activity['workout_days'], 'food_logged_days': food['logged_days'],
                    'food_unlogged_days': days - food['logged_days'], 'food_items': food['items'],
                    'duration_elapsed_fallbacks': activity['elapsed_fallbacks'], 'truncated': False}

        current, previous = period(r.start, r.end), period(previous_start, previous_end)
        change = {}
        for key, value in current['totals'].items():
            before = previous['totals'][key]
            delta = value - before if value is not None and before is not None else None
            change[key] = {'absolute': delta,
                           'percent': round(delta / before * 100, 2) if delta is not None and before != 0 else None}
        return {'timezone': tz, 'current': current, 'previous': previous, 'change': change, 'truncated': False,
                'limitations': ['Counts describe recorded completed workouts, not all activity; unfinished lifting is excluded.',
                    'Duration uses moving seconds, falling back to elapsed seconds only when moving time is missing.',
                    'Unlogged food days and unknown protein make full-period protein totals and changes unknown. Even daily logging may be incomplete.',
                    'Known totals include supplied measurements only; no measurements means unknown. Comparisons do not establish causes or health status.']}

    def _trend(self, c, r):
        start = r.end - dt.timedelta(days=r.window - 1)
        tz = self._profile(c, Empty()).get('tz') or db.DEFAULT_TZ
        if r.metric in ('protein_g', 'kcal'):
            # Only these literal identifiers enter SQL; values and identity are bound.
            field = {'protein_g': 'protein_g', 'kcal': 'kcal'}[r.metric]
            rows = c.execute(f'''SELECT day, count(*) AS records,
                sum(value) FILTER (WHERE NOT unknown) AS known_total,
                count(*) FILTER (WHERE unknown) AS unknown_measurements,
                0 AS elapsed_fallbacks FROM (
                    SELECT day, {field}::double precision AS value, ({field} IS NULL OR
                        (CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array'
                         THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? %s) AS unknown
                    FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s
                ) AS entries GROUP BY day ORDER BY day''', (field, self._uid, start, r.end)).fetchall()
        else:
            value = {'distance_m': 'distance_m', 'duration_s': 'coalesce(moving_s, elapsed_s)',
                     'workouts': '1'}[r.metric]
            rows = c.execute(f'''SELECT (start_time AT TIME ZONE %s)::date AS day,
                count(*) AS records, sum(({value})::double precision) AS known_total,
                count(*) FILTER (WHERE ({value}) IS NULL) AS unknown_measurements,
                count(*) FILTER (WHERE moving_s IS NULL AND elapsed_s IS NOT NULL) AS elapsed_fallbacks
                FROM activities WHERE user_id=%s AND NOT lift_open
                AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s
                GROUP BY day ORDER BY day''', (tz, self._uid, tz, start, r.end)).fetchall()
        by_day = {row['day']: row for row in rows}
        days = []
        for offset in range(r.window):
            day = start + dt.timedelta(days=offset)
            row = by_day.get(day, {})
            known = row.get('known_total', 0 if r.metric == 'workouts' else None)
            unknown = row.get('unknown_measurements', 0)
            days.append({'day': day, 'value': known if not unknown else None, 'known_total': known,
                         'records': row.get('records', 0), 'unknown_measurements': unknown})
        # Use actual calendar offsets, never compress gaps between observed days.
        points = [(i, row['value']) for i, row in enumerate(days) if row['value'] is not None]
        count = len(points)
        slope = residual = span = None
        if count >= 2:
            mean_x = sum(x for x, _ in points) / count
            mean_y = sum(y for _, y in points) / count
            slope = sum((x - mean_x) * (y - mean_y) for x, y in points) / sum((x - mean_x)**2 for x, _ in points)
            residual = math.sqrt(sum((y - mean_y - slope * (x - mean_x))**2 for x, y in points) / count)
            span = points[-1][0] - points[0][0]
        reasons = []
        if count < 7: reasons.append('Fewer than seven known daily observations.')
        if count < r.window: reasons.append('Some calendar days have no complete measurement.')
        if residual is not None and residual > max(abs(slope) * span, 1e-9):
            reasons.append('Daily variation around the fitted line exceeds its end-to-end change.')
        return {'metric': r.metric, 'timezone': tz, 'start': start, 'end': r.end, 'calendar_days': r.window,
                'days': days, 'observed_days': count, 'unknown_days': r.window - count,
                'records': sum(row['records'] for row in days), 'slope_per_day': slope,
                'residual_rms': residual, 'observed_span_days': span,
                'uncertain': bool(reasons), 'uncertainty_reasons': reasons, 'truncated': False,
                'duration_elapsed_fallbacks': sum(row['elapsed_fallbacks'] for row in rows) if r.metric == 'duration_s' else 0,
                'limitations': ['Trend describes recorded daily totals, not all activity or actual intake. No causal or medical conclusions.',
                    'No recorded workouts means zero recorded count; absent distance, duration and food remain unknown.',
                    'A day with any unknown measurement is excluded from the fit; known subtotals remain visible. Food logging can be partial.',
                    'Duration uses moving seconds, falling back to elapsed seconds only when moving time is missing; unfinished lifting is excluded.',
                    'Slope uses known days and calendar spacing. Uncertainty is a descriptive coverage/variation flag, not statistical confidence or a forecast.']}

    def _nutrition_summary(self, c, r):
        # Missing nutrients remain missing, even when an older storage path uses
        # zero plus an explicit unknown flag. SQL names come only from this tuple.
        fields=[]
        for key in FOOD_NUM:
            unknown=f"({key} IS NULL OR (CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array' THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? '{key}')"
            fields += [f"sum(CASE WHEN {unknown} THEN 0 ELSE {key} END) AS {key}",f"count(*) FILTER (WHERE {unknown}) AS {key}_unknown"]
        rows=c.execute('SELECT day,'+','.join(fields)+',count(*) AS items FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s GROUP BY day ORDER BY day',(self._uid,r.start,r.end)).fetchall()
        count=len(rows)
        known={k:round(sum(float(day[k] or 0) for day in rows),1) for k in FOOD_NUM}
        missing={k:sum(day[k+'_unknown'] for day in rows) for k in FOOD_NUM}
        totals={k:known[k] if count and not missing[k] else None for k in FOOD_NUM}
        return {'start':r.start,'end':r.end,'calendar_days':(r.end-r.start).days+1,'logged_days':count,
                'unlogged_days':(r.end-r.start).days+1-count,'totals':totals,'known_totals':known,'unknown_food_counts':missing,
                'average_per_logged_day':{k:round(v/count,1) if count and v is not None else None for k,v in totals.items()},
                'limitations':['Unlogged days are missing data; partially logged days may understate intake. Unknown nutrients make their full totals and averages unavailable; known totals include only supplied values.']}

    def _recent_runs(self, c, r):
        tz = (self._profile(c, Empty()).get('tz') or db.DEFAULT_TZ)
        rows = c.execute('''SELECT id, (start_time AT TIME ZONE %s)::date AS day, distance_m, moving_s, avg_hr, avg_temp,
                           effort, route_id, CASE WHEN distance_m > 0 THEN moving_s / (distance_m / 1000) END AS pace_s_per_km
                           FROM activities WHERE user_id = %s AND sport = 'run' AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s
                           ORDER BY start_time DESC LIMIT 101''', (tz, self._uid, tz, r.start, r.end)).fetchall()
        totals = c.execute('''SELECT count(*) AS count, sum(distance_m) AS distance_m, sum(moving_s) AS moving_s FROM activities
                             WHERE user_id = %s AND sport = 'run' AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s''',
                           (self._uid, tz, r.start, r.end)).fetchone()
        return {'runs': rows[:100], 'totals': totals, 'truncated': len(rows) > 100,
                'limitations': ['Measurements do not establish that a run was intended to be easy or why pace changed.']}

    def _activity(self, c, r):
        row = c.execute('''SELECT id, sport, start_time, distance_m, moving_s, avg_hr, avg_temp, effort, route_id
                           FROM activities WHERE user_id = %s AND id = %s''', (self._uid, r.activity_id)).fetchone()
        if not row: raise ValueError('Activity not found')
        return row

    def _comparable_routes(self, c, r):
        activity = self._activity(c, r)
        if not activity['route_id']: return {'efforts': [], 'limitations': ['No matched route for this activity.']}
        rows = c.execute('''SELECT id, start_time, moving_s, distance_m, avg_hr, avg_temp,
                           CASE WHEN distance_m > 0 THEN moving_s / (distance_m / 1000) END AS pace_s_per_km
                           FROM activities WHERE user_id = %s AND route_id = %s ORDER BY start_time DESC LIMIT 101''',
                         (self._uid, activity['route_id'])).fetchall()
        return {'efforts': list(reversed(rows[:100])), 'truncated': len(rows) > 100}

    def _weight_trend(self, c, r):
        rows = c.execute('SELECT day, kg FROM weights WHERE user_id = %s AND day BETWEEN %s AND %s ORDER BY day',
                         (self._uid, r.start, r.end)).fetchall()
        trend = energy.weight_trend(rows)
        return {'samples': [{'day': d, 'kg': kg, 'trend_kg': round(float(v), 2)} for d, kg, v in trend], 'count': len(rows),
                'endpoint_change_kg': round(float(rows[-1]['kg']) - float(rows[0]['kg']), 2) if len(rows) > 1 else None,
                'limitations': ['Endpoint change can reflect short-term fluctuation; it is not a causal explanation.']}

    def _training_load(self, c, r):
        tz = self._profile(c, Empty()).get('tz') or db.DEFAULT_TZ
        rows = c.execute('''SELECT (start_time AT TIME ZONE %s)::date AS d, sum(effort) AS load FROM activities
                           WHERE user_id = %s AND effort IS NOT NULL AND (start_time AT TIME ZONE %s)::date <= %s GROUP BY 1 ORDER BY 1''',
                         (tz, self._uid, tz, r.end)).fetchall()
        missing = c.execute('''SELECT count(*) AS n FROM activities WHERE user_id = %s AND effort IS NULL
                              AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s''', (self._uid, tz, r.start, r.end)).fetchone()['n']
        return {'days': load_curve(rows, r.end, r.start), 'activities_without_effort': missing,
                'limitations': ['Fitness/fatigue are training-load estimates, not measurements of recovery or health.']}

    def _training_plan(self, c, _):
        # Reuse the engine and completion rules while substituting its DB connection with the bound RLS connection.
        current = plans.current_from_connection(c, self._uid)
        if not current.get('plan'): return current
        today = dt.date.fromisoformat(current['today'])
        current['weeks'] = [wk for wk in current['weeks']
                            if (today - dt.timedelta(days=21)).isoformat() <= wk['start'] <= (today + dt.timedelta(days=14)).isoformat()]
        current['limited_to_nearby_weeks'] = True
        return current

    def _plan_options(self, c, _):
        from .coach_proposals import plan_options
        current = self._training_plan(c, Empty())
        today = dt.date.fromisoformat(current.get('today') or dt.date.today().isoformat())
        load = self._training_load(c, Range(start=today - dt.timedelta(days=14), end=today))
        return plan_options(current, load)

    def _meal_combinations(self, c, r):
        from .coach_proposals import meal_combinations
        return meal_combinations(self._meal_options(c, r))

    def _meal_options(self, c, r):
        p = self._profile(c, Empty())
        eaten = c.execute('''SELECT coalesce(sum(kcal), 0) AS kcal, coalesce(sum(protein_g), 0) AS protein_g
                            FROM food_entries WHERE user_id = %s AND day = %s''', (self._uid, r.day)).fetchone()
        unknown=c.execute("SELECT bool_or(protein_g IS NULL OR (CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array' THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? 'protein_g') AS protein, bool_or(kcal IS NULL OR (CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array' THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? 'kcal') AS kcal FROM food_entries WHERE user_id=%s AND day=%s",(self._uid,r.day)).fetchone()
        # Only the calculated food goal enters the tool response; no raw training/body records.
        from . import energy
        kcal=energy.day_goal(c,self._uid,r.day)['kcal']
        dishes = c.execute('SELECT * FROM dishes WHERE user_id = %s ORDER BY updated DESC LIMIT 30', (self._uid,)).fetchall()
        candidates = []
        for raw in dishes:
            dish = dish_out(raw)
            if not complete_dish(raw) or not complete_food(dish['totals']): continue
            # Whole-dish shares avoid inventing a serving weight. The UI shows this explicitly before confirmation.
            for share in ([1/dish['serving_count']] if dish['serving'] == 'one' else [.25, .5, 1]):
                candidates.append({'source': 'dish', 'source_id': dish['id'], 'name': dish['name'], 'share': share,
                                   'amount': share, 'unit': 'dish',
                                   **{k: round((dish['totals'].get(k) or 0) * share, 1) for k in ('kcal', 'protein_g', 'carbs_g', 'fat_g')}})
        usual = c.execute('''SELECT name, amount, unit, kcal, protein_g, carbs_g, fat_g, ref, id FROM
                            (SELECT DISTINCT ON (lower(name)) *, count(*) OVER (PARTITION BY lower(name)) AS n FROM food_entries
                             WHERE user_id = %s AND day BETWEEN %s - 60 AND %s ORDER BY lower(name), created DESC) x
                            WHERE n >= 3 ORDER BY n DESC LIMIT 12''', (self._uid, r.day, r.day)).fetchall()
        for food in usual:
            if not complete_food(food,food.get('ref')):continue
            candidates.append({**{k: food[k] for k in ('name', 'amount', 'unit', 'kcal', 'protein_g', 'carbs_g', 'fat_g')},
                               'source': 'usual', 'source_id': food['id']})
        for i, food in enumerate(candidates): food['candidate_id'] = str(i)
        if unknown['protein']:eaten['protein_g']=None
        if unknown['kcal']:eaten['kcal']=None
        return {'day': r.day, 'eaten': eaten, 'remaining': {
            'kcal': round(float(kcal) - float(eaten['kcal']), 1) if kcal and not unknown['kcal'] else None,
            'protein_g': round(float(p['protein_target']) - float(eaten['protein_g']), 1) if p.get('protein_target') and not unknown['protein'] else None},
            'candidates': [] if unknown['kcal'] else candidates, 'limitations': ['Remaining targets use the logged intake; incomplete logging can overstate what remains. Dietary preferences/allergies are not recorded: check before choosing.']}


def complete_dish(raw):
    # A calories-only recipe is not evidence that its missing macros are zero.
    for key in ('kcal','protein_g','carbs_g','fat_g'):
        if raw.get('known_'+key) is not None:continue
        if not raw['items'] or any(item.get(key) is None or key in ((item.get('ref') or {}).get('unknown_nutrients') or []) for item in raw['items']):return False
    return True


def complete_food(values,ref=None):
    missing=(ref or {}).get('unknown_nutrients');missing=missing if isinstance(missing,list) else []
    return bool(values.get('kcal')) and all(k not in missing and isinstance(values.get(k),(int,float)) and math.isfinite(values[k]) and values[k]>=0 for k in ('kcal','protein_g','carbs_g','fat_g'))


class FoodTools(AccountTools):
    """A smaller existing-tool scope: food only, with no route to Health/body data."""
    def call(self,name,arguments,*,connection=None):
        if not isinstance(name,str) or name not in FOOD_TOOLS:raise ValueError('Unknown food tool')
        return super().call(name,arguments,connection=connection)

    def _profile(self,c,_):
        return c.execute('SELECT tz,units,kcal_target,protein_target,carbs_target,fat_target,fiber_target FROM profile WHERE user_id=%s',(self._uid,)).fetchone() or {}
