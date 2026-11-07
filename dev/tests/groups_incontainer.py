"""Fictional Groups: private rows, hashed invites, lifecycle, blocks and aggregate-only activity progress."""
import datetime as dt
import hashlib
import uuid
import unittest
from unittest.mock import patch

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

    def make(self, who=0, goal_type='distance', goal_target=50, goal_unit='km'):
        zone = 'America/New_York'
        today = self.now.astimezone(dt.timezone(dt.timedelta(hours=-5))).date()
        body = {'title': 'Fictional Alpine Weekend', 'event_date': str(today + dt.timedelta(days=40)),
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
        self.assertEqual(shared['members'][1]['value'], 2)
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

        self.assertEqual(self.accept(token, who=1).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        self.activity(1, self.now - dt.timedelta(hours=2), distance=3000, name='PRIVATE B')
        two = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(two['member_count'], 2)
        self.assertNotIn('total', two)
        self.assertEqual(two['your_total'], 12)

        token = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(token, who=2).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        self.activity(2, self.now - dt.timedelta(hours=1), distance=5000, name='PRIVATE C')
        three = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(three['member_count'], 3)
        self.assertEqual(three['total'], 20)
        self.assertNotIn('your_total', three)

        token = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={}).json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.accept(token, who=3).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at=now()-interval '2 days' WHERE group_id=%s", (group['id'],))
        self.activity(3, self.now - dt.timedelta(minutes=30), distance=7000, name='PRIVATE D')
        all_four = self.clients[1].get('/api/groups/' + group['id']).json()
        self.assertEqual(all_four['member_count'], 4)
        self.assertEqual(all_four['total'], 27)

        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[0], self.ids[3]))
        blocked_view = self.clients[0].get('/api/groups/' + group['id']).json()
        unblocked_view = self.clients[1].get('/api/groups/' + group['id']).json()
        self.assertEqual(blocked_view['member_count'], 3)
        self.assertEqual(blocked_view['total'], 20)
        self.assertEqual(unblocked_view['member_count'], 4)
        self.assertEqual(unblocked_view['total'], 27)

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
        with db.connect() as c:
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
            for table in ('event_groups', 'group_members', 'group_invites'):
                self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE relname=%s', (table,)).fetchone()['relrowsecurity'])
        try:
            with psycopg.connect(db._conninfo(role, password), row_factory=dict_row) as reader:
                self.assertEqual(reader.execute('SELECT id FROM event_groups WHERE id=%s', (group['id'],)).fetchall(), [])
                self.assertEqual(reader.execute('SELECT user_id FROM group_members WHERE group_id=%s', (group['id'],)).fetchall(), [])
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    with reader.transaction(): reader.execute('SELECT token_hash FROM group_invites')
                for statement in ('UPDATE event_groups SET title=\'Guessed\' WHERE id=%s',
                                  'DELETE FROM group_members WHERE group_id=%s'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        with reader.transaction(): reader.execute(statement, (group['id'],))
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


unittest.main()
