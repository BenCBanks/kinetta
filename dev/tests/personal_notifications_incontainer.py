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
                  (json.dumps({'personal': {'plan': False, 'weekly': False, 'streak': False, 'plan_time': '08:00',
                                           'plan_after': (at - dt.timedelta(days=20)).isoformat(),
                                           'weekly_after': (at - dt.timedelta(days=20)).isoformat(),
                                           'streak_after': (at - dt.timedelta(days=20)).isoformat(), **values}}), uid))


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
    assert not status['plan'] and not status['weekly'] and not status['streak'] and status['plan_time'] == '08:00'
    assert a.put(endpoint, json={'weekly': True}).status_code == 400
    assert a.put(endpoint, json={'streak': True}).status_code == 400
    for body in [{'plan': 1}, {'weekly': 'true'}, {'streak': 'true'}, {'plan_time': '03:00'}, {'plan_time': '09:15'}, {'weekly': False, 'user_id': other}]:
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
    # Friday's local 6 pm reminder follows DST and uses a stable local Saturday week marker.
    for zone, friday, expected_utc_hour in [('America/New_York', dt.date(2026, 3, 6), 23),
                                            ('America/New_York', dt.date(2026, 3, 13), 22),
                                            ('Europe/London', dt.date(2026, 3, 27), 18),
                                            ('Europe/London', dt.date(2026, 4, 3), 17)]:
        scheduled = dt.datetime.combine(friday, dt.time(18), ZoneInfo(zone)).astimezone(dt.timezone.utc)
        assert scheduled.hour == expected_utc_hour
        p = {'tz': zone, 'notify': {'personal': {'streak': True, 'streak_after': (scheduled-dt.timedelta(days=1)).isoformat()}}}
        monday_key = friday - dt.timedelta(days=friday.weekday()) + dt.timedelta(days=5)
        assert M.due(p, scheduled) == [('streak', monday_key, scheduled)]
        assert M.due(p, scheduled + dt.timedelta(minutes=14, seconds=59))
        assert not M.due(p, scheduled - dt.timedelta(seconds=1))
        assert not M.due(p, scheduled + dt.timedelta(minutes=15))
    assert not M.due({'tz': 'UTC', 'notify': {'personal': {'plan': True}}}, at)
    assert not M.due({'tz': 'UTC', 'notify': {'personal': {'plan': True, 'plan_after': 'invalid'}}}, at)
    sent = []
    def sender(device, payload):
        sent.append(payload)
        return True
    streak_friday = monday + dt.timedelta(days=4)
    streak_key = monday + dt.timedelta(days=5)
    streak_at = dt.datetime.combine(streak_friday, dt.time(18), dt.timezone.utc)
    pref(uid, streak=True, streak_after=(streak_at-dt.timedelta(days=20)).isoformat())
    pref(other)
    clear()
    with db.connect() as c:
        prior_1 = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,moving_s) VALUES(%s,'run','Fictional streak run',%s,'manual',600) RETURNING id",
                             (uid, dt.datetime.combine(monday-dt.timedelta(days=14), dt.time(9), dt.timezone.utc))).fetchone()['id']
        prior_2 = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,moving_s) VALUES(%s,'walk','Fictional streak walk',%s,'manual',600) RETURNING id",
                             (uid, dt.datetime.combine(monday-dt.timedelta(days=7), dt.time(9), dt.timezone.utc))).fetchone()['id']
        assert M.streak_at_risk(c, uid, 'UTC', streak_at) == 2
        assert M.eligible(c, uid, 'streak', streak_key, 'UTC', streak_at)
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(lambda _: M.tick(streak_at), range(2))) == 1, 'one period-only bell row per local week under concurrent ticks, even without APNs'
    assert not sent, 'bell creation does not require or send a phone notification'
    la_friday = dt.datetime.combine(streak_friday, dt.time(18), ZoneInfo('America/Los_Angeles')).astimezone(dt.timezone.utc)
    with db.connect() as c:
        c.execute('UPDATE profile SET tz=%s WHERE user_id=%s', ('America/Los_Angeles', uid))
        p = M.profile(c, uid)
        assert M.due(p, la_friday)[0][:2] == ('streak', streak_key), 'timezone edits within a local week preserve the Saturday key'
    assert M.tick(la_friday) == 0, 'timezone edit and repeated ticks cannot create a second reminder in the same local week'
    with db.connect() as c:
        c.execute("UPDATE profile SET tz='UTC' WHERE user_id=%s", (uid,))
    with db.connect() as c:
        claim = c.execute("SELECT kind,period FROM personal_notification_attempts WHERE user_id=%s", (uid,)).fetchall()
        assert ('weekly', streak_key) in [(row['kind'], row['period']) for row in claim], 'Saturday streak marker reuses the weekly attempt kind without migration'
        assert ('weekly', monday-dt.timedelta(days=7)) not in [(row['kind'], row['period']) for row in claim]
        c.execute("INSERT INTO personal_notification_attempts(user_id,kind,period) VALUES(%s,'weekly',%s) ON CONFLICT DO NOTHING", (uid, monday-dt.timedelta(days=7)))
        assert c.execute("SELECT count(*) AS n FROM personal_notification_attempts WHERE user_id=%s AND kind='weekly'", (uid,)).fetchone()['n'] == 2, 'Friday Saturday marker cannot collide with Monday weekly-summary key'
        c.execute("DELETE FROM personal_notification_attempts WHERE user_id=%s AND kind='weekly' AND period=%s", (uid, monday-dt.timedelta(days=7)))
        assert notify.streak_reminder_parts(f'streak_reminder:{streak_key}') == streak_key
        assert notify.streak_reminder_parts('streak_reminder:2026-02-30') is None
        assert notify.streak_reminder_parts('streak_reminder:2026-11-06') is None
        assert notify.record_streak_reminder(c, uid, streak_key, streak_at) is None, 'repeated tick cannot create a second bell row'
        c.execute('DELETE FROM notifications WHERE user_id=%s AND kind=%s', (uid, f'streak_reminder:{streak_key}'))
        current_activity = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,moving_s) VALUES(%s,'ride','Fictional current-week ride',%s,'manual',600) RETURNING id",
                                     (uid, dt.datetime.combine(monday+dt.timedelta(days=2), dt.time(8), dt.timezone.utc))).fetchone()['id']
        assert M.streak_at_risk(c, uid, 'UTC', streak_at) == 0, 'a completed current-week workout removes the risk'
        delayed_start = streak_at - dt.timedelta(minutes=5)
        c.execute('DELETE FROM activities WHERE id=%s', (current_activity,))
        delayed = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,moving_s) VALUES(%s,'run','Fictional in-progress workout',%s,'manual',600) RETURNING id",
                            (uid, delayed_start)).fetchone()['id']
        assert M.eligible(c, uid, 'streak', streak_key, 'UTC', streak_at+dt.timedelta(minutes=3)), 'unfinished activity is not treated as completed'
        assert not M.eligible(c, uid, 'streak', streak_key, 'UTC', streak_at+dt.timedelta(minutes=6)), 'completion during the delivery window suppresses the reminder'
        c.execute('DELETE FROM activities WHERE id=%s', (delayed,))
        c.execute('DELETE FROM activities WHERE id=%s', (prior_2,))
        assert M.streak_at_risk(c, uid, 'UTC', streak_at) == 0, 'a broken chain outside the last two completed weeks is not at risk'
        c.execute('DELETE FROM activities WHERE id=%s', (prior_1,))
        assert M.streak_at_risk(c, uid, 'UTC', streak_at) == 0, 'food never creates an activity streak'
    # A real current-local-week bell row is owner-only, visible without APNs/devices,
    # and disappears from both list and unread count as soon as it is ineligible.
    actual_now = M.clock()
    actual_monday = actual_now.date() - dt.timedelta(days=actual_now.weekday())
    actual_friday = dt.datetime.combine(actual_monday + dt.timedelta(days=4), dt.time(18), ZoneInfo('UTC'))
    actual_key = actual_monday + dt.timedelta(days=5)
    pref(uid, streak=True, streak_after=(actual_friday-dt.timedelta(days=1)).isoformat())
    with db.connect() as c:
        history = [c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,moving_s) VALUES(%s,'run','Fictional completed streak history',%s,'manual',600) RETURNING id",
                             (uid, dt.datetime.combine(actual_monday-dt.timedelta(days=7*i), dt.time(9), ZoneInfo('UTC')))).fetchone()['id']
                   for i in (1, 2)]
        c.execute('DELETE FROM native_push_devices WHERE user_id=%s', (uid,))
    with patch.object(apns, 'ready', return_value=False):
        assert M.tick(actual_friday) == 1, 'streak bell row is created when APNs and devices are absent'
    bell = a.get('/api/notifications').json()
    reminder = next(item for item in bell['items'] if item['kind'] == 'streak_reminder')
    assert reminder['text'] == 'One workout keeps your 2-week streak.' and reminder['link'] == '/track'
    assert bell['unread'] == a.get('/api/notifications/count').json()['unread'] == 1
    assert not any(item['kind'] == 'streak_reminder' for item in b.get('/api/notifications').json()['items'])
    with db.connect() as c:
        session = c.execute('SELECT token_hash FROM sessions WHERE user_id=%s ORDER BY created DESC LIMIT 1', (uid,)).fetchone()['token_hash']
        c.execute("INSERT INTO native_push_devices(token,environment,user_id,session_hash) VALUES(%s,'sandbox',%s,%s)",
                  (uuid.uuid4().hex * 2, uid, session))
    assert notify.push(reminder['id'], send=sender) == 1
    assert sent[-1]['title'] == 'Streak reminder' and sent[-1]['body'] == 'One workout keeps your 2-week streak.' and sent[-1]['url'] == '/track'
    with db.connect() as c:
        foreign_id = c.execute('''INSERT INTO notifications(user_id,kind,actor_id,created)
          VALUES(%s,%s,%s,%s) RETURNING id''', (uid, f'streak_reminder:{actual_key}', other, actual_now)).fetchone()['id']
        expired_id = c.execute('''INSERT INTO notifications(user_id,kind,actor_id,created)
          VALUES(%s,%s,%s,%s) RETURNING id''', (uid, f'streak_reminder:{actual_key-dt.timedelta(days=7)}', uid, actual_now)).fetchone()['id']
    bell = a.get('/api/notifications').json()
    assert reminder['id'] in [item['id'] for item in bell['items']]
    assert foreign_id not in [item['id'] for item in bell['items']] and expired_id not in [item['id'] for item in bell['items']]
    assert bell['unread'] == 1, 'foreign and expired reminder rows do not affect unread count'
    pref(uid, streak=False)
    bell = a.get('/api/notifications').json()
    assert not any(item['kind'] == 'streak_reminder' for item in bell['items']) and bell['unread'] == 0, 'opt-out suppresses list and unread count'
    pref(uid, streak=True)
    with db.connect() as c:
        workout = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source,moving_s) VALUES(%s,'run','Fictional current-week workout',%s,'manual',600) RETURNING id",
                             (uid, actual_now-dt.timedelta(minutes=10))).fetchone()['id']
    bell = a.get('/api/notifications').json()
    assert not any(item['kind'] == 'streak_reminder' for item in bell['items']) and bell['unread'] == 0, 'a completed current-week workout suppresses the reminder'
    sent_before = len(sent)
    assert notify.push(reminder['id'], send=sender) is None and len(sent) == sent_before, 'push preparation rechecks current-week eligibility'
    with db.connect() as c:
        c.execute('DELETE FROM activities WHERE id=%s OR id=ANY(%s)', (workout, history))
        c.execute('DELETE FROM notifications WHERE id=ANY(%s)', ([reminder['id'], foreign_id, expired_id],))
    # The Me-card close-to and streak totals ignore future and still-running rows.
    with db.connect() as c:
        historical_ids = [c.execute("""INSERT INTO activities(user_id,sport,name,start_time,source,moving_s,distance_m)
          VALUES(%s,'run','Fictional old completed run',%s,'manual',600,0) RETURNING id""",
          (uid, dt.datetime(2020, 1, 1, tzinfo=dt.timezone.utc)+dt.timedelta(days=i))).fetchone()['id'] for i in range(24)]
    stats_before = a.get('/api/stats').json()
    with db.connect() as c:
        future_id = c.execute("""INSERT INTO activities(user_id,sport,name,start_time,source,moving_s,distance_m)
          VALUES(%s,'run','Fictional future run',%s,'manual',600,500000) RETURNING id""",
          (uid, M.clock()+dt.timedelta(days=1))).fetchone()['id']
        unfinished_id = c.execute("""INSERT INTO activities(user_id,sport,name,start_time,source,moving_s,distance_m)
          VALUES(%s,'run','Fictional unfinished run',%s,'manual',3600,500000) RETURNING id""",
          (uid, M.clock()-dt.timedelta(minutes=30))).fetchone()['id']
    stats_after = a.get('/api/stats').json()
    assert stats_before['close_to'] == '1 workout to your 25th'
    assert stats_after['close_to'] == stats_before['close_to'] and stats_after['week_streak'] == stats_before['week_streak'], 'future and unfinished rows do not count in Me-card metrics'
    with db.connect() as c:
        c.execute('DELETE FROM activities WHERE id=ANY(%s)', (historical_ids+[future_id, unfinished_id],))
    assert not any(word in json.dumps(sent).lower() for word in ['fictional', 'calorie', 'protein', 'distance'])
    # Empty, future-only and unfinished lifting accounts do not receive a weekly invitation.
    sent = []
    pref(uid, weekly=True)
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
    # Monthly and January yearly summaries use the person's timezone and only a period-only notification row.
    assert notify.summary_due('UTC', dt.datetime(2026, 11, 1, 9, 14, 59, tzinfo=dt.timezone.utc)) == [('month', '2026-10')]
    assert not notify.summary_due('UTC', dt.datetime(2026, 11, 1, 9, 15, tzinfo=dt.timezone.utc))
    assert not notify.summary_due('America/New_York', dt.datetime(2026, 11, 1, 13, 59, tzinfo=dt.timezone.utc))
    assert notify.summary_due('America/New_York', dt.datetime(2026, 11, 1, 14, 0, tzinfo=dt.timezone.utc)) == [('month', '2026-10')]
    assert notify.summary_due('America/New_York', dt.datetime(2027, 1, 1, 14, 0, tzinfo=dt.timezone.utc)) == [('month', '2026-12'), ('year', '2026')]
    # An empty period is skipped; one private workout creates one durable item even on repeated ticks.
    assert a.post('/api/activities/manual', json={'sport':'run','start':'2020-10-05T12:00:00+00:00','duration_s':3600,'distance_m':5000}).status_code == 200
    assert b.post('/api/activities/manual', json={'sport':'run','start':'2020-10-06T12:00:00+00:00','duration_s':3600,'distance_m':160934}).status_code == 200
    with db.connect() as c:
        assert notify.record_summary(c, other, 'month', '2020-09', enqueue=False) is None
        month_id = notify.record_summary(c, uid, 'month', '2020-10', enqueue=False)
        assert month_id and notify.record_summary(c, uid, 'month', '2020-10', enqueue=False) is None
        year_id = notify.record_summary(c, uid, 'year', '2020', enqueue=False)
        assert year_id
    month_item = next(row for row in a.get('/api/notifications').json()['items'] if row['id'] == month_id)
    assert month_item['kind'] == 'monthly_summary' and month_item['period_type'] == 'month' and month_item['period'] == '2020-10'
    assert month_item['text'] == notify.summary_title('month', '2020-10') and month_item['link'] == '/notifications?summary=2020-10'
    with db.connect() as c:
        p = c.execute('SELECT tz,units FROM profile WHERE user_id=%s', (uid,)).fetchone()
        facts = notify.summary_facts(c, uid, 'month', '2020-10', p['tz'])
    assert month_item['detail'] == notify.summary_detail(facts, p['units']) and month_item['detail'].endswith(' · 1 workout')
    year_item = next(row for row in a.get('/api/notifications').json()['items'] if row['id'] == year_id)
    assert year_item['text'] == 'Your 2020 in review' and year_item['link'] == '/notifications?year=2020'
    # Push delivery is mocked; switching the existing preference off leaves the bell item but sends nothing.
    with db.connect() as c:
        c.execute("UPDATE profile SET notify=coalesce(notify,'{}'::jsonb)||'{\"monthly_summary\":false}'::jsonb WHERE user_id=%s", (uid,))
    sent = []
    assert notify.push(month_id, send=lambda device,payload: sent.append(payload) or True) == 0 and not sent
    with db.connect() as c:
        c.execute("UPDATE profile SET notify=coalesce(notify,'{}'::jsonb)||'{\"monthly_summary\":true}'::jsonb WHERE user_id=%s", (uid,))
    assert notify.push(month_id, send=lambda device,payload: sent.append(payload) or True) == 1
    assert sent[0]['title'] == 'Your October summary is ready' and sent[0]['body'] == month_item['detail']
    assert sent[0]['url'] == '/notifications?summary=2020-10'
    # The existing minute worker runs the monthly summary scheduler; both calls are replaced here.
    worker_calls = []
    class OneCycleStop:
        def __init__(self): self.waits = 0
        def wait(self, _): self.waits += 1; return self.waits > 1
    class InlineThread:
        def __init__(self, target, daemon=False): self.target = target
        def start(self): self.target()
    class InlineThreading:
        Event = OneCycleStop
        Thread = InlineThread
    with patch.object(M, 'threading', InlineThreading), \
         patch.object(M, 'tick', side_effect=lambda: worker_calls.append('personal')), \
         patch.object(notify, 'summary_tick', side_effect=lambda: worker_calls.append('monthly')):
        M.start_worker()
    assert worker_calls == ['personal', 'monthly']
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=%s', (uid,))
        assert not c.execute('SELECT 1 FROM personal_notification_attempts WHERE user_id=%s', (uid,)).fetchone()
    print('Personal notifications: HTTP defaults/strict opt-in/own settings, schedule/activation/DST/window, real plan completion/adjustments, food/workout/empty/open-lift weekly eligibility, concurrent once-only claims, private payload/expiry/no bell, final off/zone/claim/session checks, uncertain failure/no locks; monthly/yearly summary timezone, empty, dedupe, owner aggregate, switch, deep link and worker hook PASS')
finally:
    for client in clients:
        client.close()
    with db.connect() as c:
        c.execute('DELETE FROM users WHERE id=ANY(%s)', (uids,))
        c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))
