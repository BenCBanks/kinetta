"""Synthetic recording coverage; no real records or device access."""
from app import activities
from app.parsers import STREAMS

def recording(times, gps=True, hr=True):
    s = {k:[] for k in STREAMS}
    s['t'] = times
    if gps: s.update(lat=[40+i*.001 for i in range(len(times))], lon=[-75]*len(times))
    if hr: s['hr'] = [140]*len(times)
    return s

full = recording([0,60,120,180,240,300,360,420,480,540,600])
partial = recording(list(range(0,61,2)))
merged = activities.merge_streams(full,partial)
assert merged['t']==full['t'] and merged['lat']==full['lat'] and merged['hr']==full['hr'], 'dense partial recording cannot erase full coverage'
richer = recording(list(range(0,601,10)),hr=False)
merged = activities.merge_streams(full,richer)
assert merged['t']==richer['t'] and merged['lat']==richer['lat'] and all(x==140 for x in merged['hr']), 'fuller GPS retains existing HR'
empty = recording([],False,False)
assert activities.merge_streams(full,empty)['lat']==full['lat']
print('Health recording coverage: partial/empty retries preserve fuller signals; fuller GPS retains existing HR')

# Sparse heart rate must not inherit the GPS/movement 30-second cutoff.
import math
from app import analysis

def heart(times, beats, gps=False):
    streams = {k: [] for k in ('t',) + STREAMS}
    streams.update(t=times, hr=beats)
    if gps:
        streams.update(lat=[40+i*.0001 for i in range(len(times))], lon=[-75]*len(times))
    return analysis.prepare(streams, 'run')

def summary(S): return analysis.summary(S, 'run', {}, {'max_hr':200,'rest_hr':60})

sparse = heart([0, 3, 123, 243, 363], [72, 72, 142, 152, 150])
expected = (72*3 + 107*120 + 147*120 + 151*120) / 363
assert math.isclose(summary(sparse)['avg_hr'], expected), 'short low interval cannot drown out sparse workout readings'
assert math.isclose(sum(summary(sparse)['zones']), 363), 'HR zones cover observed sparse intervals'
assert summary(sparse)['effort'] > 1, 'effort uses the same observed HR time'
assert sparse['moving'].sum() == 1 and sparse['dt'][sparse['moving']].sum() == 3, 'movement cutoff remains unchanged'
assert math.isclose(summary(heart([0,3,123,243,363],[72,72,142,152,150],True))['avg_hr'], expected), 'HR averaging does not depend on GPS movement'
assert math.isclose(summary(heart([0,10,30],[100,140,160]))['avg_hr'],140), 'uneven cadence is time weighted'
assert math.isclose(summary(heart([0,30,60,90,120],[140,None,None,None,160]))['avg_hr'],150), 'missing GPS-grid HR cells retain bounded observations'
assert math.isclose(summary(heart([0,60,3600,3660],[100,100,180,180]))['avg_hr'],140), 'long dropout is not bridged'
assert sum(summary(heart([0,60,3600,3660],[100,100,180,180]))['zones']) == 120, 'unobserved time adds no zone minutes'
for times,beats in [([0,60,120],[None,None,None]),([0,60,120],[None,150,None]),([0,600],[140,160])]:
    r=summary(heart(times,beats));assert r['avg_hr'] is None and r['zones'] is None and r['effort'] is None, 'insufficient observations do not invent an average'
assert summary(heart([0,0,60],[100,140,160]))['avg_hr'] == 150, 'duplicate timestamps have no duration'
assert summary(heart([],[]))['avg_hr'] is None
assert summary(heart([0,1,2,3],[150,150,150,150]))['avg_hr'] == 150, 'dense recording remains correct'
print('HR time weighting: sparse/mixed cadence, GPS independence, dropout limits, missing/duplicate samples and unchanged movement passed')

# Replaying an unchanged Health recording repairs only an untouched imported HR summary.
import datetime as dt
import json
from app import api_health, db
uid = None
try:
    with db.connect() as c:
        uid = c.execute("INSERT INTO users (login,name) VALUES ('zz_test_sparse_hr','Sparse HR Test') RETURNING id").fetchone()['id']
        c.execute('INSERT INTO profile (user_id,max_hr,rest_hr) VALUES (%s,200,60)', (uid,))
    start = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=20)
    w = api_health.WorkoutIn(id='sparse-heart-replay-fixture',type='running',start=start,end=start+dt.timedelta(seconds=363),duration_s=363,distance_m=1200,
        heart_rate=[api_health.Beat(t=start+dt.timedelta(seconds=t),bpm=h) for t,h in zip([0,3,123,243,363],[72,72,142,152,150])])
    result, aid, updated = api_health.save(uid,w)
    assert result=='added'
    with db.connect() as c:
        a=c.execute('SELECT avg_hr,moving_s FROM activities WHERE id=%s AND user_id=%s',(aid,uid)).fetchone()
        assert math.isclose(a['avg_hr'],expected,rel_tol=1e-6) and a['moving_s']==363, 'HTTP import uses full HR cadence but keeps Health duration'
        # Model a record written by the previous algorithm, without changing its recording or custom title.
        c.execute("UPDATE activities SET avg_hr=72,effort=0.1,zones='[3,0,0,0,0]',name='User-kept title',health_details=jsonb_set(health_details,'{imported,avg_hr}','72') WHERE id=%s AND user_id=%s",(aid,uid))
        recording_before=c.execute('SELECT t,hr FROM activity_streams WHERE activity_id=%s AND user_id=%s',(aid,uid)).fetchone()
    result, same, updated=api_health.save(uid,w)
    assert result=='duplicate' and same==aid and updated, 'unchanged replay corrects old imported summary without duplicating'
    with db.connect() as c:
        a=c.execute('SELECT avg_hr,moving_s,name,effort,zones,health_details FROM activities WHERE id=%s AND user_id=%s',(aid,uid)).fetchone()
        assert math.isclose(a['avg_hr'],expected,rel_tol=1e-6) and a['effort']>1 and sum(a['zones'])==363
        assert a['moving_s']==363 and a['name']=='User-kept title'
        assert c.execute('SELECT t,hr FROM activity_streams WHERE activity_id=%s AND user_id=%s',(aid,uid)).fetchone()==recording_before
    assert api_health.save(uid,w)[2] is False, 'float32 summary rounding must not create repeated updates'
    # Fuller observations can update a non-integer imported baseline despite float32 storage rounding.
    denser = w.model_copy(update={'heart_rate':[api_health.Beat(t=start+dt.timedelta(seconds=t),bpm=150) for t in [0,3,63,123,183,243,303,363]]})
    assert api_health.save(uid,denser)[2] is True
    with db.connect() as c:
        assert c.execute('SELECT avg_hr FROM activities WHERE id=%s AND user_id=%s',(aid,uid)).fetchone()['avg_hr']==150
        # A user correction differs from the imported baseline and must survive replay.
        c.execute('UPDATE activities SET avg_hr=133 WHERE id=%s AND user_id=%s',(aid,uid))
    assert api_health.save(uid,w)[2] is False
    with db.connect() as c:
        assert c.execute('SELECT avg_hr FROM activities WHERE id=%s AND user_id=%s',(aid,uid)).fetchone()['avg_hr']==133
finally:
    if uid:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
print('Sparse Health replay: legacy correction, derived HR refresh, user edits/title/duration/recording preservation passed')
