"""Authenticated atomic GPS/lap/photo saves and real retries. Fictional isolated people only."""
import base64
import concurrent.futures
import datetime as dt
import math
from pathlib import Path
import urllib.request
import uuid

from kc import ALEX, BASE, login, person

owner, other = person('zz_test_track_review'), person('zz_test_track_review_other')
admin = login(*ALEX)
photo = base64.b64encode((Path(__file__).resolve().parents[2] / 'dev/demo/photos/curry-rice-bowl.jpg').read_bytes()).decode()


def request(client, method, path, body=None, expected=200):
    status, result = client.req(method, path, body)
    assert status == expected, (path, status, result)
    return result


def body(**changes):
    points = [{'lat': i * .0001, 'lon': 10, 't': i * 5 + (100 if i > 40 else 0), 'segment': int(i > 40), 'accuracy': 5} for i in range(81)]
    step = 6371008.8 * math.radians(.0001)
    return {'client_id': str(uuid.uuid4()), 'sport': 'run', 'name': 'Fictional reviewed run',
            'start': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).isoformat(),
            'elapsed_s': 500, 'moving_s': 400, 'points': points, 'visibility': 'me', 'review_version': 1,
            'laps': [{'id': str(uuid.uuid4()), 'seconds': 200, 'elapsed': 200, 'distance': 40 * step, 'pointCount': 41},
                     {'id': str(uuid.uuid4()), 'seconds': 350, 'elapsed': 450, 'distance': 69 * step, 'pointCount': 71}],
            'photos': [photo, photo], **changes}


try:
    assert request(owner, 'GET', '/api/track/capabilities') == {'atomic_review': 1}
    original = body()
    saved = request(owner, 'POST', '/api/activities/track', original)
    aid = saved['id']
    detail = request(owner, 'GET', f'/api/activities/{aid}')
    assert len(detail['photos']) == 2 and len(detail['laps']) == 3, detail
    assert abs(detail['laps'][0]['distance_m'] - original['laps'][0]['distance']) < .01 and detail['laps'][0]['moving_s'] == 200
    assert abs(detail['laps'][1]['distance_m'] - (original['laps'][1]['distance'] - original['laps'][0]['distance'])) < .01 and detail['laps'][1]['elapsed_s'] == 250
    assert abs(sum(l['distance_m'] for l in detail['laps']) - detail['distance_m']) < .01
    assert sum(l['moving_s'] for l in detail['laps']) == 400
    assert detail['laps'][-1]['trigger'] == 'session_end'
    with owner.op.open(urllib.request.Request(BASE + f"/api/activity-photos/{detail['photos'][0]['id']}")) as response:
        assert response.headers['Content-Type'] == 'image/jpeg' and b'Exif' not in response.read()
    request(other, 'GET', f'/api/shared/{aid}', expected=404)
    request(other, 'DELETE', f"/api/activity-photos/{detail['photos'][0]['id']}", expected=404)
    # Lost and concurrent acknowledgements return one activity, including exactly the confirmed pictures.
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        replies = list(pool.map(lambda _: request(owner, 'POST', '/api/activities/track', original), range(8)))
    assert all(r == {'id': aid, 'duplicate': True} for r in replies)
    assert len(request(owner, 'GET', f'/api/activities/{aid}')['photos']) == 2
    fresh = body()
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        replies = list(pool.map(lambda _: request(owner, 'POST', '/api/activities/track', fresh), range(6)))
    assert len({r['id'] for r in replies}) == 1 and sum(not r['duplicate'] for r in replies) == 1
    assert len(request(owner, 'GET', f"/api/activities/{replies[0]['id']}")['photos']) == 2, 'first-save races also insert each confirmed photo once'
    # A retried payload cannot replace the already-saved audience/name/photos, even if a client edits a stale form.
    request(owner, 'POST', '/api/activities/track', dict(original, visibility='everyone', name='Stale retry', photos=[photo]))
    after = request(owner, 'GET', f'/api/activities/{aid}')
    assert after['visibility'] == 'me' and after['name'] == original['name'] and len(after['photos']) == 2
    # The same recording identifier belongs separately to each account.
    assert request(other, 'POST', '/api/activities/track', original)['id'] != aid
    count = len(request(owner, 'GET', '/api/activities?limit=100'))
    invalid = [body(photos=[photo, 'invalid-image']), body(photos=[photo] * 11), body(photos=['short']),
               body(laps=[dict(original['laps'][0], seconds=500)]),
               body(laps=[original['laps'][0], original['laps'][0]]),
               body(laps=[dict(original['laps'][0], distance=5000)]),
               body(laps=[dict(original['laps'][0], pointCount=5)]),
               body(laps=[dict(original['laps'][0], elapsed=199)]), body(review_version=None)]
    for bad in invalid:
        status, _ = owner.post('/api/activities/track', bad)
        assert status in (400, 422), status
    assert len(request(owner, 'GET', '/api/activities?limit=100')) == count, 'invalid images/laps never partially save the workout'
    # A definite failure leaves its receipt available for a corrected, explicitly re-reviewed request.
    fixed = dict(invalid[0], photos=[photo])
    repaired = request(owner, 'POST', '/api/activities/track', fixed)
    assert len(request(owner, 'GET', f"/api/activities/{repaired['id']}")['photos']) == 1
    # Retrying after deletion cannot resurrect the activity or its pictures.
    request(owner, 'DELETE', f'/api/activities/{aid}')
    request(owner, 'POST', '/api/activities/track', original, expected=409)
    print('PASS atomic recording photos/manual laps, privacy, concurrent/lost acknowledgement, validation and deletion receipts')
finally:
    for name in ('zz_test_track_review', 'zz_test_track_review_other'):
        admin.delete('/api/admin/people/' + name)
