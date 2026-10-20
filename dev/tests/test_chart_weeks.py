"""Seven Sunday-starting totals: authenticated ownership, sharing and viewer-local boundaries."""
import datetime as dt
from kc import Client, PW, person

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


try:
    for c in (owner, viewer):
        req(c, 'PUT', '/api/profile', {'tz': 'UTC'})
    today = dt.datetime.now(dt.timezone.utc).date()
    sunday = today - dt.timedelta(days=(today.weekday() + 1) % 7)
    first = sunday - dt.timedelta(weeks=6)
    cases = [(first-dt.timedelta(days=1), 99000, 'everyone'), (first, 1000, 'everyone'),
             (sunday-dt.timedelta(days=1), 2000, 'everyone'), (sunday, 3000, 'everyone'),
             (sunday, 5000, 'me'), (sunday, 4000, 'friends')]
    for day, distance, visibility in cases:
        a = req(owner, 'POST', '/api/activities/manual', {'sport':'walk', 'start':f'{day}T00:00:00+00:00', 'duration_s':600, 'distance_m':distance})
        req(owner, 'PUT', f"/api/activities/{a['id']}/sharing", {'visibility':visibility})
    boundary = sunday - dt.timedelta(days=1)
    a = req(owner, 'POST', '/api/activities/manual', {'sport':'walk', 'start':f'{boundary}T23:30:00+00:00', 'duration_s':600, 'distance_m':6000})
    req(owner, 'PUT', f"/api/activities/{a['id']}/sharing", {'visibility':'everyone'})
    public = profile(viewer)
    weeks = public['weeks']
    assert len(weeks) == 7 and len(public['days']) == 14
    assert all(dt.date.fromisoformat(r['d']).weekday() == 6 for r in weeks)
    assert weeks[0]['d'] == str(first) and weeks[0]['distance_m'] == 1000
    assert weeks[-2]['distance_m'] == 8000 and weeks[-1]['distance_m'] == 3000
    assert weeks[-1]['end'] == str(today) and weeks[-1]['today']
    assert profile(viewer, '?limit=1')['weeks'] == weeks, 'pagination never changes totals'
    stats = req(owner, 'GET', '/api/stats')
    assert len(stats['chart_weeks']) == 7 and len(stats['recent_days']) == 14
    assert stats['chart_today'] == str(today)
    assert stats['chart_weeks'][0]['distance_m'] == 1000
    assert stats['chart_weeks'][-2]['distance_m'] == 8000
    assert stats['chart_weeks'][-1]['distance_m'] == 12000
    assert all(r['distance_m'] == 0 for r in req(viewer, 'GET', '/api/stats')['chart_weeks']), 'stats never include another owner'
    req(viewer, 'POST', '/api/friends', {'login':'zz_test_chart_owner'})
    req(owner, 'POST', '/api/friends/zz_test_chart_view/accept')
    friend = profile(viewer)
    assert friend['weeks'][-1]['distance_m'] == 7000
    assert profile(owner, '?as_friend=true')['weeks'] == friend['weeks']
    req(viewer, 'PUT', '/api/profile', {'tz':'Asia/Tokyo'})
    local = profile(viewer)['weeks']
    assert local[-2]['distance_m'] == 2000 and local[-1]['distance_m'] == 13000, 'Sunday buckets follow viewer timezone'
    req(viewer, 'POST', '/api/people/zz_test_chart_owner/block')
    req(viewer, 'GET', '/api/people/zz_test_chart_owner/profile', code=404)
    req(Client(), 'GET', '/api/stats', code=401)
finally:
    for c in (owner, viewer):
        c.post('/api/account/delete', {'password':PW})
print(f'Seven-week chart API: {n} HTTP checks plus Sunday cutoff, zeros, timezone, current partial, private/friend/owner, preview and pagination PASS')
