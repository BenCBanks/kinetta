"""Bounded application tools. The authenticated account is bound once, outside the model's schemas.

Structured records stay in PostgreSQL. Every tool uses fixed SQL, WHERE user_id and a restricted RLS role.
Tool outputs are evidence; notes/names are untrusted data, never tool instructions.
"""
import datetime as dt
import math

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


TOOLS = {
    'profile': (Empty, 'Read the current account time zone, units and nutrition targets; no identifying information.'),
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
        custom = c.execute('SELECT kcal FROM day_goals WHERE user_id = %s AND day = %s', (self._uid, r.day)).fetchone()
        kcal = custom['kcal'] if custom else p.get('kcal_target')
        dishes = c.execute('SELECT * FROM dishes WHERE user_id = %s ORDER BY updated DESC LIMIT 30', (self._uid,)).fetchall()
        candidates = []
        for raw in dishes:
            dish = dish_out(raw)
            if not complete_dish(raw) or not complete_food(dish['totals']): continue
            # Whole-dish shares avoid inventing a serving weight. The UI shows this explicitly before confirmation.
            for share in ([1] if dish['serving'] == 'one' else [.25, .5, 1]):
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
            'candidates': candidates, 'limitations': ['Remaining targets use the logged intake; incomplete logging can overstate what remains. Dietary preferences/allergies are not recorded: check before choosing.']}


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
