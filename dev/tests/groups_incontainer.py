"""Fictional Groups: private rows, hashed invites, lifecycle, blocks and aggregate-only activity progress."""
import datetime as dt
import hashlib
import re
import uuid
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth, db, groups, notify, parsers
from app.main import app


class Groups(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = auth.hash_pw('fictional group testing phrase')

    def setUp(self):
        self.ids = []
        self.clients = []
        self.now = dt.datetime.now(dt.timezone.utc)
        with db.connect() as c:
            for _ in range(4):
                login = 'zz_test_gr_' + uuid.uuid4().hex[:12]
                uid = c.execute('''INSERT INTO users(login,name,pw_hash,created)
                    VALUES(%s,'Fictional member',%s,now()-interval '1 year') RETURNING id''',
                                (login, self.password)).fetchone()['id']
                self.ids.append(uid)
                c.execute("INSERT INTO profile(user_id,tz,units,share_achievements,share_achievements_since) VALUES(%s,'America/New_York','metric',false,NULL)", (uid,))
                token = auth.new_session(c, uid, 'fictional group test')
                client = TestClient(app)
                client.headers.update({'Origin': 'http://testserver', 'Content-Type': 'application/json'})
                client.cookies.set(auth.COOKIE, token)
                self.clients.append(client)
        self.anon = TestClient(app)

    def tearDown(self):
        with db.connect() as c:
            c.execute("DELETE FROM auth_attempts WHERE key LIKE 'group-accept-%' OR key LIKE 'group-invite-ip:%'")
            for uid in self.ids:
                c.execute('DELETE FROM users WHERE id=%s', (uid,))
        for client in self.clients:
            client.close()
        self.anon.close()

    def make(self, who=0, goal_type='distance', goal_target=50, goal_unit='km', zone='America/New_York', event_date=None,
             goal_start_date=None):
        today = self.now.astimezone(ZoneInfo(zone)).date()
        body = {'title': 'Fictional Alpine Weekend', 'event_date': str(event_date or today + dt.timedelta(days=40)),
                'time_zone': zone, 'note': 'Fictional event note', 'goal_type': goal_type,
                'goal_target': goal_target, 'goal_unit': goal_unit,
                'goal_start_date': (goal_start_date or today - dt.timedelta(days=10)).isoformat()}
        response = self.clients[who].post('/api/groups', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        group = response.json()
        self.assertFalse(group['monday_recap_enabled'], 'group Monday alerts are off for new memberships')
        token = group['invite_url'].rsplit('/', 1)[1]
        return group, token

    def accept(self, token, who=1):
        return self.clients[who].post(f'/api/group-invites/{token}/accept', json={})

    def activity(self, who, at, *, sport='hike', distance=1000, ascent=20, seconds=1200, name='PRIVATE WORKOUT', visibility='friends'):
        with db.connect() as c:
            return c.execute('''INSERT INTO activities(user_id,sport,name,private_note,start_time,distance_m,ascent_m,
                moving_s,elapsed_s,source,visibility) VALUES(%s,%s,%s,'PRIVATE NOTE',%s,%s,%s,%s,%s,'manual',%s)
                RETURNING id''', (self.ids[who], sport, name, at, distance, ascent, seconds, seconds, visibility)).fetchone()['id']

    def test_goal_sports_start_date_training_line_and_weekly_target(self):
        zone = ZoneInfo('America/New_York')
        today = self.now.astimezone(zone).date()
        start = today - dt.timedelta(days=10)
        end = today + dt.timedelta(days=40)
        body = {'title':'Fictional spring race', 'event_date':end.isoformat(), 'time_zone':'America/New_York',
                'note':'', 'goal_type':'distance', 'goal_target':100, 'goal_unit':'km',
                'goal_sports':['run','ride'], 'goal_start_date':start.isoformat(), 'training_for':'Half marathon'}
        response = self.clients[0].post('/api/groups', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        group = response.json()
        self.assertEqual(group['goal_sports'], ['run','ride'])
        self.assertEqual(group['goal_start_date'], start.isoformat())
        self.assertEqual(group['training_for'], 'Half marathon')
        self.assertIsNone(group['weekly_target_scope'])
        self.assertIsNone(group['weekly_target'], 'a group below three members has no misleading personal pace')
        with db.connect() as c:
            stored = c.execute('SELECT goal_sports,goal_start_date,training_for FROM event_groups WHERE id=%s',
                               (group['id'],)).fetchone()
            self.assertEqual(list(stored['goal_sports']),['run','ride'])
            self.assertEqual(stored['goal_start_date'],start)
            self.assertEqual(stored['training_for'],'Half marathon')
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s',
                      (dt.datetime.combine(start-dt.timedelta(days=1),dt.time.min,zone).astimezone(dt.timezone.utc),group['id']))
        at_start = dt.datetime.combine(start,dt.time(hour=12),zone).astimezone(dt.timezone.utc)
        self.activity(0, at_start-dt.timedelta(days=1), sport='run', distance=9000)
        self.activity(0, at_start, sport='run', distance=1000)
        self.activity(0, at_start+dt.timedelta(hours=1), sport='ride', distance=2000)
        self.activity(0, at_start+dt.timedelta(hours=2), sport='hike', distance=7000)
        result = self.clients[0].get('/api/groups/'+group['id']).json()
        self.assertEqual(result['your_total'], 3)
        self.assertEqual(result['your_this_week_total'], 3 if at_start >= groups._local_week_window('America/New_York',self.now)[1] else 0)
        self.assertIsNone(result['weekly_target'])
        listed = self.clients[0].get('/api/groups').json()
        self.assertEqual(listed[0]['goal_sports'], ['run','ride'])
        self.assertEqual(self.clients[0].patch('/api/groups/'+group['id']+'/event-date',
                                               json={'event_date':(start-dt.timedelta(days=1)).isoformat()}).status_code,422)
        invalid = self.clients[0].post('/api/groups',json=body|{'goal_sports':['run','invalid']})
        self.assertEqual(invalid.status_code,422)
        duplicate = self.clients[0].post('/api/groups',json=body|{'goal_sports':['run','run']})
        self.assertEqual(duplicate.status_code,422)
        after_start = self.clients[0].post('/api/groups',json=body|{'goal_start_date':(end+dt.timedelta(days=1)).isoformat()})
        self.assertEqual(after_start.status_code,422)
        try:
            oldest = today.replace(year=today.year - 1)
        except ValueError:
            oldest = today.replace(year=today.year - 1, day=28)
        self.assertEqual(self.clients[0].post('/api/groups',json=body|{'goal_start_date':oldest.isoformat()}).status_code,200)
        self.assertEqual(self.clients[0].post('/api/groups',json=body|{'goal_start_date':(oldest-dt.timedelta(days=1)).isoformat()}).status_code,422)
        self.assertEqual(self.clients[0].post('/api/groups',json=body|{'event_date':None,'goal_start_date':(today+dt.timedelta(days=1)).isoformat()}).status_code,422)
        future_start=today+dt.timedelta(days=10)
        scheduled=self.clients[0].post('/api/groups',json=body|{'event_date':(today+dt.timedelta(days=20)).isoformat(),'goal_start_date':future_start.isoformat()})
        self.assertEqual(scheduled.status_code,200,scheduled.text)
        self.assertEqual(self.clients[0].patch('/api/groups/'+scheduled.json()['id']+'/event-date',json={'event_date':None}).status_code,422,
                         'clearing an event date cannot turn a future scheduled start into an invalid ongoing group')

    def test_group_all_sports_preserves_legacy_activity_and_excludes_nonsharing_member(self):
        group, token = self.make(goal_target=100, goal_unit='km')
        self.assertEqual(set(group['goal_sports']), set(parsers.SPORTS))
        self.assertEqual(self.accept(token, who=1).status_code, 200)
        self.assertEqual(self.accept(token, who=2).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids[:3],))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=ANY(%s)",
                      (group['id'], [self.ids[0], self.ids[2]]))
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s',
                      (self.now-dt.timedelta(days=2), group['id']))
        at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
        for sport in parsers.SPORTS:
            self.activity(0, at, sport=sport, distance=1000)
        self.activity(0, at, sport='legacy_sport', distance=1000)
        self.activity(1, at, sport='run', distance=9000)
        self.activity(2, at, sport='ride', distance=3000)
        with db.connect() as c:
            shapes = {row['sport'] for row in c.execute(
                'SELECT DISTINCT sport FROM activities WHERE user_id=ANY(%s)', (self.ids[:3],)).fetchall()}
            self.assertEqual(shapes, set(parsers.SPORTS) | {'legacy_sport'})
            nullable = c.execute("SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='activities' AND column_name='sport'").fetchone()['is_nullable']
            self.assertEqual(nullable, 'NO', 'current activity rows cannot contain NULL sports')
        result = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(result['total'], 13, 'default all-sports totals retain unlisted legacy sports but omit just-in members')
        self.assertEqual(result['this_week_total'], 13, 'weekly totals omit the non-sharing member too')
        self.assertEqual(result['weekly_target'], 14.5, 'weekly target uses the sharing-only group total')
        self.assertEqual(result['sharing_member_count'], 2)

    def test_backdated_goal_start_never_counts_activity_before_membership(self):
        zone = ZoneInfo('America/New_York')
        group, token = self.make(goal_start_date=self.now.astimezone(zone).date()-dt.timedelta(days=10))
        self.assertEqual(self.accept(token, who=1).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids[:2],))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=ANY(%s)",
                      (group['id'], self.ids[:2]))
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s AND user_id=%s',
                      (self.now-dt.timedelta(days=1), group['id'], self.ids[1]))
        self.activity(1, self.now-dt.timedelta(days=5), sport='run', distance=9000)
        self.activity(1, self.now-dt.timedelta(hours=1), sport='run', distance=1000)
        result = self.clients[1].get('/api/groups/' + group['id']).json()
        self.assertEqual(result['your_total'], 1, 'back-dated goal starts never remove the later joined_at floor')

    def test_goal_sports_migration_matches_parser_and_backfills_local_start_date(self):
        migration = next(stmt for stmt in db.MIGRATIONS if 'ADD COLUMN goal_sports' in stmt)
        array = re.search(r'DEFAULT ARRAY\[([^\]]*)\]::text\[\]', migration)
        self.assertIsNotNone(array)
        self.assertEqual(set(re.findall(r"'([^']+)'", array.group(1))), set(parsers.SPORTS))
        with db.connect() as c:
            c.execute('SET LOCAL search_path TO pg_temp, public')
            c.execute('CREATE TEMP TABLE event_groups(created timestamptz NOT NULL,time_zone text NOT NULL) ON COMMIT DROP')
            c.execute("INSERT INTO event_groups VALUES('2025-01-01T02:00:00Z','America/Los_Angeles'),('2025-01-01T02:00:00Z','UTC')")
            for statement in migration.split(';'):
                if statement.strip():
                    c.execute(statement)
            rows = c.execute('SELECT goal_start_date,goal_sports,training_for FROM event_groups ORDER BY time_zone').fetchall()
            self.assertEqual([row['goal_start_date'] for row in rows], [dt.date(2024,12,31),dt.date(2025,1,1)])
            self.assertTrue(all(set(row['goal_sports']) == set(parsers.SPORTS) and row['training_for']=='' for row in rows))

    def test_preview_acceptance_hash_rotation_expiry_and_generic_errors(self):
        group, original = self.make()
        self.assertEqual(group['sharing_level'], 'just_in', 'a new group organizer starts with the private choice')
        self.assertEqual(len(original), 32)
        self.assertTrue(all(ch in '0123456789abcdef' for ch in original))
        with db.connect() as c:
            stored = c.execute('SELECT token_hash FROM group_invites WHERE group_id=%s', (group['id'],)).fetchone()['token_hash']
            self.assertEqual(bytes(stored), hashlib.sha256(original.encode()).digest())
            self.assertNotIn(original.encode(), bytes(stored))
            c.execute("UPDATE event_groups SET training_for='Half marathon',goal_sports=ARRAY['run'] WHERE id=%s", (group['id'],))
        preview = self.anon.get('/api/group-invites/' + original)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json(), {'available': True})
        self.assertNotIn('training_for', preview.json())
        self.assertNotIn('goal_sports', preview.json())
        self.assertNotIn('Half marathon', preview.text)
        self.assertNotIn(group['title'], preview.text)
        self.assertEqual(self.clients[1].get('/api/groups/' + group['id']).status_code, 404)
        accepted = self.accept(original)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()['member_count'], 2)
        self.assertEqual(accepted.json()['sharing_level'], 'just_in', 'a new member starts with the private choice')
        self.assertNotIn('activity_id', accepted.text)
        replacement = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        stale = self.accept(original, who=2)
        unknown = self.accept('0' * 32, who=2)
        self.assertEqual(stale.status_code, 404)
        self.assertEqual(stale.json(), unknown.json())
        self.assertEqual(stale.json()['detail'], groups.INVITE_UNAVAILABLE)
        with db.connect() as c:
            c.execute("UPDATE group_invites SET expires_at=now()-interval '1 minute' WHERE token_hash=%s",
                      (hashlib.sha256(replacement.encode()).digest(),))
        expired = self.accept(replacement, who=3)
        self.assertEqual(expired.status_code, 404)
        self.assertEqual(expired.json(), unknown.json())

    def test_activity_strip_is_member_scoped_and_mute_is_per_account(self):
        first, _ = self.make()
        second, _ = self.make()
        other_account_group, _ = self.make(who=1)
        with db.connect() as c:
            c.execute('UPDATE event_groups SET event_date=event_date+1 WHERE id=%s', (second['id'],))
        initial = self.clients[0].get('/api/groups/activity-strip').json()
        self.assertFalse(initial['muted'])
        self.assertTrue(initial['has_upcoming'])
        self.assertEqual(initial['more_count'], 1)
        self.assertEqual(initial['next']['id'], first['id'])
        self.assertNotIn('members', initial['next'])
        self.assertNotIn('this_week_total', initial['next'])

        muted = self.clients[0].post('/api/groups/activity-strip', json={'muted': True})
        self.assertEqual(muted.json(), {'muted': True})
        hidden = self.clients[0].get('/api/groups/activity-strip').json()
        self.assertEqual(hidden, {'muted': True, 'has_upcoming': True})
        other = self.clients[1].get('/api/groups/activity-strip').json()
        self.assertFalse(other['muted'])
        self.assertEqual(other['next']['id'], other_account_group['id'])
        self.assertEqual(self.clients[0].post('/api/groups/activity-strip', json={'muted': False}).json(),
                         {'muted': False})
        self.assertFalse(self.clients[0].get('/api/groups/activity-strip').json()['muted'])

    def test_activity_strip_update_does_not_create_a_missing_profile(self):
        login = 'zz_test_gr_missing_' + uuid.uuid4().hex[:12]
        with db.connect() as c:
            uid = c.execute("INSERT INTO users(login,name,pw_hash) VALUES(%s,'Fictional member',%s) RETURNING id",
                            (login, self.password)).fetchone()['id']
            token = auth.new_session(c, uid, 'fictional missing-profile test')
            self.assertIsNone(c.execute('SELECT 1 FROM profile WHERE user_id=%s', (uid,)).fetchone())
        client = TestClient(app)
        client.headers.update({'Origin': 'http://testserver', 'Content-Type': 'application/json'})
        client.cookies.set(auth.COOKIE, token)
        try:
            response = client.post('/api/groups/activity-strip', json={'muted': True})
            self.assertEqual(response.status_code, 200, response.text)
            with db.connect() as c:
                self.assertIsNone(c.execute('SELECT 1 FROM profile WHERE user_id=%s', (uid,)).fetchone(),
                                  'a profile preference write never creates sharing defaults for an existing account')
        finally:
            with db.connect() as c:
                c.execute('DELETE FROM users WHERE id=%s', (uid,))
            client.close()

    def test_weekly_contribution_boundaries_follow_event_zone_monday_to_sunday(self):
        fixed_now = dt.datetime(2026, 11, 1, 7, 30, tzinfo=dt.timezone.utc)
        event_date = fixed_now.astimezone(ZoneInfo('America/Los_Angeles')).date() + dt.timedelta(days=40)
        with patch('app.groups._now', return_value=fixed_now):
            group, _ = self.make(zone='America/Los_Angeles', event_date=event_date,
                                 goal_start_date=dt.date(2026, 10, 1))
        local_day, start, end = groups._local_week_window('America/Los_Angeles', fixed_now)
        self.assertEqual(local_day, dt.date(2026, 11, 1))
        self.assertEqual(start, dt.datetime(2026, 10, 26, 7, 0, tzinfo=dt.timezone.utc))
        self.assertEqual(end, dt.datetime(2026, 11, 2, 8, 0, tzinfo=dt.timezone.utc))
        self.assertEqual(end - start, dt.timedelta(hours=169), 'the daylight-saving transition remains local-time aligned')
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at='2025-01-01T00:00:00Z' WHERE group_id=%s", (group['id'],))
        self.activity(0, start - dt.timedelta(seconds=1), distance=9000, name='PREVIOUS WEEK')
        self.activity(0, start, distance=1000, name='MONDAY START')
        self.activity(0, fixed_now - dt.timedelta(seconds=1), distance=2000, name='CURRENT WEEK')
        self.activity(0, fixed_now, distance=7000, name='AT CURRENT TIME')
        with patch('app.groups._now', return_value=fixed_now):
            result = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(result['week_start'], '2026-10-26')
        self.assertEqual(result['your_this_week_total'], 3)
        self.assertNotIn('this_week_total', result)

    def test_left_and_removed_members_cannot_reuse_invites(self):
        group, original = self.make()
        self.assertEqual(self.accept(original).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET monday_recap_enabled=true WHERE group_id=%s AND user_id=%s',
                      (group['id'],self.ids[1]))
        self.assertEqual(self.clients[1].post('/api/groups/' + group['id'] + '/leave', json={}).status_code, 200)
        with db.connect() as c:
            self.assertFalse(c.execute('SELECT monday_recap_enabled FROM group_members WHERE group_id=%s AND user_id=%s',
                                       (group['id'],self.ids[1])).fetchone()['monday_recap_enabled'],
                             'leaving resets the member alert opt-in')
        self.assertEqual(self.clients[1].post(f"/api/groups/{group['id']}/sharing",
                                              json={'level':'total_shared'}).status_code, 404,
                         'a left member cannot change sharing')
        rotated = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        stale = self.accept(original, who=1)
        unknown = self.accept('0' * 32, who=1)
        self.assertEqual(stale.status_code, 404)
        self.assertEqual(stale.json(), unknown.json())
        self.assertEqual(self.accept(rotated, who=1).status_code, 200)
        self.assertEqual(self.clients[1].get(f"/api/groups/{group['id']}").json()['sharing_level'], 'just_in',
                         'rejoining resets the old choice to the privacy-first default')
        self.assertFalse(self.clients[1].get(f"/api/groups/{group['id']}").json()['monday_recap_enabled'],
                         'rejoining requires a fresh Monday recap opt-in')
        login = self.clients[1].get('/api/me').json()['login']
        removed = self.clients[0].post('/api/groups/' + group['id'] + '/remove', json={'username': login})
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self.clients[1].post(f"/api/groups/{group['id']}/sharing",
                                              json={'level':'total_shared'}).status_code, 404,
                         'a removed member cannot change sharing')
        with db.connect() as c:
            c.execute('UPDATE group_members SET monday_recap_enabled=true WHERE group_id=%s AND user_id=%s',
                      (group['id'],self.ids[1]))
        after_removal = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(after_removal, who=1).status_code, 200)
        self.assertEqual(self.clients[1].get(f"/api/groups/{group['id']}").json()['sharing_level'], 'just_in',
                         'reactivating a removed member resets the old sharing choice')
        self.assertFalse(self.clients[1].get(f"/api/groups/{group['id']}").json()['monday_recap_enabled'],
                         'reactivating a removed member requires a fresh Monday recap opt-in')
        refused = self.accept(rotated, who=1)
        unknown = self.accept('0' * 32, who=1)
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(refused.json(), unknown.json())

    def test_group_sharing_migration_defaults_existing_and_new_memberships_to_private(self):
        migration = next(stmt for stmt in db.MIGRATIONS if 'ADD COLUMN sharing_level' in stmt)
        with db.connect() as c:
            c.execute('SET LOCAL search_path TO pg_temp, public')
            c.execute('CREATE TEMP TABLE group_members(group_id integer,user_id integer) ON COMMIT DROP')
            c.execute('INSERT INTO group_members VALUES(1,10)')
            c.execute(migration)
            self.assertEqual(c.execute('SELECT sharing_level FROM group_members WHERE group_id=1').fetchone()['sharing_level'],
                             'just_in', 'the migration gives existing membership the private choice')
            c.execute('INSERT INTO group_members(group_id,user_id) VALUES(2,11)')
            self.assertEqual(c.execute('SELECT sharing_level FROM group_members WHERE group_id=2').fetchone()['sharing_level'],
                             'just_in', 'new memberships default to the private choice')
            default = c.execute("SELECT column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='group_members' AND column_name='sharing_level'").fetchone()
            self.assertIn('just_in', default['column_default'])
            actual = c.execute("SELECT column_default,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='group_members' AND column_name='sharing_level'").fetchone()
            self.assertIsNotNone(actual, 'the real group_members table has the migrated column')
            self.assertIn('just_in', actual['column_default'])
            self.assertEqual(actual['is_nullable'], 'NO')

    def test_group_and_account_sharing_must_both_allow_totals_and_blocks_still_apply(self):
        group, token = self.make()
        for who in (1, 2, 3):
            self.assertEqual(self.accept(token, who=who).status_code, 200)
        joined_at = self.now - dt.timedelta(days=2)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s', (joined_at, group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids,))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=ANY(%s)",
                      (group['id'], [self.ids[0], self.ids[2], self.ids[3]]))
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[0], self.ids[3]))
        self.activity(0, self.now - dt.timedelta(hours=3), distance=10000, name='SHARED MEMBER A')
        hidden_b = self.activity(1, self.now - dt.timedelta(hours=2), distance=20000, name='GROUP PRIVATE MEMBER B')
        self.activity(2, self.now - dt.timedelta(hours=1), distance=30000, name='SHARED MEMBER C')
        self.activity(3, self.now - dt.timedelta(minutes=30), distance=900000, name='BLOCKED MEMBER D')

        def group_view(who=0):
            return self.clients[who].get('/api/groups/' + group['id']).json()

        initial = group_view()
        self.assertEqual(initial['sharing_level'], 'total_shared')
        self.assertEqual(initial['member_count'], 3, 'blocked membership is absent from the viewer’s response')
        self.assertEqual(initial['total'], 40)
        self.assertEqual(initial['sharing_member_count'], 2)
        self.assertNotIn(self.clients[3].get('/api/me').json()['login'],
                         [member['username'] for member in initial['members']])
        self.assertTrue(next(m for m in initial['members'] if m['username']==self.clients[1].get('/api/me').json()['login'])
                        ['sharing_total_only'], 'a group-default member has no visible contribution')
        blocked_view = group_view(who=3)
        self.assertEqual(blocked_view['member_count'], 3)
        self.assertEqual(blocked_view['total'], 930, 'a blocked member’s own view excludes the blocker’s contribution')
        self.assertNotIn(self.clients[0].get('/api/me').json()['login'],
                         [member['username'] for member in blocked_view['members']])

        with db.connect() as c:
            c.execute('UPDATE activities SET distance_m=1200000 WHERE id=%s', (hidden_b,))
        self.assertEqual(group_view()['total'], initial['total'], 'a member who chose just-in cannot change totals')

        changed = self.clients[1].post(f"/api/groups/{group['id']}/sharing", json={'level':'total_shared'})
        self.assertEqual(changed.status_code, 200, changed.text)
        self.assertEqual(changed.json(), {'level':'total_shared'})
        self.assertEqual(group_view()['total'], 1240, 'an explicit group choice enables sharing when account sharing is on')

        with db.connect() as c:
            c.execute('UPDATE profile SET share_achievements=false WHERE user_id=%s', (self.ids[2],))
        stricter = group_view()
        self.assertEqual(stricter['total'], 1210, 'the account-wide off switch wins over group-level sharing')
        self.assertEqual(stricter['sharing_member_count'], 2)
        self.assertEqual(self.clients[1].post(f"/api/groups/{group['id']}/sharing", json={'level':'everyone'}).status_code, 422)

    def test_aggregate_is_members_own_rows_and_updates_on_delete_and_leave(self):
        group, _ = self.make()
        self.assertEqual(self.accept(group['invite_url'].rsplit('/', 1)[1]).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        own_a = self.activity(0, self.now - dt.timedelta(hours=2), distance=1000, name='PRIVATE A')
        own_b = self.activity(1, self.now - dt.timedelta(hours=1), distance=2000, name='PRIVATE B')
        self.activity(2, self.now - dt.timedelta(minutes=30), distance=90000, name='OUTSIDER PRIVATE')
        self.activity(1, self.now - dt.timedelta(days=5), distance=90000, name='BEFORE JOIN')
        result = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertNotIn('total', result)
        self.assertEqual(result['your_total'], 1)
        self.assertEqual(result['goal_unit'], 'km')
        self.assertNotIn('value', result['members'][1])
        self.assertTrue(result['members'][1]['sharing_total_only'])
        for private in ('PRIVATE A', 'PRIVATE B', 'OUTSIDER PRIVATE', 'BEFORE JOIN', 'PRIVATE NOTE', 'distance_m', 'activity_id'):
            self.assertNotIn(private, str(result))
        with db.connect() as c:
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=%s', (self.ids[1],))
        shared = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertNotIn('value', shared['members'][1], 'a consented row amount stays hidden below the privacy floor')
        self.assertTrue(shared['members'][1]['sharing_total_only'],
                        'account-wide sharing alone does not override the private group choice')
        self.assertEqual(self.clients[1].post(f"/api/groups/{group['id']}/sharing",
                                              json={'level':'total_shared'}).status_code, 200)
        shared = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertNotIn('sharing_total_only', shared['members'][1],
                         'both account-wide and group-specific choices are required to share')
        self.assertNotIn('value', shared['members'][0])
        self.assertNotIn('total', shared)
        self.assertEqual(self.clients[2].get('/api/groups/' + group['id']).status_code, 404)
        self.assertEqual(self.clients[2].post('/api/groups/' + group['id'] + '/close', json={}).status_code, 404)
        self.assertEqual(self.clients[2].post(f"/api/groups/{group['id']}/sharing",
                                              json={'level':'total_shared'}).status_code, 404,
                         'a non-member cannot change group sharing')
        with db.connect() as c:
            c.execute('DELETE FROM activities WHERE id=%s', (own_a,))
        remaining = self.clients[1].get('/api/groups/' + group['id']).json()
        self.assertNotIn('total', remaining)
        self.assertEqual(remaining['your_total'], 2)
        self.assertEqual(self.clients[1].post('/api/groups/' + group['id'] + '/leave', json={}).status_code, 200)
        solo = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertNotIn('total', solo)
        self.assertEqual(solo['your_total'], 0)
        self.assertEqual(self.clients[1].get('/api/groups/' + group['id']).status_code, 404)

    def test_combined_total_requires_three_viewer_visible_members(self):
        zone = ZoneInfo('America/New_York')
        local_today = self.now.astimezone(zone).date()
        week_start = local_today - dt.timedelta(days=local_today.weekday())
        fixed_now = dt.datetime.combine(week_start + dt.timedelta(days=4), dt.time(12), zone).astimezone(dt.timezone.utc)
        joined_at = fixed_now - dt.timedelta(days=2)

        def group_view(who=0):
            with patch('app.groups._now', return_value=fixed_now):
                return self.clients[who].get('/api/groups/' + group['id']).json()

        group, token = self.make(goal_target=1000)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s', (joined_at, group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids,))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s", (group['id'],))
        self.activity(0, fixed_now - dt.timedelta(hours=3), distance=12000, name='PRIVATE A')

        one = group_view()
        self.assertEqual(one['member_count'], 1)
        self.assertNotIn('total', one)
        self.assertEqual(one['your_total'], 12)
        self.assertNotIn('this_week_total', one)
        self.assertEqual(one['your_this_week_total'], 12)

        self.assertEqual(self.accept(token, who=1).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s', (joined_at, group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=%s', (self.ids[1],))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=%s",
                      (group['id'], self.ids[1]))
        self.activity(1, fixed_now - dt.timedelta(hours=2), distance=3000, name='PRIVATE B')
        two = group_view()
        self.assertEqual(two['member_count'], 2)
        self.assertNotIn('total', two)
        self.assertEqual(two['your_total'], 12)
        self.assertTrue(all('value' not in member for member in two['members']),
                        'no member row amounts are returned below the three-visible-member floor')
        self.assertNotIn('this_week_total', two)
        self.assertEqual(two['your_this_week_total'], 12)

        token = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(token, who=2).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s', (joined_at, group['id']))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=%s",
                      (group['id'], self.ids[2]))
        self.activity(2, fixed_now - dt.timedelta(hours=1), distance=5000, name='PRIVATE C')
        three = group_view()
        self.assertEqual(three['member_count'], 3)
        self.assertEqual(three['week_start'], week_start.isoformat())
        self.assertEqual(three['total'], 20)
        self.assertNotIn('your_total', three)
        self.assertEqual(three['this_week_total'], 20)
        self.assertEqual(three['sharing_member_count'], 3)
        self.assertNotIn('this_week_contributors', three, 'weekly response never exposes who was active')
        self.assertNotIn('your_this_week_total', three)
        member_logins = [self.clients[i].get('/api/me').json()['login'] for i in range(3)]
        self.assertEqual({member['username']: member['value'] for member in three['members']},
                         dict(zip(member_logins, (12, 3, 5))),
                         'shared member amounts appear once three members are visible')

        token = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(token, who=3).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s', (joined_at, group['id']))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s", (group['id'],))
        self.activity(3, fixed_now - dt.timedelta(minutes=30), distance=7000, name='PRIVATE D')
        all_four = group_view(who=1)
        self.assertEqual(all_four['member_count'], 4)
        self.assertEqual(all_four['total'], 27)
        self.assertEqual(all_four['this_week_total'], 27)
        self.assertEqual(all_four['sharing_member_count'], 4)

        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[0], self.ids[3]))
        blocked_view = group_view()
        unblocked_view = group_view(who=1)
        self.assertEqual(blocked_view['member_count'], 3)
        self.assertEqual(blocked_view['total'], 20)
        self.assertEqual(blocked_view['this_week_total'], 20)
        self.assertEqual(blocked_view['sharing_member_count'], 3)
        self.assertEqual(unblocked_view['member_count'], 4)
        self.assertEqual(unblocked_view['total'], 27)
        self.assertEqual(unblocked_view['this_week_total'], 27)
        self.assertEqual(unblocked_view['sharing_member_count'], 4)

    def test_nonsharing_and_only_me_activity_never_change_visible_group_numbers(self):
        zone = ZoneInfo('America/New_York')
        local_today = self.now.astimezone(zone).date()
        week_start = local_today - dt.timedelta(days=local_today.weekday())
        fixed_now = dt.datetime.combine(week_start + dt.timedelta(days=4), dt.time(12), zone).astimezone(dt.timezone.utc)
        group, token = self.make(goal_unit='km')
        for who in (1, 2, 3):
            self.assertEqual(self.accept(token, who=who).status_code, 200)
        joined_at = fixed_now - dt.timedelta(days=3)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s', (joined_at, group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids,))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id<>%s",
                      (group['id'], self.ids[3]))
        self.activity(0, fixed_now - dt.timedelta(hours=3), distance=12000, name='SHARED A')
        self.activity(1, fixed_now - dt.timedelta(hours=2), distance=3000, name='SHARED B')
        private_id = self.activity(2, fixed_now - dt.timedelta(hours=1), distance=900000,
                                   name='ONLY ME', visibility='me')
        hidden_id = self.activity(3, fixed_now - dt.timedelta(minutes=30), distance=500000,
                                  name='NONSHARING ACTIVITY')
        logins = [client.get('/api/me').json()['login'] for client in self.clients]

        def visible_numbers():
            with patch('app.groups._now', return_value=fixed_now):
                result = self.clients[0].get('/api/groups/' + group['id']).json()
            self.assertNotIn('this_week_contributors', result)
            return {
                'total': result['total'],
                'this_week_total': result['this_week_total'],
                'sharing_member_count': result['sharing_member_count'],
                'member_count': result['member_count'],
                'member_values': {member['username']: member.get('value') for member in result['members']},
            }

        before = visible_numbers()
        self.assertEqual(before, {'total': 15, 'this_week_total': 15, 'sharing_member_count': 3,
                                  'member_count': 4, 'member_values': {logins[0]: 12, logins[1]: 3,
                                                                      logins[2]: 0, logins[3]: None}})
        with db.connect() as c:
            c.execute('UPDATE activities SET distance_m=1700000 WHERE id=%s', (private_id,))
            c.execute('UPDATE activities SET distance_m=1900000 WHERE id=%s', (hidden_id,))
        after = visible_numbers()
        self.assertEqual(after, before, 'private or nonsharing activity changes no returned total or count')

    def test_ongoing_group_date_can_be_added_and_cleared(self):
        zone = ZoneInfo('America/New_York')
        body = {'title': 'Fictional trail club', 'time_zone': 'America/New_York',
                'note': 'Fictional weekly trail goal', 'goal_type': 'distance',
                'goal_target': 100, 'goal_unit': 'km',
                'goal_start_date': self.now.astimezone(zone).date().isoformat()}
        created = self.clients[0].post('/api/groups', json=body)
        self.assertEqual(created.status_code, 200, created.text)
        group = created.json()
        self.assertIsNone(group['event_date'])
        self.assertEqual(group['event_state'], 'ongoing')
        self.assertIsNone(group['days_to_event'])
        self.assertIsNone(group['weeks_to_event'])
        self.assertNotIn('total', group)
        self.assertEqual(group['your_total'], 0)

        with db.connect() as c:
            created_at = c.execute('SELECT created FROM event_groups WHERE id=%s',
                                   (group['id'],)).fetchone()['created']
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s',
                      (created_at - dt.timedelta(days=10), group['id']))
        self.activity(0, created_at - dt.timedelta(days=1), distance=3000, name='BEFORE GOAL START DATE')
        self.activity(0, created_at + dt.timedelta(seconds=1), distance=12000, name='AFTER GROUP')
        later = created_at + dt.timedelta(seconds=2)
        with patch('app.groups._now', return_value=later):
            ongoing = self.clients[0].get('/api/groups/' + group['id']).json()
            strip = self.clients[0].get('/api/groups/activity-strip').json()
        self.assertEqual(ongoing['event_state'], 'ongoing')
        self.assertEqual(ongoing['your_total'], 12, 'ongoing totals begin at group creation')
        self.assertNotIn('total', ongoing)
        self.assertTrue(all('value' not in member for member in ongoing['members']))
        self.assertNotIn('recap', ongoing)
        self.assertTrue(strip['has_upcoming'])
        self.assertEqual(strip['next']['id'], group['id'])
        self.assertIsNone(strip['next']['event_date'])
        self.assertIsNone(strip['next']['days_to_event'])
        self.assertIsNone(strip['next']['weeks_to_event'])
        self.assertEqual(strip['next']['event_state'], 'ongoing')
        self.assertNotIn('total', strip['next'])

        token = group['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(token, who=1).status_code, 200)
        denied = self.clients[1].patch(f"/api/groups/{group['id']}/event-date",
                                       json={'event_date': (self.now.astimezone(zone).date() + dt.timedelta(days=40)).isoformat()})
        self.assertEqual(denied.status_code, 404, 'only the organizer can edit the date')

        update = self.clients[1].post(f"/api/groups/{group['id']}/updates",
                                      json={'text': 'Fictional trail notes are ready.'})
        self.assertEqual(update.status_code, 200, update.text)
        update_id = update.json()['id']
        reaction_kind = groups.reactions.KINDS[0]
        reaction = self.clients[0].post(f"/api/groups/{group['id']}/updates/{update_id}/reaction",
                                        json={'kind': reaction_kind})
        self.assertEqual(reaction.status_code, 200, reaction.text)

        event_date = self.now.astimezone(zone).date() + dt.timedelta(days=40)
        with patch('app.groups._now', return_value=later):
            added = self.clients[0].patch(f"/api/groups/{group['id']}/event-date",
                                          json={'event_date': event_date.isoformat()})
        self.assertEqual(added.status_code, 200, added.text)
        self.assertEqual(added.json()['event_date'], event_date.isoformat())
        self.assertEqual(added.json()['event_state'], 'upcoming')

        with patch('app.groups._now', return_value=later):
            cleared = self.clients[0].patch(f"/api/groups/{group['id']}/event-date",
                                            json={'event_date': None})
            ongoing = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()['event_date'])
        self.assertEqual(cleared.json()['event_state'], 'ongoing')
        self.assertIsNone(cleared.json()['days_to_event'])
        self.assertIsNone(cleared.json()['weeks_to_event'])
        self.assertEqual(ongoing['your_total'], 12)
        self.assertNotIn('total', ongoing)
        self.assertNotIn('recap', ongoing)
        self.assertEqual(len(ongoing['updates']), 1, 'clearing a date preserves group updates')
        self.assertEqual(ongoing['updates'][0]['id'], update_id)
        self.assertEqual(ongoing['updates'][0]['reactions'][reaction_kind], 1,
                         'clearing a date preserves update reactions')
        with db.connect() as c:
            notices = c.execute("""SELECT user_id,kind FROM notifications
                WHERE group_id=%s AND kind IN ('group_update','group_cheer')""",
                                (group['id'],)).fetchall()
        self.assertCountEqual([(row['user_id'], row['kind']) for row in notices],
                              [(self.ids[0], 'group_update'), (self.ids[1], 'group_cheer')],
                              'ongoing groups still send update and cheer notices')

    def test_event_date_bounds_are_local_and_enforced_on_create_and_patch(self):
        zone = 'America/Los_Angeles'
        fixed_now = dt.datetime(2026, 1, 1, 1, 0, tzinfo=dt.timezone.utc)
        today = fixed_now.astimezone(ZoneInfo(zone)).date()
        latest = today.replace(year=today.year + 5)
        self.assertEqual(today, dt.date(2025, 12, 31), 'bounds use the group time zone, not UTC')
        body = {'title': 'Fictional date-bound group', 'time_zone': zone,
                'note': 'Fictional bounded event', 'goal_type': 'distance',
                'goal_target': 10, 'goal_unit': 'km'}
        rejected_dates = (today - dt.timedelta(days=1), latest + dt.timedelta(days=1), dt.date.max)
        with patch('app.groups._now', return_value=fixed_now):
            for event_date in rejected_dates:
                created = self.clients[0].post('/api/groups', json=body | {'event_date': event_date.isoformat()})
                self.assertEqual(created.status_code, 422, f'create rejects {event_date}')
            for event_date in (today, latest):
                created = self.clients[0].post('/api/groups', json=body | {'event_date': event_date.isoformat()})
                self.assertEqual(created.status_code, 200, created.text)
                self.assertEqual(created.json()['event_date'], event_date.isoformat())

            ongoing = self.clients[0].post('/api/groups', json=body)
            self.assertEqual(ongoing.status_code, 200, ongoing.text)
            group_id = ongoing.json()['id']
            for event_date in rejected_dates:
                updated = self.clients[0].patch(f'/api/groups/{group_id}/event-date',
                                                 json={'event_date': event_date.isoformat()})
                self.assertEqual(updated.status_code, 422, f'PATCH rejects {event_date}')
            for event_date in (today, latest):
                updated = self.clients[0].patch(f'/api/groups/{group_id}/event-date',
                                                 json={'event_date': event_date.isoformat()})
                self.assertEqual(updated.status_code, 200, updated.text)
                self.assertEqual(updated.json()['event_date'], event_date.isoformat())

    def test_completed_group_event_date_cannot_be_changed(self):
        group, _ = self.make()
        zone = ZoneInfo(group['time_zone'])
        today = self.now.astimezone(zone).date()
        completed_date = today - dt.timedelta(days=1)
        with db.connect() as c:
            c.execute('UPDATE event_groups SET event_date=%s WHERE id=%s', (completed_date, group['id']))

        future_date = today + dt.timedelta(days=30)
        with patch('app.groups._now', return_value=self.now):
            complete = self.clients[0].get(f"/api/groups/{group['id']}")
            self.assertEqual(complete.status_code, 200, complete.text)
            self.assertEqual(complete.json()['event_state'], 'complete')
            changed = self.clients[0].patch(f"/api/groups/{group['id']}/event-date",
                                            json={'event_date': future_date.isoformat()})
        self.assertEqual(changed.status_code, 409, changed.text)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT event_date FROM event_groups WHERE id=%s',
                                       (group['id'],)).fetchone()['event_date'], completed_date,
                             'a completed group keeps its original event date')

    def test_elevation_long_outing_and_session_goal_units(self):
        elevation, _ = self.make(goal_type='elevation', goal_target=100, goal_unit='ft')
        long_outings, _ = self.make(goal_type='long_outings', goal_target=1, goal_unit='outings')
        sessions, _ = self.make(goal_type='sessions', goal_target=2, goal_unit='sessions')
        with db.connect() as c:
            for group in (elevation, long_outings, sessions):
                c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        self.activity(0, self.now - dt.timedelta(hours=2), distance=1000, ascent=30.48, seconds=1200)
        self.activity(0, self.now - dt.timedelta(hours=1), distance=1000, ascent=0, seconds=3599)
        self.activity(0, self.now - dt.timedelta(minutes=30), distance=1000, ascent=0, seconds=3600)
        self.assertEqual(self.clients[0].get('/api/groups/' + elevation['id']).json()['your_total'], 100)
        self.assertEqual(self.clients[0].get('/api/groups/' + long_outings['id']).json()['your_total'], 1)
        self.assertEqual(self.clients[0].get('/api/groups/' + sessions['id']).json()['your_total'], 3)

    def test_block_both_directions_membership_cap_and_ineligible_account(self):
        group, token = self.make()
        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[0], self.ids[1]))
        self.assertEqual(self.accept(token).status_code, 404, 'a group member cannot invite someone they blocked')
        with db.connect() as c:
            c.execute('DELETE FROM blocks WHERE user_id=%s AND blocked=%s', (self.ids[0], self.ids[1]))
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[1], self.ids[0]))
        self.assertEqual(self.accept(token).status_code, 404, 'an invitee who blocked a group member cannot join')
        with db.connect() as c:
            c.execute('DELETE FROM blocks WHERE user_id=%s AND blocked=%s', (self.ids[1], self.ids[0]))
            c.execute('UPDATE users SET needs_email_confirm=true WHERE id=%s', (self.ids[1],))
        self.assertEqual(self.accept(token).status_code, 403, 'unconfirmed people use the same gate as Challenges')
        with db.connect() as c:
            c.execute('UPDATE users SET needs_email_confirm=false WHERE id=%s', (self.ids[1],))
        self.assertEqual(self.accept(token).status_code, 200)
        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[2], self.ids[1]))
        self.assertEqual(self.accept(token, who=2).status_code, 404, 'a member who blocked an invitee also prevents joining')

    def test_remove_rotation_transfer_organizer_leave_close_and_report(self):
        group, old = self.make()
        self.assertEqual(self.accept(old).status_code, 200)
        login = self.clients[1].get('/api/me').json()['login']
        self.assertEqual(self.clients[0].post('/api/groups/' + group['id'] + '/remove', json={'username': login}).status_code, 200)
        stale = self.accept(old)
        self.assertEqual(stale.status_code, 404)
        new = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(new).status_code, 200)
        self.assertEqual(self.clients[0].post('/api/groups/' + group['id'] + '/leave', json={}).status_code, 409)
        report = self.clients[1].post('/api/groups/' + group['id'] + '/report', json={'reason': 'other', 'note': 'Fictional report'})
        self.assertEqual(report.status_code, 200, report.text)
        with db.connect() as c:
            row = c.execute('SELECT kind,group_id,what FROM reports WHERE id=%s', (report.json()['id'],)).fetchone()
            self.assertEqual((row['kind'], str(row['group_id']), row['what']), ('group', group['id'], 'Group: Fictional Alpine Weekend'))
        self.assertEqual(self.clients[0].post('/api/groups/' + group['id'] + '/transfer', json={'username': login}).status_code, 200)
        self.assertEqual(self.clients[0].post('/api/groups/' + group['id'] + '/leave', json={}).status_code, 200)
        self.assertEqual(self.clients[0].get('/api/groups/' + group['id']).status_code, 404)
        self.assertTrue(self.clients[1].get('/api/groups/' + group['id']).json()['is_organizer'])
        self.assertEqual(self.clients[1].post('/api/groups/' + group['id'] + '/stop-joining', json={}).status_code, 200)
        revoked = self.anon.get('/api/group-invites/' + new)
        unknown = self.anon.get('/api/group-invites/' + '0' * 32)
        self.assertEqual(revoked.status_code, 404)
        self.assertEqual(revoked.json(), unknown.json())
        self.assertEqual(self.clients[1].post('/api/groups/' + group['id'] + '/close', json={}).status_code, 200)
        self.assertTrue(self.clients[1].get('/api/groups/' + group['id']).json()['closed'])

    def test_fifty_member_limit_and_rls_guessed_ids_read_and_write(self):
        group, token = self.make()
        week_start = self.now.date() - dt.timedelta(days=self.now.weekday())
        with db.connect() as c:
            update_id = c.execute("INSERT INTO group_updates(group_id,user_id,text) VALUES(%s,%s,'Fictional update') RETURNING id",
                                   (group['id'], self.ids[0])).fetchone()['id']
            c.execute("INSERT INTO group_update_reactions(update_id,user_id,kind) VALUES(%s,%s,'clap')", (update_id, self.ids[0]))
            c.execute("INSERT INTO group_weekly_reactions(group_id,week_start,user_id,kind) VALUES(%s,%s,%s,'clap')",
                      (group['id'], week_start, self.ids[0]))
            for _ in range(48):
                login = 'zz_test_gr_' + uuid.uuid4().hex[:12]
                uid = c.execute("INSERT INTO users(login,name,pw_hash) VALUES(%s,'Fictional member',%s) RETURNING id",
                                (login, self.password)).fetchone()['id']
                self.ids.append(uid)
                c.execute('INSERT INTO profile(user_id) VALUES(%s)', (uid,))
                c.execute("INSERT INTO group_members(group_id,user_id) VALUES(%s,%s)", (group['id'], uid))
        self.assertEqual(self.accept(token).status_code, 200)
        full = self.clients[2].post('/api/group-invites/' + token + '/accept', json={})
        self.assertEqual(full.status_code, 409)
        role = 'zz_test_gr_reader_' + uuid.uuid4().hex[:8]
        password = 'fictional reader testing phrase'
        with db.connect() as c:
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role), sql.Literal(password)))
            c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
            c.execute('UPDATE users SET sql_role=%s WHERE id=%s', (role, self.ids[2]))
            new_tables = ('group_updates', 'group_update_reactions', 'group_weekly_reactions')
            for table in ('event_groups', 'group_members', 'group_invites', *new_tables):
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s', (table,)).fetchone()['relrowsecurity'])
            for table in new_tables:
                self.assertTrue(c.execute("SELECT has_table_privilege('fit_readers',%s,'SELECT') AS allowed", (table,)).fetchone()['allowed'])
                self.assertFalse(c.execute("SELECT has_table_privilege('fit_readers',%s,'INSERT') AS allowed", (table,)).fetchone()['allowed'])
        try:
            with psycopg.connect(db._conninfo(role, password), row_factory=dict_row) as reader:
                self.assertEqual(reader.execute('SELECT id FROM event_groups WHERE id=%s', (group['id'],)).fetchall(), [])
                self.assertEqual(reader.execute('SELECT user_id FROM group_members WHERE group_id=%s', (group['id'],)).fetchall(), [])
                self.assertEqual(reader.execute('SELECT id FROM group_updates WHERE id=%s', (update_id,)).fetchall(), [])
                self.assertEqual(reader.execute('SELECT update_id FROM group_update_reactions WHERE update_id=%s', (update_id,)).fetchall(), [])
                self.assertEqual(reader.execute('SELECT group_id FROM group_weekly_reactions WHERE group_id=%s', (group['id'],)).fetchall(), [])
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    with reader.transaction(): reader.execute('SELECT token_hash FROM group_invites')
                for statement in ('UPDATE event_groups SET title=\'Guessed\' WHERE id=%s',
                                  'DELETE FROM group_members WHERE group_id=%s',
                                  'UPDATE group_updates SET text=\'Guessed\' WHERE id=%s',
                                  'DELETE FROM group_update_reactions WHERE update_id=%s',
                                  'INSERT INTO group_weekly_reactions(group_id,week_start,user_id,kind) VALUES(%s,%s,%s,\'heart\')'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        with reader.transaction():
                            if 'group_weekly_reactions' in statement:
                                reader.execute(statement, (group['id'], week_start, self.ids[2]))
                            elif 'group_updates' in statement:
                                reader.execute(statement, (update_id,))
                            elif 'group_update_reactions' in statement:
                                reader.execute(statement, (update_id,))
                            else:
                                reader.execute(statement, (group['id'],))
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s', (self.ids[2],))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_accept_limits_user_and_ip(self):
        with db.connect() as c:
            c.execute("DELETE FROM auth_attempts WHERE key LIKE 'group-accept-%' OR key LIKE 'group-invite-ip:%'")
        with patch('app.groups.auth.client_ip', side_effect=[f'fictional-user-ip-{i}' for i in range(11)]):
            for _ in range(10):
                self.assertEqual(self.accept('bad-token', who=1).status_code, 404)
            self.assertEqual(self.accept('bad-token', who=1).status_code, 429)
        with db.connect() as c:
            c.execute("DELETE FROM auth_attempts WHERE key LIKE 'group-accept-%' OR key LIKE 'group-invite-ip:%'")
        request = object()
        with patch('app.groups.auth.client_ip', return_value='fictional-shared-ip'):
            for uid in range(10000, 10040):
                groups._limit_accept(request, uid)
            with self.assertRaises(HTTPException) as raised:
                groups._limit_accept(request, 10040)
            self.assertEqual(raised.exception.status_code, 429)
            ip_hash = hashlib.sha256(b'fictional-shared-ip').hexdigest()
        with db.connect() as c:
            keys = [row['key'] for row in c.execute("SELECT key FROM auth_attempts WHERE key LIKE 'group-invite-ip:%'").fetchall()]
        self.assertIn('group-invite-ip:' + ip_hash, keys)
        self.assertNotIn('fictional-shared-ip', '\n'.join(keys))
        with db.connect() as c:
            c.execute("DELETE FROM auth_attempts WHERE key LIKE 'group-accept-%' OR key LIKE 'group-invite-ip:%'")
        with patch('app.groups.auth.client_ip', return_value='fictional-preview-ip'):
            for _ in range(40):
                self.assertEqual(self.anon.get('/api/group-invites/' + '0' * 32).status_code, 404)
            limited = self.anon.get('/api/group-invites/' + '0' * 32)
            self.assertEqual(limited.status_code, 429)
            self.assertEqual(limited.json(), {'detail': 'Too many invite attempts. Wait 15 minutes.'})
        with db.connect() as c:
            keys = [row['key'] for row in c.execute("SELECT key FROM auth_attempts WHERE key LIKE 'group-invite-ip:%'").fetchall()]
        self.assertIn('group-invite-ip:' + hashlib.sha256(b'fictional-preview-ip').hexdigest(), keys)
        self.assertNotIn('fictional-preview-ip', '\n'.join(keys))

    def test_updates_cheers_reports_and_muted_group_notices(self):
        group, token = self.make()
        self.assertEqual(self.accept(token, who=1).status_code, 200)
        self.assertEqual(self.accept(token, who=2).status_code, 200)
        root = f"/api/groups/{group['id']}"
        updates = root + '/updates'

        created = self.clients[0].post(updates, json={'text': '  Fictional trail looks good.  '})
        self.assertEqual(created.status_code, 200, created.text)
        first = created.json()
        self.assertEqual(first['text'], 'Fictional trail looks good.')
        self.assertEqual(self.clients[0].post(updates, json={'text': ' '}).status_code, 422)
        self.assertEqual(self.clients[0].post(updates, json={'text': 'x' * 201}).status_code, 422)
        self.assertEqual(self.clients[3].post(updates, json={'text': 'Not a member'}).status_code, 404)

        second = self.clients[1].post(updates, json={'text': 'Fictional weather looks clear.'})
        self.assertEqual(second.status_code, 200, second.text)
        listed = self.clients[2].get(root).json()['updates']
        self.assertEqual([row['text'] for row in listed[:2]],
                         ['Fictional weather looks clear.', 'Fictional trail looks good.'])

        reacted = self.clients[1].post(updates + f"/{first['id']}/reaction", json={'kind': 'heart'})
        self.assertEqual(reacted.status_code, 200, reacted.text)
        self.assertEqual(reacted.json()['my_reaction'], 'heart')
        self.assertEqual(reacted.json()['reactions']['heart'], 1)
        people = self.clients[0].get(updates + f"/{first['id']}/reactions").json()['cheers']
        self.assertEqual([row['login'] for row in people], [self.clients[1].get('/api/me').json()['login']])

        report = self.clients[2].post(updates + f"/{first['id']}/report", json={'reason': 'other', 'note': 'Fictional report'})
        self.assertEqual(report.status_code, 200, report.text)
        self.assertEqual(self.clients[0].post(updates + f"/{first['id']}/report", json={'reason': 'other'}).status_code, 400)
        self.assertEqual(self.clients[2].delete(updates + f"/{first['id']}").status_code, 404,
                         'a non-author non-organizer cannot delete an update')

        weekly = self.clients[1].post(root + '/weekly-reaction', json={'kind': 'clap'})
        self.assertEqual(weekly.status_code, 200, weekly.text)
        self.assertEqual(weekly.json()['my_reaction'], 'clap')
        with db.connect() as c:
            for uid in self.ids[:3]:
                count = c.execute("SELECT count(*) AS n FROM notifications WHERE user_id=%s AND group_id=%s AND kind IN ('group_update','group_cheer')",
                                  (uid, group['id'])).fetchone()['n']
                self.assertLessEqual(count, 1, 'only one current group notice is stored per member')
            owner_notice = c.execute("SELECT kind,group_week_start FROM notifications WHERE user_id=%s AND group_id=%s AND kind IN ('group_update','group_cheer')",
                                     (self.ids[0], group['id'])).fetchone()
            self.assertEqual(owner_notice['kind'], 'group_cheer')
            self.assertIsNotNone(owner_notice['group_week_start'])

        muted = self.clients[2].post(root + '/notifications', json={'muted': True})
        self.assertEqual(muted.json(), {'muted': True})
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT notifications_muted FROM group_members WHERE group_id=%s AND user_id=%s",
                                        (group['id'], self.ids[2])).fetchone()['notifications_muted'], True)
            self.assertEqual(c.execute("SELECT count(*) AS n FROM notifications WHERE user_id=%s AND group_id=%s",
                                       (self.ids[2], group['id'])).fetchone()['n'], 0)

        new_update = self.clients[0].post(updates, json={'text': 'Another fictional update.'})
        self.assertEqual(new_update.status_code, 200, new_update.text)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM notifications WHERE user_id=%s AND group_id=%s",
                                       (self.ids[2], group['id'])).fetchone()['n'], 0,
                         'muted members do not receive new in-app group notices')
        self.assertEqual(self.clients[0].delete(updates + f"/{second.json()['id']}").status_code, 200,
                         'the organizer can remove a member update')

    def test_recap_consent_and_amount_floor_follow_visible_members(self):
        zone = ZoneInfo('America/New_York')
        event_date = self.now.astimezone(zone).date() - dt.timedelta(days=2)
        event_start = dt.datetime.combine(event_date, dt.time(12), zone).astimezone(dt.timezone.utc)
        group, token = self.make()
        with db.connect() as c:
            c.execute('UPDATE event_groups SET event_date=%s WHERE id=%s', (event_date, group['id']))
        self.assertEqual(self.accept(token, who=1).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s',
                      (event_start - dt.timedelta(days=1), group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids[:3],))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=ANY(%s)",
                      (group['id'], self.ids[:3]))
        self.activity(0, event_start + dt.timedelta(hours=1), distance=1000)
        self.activity(1, event_start + dt.timedelta(hours=2), distance=2000)
        self.assertEqual(self.clients[0].post(f"/api/groups/{group['id']}/recap-consent", json={'consent': True}).json(),
                         {'consent': True})
        self.assertEqual(self.clients[1].post(f"/api/groups/{group['id']}/recap-consent", json={'consent': True}).json(),
                         {'consent': True})

        two = self.clients[0].get(f"/api/groups/{group['id']}").json()
        self.assertEqual(two['event_state'], 'complete')
        self.assertEqual(two['member_count'], 2)
        self.assertNotIn('total', two)
        self.assertEqual(two['recap']['your_total'], 1)
        self.assertNotIn('total', two['recap'])
        self.assertTrue(all('value' not in member for member in two['members']),
                        'shared member rows still withhold amounts below three visible members')
        self.assertCountEqual(two['recap']['participants'], [self.clients[i].get('/api/me').json()['login'] for i in (0, 1)])

        self.assertEqual(self.accept(token, who=2).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s AND user_id=%s',
                      (event_start - dt.timedelta(days=1), group['id'], self.ids[2]))
        self.assertEqual(self.clients[2].post(f"/api/groups/{group['id']}/recap-consent",
                                              json={'consent':True}).json(), {'consent':True})
        self.activity(2, event_start + dt.timedelta(hours=3), distance=3000)
        three = self.clients[0].get(f"/api/groups/{group['id']}").json()
        self.assertEqual(three['member_count'], 3)
        self.assertEqual(three['total'], 3)
        self.assertEqual(three['recap']['total'], 3)
        member_logins = [self.clients[i].get('/api/me').json()['login'] for i in range(3)]
        self.assertEqual(three['members'][0]['username'], member_logins[0], 'the viewer is first in Members')
        self.assertEqual([member['username'] for member in three['members'][1:]],
                         sorted(member_logins[1:], key=str.casefold), 'other Members are sorted by username')
        self.assertEqual({member['username']: member['value'] for member in three['members'] if 'value' in member},
                         dict(zip(member_logins[:2], (1, 2))))
        self.assertTrue(next(member for member in three['members'] if member['username']==member_logins[2])
                        ['sharing_total_only'], 'a recap-consenting just-in member remains out of group totals')
        self.assertCountEqual(three['recap']['participants'], [self.clients[i].get('/api/me').json()['login'] for i in (0, 1)],
                         'the recap names only members who opted in')

        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[0], self.ids[1]))
        blocked_view = self.clients[0].get(f"/api/groups/{group['id']}").json()
        self.assertEqual(blocked_view['member_count'], 2)
        self.assertNotIn('total', blocked_view)
        self.assertNotIn('total', blocked_view['recap'])
        self.assertEqual(blocked_view['recap']['your_total'], 1)
        self.assertTrue(all('value' not in member for member in blocked_view['members']))
        self.assertEqual(blocked_view['recap']['participants'], [self.clients[0].get('/api/me').json()['login']])

    def test_monday_recap_is_opt_in_private_and_once_per_group_week(self):
        before_open = dt.datetime(2026, 11, 16, 13, 59, tzinfo=dt.timezone.utc)  # 8:59 a.m. New York.
        after_open = dt.datetime(2026, 11, 16, 14, 15, tzinfo=dt.timezone.utc)  # 9:15 a.m. New York.
        body = {'title':'Fictional Monday group','event_date':None,'time_zone':'America/New_York','note':'',
                'goal_type':'distance','goal_target':80,'goal_unit':'km','goal_sports':['run'],
                'goal_start_date':'2026-11-09','training_for':''}
        response = self.clients[0].post('/api/groups', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        group = response.json()
        token = group['invite_url'].rsplit('/', 1)[1]
        with db.connect() as c:
            c.execute('UPDATE group_members SET monday_recap_enabled=true WHERE group_id=%s AND user_id=%s',
                      (group['id'],self.ids[0]))
        self.assertEqual(self.clients[3].post(f"/api/groups/{group['id']}/monday-recap",
                                              json={'enabled':True}).status_code,404,
                         'a non-member cannot set Monday recap preference')
        self.assertEqual(groups.monday_recap_tick(after_open),0,
                         'a group with fewer than three active members does not create a recap alert')
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_monday_recaps WHERE group_id=%s',
                                        (group['id'],)).fetchone()['n'],0)
        self.assertIsNone(self.clients[0].get(f"/api/groups/{group['id']}").json()['monday_recap'],
                          'small groups do not show a recap that has no shared aggregate')

        for who in (1, 2, 3):
            self.assertEqual(self.accept(token, who=who).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)", ([self.ids[0],self.ids[1],self.ids[3]],))
            c.execute("UPDATE group_members SET sharing_level='total_shared',joined_at=%s WHERE group_id=%s",
                      (dt.datetime(2026,10,1,tzinfo=dt.timezone.utc),group['id']))
            c.execute('UPDATE group_members SET monday_recap_enabled=true WHERE group_id=%s AND user_id=ANY(%s)',
                      (group['id'],self.ids[:2]))
            c.execute('UPDATE group_members SET notifications_muted=true WHERE group_id=%s AND user_id=%s',
                      (group['id'],self.ids[1]))
        start = dt.datetime(2026,11,9,14,tzinfo=dt.timezone.utc)
        for who, distance in ((0,1000),(1,2000),(2,3000),(3,4000)):
            self.activity(who,start+dt.timedelta(hours=who),sport='run',distance=distance)
        self.activity(3,dt.datetime(2026,11,8,12,tzinfo=dt.timezone.utc),sport='run',distance=7000)
        self.activity(3,start+dt.timedelta(hours=8),sport='hike',distance=6000)
        self.activity(3,start+dt.timedelta(hours=9),sport='run',distance=5000,visibility='me')
        self.assertEqual(groups.monday_recap_tick(before_open),0,'the recap does not open before 9 a.m. local Monday')
        self.assertEqual(groups.monday_recap_tick(after_open),1,
                         'a delayed worker still sends after 9:15 a.m. local Monday')
        self.assertEqual(groups.monday_recap_tick(after_open),0,'the group/week claim prevents a duplicate alert')
        with db.connect() as c:
            notices = c.execute("SELECT id,user_id,kind,group_week_start FROM notifications WHERE group_id=%s AND kind='group_monday_recap'",(group['id'],)).fetchall()
        self.assertEqual([(r['user_id'],r['kind'],r['group_week_start']) for r in notices],
                         [(self.ids[0],'group_monday_recap',dt.date(2026,11,9))],
                         'the default-off and muted members receive no recap alert')
        self.assertIsNone(notify._push_preference('group_monday_recap'),
                          'Monday recaps have no native push category')
        sent=[]
        self.assertEqual(notify.push(notices[0]['id'],send=lambda device,payload:sent.append(payload) or True),0)
        self.assertEqual(sent,[],'Monday recap is bell-only and is skipped by the native push sender')
        with patch.object(groups, '_now', return_value=after_open):
            recap = self.clients[0].get('/api/groups/'+group['id']).json()['monday_recap']
            self.assertEqual(recap, {'week_start':'2026-11-09','total':7.0},
                             'the recap applies account sharing, group sports, goal start date and private-activity filters')
            with db.connect() as c:
                c.execute('UPDATE activities SET distance_m=90000 WHERE user_id=%s', (self.ids[2],))
                c.execute('DELETE FROM group_monday_recaps WHERE group_id=%s AND week_start=%s',
                          (group['id'],dt.date(2026,11,9)))
            self.assertEqual(self.clients[0].get('/api/groups/'+group['id']).json()['monday_recap'], recap,
                             'the visible Last week line is independent of the notification claim row')
            self.assertEqual(groups.monday_recap_tick(after_open),0,
                             'an existing alert is not counted again if its claim row needs repair')
            self.assertEqual(self.clients[1].get('/api/groups/'+group['id']).json()['monday_recap'],recap,
                             'muting alerts does not change the group data already visible under sharing rules')
        tuesday = dt.datetime(2026,11,17,14,5,tzinfo=dt.timezone.utc)
        with patch.object(groups,'_now',return_value=tuesday):
            self.assertEqual(self.clients[0].get('/api/groups/'+group['id']).json()['monday_recap'],recap,
                             'Last week stays visible on Tuesday without requiring an opted-in notification')
            with db.connect() as c:
                c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[0],self.ids[3]))
            blocked_view=self.clients[0].get('/api/groups/'+group['id']).json()
            self.assertEqual(blocked_view['member_count'],3)
            self.assertEqual(blocked_view['monday_recap'],{'week_start':'2026-11-09','total':3.0},
                             'a blocked member and their activity are excluded from the viewer-safe recap')
        alert = self.clients[0].get('/api/notifications').json()['items']
        self.assertEqual([(item['kind'],item['text'],item['link']) for item in alert],
                         [('group_monday_recap','Monday recap from Fictional Monday group',f"/groups/{group['id']}")])
        self.assertEqual(self.clients[1].get('/api/notifications').json()['items'],[],
                         'muted members do not receive a recap alert')
        self.assertEqual(self.clients[2].get('/api/notifications').json()['items'], [],
                         'non-opted-in members see no Monday alert')
        self.assertEqual(self.clients[0].post(f"/api/groups/{group['id']}/monday-recap",json={'enabled':False}).json(),
                         {'enabled':False})
        self.assertEqual(self.clients[0].get('/api/notifications').json()['items'], [],
                         'turning the preference off removes its old alert')

    def test_monday_recap_uses_each_groups_local_monday(self):
        body={'title':'Fictional Tokyo group','event_date':None,'time_zone':'Asia/Tokyo','note':'',
              'goal_type':'distance','goal_target':80,'goal_unit':'km','goal_sports':['run'],
              'goal_start_date':'2026-11-09','training_for':''}
        group=self.clients[0].post('/api/groups',json=body).json()
        token=group['invite_url'].rsplit('/',1)[1]
        for who in (1,2):self.assertEqual(self.accept(token,who=who).status_code,200)
        with db.connect() as c:
            c.execute("UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)",(self.ids[:3],))
            c.execute("UPDATE group_members SET sharing_level='total_shared',joined_at=%s WHERE group_id=%s",
                      (dt.datetime(2026,10,1,tzinfo=dt.timezone.utc),group['id']))
            c.execute('UPDATE group_members SET monday_recap_enabled=true WHERE group_id=%s AND user_id=%s',
                      (group['id'],self.ids[0]))
        self.activity(0,dt.datetime(2026,11,9,1,tzinfo=dt.timezone.utc),sport='run',distance=1000)
        tokyo_monday=dt.datetime(2026,11,16,0,15,tzinfo=dt.timezone.utc) # 9:15 a.m. Monday in Tokyo.
        self.assertEqual(groups.monday_recap_tick(tokyo_monday),1)
        with patch.object(groups,'_now',return_value=tokyo_monday):
            self.assertEqual(self.clients[0].get('/api/groups/'+group['id']).json()['monday_recap'],
                             {'week_start':'2026-11-09','total':1.0})


unittest.main()
