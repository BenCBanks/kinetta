"""Phone recording + the same workout from a watch become one activity (#234 item 3); fictional zz_test account only."""
import datetime as dt
import uuid
from kc import person, login, ALEX

me = person('zz_test_phone_watch')
now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def ok(result, expected=200):
    status, body = result
    assert status == expected, (status, body)
    return body


def phone(sport, start, seconds, name):
    body = {'client_id': str(uuid.uuid4()), 'sport': sport, 'name': name, 'start': start.isoformat(), 'elapsed_s': seconds, 'moving_s': seconds,
            'points': [], 'visibility': 'me'}
    return ok(me.post('/api/activities/track', body))['id']


def watch(kind, start, seconds, wid, hr=True):
    w = {'id': wid, 'type': kind, 'start': start.isoformat(), 'end': (start + dt.timedelta(seconds=seconds)).isoformat(), 'duration_s': seconds,
         'distance_m': seconds * 1.4, 'calories': 100}
    if hr: w['heart_rate'] = [{'t': (start + dt.timedelta(seconds=i * 60)).isoformat(), 'bpm': 120 + i % 7} for i in range(seconds // 60)]
    r = ok(me.post('/api/health/workouts', {'workouts': [w]}))
    return r['results'][0]['activity_id']


def count(since):
    rows = ok(me.get('/api/activities?limit=100'))
    return [a for a in rows if dt.datetime.fromisoformat(a['start_time']) >= since]


try:
    # 1. phone first (Walk), then the watch's copy labelled Hiking starting 3 minutes later: one activity, with heart rate
    t1 = now - dt.timedelta(hours=10)
    walk = phone('walk', t1, 1200, 'Fictional phone walk')
    merged = watch('hiking', t1 + dt.timedelta(minutes=3), 1080, 'zz-phone-watch-1')
    assert merged == walk, (merged, walk)
    a = ok(me.get(f'/api/activities/{walk}'))
    assert a['avg_hr'] and a['sport'] == 'walk' and a['name'] == 'Fictional phone walk', a
    # 2. watch first, then the phone recording of the same run (saved later): one activity
    t2 = now - dt.timedelta(hours=8)
    run = watch('running', t2, 1800, 'zz-phone-watch-2')
    assert phone('run', t2 + dt.timedelta(minutes=1), 1740, 'Fictional phone run') == run
    # 3. a short watch run inside a long phone hike is a different workout
    t3 = now - dt.timedelta(hours=6)
    hike = phone('hike', t3, 3 * 3600, 'Fictional long hike')
    assert watch('running', t3 + dt.timedelta(minutes=60), 1800, 'zz-phone-watch-3') != hike
    # 4. two phone recordings at the same time stay two (never merged with each other)
    t4 = now - dt.timedelta(hours=1)
    assert phone('walk', t4, 600, 'Fictional A') != phone('walk', t4, 600, 'Fictional B')
    assert len(count(now - dt.timedelta(hours=11))) == 6, [x['name'] for x in count(now - dt.timedelta(hours=11))]
    print('PASS phone + watch: one activity either order, Walk vs Hiking and a 3-minute start gap; short run inside a hike and two phone recordings stay separate')
finally:
    login(*ALEX).post('/api/admin/people/zz_test_phone_watch/remove', {'confirm': 'zz_test_phone_watch'})
