"""Kit's app-wide tools: fixed SQL, bound identity, bounded records and consent-aware scopes."""
import datetime as dt
from typing import Literal
from pydantic import Field
from . import db, coach
from .coach_tools import AccountTools, Empty, Range, Activity, TOOLS


class Page(Range):
    before_id: int | None = Field(default=None, gt=0)


class Stored(Empty):
    kind: Literal['recipes','foods','meals']
    record_id: int | None = Field(default=None,gt=0)
    before_id: int | None = Field(default=None,gt=0)


EXTRA = {
    'stored_foods': (Stored, 'Own saved recipes, custom foods or saved meal combinations, including incomplete nutrients. Lists are paginated; pass record_id for ingredient details of one own record. Missing/other-account IDs are not found. Read only; never invent missing nutrition.'),
    'activities': (Page, 'Own workouts of every sport in inclusive local dates, newest first. Up to 50 rows; use next_before_id for older rows. Includes exact totals and explicit missing-data limits.'),
    'food_log': (Page, 'Own individual food entries in inclusive local dates: meals, quantities, source and known nutrients. Up to 50 rows; next_before_id pages older records. Unlogged is not zero; unknown nutrient flags remain explicit.'),
    'strength_history': (Page, 'Own completed strength sets with exercise names, reps, kg and duration. Up to 50 sets per page; no invented strength values.'),
    'goals': (Empty, 'Own saved activity goals and nutrition targets. These are goals, not proof of completion.'),
    'body_profile': (Empty, 'Own entered body and heart-rate settings, including birth year and height. Requires Health sharing consent when the profile includes Health-derived weight. Unknown fields remain unknown.'),
    'gear': (Empty, 'Own equipment and recorded distance; no automatic replacement diagnosis. Read only.'),
    'resting_energy': (Range, 'Own synced Apple Health resting-energy observations; requires explicit Health sharing consent. Missing days stay unknown.'),
    'app_features': (Empty, 'Trusted Kinetta destinations for recording, food logging, goals, plans, strength, recipes, progress and privacy. Explain how to use features; only the person can open/edit them.'),
}


def specifications():
    return [{'name': n, 'description': d, 'input_schema': m.model_json_schema()} for n, (m, d) in {**TOOLS, **EXTRA}.items()]


class KitTools(AccountTools):
    def call(self, name, arguments, *, connection=None):
        catalog = {**TOOLS, **EXTRA}
        if not isinstance(name, str) or name not in catalog: raise ValueError('Unknown Kit tool')
        parsed = catalog[name][0].model_validate(arguments)
        ctx = db.coach_scope(connection, self._uid) if connection is not None else db.coach_connect(self._uid)
        with ctx as c:
            # Food/app tools remain usable without disclosing unconsented Health records.
            if name not in {'profile','nutrition_summary','meal_options','meal_combinations','food_log','stored_foods','goals','app_features'} and not coach.health_ok(c, self._uid):
                raise ValueError(coach.HEALTH_NO)
            return getattr(self, '_' + name)(c, parsed)

    def _profile(self, c, _):
        return c.execute('''SELECT tz,units,kcal_target,protein_target,carbs_target,fat_target,fiber_target,
          sodium_target_mg,sugar_target_g,saturated_fat_target_g,nutrition_goal,training_day_targets,
          (now() AT TIME ZONE tz)::date AS today FROM profile WHERE user_id=%s''',(self._uid,)).fetchone() or {}

    def _activity(self,c,r):
        row=c.execute('''SELECT id,sport,name,left(description,2000) AS description,start_time,distance_m,
          moving_s,elapsed_s,ascent_m,avg_hr,max_hr,avg_cad,avg_power,max_power,avg_temp,calories,effort,
          decoupling,vo2max,route_id FROM activities WHERE user_id=%s AND id=%s''',(self._uid,r.activity_id)).fetchone()
        if not row:raise ValueError('Activity not found')
        return row

    def _activities(self, c, r):
        tz = self._profile(c, Empty()).get('tz') or db.DEFAULT_TZ
        params = (self._uid,tz,r.start,r.end)
        where = 'user_id=%s AND (start_time AT TIME ZONE %s)::date BETWEEN %s AND %s'
        totals = c.execute('SELECT sport,count(*) AS workouts,sum(distance_m) AS distance_m,sum(moving_s) AS moving_s,sum(ascent_m) AS ascent_m FROM activities WHERE '+where+' GROUP BY sport ORDER BY sport',params).fetchall()
        rows = c.execute('''SELECT id,sport,name,start_time,distance_m,moving_s,ascent_m,avg_hr,effort,calories
          FROM activities WHERE '''+where+' AND (%s::bigint IS NULL OR id<%s) ORDER BY id DESC LIMIT 51',(*params,r.before_id,r.before_id)).fetchall()
        return {'activities':rows[:50],'totals_by_sport':totals,'next_before_id':rows[49]['id'] if len(rows)>50 else None,
                'limitations':['Totals include every own workout in the date range; listed records are paginated. Missing measurements are unknown.']}

    def _nutrition_summary(self,c,r):
        fields=('kcal','protein_g','carbs_g','fat_g','fiber_g','sodium_mg','sugar_g','saturated_fat_g')
        expressions=[]
        for k in fields:
            missing=f"({k} IS NULL OR (CASE WHEN jsonb_typeof(ref->'unknown_nutrients')='array' THEN ref->'unknown_nutrients' ELSE '[]'::jsonb END) ? '{k}')"
            expressions.extend([f'sum(CASE WHEN {missing} THEN 0 ELSE {k} END) AS {k}',f'count(*) FILTER(WHERE {missing}) AS {k}_unknown'])
        rows=c.execute('SELECT day,'+','.join(expressions)+',count(*) AS items FROM food_entries WHERE user_id=%s AND day BETWEEN %s AND %s GROUP BY day ORDER BY day',(self._uid,r.start,r.end)).fetchall()
        known={k:round(sum(float(d[k] or 0) for d in rows),1) for k in fields}
        unknown={k:sum(d[k+'_unknown'] for d in rows) for k in fields}
        totals={k:v if rows and not unknown[k] else None for k,v in known.items()}
        return {'start':r.start,'end':r.end,'calendar_days':(r.end-r.start).days+1,'logged_days':len(rows),
                'unlogged_days':(r.end-r.start).days+1-len(rows),'known_totals':known,'totals':totals,
                'unknown_food_counts':unknown,'average_per_logged_day':{k:round(v/len(rows),1) if v is not None else None for k,v in totals.items()},
                'limitations':['Unlogged days are missing, not zero intake. Partially logged days may understate intake. Unknown nutrients make full totals and averages unavailable; known totals only include supplied values.']}

    def _food_log(self, c, r):
        rows = c.execute('''SELECT id,day,meal,name,amount,unit,kcal,protein_g,carbs_g,fat_g,fiber_g,sodium_mg,sugar_g,saturated_fat_g,
          ref->'unknown_nutrients' AS unknown_nutrients,ref->>'origin' AS origin FROM food_entries
          WHERE user_id=%s AND day BETWEEN %s AND %s AND (%s::bigint IS NULL OR id<%s)
          ORDER BY id DESC LIMIT 51''',(self._uid,r.start,r.end,r.before_id,r.before_id)).fetchall()
        for row in rows:
            for key in row.get('unknown_nutrients') or []:
                if key in ('kcal','protein_g','carbs_g','fat_g','fiber_g','sodium_mg','sugar_g','saturated_fat_g'):row[key]=None
        return {'foods':rows[:50],'next_before_id':rows[49]['id'] if len(rows)>50 else None,
                'limitations':['Unknown nutrient flags take precedence over stored zero placeholders. No record means unlogged, not no food eaten.']}

    def _strength_history(self, c, r):
        tz=self._profile(c, Empty()).get('tz') or db.DEFAULT_TZ
        rows=c.execute('''SELECT s.id,s.activity_id,a.start_time,e.name AS exercise,s.reps,s.kg,s.secs,s.warmup
          FROM lift_sets s JOIN activities a ON a.id=s.activity_id AND a.user_id=s.user_id
          JOIN exercises e ON e.id=s.exercise_id AND e.user_id=s.user_id
          WHERE s.user_id=%s AND s.done AND NOT a.lift_open AND (a.start_time AT TIME ZONE %s)::date BETWEEN %s AND %s
          AND (%s::bigint IS NULL OR s.id<%s) ORDER BY s.id DESC LIMIT 51''',(self._uid,tz,r.start,r.end,r.before_id,r.before_id)).fetchall()
        summary=c.execute('''SELECT e.name AS exercise,count(*) AS completed_sets,max(s.kg) AS max_recorded_kg,
          max(s.reps) AS max_recorded_reps,sum(s.kg*s.reps) AS recorded_volume_kg,
          min((a.start_time AT TIME ZONE %s)::date) AS first_day,max((a.start_time AT TIME ZONE %s)::date) AS last_day
          FROM lift_sets s JOIN activities a ON a.id=s.activity_id AND a.user_id=s.user_id
          JOIN exercises e ON e.id=s.exercise_id AND e.user_id=s.user_id WHERE s.user_id=%s AND s.done AND NOT a.lift_open
          AND (a.start_time AT TIME ZONE %s)::date BETWEEN %s AND %s GROUP BY e.id ORDER BY e.id LIMIT 100''',(tz,tz,self._uid,tz,r.start,r.end)).fetchall()
        return {'sets':rows[:50],'summary_by_exercise':summary,'next_before_id':rows[49]['id'] if len(rows)>50 else None,
                'limitations':['Only recorded completed sets; missing sessions and unrecorded effort are unknown. Summaries cover the full date range; listed sets are paginated. A heavier recorded set does not alone establish a strength gain.']}

    def _goals(self,c,_):
        return {'activity_goals':c.execute('SELECT sport,period,metric,target FROM goals WHERE user_id=%s ORDER BY id LIMIT 50',(self._uid,)).fetchall(),
                'nutrition':self._profile(c, Empty()),'limitations':['Targets describe intentions, not measured results.']}

    def _body_profile(self,c,_):
        return c.execute('SELECT height_cm,weight_kg,birth_year,sex,max_hr,rest_hr,activity_factor FROM profile WHERE user_id=%s',(self._uid,)).fetchone() or {}

    def _stored_foods(self,c,r):
        from .api_dishes import _out
        fields=('kcal','protein_g','carbs_g','fat_g','fiber_g','sodium_mg','sugar_g','saturated_fat_g')
        # Table names come only from this fixed mapping, never from model SQL/identifiers.
        table={'recipes':'dishes','foods':'custom_foods','meals':'saved_meals'}[r.kind]
        rows=c.execute('SELECT * FROM '+table+' WHERE user_id=%s AND (%s::bigint IS NULL OR id=%s) AND (%s::bigint IS NULL OR id<%s) ORDER BY id DESC LIMIT 11',(self._uid,r.record_id,r.record_id,r.before_id,r.before_id)).fetchall()
        if r.record_id and not rows:raise ValueError('Stored food not found')
        def item(value):
            missing=(value.get('ref') or {}).get('unknown_nutrients') or []
            return {**{k:value.get(k) for k in ('name','amount','unit')},
                    **{k:None if k in missing else value.get(k) for k in fields}}
        out=[]
        for raw in rows[:10]:
            if r.kind=='recipes':
                d=_out(raw);entry={k:d[k] for k in ('id','name','totals','serving_count','per_serving','cooked_g')}
                if r.record_id:entry['ingredients']=[item(i) for i in d['items'][:60]]
            elif r.kind=='foods':
                entry={k:raw.get(k) for k in ('id','name','brand','serving_label','serving_g','origin',*fields)}
                for k in (raw.get('origin_ref') or {}).get('unknown_nutrients') or []:
                    if k in fields:entry[k]=None
            else:
                items=[item(i) for i in raw['items'][:60]]
                entry={'id':raw['id'],'name':raw['name'],'totals':{k:round(sum(float(i[k]) for i in items),1) if items and all(i[k] is not None for i in items) else None for k in fields}}
                if r.record_id:entry['foods']=items
            out.append(entry)
        return {'kind':r.kind,'records':out,'next_before_id':rows[9]['id'] if len(rows)>10 else None,
                'limitations':['Only your saved records, not another person’s recipes. Missing nutrition is unknown; saved food is not proof it was eaten. Ingredient details are returned only for an explicitly selected own record.']}

    def _gear(self,c,_):
        rows=c.execute('''SELECT g.id,g.kind,g.name,g.retired,g.alert_distance_m,g.start_distance_m+coalesce(sum(a.distance_m),0) AS distance_m
          FROM gear g LEFT JOIN activities a ON a.gear_id=g.id AND a.user_id=g.user_id
          WHERE g.user_id=%s GROUP BY g.id ORDER BY g.id DESC LIMIT 50''',(self._uid,)).fetchall()
        return {'gear':rows,'limitations':['Distance includes only recorded activities and the entered starting distance.']}

    def _resting_energy(self,c,r):
        p=c.execute('SELECT health_ai_ok,tz FROM profile WHERE user_id=%s',(self._uid,)).fetchone() or {}
        if not p.get('health_ai_ok'):raise ValueError(coach.HEALTH_NO)
        rows=c.execute('SELECT day,resting_kcal FROM health_resting WHERE user_id=%s AND day BETWEEN %s AND %s AND tz=%s ORDER BY day LIMIT 731',(self._uid,r.start,r.end,p.get('tz') or db.DEFAULT_TZ)).fetchall()
        return {'days':rows,'limitations':['Synced resting energy may be incomplete for today; missing days are unknown.']}

    def _app_features(self,c,_):
        return {'features':[
            {'label':'Add food','path':'/food?add=1','purpose':'Describe food, review portions, then explicitly add to the log.'},
            {'label':'Nutrition','path':'/food','purpose':'Food log, daily goals, food insights and weight.'},
            {'label':'Record a workout','path':'/track','purpose':'Start recording explicitly on the recording screen.'},
            {'label':'Activity history','path':'/activity?view=mine','purpose':'Find or edit your workouts.'},
            {'label':'Training plan','path':'/plan','purpose':'Set race, level and days; review proposed schedule changes.'},
            {'label':'Progress','path':'/progress','purpose':'Review trends and training history.'},
            {'label':'Strength','path':'/track','purpose':'Record exercises and sets.'},
            {'label':'Recipes','path':'/food/meals','purpose':'Manage private reusable recipes.'},
            {'label':'Goals and profile','path':'/me','purpose':'Manage your goals, units and profile.'},
            {'label':'Connections','path':'/me/connections','purpose':'Review Health connections and sharing consent.'}],
            'limitations':['Opening an editor does not change data. Confirmation is always a separate action.']}
