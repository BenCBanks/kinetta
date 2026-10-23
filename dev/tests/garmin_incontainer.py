"""Garmin Personal API connection with a stand-in Garmin (no network): key check, FIT download, duplicates, expired keys."""
import base64
import datetime as dt
import io
import json
import time
import urllib.error
import zipfile
from unittest.mock import patch
from fastapi import HTTPException
from app import api_connections as AC, coach, db, parsers

GOOD, FIT = 'zz-test-personal-key-123', b'stand-in fit bytes'
calls = []
b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip('=')
TOKEN = b64({'alg': 'none'}) + '.' + b64({'exp': int(time.time()) + 86400}) + '.zz-signature'


def zipped(data):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z: z.writestr('123_ACTIVITY.fit', data)
    return buf.getvalue()


def fake_req(path, headers, method='GET', data=None):
    calls.append(path)
    auth = headers.get('Authorization', '')
    if path.endswith('/personal-api-key/token'):
        if auth != 'ApiKey ' + GOOD: raise urllib.error.HTTPError(path, 401, 'no', {}, None)
        return TOKEN.encode()   # Garmin answers with the bare JWT as text
    if auth != 'Bearer ' + TOKEN: raise urllib.error.HTTPError(path, 401, 'no', {}, None)
    if path.startswith('/activitylist-service/'): return json.dumps([{'activityId': 111}, {'activityId': 222}]).encode()
    if path.endswith('/111'): return zipped(FIT)
    if path.endswith('/222'): return zipped(b'unreadable')
    raise urllib.error.HTTPError(path, 404, 'no', {}, None)


now = dt.datetime.now(dt.timezone.utc)
def fake_read(name, data):
    if data != FIT: raise parsers.ParseError('no recorded data in the file')
    return {'sport': 'run', 'sub_sport': None, 'start': now - dt.timedelta(hours=2), 'device': 'Stand-in watch', 'laps': [],
            'session': {'elapsed_s': 1800, 'moving_s': 1800, 'distance_m': 5000}, 'streams': {k: [] for k in ('t',) + parsers.STREAMS}}


uid = None
try:
    with db.connect() as c:
        uid = c.execute("INSERT INTO users (login, name) VALUES ('zz_test_garmin', 'Fictional runner') RETURNING id").fetchone()['id']
        c.execute('INSERT INTO profile (user_id) VALUES (%s)', (uid,))
    user = {'id': uid, 'is_admin': True}
    with patch.object(AC, '_garmin_req', fake_req), patch.object(AC.parsers, 'read', fake_read), \
         patch.object(AC.threading, 'Thread'), patch.object(coach, 'after_import'), patch('app.notify.threading.Thread'):
        for call in (lambda: AC.garmin_connect(AC.GarminIn(api_key=GOOD), {'id': uid, 'is_admin': False}), lambda: AC.garmin_sync_now({'id': uid, 'is_admin': False})):
            try: call(); assert False, 'member connected Garmin'
            except HTTPException as e: assert e.status_code == 403
        assert AC.connections({'id': uid, 'is_admin': False})['garmin_available'] is False and AC.connections(user)['garmin_available'] is True
        print('PASS only the admin can connect Garmin for now')
        try: AC.garmin_connect(AC.GarminIn(api_key='zz-wrong-key-000'), user); assert False, 'wrong key accepted'
        except HTTPException as e: assert e.status_code == 400 and 'Garmin' in e.detail
        with db.connect() as c: assert not c.execute("SELECT 1 FROM connections WHERE user_id = %s", (uid,)).fetchone(), 'a refused key is not saved'

        assert AC.garmin_connect(AC.GarminIn(api_key=GOOD), user)['ok']
        assert abs(AC._garmin_tokens[uid][2] - (time.time() + 86400 - 300)) < 5, 'token expiry read from the JWT'
        AC._sync_garmin(uid, 30)
        with db.connect() as c:
            acts = c.execute("SELECT source, source_id, device FROM activities WHERE user_id = %s", (uid,)).fetchall()
            con = c.execute("SELECT status, settings FROM connections WHERE user_id = %s AND kind = 'garmin'", (uid,)).fetchone()
        assert [(a['source'], a['source_id']) for a in acts] == [('garmin', '111')], acts
        assert con['status'] == '1 new, 0 already here, 1 failed', con['status']
        assert con['settings']['seen'] == ['111', '222'], 'imported and unreadable activities are not fetched again'
        print('PASS Garmin key checked, original FIT unzipped and saved, unreadable file skipped next time')

        calls.clear(); AC._sync_garmin(uid, 14)
        assert not any('/download-service/' in p for p in calls), 'a second sync downloads nothing already handled'
        assert not any(p.endswith('/token') for p in calls), 'the access token is reused while valid'
        print('PASS second sync reuses the token and skips handled activities')

        with db.connect() as c: c.execute("UPDATE connections SET settings = jsonb_set(settings, '{seen}', '[]') WHERE user_id = %s", (uid,))
        AC._sync_garmin(uid, 14)
        with db.connect() as c:
            assert c.execute("SELECT count(*) n FROM activities WHERE user_id = %s", (uid,)).fetchone()['n'] == 1, 'same workout twice is one activity'
        print('PASS a workout already in Kinetta (for example from intervals.icu) is not duplicated')

        AC._garmin_tokens[uid] = (AC._h(GOOD), 'stale-token', time.time() + 999)
        calls.clear(); AC._sync_garmin(uid, 14)
        assert sum(p.endswith('/token') for p in calls) == 1, 'a rejected token is replaced once'
        with db.connect() as c: c.execute("UPDATE connections SET settings = jsonb_set(settings, '{api_key}', '\"zz-expired-key\"') WHERE user_id = %s", (uid,))
        AC._garmin_tokens.pop(uid, None); AC._sync_garmin(uid, 14)
        with db.connect() as c:
            assert 'no longer accepts' in c.execute("SELECT status FROM connections WHERE user_id = %s AND kind = 'garmin'", (uid,)).fetchone()['status']
        print('PASS expired tokens renew; an expired key tells the person to make a new one')

        listed = AC.connections(user)
        assert 'garmin' in listed and 'api_key' not in json.dumps(listed, default=str) and GOOD not in json.dumps(listed, default=str), 'the key never goes back to the app'
        AC.disconnect('garmin', user)
        with db.connect() as c: assert not c.execute("SELECT 1 FROM connections WHERE user_id = %s AND kind = 'garmin'", (uid,)).fetchone()
        print('PASS key is never returned to the app; Disconnect removes it')
finally:
    AC._garmin_tokens.pop(uid, None)
    if uid:
        with db.connect() as c: c.execute('DELETE FROM users WHERE id = %s', (uid,))
