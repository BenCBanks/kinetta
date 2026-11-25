"""Fictional fixed-date SQL/RLS series checks; executed only in a disposable app."""
import datetime as dt
from fastapi import HTTPException
from pydantic import ValidationError
from app import db
from app.progress_series import SeriesRequest, read_series

# Inputs remain bounded before the internal reader can assemble its fixed SQL.
for invalid in [dict(metric='sql'), dict(aggregate='median'), dict(group_by="week'"),
                dict(sport="run'"), dict(period_unit='years'), dict(period_count=0),
                dict(period_count=53), dict(user_id=1), dict(metric='pace',aggregate='sum'),
                dict(metric='avg_hr',aggregate='sum'), dict(metric='workouts',aggregate='average')]:
    try: SeriesRequest(**invalid)
    except ValidationError: pass
    else: raise AssertionError(('Unvalidated series request', invalid))

now = dt.datetime(2024, 11, 13, 12, tzinfo=dt.timezone.utc)
with db.connect() as c:
    a = c.execute("SELECT id FROM users WHERE login='zz_test_series_a'").fetchone()['id']
    b = c.execute("SELECT id FROM users WHERE login='zz_test_series_b'").fetchone()['id']
    c.execute("UPDATE profile SET tz='America/New_York' WHERE user_id IN (%s,%s)", (a,b))
    def add(uid, stamp, ascent=100, sport='run', source='manual', distance=1000, duration=600, hr=140, opened=False):
        c.execute('''INSERT INTO activities(user_id,name,source,sport,start_time,ascent_m,distance_m,elapsed_s,moving_s,avg_hr,lift_open)
            VALUES(%s,'Fictional series run',%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (uid,source,sport,stamp,ascent,distance,duration,duration,hr,opened))
    add(a, '2024-10-28T03:59:59Z', 99999)  # Sunday in New York: outside the three weeks.
    add(a, '2024-10-28T04:00:00Z', 100)
    add(a, '2024-11-03T05:30:00Z', 200, distance=3000, duration=1200, hr=160)
    add(a, '2024-11-03T06:30:00Z', None)  # repeated local hour after DST, missing climb.
    add(a, '2024-11-06T12:00:00Z', 300)
    add(a, '2024-11-12T12:00:00Z', 400)
    add(a, '2024-11-12T13:00:00Z', 9999, sport='ride')
    add(a, '2024-11-12T14:00:00Z', 9999, sport='strength', opened=True)
    add(a, '2024-11-13T13:00:00Z', 99999)  # Future record is not counted.
    add(b, '2024-11-12T12:00:00Z', 99999)
    request = dict(metric='ascent', aggregate='average', group_by='week', period_unit='weeks', period_count=3, sport='run')
    def read(uid=a, **changes):
        return read_series(c, uid, SeriesRequest(**{**request, **changes}), now=now)
    result = read()
    assert [p['start'] for p in result['points']] == ['2024-10-28','2024-11-04','2024-11-11']
    assert [p['value'] for p in result['points']] == [150,300,400]
    assert [p['n'] for p in result['points']] == [3,1,1]
    assert [p['missing'] for p in result['points']] == [1,0,0]
    assert [p['in_progress'] for p in result['points']] == [False,False,True]
    assert result['summary'] == dict(overall=250,first=150,last=400,highest=400,lowest=150,change=250,direction='up')
    assert read(b)['points'][-1]['value'] == 99999
    assert read(metric='workouts',aggregate='sum')['summary']['overall'] == 5
    assert read(aggregate='max')['summary']['overall'] == 400
    pace = read(metric='pace')['summary']['overall']
    assert abs(pace - 3600*1000/7000) < .001, pace  # distance-weighted, not mean of run paces.
    hr = read(metric='avg_hr')['summary']['overall']
    assert abs(hr - (4*600*140+1200*160)/3600) < .001, hr
    assert sum(p['n'] for p in read(group_by='day',period_unit='days',period_count=17)['points']) == 5
    assert sum(p['n'] for p in read(group_by='month')['points']) == 5
    workouts = read(group_by='workout')['points']
    assert len(workouts)==5 and workouts[0]['start']<workouts[-1]['start']
    assert c.execute('SELECT current_user AS role').fetchone()['role'] != 'fit_coach', 'restricted role restored'
    with db.coach_scope(c,a):
        assert c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s',(b,)).fetchone()['n']==0, 'RLS isolates even explicit other-account reads'
        assert not c.execute("SELECT pg_has_role(current_user,'fit_all_readers','MEMBER') AS yes").fetchone()['yes']
    c.execute('DELETE FROM activities WHERE user_id=%s',(a,))
    empty = read()
    assert all(p['value'] is None and not p['n'] for p in empty['points'])
    assert empty['summary']['overall'] is None
    assert all(p['value']==0 for p in read(metric='workouts',aggregate='sum')['points'])
    # Newest thirty, ordered oldest-to-newest, with an explicit truncation marker.
    for i in range(35): add(a, now-dt.timedelta(minutes=35-i), i)
    newest = read(group_by='workout')
    assert newest['truncated'] and len(newest['points'])==30
    assert newest['points'][0]['value']==5 and newest['points'][-1]['value']==34
    for source, column in [('healthkit','health_ai_ok'),('garmin_connect','garmin_ai_ok')]:
        c.execute('DELETE FROM activities WHERE user_id=%s',(a,))
        c.execute(f'UPDATE profile SET {column}=false WHERE user_id=%s',(a,))
        add(a, now-dt.timedelta(hours=1), source=source)
        try: read()
        except HTTPException as error: assert error.status_code==403
        else: raise AssertionError('Health-derived measurements require category consent')
        c.execute(f'UPDATE profile SET {column}=true WHERE user_id=%s',(a,))
        assert read()['workouts']==1
    for changes in [dict(group_by='day',period_count=6),dict(period_count=27),dict(group_by='month',period_count=52)]:
        try: read(**changes)
        except HTTPException as error: assert error.status_code==422
        else: raise AssertionError('Too many chart points must fail before querying activities')
print('Progress series: three-week mean climb, weighted pace/HR, DST/Monday, gaps, bounds/truncation, ownership/RLS and Health consent PASS')
