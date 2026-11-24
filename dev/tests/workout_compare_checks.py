"""Fictional API fixtures for the app-computed workout comparison endpoint."""
import json
import os
import subprocess
from unittest.mock import patch

from kc import PW, person


def sql(code):
    result = subprocess.run(
        ['docker', 'compose', '-p', os.environ.get('KINETTA_PROJECT', 'kinettatest'),
         'exec', '-T', 'app', 'python', '-c', code],
        check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    lines = result.stdout.strip().splitlines()
    return lines[-1] if lines else ''


def run():
    a = b = None
    checks = 0

    def check(value, message):
        nonlocal checks
        assert value, message
        checks += 1

    try:
        a = person('zz_test_workout_compare_a')
        b = person('zz_test_workout_compare_b')
        seeded = json.loads(sql(r'''
import json
from app import db
with db.connect() as c:
    a=c.execute("SELECT id FROM users WHERE login='zz_test_workout_compare_a'").fetchone()['id']
    b=c.execute("SELECT id FROM users WHERE login='zz_test_workout_compare_b'").fetchone()['id']
    c.execute("UPDATE profile SET health_ai_ok=false,garmin_ai_ok=true WHERE user_id=%s",(a,))
    c.execute("UPDATE profile SET health_ai_ok=true,garmin_ai_ok=false WHERE user_id=%s",(b,))
    def activity(uid,sport,source,when,distance,moving,hr=None,ascent=None,temp=None,health_id=None):
        return c.execute("""INSERT INTO activities
          (user_id,sport,source,name,start_time,distance_m,moving_s,avg_hr,ascent_m,avg_temp,healthkit_id)
          VALUES (%s,%s,%s,'Fictional workout',%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
          (uid,sport,source,when,distance,moving,hr,ascent,temp,health_id)).fetchone()['id']
    ids={}
    # Garmin target: two consented Garmin baselines and one matching but unconsented Health baseline.
    ids['garmin_a']=activity(a,'run','garmin_connect','2026-10-30T12:00:00Z',5000,1500,150,100,20)
    activity(a,'run','garmin_connect','2026-10-20T12:00:00Z',5000,1440,144,90,18)
    activity(a,'run','garmin_connect','2026-10-10T12:00:00Z',5000,1560,156,110,22)
    # A second provider copy of the target workout must not become its own baseline.
    activity(a,'run','garmin_connect','2026-10-30T11:59:30Z',5000,1490,149,99,19)
    activity(a,'run','healthkit','2026-10-25T12:00:00Z',5000,900,198,300,30,health_id='fictional-health-a')
    ids['health_a']=activity(a,'run','healthkit','2026-10-31T12:00:00Z',5000,1500,150,100,20,health_id='fictional-health-target-a')
    ids['both_a']=activity(a,'run','garmin_connect','2026-10-29T12:00:00Z',5000,1500,150,100,20,health_id='fictional-health-and-garmin-a')
    ids['one_baseline']=activity(a,'walk','manual','2026-10-30T12:00:00Z',4000,1800)
    activity(a,'walk','manual','2026-10-20T12:00:00Z',4000,1900)
    # Inclusive distance-window boundaries and two out-of-range rows.
    ids['ride']=activity(a,'ride','manual','2026-10-30T12:00:00Z',10000,1800)
    activity(a,'ride','manual','2026-10-20T12:00:00Z',8000,1900)
    activity(a,'ride','manual','2026-10-10T12:00:00Z',12000,1700)
    activity(a,'ride','manual','2026-10-05T12:00:00Z',7999,1600)
    activity(a,'ride','manual','2026-10-01T12:00:00Z',12001,1600)
    activity(a,'ride','manual','2026-07-02T12:00:00Z',10000,2000)
    activity(a,'ride','manual','2026-07-01T12:00:00Z',10000,1000)
    activity(a,'ride','manual','2026-09-25T12:00:00Z',10000,None)
    activity(a,'walk','manual','2026-09-24T12:00:00Z',10000,1200)
    ids['none']=activity(a,'other','manual','2026-10-30T12:00:00Z',1000,600)
    ids['swim_compare']=activity(a,'swim','manual','2026-10-30T13:00:00Z',1000,600)
    activity(a,'swim','manual','2026-10-20T13:00:00Z',1000,500)
    activity(a,'swim','manual','2026-10-10T13:00:00Z',1000,510)
    ids['strength']=activity(a,'workout','manual','2026-10-30T12:00:00Z',None,1800)
    ids['many']=activity(a,'ski','manual','2026-10-30T12:00:00Z',10000,1800)
    for day in ('2026-10-25','2026-10-20','2026-10-15','2026-10-10','2026-10-05','2026-10-01'):
        activity(a,'ski','manual',day+'T12:00:00Z',10000,1800)
    # Health target with two Health baselines; a matching Garmin row is separately consent-gated.
    ids['health_b']=activity(b,'run','healthkit','2026-10-30T12:00:00Z',5000,1500,150,100,20,health_id='fictional-health-target-b')
    activity(b,'run','healthkit','2026-10-20T12:00:00Z',5000,1440,144,90,18,health_id='fictional-health-b1')
    activity(b,'run','healthkit','2026-10-10T12:00:00Z',5000,1560,156,110,22,health_id='fictional-health-b2')
    activity(b,'run','garmin_connect','2026-10-25T12:00:00Z',5000,900,198,300,30)
    ids['garmin_b']=activity(b,'ride','garmin_connect','2026-10-31T12:00:00Z',10000,1800,150,100,20)
    ids['both_b']=activity(b,'run','garmin_connect','2026-10-29T12:00:00Z',5000,1500,150,100,20,health_id='fictional-health-and-garmin-b')
    c.execute("""INSERT INTO best_efforts(user_id,activity_id,sport,distance_m,label,elapsed_s,start_time)
      VALUES (%s,%s,'ride',10000,'Fictional ride record',1800,'2026-10-30T12:00:00Z')""",(a,ids['ride']))
print(json.dumps(ids))
'''))

        status, result = a.post('/api/kit/workout-compare', {'activity_id': seeded['garmin_a']})
        check(status == 200 and result['status'] == 'compared',
              f'Garmin target works without Apple Health consent: {status} {result}')
        check(result['baseline_count'] == 2, 'unconsented Health baseline is excluded from Garmin comparison')
        check(result['baseline_medians']['avg_hr'] == 150, 'Health heart rate does not enter Garmin baseline median')
        with patch('app.ai_release.enabled', return_value=False):
            off_status, off_result = a.post('/api/kit/workout-compare', {'activity_id': seeded['garmin_a']})
        check(off_status == 200 and off_result['status'] == 'compared', 'app-computed comparison remains available when Kit is off')
        check(result['relations']['pace_s_per_km'] == 'about_the_same' and result['relations']['avg_hr'] == 'about_the_same',
              'pace and heart-rate same bands are computed in the endpoint')

        # A source-specific grant permits the Health baseline; withdrawing it excludes it again.
        sql("from app import db\nwith db.connect() as c:c.execute(\"UPDATE profile SET health_ai_ok=true WHERE user_id=(SELECT id FROM users WHERE login='zz_test_workout_compare_a')\")")
        status, included = a.post('/api/kit/workout-compare', {'activity_id': seeded['garmin_a']})
        check(status == 200 and included['baseline_count'] == 4, 'Health and combined-source baselines join only after their own consent is enabled')
        sql("from app import db\nwith db.connect() as c:c.execute(\"UPDATE profile SET health_ai_ok=false WHERE user_id=(SELECT id FROM users WHERE login='zz_test_workout_compare_a')\")")
        status, denied_health = a.post('/api/kit/workout-compare', {'activity_id': seeded['health_a']})
        expected = {'detail': 'Review the Health app and Garmin data sharing with Kit under Me > Connections first.'}
        check(status == 403 and denied_health == expected, 'Health target returns existing consent-denied response shape')
        status, denied_both_health = a.post('/api/kit/workout-compare', {'activity_id': seeded['both_a']})
        check(status == 403 and denied_both_health == expected,
              'combined Garmin and HealthKit target requires Health consent even when Garmin is allowed')

        status, health_result = b.post('/api/kit/workout-compare', {'activity_id': seeded['health_b']})
        check(status == 200 and health_result['status'] == 'compared', 'Health target works without Garmin consent')
        check(health_result['baseline_count'] == 2 and health_result['baseline_medians']['avg_hr'] == 150,
              'unconsented Garmin baseline is excluded from Health comparison')
        status, denied_garmin = b.post('/api/kit/workout-compare', {'activity_id': seeded['garmin_b']})
        check(status == 403 and denied_garmin == expected, 'Garmin target returns existing consent-denied response shape')
        status, denied_both_garmin = b.post('/api/kit/workout-compare', {'activity_id': seeded['both_b']})
        check(status == 403 and denied_both_garmin == expected,
              'combined Garmin and HealthKit target requires Garmin consent even when Health is allowed')

        status, ride = a.post('/api/kit/workout-compare', {'activity_id': seeded['ride']})
        check(status == 200 and ride['baseline_count'] == 3, 'distance bounds are inclusive; exact 120-day row is in and older row is out')
        check(ride['relations'].get('speed_mps') in ('faster','slower','about_the_same'),
              'ride comparison includes a speed relation with the 0.1 m/s same band')
        check(ride['notable'] == 'personal_record', 'stored best effort is returned as one bounded notable')
        status, sparse = a.post('/api/kit/workout-compare', {'activity_id': seeded['one_baseline']})
        check(status == 200 and sparse['status'] == 'not_enough_similar' and sparse['baseline_count'] == 1,
              'one baseline hides comparison metrics')
        check(not sparse['deltas'] and not sparse['baseline_medians'], 'thin data does not expose partial comparison rows')
        status, empty = a.post('/api/kit/workout-compare', {'activity_id': seeded['none']})
        check(status == 200 and empty['status'] == 'not_enough_similar' and empty['baseline_count'] == 0,
              'zero baselines return the not-enough shape')
        status, capped = a.post('/api/kit/workout-compare', {'activity_id': seeded['many']})
        check(status == 200 and capped['baseline_count'] == 5, 'baseline count is capped at five')
        check(capped['relations'].get('speed_mps') == 'about_the_same', 'ski comparison reports the within-0.1 m/s speed band')
        status, swim = a.post('/api/kit/workout-compare', {'activity_id': seeded['swim_compare']})
        check(status == 200 and swim['relations'].get('speed_mps') == 'slower',
              'swim comparison reports slower speed when more than 0.1 m/s below baseline')
        status, strength = a.post('/api/kit/workout-compare', {'activity_id': seeded['strength']})
        check(status == 200 and strength['status'] == 'summary_only' and not strength['deltas'],
              'strength workout returns summary without a comparison')
        check(b.post('/api/kit/workout-compare', {'activity_id': seeded['garmin_a']})[0] == 404,
              'foreign activity ID is indistinguishable from missing')
        check(a.post('/api/kit/workout-compare', {'activity_id': seeded['garmin_a'], 'user_id': 2})[0] == 422,
              'request cannot supply account identity')
        check(a.post('/api/kit/workout-compare', {'activity_id': True})[0] == 422,
              'activity ID is strict and rejects booleans')
        check(a.post('/api/kit/workout-compare', {'activity_id': 2**63})[0] == 422,
              'activity ID above PostgreSQL bigint range is rejected before querying')
        print(f'workout comparison: {checks} fictional API checks passed')
    finally:
        if a: a.post('/api/account/delete', {'password': PW})
        if b: b.post('/api/account/delete', {'password': PW})
