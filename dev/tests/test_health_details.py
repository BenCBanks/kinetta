"""Late Health details, conservative enrichment, legacy ACKs and account isolation."""
import datetime as dt
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from kc import BASE, Client, PW, person

owner = person('zz_test_health_details')
other = person('zz_test_health_other')
start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=12)
base = dict(id='health-details-fixture-001', type='running', start=start.isoformat(), end=(start + dt.timedelta(seconds=600)).isoformat(), duration_s=600, distance_m=1600, calories=100)

def send(client, w):
    status, result = client.post('/api/health/workouts', {'workouts': [w]})
    assert status == 200 and result['failed'] == 0, (status, result)
    assert result['results'][0]['result'] in ('added', 'duplicate')
    return result

def activity(aid):
    status, result = owner.get(f'/api/activities/{aid}')
    assert status == 200, (status, result)
    return result

try:
    first = send(owner, base)
    assert first['added'] == 1
    aid = first['results'][0]['activity_id']
    owner.patch(f'/api/activities/{aid}', {'name': 'My edited title', 'description': 'Keep this description'})
    richer = {**base, 'steps': 1250, 'ascent_m': 40, 'avg_power': 210, 'max_power': 310, 'avg_stride': 1200, 'avg_vo': 80, 'avg_gct': 240,
        'route': [{'t': (start + dt.timedelta(seconds=i*30)).isoformat(), 'lat': 40 + i*.0002, 'lng': -75 + i*.0002, 'alt': 100+i*2} for i in range(21)],
        'heart_rate': [{'t': (start + dt.timedelta(seconds=i*30)).isoformat(), 'bpm': 140+i%5} for i in range(21)]}
    enriched = send(owner, richer)
    assert enriched['duplicates'] == 1 and enriched['updated'] == 1 and enriched['results'][0]['activity_id'] == aid, enriched
    a = activity(aid)
    assert a['line'] and a['chart'] and a['avg_hr'] and a['steps'] == 1250, a
    assert a['name'] == 'My edited title' and a['description'] == 'Keep this description' and a['distance_m'] == 1600
    assert a['avg_power'] == 210 and a['max_power'] == 310 and a['avg_stride'] == 1200 and a['avg_vo'] == 80 and a['avg_gct'] == 240
    line = a['line']
    # An empty retry preserves GPS, all richer statistics, and manual edits.
    replay = send(owner, base)
    assert replay['updated'] == 0, replay
    assert activity(aid)['line'] == line and activity(aid)['steps'] == 1250
    assert send(owner, richer)['updated'] == 0
    isolated = send(other, richer)
    assert isolated['added'] == 1 and isolated['results'][0]['activity_id'] != aid
    assert other.get(f'/api/activities/{aid}')[0] == 404
    assert Client().post('/api/health/workouts', {'workouts':[richer]})[0] == 401
    assert owner.post('/api/health/workouts', {'workouts':[{**base, 'avg_power': 9000}]})[0] == 422
    # An existing compatible manual activity gains details without changing its origin or title.
    later = start - dt.timedelta(days=2)
    status, manual = owner.post('/api/activities/manual', {'sport':'run', 'start':later.isoformat(), 'duration_s':600, 'distance_m':1700, 'avg_hr':155, 'name':'Manual kept'})
    assert status == 200
    extra = {**richer, 'id':'health-details-fixture-002', 'start':later.isoformat(), 'end':(later+dt.timedelta(seconds=600)).isoformat(),
        'route':[{**p, 't':(dt.datetime.fromisoformat(p['t'])-dt.timedelta(days=2)).isoformat()} for p in richer['route']],
        'heart_rate':[{**p, 't':(dt.datetime.fromisoformat(p['t'])-dt.timedelta(days=2)).isoformat()} for p in richer['heart_rate']]}
    merged = send(owner, extra)
    assert merged['duplicates'] == 1 and merged['results'][0]['activity_id'] == manual['id'] and merged['updated'] == 1, merged
    assert activity(manual['id'])['name'] == 'Manual kept' and activity(manual['id'])['line']
    assert activity(manual['id'])['distance_m'] == 1700 and activity(manual['id'])['avg_hr'] == 155
    assert send(owner, extra)['updated'] == 0
    # Garmin-like original recording arrives after a summary-only Health import.
    file_start = start - dt.timedelta(days=4)
    summary = {**base, 'id':'health-details-fixture-003', 'start':file_start.isoformat(), 'end':(file_start+dt.timedelta(seconds=600)).isoformat()}
    file_aid = send(owner, summary)['results'][0]['activity_id']
    points = ''.join(f'<trkpt lat="40" lon="{-75+i*.0009377}"><ele>{100+i}</ele><time>{(file_start+dt.timedelta(seconds=i*30)).isoformat()}</time></trkpt>' for i in range(21))
    gpx = '<gpx version="1.1" creator="Demo recording"><trk><type>running</type><trkseg>'+points+'</trkseg></trk></gpx>'
    boundary = 'kinetta-demo-file-details'
    data = (f'--{boundary}\r\nContent-Disposition: form-data; name="files"; filename="details.gpx"\r\nContent-Type: application/gpx+xml\r\n\r\n'+gpx+f'\r\n--{boundary}--\r\n').encode()
    with owner.op.open(urllib.request.Request(BASE+'/api/import', data=data, method='POST', headers={'Origin':BASE,'Content-Type':'multipart/form-data; boundary='+boundary})) as response:
        job = json.loads(response.read())['job']
    for _ in range(40):
        record = next(x for x in owner.get('/api/imports')[1] if x['id']==job)
        if record['status'] not in ('queued','running'): break
        time.sleep(.1)
    assert record['status']=='done' and record['failed']==0 and record['added']==0, record
    assert activity(file_aid)['line'] and activity(file_aid)['distance_m']==1600
    assert send(owner, summary)['results'][0]['activity_id']==file_aid and activity(file_aid)['line']
    # Same time and distance do not merge different sports.
    bike = send(owner, {**summary,'id':'health-details-fixture-bike','type':'cycling'})
    assert bike['added']==1 and bike['results'][0]['activity_id']!=file_aid
    concurrent_start = start - dt.timedelta(days=6)
    concurrent = {**base,'id':'health-details-fixture-concurrent','start':concurrent_start.isoformat(),'end':(concurrent_start+dt.timedelta(seconds=600)).isoformat()}
    with ThreadPoolExecutor(max_workers=8) as pool:
        repeated = list(pool.map(lambda _: send(owner, concurrent), range(8)))
    assert sum(r['added'] for r in repeated)==1 and len({r['results'][0]['activity_id'] for r in repeated})==1, repeated
    # Same legacy ID cannot attach details to a user-edited, now incompatible workout.
    owner.patch(f'/api/activities/{aid}', {'sport':'ride'})
    assert send(owner, richer)['updated'] == 0 and activity(aid)['sport'] == 'ride'
    # Invalid time and empty history retain the original endpoint contract.
    status, empty = owner.post('/api/health/workouts', {'workouts':[]})
    assert status == 200 and empty['results'] == []
    print('Health enrichment: late GPS/HR/metrics, unchanged retries, edited fields, other-source enrichment and cross-user isolation passed')
finally:
    owner.post('/api/account/delete', {'password':PW})
    other.post('/api/account/delete', {'password':PW})
