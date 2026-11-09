"""Profile's 12 Sunday-starting totals and stats' seven-week range."""
import datetime as dt
from kc import Client, PW, person
from zoneinfo import ZoneInfo

owner = person('zz_test_chart_owner', 'Chart Owner')
viewer = person('zz_test_chart_view', 'Chart Viewer')
n = 0


def req(c, method, path, body=None, code=200):
    global n
    status, result = c.req(method, path, body)
    assert status == code, (path, status, result)
    n += 1
    return result


def profile(c, query=''):
    return req(c, 'GET', '/api/people/zz_test_chart_owner/profile' + query)['mileage']


def assert_profile_fixtures(mileage, first_included, target_sunday, outside):
    weeks = mileage['weeks']
    by_day = {r['d']: r for r in weeks}
    assert len(weeks) == 12 and len(mileage['days']) == 14
    assert all(dt.date.fromisoformat(r['d']).weekday() == 6 for r in weeks)
    assert weeks[-1]['end'] == str(mileage['today']) and weeks[-1]['today']
    expected = {
        str(first_included): 1000,
        str(target_sunday - dt.timedelta(days=7)): 8000,
        str(target_sunday): 12000,
    }
    assert all(day in by_day and by_day[day]['distance_m'] == value for day, value in expected.items())
    assert str(outside) not in by_day, 'the activity before the stable chart window stays excluded'
    sunday = by_day[str(target_sunday)]
    assert (sunday['activities'], sunday['time_s']) == (3, 1800)
    assert sunday['by_sport'] == {'run': 3000, 'ride': 5000, 'walk': 4000}


try:
    for c in (owner, viewer):
        req(c, 'PUT', '/api/profile', {'tz': 'UTC'})
    anchor = dt.date.fromisoformat(req(owner, 'GET', '/api/stats')['chart_today'])
    current_sunday = anchor - dt.timedelta(days=(anchor.weekday() + 1) % 7)
    first_included = current_sunday - dt.timedelta(weeks=10)
    outside = current_sunday - dt.timedelta(weeks=12)
    target_sunday = current_sunday
    target_saturday = target_sunday - dt.timedelta(days=1)
    cases = [(outside, '00:00', 99000, 'walk', 'everyone'),
             (first_included, '00:00', 1000, 'walk', 'everyone'),
             (target_saturday, '00:00', 2000, 'walk', 'everyone'),
             (target_saturday, '23:30', 6000, 'run', 'everyone'),
             (target_sunday, '00:00', 3000, 'run', 'everyone'),
             (target_sunday, '00:00', 5000, 'ride', 'me'),
             (target_sunday, '00:00', 4000, 'walk', 'friends')]
    for day, clock, distance, sport, visibility in cases:
        a = req(owner, 'POST', '/api/activities/manual', {'sport':sport, 'start':f'{day}T{clock}:00+00:00', 'duration_s':600, 'distance_m':distance})
        req(owner, 'PUT', f"/api/activities/{a['id']}/sharing", {'visibility':visibility})
    public = profile(viewer)
    assert_profile_fixtures(public, first_included, target_sunday, outside)
    assert all(abs(sum(r['by_sport'].values())-r['distance_m'])<.001 for r in public['weeks'])
    assert_profile_fixtures(profile(viewer, '?limit=1'), first_included, target_sunday, outside)
    stats = req(owner, 'GET', '/api/stats')
    assert len(stats['chart_weeks']) == 7 and len(stats['recent_days']) == 14
    chart_today = dt.date.fromisoformat(stats['chart_today'])
    chart_sunday = chart_today - dt.timedelta(days=(chart_today.weekday() + 1) % 7)
    assert stats['chart_weeks'][0]['d'] == str(chart_sunday - dt.timedelta(weeks=6))
    chart_week = next(r for r in stats['chart_weeks'] if r['d'] == str(target_sunday))
    assert chart_week['distance_m'] == 12000
    assert chart_week['by_sport'] == {'run':3000,'ride':5000,'walk':4000}
    prior_chart_week = next(r for r in stats['chart_weeks'] if r['d'] == str(target_sunday - dt.timedelta(days=7)))
    assert prior_chart_week['distance_m'] == 8000
    assert prior_chart_week['by_sport'] == {'run':6000,'walk':2000}
    assert stats['week_streak'] == 1, 'the stable latest-Sunday fixture is current or the most recent active week across a one-day rollover'
    recent_day = next(r for r in stats['recent_days'] if r['d'] == str(target_sunday))
    assert recent_day['by_sport'] == {'run':3000,'ride':5000,'walk':4000}
    viewer_stats = req(viewer, 'GET', '/api/stats')
    assert viewer_stats['week_streak'] == 0 and viewer_stats['close_to'] is None and all(r['distance_m'] == 0 for r in viewer_stats['chart_weeks']), 'stats never include another owner'
    req(viewer, 'POST', '/api/friends', {'login':'zz_test_chart_owner'})
    req(owner, 'POST', '/api/friends/zz_test_chart_view/accept')
    friend = profile(viewer)
    assert_profile_fixtures(friend, first_included, target_sunday, outside)
    assert_profile_fixtures(profile(owner, '?as_friend=true'), first_included, target_sunday, outside)
    req(viewer, 'PUT', '/api/profile', {'tz':'Asia/Tokyo'})
    local = profile(viewer)['weeks']
    local_by_day = {r['d']: r for r in local}
    prior = local_by_day[str(target_sunday - dt.timedelta(days=7))]
    sunday = local_by_day[str(target_sunday)]
    assert prior['distance_m'] == 2000 and prior['by_sport'] == {'walk':2000}, 'Saturday UTC work before the local cutoff stays in the prior Tokyo week'
    assert sunday['distance_m'] == 18000 and sunday['by_sport'] == {'run':9000,'ride':5000,'walk':4000}, 'late Saturday UTC work follows the Sunday cutoff in Tokyo'
    req(viewer, 'POST', '/api/people/zz_test_chart_owner/block')
    req(viewer, 'GET', '/api/people/zz_test_chart_owner/profile', code=404)
    req(Client(), 'GET', '/api/stats', code=401)
finally:
    for c in (owner, viewer):
        c.post('/api/account/delete', {'password':PW})
print(f'Profile 12-week/stats 7-week chart API: {n} HTTP checks plus Sunday cutoff, zeros, timezone, current partial, all-workout totals, friend/owner, preview and pagination PASS')
