"""Fictional Groups: private rows, hashed invites, lifecycle, blocks and aggregate-only activity progress."""
import asyncio
from contextlib import ExitStack, nullcontext
import datetime as dt
import hashlib
import io
import json
import re
import uuid
import unittest
import zipfile
from unittest.mock import Mock, patch
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
        # Legacy Groups fixtures stay private unless a case exercises the new join choice.
        return self.clients[who].post(f'/api/group-invites/{token}/accept', json={'share_total':False})

    def activity(self, who, at, *, sport='hike', distance=1000, ascent=20, seconds=1200, name='PRIVATE WORKOUT', visibility='friends'):
        with db.connect() as c:
            return c.execute('''INSERT INTO activities(user_id,sport,name,private_note,start_time,distance_m,ascent_m,
                moving_s,elapsed_s,source,visibility) VALUES(%s,%s,%s,'PRIVATE NOTE',%s,%s,%s,%s,%s,'manual',%s)
                RETURNING id''', (self.ids[who], sport, name, at, distance, ascent, seconds, seconds, visibility)).fetchone()['id']

    def friend(self, first, second):
        with db.connect() as c:
            c.execute('''INSERT INTO friendships(requester,addressee,status,accepted)
                VALUES(%s,%s,'accepted',now()) ON CONFLICT(requester,addressee)
                DO UPDATE SET status='accepted',accepted=now()''',(self.ids[first],self.ids[second]))

    def test_groups_115_upgrades_a_main_114_schema_in_place(self):
        # Simulate the main-branch schema in this same DB, apply only migration 115,
        # then roll back the fixture so the rest of this run remains on the branch schema.
        with db.connect() as c:
            c.execute('SAVEPOINT groups_115_upgrade')
            try:
                c.execute('ALTER TABLE notifications DROP CONSTRAINT notifications_group_fields')
                c.execute('DROP INDEX notifications_group_friend_invite')
                c.execute('ALTER TABLE notifications DROP CONSTRAINT notifications_group_friend_invite_fk')
                c.execute('ALTER TABLE notifications DROP COLUMN group_friend_invite_id')
                c.execute('DROP TABLE group_friend_invites CASCADE')
                c.execute('''ALTER TABLE notifications ADD CONSTRAINT notifications_group_fields CHECK(
                    (group_id IS NULL AND group_update_id IS NULL AND group_week_start IS NULL) OR
                    (group_id IS NOT NULL AND ((kind='group_update' AND group_update_id IS NOT NULL AND group_week_start IS NULL) OR
                      (kind='group_cheer' AND (group_update_id IS NOT NULL)<>(group_week_start IS NOT NULL)) OR
                      (kind='group_monday_recap' AND group_update_id IS NULL AND group_week_start IS NOT NULL))))''')
                c.execute(db.MIGRATIONS[114])
                self.assertTrue(c.execute("SELECT relrowsecurity FROM pg_class WHERE relname='group_friend_invites'").fetchone()['relrowsecurity'])
                self.assertTrue(c.execute("SELECT has_table_privilege('fit_readers','group_friend_invites','SELECT') AS ok").fetchone()['ok'])
                self.assertTrue(c.execute("SELECT has_table_privilege('fit_all_readers','group_friend_invites','SELECT') AS ok").fetchone()['ok'])
                policy=c.execute("SELECT pg_get_expr(polqual,polrelid) AS qual FROM pg_policy WHERE polrelid='group_friend_invites'::regclass AND polname='own_invitee_rows'").fetchone()['qual']
                self.assertIn('invitee_id',policy)
                self.assertIn('fit_me()',policy)
                fields=c.execute("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='notifications_group_fields'").fetchone()['definition']
                self.assertIn('group_invite',fields)
                self.assertIn('group_friend_invite_id',fields)
            finally:
                c.execute('ROLLBACK TO SAVEPOINT groups_115_upgrade')
                c.execute('RELEASE SAVEPOINT groups_115_upgrade')

    def test_notification_group_invite_capacity_uses_shared_limit(self):
        check = f"count(*) FROM group_members fm WHERE fm.group_id=fi.group_id AND fm.status='active')<{groups.MAX_MEMBERS}"
        self.assertIn(check, notify.NOTICE_VISIBLE)

    def test_group_update_names_are_first_only_for_non_friends(self):
        group,token=self.make()
        self.assertEqual(self.accept(token,who=1).status_code,200)
        with db.connect() as c:
            c.execute("UPDATE users SET name='Mina Sample',first_name='Mina',last_name='Sample' WHERE id=%s",(self.ids[1],))
        posted=self.clients[1].post(f"/api/groups/{group['id']}/updates",json={'text':'Fictional group update'})
        self.assertEqual(posted.status_code,200,posted.text)
        detail=self.clients[0].get(f"/api/groups/{group['id']}").json()
        update=next(row for row in detail['updates'] if row['id']==posted.json()['id'])
        self.assertEqual(update['name'],'Mina')
        self.assertNotIn('last_name',update)

    def test_friend_invites_are_member_scoped_and_decline_is_silent_with_group_hold(self):
        group,token=self.make()
        self.assertEqual(self.accept(token,who=1).status_code,200)
        self.assertEqual(self.accept(token,who=3).status_code,200)
        self.friend(1,2);self.friend(3,2)
        created=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':self.clients[2].get('/api/me').json()['login']})
        self.assertEqual(created.status_code,200,created.text)
        self.assertEqual(created.json(),{'state':'invited'})
        with db.connect() as c:
            row=c.execute('SELECT * FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[2])).fetchone()
            notices=c.execute("SELECT id FROM notifications WHERE group_id=%s AND kind='group_invite'",(group['id'],)).fetchall()
        self.assertEqual(row['status'],'pending')
        self.assertEqual(len(notices),1)
        preview=self.clients[2].get(f"/api/group-friend-invites/{row['id']}")
        self.assertEqual(preview.status_code,200,preview.text)
        self.assertEqual(set(preview.json()),{'title','inviter','expires_at'})
        self.assertEqual(preview.json()['inviter'],self.clients[1].get('/api/me').json()['login'])
        alert=self.clients[2].get('/api/notifications').json()['items']
        self.assertEqual([(n['kind'],n['text'],n['link']) for n in alert],
                         [('group_invite',f"@{preview.json()['inviter']} invited you to {group['title']}",f"/groups/invites/{row['id']}")])
        declined=self.clients[2].post(f"/api/group-friend-invites/{row['id']}/decline",json={})
        self.assertEqual(declined.status_code,200,declined.text)
        for member in (1,3):
            listing=self.clients[member].get(f"/api/groups/{group['id']}/friends").json()
            self.assertIn({'username':self.clients[2].get('/api/me').json()['login'],'state':'invited'},listing['friends'])
        retry=self.clients[3].post(f"/api/groups/{group['id']}/friend-invites",json={'username':self.clients[2].get('/api/me').json()['login']})
        self.assertEqual(retry.status_code,200,retry.text)
        self.assertEqual(retry.json(),{'state':'invited'})
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[2])).fetchone()['n'],1)
            self.assertEqual(c.execute("SELECT count(*) AS n FROM notifications WHERE group_id=%s AND kind='group_invite'",(group['id'],)).fetchone()['n'],0)
            self.assertEqual(c.execute('SELECT status,responded_at IS NOT NULL AS responded FROM group_friend_invites WHERE id=%s',(row['id'],)).fetchone(),
                             {'status':'declined','responded':True})
        self.assertIn('group_invite',notify.KINDS)
        self.assertEqual(notify._push_preference('group_invite'),'friends')

    def test_removed_member_friend_invite_post_and_accept_are_unavailable(self):
        group,token=self.make()
        self.assertEqual(self.accept(token,who=1).status_code,200)
        self.friend(1,2)
        login=self.clients[2].get('/api/me').json()['login']
        created=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(created.status_code,200,created.text)
        with db.connect() as c:
            invite=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[2])).fetchone()
            c.execute("INSERT INTO group_members(group_id,user_id,status,removed_invite_generation) VALUES(%s,%s,'removed',1)",
                      (group['id'],self.ids[2]))
        refused=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(refused.status_code,404)
        self.assertEqual(refused.json()['detail'],groups.INVITE_UNAVAILABLE)
        accepted=self.clients[2].post(f"/api/group-friend-invites/{invite['id']}/accept",json={'share_total':True})
        self.assertEqual(accepted.status_code,404)
        self.assertEqual(accepted.json()['detail'],groups.INVITE_UNAVAILABLE)

    def test_legacy_friend_invite_accept_without_share_choice_defaults_private(self):
        group,token=self.make()
        self.assertEqual(self.accept(token,who=1).status_code,200)
        self.friend(1,2)
        login=self.clients[2].get('/api/me').json()['login']
        sent=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(sent.status_code,200,sent.text)
        with db.connect() as c:
            invite=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[2])).fetchone()
        accepted=self.clients[2].post(f"/api/group-friend-invites/{invite['id']}/accept",json={})
        self.assertEqual(accepted.status_code,200,accepted.text)
        self.assertEqual(accepted.json()['sharing_level'],'just_in')

    def test_friend_invite_post_checks_membership_before_username_lookup(self):
        group,_=self.make()
        known=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':self.clients[2].get('/api/me').json()['login']})
        unknown=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':'zz_test_no_such_group_user'})
        self.assertEqual(known.status_code,404)
        self.assertEqual(unknown.status_code,404)
        self.assertEqual(known.json()['detail'],groups.GROUP_MISSING)
        self.assertEqual(unknown.json()['detail'],groups.GROUP_MISSING,
                         'a non-member cannot distinguish an existing username')

    def test_inviter_reader_cannot_select_decline_state(self):
        group,token=self.make()
        self.assertEqual(self.accept(token,who=1).status_code,200)
        self.friend(1,2)
        login=self.clients[2].get('/api/me').json()['login']
        created=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(created.status_code,200,created.text)
        with db.connect() as c:
            invite=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[2])).fetchone()
            c.execute('UPDATE group_friend_invites SET status=\'declined\',responded_at=now() WHERE id=%s',(invite['id'],))
            c.execute("DELETE FROM notifications WHERE kind='group_invite' AND group_friend_invite_id=%s",(invite['id'],))
            role='zz_test_group_invite_reader_'+uuid.uuid4().hex[:8]
            password='fictional group reader password'
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
            c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
            c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids[1]))
        try:
            with psycopg.connect(db._conninfo(role,password),row_factory=dict_row) as reader:
                self.assertEqual(reader.execute('SELECT status,responded_at FROM group_friend_invites WHERE id=%s',(invite['id'],)).fetchall(),[])
                self.assertEqual(reader.execute('SELECT status,responded_at FROM group_friend_invites WHERE inviter_id=%s',(self.ids[1],)).fetchall(),[])
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids[1],))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_group_stop_close_leave_and_remove_revoke_pending_and_declined_identically(self):
        for action in ('stop-joining','close','leave','remove'):
            group,token=self.make()
            self.assertEqual(self.accept(token,who=1).status_code,200)
            inviter=1 if action=='remove' else 0
            for person in (0,1):
                self.friend(person,2);self.friend(person,3)
            rows=[]
            for invitee,decline in ((2,False),(3,True)):
                login=self.clients[invitee].get('/api/me').json()['login']
                sent=self.clients[inviter].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
                self.assertEqual(sent.status_code,200,sent.text)
                with db.connect() as c:
                    invite=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[invitee])).fetchone()
                rows.append(invite['id'])
                if decline:
                    response=self.clients[invitee].post(f"/api/group-friend-invites/{invite['id']}/decline",json={})
                    self.assertEqual(response.status_code,200,response.text)
            if action=='remove':
                result=self.clients[0].post(f"/api/groups/{group['id']}/remove",json={'username':self.clients[inviter].get('/api/me').json()['login']})
            else:
                if action=='leave':
                    transfer=self.clients[0].post(f"/api/groups/{group['id']}/transfer",json={'username':self.clients[1].get('/api/me').json()['login']})
                    self.assertEqual(transfer.status_code,200,transfer.text)
                result=self.clients[0].post(f"/api/groups/{group['id']}/{action}",json={})
            self.assertEqual(result.status_code,200,result.text)
            if action=='stop-joining':
                new=self.clients[0].post(f"/api/groups/{group['id']}/invites",json={})
                self.assertEqual(new.status_code,200,new.text)
            with db.connect() as c:
                states=c.execute('SELECT status,responded_at FROM group_friend_invites WHERE id=ANY(%s) ORDER BY invitee_id',(rows,)).fetchall()
                self.assertEqual(states,[{'status':'revoked','responded_at':None},{'status':'revoked','responded_at':None}],
                                 f'{action} does not distinguish pending from declined')
                self.assertEqual(c.execute('SELECT count(*) AS n FROM notifications WHERE group_friend_invite_id=ANY(%s)',(rows,)).fetchone()['n'],0)
            viewer=1 if action=='leave' else 0
            listing=self.clients[viewer].get(f"/api/groups/{group['id']}/friends")
            self.assertEqual(listing.status_code,200,listing.text)
            for invitee in (2,3):
                self.assertIn({'username':self.clients[invitee].get('/api/me').json()['login'],'state':'none'},listing.json()['friends'],
                              f'{action} gives pending and declined invitees the same visible state')

    def test_block_and_unfriend_revoke_friend_invites_and_notices(self):
        group,token=self.make()
        self.assertEqual(self.accept(token,who=1).status_code,200)
        self.friend(1,2)
        login=self.clients[2].get('/api/me').json()['login']
        created=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(created.status_code,200,created.text)
        with db.connect() as c:
            first=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[2])).fetchone()['id']
        blocked=self.clients[1].post(f'/api/people/{login}/block',json={})
        self.assertEqual(blocked.status_code,200,blocked.text)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT status,responded_at FROM group_friend_invites WHERE id=%s',(first,)).fetchone(),{'status':'revoked','responded_at':None})
            self.assertEqual(c.execute('SELECT count(*) AS n FROM notifications WHERE group_friend_invite_id=%s',(first,)).fetchone()['n'],0)
            c.execute('DELETE FROM blocks WHERE user_id=%s AND blocked=%s',(self.ids[1],self.ids[2]))
        self.friend(1,2)
        second=self.clients[1].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(second.status_code,200,second.text)
        with db.connect() as c:
            invite_id=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s AND status=\'pending\'',(group['id'],self.ids[2])).fetchone()['id']
        removed=self.clients[1].delete(f'/api/friends/{login}')
        self.assertEqual(removed.status_code,200,removed.text)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT status,responded_at FROM group_friend_invites WHERE id=%s',(invite_id,)).fetchone(),{'status':'revoked','responded_at':None})
            self.assertEqual(c.execute('SELECT count(*) AS n FROM notifications WHERE group_friend_invite_id=%s',(invite_id,)).fetchone()['n'],0)

    def test_link_join_consumes_pending_friend_invite_and_saves_share_choice(self):
        group,token=self.make()
        self.friend(0,2)
        login=self.clients[2].get('/api/me').json()['login']
        sent=self.clients[0].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(sent.status_code,200,sent.text)
        with db.connect() as c:
            invite=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s',(group['id'],self.ids[2])).fetchone()
            c.execute("INSERT INTO group_members(group_id,user_id,status,sharing_level) VALUES(%s,%s,'left','total_shared')",
                      (group['id'],self.ids[2]))
        joined=self.clients[2].post(f"/api/group-invites/{token}/accept",json={'share_total':True})
        self.assertEqual(joined.status_code,200,joined.text)
        with db.connect() as c:
            member=c.execute('SELECT status,sharing_level FROM group_members WHERE group_id=%s AND user_id=%s',(group['id'],self.ids[2])).fetchone()
            invite_state=c.execute('SELECT status,responded_at IS NOT NULL AS responded FROM group_friend_invites WHERE id=%s',(invite['id'],)).fetchone()
            self.assertEqual(c.execute('SELECT count(*) AS n FROM notifications WHERE group_friend_invite_id=%s',(invite['id'],)).fetchone()['n'],0)
        self.assertEqual(member,{'status':'active','sharing_level':'total_shared'})
        self.assertEqual(invite_state,{'status':'accepted','responded':True})

    def test_friend_accept_conflict_path_saves_share_choice(self):
        group,token=self.make()
        self.friend(0,2)
        login=self.clients[2].get('/api/me').json()['login']
        self.assertEqual(self.accept(token,who=2).status_code,200)
        self.assertEqual(self.clients[2].post(f"/api/groups/{group['id']}/leave",json={}).status_code,200)
        sent=self.clients[0].post(f"/api/groups/{group['id']}/friend-invites",json={'username':login})
        self.assertEqual(sent.status_code,200,sent.text)
        with db.connect() as c:
            invite=c.execute('SELECT id FROM group_friend_invites WHERE group_id=%s AND invitee_id=%s AND status=\'pending\'',(group['id'],self.ids[2])).fetchone()
        accepted=self.clients[2].post(f"/api/group-friend-invites/{invite['id']}/accept",json={'share_total':True})
        self.assertEqual(accepted.status_code,200,accepted.text)
        with db.connect() as c:
            member=c.execute('SELECT status,sharing_level FROM group_members WHERE group_id=%s AND user_id=%s',(group['id'],self.ids[2])).fetchone()
        self.assertEqual(member,{'status':'active','sharing_level':'total_shared'})

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
        self.assertEqual(result['total'], 1, 'back-dated goal starts never remove the later joined_at floor')

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
        accepted = self.clients[1].post('/api/group-invites/' + original + '/accept',json={})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        self.assertEqual(accepted.json()['member_count'], 2)
        self.assertEqual(accepted.json()['sharing_level'], 'just_in', 'an omitted legacy share choice fails closed')
        self.assertNotIn('activity_id', accepted.text)
        replacement = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={'rotate': True}).json()['invite_url'].rsplit('/', 1)[1]
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

    def test_opening_invite_keeps_earlier_links_valid_until_explicit_rotation(self):
        group, original = self.make()
        opened = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={})
        self.assertEqual(opened.status_code, 200, opened.text)
        replacement = opened.json()['invite_url'].rsplit('/', 1)[1]
        self.assertNotEqual(original, replacement)
        self.assertEqual(self.anon.get('/api/group-invites/' + original).status_code, 200,
                         'opening Invite does not revoke a link already shared')
        self.assertEqual(self.accept(original, who=1).status_code, 200)
        self.assertEqual(self.accept(replacement, who=2).status_code, 200)

        rotated = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={'rotate': True})
        self.assertEqual(rotated.status_code, 200, rotated.text)
        self.assertEqual(self.anon.get('/api/group-invites/' + original).status_code, 404)
        self.assertEqual(self.anon.get('/api/group-invites/' + replacement).status_code, 404)

        self.assertEqual(self.clients[0].post('/api/groups/' + group['id'] + '/stop-joining', json={}).status_code, 200)
        reopened = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={})
        self.assertEqual(reopened.status_code, 200, reopened.text)
        self.assertEqual(self.anon.get('/api/group-invites/' + reopened.json()['invite_url'].rsplit('/', 1)[1]).status_code, 200,
                         'the existing Make a new invite action reopens joining after stop')

    def test_removed_member_cannot_use_a_live_link_after_nonrotating_invite_open(self):
        group, original = self.make()
        self.assertEqual(self.accept(original, who=1).status_code, 200)
        opened = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={'rotate': False})
        self.assertEqual(opened.status_code, 200, opened.text)
        live_token = opened.json()['invite_url'].rsplit('/', 1)[1]
        self.assertEqual(self.anon.get('/api/group-invites/' + live_token).status_code, 200)

        login = self.clients[1].get('/api/me').json()['login']
        removed = self.clients[0].post('/api/groups/' + group['id'] + '/remove', json={'username': login})
        self.assertEqual(removed.status_code, 200, removed.text)
        self.assertEqual(self.anon.get('/api/group-invites/' + live_token).status_code, 200,
                         'removal leaves the shared link live for other people')
        refused = self.accept(live_token, who=1)
        self.assertEqual(refused.status_code, 404,
                         'a removed member cannot rejoin through a link that remains live for others')
        self.assertEqual(refused.json()['detail'], groups.INVITE_UNAVAILABLE)

    def test_group_keeps_only_the_20_newest_live_invite_links(self):
        self.assertEqual(groups.MAX_LIVE_INVITES, 20)
        group, first = self.make()
        tokens = [first]
        for _ in range(groups.MAX_LIVE_INVITES):
            response = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={'rotate': False})
            self.assertEqual(response.status_code, 200, response.text)
            tokens.append(response.json()['invite_url'].rsplit('/', 1)[1])

        with db.connect() as c:
            live_count = c.execute('''SELECT count(*) AS n FROM group_invites
                                      WHERE group_id=%s AND revoked_at IS NULL AND expires_at>now()''',
                                   (group['id'],)).fetchone()['n']
        self.assertEqual(live_count, groups.MAX_LIVE_INVITES)
        self.assertEqual(self.anon.get('/api/group-invites/' + tokens[0]).status_code, 404,
                         'the oldest link is revoked after the cap is exceeded')
        self.assertEqual(self.anon.get('/api/group-invites/' + tokens[1]).status_code, 200,
                         'the next-oldest link stays live when the cap is exceeded')
        self.assertEqual(self.anon.get('/api/group-invites/' + tokens[-1]).status_code, 200,
                         'the newest link stays live when the cap is exceeded')

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
        rotated = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={'rotate': True}).json()['invite_url'].rsplit('/', 1)[1]
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
        after_removal = self.clients[0].post('/api/groups/' + group['id'] + '/invites', json={'rotate': True}).json()['invite_url'].rsplit('/', 1)[1]
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

    def test_summary_queries_do_not_grow_per_member_and_keep_visibility(self):
        group, token = self.make()
        for who in (1, 2):
            self.assertEqual(self.accept(token, who=who).status_code, 200)

        def measured_summary():
            queries = []
            execute = psycopg.Cursor.execute
            def counted(cursor, query, *args, **kwargs):
                if cursor.connection is c:
                    queries.append(query)
                return execute(cursor, query, *args, **kwargs)
            with db.connect() as c:
                row = c.execute('SELECT * FROM event_groups WHERE id=%s', (group['id'],)).fetchone()
                with patch.object(psycopg.Cursor, 'execute', counted):
                    result = groups._answer(c, row, self.ids[0])
            return result, len(queries)

        three, before = measured_summary()
        self.assertEqual(self.accept(token, who=3).status_code, 200)
        four, after = measured_summary()
        self.assertEqual((three['member_count'], four['member_count']), (3, 4))
        self.assertEqual(after, before, 'another member must not add a block-query round trip')
        with db.connect() as c:
            c.execute("UPDATE group_members SET sharing_level='total_shared',joined_at=%s WHERE group_id=%s",
                      (self.now - dt.timedelta(days=2), group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids,))
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s),(%s,%s)',
                      (self.ids[0], self.ids[1], self.ids[2], self.ids[0]))
        for who, distance in enumerate((1000, 900000, 900000, 2000)):
            self.activity(who, self.now - dt.timedelta(hours=1), distance=distance)
        answer, _ = measured_summary()
        self.assertEqual((answer['member_count'], answer['sharing_member_count'], answer['total']), (2, 2, 3))
        with db.connect() as c:
            c.execute('UPDATE users SET needs_email_confirm=true WHERE id=%s', (self.ids[3],))
        unconfirmed, _ = measured_summary()
        self.assertEqual((unconfirmed['member_count'], unconfirmed['total']), (1, 1))
        with db.connect() as c:
            c.execute('UPDATE users SET needs_email_confirm=false,suspended_at=now() WHERE id=%s', (self.ids[3],))
        suspended, _ = measured_summary()
        self.assertEqual((suspended['member_count'], suspended['total']), (1, 1))

    def test_batched_summary_excludes_left_and_removed_members(self):
        group, token = self.make()
        for who in (1, 2, 3):
            self.assertEqual(self.accept(token, who=who).status_code, 200)
        with db.connect() as c:
            c.execute("UPDATE group_members SET sharing_level='total_shared',joined_at=%s WHERE group_id=%s",
                      (self.now - dt.timedelta(days=2), group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids,))
            hidden = c.execute('SELECT login::text AS login FROM users WHERE id=%s', (self.ids[3],)).fetchone()['login']
        for who, distance in enumerate((1000, 1000, 1000, 900000)):
            self.activity(who, self.now - dt.timedelta(hours=1), distance=distance)
        for status in ('left', 'removed'):
            with self.subTest(status=status):
                with db.connect() as c:
                    c.execute('UPDATE group_members SET status=%s,removed_invite_generation=%s WHERE group_id=%s AND user_id=%s',
                              (status, 1 if status == 'removed' else None, group['id'], self.ids[3]))
                response = self.clients[0].get('/api/groups/' + group['id'])
                self.assertEqual(response.status_code, 200, response.text)
                answer = response.json()
                self.assertEqual((answer['member_count'], answer['sharing_member_count'], answer['total']), (3, 3, 3))
                self.assertNotIn(hidden, [member['username'] for member in answer['members']])

    def test_batched_summary_respects_each_sharing_opt_out(self):
        group, token = self.make()
        for who in (1, 2, 3):
            self.assertEqual(self.accept(token, who=who).status_code, 200)
        for who, distance in enumerate((1000, 900000, 1000, 1000)):
            self.activity(who, self.now - dt.timedelta(hours=1), distance=distance)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s',
                      (self.now - dt.timedelta(days=2), group['id']))
            hidden = c.execute('SELECT login::text AS login FROM users WHERE id=%s', (self.ids[1],)).fetchone()['login']
        for opt_out in ('group', 'account'):
            with self.subTest(opt_out=opt_out):
                with db.connect() as c:
                    c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s", (group['id'],))
                    c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)', (self.ids,))
                    if opt_out == 'group':
                        c.execute("UPDATE group_members SET sharing_level='just_in' WHERE group_id=%s AND user_id=%s",
                                  (group['id'], self.ids[1]))
                    else:
                        c.execute('UPDATE profile SET share_achievements=false WHERE user_id=%s', (self.ids[1],))
                response = self.clients[0].get('/api/groups/' + group['id'])
                self.assertEqual(response.status_code, 200, response.text)
                answer = response.json()
                self.assertEqual((answer['member_count'], answer['sharing_member_count'], answer['total']), (4, 3, 3))
                member = next(member for member in answer['members'] if member['username'] == hidden)
                self.assertFalse(member['shares_total'])
                self.assertNotIn('value', member, 'either opt-out must hide that member’s contribution')

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
        self.assertFalse(next(m for m in initial['members'] if m['username']==self.clients[1].get('/api/me').json()['login'])
                         ['shares_total'], 'a group-default member has no visible contribution')
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
        self.assertFalse(result['members'][1]['shares_total'])
        for private in ('PRIVATE A', 'PRIVATE B', 'OUTSIDER PRIVATE', 'BEFORE JOIN', 'PRIVATE NOTE', 'distance_m', 'activity_id'):
            self.assertNotIn(private, str(result))
        with db.connect() as c:
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=%s', (self.ids[1],))
        shared = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertNotIn('value', shared['members'][1], 'the group choice stays private until explicitly enabled')
        self.assertFalse(shared['members'][1]['shares_total'],
                         'account-wide sharing alone does not override the private group choice')
        self.assertEqual(self.clients[1].post(f"/api/groups/{group['id']}/sharing",
                                              json={'level':'total_shared'}).status_code, 200)
        shared = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertTrue(shared['members'][1]['shares_total'],
                        'both account-wide and group-specific choices are required to share')
        self.assertNotIn('value', shared['members'][0])
        self.assertEqual(shared['total'], 2)
        self.assertEqual(shared['sharing_member_count'], 1)
        self.assertEqual(self.clients[2].get('/api/groups/' + group['id']).status_code, 404)
        self.assertEqual(self.clients[2].post('/api/groups/' + group['id'] + '/close', json={}).status_code, 404)
        self.assertEqual(self.clients[2].post(f"/api/groups/{group['id']}/sharing",
                                              json={'level':'total_shared'}).status_code, 404,
                         'a non-member cannot change group sharing')
        with db.connect() as c:
            c.execute('DELETE FROM activities WHERE id=%s', (own_a,))
        remaining = self.clients[1].get('/api/groups/' + group['id']).json()
        self.assertEqual(remaining['total'], 2)
        self.assertEqual(remaining['sharing_member_count'], 1)
        self.assertEqual(self.clients[1].post('/api/groups/' + group['id'] + '/leave', json={}).status_code, 200)
        solo = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertNotIn('total', solo)
        self.assertEqual(solo['your_total'], 0)
        self.assertEqual(self.clients[1].get('/api/groups/' + group['id']).status_code, 404)

    def test_combined_total_and_member_values_work_with_two_viewer_visible_members(self):
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
        self.assertEqual(one['total'], 12)
        self.assertEqual(one['sharing_member_count'], 1)
        self.assertEqual(one['this_week_total'], 12)
        self.assertEqual(one['members'][0]['value'], 12)
        self.assertTrue(one['members'][0]['shares_total'])

        self.assertEqual(self.accept(token, who=1).status_code, 200)
        with db.connect() as c:
            c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s', (joined_at, group['id']))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=%s', (self.ids[1],))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=%s",
                      (group['id'], self.ids[1]))
        self.activity(1, fixed_now - dt.timedelta(hours=2), distance=3000, name='PRIVATE B')
        two = group_view()
        self.assertEqual(two['member_count'], 2)
        self.assertEqual(two['total'], 15)
        self.assertEqual(two['sharing_member_count'], 2)
        self.assertEqual(two['this_week_total'], 15)
        self.assertEqual({member['username']: member['value'] for member in two['members']},
                         dict(zip([self.clients[i].get('/api/me').json()['login'] for i in (0, 1)], (12, 3))))

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
        self.assertEqual(three['this_week_total'], 20)
        self.assertEqual(three['sharing_member_count'], 3)
        self.assertNotIn('this_week_contributors', three, 'weekly response never exposes who was active')
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

    def test_home_strip_counts_only_dated_groups(self):
        dated, _ = self.make()
        another, _ = self.make()
        foreign, _ = self.make(who=1)
        past, _ = self.make()
        with db.connect() as c:
            c.execute('UPDATE event_groups SET event_date=%s WHERE id=%s',
                      (self.now.astimezone(ZoneInfo('America/New_York')).date() - dt.timedelta(days=1), past['id']))
        for _ in range(2):
            response = self.clients[0].post('/api/groups', json={
                'title': 'Fictional ongoing goal', 'time_zone': 'America/New_York',
                'goal_type': 'distance', 'goal_target': 100, 'goal_unit': 'km'})
            self.assertEqual(response.status_code, 200, response.text)
        strip = self.clients[0].get('/api/groups/activity-strip').json()
        self.assertTrue(strip['has_upcoming'])
        self.assertIn(strip['next']['id'], (dated['id'], another['id']))
        self.assertNotEqual(strip['next']['id'], foreign['id'])
        self.assertEqual(strip['more_count'], 1, 'undated and other-account groups do not count')
        self.assertEqual(len(self.clients[0].get('/api/groups').json()), 5, 'the Groups list keeps undated and past groups')

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
        self.assertFalse(strip['has_upcoming'])
        self.assertNotIn('next', strip, 'dateless groups stay off Home')

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
        self.assertEqual(self.clients[0].get('/api/groups/activity-strip').json()['next']['id'], group['id'])

        with patch('app.groups._now', return_value=later):
            cleared = self.clients[0].patch(f"/api/groups/{group['id']}/event-date",
                                            json={'event_date': None})
            ongoing = self.clients[0].get('/api/groups/' + group['id']).json()
        self.assertEqual(cleared.status_code, 200, cleared.text)
        self.assertIsNone(cleared.json()['event_date'])
        self.assertFalse(self.clients[0].get('/api/groups/activity-strip').json()['has_upcoming'])
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
        self.assertEqual(two['total'], 3)
        self.assertEqual(two['sharing_member_count'], 2)
        self.assertEqual(two['recap']['your_total'], 1)
        self.assertNotIn('total', two['recap'])
        self.assertEqual({member['username']: member['value'] for member in two['members']},
                         {self.clients[0].get('/api/me').json()['login']: 1,
                          self.clients[1].get('/api/me').json()['login']: 2})
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
        self.assertFalse(next(member for member in three['members'] if member['username']==member_logins[2])
                         ['shares_total'], 'a recap-consenting just-in member remains out of group totals')
        self.assertCountEqual(three['recap']['participants'], [self.clients[i].get('/api/me').json()['login'] for i in (0, 1)],
                         'the recap names only members who opted in')

        with db.connect() as c:
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[0], self.ids[1]))
        blocked_view = self.clients[0].get(f"/api/groups/{group['id']}").json()
        self.assertEqual(blocked_view['member_count'], 2)
        self.assertEqual(blocked_view['total'], 1)
        self.assertNotIn('total', blocked_view['recap'])
        self.assertEqual(blocked_view['recap']['your_total'], 1)
        self.assertEqual(blocked_view['members'][0]['value'], 1)
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



class GroupChallengeCompatibility(unittest.TestCase):
    """No new routes: exercise real old-client writes against the private challenge mirror."""
    setUpClass = classmethod(Groups.setUpClass.__func__)
    tearDown = Groups.tearDown
    make, accept, friend = Groups.make, Groups.accept, Groups.friend

    def setUp(self):
        Groups.setUp(self)
        self.now = dt.datetime(2030, 3, 10, 16, tzinfo=dt.timezone.utc)
        clock = patch('app.groups._now', return_value=self.now)
        clock.start(); self.addCleanup(clock.stop)

    def extra(self, c, gid):
        return c.execute('''INSERT INTO group_challenges(group_id,creator_id,title,metric,target,unit,sports,start_date,time_zone)
            SELECT group_id,creator_id,'Independent fictional goal','sessions',3,'sessions',sports,start_date,time_zone
            FROM group_challenges WHERE legacy_group_id=%s RETURNING id''', (gid,)).fetchone()['id']

    def test_old_create_date_and_sharing_writes_do_not_change_other_challenges(self):
        group, _ = self.make(); other, _ = self.make(who=1)
        with db.connect() as c:
            q=c.execute('SELECT * FROM group_challenges WHERE legacy_group_id=%s',(group['id'],)).fetchone()
            self.assertEqual(q['title'],group['title']);self.assertEqual(q['start_date'].isoformat(),group['goal_start_date'])
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_challenges WHERE group_id=ANY(%s::uuid[])',([group['id'],other['id']],)).fetchone()['n'],2)
            extra=self.extra(c,group['id'])
            c.execute("UPDATE group_challenges SET end_date='2030-04-01' WHERE id=%s",(extra,))
            c.execute('INSERT INTO group_challenge_members(challenge_id,group_id,user_id,share_total) VALUES(%s,%s,%s,false)',(extra,group['id'],self.ids[0]))
        self.assertEqual(self.clients[0].post('/api/groups/'+group['id']+'/sharing',json={'level':'total_shared'}).status_code,200)
        self.assertEqual(self.clients[0].patch('/api/groups/'+group['id']+'/event-date',json={'event_date':None}).status_code,200)
        for route,body in [('sharing',{'level':'total_shared'}),('event-date',{'event_date':None})]:
            call=self.clients[2].post if route=='sharing' else self.clients[2].patch
            self.assertEqual(call('/api/groups/'+group['id']+'/'+route,json=body).status_code,404)
        with db.connect() as c:
            shares=c.execute('SELECT challenge_id,share_total FROM group_challenge_members WHERE user_id=%s',(self.ids[0],)).fetchall()
            self.assertEqual({r['challenge_id']:r['share_total'] for r in shares},{q['id']:True,extra:False})
            self.assertIsNone(c.execute('SELECT end_date FROM group_challenges WHERE id=%s',(q['id'],)).fetchone()['end_date'])
            self.assertEqual(c.execute('SELECT end_date FROM group_challenges WHERE id=%s',(extra,)).fetchone()['end_date'],dt.date(2030,4,1))
            self.assertFalse(c.execute('SELECT share_achievements FROM profile WHERE user_id=%s',(self.ids[0],)).fetchone()['share_achievements'])
            self.assertEqual(c.execute('SELECT end_date FROM group_challenges WHERE legacy_group_id=%s',(other['id'],)).fetchone()['end_date'].isoformat(),other['event_date'])

    def test_link_join_rejoin_and_retry_preserve_independent_opt_outs(self):
        group,token=self.make();path='/api/group-invites/'+token+'/accept'
        with db.connect() as c:
            opted_out=self.extra(c,group['id']);kept_on=self.extra(c,group['id'])
            seed=c.execute('SELECT id FROM group_challenges WHERE legacy_group_id=%s',(group['id'],)).fetchone()['id']
        self.assertEqual(self.accept(token).status_code,200)
        with db.connect() as c:
            choices=lambda:{r['challenge_id']:r['share_total'] for r in c.execute(
                'SELECT challenge_id,share_total FROM group_challenge_members WHERE user_id=%s',(self.ids[1],))}
            self.assertEqual(choices(),{seed:False,opted_out:False,kept_on:False})
            c.execute('UPDATE group_challenge_members SET share_total=true WHERE challenge_id=%s AND user_id=%s',(kept_on,self.ids[1]))
        self.assertEqual(self.clients[1].post(path,json={'share_total':True}).status_code,200)
        self.assertEqual(self.clients[1].post('/api/groups/'+group['id']+'/leave').status_code,200)
        with db.connect() as c:new=self.extra(c,group['id'])
        self.assertEqual(self.clients[1].post(path,json={'share_total':True}).status_code,200)
        with db.connect() as c:
            self.assertEqual(choices(),{seed:False,opted_out:False,kept_on:True,new:True})
            self.assertTrue(c.execute('''SELECT bool_and(q.joined_at=m.joined_at) AS v FROM group_challenge_members q
                JOIN group_members m USING(group_id,user_id) WHERE q.user_id=%s''',(self.ids[1],)).fetchone()['v'])
            self.assertFalse(c.execute('SELECT share_achievements FROM profile WHERE user_id=%s',(self.ids[1],)).fetchone()['share_achievements'])
        # A fresh join's explicit OFF applies to every new challenge membership.
        self.assertEqual(self.accept(token,2).status_code,200)
        with db.connect() as c:
            rows=c.execute('SELECT challenge_id,share_total FROM group_challenge_members WHERE user_id=%s',(self.ids[2],)).fetchall()
            self.assertEqual({r['challenge_id']:r['share_total'] for r in rows},{seed:False,opted_out:False,kept_on:False,new:False})

    def test_friend_join_initializes_all_challenges_and_rejects_other_account(self):
        group,_=self.make();self.friend(0,1)
        with db.connect() as c:self.extra(c,group['id'])
        login=self.clients[1].get('/api/me').json()['login']
        invitation=self.clients[0].post('/api/groups/'+group['id']+'/friend-invites',json={'username':login})
        self.assertEqual(invitation.status_code,200,invitation.text)
        with db.connect() as c:
            # SQL now() is real; align this fictional invitation with the frozen application clock.
            iid=c.execute("UPDATE group_friend_invites SET expires_at='2030-04-09T16:00Z' WHERE group_id=%s RETURNING id",(group['id'],)).fetchone()['id']
        path=f'/api/group-friend-invites/{iid}/accept'
        self.assertEqual(self.clients[2].post(path,json={'share_total':True}).status_code,404)
        self.assertEqual(self.clients[1].post(path,json={'share_total':True}).status_code,200)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT share_total FROM group_challenge_members WHERE user_id=%s',(self.ids[1],)).fetchall(),[{'share_total':True}]*2)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_challenge_members WHERE user_id=%s',(self.ids[2],)).fetchone()['n'],0)

        self.friend(0,2)
        login=self.clients[2].get('/api/me').json()['login']
        self.assertEqual(self.clients[0].post('/api/groups/'+group['id']+'/friend-invites',json={'username':login}).status_code,200)
        with db.connect() as c:
            iid=c.execute("UPDATE group_friend_invites SET expires_at='2030-04-09T16:00Z' WHERE group_id=%s AND invitee_id=%s RETURNING id",(group['id'],self.ids[2])).fetchone()['id']
        self.assertEqual(self.clients[2].post(f'/api/group-friend-invites/{iid}/accept',json={'share_total':False}).status_code,200)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT share_total FROM group_challenge_members WHERE user_id=%s',(self.ids[2],)).fetchall(),[{'share_total':False}]*2)

    def test_friend_rejoin_cannot_enable_a_saved_challenge_opt_out(self):
        group,_=self.make();self.friend(0,1)
        with db.connect() as c:
            extra=self.extra(c,group['id'])
            seed=c.execute('SELECT id FROM group_challenges WHERE legacy_group_id=%s',(group['id'],)).fetchone()['id']
        login=self.clients[1].get('/api/me').json()['login']
        def invite():
            self.assertEqual(self.clients[0].post('/api/groups/'+group['id']+'/friend-invites',json={'username':login}).status_code,200)
            with db.connect() as c:
                iid=c.execute("UPDATE group_friend_invites SET expires_at='2030-04-09T16:00Z' WHERE group_id=%s AND status='pending' RETURNING id",(group['id'],)).fetchone()['id']
            return f'/api/group-friend-invites/{iid}/accept'
        self.assertEqual(self.clients[1].post(invite(),json={'share_total':True}).status_code,200)
        with db.connect() as c:c.execute('UPDATE group_challenge_members SET share_total=false WHERE challenge_id=%s AND user_id=%s',(extra,self.ids[1]))
        for share in [False,True]:
            self.assertEqual(self.clients[1].post('/api/groups/'+group['id']+'/leave').status_code,200)
            self.assertEqual(self.clients[1].post(invite(),json={'share_total':share}).status_code,200)
            with db.connect() as c:
                rows=c.execute('SELECT challenge_id,share_total FROM group_challenge_members WHERE user_id=%s',(self.ids[1],)).fetchall()
                self.assertEqual({r['challenge_id']:r['share_total'] for r in rows},{seed:False,extra:False})

    def test_reconcile_snapshot_gap_preserves_old_records_creator_and_independent_choices(self):
        group,token=self.make();self.accept(token)
        migration=next(m for m in db.MIGRATIONS if 'title=EXCLUDED.title,metric=EXCLUDED.metric' in m)
        with db.connect() as c,c.transaction(force_rollback=True):
            extra=self.extra(c,group['id'])
            c.execute('INSERT INTO group_challenge_members(challenge_id,group_id,user_id,share_total) VALUES(%s,%s,%s,false)',(extra,group['id'],self.ids[1]))
            c.execute("UPDATE event_groups SET title='Changed during rollout',organizer_id=%s,event_date=NULL WHERE id=%s",(self.ids[1],group['id']))
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=%s",(group['id'],self.ids[1]))
            before=c.execute('SELECT to_jsonb(g) AS v FROM event_groups g WHERE id=%s',(group['id'],)).fetchone()
            c.execute(migration)
            self.assertEqual(c.execute('SELECT to_jsonb(g) AS v FROM event_groups g WHERE id=%s',(group['id'],)).fetchone(),before)
            q=c.execute('SELECT * FROM group_challenges WHERE legacy_group_id=%s',(group['id'],)).fetchone()
            self.assertEqual(q['title'],'Changed during rollout');self.assertEqual(q['creator_id'],self.ids[0]);self.assertIsNone(q['end_date'])
            rows=c.execute('SELECT challenge_id,share_total FROM group_challenge_members WHERE user_id=%s',(self.ids[1],)).fetchall()
            self.assertEqual({r['challenge_id']:r['share_total'] for r in rows},{q['id']:True,extra:False})
            c.execute('DELETE FROM group_challenges WHERE legacy_group_id=%s',(group['id'],));c.execute(migration)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_challenges WHERE legacy_group_id=%s',(group['id'],)).fetchone()['n'],1)
        db.migrate();db.migrate()

    def test_reconciliation_precedes_workers_and_requests_and_preserves_later_choices(self):
        from app import main, group_challenges
        group, token = self.make(); self.accept(token)
        migration = next(m for m in db.MIGRATIONS if 'title=EXCLUDED.title,metric=EXCLUDED.metric' in m)
        version = db.MIGRATIONS.index(migration) + 1
        with db.connect() as c, c.transaction(force_rollback=True), ExitStack() as patches:
            # Reproduce schema 121's stale snapshot and intervening LEGACY-only edits.
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=%s",
                      (group['id'], self.ids[1]))
            c.execute('UPDATE group_challenge_members SET share_total=true WHERE group_id=%s AND user_id=%s',
                      (group['id'], self.ids[0]))
            # Later migrations must be replayable too: the runner resumes after the highest version.
            c.execute('DELETE FROM schema_version WHERE version>=%s', (version,))
            patches.enter_context(patch.object(db, 'connect', side_effect=lambda: nullcontext(c)))
            patches.enter_context(patch.object(db, 'bootstrap'))
            def after_migration(*args, **kwargs):
                self.assertIsNotNone(c.execute('SELECT version FROM schema_version WHERE version=%s', (version,)).fetchone())
                return Mock()
            patches.enter_context(patch.object(main.threading, 'Thread', side_effect=after_migration))
            for module, method in [(main.segments,'start_worker'), (main.milestones,'start_worker'),
                    (main.challenges,'start_worker'), (main.personal_notifications,'start_worker'),
                    (main.groups,'start_worker'), (main.admin_features,'start_cleanup')]:
                patches.enter_context(patch.object(module, method, side_effect=lambda: (after_migration(), Mock())))
            async def serve():
                async with main.lifespan(app):
                    rows=c.execute('SELECT user_id,share_total FROM group_challenge_members WHERE group_id=%s', (group['id'],)).fetchall()
                    self.assertEqual({r['user_id']:r['share_total'] for r in rows}, {self.ids[0]:False,self.ids[1]:True})
                    # Only after startup yields may a user record a per-challenge choice.
                    group_challenges.legacy_sharing(c, group['id'], self.ids[1], False)
            asyncio.run(serve())
            db.migrate(); db.migrate()
            self.assertFalse(c.execute('SELECT bool_or(share_total) AS v FROM group_challenge_members WHERE group_id=%s', (group['id'],)).fetchone()['v'])

    def test_close_freezes_mirror_without_reending_already_ended_challenge(self):
        group,_=self.make()
        with db.connect() as c:
            extra=self.extra(c,group['id']);c.execute("UPDATE group_challenges SET ended_at='2026-01-01T12:00Z' WHERE id=%s",(extra,))
        self.assertEqual(self.clients[0].post('/api/groups/'+group['id']+'/close').status_code,200)
        with db.connect() as c:
            rows=c.execute('SELECT id,ended_at FROM group_challenges WHERE group_id=%s',(group['id'],)).fetchall()
            self.assertTrue(all(r['ended_at'] for r in rows));self.assertEqual(next(r['ended_at'] for r in rows if r['id']==extra),dt.datetime(2026,1,1,12,tzinfo=dt.timezone.utc))


class GroupChallengeUpgrade(unittest.TestCase):
    """Additive upgrade and account-lifecycle fixtures; group UI still uses legacy tables."""
    migration = next(m for m in db.MIGRATIONS if 'additive people-first Groups foundation' in m)
    @classmethod
    def setUpClass(cls):
        cls.password = auth.hash_pw('fictional group testing phrase')

    def setUp(self):
        self.ids = []
        with db.connect() as c:
            for _ in range(4):
                self.ids.append(c.execute("""INSERT INTO users(login,name,pw_hash)
                    VALUES(%s,'Fictional schema member',%s) RETURNING id""",
                    ('zz_test_gcs_'+uuid.uuid4().hex[:12],self.password)).fetchone()['id'])
                c.execute('INSERT INTO profile(user_id,share_achievements) VALUES(%s,false)', (self.ids[-1],))

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=ANY(%s)', (self.ids,))

    def seed(self, c, who=0, metric='distance', unit='km', start='2026-11-01', end='2026-11-01'):
        g = c.execute("""INSERT INTO event_groups(organizer_id,title,time_zone,note,training_for,
            goal_type,goal_target,goal_unit,goal_sports,goal_start_date,event_date,created)
            VALUES(%s,'Fictional November crew','America/New_York','Retain this note','Trail day',
            %s,100,%s,ARRAY['run'],%s,%s,'2026-01-01T12:00:00Z') RETURNING *""",
            (self.ids[who],metric,unit,start,end)).fetchone()
        for i, uid in enumerate(self.ids[:3]):
            c.execute("""INSERT INTO group_members(group_id,user_id,sharing_level,joined_at)
                VALUES(%s,%s,%s,'2026-01-01T12:00:00Z')""",
                (g['id'],uid,'just_in' if i==2 else 'total_shared'))
        return g

    def backfill(self, c):
        migration = self.migration
        c.execute(migration[migration.index('INSERT INTO group_challenges('):])

    def upgrade(self, c):
        c.execute('DROP TABLE group_challenge_members,group_challenges')
        c.execute('DROP FUNCTION fit_group_challenge_access(uuid,bigint)')
        c.execute(self.migration)

    def challenge(self, c, gid, who, title):
        return c.execute("""INSERT INTO group_challenges(group_id,creator_id,title,metric,target,unit,
            sports,start_date,time_zone) VALUES(%s,%s,%s,'sessions',3,'sessions',ARRAY['run'],
            '2026-11-02','UTC') RETURNING id""",(gid,self.ids[who],title)).fetchone()['id']

    def client(self, who):
        with db.connect() as c:token=auth.new_session(c,self.ids[who],'fictional schema test')
        client=TestClient(app);client.headers['Origin']='http://testserver'
        client.cookies.set(auth.COOKIE,token)
        return client

    def test_account_export_includes_only_own_challenges_and_sharing(self):
        with db.connect() as c:
            a=self.seed(c);b=self.seed(c,who=1);self.backfill(c)
            mine=self.challenge(c,a['id'],2,'MY CREATED CHALLENGE')
            theirs=self.challenge(c,a['id'],1,'OTHER ACCOUNT SENTINEL')
            c.execute('INSERT INTO group_challenge_members(challenge_id,group_id,user_id) VALUES(%s,%s,%s)',
                      (mine,a['id'],self.ids[2]))
            expected=c.execute('SELECT challenge_id,share_total FROM group_challenge_members WHERE user_id=%s',
                               (self.ids[2],)).fetchall()
        client=self.client(2)
        try:
            response=client.get('/api/account/export');self.assertEqual(response.status_code,200)
            with zipfile.ZipFile(io.BytesIO(response.content)) as z:
                created=[json.loads(s) for s in z.read('data/group_challenges_created.jsonl').splitlines()]
                shares=[json.loads(s) for s in z.read('data/group_challenge_members.jsonl').splitlines()]
            self.assertEqual([q['id'] for q in created],[str(mine)])
            self.assertNotIn('OTHER ACCOUNT SENTINEL',json.dumps(created))
            self.assertNotIn(str(theirs),json.dumps(created))
            self.assertTrue(all('creator_id' not in q for q in created))
            self.assertEqual({r['challenge_id']:r['share_total'] for r in shares},
                             {str(r['challenge_id']):r['share_total'] for r in expected})
            self.assertEqual(len(shares),3,'both prior private choices and new default-on choice exported')
            self.assertTrue(all('user_id' not in r for r in shares))
        finally:client.close()

    def test_full_account_deletion_removes_authored_challenges_but_not_others_group(self):
        with db.connect() as c:
            g=self.seed(c);self.backfill(c)
            mine=self.challenge(c,g['id'],2,'DELETE MY AUTHORED TEXT')
            for uid in self.ids[:3]:
                c.execute('INSERT INTO group_challenge_members(challenge_id,group_id,user_id) VALUES(%s,%s,%s)',
                          (mine,g['id'],uid))
            kept=c.execute('SELECT * FROM group_challenges WHERE legacy_group_id=%s',(g['id'],)).fetchone()
        client=self.client(2)
        try:
            response=client.post('/api/account/delete',json={'password':'fictional group testing phrase'})
            self.assertEqual(response.status_code,200,response.text)
            self.assertEqual(client.get('/api/me').status_code,401)
        finally:client.close()
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT id FROM users WHERE id=%s',(self.ids[2],)).fetchone())
            self.assertEqual(c.execute('SELECT * FROM group_challenges WHERE group_id=%s',(g['id'],)).fetchall(),[kept])
            self.assertEqual(c.execute('SELECT * FROM event_groups WHERE id=%s',(g['id'],)).fetchone(),g)
            self.assertEqual(c.execute('SELECT user_id FROM group_members WHERE group_id=%s ORDER BY user_id',
                                      (g['id'],)).fetchall(),[{'user_id':u} for u in self.ids[:2]])
            self.assertEqual(c.execute('SELECT user_id FROM group_challenge_members WHERE group_id=%s ORDER BY user_id',
                                      (g['id'],)).fetchall(),[{'user_id':u} for u in self.ids[:2]])
        owner=self.client(0)
        try:self.assertEqual(owner.get('/api/groups/'+str(g['id'])).status_code,200)
        finally:owner.close()

    def test_original_goal_survives_when_its_first_organizer_hands_over_and_leaves(self):
        private_text='DEPARTING ACCOUNT PRIVATE SENTINEL'
        with db.connect() as c:
            c.execute('UPDATE users SET name=%s WHERE id=%s',(private_text,self.ids[0]))
            c.execute('UPDATE profile SET bio=%s WHERE user_id=%s',(private_text,self.ids[0]))
            g=self.seed(c);self.backfill(c)
            c.execute('UPDATE event_groups SET organizer_id=%s WHERE id=%s',(self.ids[1],g['id']))
            kept=c.execute('SELECT * FROM group_challenges WHERE legacy_group_id=%s',(g['id'],)).fetchone()
            kept={**kept,'creator_id':None}
            members=c.execute('SELECT * FROM group_challenge_members WHERE group_id=%s AND user_id<>%s ORDER BY user_id',
                              (g['id'],self.ids[0])).fetchall()
            added=self.challenge(c,g['id'],0,private_text)
        client=self.client(0)
        try:
            response=client.post('/api/account/delete',json={'password':'fictional group testing phrase'})
            self.assertEqual(response.status_code,200,response.text)
        finally:client.close()
        with db.connect() as c:
            rows=c.execute('SELECT * FROM group_challenges WHERE group_id=%s',(g['id'],)).fetchall()
            self.assertEqual(rows,[kept],'original ID and every shared goal field survive; only creator is cleared')
            self.assertNotIn(added,[r['id'] for r in rows])
            self.assertNotIn(private_text,json.dumps(rows,default=str))
            self.assertIsNone(c.execute('SELECT id FROM users WHERE id=%s',(self.ids[0],)).fetchone())
            self.assertIsNone(c.execute('SELECT user_id FROM profile WHERE user_id=%s',(self.ids[0],)).fetchone())
            self.assertEqual(c.execute('SELECT * FROM group_challenge_members WHERE group_id=%s ORDER BY user_id',
                                      (g['id'],)).fetchall(),members,'other members and their sharing choices survive unchanged')

    def test_temp_table_cannot_capture_original_goal_preservation(self):
        with db.connect() as c:
            g=self.seed(c);self.backfill(c)
            c.execute('UPDATE event_groups SET organizer_id=%s WHERE id=%s',(self.ids[1],g['id']))
            kept=c.execute('SELECT * FROM group_challenges WHERE legacy_group_id=%s',(g['id'],)).fetchone()
        # A fresh backend prevents a previously cached PL/pgSQL plan from hiding temp-table shadowing.
        with psycopg.connect(db.CONNINFO,row_factory=dict_row) as c, c.transaction(force_rollback=True):
            c.execute('CREATE TEMP TABLE group_challenges (creator_id bigint,legacy_group_id uuid)')
            c.execute('INSERT INTO pg_temp.group_challenges VALUES(%s,%s)',(self.ids[0],g['id']))
            shadow=c.execute('SELECT * FROM pg_temp.group_challenges').fetchall()
            c.execute('DELETE FROM public.users WHERE id=%s',(self.ids[0],))
            self.assertEqual(c.execute('SELECT * FROM pg_temp.group_challenges').fetchall(),shadow,
                             'the definer must never write to a caller-controlled temporary relation')
            self.assertEqual(c.execute('SELECT * FROM public.group_challenges WHERE group_id=%s',(g['id'],)).fetchall(),
                             [{**kept,'creator_id':None}],'the real goal keeps its original ID and contents')

    def test_organizer_deletion_cascades_only_their_groups_and_authored_challenges(self):
        with db.connect() as c:
            a=self.seed(c);b=self.seed(c,who=1);self.backfill(c)
            self.challenge(c,b['id'],0,'DELETED CREATOR IN ANOTHER GROUP')
            kept=c.execute('SELECT * FROM group_challenges WHERE legacy_group_id=%s',(b['id'],)).fetchone()
        client=self.client(0)
        try:
            response=client.post('/api/account/delete',json={'password':'fictional group testing phrase'})
            self.assertEqual(response.status_code,200,response.text)
        finally:client.close()
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT id FROM event_groups WHERE id=%s',(a['id'],)).fetchone())
            self.assertEqual(c.execute('SELECT * FROM group_challenges WHERE group_id=ANY(%s)',([a['id'],b['id']],)).fetchall(),[kept])
            self.assertEqual(c.execute('SELECT user_id FROM group_challenge_members WHERE group_id=%s ORDER BY user_id',
                                      (b['id'],)).fetchall(),[{'user_id':u} for u in self.ids[1:3]])

    def test_upgrade_preserves_every_goal_and_related_record(self):
        with db.connect() as c, c.transaction(force_rollback=True):
            gs = [self.seed(c,metric=m,unit=u,end=None if m=='sessions' else '2026-11-01')
                  for m,u in [('distance','mi'),('elevation','ft'),('long_outings','outings'),('sessions','sessions')]]
            gid=gs[0]['id']
            c.execute("UPDATE event_groups SET closed_at='2026-11-02T12:00Z',joining_closed=true WHERE id=%s", (gid,))
            c.execute("UPDATE group_members SET status='left',monday_recap_enabled=true WHERE group_id=%s AND user_id=%s",(gid,self.ids[1]))
            update=c.execute("INSERT INTO group_updates(group_id,user_id,text) VALUES(%s,%s,'Fictional update') RETURNING id",(gid,self.ids[0])).fetchone()['id']
            c.execute("INSERT INTO group_update_reactions(update_id,user_id,kind) VALUES(%s,%s,'thumbsup')",(update,self.ids[1]))
            c.execute("INSERT INTO group_monday_recaps(group_id,week_start) VALUES(%s,'2026-10-26')",(gid,))
            c.execute("INSERT INTO group_invites(group_id,generation,token_hash,expires_at) VALUES(%s,1,%s,'2030-01-01')",(gid,b'x'*32))
            tables=['event_groups','group_members','group_updates','group_update_reactions','group_monday_recaps','group_invites','profile','users','notifications','activities']
            snapshot=lambda: {t:c.execute(sql.SQL('SELECT to_jsonb(t) AS row FROM {} t ORDER BY to_jsonb(t)::text').format(sql.Identifier(t))).fetchall() for t in tables}
            before=snapshot();self.upgrade(c);self.assertEqual(snapshot(),before,'no existing record changes')
            rows=c.execute('SELECT * FROM group_challenges WHERE group_id=ANY(%s)',([g['id'] for g in gs],)).fetchall()
            self.assertEqual(len(rows),4)
            for q in rows:
                g=c.execute('SELECT * FROM event_groups WHERE id=%s',(q['group_id'],)).fetchone()
                for new,old in [('legacy_group_id','id'),('creator_id','organizer_id'),('metric','goal_type'),('target','goal_target'),('unit','goal_unit'),('sports','goal_sports'),('start_date','goal_start_date'),('end_date','event_date'),('ended_at','closed_at'),('created','created'),('title','title'),('note','note'),('training_for','training_for'),('time_zone','time_zone')]:
                    self.assertEqual(q[new],g[old],new)
            shares=c.execute('SELECT user_id,share_total,joined_at FROM group_challenge_members WHERE group_id=%s ORDER BY user_id',(gid,)).fetchall()
            self.assertEqual([r['share_total'] for r in shares],[True,True,False],'left/private choices retained; master sharing is not enabled')
            self.assertTrue(all(r['joined_at']==dt.datetime(2026,1,1,12,tzinfo=dt.timezone.utc) for r in shares))
            self.assertFalse(c.execute('SELECT share_achievements FROM profile WHERE user_id=%s',(self.ids[0],)).fetchone()['share_achievements'])

    def test_date_and_total_parity_across_spring_and_fall_dst(self):
        for day,first,last in [('2026-03-08','2026-03-08T05:00Z','2026-03-09T04:00Z'),
                               ('2026-11-01','2026-11-01T04:00Z','2026-11-02T05:00Z')]:
            with self.subTest(day=day), db.connect() as c, c.transaction(force_rollback=True):
                g=self.seed(c,start=day,end=day)
                a=dt.datetime.fromisoformat(first);z=dt.datetime.fromisoformat(last)
                for at in [a-dt.timedelta(seconds=1),a,a+dt.timedelta(hours=3),z-dt.timedelta(seconds=1),z]:
                    c.execute("""INSERT INTO activities(user_id,sport,name,start_time,distance_m,ascent_m,moving_s,elapsed_s,source,visibility)
                        VALUES(%s,'run','Fictional DST activity',%s,1000,20,3600,3600,'manual','friends')""",(self.ids[0],at))
                self.upgrade(c)
                q=c.execute('''SELECT metric AS goal_type,target AS goal_target,unit AS goal_unit,sports AS goal_sports,
                    start_date AS goal_start_date,end_date AS event_date,time_zone FROM group_challenges WHERE group_id=%s''',(g['id'],)).fetchone()
                q['id']=g['id'];members=[{'user_id':self.ids[0]}]
                now=z+dt.timedelta(days=1)
                self.assertEqual(groups._contributions(c,g,members,now),{self.ids[0]:3.0})
                self.assertEqual(groups._contributions(c,q,members,now),groups._contributions(c,g,members,now))

    def test_ongoing_and_inverted_legacy_dates_are_not_rewritten(self):
        with db.connect() as c, c.transaction(force_rollback=True):
            ongoing=self.seed(c,end=None)
            inverted=self.seed(c,start='2026-11-02',end='2026-11-01')
            self.upgrade(c)
            self.assertIsNone(c.execute('SELECT end_date FROM group_challenges WHERE group_id=%s',(ongoing['id'],)).fetchone()['end_date'])
            q=c.execute('SELECT start_date,end_date FROM group_challenges WHERE group_id=%s',(inverted['id'],)).fetchone()
            self.assertEqual(q,{'start_date':dt.date(2026,11,2),'end_date':dt.date(2026,11,1)})
            with self.assertRaises(psycopg.errors.CheckViolation), c.transaction():
                c.execute("""INSERT INTO group_challenges(group_id,title,metric,target,unit,sports,start_date,end_date,time_zone)
                    VALUES(%s,'New invalid dates','distance',1,'km',ARRAY['run'],'2026-11-02','2026-11-01','UTC')""",(ongoing['id'],))

    def test_backfill_and_migration_runner_are_idempotent(self):
        with db.connect() as c:
            g=self.seed(c);self.backfill(c)
            q=c.execute('SELECT * FROM group_challenges WHERE group_id=%s',(g['id'],)).fetchone()
            c.execute('UPDATE group_challenge_members SET share_total=false WHERE challenge_id=%s',(q['id'],))
            self.backfill(c);self.backfill(c)
            self.assertEqual(c.execute('SELECT * FROM group_challenges WHERE group_id=%s',(g['id'],)).fetchall(),[q])
            self.assertFalse(c.execute('SELECT bool_or(share_total) AS v FROM group_challenge_members WHERE challenge_id=%s',(q['id'],)).fetchone()['v'])
        db.migrate();db.migrate()
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT id FROM group_challenges WHERE group_id=%s',(g['id'],)).fetchall(),[{'id':q['id']}])
            c.execute("""INSERT INTO group_challenges(group_id,creator_id,title,metric,target,unit,sports,start_date,time_zone)
                VALUES(%s,%s,'Member-created later','sessions',3,'sessions',ARRAY['run'],'2026-11-02','UTC')""",(g['id'],self.ids[2]))
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_challenges WHERE group_id=%s',(g['id'],)).fetchone()['n'],2)

    def test_sql_readers_are_member_scoped_own_sharing_only_and_cannot_write(self):
        role='zz_test_gcs_reader_'+uuid.uuid4().hex[:8];password='fictional isolated SQL reader'
        with db.connect() as c:
            a=self.seed(c);b=self.seed(c,who=1)
            c.execute('DELETE FROM group_members WHERE group_id=%s AND user_id=%s',(b['id'],self.ids[2]))
            self.backfill(c)
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
            c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
            c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.ids[2]))
            for table in ['group_challenges','group_challenge_members']:
                self.assertTrue(c.execute('SELECT relrowsecurity AS v FROM pg_class WHERE relname=%s',(table,)).fetchone()['v'])
                for restricted in ['fit_coach']:
                    self.assertFalse(c.execute('SELECT has_table_privilege(%s,%s,\'SELECT\') AS v',(restricted,table)).fetchone()['v'])
                self.assertEqual(c.execute("SELECT count(*) AS n FROM pg_policies WHERE tablename=%s AND 'fit_all_readers'=ANY(roles)",(table,)).fetchone()['n'],0)
        try:
            with psycopg.connect(db._conninfo(role,password),row_factory=dict_row,autocommit=True) as reader:
                self.assertEqual(reader.execute('SELECT group_id FROM group_challenges').fetchall(),[{'group_id':a['id']}])
                self.assertEqual(reader.execute('SELECT user_id,share_total FROM group_challenge_members').fetchall(),[{'user_id':self.ids[2],'share_total':False}])
                with db.connect() as c:c.execute(sql.SQL('GRANT fit_all_readers TO {}').format(sql.Identifier(role)))
                self.assertEqual(reader.execute('SELECT group_id FROM group_challenges').fetchall(),[{'group_id':a['id']}],'read-all membership never bypasses group RLS')
                for uid in (self.ids[0],self.ids[2]):
                    for column,value in [('suspended_at',dt.datetime(2026,11,26,tzinfo=dt.timezone.utc)),
                                         ('needs_email_confirm',True),
                                         ('password_change_expires',dt.datetime(2030,1,1,tzinfo=dt.timezone.utc))]:
                        with self.subTest(account=uid,column=column):
                            with db.connect() as c:
                                c.execute(sql.SQL('UPDATE users SET {}=%s WHERE id=%s').format(sql.Identifier(column)),(value,uid))
                            self.assertEqual(reader.execute('SELECT id FROM group_challenges').fetchall(),[])
                            self.assertEqual(reader.execute('SELECT user_id FROM group_challenge_members').fetchall(),[])
                            with db.connect() as c:
                                c.execute(sql.SQL('UPDATE users SET {}=%s WHERE id=%s').format(sql.Identifier(column)),
                                          (False if column=='needs_email_confirm' else None,uid))
                            self.assertEqual(reader.execute('SELECT group_id FROM group_challenges').fetchall(),[{'group_id':a['id']}])
                for statement in ['UPDATE group_challenge_members SET share_total=true','DELETE FROM group_challenges']:
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):reader.execute(statement)
                with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[0],self.ids[2]))
                self.assertEqual(reader.execute('SELECT id FROM group_challenges').fetchall(),[])
                self.assertEqual(reader.execute('SELECT user_id FROM group_challenge_members').fetchall(),[])
                with db.connect() as c:
                    c.execute('DELETE FROM blocks WHERE user_id=%s',(self.ids[0],))
                    c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[2],self.ids[0]))
                self.assertEqual(reader.execute('SELECT id FROM group_challenges').fetchall(),[])
                self.assertEqual(reader.execute('SELECT user_id FROM group_challenge_members').fetchall(),[])
                with db.connect() as c:
                    c.execute('DELETE FROM blocks WHERE user_id=%s',(self.ids[2],))
                    c.execute("UPDATE group_members SET status='left' WHERE group_id=%s AND user_id=%s",(a['id'],self.ids[2]))
                self.assertEqual(reader.execute('SELECT id FROM group_challenges').fetchall(),[])
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.ids[2],))
                c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_sharing_defaults_on_but_cross_group_and_nonmember_links_fail(self):
        with db.connect() as c, c.transaction(force_rollback=True):
            a=self.seed(c);b=self.seed(c,who=1);self.backfill(c)
            q=c.execute('SELECT id FROM group_challenges WHERE group_id=%s',(a['id'],)).fetchone()['id']
            c.execute('DELETE FROM group_challenge_members WHERE challenge_id=%s AND user_id=%s',(q,self.ids[2]))
            row=c.execute('INSERT INTO group_challenge_members(challenge_id,group_id,user_id) VALUES(%s,%s,%s) RETURNING share_total',(q,a['id'],self.ids[2])).fetchone()
            self.assertTrue(row['share_total'])
            c.execute('DELETE FROM group_challenge_members WHERE challenge_id=%s AND user_id=%s',(q,self.ids[2]))
            for gid,uid in [(b['id'],self.ids[2]),(a['id'],self.ids[3])]:
                with self.assertRaises(psycopg.errors.ForeignKeyViolation), c.transaction():
                    c.execute('INSERT INTO group_challenge_members(challenge_id,group_id,user_id) VALUES(%s,%s,%s)',(q,gid,uid))


class GroupChallengeAPI(unittest.TestCase):
    setUpClass = classmethod(Groups.setUpClass.__func__)
    tearDown,make,accept,activity,friend = Groups.tearDown,Groups.make,Groups.accept,Groups.activity,Groups.friend

    def setUp(self):
        Groups.setUp(self)
        self.now=dt.datetime(2030,3,10,16,tzinfo=dt.timezone.utc)
        clock=patch('app.groups._now',return_value=self.now);clock.start();self.addCleanup(clock.stop)
        self.group,self.token=self.make();self.gid=self.group['id']
        self.assertEqual(self.clients[0].post('/api/groups/'+self.gid+'/sharing',json={'level':'total_shared'}).status_code,200)
        for who in (1,2):
            self.assertEqual(self.clients[who].post('/api/group-invites/'+self.token+'/accept',json={'share_total':True}).status_code,200)
        self.root='/api/groups/'+self.gid+'/challenges'
        self.body={'id':str(uuid.uuid4()),'title':'Fictional trail sessions','goal_type':'sessions',
                   'goal_target':3,'goal_unit':'sessions','goal_sports':['run'],
                   'goal_start_date':'2030-03-01','event_date':'2030-03-20','time_zone':'America/New_York'}

    def create(self,who=1,**changes):
        response=self.clients[who].post(self.root,json=dict(self.body,**changes))
        self.assertEqual(response.status_code,200,response.text)
        return response.json()

    def test_member_create_retries_share_defaults_notice_and_old_new_adapters(self):
        q=self.create();self.create()
        self.assertTrue(q['share_total']);self.assertNotIn('total',q,'master OFF overrides challenge ON')
        self.assertTrue(all('value' not in m for m in q['members']))
        path=self.root+'/'+q['id']
        self.assertEqual(self.clients[0].post(path+'/sharing',json={'share_total':False}).status_code,200)
        self.create()  # retry never resets an independently changed choice or sends a second notice
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_updates WHERE group_id=%s',(self.gid,)).fetchone()['n'],1)
            updates=c.execute('SELECT text FROM group_updates WHERE group_id=%s',(self.gid,)).fetchone()['text']
            self.assertIn('Sharing is on unless you turned it off for this group',updates)
            self.assertEqual(c.execute('SELECT user_id FROM notifications WHERE group_id=%s ORDER BY user_id',
                                      (self.gid,)).fetchall(),[{'user_id':self.ids[i]} for i in (0,2)])
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)',(self.ids,))
        self.assertEqual(self.clients[0].post('/api/groups/'+self.gid+'/sharing',json={'level':'total_shared'}).status_code,200)
        self.assertFalse(self.clients[0].get(path).json()['share_total'],'old switch affects seeded goal only')
        seed=next(r for r in self.clients[0].get(self.root).json() if r['id']!=q['id'])
        seedpath=self.root+'/'+seed['id']
        self.assertEqual(self.clients[0].post(seedpath+'/sharing',json={'share_total':False}).status_code,200)
        self.assertEqual(self.clients[0].get('/api/groups/'+self.gid).json()['sharing_level'],'just_in')
        edit={k:v for k,v in self.body.items() if k!='id'};edit['goal_target']=4
        self.assertEqual(self.clients[0].put(seedpath,json=edit).status_code,200)
        self.assertEqual(self.clients[0].get('/api/groups/'+self.gid).json()['goal_target'],4)
        self.assertEqual(self.accept(self.token,3).status_code,200)
        self.assertFalse(self.clients[3].get(path).json()['share_total'],'explicit join OFF applies to newly created independent challenge memberships')

    def test_creator_or_current_organizer_manages_but_not_another_member(self):
        q=self.create();path=self.root+'/'+q['id'];edit={k:v for k,v in self.body.items() if k!='id'}
        self.assertEqual(self.clients[2].put(path,json=edit).status_code,404)
        self.assertEqual(self.clients[2].post(path+'/end').status_code,404)
        self.assertEqual(self.clients[0].put(path,json=edit).status_code,200)
        login=self.clients[2].get('/api/me').json()['login']
        self.assertEqual(self.clients[0].post('/api/groups/'+self.gid+'/transfer',json={'username':login}).status_code,200)
        self.assertEqual(self.clients[0].put(path,json=edit).status_code,404)
        self.assertEqual(self.clients[1].put(path,json=edit).status_code,200)
        self.assertEqual(self.clients[2].post(path+'/end').status_code,200)
        ended=self.clients[1].get(path).json()['ended_at']
        self.assertEqual(self.clients[1].post(path+'/end').status_code,200)
        self.assertEqual(self.clients[1].get(path).json()['ended_at'],ended)
        self.assertEqual(self.clients[1].put(path,json=edit).status_code,409)
        self.assertFalse(self.clients[1].get('/api/groups/'+self.gid).json()['closed'])

    def test_new_challenge_keeps_join_off_and_notifies_members_who_share(self):
        self.assertEqual(self.accept(self.token,3).status_code,200)  # Explicit OFF, with no existing independent choice.
        q=self.create();path=self.root+'/'+q['id']
        self.assertFalse(self.clients[3].get(path).json()['share_total'])
        with db.connect() as c:
            rows=c.execute('SELECT user_id,share_total FROM group_challenge_members WHERE challenge_id=%s',(q['id'],)).fetchall()
            self.assertEqual({r['user_id']:r['share_total'] for r in rows},{uid:i!=3 for i,uid in enumerate(self.ids)})
            notices=c.execute("SELECT user_id FROM notifications WHERE group_id=%s AND kind='group_update'",(self.gid,)).fetchall()
            self.assertTrue({self.ids[0],self.ids[2]} <= {r['user_id'] for r in notices})
            text=c.execute('SELECT text FROM group_updates WHERE group_id=%s',(self.gid,)).fetchone()['text']
            self.assertIn('unless you turned it off for this group',text)

    def test_new_challenge_keeps_legacy_and_seeded_off_without_changing_existing_choices(self):
        existing=self.create(id=str(uuid.uuid4()))
        seed=next(q for q in self.clients[0].get(self.root).json() if q['legacy_goal'])
        self.assertEqual(self.clients[0].post('/api/groups/'+self.gid+'/sharing',json={'level':'just_in'}).status_code,200)
        self.assertEqual(self.clients[2].post(self.root+'/'+seed['id']+'/sharing',json={'share_total':False}).status_code,200)
        with db.connect() as c:
            # A stale legacy ON cannot override the independently saved seeded OFF.
            c.execute("UPDATE group_members SET sharing_level='total_shared' WHERE group_id=%s AND user_id=%s",(self.gid,self.ids[2]))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)',(self.ids,))
        for who in (0,1,2):self.activity(who,self.now-dt.timedelta(hours=1),sport='run')
        q=self.create();path=self.root+'/'+q['id']
        for who in (0,2):
            self.assertFalse(self.clients[who].get(path).json()['share_total'])
            self.assertTrue(self.clients[who].get(self.root+'/'+existing['id']).json()['share_total'])
        self.assertTrue(q['share_total']);self.assertEqual(q['total'],1,'both opt-outs exclude totals despite master ON')
        self.assertEqual(self.clients[0].post('/api/groups/'+self.gid+'/sharing',json={'level':'total_shared'}).status_code,200)
        self.create()  # Later group changes and retries cannot reset this challenge's choice.
        self.assertFalse(self.clients[0].get(path).json()['share_total'])

    def test_combined_list_is_opt_in_scoped_and_reuses_sharing(self):
        q=self.create()
        self.assertEqual(self.clients[0].get('/api/challenges').json(),[],'old clients keep the old response')
        url='/api/challenges?include_groups=true'
        def rows(who=0):return self.clients[who].get(url).json()
        own=next(r for r in rows() if r['id']==q['id'])
        self.assertEqual(own['group_name'],self.group['title']);self.assertIsNone(own['group_total'])
        self.assertEqual(rows(3),[],'non-members cannot enumerate group challenges')
        with db.connect() as c:c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)',(self.ids,))
        self.activity(0,self.now-dt.timedelta(hours=1),sport='run')
        self.assertEqual(next(r for r in rows() if r['id']==q['id'])['group_total'],1)
        self.assertEqual(next(r for r in rows() if r['id']==q['id'])['self']['value'],1)
        self.assertNotIn('members',own);self.assertNotIn('note',own)
        # Creator block/unavailability and the viewer's own availability use the detail gates.
        with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[0],self.ids[1]))
        self.assertFalse(any(r['id']==q['id'] for r in rows()))
        with db.connect() as c:
            c.execute('DELETE FROM blocks WHERE user_id=%s',(self.ids[0],))
            c.execute('UPDATE users SET suspended_at=now() WHERE id=%s',(self.ids[1],))
        self.assertFalse(any(r['id']==q['id'] for r in rows()))
        with db.connect() as c:c.execute('UPDATE users SET needs_email_confirm=true WHERE id=%s',(self.ids[0],))
        self.assertFalse(any(r.get('group_id')==self.gid for r in rows()))

    def test_combined_dates_open_ended_and_ended_use_challenge_local_day(self):
        url='/api/challenges?include_groups=true'
        q=self.create(event_date=None)
        row=next(r for r in self.clients[0].get(url).json() if r['id']==q['id'])
        self.assertIsNone(row['end']);self.assertFalse(row['self']['finished']);self.assertIsNone(row['self']['days_left'])
        with patch('app.groups._now',return_value=dt.datetime(2030,3,21,3,59,tzinfo=dt.timezone.utc)):
            dated=self.create(id=str(uuid.uuid4()))
            row=next(r for r in self.clients[0].get(url).json() if r['id']==dated['id'])
            self.assertFalse(row['self']['finished']);self.assertEqual(row['self']['days_left'],0)
        with db.connect() as c:c.execute("UPDATE event_groups SET time_zone='Asia/Tokyo' WHERE id=%s",(self.gid,))
        with patch('app.groups._now',return_value=dt.datetime(2030,3,21,3,59,tzinfo=dt.timezone.utc)):
            self.assertFalse(next(r for r in self.clients[0].get(url).json() if r['id']==dated['id'])['self']['finished'])
        with patch('app.groups._now',return_value=dt.datetime(2030,3,21,4,0,tzinfo=dt.timezone.utc)):
            self.assertTrue(next(r for r in self.clients[0].get(url).json() if r['id']==dated['id'])['self']['finished'])
        self.clients[1].post(self.root+'/'+q['id']+'/end')
        self.assertTrue(next(r for r in self.clients[0].get(url).json() if r['id']==q['id'])['self']['finished'])

    def test_outsiders_other_group_left_removed_unconfirmed_suspended_and_blocks(self):
        q=self.create();path=self.root+'/'+q['id']
        for method,route,body in [('get',path,None),('post',path+'/sharing',{'share_total':True}),
                                  ('post',self.root,self.body),('post',path+'/end',None)]:
            kwargs={} if body is None else {'json':body}
            self.assertEqual(getattr(self.clients[3],method)(route,**kwargs).status_code,404)
        other,_=self.make(who=3)
        self.assertEqual(self.clients[3].get('/api/groups/'+other['id']+'/challenges/'+q['id']).status_code,404)
        for uid in (self.ids[1],self.ids[2]):
            for column,value in [('suspended_at',self.now),('needs_email_confirm',True),('password_change_expires',self.now)]:
                with db.connect() as c:c.execute(sql.SQL('UPDATE users SET {}=%s WHERE id=%s').format(sql.Identifier(column)),(value,uid))
                self.assertNotEqual(self.clients[2].get(path).status_code,200)
                self.assertNotEqual(self.clients[2].post(path+'/sharing',json={'share_total':True}).status_code,200)
                with db.connect() as c:c.execute(sql.SQL('UPDATE users SET {}=%s WHERE id=%s').format(sql.Identifier(column)),(False if column=='needs_email_confirm' else None,uid))
        for first,second in [(1,2),(2,1)]:
            with db.connect() as c:c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.ids[first],self.ids[second]))
            self.assertEqual(self.clients[2].get(path).status_code,404)
            self.assertNotIn(q['id'],[r['id'] for r in self.clients[2].get(self.root).json()])
            with db.connect() as c:c.execute('DELETE FROM blocks WHERE user_id=%s',(self.ids[first],))
        for status in ('left','removed'):
            with db.connect() as c:c.execute('UPDATE group_members SET status=%s,removed_invite_generation=%s WHERE group_id=%s AND user_id=%s',
                (status,1 if status=='removed' else None,self.gid,self.ids[2]))
            self.assertEqual(self.clients[2].get(path).status_code,404)

    def test_totals_respect_independent_master_and_private_gates_and_end_time(self):
        q=self.create();path=self.root+'/'+q['id']
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at='2030-03-01T05:00Z' WHERE group_id=%s",(self.gid,))
            c.execute('UPDATE profile SET share_achievements=true WHERE user_id=ANY(%s)',(self.ids[:2],))
        for who in (0,1,2):self.activity(who,self.now-dt.timedelta(hours=1),sport='run',name='PRIVATE SOURCE SENTINEL')
        self.activity(0,self.now-dt.timedelta(hours=2),sport='run',visibility='me')
        view=self.clients[0].get(path).json();self.assertEqual(view['total'],2)
        self.assertNotIn('PRIVATE SOURCE SENTINEL',json.dumps(view))
        self.assertEqual(self.clients[0].post(path+'/sharing',json={'share_total':False}).status_code,200)
        view=self.clients[0].get(path).json();self.assertEqual(view['total'],1);self.assertEqual(view['your_total'],1)
        self.assertEqual(self.clients[1].post(path+'/end').status_code,200)
        self.activity(1,self.now+dt.timedelta(hours=1),sport='run')
        with patch('app.groups._now',return_value=self.now+dt.timedelta(days=1)):
            self.assertEqual(self.clients[1].get(path).json()['total'],1)

    def test_both_dst_days_inclusive_endpoints_rejoin_and_fractional_serialization(self):
        for day,lo,hi in [('2030-03-10','2030-03-10T05:00Z','2030-03-11T04:00Z'),
                          ('2030-11-03','2030-11-03T04:00Z','2030-11-04T05:00Z')]:
            a,z=dt.datetime.fromisoformat(lo),dt.datetime.fromisoformat(hi)
            with patch('app.groups._now',return_value=a):
                q=self.create(id=str(uuid.uuid4()),goal_type='distance',goal_target=0.1,goal_unit='km',
                              goal_start_date=day,event_date=day)
            with db.connect() as c:
                c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s',(a,self.gid))
                c.execute('UPDATE profile SET share_achievements=true WHERE user_id=%s',(self.ids[0],))
            for at in (a-dt.timedelta(seconds=1),a,z-dt.timedelta(seconds=1),z):
                self.activity(0,at,sport='run',distance=100)
            with patch('app.groups._now',return_value=z+dt.timedelta(hours=1)):
                view=self.clients[0].get(self.root+'/'+q['id']).json()
                self.assertEqual(view['total'],0.2);self.assertEqual(view['target'],0.1)
                with db.connect() as c:c.execute('UPDATE group_members SET joined_at=%s WHERE group_id=%s AND user_id=%s',
                                                (z-dt.timedelta(seconds=1),self.gid,self.ids[0]))
                self.assertEqual(self.clients[0].get(self.root+'/'+q['id']).json()['total'],0.1)

    def test_duplicate_key_validation_mute_and_concurrent_retry(self):
        with db.connect() as c:c.execute('UPDATE group_members SET notifications_muted=true WHERE group_id=%s AND user_id=%s',(self.gid,self.ids[2]))
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses=list(pool.map(lambda _:self.clients[1].post(self.root,json=self.body),range(2)))
        self.assertEqual([r.status_code for r in responses],[200,200])
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_updates WHERE group_id=%s',(self.gid,)).fetchone()['n'],1)
            self.assertEqual(c.execute('SELECT user_id FROM notifications WHERE group_id=%s',(self.gid,)).fetchall(),[{'user_id':self.ids[0]}])
        self.assertEqual(self.clients[1].post(self.root,json=dict(self.body,title='Reused key')).status_code,409)
        for changes in [{'goal_target':0},{'goal_target':1.2},{'goal_unit':'km'},{'goal_sports':['bad']},
                        {'goal_start_date':'2030-03-21'},{'event_date':'2030-03-09'},{'title':' '},{'user_id':self.ids[0]}]:
            self.assertIn(self.clients[1].post(self.root,json=dict(self.body,id=str(uuid.uuid4()),**changes)).status_code,(400,422))
        self.assertEqual(self.clients[1].post(self.root+'/'+self.body['id']+'/sharing',json={'share_total':'true'}).status_code,422)

    def test_closed_group_still_allows_privacy_revocation_but_not_more_challenges(self):
        q=self.create();path=self.root+'/'+q['id']
        self.assertEqual(self.clients[0].post('/api/groups/'+self.gid+'/close').status_code,200)
        self.assertEqual(self.clients[1].post(path+'/sharing',json={'share_total':False}).status_code,200)
        self.assertFalse(self.clients[1].get(path).json()['share_total'])
        self.assertEqual(self.clients[1].post(self.root,json=dict(self.body,id=str(uuid.uuid4()))).status_code,409)
        self.assertEqual(self.clients[1].put(path,json={k:v for k,v in self.body.items() if k!='id'}).status_code,409)

    def test_creation_limits_and_cross_group_key_collision_are_atomic(self):
        self.create();other,_=self.make(who=3)
        self.assertEqual(self.clients[3].post('/api/groups/'+other['id']+'/challenges',json=self.body).status_code,409)
        with db.connect() as c:
            c.execute('UPDATE users SET signup_confirmed_at=now() WHERE id=%s',(self.ids[1],))
            for _ in range(20):self.assertFalse(groups.account_email.limited(c,f'new-social:comment:{self.ids[1]}',20,1440))
        response=self.clients[1].post(self.root,json=dict(self.body,id=str(uuid.uuid4())))
        self.assertEqual(response.status_code,429)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM group_challenges WHERE group_id=%s',(self.gid,)).fetchone()['n'],2)
            c.execute('UPDATE users SET signup_confirmed_at=NULL WHERE id=%s',(self.ids[1],))
            c.execute('''INSERT INTO group_challenges(group_id,creator_id,title,metric,target,unit,sports,start_date,time_zone)
                SELECT %s,%s,'Fictional bounded goal','sessions',3,'sessions',ARRAY['run'],'2030-03-01','UTC'
                FROM generate_series(1,98)''',(self.gid,self.ids[1]))
        self.assertEqual(self.clients[1].post(self.root,json=dict(self.body,id=str(uuid.uuid4()))).status_code,409)
        self.create()  # An existing retry still works at the limit.

    def test_name_only_group_stays_without_challenges_through_both_join_paths(self):
        response=self.clients[0].post('/api/groups/people',json={'title':'Fictional people crew','time_zone':'UTC'})
        self.assertEqual(response.status_code,200,response.text)
        group=response.json();root='/api/groups/'+group['id'];token=group['invite_url'].rsplit('/',1)[1]
        self.assertEqual(self.clients[0].get(root+'/challenges').json(),[])
        self.assertNotEqual(self.clients[0].get('/api/groups/activity-strip').json().get('next',{}).get('id'),group['id'])
        self.assertEqual(self.clients[0].post('/api/groups/people',json={'title':' ','time_zone':'UTC'}).status_code,422)
        self.assertEqual(self.accept(token,1).status_code,200)
        self.friend(0,2)
        username=self.clients[2].get('/api/me').json()['login']
        self.assertEqual(self.clients[0].post(root+'/friend-invites',json={'username':username}).status_code,200)
        with db.connect() as c:
            iid=c.execute("UPDATE group_friend_invites SET expires_at='2030-04-09T16:00Z' WHERE group_id=%s RETURNING id",(group['id'],)).fetchone()['id']
        self.assertEqual(self.clients[2].post(f'/api/group-friend-invites/{iid}/accept',json={'share_total':True}).status_code,200)
        self.assertEqual(self.clients[2].get(root+'/challenges').json(),[])
        created=self.clients[2].post(root+'/challenges',json=self.body)
        self.assertEqual(created.status_code,200)
        for who,expected in [(0,True),(1,False),(2,True)]:
            self.assertEqual(self.clients[who].get(root+'/challenges/'+created.json()['id']).json()['share_total'],expected)
        self.assertNotEqual(self.clients[2].get('/api/groups/activity-strip').json().get('next',{}).get('id'),group['id'])

    def test_ending_seeded_goal_freezes_old_client_without_closing_group(self):
        seed=next(q for q in self.clients[0].get(self.root).json() if q['legacy_goal'])
        path=self.root+'/'+seed['id']
        with db.connect() as c:
            c.execute("UPDATE group_members SET joined_at='2030-03-01T05:00Z' WHERE group_id=%s",(self.gid,))
        self.activity(0,self.now-dt.timedelta(hours=1),sport='run')
        before=self.clients[0].get('/api/groups/'+self.gid).json()['your_total']
        self.assertEqual(self.clients[0].post(path+'/end').status_code,200)
        self.activity(0,self.now+dt.timedelta(hours=1),sport='run')
        with patch('app.groups._now',return_value=self.now+dt.timedelta(days=1)):
            old=self.clients[0].get('/api/groups/'+self.gid).json()
            self.assertEqual(old['your_total'],before)
            self.assertEqual(old['event_state'],'complete');self.assertFalse(old['closed'])
            self.assertEqual(self.clients[0].get(path).json()['your_total'],before)
            self.assertFalse(self.clients[0].get('/api/groups/activity-strip').json()['has_upcoming'])


unittest.main()
