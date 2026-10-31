"""Real SQL/HTTP ownership, private history, honest teasers and no read-side effects."""
import datetime as dt
import json
import os
import subprocess

from kc import Client, PW, person

project = os.environ.get('KINETTA_PROJECT', 'kinettatest')
assert project != 'kinetta' and (project.startswith('kt-') or project in ('kinettatest', 'shots'))
people = []
for suffix in ('empty', 'runner', 'food'):
    name = 'zz_test_overview_' + suffix
    previous = person(name)
    previous.post('/api/account/delete', {'password': PW})
    people.append(person(name))
success = False


def get(c, path='/api/progress/overview'):
    status, result = c.get(path)
    assert status == 200, (status, result)
    return result


def sql(text):
    p = subprocess.run(['docker', 'exec', '-i', project+'-db-1', 'psql', '-U', 'postgres', '-d', 'fit', '-v', 'ON_ERROR_STOP=1', '-At'], input=text, text=True, capture_output=True)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


try:
    empty, runner, food = people
    ids = [get(c, '/api/me')['id'] for c in people]
    for c in people:
        assert c.put('/api/profile', {'tz': 'Pacific/Kiritimati'})[0] == 200
    before = get(empty)
    assert before['activities'] == before['mapped'] == before['active_days'] == before['routes'] == before['segments'] == 0
    assert before['record'] is before['lifting'] is before['plan'] is None
    assert before['food'] == {'protein_days': None, 'weight_change_kg': None, 'library_items':0, 'weight_kg':None, 'logged_days':0, 'reminders_on':False}
    today = dt.date.fromisoformat(before['today'])   # just after midnight in UTC+14, so today's runs stay within the 1-hour future allowance at any UTC hour
    aid = runner.post('/api/activities/manual', {'sport': 'run', 'start': f'{today}T00:00:00+14:00', 'duration_s': 1500, 'distance_m': 5000, 'name': 'Fictional private run'})[1]['id']
    assert runner.put(f'/api/activities/{aid}/sharing', {'visibility': 'me'})[0] == 200
    second = runner.post('/api/activities/manual', {'sport': 'run', 'start': f'{today}T00:30:00+14:00', 'duration_s': 1500, 'distance_m': 5000, 'name': 'Fictional second run'})[1]['id']
    for offset in range(1, 7):
        day = today - dt.timedelta(days=offset * 5)
        assert runner.post('/api/activities/manual', {'sport': 'run', 'start': f'{day}T01:00:00+14:00', 'duration_s': 1800, 'distance_m': 5000, 'name': 'Fictional training run'})[0] == 200
    uid = ids[1]
    sql(f"""WITH r AS (INSERT INTO routes(user_id,sport,name) VALUES({uid},'run','Fictional loop') RETURNING id)
        UPDATE activities SET route_id=(SELECT id FROM r),geom=ST_GeomFromText('LINESTRING(-77.04 38.90,-77.03 38.91)',4326)
        WHERE user_id={uid} AND id IN ({aid},{second});
        UPDATE activities SET effort=50 WHERE user_id={uid};
        INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time)
        SELECT user_id,id,sport,5000,'5K',1500,start_time FROM activities WHERE user_id={uid} AND id={aid};""")
    own = get(runner)
    active_days = len({today} | {today-dt.timedelta(days=i*5) for i in range(1,7) if today-dt.timedelta(days=i*5) >= today.replace(day=1)})
    assert own['activities'] == 8 and own['mapped'] == 2 and own['active_days'] == active_days and own['routes'] == 1
    assert own['record']['label'] == '5K' and own['record']['elapsed_s'] == 1500
    assert get(empty) == before, 'another account must not inherit any of the runner’s facts'
    assert food.put('/api/food/targets', {'protein_target': 100})[0] == 200
    assert food.post('/api/food/entries', [{'day': str(today), 'meal': 'lunch', 'name': 'Fictional meal', 'kcal': 600, 'protein_g': 110, 'carbs_g': 70, 'fat_g': 20}])[0] == 200
    for d, kg in [(today-dt.timedelta(days=7), 75), (today, 74)]:
        assert food.put('/api/food/weights', {'day': str(d), 'kg': kg})[0] == 200
    sql(f"""INSERT INTO dishes(user_id,name) VALUES({ids[2]},'Fictional saved recipe'),({ids[1]},'Fictional other recipe'),({ids[2]},'New dish');
        UPDATE profile SET food_reminders=true WHERE user_id={ids[2]};""")
    assert food.post('/api/food/foods', {'name':'Fictional saved food','kcal':100})[0] == 200
    own_food = get(food)
    assert own_food['food']['protein_days'] == 1 and own_food['food']['weight_change_kg'] < 0
    assert own_food['food']['library_items']==2 and own_food['food']['weight_kg']==74 and own_food['food']['logged_days']==1 and own_food['food']['reminders_on'] is True
    assert own_food['mapped'] == 0 and own_food['record'] is None
    assert get(runner)['food'] == {'protein_days': None, 'weight_change_kg': None, 'library_items':1, 'weight_kg':None, 'logged_days':0, 'reminders_on':False}
    assert get(empty) == before
    assert Client().get('/api/progress/overview')[0] == 401
    assert empty.get('/api/progress/overview?user_id='+str(uid))[1] == before, 'a caller cannot choose another account'
    assert not any(word in json.dumps(own) for word in ('user_id', 'Fictional private run', 'visibility', 'geom', 'friends'))
    for c in people:
        assert get(c) == get(c), 'reading must not create plans, exercises or other facts'
    success = True
finally:
    if not success or not os.environ.get('KINETTA_KEEP_PROGRESS'):
        for c in people:
            c.post('/api/account/delete', {'password': PW})

print('Progress overview: authenticated isolation across three accounts, Only me totals, timezone active days, routes, records, protein and weight, no read writes PASS')
