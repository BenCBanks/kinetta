"""Real HTTP/SQL and worker concurrency, fictional accounts; every APNs delivery replaced."""
import datetime as dt
import json
import secrets
import tempfile
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from app import auth, db, apns, notify, personal_notifications as M, api_mydata
from app.main import app

uids = []
clients = []
role = 'zz_test_personal_' + uuid.uuid4().hex[:8]
password = secrets.token_urlsafe(24)
now = M.clock()
# A fixed future Monday permits deterministic boundary/DST tests without changing the server clock.
monday = now.date() + dt.timedelta(days=(7 - now.weekday()) % 7 + 7)
at = dt.datetime.combine(monday, dt.time(9), dt.timezone.utc)


def pref(uid, **values):
    with db.connect() as c:
        c.execute("UPDATE profile SET notify=coalesce(notify,'{}')||%s::jsonb WHERE user_id=%s",
                  (json.dumps({'personal': {'plan': False, 'weekly': False, 'plan_time': '08:00',
                                           'plan_after': (at - dt.timedelta(days=20)).isoformat(),
                                           'weekly_after': (at - dt.timedelta(days=20)).isoformat(), **values}}), uid))


def food(uid, day):
    with db.connect() as c:
        return c.execute("INSERT INTO food_entries(user_id,day,meal,name,kcal) VALUES(%s,%s,'lunch','Fictional plate',300) RETURNING id", (uid, day)).fetchone()['id']


def clear():
    with db.connect() as c:
        c.execute('DELETE FROM personal_notification_attempts WHERE user_id=ANY(%s)', (uids,))


try:
    for _ in range(2):
        login = 'zz_test_personal_' + uuid.uuid4().hex[:12]
        with db.connect() as c:
            uid = c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                            (login, 'Fictional Person', auth.hash_pw('green teapot on the hill'))).fetchone()['id']
            uids.append(uid)
            c.execute("INSERT INTO profile(user_id,tz) VALUES(%s,'UTC')", (uid,))
        cl = TestClient(app, raise_server_exceptions=False)
        cl.headers['Origin'] = 'http://testserver'
        r = cl.post('/api/login', json={'login': login, 'password': 'green teapot on the hill', 'app': True})
        assert r.status_code == 200
        cl.headers['Authorization'] = 'Bearer ' + r.json()['token']
        clients.append(cl)
        with db.connect() as c:
            session = c.execute('SELECT token_hash FROM sessions WHERE user_id=%s ORDER BY created DESC LIMIT 1', (uid,)).fetchone()['token_hash']
            c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s)",
                      (uuid.uuid4().hex * 2, uid, session))
    uid, other = uids
    a, b = clients
    endpoint = '/api/notifications/personal'
    status = a.get(endpoint).json()
    assert not status['plan'] and not status['weekly'] and status['plan_time'] == '08:00'
    assert a.put(endpoint, json={'weekly': True}).status_code == 400
    for body in [{'plan': 1}, {'weekly': 'true'}, {'plan_time': '03:00'}, {'plan_time': '09:15'}, {'weekly': False, 'user_id': other}]:
        assert a.put(endpoint, json=body).status_code == 422
    with patch.object(apns, 'ready', return_value=False):
        assert a.put(endpoint, json={'weekly': True, 'confirmed': True}).status_code == 409
    with patch.object(apns, 'ready', return_value=True):
        assert a.put(endpoint, json={'weekly': True, 'confirmed': True}).status_code == 200
        first = b.get(endpoint).json()
        assert not first['weekly'], 'No cross-account settings'
        assert a.put(endpoint, json={'plan': True, 'plan_time': '18:00', 'confirmed': True}).status_code == 200
        assert a.put(endpoint, json={'plan': False}).json()['weekly']
    # Existing social choices survive these controls, and vice versa.
    assert a.put('/api/notifications/settings', json={'cheers': False}).status_code == 200
    assert a.get(endpoint).json()['weekly']
    assert not a.get('/api/notifications').json()['push']['cheers']
    with db.connect() as c:
        c.execute("UPDATE profile SET notify='null'::jsonb WHERE user_id=%s", (uid,))
    with patch.object(apns, 'ready', return_value=True):
        assert a.put(endpoint, json={'weekly': True, 'confirmed': True}).json()['weekly']
    with patch.object(apns, 'ready', return_value=False):
        assert a.put(endpoint, json={'weekly': False}).status_code == 200
    # Activation/time changes cannot catch up an already-passed scheduled instant.
    with patch.object(apns, 'ready', return_value=True), patch.object(M, 'clock', return_value=at + dt.timedelta(minutes=1)):
        assert a.put(endpoint, json={'weekly': True, 'confirmed': True}).status_code == 200
    with db.connect() as c:
        p = M.profile(c, uid)
    assert not M.due(p, at + dt.timedelta(minutes=2))
    assert M.due(p, at + dt.timedelta(days=7))
    pref(uid, weekly=True)
    with db.connect() as c:
        p = M.profile(c, uid)
    assert M.due(p, at)[0][:2] == ('weekly', monday - dt.timedelta(days=7))
    assert M.due(p, at + dt.timedelta(minutes=14, seconds=59))
    assert not M.due(p, at - dt.timedelta(seconds=1))
    assert not M.due(p, at + dt.timedelta(minutes=15))
    assert not M.due(p, at + dt.timedelta(days=1))
    for day in [dt.date(2026, 3, 8), dt.date(2026, 11, 1), dt.date(2026, 3, 29), dt.date(2026, 10, 25)]:
        for zone in ['America/New_York', 'Europe/London']:
            when = dt.datetime.combine(day, dt.time(8), ZoneInfo(zone)).astimezone(dt.timezone.utc)
            p = {'tz': zone, 'notify': {'personal': {'plan': True, 'plan_after': (when - dt.timedelta(days=1)).isoformat()}}}
            assert M.due(p, when)[0][1] == day
            assert not M.due(p, when + dt.timedelta(hours=1))
    assert not M.due({'tz': 'UTC', 'notify': {'personal': {'plan': True}}}, at)
    assert not M.due({'tz': 'UTC', 'notify': {'personal': {'plan': True, 'plan_after': 'invalid'}}}, at)
    # Empty, future-only and unfinished lifting accounts do not receive a weekly invitation.
    sent = []
    def sender(device, payload):
        sent.append(payload)
        return True
    assert M.tick(at, send=sender) == 0
    future = food(uid, monday + dt.timedelta(days=1))
    with db.connect() as c:
        c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,lift_open) VALUES(%s,'workout','Fictional open session',%s,'manual',true)", (uid, at - dt.timedelta(days=1)))
    assert M.tick(at, send=sender) == 0
    prior = food(uid, monday - dt.timedelta(days=1))
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(lambda _: M.tick(at, send=sender), range(2))) == 1
    assert len(sent) == 1 and sent[0]['url'] == '/progress?section=activity&review=week'
    assert sent[0]['expires_at'] == int(at.timestamp()) + 900
    assert not any(word in json.dumps(sent).lower() for word in ['fictional', 'calorie', 'protein', 'heart', 'distance'])
    assert M.tick(at, send=sender) == 0
    with db.connect() as c:
        assert not c.execute("SELECT 1 FROM notifications WHERE user_id=ANY(%s)", (uids,)).fetchone()
    # Completed workouts count without food; own-row eligibility is independent of another account.
    pref(other, weekly=True)
    with db.connect() as c:
        assert not M.eligible(c, other, 'weekly', monday - dt.timedelta(days=7), 'UTC')
        c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,moving_s) VALUES(%s,'walk','Fictional completed walk',%s,'manual',600)", (other, at - dt.timedelta(days=2)))
        assert M.eligible(c, other, 'weekly', monday - dt.timedelta(days=7), 'UTC')
    assert M.tick(at, send=sender) == 1
    # Shared plan construction/adjustments and the exact existing completion rules.
    with db.connect() as c:
        plan = c.execute("""INSERT INTO training_plans(user_id,race,level,weeks,runs,long_day,start_day,race_day,unit,start_vol)
          VALUES(%s,'5k','beginner',8,3,6,%s,%s,'km',15) RETURNING *""", (uid, monday, monday + dt.timedelta(days=55))).fetchone()
        weeks = M.plans.build(plan, M.plans.paces(None))
        w = next(w for week in weeks for w in week['workouts'] if w['type'] != 'rest')
        day = w['day']
        assert M.eligible(c, uid, 'plan', day, 'UTC')
        rest = next(monday + dt.timedelta(days=n) for n in range(7) if not any(w['day'] == monday + dt.timedelta(days=n) for week in weeks for w in week['workouts']))
        assert not M.eligible(c, uid, 'plan', rest, 'UTC')
        c.execute('INSERT INTO plan_marks(user_id,plan_id,day,done) VALUES(%s,%s,%s,true)', (uid, plan['id'], day))
        assert not M.eligible(c, uid, 'plan', day, 'UTC')
        c.execute('DELETE FROM plan_marks WHERE user_id=%s', (uid,))
        c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,distance_m) VALUES(%s,'run','Fictional plan run',%s,'manual',%s)",
                  (uid, dt.datetime.combine(day, dt.time(6), dt.timezone.utc), w['dist'] * 1000 * .98))
        assert not M.eligible(c, uid, 'plan', day, 'UTC')
        c.execute('INSERT INTO plan_marks(user_id,plan_id,day,done) VALUES(%s,%s,%s,false)', (uid, plan['id'], day))
        assert M.eligible(c, uid, 'plan', day, 'UTC'), 'Explicit not-done wins, as in the plan UI'
        c.execute('DELETE FROM plan_marks WHERE user_id=%s', (uid,))
        c.execute("DELETE FROM activities WHERE user_id=%s AND sport='run'", (uid,))
        c.execute("INSERT INTO plan_adjustments(user_id,plan_id,day,workout) VALUES(%s,%s,%s,'{\"type\":\"rest\",\"dist\":0}'::jsonb)", (uid, plan['id'], day))
        assert not M.eligible(c, uid, 'plan', day, 'UTC')
        c.execute('DELETE FROM plan_adjustments WHERE user_id=%s', (uid,))
    clear()
    pref(uid, plan=True)
    pref(other)
    plan_at = dt.datetime.combine(day, dt.time(8), dt.timezone.utc)
    assert M.tick(plan_at, send=sender) == 1
    assert sent[-1]['url'] == '/plan' and sent[-1]['title'] == 'Today’s plan'
    # A completion or opt-out committed after the claim still suppresses the actual device send.
    original_deliver = M.deliver
    clear()
    def completed_after_claim(who, kind, period, **kwargs):
        with db.connect() as c:
            c.execute('INSERT INTO plan_marks(user_id,plan_id,day,done) VALUES(%s,%s,%s,true)', (uid, plan['id'], day))
        return original_deliver(who, kind, period, **kwargs)
    with patch.object(M, 'deliver', side_effect=completed_after_claim):
        assert M.tick(plan_at, send=sender) == 0
    with db.connect() as c:
        c.execute('DELETE FROM plan_marks WHERE user_id=%s', (uid,))
    clear()
    def disabled_after_claim(who, kind, period, **kwargs):
        pref(uid)
        return original_deliver(who, kind, period, **kwargs)
    with patch.object(M, 'deliver', side_effect=disabled_after_claim):
        assert M.tick(plan_at, send=sender) == 0
    clear()
    pref(uid, weekly=True)
    pref(other, weekly=True)
    def slow_first(device, payload):
        with db.connect() as c:
            if device['token'] == c.execute('SELECT token FROM native_push_devices WHERE user_id=%s', (uid,)).fetchone()['token']:
                assert not c.execute('SELECT 1 FROM personal_notification_attempts WHERE user_id=%s', (other,)).fetchone()
        return True
    assert M.tick(at, send=slow_first) == 2, 'Later accounts are not preclaimed before a slow send'
    clear()
    original_eligible = M.eligible
    def bad_account(c, who, *args):
        if who == uid:
            raise ValueError('Fictional corrupt account')
        return original_eligible(c, who, *args)
    with patch.object(M, 'eligible', side_effect=bad_account):
        assert M.tick(at, send=sender) == 1, 'A bad account cannot stop the next account'
    # A real retired token is removed through the existing delivery boundary.
    clear()
    pref(uid, plan=True)
    pref(other)
    with db.connect() as c:
        device = c.execute('SELECT * FROM native_push_devices WHERE user_id=%s', (uid,)).fetchone()
    assert M.tick(plan_at, send=lambda d, p: False) == 0
    with db.connect() as c:
        assert not c.execute('SELECT 1 FROM native_push_devices WHERE user_id=%s', (uid,)).fetchone()
        c.execute('INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,%s,%s,%s)', (device['token'], device['environment'], uid, device['session_hash']))
    assert M.tick(plan_at, send=sender) == 0
    # Final delivery rechecks preference, eligibility, zone and claim age per device.
    pref(uid)
    assert M.deliver(uid, 'plan', day, send=sender, now=plan_at) == 0
    pref(uid, plan=True)
    with db.connect() as c:
        c.execute("UPDATE profile SET tz='Asia/Tokyo' WHERE user_id=%s", (uid,))
    assert M.deliver(uid, 'plan', day, send=sender, now=plan_at) == 0
    with db.connect() as c:
        c.execute("UPDATE profile SET tz='UTC' WHERE user_id=%s", (uid,))
        c.execute('UPDATE training_plans SET active=false WHERE user_id=%s', (uid,))
    assert M.deliver(uid, 'plan', day, send=sender, now=plan_at) == 0
    with db.connect() as c:
        c.execute('UPDATE training_plans SET active=true WHERE user_id=%s', (uid,))
        c.execute("UPDATE personal_notification_attempts SET attempted_at=now()-interval '6 minutes' WHERE user_id=%s", (uid,))
    assert M.deliver(uid, 'plan', day, send=sender, now=plan_at) == 0
    # Failed/uncertain delivery cannot repeat; no profile lock is held across network work.
    clear()
    def fail(device, payload):
        with db.connect() as c:
            c.execute("SET LOCAL statement_timeout='300ms'")
            c.execute('UPDATE profile SET notify=notify WHERE user_id=%s', (uid,))
        raise RuntimeError('Fictional delivery failure')
    assert M.tick(plan_at, send=fail) == 0
    assert M.tick(plan_at, send=sender) == 0
    # Invalid legacy zones fall back safely; retired/suspended/expired accounts are silent.
    with db.connect() as c:
        c.execute("UPDATE profile SET tz='Not/AZone' WHERE user_id=%s", (uid,))
    assert a.get(endpoint).status_code == 200
    with db.connect() as c:
        c.execute("UPDATE profile SET tz='UTC' WHERE user_id=%s", (uid,))
        c.execute('UPDATE users SET suspended_at=now() WHERE id=%s', (uid,))
    clear()
    assert M.tick(plan_at, send=sender) == 0
    with db.connect() as c:
        c.execute('UPDATE users SET suspended_at=NULL WHERE id=%s', (uid,))
        c.execute("UPDATE sessions SET last_seen=now()-interval '1 year' WHERE user_id=%s", (uid,))
    assert M.tick(plan_at, send=sender) == 0
    with db.connect() as c:
        c.execute('UPDATE sessions SET last_seen=now() WHERE user_id=%s', (uid,))
    assert M.tick(plan_at, send=sender) == 1
    # Bounded metadata, real SQL reader ownership/read-only, export and cascade deletion.
    with db.connect() as c:
        c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role), sql.Literal(password)))
        c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
        c.execute('UPDATE users SET sql_role=%s WHERE id=%s', (role, uid))
    with psycopg.connect(db._conninfo(role, password), autocommit=True) as reader:
        rows = reader.execute('SELECT user_id FROM personal_notification_attempts').fetchall()
        assert rows and all(r[0] == uid for r in rows)
        try:
            reader.execute('DELETE FROM personal_notification_attempts')
        except psycopg.errors.InsufficientPrivilege:
            pass
        else:
            raise AssertionError('Reader must be read-only')
    with db.connect() as c:
        c.execute('SET LOCAL ROLE fit_coach')
        try:
            c.execute('SELECT * FROM personal_notification_attempts')
        except psycopg.errors.InsufficientPrivilege:
            c.rollback()
        else:
            raise AssertionError('AI role cannot read notification attempts')
    with tempfile.TemporaryDirectory() as tmp:
        path = str(Path(tmp) / 'export.zip')
        api_mydata._write_export(uid, path)
        with zipfile.ZipFile(path) as z:
            rows = [json.loads(line) for line in z.read('data/personal_notification_attempts.jsonl').decode().splitlines()]
            assert rows and all('user_id' not in row for row in rows)
    with db.connect() as c:
        c.execute("INSERT INTO personal_notification_attempts(user_id,kind,period,attempted_at) VALUES(%s,'plan',%s,now()-interval '91 days')", (uid, day - dt.timedelta(days=100)))
    with patch.object(apns, 'ready', return_value=False):
        M.tick()
    with db.connect() as c:
        assert not c.execute("SELECT 1 FROM personal_notification_attempts WHERE attempted_at<now()-interval '90 days'").fetchone()
        c.execute('DELETE FROM users WHERE id=%s', (uid,))
        assert not c.execute('SELECT 1 FROM personal_notification_attempts WHERE user_id=%s', (uid,)).fetchone()
    print('Personal notifications: HTTP defaults/strict opt-in/own settings, schedule/activation/DST/window, real plan completion/adjustments, food/workout/empty/open-lift weekly eligibility, concurrent once-only claims, private payload/expiry/no bell, final off/zone/claim/session checks, uncertain failure/no locks, RLS/export/retention/erasure PASS')
finally:
    for client in clients:
        client.close()
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=ANY(%s)', (uids,))
        c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
