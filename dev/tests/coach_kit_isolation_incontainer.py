"""Call every Kit tool as A; B-only sentinel data must never cross the account boundary."""
import datetime as dt
import json
from app import coach, db
from app.kit_tools import KitTools, specifications

SENTINEL = 'B_ONLY_KIT_SENTINEL_7f4d'
START, END = dt.date(2021, 1, 1), dt.date(2021, 1, 7)
RANGE = {'start': START.isoformat(), 'end': END.isoformat()}

with db.connect() as c:
    a = c.execute("SELECT id FROM users WHERE login='zz_test_kit_iso_a'").fetchone()['id']
    b = c.execute("SELECT id FROM users WHERE login='zz_test_kit_iso_b'").fetchone()['id']
    off = c.execute("SELECT id FROM users WHERE login='zz_test_kit_iso_health_off'").fetchone()['id']
    c.execute("""UPDATE profile SET tz='UTC', units='imperial', health_ai_ok=true,
        health_weight_ai_ok=true, weight_health_derived=false WHERE user_id IN (%s,%s)""", (a, b))
    c.execute("""UPDATE profile SET tz='UTC', units='imperial', health_ai_ok=false,
        health_weight_ai_ok=false, weight_health_derived=false WHERE user_id=%s""", (off,))
    c.execute("INSERT INTO gear(user_id,kind,name,start_distance_m) VALUES (%s,'shoe',%s,0)", (b, SENTINEL))
    activity_a = c.execute("""INSERT INTO activities
        (user_id,sport,source,name,start_time,distance_m,moving_s,elapsed_s,effort)
        VALUES (%s,'run','manual','A fixture run','2021-01-03T12:00:00Z',5000,1500,1600,42)
        RETURNING id""", (a,)).fetchone()['id']
    activity_b = c.execute("""INSERT INTO activities
        (user_id,sport,source,name,start_time,distance_m,moving_s,elapsed_s,effort)
        VALUES (%s,'run','manual',%s,'2021-01-03T13:00:00Z',99999,9999,10000,999)
        RETURNING id""", (b, SENTINEL)).fetchone()['id']
    c.execute("""INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,ref)
        VALUES (%s,'2021-01-03','lunch','A fixture food',400,25,40,10,'{}')""", (a,))
    c.execute("""INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,ref)
        VALUES (%s,'2021-01-03','lunch',%s,9999,999,999,999,'{}')""", (b, SENTINEL))
    c.execute("INSERT INTO weights(user_id,day,kg) VALUES (%s,'2021-01-03',70)", (a,))
    c.execute("INSERT INTO weights(user_id,day,kg) VALUES (%s,'2021-01-03',99)", (b,))
    c.execute("INSERT INTO saved_meals(user_id,name,items) VALUES (%s,%s,%s)", (b, SENTINEL, json.dumps([])))
    c.execute("INSERT INTO goals(user_id,sport,period,metric,target) VALUES (%s,'run','week','distance',999999)", (b,))
    exercise_b = c.execute("INSERT INTO exercises(user_id,name) VALUES (%s,%s) RETURNING id", (b, SENTINEL)).fetchone()['id']
    c.execute("""INSERT INTO lift_sets(user_id,activity_id,exercise_id,pos,n,reps,kg,done)
        VALUES (%s,%s,%s,0,0,9,999,true)""", (b, activity_b, exercise_b))
    c.execute("""INSERT INTO training_plans(user_id,race,level,weeks,runs,long_day,start_day,race_day,unit,start_vol)
        VALUES (%s,'10k','beginner',4,3,6,'2020-12-01','2021-02-01','km',10)""", (b,))
    c.execute("""INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time)
        VALUES (%s,%s,'run',5000,%s,999,'2021-01-03T13:00:00Z')""", (b, activity_b, SENTINEL))
    # A no-consent account with no Health rows is intentionally allowed to use
    # tools that have no Health data to disclose. Seed one Health activity so
    # every Health-gated call below must exercise the consent refusal.
    c.execute("""INSERT INTO activities(user_id,sport,source,name,start_time,distance_m,moving_s,elapsed_s)
        VALUES (%s,'run','healthkit','Off-account Health fixture','2021-01-03T14:00:00Z',1,1,1)""", (off,))

catalog = {
    'profile': {},
    'nutrition_summary': RANGE,
    'period_compare': {'start': '2021-01-08', 'end': '2021-01-14'},
    'trend': {'metric': 'distance_m', 'window': 7, 'end': END.isoformat()},
    'consistency': RANGE,
    'nutrition_adequacy': RANGE,
    'personal_records': {'limit': 20},
    'pace_vs_effort': RANGE,
    'recent_runs': RANGE,
    'activity': {'activity_id': activity_a},
    'comparable_routes': {'activity_id': activity_a},
    'weight_trend': RANGE,
    'training_load': RANGE,
    'training_plan': {},
    'plan_options': {},
    'meal_combinations': {'day': END.isoformat()},
    'meal_options': {'day': END.isoformat()},
    'stored_foods': {'kind': 'meals'},
    'activities': RANGE,
    'food_log': RANGE,
    'nutrition_days_vs_goal': RANGE,
    'strength_history': RANGE,
    'goals': {},
    'body_profile': {},
    'gear': {},
    'resting_energy': RANGE,
    'app_features': {},
}

# Keep this fixture honest as KitTools grows. The pace tool is on its merged
# feature branch but not yet on the current main base; it joins automatically
# when that tool is present, rather than silently being replaced by a stale
# hand-maintained catalog.
registered = {spec['name'] for spec in specifications()}
missing = set(catalog) - registered
assert missing <= {'pace_vs_effort'}, sorted(missing)
catalog = {name: arguments for name, arguments in catalog.items() if name in registered}
assert set(catalog) == registered, (sorted(registered - set(catalog)), sorted(set(catalog) - registered))

# These are the tools that KitTools deliberately allows without Health consent.
health_gated = set(catalog) - {
    'profile', 'nutrition_summary', 'nutrition_adequacy', 'meal_combinations', 'meal_options',
    'stored_foods', 'food_log', 'nutrition_days_vs_goal', 'goals', 'app_features',
}
outputs = {}
kit = KitTools(a)
for name, arguments in catalog.items():
    try:
        outputs[name] = kit.call(name, arguments)
    except Exception as error:
        raise AssertionError(f'{name} fixture invocation failed: {error}') from error
    rendered = json.dumps(outputs[name], default=str, sort_keys=True)
    assert SENTINEL not in rendered, f'{name} leaked another account sentinel'

# Every Health-gated tool must refuse a real account with Health consent off.
off_kit = KitTools(off)
for name in sorted(health_gated):
    try:
        off_kit.call(name, catalog[name])
    except ValueError as error:
        assert str(error) == coach.HEALTH_NO, (name, str(error))
    else:
        raise AssertionError(f'{name} disclosed Health-scoped data without consent')

assert outputs['profile']['tz'] == 'UTC'
assert outputs['nutrition_summary']['totals']['protein_g'] == 25
assert outputs['activities']['activities'][0]['id'] == activity_a
assert outputs['food_log']['foods'][0]['name'] == 'A fixture food'
print(f'Kit catalog isolation: {len(catalog)} tools exclude the B-only sentinel; {len(health_gated)} Health-gated tools refuse consent-off account PASS')
