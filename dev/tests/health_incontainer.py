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
from decimal import Decimal
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
    # Sparse HR without a motion recording uses the device timer on initial
    # import, replay and later profile-driven recalculation. All data is fictional.
    for index, times in enumerate(([0, 18, 138, 258, 378, 498, 618, 738, 858, 978, 1098, 1200], [0, 120, 240, 360, 480, 600, 720, 840, 960, 1080, 1200])):
        later = start + dt.timedelta(days=2+index)
        sample = api_health.WorkoutIn(id=f'sparse-motion-timer-fixture-{index}', type='running',
            start=later, end=later+dt.timedelta(seconds=1200), duration_s=1140, distance_m=3000,
            heart_rate=[api_health.Beat(t=later+dt.timedelta(seconds=t),bpm=150) for t in times])
        result, run_id, _ = api_health.save(uid, sample)
        assert result == 'added'
        with db.connect() as c:
            row=c.execute('SELECT moving_s,vo2max FROM activities WHERE id=%s AND user_id=%s',(run_id,uid)).fetchone()
            assert row['moving_s']==1140, 'active duration preserves the recorded one-minute pause'
            before=c.execute('SELECT * FROM activity_streams WHERE activity_id=%s AND user_id=%s',(run_id,uid)).fetchone()
            # Reproduce a legacy row with the bad duration and corresponding provenance.
            bad=18 if index==0 else 0
            c.execute("UPDATE activities SET moving_s=%s,vo2max=NULL,health_details=jsonb_set(health_details,'{imported,moving_s}',%s::jsonb) WHERE id=%s AND user_id=%s",(bad,json.dumps(bad),run_id,uid))
        result, replay_id, updated=api_health.save(uid,sample)
        assert result=='duplicate' and replay_id==run_id and updated
        with db.connect() as c:
            repaired=c.execute('SELECT moving_s,vo2max,splits_mi FROM activities WHERE id=%s AND user_id=%s',(run_id,uid)).fetchone()
            assert repaired['moving_s']==1140 and repaired['vo2max'] is not None
            assert not repaired['splits_mi'], 'summary time/distance cannot invent splits'
            assert c.execute('SELECT * FROM activity_streams WHERE activity_id=%s AND user_id=%s',(run_id,uid)).fetchone()==before
        assert api_health.save(uid,sample)[2] is False, 'repaired replay is stable'
        assert activities.reprocess(uid,run_id)
        with db.connect() as c:
            assert c.execute('SELECT moving_s FROM activities WHERE id=%s AND user_id=%s',(run_id,uid)).fetchone()['moving_s']==1140
            c.execute('UPDATE activities SET moving_s=1000 WHERE id=%s AND user_id=%s',(run_id,uid))
        api_health.save(uid,sample)
        with db.connect() as c:
            assert c.execute('SELECT moving_s FROM activities WHERE id=%s AND user_id=%s',(run_id,uid)).fetchone()['moving_s']==1000, 'manual duration survives replay'
    print('Sparse motion timer: initial import, 18/zero legacy replay, derived refresh, pause handling, profile recalculation, no invented splits and manual time preservation PASS')
    # Dense staircase route: complete distance with long stretches of repeated
    # coordinates. The Health timer is authoritative for aggregates, while no
    # per-split or pace-chart timing is inferred from the route mask.
    staircase_start = start + dt.timedelta(days=5)
    interval_count, moving_intervals, route_distance = 2350, 770, 4800.0
    step_m = route_distance / moving_intervals
    travelled = 0.0
    route = []
    for i in range(interval_count + 1):
        if i and (i * moving_intervals // interval_count) > ((i - 1) * moving_intervals // interval_count):
            travelled += step_m
        seconds = i
        route.append(api_health.Point(t=staircase_start+dt.timedelta(seconds=seconds),
            lat=40 + travelled / 111195.0, lng=-75, alt=100 + travelled * (80 / route_distance)))
    staircase = api_health.WorkoutIn(id='health-staircase-duration-fixture', type='running',
        start=staircase_start, end=staircase_start+dt.timedelta(seconds=2400), duration_s=2360,
        distance_m=route_distance, ascent_m=80, route=route,
        heart_rate=[api_health.Beat(t=staircase_start+dt.timedelta(seconds=t), bpm=150)
                    for t in range(0, 2401, 30)])
    result, staircase_id, _ = api_health.save(uid, staircase)
    assert result == 'added'
    with db.connect() as c:
        row=c.execute('SELECT source,moving_s,distance_m,gap_s_per_km,vam,vo2max,max_speed,decoupling,splits_km,splits_mi,chart,health_details FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert row['source']=='healthkit' and row['moving_s']==2360 and abs(row['distance_m']-4800)<2
        # The steady 1.67% climb raises equivalent distance by ~4.7%, so GAP
        # should be about 470 s/km, not the flat 492 s/km aggregate pace.
        assert 465 < row['gap_s_per_km'] < 475 and 120 < row['vam'] < 123 and row['vo2max'] is not None
        assert row['max_speed'] is None and row['decoupling'] is None
        assert not row['splits_km'] and not row['splits_mi'], 'Health duration cannot be distributed into route splits'
        assert row['chart'] and 'speed' not in row['chart'] and 'gap_speed' not in row['chart'] and row['chart'].get('hr')
        assert row['health_details']['health_duration_authoritative'] is True
        assert row['health_details']['health_duration_s']==2360
        assert row['health_details']['route_timing'].startswith('health-duration-only')
        assert c.execute('SELECT count(*) AS n FROM best_efforts WHERE activity_id=%s AND user_id=%s',(staircase_id,uid)).fetchone()['n']==0
        old_recording=c.execute('SELECT t,lat,lon,hr FROM activity_streams WHERE activity_id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        # Simulate the previous moving-mask result/provenance and stored outputs.
        c.execute("UPDATE activities SET moving_s=%s,vo2max=NULL,splits_km='[{\"moving_s\":770}]',splits_mi='[{\"moving_s\":770}]',chart=jsonb_set(chart,'{speed}','[6.23]'::jsonb),health_details=jsonb_set(health_details - 'health_duration_authoritative' - 'health_duration_s','{imported,moving_s}','770') WHERE id=%s AND user_id=%s",(moving_intervals,staircase_id,uid))
    # Old rows have no recoverable raw Health timer. Reprocessing must leave the
    # aggregate untouched, clear route-timed outputs, and request Health replay.
    assert activities.reprocess(uid,staircase_id)
    with db.connect() as c:
        legacy=c.execute('SELECT moving_s,gap_s_per_km,vo2max,vam,max_speed,decoupling,splits_km,splits_mi,chart,health_details FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert legacy['moving_s']==moving_intervals and legacy['gap_s_per_km'] is None and legacy['vo2max'] is None and legacy['vam'] is None
        assert legacy['max_speed'] is None and legacy['decoupling'] is None and not legacy['splits_km'] and not legacy['splits_mi']
        assert 'speed' not in legacy['chart'] and legacy['health_details']['health_duration_replay_required'] is True
        c.execute('UPDATE activities SET gap_s_per_km=470,vo2max=40,vam=400,max_speed=6,decoupling=4,steps=5000 WHERE id=%s AND user_id=%s',(staircase_id,uid))
    legacy_file,_=api_health.to_activity(staircase)
    legacy_streams={k:list(v) for k,v in legacy_file['streams'].items()}
    legacy_streams['temp']=[20.0]*len(legacy_streams['t'])
    legacy_file['streams']=legacy_streams
    with db.connect() as c:
        assert activities.enrich_file(c,uid,staircase_id,legacy_file,{},None,None), 'legacy file enrichment exercises replay-required clearing'
        legacy=c.execute('SELECT gap_s_per_km,vo2max,vam,max_speed,decoupling,steps,health_details FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert all(legacy[k] is None for k in ('gap_s_per_km','vo2max','vam','max_speed','decoupling','steps'))
        assert legacy['health_details']['health_duration_replay_required'] is True
    result, replay_id, repaired=api_health.save(uid,staircase)
    assert result=='duplicate' and replay_id==staircase_id and repaired, 'Health replay repairs legacy mask-derived aggregate'
    with db.connect() as c:
        row=c.execute('SELECT moving_s,gap_s_per_km,vam,vo2max,splits_km,splits_mi,chart,health_details FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert row['moving_s']==2360 and row['vo2max'] is not None and row['vam']>120
        assert not row['splits_km'] and not row['splits_mi'] and 'speed' not in row['chart']
        assert c.execute('SELECT t,lat,lon,hr FROM activity_streams WHERE activity_id=%s AND user_id=%s',(staircase_id,uid)).fetchone()==old_recording
        assert c.execute('SELECT count(*) AS n FROM best_efforts WHERE activity_id=%s AND user_id=%s',(staircase_id,uid)).fetchone()['n']==0
    assert api_health.save(uid,staircase)[2] is False, 'repaired Health replay is stable'
    assert activities.reprocess(uid,staircase_id)
    with db.connect() as c:
        row=c.execute('SELECT moving_s,gap_s_per_km,vam,vo2max,splits_km,splits_mi,chart FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert row['moving_s']==2360 and row['vo2max'] is not None and row['vam']>120
        assert not row['splits_km'] and not row['splits_mi'] and 'speed' not in row['chart']
        assert c.execute('SELECT count(*) AS n FROM best_efforts WHERE activity_id=%s AND user_id=%s',(staircase_id,uid)).fetchone()['n']==0
    source_totals=staircase.model_copy(update={'steps':5000,'max_speed':6.2})
    assert api_health.save(uid,source_totals)[2] is True
    with db.connect() as c:
        row=c.execute('SELECT steps,max_speed,health_details FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert row['steps']==5000 and abs(row['max_speed']-6.2)<.001, 'explicit Health totals survive route-timing invalidation'
        assert row['health_details']['source_metrics']=={'steps':5000.0,'max_speed':6.2}
    assert api_health.save(uid,source_totals)[2] is False, 'unchanged Health totals replay idempotently'
    file_parsed,_=api_health.to_activity(staircase)
    file_streams={k:list(v) for k,v in file_parsed['streams'].items()}
    file_streams['power']=[200.0]*len(file_streams['t'])
    file_parsed['streams']=file_streams
    with db.connect() as c:
        assert activities.enrich_file(c,uid,staircase_id,file_parsed,{},None,None), 'compatible file enrichment adds a missing signal'
        row=c.execute('SELECT steps,max_speed,gap_s_per_km,vo2max,vam,health_details FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert row['steps']==5000 and abs(row['max_speed']-6.2)<.001 and row['health_details']['source_metrics']=={'steps':5000.0,'max_speed':6.2}
        assert row['gap_s_per_km'] is not None and row['vo2max'] is not None and row['vam']>120, 'file enrichment retains Health-duration aggregate metrics'
    partial_totals=staircase.model_copy(update={'steps':None,'max_speed':None})
    assert api_health.save(uid,partial_totals)[2] is False, 'partial replay retains explicit prior source metrics'
    assert activities.reprocess(uid,staircase_id)
    with db.connect() as c:
        row=c.execute('SELECT steps,max_speed FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        assert row['steps']==5000 and abs(row['max_speed']-6.2)<.001, 'reprocess restores only explicit source metrics'
    with db.connect() as c:
        from app import activity_corrections
        current=c.execute('SELECT * FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()
        baseline={k:(float(current[k]) if isinstance(current.get(k),(int,float,Decimal)) else current.get(k)) for k in activity_corrections.FIELDS+activity_corrections.DERIVED}
        c.execute('UPDATE activities SET moving_s=1800,summary_original=%s,summary_overrides=%s WHERE id=%s AND user_id=%s',(json.dumps(baseline),json.dumps({'moving_s':1800}),staircase_id,uid))
    api_health.save(uid,staircase)
    with db.connect() as c:
        assert c.execute('SELECT moving_s FROM activities WHERE id=%s AND user_id=%s',(staircase_id,uid)).fetchone()['moving_s']==1800, 'manual duration remains authoritative'
    # A compatible phone recording remains the summary owner when Health adds
    # matching detail; Health's timer must not replace the phone's active time.
    phone_start=staircase_start+dt.timedelta(days=10)
    phone_route=[api_health.Point(t=phone_start+dt.timedelta(seconds=i),lat=p.lat,lng=p.lng,alt=p.alt) for i,p in enumerate(route)]
    phone_sample=staircase.model_copy(update={'id':'health-staircase-phone-enrichment','start':phone_start,
        'end':phone_start+dt.timedelta(seconds=2400),'route':phone_route,
        'heart_rate':[api_health.Beat(t=phone_start+dt.timedelta(seconds=t),bpm=150) for t in range(0,2401,30)]})
    parsed, phone_meta=api_health.to_activity(phone_sample)
    parsed['streams']['hr']=[]  # Health replay adds HR, exercising changed-stream enrichment.
    phone_meta.update(source_id='fictional-phone-recording',moving_s=2300,elapsed_s=2400,distance_m=route_distance)
    phone_result, phone_id=activities.store(uid,parsed,phone_meta,source='track')
    assert phone_result=='added'
    health_result, same_phone_id, _=api_health.save(uid,phone_sample)
    assert health_result=='duplicate' and same_phone_id==phone_id
    with db.connect() as c:
        phone=c.execute('SELECT source,moving_s,healthkit_id FROM activities WHERE id=%s AND user_id=%s',(phone_id,uid)).fetchone()
        assert phone['source']=='track' and phone['moving_s']==2300 and phone['healthkit_id']==phone_sample.id
    print('Health staircase: authoritative aggregate pace/GAP/VAM/VO2, legacy replay requirement, invalid split/chart/best-effort suppression, compatible phone summary and owner correction preservation PASS')
finally:
    if uid:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
print('Sparse Health replay: legacy correction, derived HR refresh, user edits/title/duration/recording preservation passed')
