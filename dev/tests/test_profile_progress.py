"""Profile progress and @username search use only allowed, fictional workouts."""
import datetime as dt
import json
from urllib.parse import quote
from kc import Client, PW, person

owner = person('zz_test_progress_owner', 'Progress Fixture')
viewer = person('zz_test_progress_view', 'Progress Viewer')
n = 0


def req(client, method, path, body=None, code=200):
    global n
    status, data = client.req(method, path, body)
    assert status == code, (method, path, status, data)
    n += 1
    return data


def profile(client, suffix=''):
    return req(client, 'GET', '/api/people/zz_test_progress_owner/profile' + suffix)


try:
    # UTC makes the period boundary deterministic regardless of server timezone/DST.
    req(owner, 'PUT', '/api/profile', {'tz': 'UTC'})
    req(viewer, 'PUT', '/api/profile', {'tz': 'UTC'})
    anchor = profile(viewer)['recent']
    today = dt.date.fromisoformat(anchor['end'])
    current_day, second_current_day = today - dt.timedelta(days=3), today - dt.timedelta(days=8)
    previous_days = (today - dt.timedelta(days=35), today - dt.timedelta(days=50))
    outside_previous = today - dt.timedelta(days=65)
    cases = [('me', current_day, 9000), ('friends', current_day, 2000), ('everyone', current_day, 1000),
             ('everyone', second_current_day, 3000), ('everyone', previous_days[0], 4000),
             ('everyone', previous_days[1], 5000), ('everyone', outside_previous, 6000)]
    ids = []
    for visibility, day, distance in cases:
        a = req(owner, 'POST', '/api/activities/manual', {'sport': 'walk', 'start': f'{day}T00:00:00+00:00', 'duration_s': 600, 'distance_m': distance, 'name': 'Progress fixture'})
        ids.append(a['id'])
        req(owner, 'PUT', f"/api/activities/{a['id']}/sharing", {'visibility': visibility})
    recent = profile(viewer, '?limit=1')['recent']
    assert (dt.date.fromisoformat(recent['end']) - dt.date.fromisoformat(recent['start'])).days == 29
    assert recent['current'] == {'activities': 4, 'distance_m': 15000, 'time_s': 2400, 'active_days': 2}, 'totals include private and friends-only workouts'
    assert recent['previous'] == {'activities': 2, 'distance_m': 9000, 'time_s': 1200, 'active_days': 2}
    paged = profile(viewer, '?limit=50')['recent']
    assert paged['current'] == recent['current'] and paged['previous'] == recent['previous'], 'pagination must not change progress totals'
    req(viewer, 'POST', '/api/friends', {'login': 'zz_test_progress_owner'})
    req(owner, 'POST', '/api/friends/zz_test_progress_view/accept')
    friend = profile(viewer)['recent']
    assert friend['current'] == recent['current'] and friend['previous'] == recent['previous'], 'friends see the same totals as other members'
    assert friend['current']['active_days'] == 2, 'same-day workouts count as one active day'
    owner_preview = profile(owner, '?as_friend=true')['recent']
    assert owner_preview['current'] == friend['current'] and owner_preview['previous'] == friend['previous']
    assert profile(owner)['recent']['current']['distance_m'] == 15000
    forced = profile(viewer, '?as_friend=true')['recent']
    assert forced['current'] == friend['current'] and forced['previous'] == friend['previous'], 'cannot force owner-only view'
    req(owner, 'PUT', '/api/sharing', {'findable': False})
    # Accepted friends remain findable; exact handle lookup still works after removing friendship.
    req(owner, 'DELETE', '/api/friends/zz_test_progress_view')
    assert req(viewer, 'GET', '/api/people/search?q=Progress%20Fixture') == []
    found = req(viewer, 'GET', '/api/people/search?q=' + quote(' @ZZ_TEST_PROGRESS_OWNER '))
    assert [x['login'] for x in found] == ['zz_test_progress_owner']
    assert all(set(x) == {'login', 'name', 'photo', 'status'} for x in found)
    assert req(viewer, 'GET', '/api/people/search?q=zz%25test') == [], 'wildcards are literal'
    req(viewer, 'POST', '/api/people/zz_test_progress_owner/block')
    req(viewer, 'GET', '/api/people/zz_test_progress_owner/profile', code=404)
    assert req(viewer, 'GET', '/api/people/search?q=%40zz_test_progress_owner') == []
    req(Client(), 'GET', '/api/people/search?q=Progress', code=401)
    req(Client(), 'GET', '/api/people/zz_test_progress_owner/profile', code=401)
    raw = json.dumps(friend)
    assert all(field not in raw for field in ('weight', 'heart_rate', 'calories', 'user_id', 'food'))
finally:
    for c in (owner, viewer):
        c.post('/api/account/delete', {'password': PW})

print(f'Profile progress/search: {n} HTTP checks plus period boundaries, visibility, pagination, active days and @handle privacy PASS')
