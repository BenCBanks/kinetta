"""Executed only inside the guarded fresh fixture. Output contains private test session tokens."""
import json
import os
import sys
sys.path.insert(0, '/srv')
from app import auth, db

assert os.environ.get('KINETTA_LOAD_FIXTURE') == '1'
count = int(os.environ['LOAD_USERS'])
assert 2 <= count <= 100
people = []
with db.connect() as c:
    assert c.execute('SELECT count(*) AS n FROM users').fetchone()['n'] == 0, 'Use a fresh disposable database'
    password = auth.hash_pw('fictional green teapot on the hill')
    for i in range(count):
        uid = c.execute('INSERT INTO users(login,name,pw_hash,is_admin) VALUES(%s,%s,%s,%s) RETURNING id',
                        (f'zz_test_load_{i:03}', f'Fictional Load {i:03}', password, i == 0)).fetchone()['id']
        c.execute("""INSERT INTO profile(user_id,tz,weight_kg,height_cm,birth_year,sex,ai_ok,ai_adult_at,
                     kcal_target,protein_target,setup_hidden,food_chat_auto_log)
                     VALUES(%s,'UTC',70,175,1990,'male',true,now(),2100,110,true,false)""", (uid,))
        aids = c.execute("""INSERT INTO activities(user_id,sport,name,start_time,elapsed_s,moving_s,distance_m,
                         calories,source,visibility) SELECT %s,'run','Fictional run',now()-d*interval '1 day',
                         1800,1800,5000,350,'manual','everyone' FROM generate_series(1,30) d RETURNING id""", (uid,)).fetchall()
        c.execute("""INSERT INTO food_entries(user_id,day,meal,name,kcal,protein_g,carbs_g,fat_g,fiber_g)
                     SELECT %s,current_date-d,'lunch','Fictional lunch',400,20,55,11,12
                     FROM generate_series(0,29) d CROSS JOIN generate_series(1,3) meal""", (uid,))
        c.execute("""INSERT INTO custom_foods(user_id,name,serving_label,serving_g,kcal,protein_g,carbs_g,fat_g)
                     SELECT %s,'Fictional saved food '||n,'1 bowl',300,400,20,55,11 FROM generate_series(1,10) n""", (uid,))
        people.append({'uid': uid, 'token': auth.new_session(c, uid, 'Fictional load fixture', channel='app'),
                       'activity': aids[0]['id']})
    for i, person in enumerate(people):
        friend = people[(i+1) % count]
        c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now()) ON CONFLICT DO NOTHING",
                  (min(person['uid'], friend['uid']), max(person['uid'], friend['uid'])))
print(json.dumps(people))
