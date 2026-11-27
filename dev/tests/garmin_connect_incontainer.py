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
    if url.endswith('/user/permissions'): return json.dumps({'permissions': state.get('perms', ['ACTIVITY_EXPORT', 'HEALTH_EXPORT'])}).encode()   # Garmin's real shape
    if url.endswith('/user/registration') and method == 'DELETE': state['deleted'].append(state['gid']); return b''
    if '/backfill/' in url: return b''
    if url.startswith(G.API + '/activityDetails'): state['fetched'].append(url); return json.dumps(DETAILS).encode()
    raise urllib.error.HTTPError(url, 404, 'no', {}, None)


def sign_in(uid, native=False):
    url = G.start(G.StartIn(native=native), user={'id': uid, 'is_admin': True})['url']
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
        try: G.start(user={'id': a, 'is_admin': False}); assert False, 'member started Garmin sign-in'
        except HTTPException as e: assert e.status_code == 403
        assert AC.connections({'id': a, 'is_admin': False})['garmin_connect_available'] is False
        assert AC.connections({'id': a, 'is_admin': True})['garmin_connect_available'] is True
        with patch.dict(os.environ, GARMIN_CLIENT_ID=''): assert not G.allowed({'id': a, 'is_admin': True})
        with patch.dict(os.environ, GARMIN_CONNECT_OPEN='1'): assert G.allowed({'id': a, 'is_admin': False})
        print('PASS Garmin Connect: admin only until opened, and hidden without keys')

        page, used = sign_in(a)
        assert page.status_code == 200 and b'Garmin is connected' in page.body
        assert b'New activities arrive after your watch syncs.' in page.body
        assert b'Strava export' in page.body and b'Health app' in page.body
        assert b'last 30 days' not in page.body
        assert G.callback(state=used, code='zz-code').status_code == 400, 'a sign-in link works once'
        assert G.callback(state='zz-made-up', code='zz-code').status_code == 400
        with db.connect() as c:
            s = G._settings(c, a)
            status = c.execute("SELECT status FROM connections WHERE user_id = %s AND kind = 'garmin_connect'", (a,)).fetchone()['status']
        assert status == 'connected - new activities arrive after your watch syncs'
        assert s['garmin_user_id'] == state['gid'] and s['access'] == state['access'] and s['refresh'] == 'zz-refresh'
        assert 'zz-refresh' not in json.dumps(AC.connections({'id': a, 'is_admin': True}), default=str), 'tokens never go back to the app'
        print('PASS sign-in with PKCE; the state link is single-use; tokens stay on the server')

        page, _ = sign_in(b)
        assert page.status_code == 400 and b'different Kinetta account' in page.body
        with db.connect() as c: assert not G._settings(c, b)
        print('PASS one Garmin account connects to one Kinetta account')

        # Starter denies history without breaking the connection or later new-activity pushes.
        before_settings = dict(s)
        for code in (403, 409):
            with patch.object(G, '_get', side_effect=urllib.error.HTTPError(G.API + '/backfill/activityDetails', code, 'stand-in denial', {}, None)):
                G.backfill(a)
            with db.connect() as c:
                assert G._settings(c, a) == before_settings
                status = c.execute("SELECT status FROM connections WHERE user_id = %s AND kind = 'garmin_connect'", (a,)).fetchone()['status']
                assert c.execute('SELECT count(*) AS n FROM activities WHERE user_id = %s', (a,)).fetchone()['n'] == 0
            assert status == 'connected - Garmin couldn’t resend older activities (403)'
        print('PASS history denial/already-requested response keeps connection and makes no activity/history promise')

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
        with db.connect() as c:
            alerts = c.execute("SELECT count(*) AS n FROM notifications WHERE user_id = %s AND kind = 'activity_ready'", (a,)).fetchone()['n']
        assert alerts == 1, ('a new Garmin Connect workout gets one "activity ready" alert; the repeat none', alerts)
        print('PASS activity details become one activity with a map; repeats are duplicates; one new-workout alert')

        pushed = [{**DETAILS[0], 'userId': state['gid'], 'activityId': 9002, 'summaryId': 'zz-2-detail',
                   'summary': {**DETAILS[0]['summary'], 'startTimeInSeconds': start_s - 86400}}]
        G.handle({'activityDetails': pushed})
        with db.connect() as c: assert c.execute('SELECT count(*) AS n FROM activities WHERE user_id = %s', (a,)).fetchone()['n'] == 1, 'pushed data on the ping address is ignored'
        G.handle({'activityDetails': [{**pushed[0], 'userId': 'zz-unknown'}]}, True)
        G.handle({'activityDetails': pushed}, True)
        with db.connect() as c: assert c.execute("SELECT count(*) AS n FROM activities WHERE user_id = %s AND source_id = '9002'", (a,)).fetchone()['n'] == 1
        import asyncio
        class Req:
            async def stream(self): yield json.dumps({'activityDetails': pushed}).encode()
        with patch.dict(os.environ, GARMIN_PUSH_SECRET='zz' * 20):
            for bad in ('', 'zz', 'zz' * 19 + 'zy'):
                try: asyncio.run(G.push(bad, Req())); assert False, 'push accepted without the secret'
                except HTTPException as e: assert e.status_code == 404
            with patch.object(G._notices, 'submit', return_value=True) as queued:
                assert asyncio.run(G.push('zz' * 20, Req())) == {'ok': True}
                queued.assert_called_once_with({'activityDetails': pushed}, True)
        with patch.dict(os.environ, GARMIN_PUSH_SECRET='short'):
            try: asyncio.run(G.push('short', Req())); assert False, 'a short secret is not accepted'
            except HTTPException as e: assert e.status_code == 404
        print('PASS push mode: data accepted only at the secret address, only for connected people')

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
            assert c.execute('SELECT count(*) AS n FROM activities WHERE user_id = %s', (a,)).fetchone()['n'] == 2, 'imported activities stay'
        print('PASS deregistrations and permission changes are checked with Garmin first')

        state.update(revoked=False, perms=['ACTIVITY_EXPORT'])
        sign_in(a)
        AC.disconnect('garmin_connect', {'id': a, 'is_admin': True})
        with db.connect() as c: assert not G._settings(c, a)
        assert state['deleted'] == [state['gid']]
        print('PASS Disconnect tells Garmin to stop sending data')

        page, _ = sign_in(b, native=True)
        assert page.status_code == 302 and page.headers['location'].startswith('kinetta://garmin-connect?ok=1&'), page.headers.get('location')
        native_text = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(page.headers['location']).query))['text']
        assert 'New activities arrive after your watch syncs.' in native_text
        assert 'Strava export' in native_text and 'Health app' in native_text and 'last 30 days' not in native_text
        page, _ = sign_in(a, native=True)
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(page.headers['location']).query))
        assert q['ok'] == '0' and 'different Kinetta account' in q['text']
        AC.disconnect('garmin_connect', {'id': b, 'is_admin': True})
        print('PASS the iPhone sign-in sheet gets its answer at a kinetta:// address, success and failure')

        sign_in(a)
        with db.connect() as c: s = G._settings(c, a)
        before = len(state['deleted'])
        G.deregister(s)
        assert len(state['deleted']) == before + 1
        print('PASS account deletion path deregisters with stored tokens')
finally:
    with db.connect() as c:
        for uid in ids: c.execute('DELETE FROM users WHERE id = %s', (uid,))

# Fixed, best-effort worker admission; no provider, retry scheduler or durable state.
import asyncio
import threading
import unittest
from app.garmin_queue import NoticeQueue


class NoticeQueueTests(unittest.TestCase):
    def body(self, *items):
        return {'activityDetails': [{'userId': 'zz-queue', 'n': n} for n in items]}

    def idle(self, queue):
        with queue._condition:
            self.assertTrue(queue._condition.wait_for(lambda: not queue._pending, timeout=3))

    def test_two_workers_accept_backlog_and_only_full_queue_refuses(self):
        release, both = threading.Event(), threading.Event()
        guard = threading.Lock()
        active, peak, seen = 0, 0, []
        def handle(body, pushed):
            nonlocal active, peak
            with guard:
                active += 1; peak = max(peak, active)
                if active == 2: both.set()
            try:
                self.assertTrue(release.wait(3))
                seen.extend(item['n'] for item in body['activityDetails'])
            finally:
                with guard: active -= 1
        q = NoticeQueue(handle, max_items=4)
        try:
            self.assertTrue(q.submit(self.body(1), False))
            self.assertTrue(q.submit(self.body(2), False))
            self.assertTrue(both.wait(1))
            self.assertTrue(q.submit(self.body(3, 4), False))  # workers busy; still accepted
            self.assertTrue(q.submit(self.body(3, 4), False))  # full but duplicate
            self.assertFalse(q.submit(self.body(3, 5), False))  # no partial enqueue
            release.set(); self.idle(q)
            self.assertEqual(sorted(seen), [1, 2, 3, 4])
            self.assertEqual(peak, 2)
            self.assertEqual(len(q._workers), 2)
            self.assertTrue(q.submit(self.body(5), False))
            self.idle(q)
            self.assertEqual(sorted(seen), [1, 2, 3, 4, 5])
        finally: release.set(); q.close()

    def test_utf8_byte_cap_and_release_on_completion(self):
        release, entered = threading.Event(), threading.Event()
        def handle(*args): entered.set(); self.assertTrue(release.wait(3))
        q = NoticeQueue(handle, max_items=10, max_bytes=80)
        body = {'activityDetails': [{'userId': 'zz', 'text': 'é'*20}]}
        other = {'activityDetails': [{'userId': 'zz', 'text': 'ü'*20}]}
        try:
            self.assertTrue(q.submit(body, True)); self.assertTrue(entered.wait(1))
            self.assertTrue(q.submit(body, True))
            self.assertFalse(q.submit(other, True))  # only the byte limit is reached
            self.assertFalse(q.submit({'activityDetails': [{'text': 'é'*80}]}, True))
            release.set(); self.idle(q)
            self.assertTrue(q.submit(other, True)); self.idle(q)
        finally: release.set(); q.close()

    def test_canonical_dedup_keeps_push_separate_and_preserves_batching(self):
        release, entered = threading.Event(), threading.Event()
        seen = []
        def handle(body, pushed):
            entered.set(); self.assertTrue(release.wait(3)); seen.append((body, pushed))
        q = NoticeQueue(handle)
        original = {'activityDetails': [{'userId': 'zz', 'n': 1}, {'userId': 'zz', 'n': 2}]}
        reversed_keys = {'activityDetails': [{'n': 1, 'userId': 'zz'}, {'n': 2, 'userId': 'zz'}]}
        try:
            self.assertTrue(q.submit(original, False)); self.assertTrue(entered.wait(1))
            self.assertTrue(q.submit(reversed_keys, False))
            self.assertTrue(q.submit(original, True))
            release.set(); self.idle(q)
            self.assertEqual(len(seen), 2)
            self.assertEqual({pushed for _, pushed in seen}, {False, True})
            self.assertTrue(all(body == original for body, _ in seen))
        finally: release.set(); q.close()

    def test_failure_does_not_retry_or_stop_later_work_and_logs_no_payload(self):
        seen = []
        def handle(body, pushed):
            n = body['activityDetails'][0]['n']; seen.append(n)
            if n == 1: raise ValueError('PRIVATE_CALLBACK_TOKEN')
        q = NoticeQueue(handle)
        try:
            with patch('builtins.print') as output:
                self.assertTrue(q.submit(self.body(1), False)); self.idle(q)
                output.assert_called_once_with('garmin queued notice failed', 'ValueError', flush=True)
            self.assertTrue(q.submit(self.body(2), False)); self.idle(q)
            self.assertEqual(seen, [1, 2])
            with patch('builtins.print', side_effect=ValueError('closed output')):
                self.assertTrue(q.submit(self.body(1), False)); self.idle(q)
            self.assertTrue(q.submit(self.body(3), False)); self.idle(q)
            self.assertEqual(seen, [1, 2, 1, 3])
        finally: q.close()

    def test_concurrent_identical_notices_admit_only_one_pending_copy(self):
        from concurrent.futures import ThreadPoolExecutor
        release, entered = threading.Event(), threading.Event()
        seen = []
        def handle(body, pushed):
            entered.set(); self.assertTrue(release.wait(3)); seen.append(body)
        q = NoticeQueue(handle, max_items=1)
        try:
            with ThreadPoolExecutor(8) as callers:
                results = list(callers.map(lambda _: q.submit(self.body(1), True), range(16)))
            self.assertTrue(all(results)); self.assertTrue(entered.wait(1))
            release.set(); self.idle(q)
            self.assertEqual(seen, [self.body(1)])
        finally: release.set(); q.close()

    def test_failed_owner_lookup_does_not_skip_good_sibling(self):
        bad = {'userId': 'bad', 'callbackURL': G.API+'/activityDetails?bad'}
        good = {'userId': 'good', 'callbackURL': G.API+'/activityDetails?good'}
        def owner(gid):
            if gid == 'bad': raise RuntimeError('stand-in DB failure')
            return 99
        with patch.object(G, '_owner', side_effect=owner), patch.object(G, 'fetch_details') as fetch, patch('builtins.print'):
            G.handle({'activityDetails': [bad, good]})
            fetch.assert_called_once_with(99, good['callbackURL'])

    def test_bad_activity_keeps_good_sibling_and_main_after_import_batch(self):
        with patch.object(G, '_owner', return_value=99), patch.object(G, 'activity', side_effect=[ValueError('bad item'), ({}, {})]), patch.object(G.activities, 'store', return_value=('added', 123)) as store, patch.object(G, '_set_status'), patch.object(coach, 'after_import') as after, patch('builtins.print'):
            body = self.body(1, 2)
            for item in body['activityDetails']: item['summary'] = {}
            G.handle(body, True)
            self.assertEqual(store.call_count, 1)
            after.assert_called_once_with(99, [123])

    def test_routes_acknowledge_queue_and_full_only_after_secret_check(self):
        from starlette.requests import Request
        release, entered = threading.Event(), threading.Event()
        def handle(*args): entered.set(); self.assertTrue(release.wait(3))
        q = NoticeQueue(handle, max_items=2)
        reads = []
        def request(body):
            async def receive():
                reads.append(1)
                return {'type': 'http.request', 'body': json.dumps(body).encode(), 'more_body': False}
            return Request({'type': 'http', 'method': 'POST', 'path': '/', 'headers': []}, receive)
        try:
            with patch.object(G, '_notices', q), patch.dict(os.environ, GARMIN_PUSH_SECRET='z'*40):
                self.assertEqual(asyncio.run(G.notify(request(self.body(1)))), {'ok': True})
                self.assertTrue(entered.wait(1))
                self.assertEqual(asyncio.run(G.push('z'*40, request(self.body(2)))), {'ok': True})
                self.assertEqual(asyncio.run(G.notify(request(self.body(1)))), {'ok': True})
                for route in (lambda: G.notify(request(self.body(3))), lambda: G.push('z'*40, request(self.body(3)))):
                    with self.assertRaises(HTTPException) as caught: asyncio.run(route())
                    self.assertEqual(caught.exception.status_code, 503)
                before = len(reads)
                with self.assertRaises(HTTPException) as caught: asyncio.run(G.push('wrong', request(self.body(3))))
                self.assertEqual(caught.exception.status_code, 404)
                self.assertEqual(len(reads), before)
        finally: release.set(); q.close()


result = unittest.main(argv=['garmin-queue'], exit=False).result
assert result.wasSuccessful(), 'Garmin memory queue regressions failed'
