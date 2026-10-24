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
                       {'lat': 1, 'lon': 10, 't': 150, 'accuracy': 5, 'segment': 1}, {'lat': 1.0001, 'lon': 10, 't': 155, 'accuracy': 5, 'segment': 1}], 'expected_sharing_default': 'everyone'}
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
    legacy={k:v for k,v in body.items() if k!='expected_sharing_default'}
    old_app=request(owner,'POST','/api/activities/track',dict(legacy,client_id=str(uuid.uuid4())))
    assert request(owner,'GET',f"/api/activities/{old_app['id']}")['visibility']=='me','older app builds without the picker keep their private promise'
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
    # A stale displayed default cannot silently republish a private/friends-only workout.
    changed_default=request(owner,'POST','/api/activities/track',dict(body,client_id=str(uuid.uuid4()),expected_sharing_default='everyone'),expected=409)
    assert changed_default['detail']['code']=='sharing_changed' and changed_default['detail']['sharing_default']=='friends'
    friends=request(owner,'POST','/api/activities/track',dict(body,client_id=str(uuid.uuid4()),expected_sharing_default='friends'))
    # A lost acknowledgement remains idempotent even when the default later changes.
    assert request(owner,'POST','/api/activities/track',dict(body,expected_sharing_default='me'))=={'id':aid,'duplicate':True}
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
    yoga = request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), sport='workout', sport_label='Yoga', points=[], name='Fictional yoga', expected_sharing_default='friends'))
    detail = request(owner, 'GET', f"/api/activities/{yoga['id']}")
    assert detail['sport_label'] == 'Yoga' and detail['moving_s'] == 100
    # The shared distance filter (#234 item 2): the server keeps the same distance the phone showed.
    import json, os
    fixture = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'gps_filter.json')))
    for name, c in fixture['cases'].items():
        last = c['points'][-1]['t'] + 1
        saved = request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), sport=c['sport'], name='Fictional ' + name, visibility='me',
            start=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=2000)).isoformat(), elapsed_s=last, moving_s=last, points=c['points']))
        metres = request(owner, 'GET', f"/api/activities/{saved['id']}")['distance_m']
        assert c['expect'][0] <= metres <= c['expect'][1], (name, metres, c['expect'])
    # Every section counts (#234 item 6) and phone elevation is kept (#234 item 5): a fictional 10.6 km run with a 2-minute
    # signal gap after 6 km, climbing 60 m over the first part. A 10K exists only across the gap, so it must not appear.
    M = 111320.0
    pts = [{'lat': 10 + i * 6.66 / M, 'lon': 20, 't': 1 + i * 2, 'accuracy': 5, 'segment': 0, 'alt': 100 + 60 * i / 900, 'valt': 4} for i in range(901)]
    t0 = pts[-1]['t'] + 120
    pts += [{'lat': 10 + (6000 + 30 + i * 6.66) / M, 'lon': 20, 't': t0 + i * 2, 'accuracy': 5, 'segment': 1, 'alt': 160, 'valt': 4} for i in range(701)]
    last = pts[-1]['t'] + 1
    two = request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), name='Fictional two-section run', visibility='me',
        start=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=4000)).isoformat(), elapsed_s=last, moving_s=last - 120, points=pts))
    run = request(owner, 'GET', f"/api/activities/{two['id']}")
    assert 10500 < run['distance_m'] < 10800, run['distance_m']
    km = run['splits_km'] if isinstance(run['splits_km'], list) else json.loads(run['splits_km'])
    assert len(km) == 11 and abs(sum(s['distance_m'] for s in km) - run['distance_m']) < 60, [s['distance_m'] for s in km]
    assert all(250 < s['pace_s_per_km'] < 350 for s in km[:-1]), [s['pace_s_per_km'] for s in km]   # ~300 s/km, gap time excluded
    labels = [e['label'] for e in run['efforts']]
    assert '5K' in labels and '10K' not in labels, ('a 10K would have to span the gap', labels)
    assert 51 <= (run['ascent_m'] or 0) <= 69, run['ascent_m']
    assert len(run['track_lines']) == 2, 'your own map shows both sections'
    # A 200 km, 8-hour ride (#234 item 8): 40,000 fixes at the iPhone's 5 m spacing save in one request.
    ride = [{'lat': 10 + (i * 5.0) / M, 'lon': 21, 't': 1 + i * 0.72, 'accuracy': 5, 'segment': 0} for i in range(40001)]
    long = request(owner, 'POST', '/api/activities/track', dict(body, client_id=str(uuid.uuid4()), sport='ride', name='Fictional century and more', visibility='me',
        start=(dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=9)).isoformat(), elapsed_s=28802, moving_s=28802, points=ride))
    assert 198000 < request(owner, 'GET', f"/api/activities/{long['id']}")['distance_m'] < 202000
    print('PASS tracking: segments, sharing default/review, retry/concurrency, account isolation, invalid GPS and yoga')
finally:
    admin = login(*ALEX)
    for name in ('zz_test_track_owner', 'zz_test_track_viewer'):
        admin.post(f'/api/admin/people/{name}/remove', {'confirm':name})
