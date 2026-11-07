"""Fictional Groups: private rows, hashed invites, lifecycle, blocks and aggregate-only activity progress."""
import datetime as dt
import hashlib
import uuid
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import auth, db, groups
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
                c.execute("INSERT INTO profile(user_id,tz,units) VALUES(%s,'America/New_York','metric')", (uid,))
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

    def make(self, who=0, goal_type='distance', goal_target=50, goal_unit='km', zone='America/New_York', event_date=None):
        today = self.now.astimezone(ZoneInfo(zone)).date()
        body = {'title': 'Fictional Alpine Weekend', 'event_date': str(event_date or today + dt.timedelta(days=40)),
                'time_zone': zone, 'note': 'Fictional event note', 'goal_type': goal_type,
                'goal_target': goal_target, 'goal_unit': goal_unit}
        response = self.clients[who].post('/api/groups', json=body)
        self.assertEqual(response.status_code, 200, response.text)
        group = response.json()
        token = group['invite_url'].rsplit('/', 1)[1]
        return group, token

    def accept(self, token, who=1):
        return self.clients[who].post(f'/api/group-invites/{token}/accept', json={})

    def activity(self, who, at, *, distance=1000, ascent=20, seconds=1200, name='PRIVATE WORKOUT'):
        with db.connect() as c:
            return c.execute('''INSERT INTO activities(user_id,sport,name,private_note,start_time,distance_m,ascent_m,
                moving_s,elapsed_s,source,visibility) VALUES(%s,'hike',%s,'PRIVATE NOTE',%s,%s,%s,%s,%s,'manual','me')
                RETURNING id''', (self.ids[who], name, at, distance, ascent, seconds, seconds)).fetchone()['id']

    def test_preview_acceptance_hash_rotation_expiry_and_generic_errors(self):
        group, original = self.make()
        self.assertEqual(len(original), 32)
        self.assertTrue(all(ch in '0123456789abcdef' for ch in original))
        with db.connect() as c:
            stored = c.execute('SELECT token_hash FROM group_invites WHERE group_id=%s', (group['id'],)).fetchone()['token_hash']
            self.assertEqual(bytes(stored), hashlib.sha256(original.encode()).digest())
            self.assertNotIn(original.encode(), bytes(stored))
        preview = self.anon.get('/api/group-invites/' + original)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json(), {'available': True})
        self.assertNotIn(group['title'], preview.text)
        self.assertEqual(self.clients[1].get('/api/groups/' + group['id']).status_code, 404)
        accepted = self.accept(original)
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()['member_count'], 2)
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

    def test_weekly_contribution_boundaries_follow_event_zone_monday_to_sunday(self):
        fixed_now = dt.datetime(2026, 11, 1, 7, 30, tzinfo=dt.timezone.utc)
        event_date = fixed_now.astimezone(ZoneInfo('America/Los_Angeles')).date() + dt.timedelta(days=40)
        with patch('app.groups._now', return_value=fixed_now):
            group, _ = self.make(zone='America/Los_Angeles', event_date=event_date)
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
        self.assertEqual(self.clients[1].post('/api/groups/' + group['id'] + '/leave', json={}).status_code, 200)
        rotated = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        stale = self.accept(original, who=1)
        unknown = self.accept('0' * 32, who=1)
        self.assertEqual(stale.status_code, 404)
        self.assertEqual(stale.json(), unknown.json())
        self.assertEqual(self.accept(rotated, who=1).status_code, 200)
        login = self.clients[1].get('/api/me').json()['login']
        removed = self.clients[0].post('/api/groups/' + group['id'] + '/remove', json={'username': login})
        self.assertEqual(removed.status_code, 200)
        refused = self.accept(rotated, who=1)
        unknown = self.accept('0' * 32, who=1)
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(refused.json(), unknown.json())

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
        self.assertNotIn('sharing_total_only', shared['members'][1], 'the floor is not presented as a member privacy choice')
        self.assertNotIn('value', shared['members'][0])
        self.assertNotIn('total', shared)
        self.assertEqual(self.clients[2].get('/api/groups/' + group['id']).status_code, 404)
        self.assertEqual(self.clients[2].post('/api/groups/' + group['id'] + '/close', json={}).status_code, 404)
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
        group, token = self.make(goal_target=1000)
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        self.activity(0, self.now - dt.timedelta(hours=3), distance=12000, name='PRIVATE A')

        one = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(one['member_count'], 1)
        self.assertNotIn('total', one)
        self.assertEqual(one['your_total'], 12)
        self.assertNotIn('this_week_total', one)
        self.assertEqual(one['your_this_week_total'], 12)

        self.assertEqual(self.accept(token, who=1).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=%s', (self.ids[1],))
        self.activity(1, self.now - dt.timedelta(hours=2), distance=3000, name='PRIVATE B')
        two = self.clients[0].get('/api/groups/' + group['id']).json()
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
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        self.activity(2, self.now - dt.timedelta(hours=1), distance=5000, name='PRIVATE C')
        three = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(three['member_count'], 3)
        self.assertEqual(three['total'], 20)
        self.assertNotIn('your_total', three)
        self.assertEqual(three['this_week_total'], 20)
        self.assertEqual(three['this_week_contributors'], 3)
        self.assertNotIn('your_this_week_total', three)
        self.assertEqual(three['members'][1]['value'], 3, 'shared member amounts appear once three members are visible')

        token = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(token, who=3).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        self.activity(3, self.now - dt.timedelta(minutes=30), distance=7000, name='PRIVATE D')
        all_four = self.clients[1].get('/api/groups/' + group['id']).json()
        self.assertEqual(all_four['member_count'], 4)
        self.assertEqual(all_four['total'], 27)
        self.assertEqual(all_four['this_week_total'], 27)
        self.assertEqual(all_four['this_week_contributors'], 4)

        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[0], self.ids[3]))
        blocked_view = self.clients[0].get('/api/groups/' + group['id']).json()
        unblocked_view = self.clients[1].get('/api/groups/' + group['id']).json()
        self.assertEqual(blocked_view['member_count'], 3)
        self.assertEqual(blocked_view['total'], 20)
        self.assertEqual(blocked_view['this_week_total'], 20)
        self.assertEqual(blocked_view['this_week_contributors'], 3)
        self.assertEqual(unblocked_view['member_count'], 4)
        self.assertEqual(unblocked_view['total'], 27)
        self.assertEqual(unblocked_view['this_week_total'], 27)
        self.assertEqual(unblocked_view['this_week_contributors'], 4)

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
        self.assertEqual(two['recap']['participants'], [self.clients[i].get('/api/me').json()['login'] for i in (0, 1)])

        self.assertEqual(self.accept(token, who=2).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s AND user_id=%s',
                      (event_start - dt.timedelta(days=1), group['id'], self.ids[2]))
        self.activity(2, event_start + dt.timedelta(hours=3), distance=3000)
        three = self.clients[0].get(f"/api/groups/{group['id']}").json()
        self.assertEqual(three['member_count'], 3)
        self.assertEqual(three['total'], 6)
        self.assertEqual(three['recap']['total'], 6)
        self.assertEqual([member['value'] for member in three['members']], [1, 2, 3])
        self.assertEqual(three['recap']['participants'], [self.clients[i].get('/api/me').json()['login'] for i in (0, 1)],
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


unittest.main()
