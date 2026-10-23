"""Garmin Connect (developer program, OAuth 2.0 PKCE) with a stand-in Garmin (no network): sign-in, one account per Garmin
user, pings fetched only from Garmin, activity details become activities, token refresh, forged deregistrations ignored,
real ones honoured, AI consent, disconnect and account deletion tell Garmin."""
import base64
import datetime as dt
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
from unittest.mock import patch
from fastapi import HTTPException
from app import api_connections as AC, coach, db, garmin_connect as G

os.environ.update(GARMIN_CLIENT_ID='zz-client', GARMIN_CLIENT_SECRET='zz-secret')
start_s = int(time.time()) - 7200
DETAILS = [{'summaryId': 'zz-1-detail', 'activityId': 9001, 'summary': {
    'activityType': 'RUNNING', 'startTimeInSeconds': start_s, 'durationInSeconds': 1500, 'distanceInMeters': 5000,
    'averageHeartRateInBeatsPerMinute': 150, 'maxHeartRateInBeatsPerMinute': 172, 'activeKilocalories': 380, 'deviceName': 'Stand-in watch'},
    'samples': [{'startTimeInSeconds': start_s + i * 10, 'latitudeInDegree': 40.0 + i * 0.0003, 'longitudeInDegree': -75.0,
                 'elevationInMeters': 50, 'heartRate': 140 + i % 20, 'speedMetersPerSecond': 3.3, 'totalDistanceInMeters': i * 33}
                for i in range(150)]}]
state = {'gid': 'zz-garmin-user-1', 'access': 'zz-access-1', 'n': 0, 'revoked': False, 'deleted': [], 'fetched': [], 'verifier': None}


def fake_http(url, data=None, headers=None, method=None, cap=G.DATA_MAX):
    headers = headers or {}
    if url == G.TOKEN:
        f = dict(urllib.parse.parse_qsl(data.decode()))
        assert f['client_id'] == 'zz-client' and f['client_secret'] == 'zz-secret'
        if f['grant_type'] == 'authorization_code':
            challenge = base64.urlsafe_b64encode(hashlib.sha256(f['code_verifier'].encode()).digest()).rstrip(b'=').decode()
            if f['code'] != 'zz-code' or challenge != state['challenge'] or f['redirect_uri'] != G.redirect_uri():
                raise urllib.error.HTTPError(url, 400, 'bad', {}, None)
        elif state['revoked'] or f.get('refresh_token') != 'zz-refresh': raise urllib.error.HTTPError(url, 400, 'bad', {}, None)
        state['n'] += 1; state['access'] = f'zz-access-{state["n"]}'
        return json.dumps({'access_token': state['access'], 'refresh_token': 'zz-refresh', 'expires_in': 86400, 'refresh_token_expires_in': 7776000}).encode()
    if state['revoked'] or headers.get('Authorization') != 'Bearer ' + state['access']: raise urllib.error.HTTPError(url, 401, 'no', {}, None)
    if url.endswith('/user/id'): return json.dumps({'userId': state['gid']}).encode()
    if url.endswith('/user/permissions'): return json.dumps(state.get('perms', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'])).encode()
    if url.endswith('/user/registration') and method == 'DELETE': state['deleted'].append(state['gid']); return b''
    if '/backfill/' in url: return b''
    if url.startswith(G.API + '/activityDetails'): state['fetched'].append(url); return json.dumps(DETAILS).encode()
    raise urllib.error.HTTPError(url, 404, 'no', {}, None)


def sign_in(uid):
    url = G.start({'id': uid, 'is_admin': True})['url']
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))
    assert url.startswith(G.AUTHORIZE) and q['code_challenge_method'] == 'S256' and q['client_id'] == 'zz-client'
    state['challenge'] = q['code_challenge']
    return G.callback(state=q['state'], code='zz-code'), q['state']


ids = []
try:
    with db.connect() as c:
        for n in ('zz_test_gc_a', 'zz_test_gc_b'):
            ids.append(c.execute("INSERT INTO users (login, name) VALUES (%s, 'Fictional runner') RETURNING id", (n,)).fetchone()['id'])
            c.execute('INSERT INTO profile (user_id) VALUES (%s)', (ids[-1],))
    a, b = ids
    with patch.object(G, '_http', fake_http), patch.object(G.threading, 'Thread'), patch.object(coach, 'after_import'), patch('app.notify.threading.Thread'):
        try: G.start({'id': a, 'is_admin': False}); assert False, 'member started Garmin sign-in'
        except HTTPException as e: assert e.status_code == 403
        assert AC.connections({'id': a, 'is_admin': False})['garmin_connect_available'] is False
        assert AC.connections({'id': a, 'is_admin': True})['garmin_connect_available'] is True
        with patch.dict(os.environ, GARMIN_CLIENT_ID=''): assert not G.allowed({'id': a, 'is_admin': True})
        with patch.dict(os.environ, GARMIN_CONNECT_OPEN='1'): assert G.allowed({'id': a, 'is_admin': False})
        print('PASS Garmin Connect: admin only until opened, and hidden without keys')

        page, used = sign_in(a)
        assert page.status_code == 200 and b'Garmin is connected' in page.body
        assert G.callback(state=used, code='zz-code').status_code == 400, 'a sign-in link works once'
        assert G.callback(state='zz-made-up', code='zz-code').status_code == 400
        with db.connect() as c:
            s = G._settings(c, a)
        assert s['garmin_user_id'] == state['gid'] and s['access'] == state['access'] and s['refresh'] == 'zz-refresh'
        assert 'zz-refresh' not in json.dumps(AC.connections({'id': a, 'is_admin': True}), default=str), 'tokens never go back to the app'
        print('PASS sign-in with PKCE; the state link is single-use; tokens stay on the server')

        page, _ = sign_in(b)
        assert page.status_code == 400 and b'different Kinetta account' in page.body
        with db.connect() as c: assert not G._settings(c, b)
        print('PASS one Garmin account connects to one Kinetta account')

        for bad in ('https://evil.example/wellness-api/rest/activityDetails?x', 'http://apis.garmin.com/wellness-api/rest/activityDetails',
                    'https://apis.garmin.com.evil.example/wellness-api/rest/x', 'https://zz@apis.garmin.com/wellness-api/rest/x',
                    'https://apis.garmin.com/other/x'):
            G.handle({'activityDetails': [{'userId': state['gid'], 'callbackURL': bad}]})
        G.handle({'activityDetails': [{'userId': 'zz-unknown', 'callbackURL': G.API + '/activityDetails?x=1'}]})
        assert not state['fetched'], 'only Garmin links for connected people are fetched'
        print('PASS forged pings never send a token outside Garmin')

        ping = G.API + f'/activityDetails?uploadStartTimeInSeconds={start_s}&uploadEndTimeInSeconds={start_s + 3600}&token=zz'
        G.handle({'activityDetails': [{'userId': state['gid'], 'callbackURL': ping}]})
        G.handle({'activityDetails': [{'userId': state['gid'], 'callbackURL': ping}]})
        with db.connect() as c:
            acts = c.execute("SELECT sport, distance_m, avg_hr, source, source_id, geom IS NOT NULL AS has_map FROM activities WHERE user_id = %s", (a,)).fetchall()
            con = c.execute("SELECT status, last_count FROM connections WHERE user_id = %s AND kind = 'garmin_connect'", (a,)).fetchone()
        assert len(acts) == 1, acts
        r = acts[0]
        assert r['sport'] == 'run' and round(r['distance_m']) == 5000 and r['source'] == 'garmin_connect' and r['source_id'] == '9001' and r['has_map'], r
        assert con['status'].startswith('0 new, 1 already here'), con
        print('PASS activity details become one activity with a map; repeats are duplicates')

        with db.connect() as c:
            assert not coach.health_ok(c, a), 'AI needs a separate yes for Garmin data'
            c.execute('UPDATE profile SET garmin_ai_ok = true WHERE user_id = %s', (a,))
            assert coach.health_ok(c, a)
            assert coach.health_ok(c, b), 'people without Garmin activities are unaffected'
        print('PASS Kit reads Garmin activities only after its own yes')

        with db.connect() as c:
            c.execute("UPDATE connections SET settings = settings || '{\"expires\": 0}'::jsonb WHERE user_id = %s AND kind = 'garmin_connect'", (a,))
        before = state['access']
        assert G.access_token(a) != before and G.access_token(a) == state['access']
        print('PASS an expired access token is refreshed once and saved')

        G.handle({'deregistrations': [{'userId': state['gid']}]})
        with db.connect() as c: assert G._settings(c, a), 'a deregistration Garmin did not confirm changes nothing'
        state['perms'] = ['HEALTH_EXPORT']
        G.handle({'userPermissionsChange': [{'userId': state['gid'], 'permissions': ['ACTIVITY_EXPORT']}]})
        with db.connect() as c:
            s, st = G._settings(c, a), c.execute("SELECT status FROM connections WHERE user_id = %s AND kind = 'garmin_connect'", (a,)).fetchone()['status']
        assert s['permissions'] == ['HEALTH_EXPORT'] and 'activity sharing is off' in st, 'permissions come from Garmin, not the notice'
        state['revoked'] = True
        G.handle({'deregistrations': [{'userId': state['gid']}]})
        with db.connect() as c:
            assert not G._settings(c, a)
            assert c.execute('SELECT count(*) AS n FROM activities WHERE user_id = %s', (a,)).fetchone()['n'] == 1, 'imported activities stay'
        print('PASS deregistrations and permission changes are checked with Garmin first')

        state.update(revoked=False, perms=['ACTIVITY_EXPORT'])
        sign_in(a)
        AC.disconnect('garmin_connect', {'id': a, 'is_admin': True})
        with db.connect() as c: assert not G._settings(c, a)
        assert state['deleted'] == [state['gid']]
        print('PASS Disconnect tells Garmin to stop sending data')

        sign_in(a)
        with db.connect() as c: s = G._settings(c, a)
        G.deregister(s)
        assert state['deleted'] == [state['gid']] * 2
        print('PASS account deletion path deregisters with stored tokens')
finally:
    with db.connect() as c:
        for uid in ids: c.execute('DELETE FROM users WHERE id = %s', (uid,))
