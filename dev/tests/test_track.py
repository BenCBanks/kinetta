"""Reviewed sharing, reliable retries and strict point validation; isolated fictional accounts only."""
import concurrent.futures
import datetime as dt
import uuid
from kc import person, login, ALEX

owner = person('zz_test_track_owner')
viewer = person('zz_test_track_viewer')
def request(client, method, path, body=None, expected=200):
    status, result = client.req(method, path, body)
    assert status == expected, (path, status, result)
    return result

try:
    request(owner, 'PUT', '/api/sharing', {'default': 'everyone'})
    start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=400)
    body = {'client_id': str(uuid.uuid4()), 'sport': 'run', 'name': 'Fictional recorded run', 'start': start.isoformat(), 'moving_s': 100, 'elapsed_s': 200,
            'points': [{'lat': 0, 'lon': 10, 't': 1, 'accuracy': 5, 'segment': 0}, {'lat': .0001, 'lon': 10, 't': 6, 'accuracy': 5, 'segment': 0},
                       {'lat': 1, 'lon': 10, 't': 150, 'accuracy': 5, 'segment': 1}, {'lat': 1.0001, 'lon': 10, 't': 155, 'accuracy': 5, 'segment': 1}]}
    first = request(owner, 'POST', '/api/activities/track', body)
    aid = first['id']
    assert request(owner, 'POST', '/api/activities/track', body) == {'id': aid, 'duplicate': True}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: request(owner, 'POST', '/api/activities/track', body), range(2)))
    assert all(row['id'] == aid for row in results)
    fresh_body = dict(body, client_id=str(uuid.uuid4()))
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        raced = list(pool.map(lambda _: request(owner, 'POST', '/api/activities/track', fresh_body), range(12)))
    assert len({row['id'] for row in raced}) == 1 and sum(row['duplicate'] for row in raced) == 11, 'first concurrent save inserts exactly once'
    activity = request(owner, 'GET', f'/api/activities/{aid}')
    assert 22 < activity['distance_m'] < 23, activity
    assert activity['moving_s'] == 100 and activity['elapsed_s'] == 200
    assert activity['visibility'] == 'everyone', 'recording follows the account sharing default'
    assert request(viewer,'GET',f'/api/shared/{aid}')['id']==aid
    private=request(owner,'POST','/api/activities/track',dict(body,client_id=str(uuid.uuid4()),visibility='me'))
    assert request(owner,'GET',f"/api/activities/{private['id']}")['visibility']=='me'
    request(viewer,'GET',f"/api/shared/{private['id']}",expected=404)
    request(owner,'POST','/api/activities/track',dict(body,client_id=str(uuid.uuid4()),visibility='invalid'),expected=422)
    assert 'longest continuous' in activity['description']
    assert len(activity['track_lines']) == 2, 'owner detail preserves both recorded sections without joining them'
    request(owner, 'PATCH', f'/api/activities/{aid}', {'distance_m': 30})
    assert 'track_lines' not in request(owner, 'GET', f'/api/activities/{aid}'), 'corrections cannot re-expose original route'
    request(owner, 'PATCH', f'/api/activities/{aid}', {'restore_summary': ['distance_m']})
    request(viewer, 'GET', f'/api/activities/{aid}', expected=404)
    assert request(viewer, 'GET', '/api/people/zz_test_track_owner/profile')['overview']['activities'] == 2
    # A retried recording cannot change the audience after its original save.
    request(owner,'POST','/api/activities/track',dict(body,visibility='me'))
    assert request(owner,'GET',f'/api/activities/{aid}')['visibility']=='everyone'
    request(owner,'PUT','/api/sharing',{'default':'friends'})
    friends=request(owner,'POST','/api/activities/track',dict(body,client_id=str(uuid.uuid4())))
    assert request(owner,'GET',f"/api/activities/{friends['id']}")['visibility']=='friends'
    request(viewer,'GET',f"/api/shared/{friends['id']}",expected=404)
    # Same recording id on another account must neither expose nor mutate the first account's record.
    second = request(viewer, 'POST', '/api/activities/track', body)
    assert second['id'] != aid
    changed = dict(body, client_id=str(uuid.uuid4()), moving_s=300)
    request(owner, 'POST', '/api/activities/track', changed, expected=422)
    for points in [list(reversed(body['points'])), [dict(body['points'][0], lat=100)], [dict(body['points'][0], accuracy=101)], [dict(body['points'][0], t=999)]]:
        request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), points=points), expected=422)
    request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), moving_s=float('nan')), expected=422)
    for bad in [dict(body['points'][1], t=50), dict(body['points'][1], lat=20)]:
        request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), points=[body['points'][0], bad]), expected=422)
    yoga = request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), sport='workout', sport_label='Yoga', points=[], name='Fictional yoga'))
    detail = request(owner, 'GET', f"/api/activities/{yoga['id']}")
    assert detail['sport_label'] == 'Yoga' and detail['moving_s'] == 100
    print('PASS tracking: segments, sharing default/review, retry/concurrency, account isolation, invalid GPS and yoga')
finally:
    admin = login(*ALEX)
    for name in ('zz_test_track_owner', 'zz_test_track_viewer'):
        admin.post(f'/api/admin/people/{name}/remove', {'password': ALEX[1]})
