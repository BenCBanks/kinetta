"""Fictional PostgreSQL/HTTP member limits. No provider, email or phone delivery."""
import concurrent.futures
import datetime as dt
import importlib
import threading
import tempfile
import zipfile
from pathlib import Path
import unittest
import uuid
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg.conninfo import make_conninfo
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import auth, db, member_limits as M, notify, api_mydata, api_achievements
from app.main import app


class MemberLimits(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = auth.hash_pw('fictional member limits password')

    def setUp(self):
        self.ids = []
        self.addCleanup(self.clean)
        # A noop, rather than an outbound client, lets the normal scheduling call run.
        self.push = patch.object(notify, '_push_later', return_value=None)
        self.push.start(); self.addCleanup(self.push.stop)
        self.clients = []
        self.actor, self.uid = self.member('actor')
        self.owner, self.oid = self.member('owner')
        self.other, self.tid = self.member('other')
        with db.connect() as c:
            self.aid = c.execute("""INSERT INTO activities(user_id,sport,name,start_time,source,visibility)
                VALUES(%s,'running','Fictional run',now()-interval '1 day','manual','everyone') RETURNING id""", (self.oid,)).fetchone()['id']

    def clean(self):
        for client in self.clients: client.close()
        with db.connect() as c: c.execute('DELETE FROM users WHERE id=ANY(%s)', (self.ids,))

    def member(self, label):
        login = 'zz_test_limits_' + label + '_' + uuid.uuid4().hex[:8]
        with db.connect() as c:
            uid = c.execute('''INSERT INTO users(login,name,pw_hash,email,email_verified_at)
                VALUES(%s,'Fictional Member',%s,%s,now()) RETURNING id''',
                            (login, self.password, login + '@example.test')).fetchone()['id']
            self.ids.append(uid)
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (uid,))
            token = auth.new_session(c, uid, 'fictional member limits fixture')
        client = TestClient(app); client.headers.update({'Origin':'http://testserver','Content-Type':'application/json'})
        client.cookies.set(auth.COOKIE, token); self.clients.append(client)
        return client, uid

    def events(self, kind):
        with db.connect() as c:
            return c.execute('SELECT * FROM member_action_events WHERE user_id=%s AND kind=%s ORDER BY id', (self.uid, kind)).fetchall()

    def seed(self, kind, count, *, age=0, recipient=None):
        with db.connect() as c:
            c.execute('''INSERT INTO member_action_events(user_id,kind,target_hash,payload_hash,recipient_id,created)
                SELECT %s,%s,%s,%s,%s,now()-make_interval(secs=>%s) FROM generate_series(1,%s)''',
                      (self.uid, kind, M.digest('fixture'), M.digest(None), recipient, age, count))

    def comment(self, text, key=None):
        return self.actor.post(f'/api/activities/{self.aid}/comments', json={'text': text, **({'client_id': str(key)} if key else {})})

    def group(self):
        with db.connect() as c:
            gid=c.execute('''INSERT INTO event_groups(organizer_id,title,time_zone,goal_type,goal_target,goal_unit,goal_sports,goal_start_date)
                VALUES(%s,'Fictional crew','UTC','distance',10,'km',ARRAY['run'],current_date) RETURNING id''',(self.uid,)).fetchone()['id']
            for uid in (self.uid,self.oid):
                c.execute('INSERT INTO group_members(group_id,user_id,sharing_level) VALUES(%s,%s,\'total_shared\')',(gid,uid))
        return str(gid)

    def test_group_creation_replay_day_budget_and_active_cap(self):
        body={'id':str(uuid.uuid4()),'title':'Fictional crew','time_zone':'UTC'}
        one=self.actor.post('/api/groups/people',json=body)
        self.assertEqual(one.status_code,200,one.text)
        self.assertEqual(self.actor.post('/api/groups/people',json=body).json()['id'],one.json()['id'])
        self.assertEqual(len(self.events('group')),1)
        for _ in range(4):self.assertEqual(self.actor.post('/api/groups/people',json={**body,'id':str(uuid.uuid4())}).status_code,200)
        self.assertEqual(self.actor.post('/api/groups/people',json={**body,'id':str(uuid.uuid4())}).status_code,429)
        with db.connect() as c:c.execute("UPDATE member_action_events SET created=now()-interval '2 days' WHERE user_id=%s",(self.uid,))
        for _ in range(15):self.group()
        r=self.actor.post('/api/groups/people',json={**body,'id':str(uuid.uuid4())})
        self.assertEqual(r.status_code,429);self.assertIn('20 active groups',r.text)
        self.assertEqual(self.actor.post('/api/groups/people',json=body).status_code,200,'existing create receipt precedes caps')

    def test_group_update_retry_and_shared_comment_budget(self):
        gid=self.group();base=f'/api/groups/{gid}/updates';body={'text':'A fictional update','client_id':str(uuid.uuid4())}
        one=self.actor.post(base,json=body);self.assertEqual(one.status_code,200,one.text)
        self.assertEqual(self.actor.post(base,json=body).json()['id'],one.json()['id'])
        self.assertEqual(len(self.events('comment')),1)
        for i in range(5):self.assertEqual(self.comment('Cross-surface encouragement '+str(i),uuid.uuid4()).status_code,200)
        self.assertEqual(self.actor.post(base,json={'text':'Another update','client_id':str(uuid.uuid4())}).status_code,429)
        self.assertEqual(self.actor.post(base,json=body).status_code,200,'a lost-reply retry is not budgeted twice')

    def test_directed_invitation_pair_and_total_cap_and_quiet_retry(self):
        gids=[self.group() for _ in range(4)]
        with db.connect() as c:
            login=c.execute('SELECT login FROM users WHERE id=%s',(self.tid,)).fetchone()['login']
            c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(self.uid,self.tid))
        for gid in gids[:3]:
            r=self.actor.post(f'/api/groups/{gid}/friend-invites',json={'username':login});self.assertEqual(r.status_code,200,r.text)
        r=self.actor.post(f'/api/groups/{gids[3]}/friend-invites',json={'username':login})
        self.assertEqual(r.status_code,429);self.assertEqual(len(self.events('invite')),3)
        self.assertEqual(self.actor.post(f'/api/groups/{gids[0]}/friend-invites',json={'username':login}).status_code,200)
        extra,eid=self.member('invite_peer')
        with db.connect() as c:
            peer=c.execute('SELECT login FROM users WHERE id=%s',(eid,)).fetchone()['login']
            c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(self.uid,eid))
        self.seed('invite',27)
        self.assertEqual(self.actor.post(f'/api/groups/{gids[3]}/friend-invites',json={'username':peer}).status_code,429)

    def test_group_challenge_budget_and_receipt(self):
        gid=self.group();today=dt.date.today()
        body={'id':str(uuid.uuid4()),'title':'Fictional weekly distance','time_zone':'UTC','goal_type':'distance',
              'goal_target':10,'goal_unit':'km','goal_sports':['run'],'goal_start_date':str(today),'event_date':str(today+dt.timedelta(days=28))}
        path=f'/api/groups/{gid}/challenges'
        one=self.actor.post(path,json=body);self.assertEqual(one.status_code,200,one.text)
        self.assertEqual(self.actor.post(path,json=body).json()['id'],one.json()['id'])
        self.seed('group_challenge',9)
        self.assertEqual(self.actor.post(path,json={**body,'id':str(uuid.uuid4())}).status_code,429)
        self.assertEqual(self.actor.post(path,json=body).status_code,200)

    def test_group_and_activity_reactions_share_budget_and_notice_quietness(self):
        gid=self.group();update=self.owner.post(f'/api/groups/{gid}/updates',json={'text':'Fictional meetup'});self.assertEqual(update.status_code,200,update.text)
        update_id=update.json()['id'];key=str(uuid.uuid4())
        path=f'/api/groups/{gid}/updates/{update_id}/reaction'
        self.assertEqual(self.actor.post(path,json={'kind':'clap','client_id':key}).status_code,200)
        self.assertEqual(self.actor.post(path,json={'kind':'clap','client_id':key}).status_code,200)
        self.assertEqual(len(self.events('reaction')),1)
        self.assertEqual(self.actor.post(f'/api/activities/{self.aid}/reaction',json={'kind':'fire'}).status_code,200)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM notifications WHERE actor_id=%s AND user_id=%s AND kind IN ('cheer','group_cheer')",(self.uid,self.oid)).fetchone()['n'],1)
        self.seed('reaction',58)
        self.assertEqual(self.actor.post(f'/api/groups/{gid}/weekly-reaction',json={'kind':'clap'}).status_code,429)
        self.assertEqual(self.actor.post(path,json={'kind':'clap','client_id':key}).status_code,200)

    def test_native_origin_can_read_retry_after_without_widening_cors(self):
        self.seed('search',30)
        response=self.actor.get('/api/people/search?q=Fictional',headers={'Origin':'capacitor://localhost'})
        self.assertEqual(response.status_code,429)
        self.assertEqual(response.headers['Access-Control-Allow-Origin'],'capacitor://localhost')
        self.assertIn('retry-after',response.headers['Access-Control-Expose-Headers'].lower())
        self.assertGreater(int(response.headers['Retry-After']),0)
        foreign=self.actor.get('/api/people/search?q=Fictional',headers={'Origin':'https://fictional.example.test'})
        self.assertNotIn('Access-Control-Allow-Origin',foreign.headers)

    def test_every_approved_rolling_boundary_and_expiry(self):
        for kind, windows in M.BUDGETS.items():
            if kind == 'reaction_notice': continue
            for cap, seconds in windows:
                with self.subTest(kind=kind, cap=cap, seconds=seconds):
                    with db.connect() as c: c.execute('DELETE FROM member_action_events WHERE user_id=%s', (self.uid,))
                    # A daily cap is tested outside the shorter burst window.
                    age = 120 if seconds > 60 else 0
                    if kind == 'report' and seconds == 86400: age = 4000
                    self.seed(kind, cap-1, age=age)
                    with db.connect() as c: M.claim(c, self.uid, kind)
                    with self.assertRaises(HTTPException) as error:
                        with db.connect() as c: M.claim(c, self.uid, kind)
                    self.assertEqual(error.exception.status_code, 429)
                    self.assertGreater(int(error.exception.headers['Retry-After']), 0)
                    with db.connect() as c:
                        c.execute("UPDATE member_action_events SET created=now()-interval '2 days' WHERE user_id=%s", (self.uid,))
                        M.claim(c, self.uid, kind)

    def test_comment_retry_duplicate_delete_and_block_do_not_refund_or_reveal(self):
        key = uuid.uuid4()
        self.assertEqual(self.comment('Nice fictional run', key).status_code, 200)
        self.assertEqual(self.comment('Nice fictional run', key).status_code, 200)
        self.assertEqual(self.comment('Nice fictional run', uuid.uuid4()).status_code, 200)
        self.assertEqual(len(self.events('comment')), 1)
        self.assertEqual(self.comment('Different words', key).status_code, 409)
        with db.connect() as c:
            cid = c.execute('SELECT id FROM comments WHERE user_id=%s', (self.uid,)).fetchone()['id']
        self.assertEqual(self.actor.delete(f'/api/comments/{cid}').status_code, 200)
        self.assertEqual(self.comment('Nice fictional run', key).status_code, 200)
        with db.connect() as c: self.assertEqual(c.execute('SELECT count(*) AS n FROM comments WHERE user_id=%s', (self.uid,)).fetchone()['n'], 0)
        for i in range(5): self.assertEqual(self.comment('Fictional encouragement ' + str(i), uuid.uuid4()).status_code, 200)
        denied = self.comment('One too many', uuid.uuid4())
        self.assertEqual(denied.status_code, 429, denied.text)
        self.assertIn(denied.headers['Retry-After'] + ' seconds', denied.json()['detail'])
        # Protection is available even while the actor's comment/search budgets are full.
        with db.connect() as c: login = c.execute('SELECT login FROM users WHERE id=%s', (self.oid,)).fetchone()['login']
        self.assertEqual(self.actor.post(f'/api/people/{login}/block', json={}).status_code, 200)
        self.assertEqual(self.comment('Nice fictional run', key).status_code, 404)
        self.assertEqual(self.comment('New blocked text', uuid.uuid4()).status_code, 404)

    def test_group_update_admission_is_independent_of_private_block_and_mute(self):
        gid=self.group();path=f'/api/groups/{gid}/updates'
        for mode in ('open','muted','incoming_block','outgoing_block'):
            with self.subTest(mode=mode):
                with db.connect() as c:
                    c.execute('DELETE FROM member_action_events WHERE user_id=%s',(self.uid,))
                    c.execute('DELETE FROM blocks WHERE (user_id=%s AND blocked=%s) OR (user_id=%s AND blocked=%s)',(self.uid,self.oid,self.oid,self.uid))
                    c.execute('DELETE FROM notifications WHERE group_id=%s',(gid,))
                    c.execute('UPDATE group_members SET notifications_muted=%s WHERE group_id=%s AND user_id=%s',(mode=='muted',gid,self.oid))
                    if mode in ('incoming_block','outgoing_block'):
                        pair=(self.oid,self.uid) if mode=='incoming_block' else (self.uid,self.oid)
                        c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',pair)
                self.seed('comment_delivery',9,age=120,recipient=self.oid)
                body={'text':'Fictional update '+mode,'client_id':str(uuid.uuid4())}
                allowed=self.actor.post(path,json=body)
                self.assertEqual(allowed.status_code,200,allowed.text)
                refused=self.actor.post(path,json={'text':'Next fictional update '+mode})
                self.assertEqual(refused.status_code,429,refused.text)
                self.assertGreater(int(refused.headers['Retry-After']),3400)
                self.assertEqual(len(self.events('comment')),1,'rejected post rolls back actor admission')
                self.assertEqual([r['recipient_id'] for r in self.events('comment_delivery')],[self.oid]*10)
                self.assertEqual(self.actor.post(path,json=body).status_code,200,'committed replay stays free')
                self.assertEqual(len(self.events('comment_delivery')),10,'replay never charges again')
                with db.connect() as c:
                    delivered=c.execute("SELECT count(*) AS n FROM notifications WHERE group_id=%s AND user_id=%s AND kind='group_update'",(gid,self.oid)).fetchone()['n']
                    self.assertEqual(delivered,1 if mode=='open' else 0,'delivery alone follows private block/mute state')

    def test_comment_admission_uses_owner_not_delivery_preferences(self):
        for push_enabled in (True,False):
            with self.subTest(push_enabled=push_enabled):
                with db.connect() as c:
                    c.execute('DELETE FROM member_action_events WHERE user_id=%s',(self.uid,))
                    c.execute('UPDATE profile SET notify=%s WHERE user_id=%s',(Jsonb({'comments':push_enabled}),self.oid))
                self.seed('comment_delivery',9,age=120,recipient=self.oid)
                self.assertEqual(self.comment('Fictional cross-surface comment '+str(push_enabled),uuid.uuid4()).status_code,200)
                denied=self.comment('Next fictional comment '+str(push_enabled),uuid.uuid4())
                self.assertEqual(denied.status_code,429,denied.text)
                self.assertEqual(len(self.events('comment')),1)
        for first,second in ((self.uid,self.oid),(self.oid,self.uid)):
            with db.connect() as c:
                c.execute('DELETE FROM blocks WHERE user_id=ANY(%s)',([self.uid,self.oid],))
                c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(first,second))
            for full in (False,True):
                with db.connect() as c:c.execute('DELETE FROM member_action_events WHERE user_id=%s',(self.uid,))
                if full:self.seed('comment',10,age=120,recipient=self.oid)
                missing=self.comment('Hidden activity comment',uuid.uuid4())
                self.assertEqual(missing.status_code,404,'invisible target stays missing before budget admission')
                self.assertNotIn('Retry-After',missing.headers)
                self.assertEqual(len(self.events('comment')),10 if full else 0)

    def test_invitation_admission_uses_explicit_target_not_notification_delivery(self):
        gid=self.group();path=f'/api/groups/{gid}/friend-invites'
        with db.connect() as c:
            login=c.execute('SELECT login FROM users WHERE id=%s',(self.tid,)).fetchone()['login']
            c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(self.uid,self.tid))
        for push_enabled in (True,False):
            with self.subTest(push_enabled=push_enabled):
                with db.connect() as c:
                    c.execute('DELETE FROM group_friend_invites WHERE group_id=%s',(gid,))
                    c.execute('DELETE FROM member_action_events WHERE user_id=%s',(self.uid,))
                    c.execute('UPDATE profile SET notify=%s WHERE user_id=%s',(Jsonb({'friends':push_enabled}),self.tid))
                self.seed('invite',2,age=120,recipient=self.tid)
                sent=self.actor.post(path,json={'username':login})
                self.assertEqual(sent.status_code,200,sent.text)
                self.assertEqual(self.actor.post(path,json={'username':login}).status_code,200,'pending retry is unchanged')
                self.assertEqual(len(self.events('invite')),3)
                with db.connect() as c:c.execute('DELETE FROM group_friend_invites WHERE group_id=%s',(gid,))
                denied=self.actor.post(path,json={'username':login})
                self.assertEqual(denied.status_code,429,denied.text)
                self.assertEqual(len(self.events('invite')),3)
        for pair in ((self.uid,self.tid),(self.tid,self.uid),(self.oid,self.tid),(self.tid,self.oid)):
            with db.connect() as c:
                c.execute('DELETE FROM blocks WHERE user_id=ANY(%s)',(self.ids,))
                c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',pair)
            for full in (False,True):
                with db.connect() as c:c.execute('DELETE FROM member_action_events WHERE user_id=%s',(self.uid,))
                if full:self.seed('invite',3,age=120,recipient=self.tid)
                missing=self.actor.post(path,json={'username':login})
                self.assertEqual(missing.status_code,404,'unavailable invitation target stays missing before budget admission')
                self.assertNotIn('Retry-After',missing.headers)
                self.assertEqual(len(self.events('invite')),3 if full else 0)

    def test_pair_comment_cap_crosses_targets_and_group_updates(self):
        self.seed('comment', 9, age=120, recipient=self.oid)
        with db.connect() as c:
            M.comment_recipients(c, self.uid, [self.oid, self.tid])
        self.assertEqual(self.comment('Across activities', uuid.uuid4()).status_code, 429)
        with db.connect() as c: M.claim(c, self.uid, 'comment', 'other-target', recipient=self.tid)

    def test_rollback_and_persisted_retry_after_module_reload(self):
        key = uuid.uuid4()
        with self.assertRaises(RuntimeError):
            with db.connect() as c:
                claim = M.claim(c, self.uid, 'friend', self.oid, request_key=key)
                M.finish(c, claim, self.oid)
                raise RuntimeError('Fictional write failed')
        self.assertEqual(self.events('friend'), [])
        with db.connect() as c:
            claim = M.claim(c, self.uid, 'friend', self.oid, request_key=key); M.finish(c, claim, self.oid)
        importlib.reload(M)
        with db.connect() as c:
            saved = M.claim(c, self.uid, 'friend', self.oid, request_key=key)
            self.assertTrue(saved['replayed']); self.assertEqual(saved['result'], str(self.oid))
        self.assertEqual(len(self.events('friend')), 1)
        with self.assertRaises(HTTPException) as error:
            with db.connect() as c: M.claim(c, self.uid, 'reaction', self.oid, request_key=key)
        self.assertEqual(error.exception.status_code, 409)

    def test_concurrent_last_slot_never_overshoots_and_busy_has_no_write(self):
        self.seed('comment', 5)
        barrier = threading.Barrier(8)
        def attempt(i):
            barrier.wait()
            try:
                with db.connect() as c: M.claim(c, self.uid, 'comment', str(i))
                return 200
            except HTTPException as error: return error.status_code
        with concurrent.futures.ThreadPoolExecutor(8) as pool: replies = list(pool.map(attempt, range(8)))
        self.assertTrue(all(x in (200, 429, 503) for x in replies), replies)
        self.assertLessEqual(replies.count(200), 1)
        self.assertLessEqual(len(self.events('comment')), 6)
        with db.connect() as held:
            M.lock(held, self.uid)
            with concurrent.futures.ThreadPoolExecutor(1) as pool:
                self.assertEqual(pool.submit(lambda: self.comment('held source', uuid.uuid4()).status_code).result(2), 503)

    def test_public_card_requests_share_friend_budget_and_cooldown(self):
        from app import cards
        with db.connect() as c:
            code=cards.own(c,self.oid)['code']
            login=c.execute('SELECT login FROM users WHERE id=%s',(self.oid,)).fetchone()['login']
        path='/api/cards/'+code+'/request'
        self.assertEqual(self.actor.post(path,json={}).status_code,200)
        self.assertEqual(self.actor.post(path,json={}).status_code,200)
        self.assertEqual(len(self.events('friend')),1)
        self.assertEqual(self.actor.delete('/api/friends/'+login).status_code,200)
        self.assertEqual(self.actor.post(path,json={}).status_code,429)
        with db.connect() as c:c.execute("UPDATE member_pair_cooldowns SET expires=now()-interval '1 second' WHERE user_id=%s",(self.uid,))
        self.seed('friend',4)
        self.assertEqual(self.actor.post(path,json={}).status_code,429)
        with db.connect() as c:self.assertFalse(c.execute('SELECT 1 FROM friendships WHERE requester=%s AND addressee=%s',(self.uid,self.oid)).fetchone())

    def test_friend_cancel_and_decline_cooldowns_survive_row_deletion(self):
        def login(uid):
            with db.connect() as c: return c.execute('SELECT login FROM users WHERE id=%s', (uid,)).fetchone()['login']
        target, actor = login(self.oid), login(self.uid)
        key = str(uuid.uuid4())
        self.assertEqual(self.actor.post('/api/friends', json={'login': target, 'client_id': key}).status_code, 200)
        self.assertEqual(self.actor.post('/api/friends', json={'login': target, 'client_id': key}).status_code, 200)
        self.assertEqual(len(self.events('friend')), 1)
        self.assertEqual(self.actor.delete('/api/friends/' + target).status_code, 200)
        r = self.actor.post('/api/friends', json={'login': target})
        self.assertEqual(r.status_code, 429, r.text); self.assertGreater(int(r.headers['Retry-After']), 86000)
        with db.connect() as c: c.execute("UPDATE member_pair_cooldowns SET expires=now()-interval '1 second' WHERE user_id=%s", (self.uid,))
        self.assertEqual(self.actor.post('/api/friends', json={'login': target}).status_code, 200)
        self.assertEqual(self.owner.post('/api/friends/' + actor + '/decline', json={}).status_code, 200)
        r = self.actor.post('/api/friends', json={'login': target})
        self.assertEqual(r.status_code, 429); self.assertGreater(int(r.headers['Retry-After']), 604000)
        self.assertEqual(len(self.events('friend')), 2)

    def test_reaction_rate_is_shared_and_notices_are_cross_target_quiet(self):
        with db.connect() as c:
            second = c.execute("""INSERT INTO activities(user_id,sport,name,start_time,source,visibility)
                VALUES(%s,'running','Another fictional run',now()-interval '2 days','manual','everyone') RETURNING id""", (self.oid,)).fetchone()['id']
        for aid in (self.aid, second):
            r = self.actor.post(f'/api/activities/{aid}/reaction', json={'kind': 'clap', 'client_id': str(uuid.uuid4())})
            self.assertEqual(r.status_code, 200, r.text)
        with db.connect() as c:
            self.assertEqual(c.execute("SELECT count(*) AS n FROM notifications WHERE actor_id=%s AND user_id=%s AND kind='cheer'", (self.uid, self.oid)).fetchone()['n'], 1)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM cheers WHERE user_id=%s', (self.uid,)).fetchone()['n'], 2)
        self.seed('reaction', 58)
        r = self.actor.delete(f'/api/activities/{self.aid}/reaction')
        self.assertEqual(r.status_code, 200, r.text)
        with db.connect() as c: self.assertIsNone(c.execute('SELECT 1 FROM cheers WHERE activity_id=%s AND user_id=%s', (self.aid,self.uid)).fetchone())
        self.assertEqual(len(self.events('reaction')),60,'removal neither charges nor refunds writes')

    def test_search_does_not_store_text_and_report_dedup_returns_original_receipt(self):
        self.assertEqual(self.actor.get('/api/people/search?q=unusualfictionalsearch').status_code, 200)
        self.assertNotIn('unusualfictionalsearch', str(self.events('search')))
        with db.connect() as c: owner = c.execute('SELECT login FROM users WHERE id=%s', (self.oid,)).fetchone()['login']
        key = str(uuid.uuid4()); body = {'login': owner, 'reason': 'spam', 'client_id': key}
        one = self.actor.post('/api/reports', json=body); two = self.actor.post('/api/reports', json={**body,'client_id':str(uuid.uuid4()),'reason':'abuse'})
        self.assertEqual(one.status_code, 200, one.text); self.assertEqual(two.json()['id'], one.json()['id'])
        self.assertEqual(len(self.events('report')), 1)
        with db.connect() as c: c.execute("UPDATE reports SET status='done' WHERE id=%s", (one.json()['id'],))
        self.assertEqual(self.actor.post('/api/reports', json=body).json()['id'], one.json()['id'])
        self.assertEqual(len(self.events('report')), 1)

    def reaction_paths(self):
        gid=self.group()
        update=self.owner.post(f'/api/groups/{gid}/updates',json={'text':'Fictional group run'})
        self.assertEqual(update.status_code,200,update.text)
        now=dt.datetime.now(dt.timezone.utc);week=now.date()-dt.timedelta(days=now.weekday())
        levels=api_achievements._level_catalog()['tracks']['journey']['levels']
        rank,level=next((i,l) for i,l in enumerate(levels,1) if l['name']=='Across the US')
        with db.connect() as c:
            login=c.execute('SELECT login FROM users WHERE id=%s',(self.oid,)).fetchone()['login']
            c.execute("INSERT INTO friendships(requester,addressee,status,accepted) VALUES(%s,%s,'accepted',now())",(self.uid,self.oid))
            c.execute("UPDATE profile SET share_achievements=true,share_achievements_since=now()-interval '1 day' WHERE user_id=%s",(self.oid,))
            c.execute("""INSERT INTO milestones(user_id,code,kind,title,rank,day,occurred,details)
                VALUES(%s,'test:member-moment','track',%s,%s,%s,%s,%s)""",
                (self.oid,level['name'],rank,now.date(),now,Jsonb({'track':'journey','big':True,'threshold':api_achievements._canonical_threshold(level)})))
        return [f'/api/activities/{self.aid}/reaction',f'/api/groups/{gid}/updates/{update.json()["id"]}/reaction',
                f'/api/groups/{gid}/weekly-reaction',f'/api/achievement-moments/{login}/{week}/reaction']

    def test_all_reaction_removals_and_unchanged_retries_bypass_exhausted_budget(self):
        paths=self.reaction_paths();keys={path:str(uuid.uuid4()) for path in paths}
        for path in paths:
            response=self.actor.post(path,json={'kind':'clap','client_id':keys[path]})
            self.assertEqual(response.status_code,200,response.text)
        self.seed('reaction',56)
        free_keys={path:str(uuid.uuid4()) for path in paths}
        for path in paths:
            with self.subTest(path=path):
                for key in (None,keys[path],free_keys[path]):
                    body={'kind':'clap',**({'client_id':key} if key else {})}
                    same=self.actor.post(path,json=body)
                    self.assertEqual(same.status_code,200,same.text)
                    self.assertEqual(same.json()['my_reaction'],'clap')
                self.assertEqual(self.actor.post(path,json={'kind':'fire'}).status_code,429)
                self.assertEqual(self.actor.post(path,json={'kind':'fire','client_id':keys[path]}).status_code,409)
        self.assertEqual(self.actor.post(f'/api/activities/{self.aid}/cheer',json={}).status_code,200,'legacy unchanged cheer is free too')
        with db.connect() as held:
            M.lock(held,self.uid)
            for path in paths:
                with self.subTest(removal=path):
                    removed=self.actor.delete(path)
                    self.assertEqual(removed.status_code,200,removed.text)
                    self.assertIsNone(removed.json()['my_reaction'])
                    self.assertEqual(self.actor.delete(path).status_code,200)
        for path in paths:
            for key in (keys[path],free_keys[path]):
                replay=self.actor.post(path,json={'kind':'clap','client_id':key})
                self.assertEqual(replay.status_code,200,replay.text)
                self.assertIsNone(replay.json()['my_reaction'],'a lost old reply cannot recreate a removed reaction')
        self.assertEqual(self.actor.delete(f'/api/activities/{self.aid}/cheer').status_code,200)
        self.assertEqual(len(self.events('reaction')),60,'unchanged retries/removals do not charge or refund')

    def test_decline_persists_cooldown_while_sender_admission_is_held(self):
        with db.connect() as c:
            actor=c.execute('SELECT login FROM users WHERE id=%s',(self.uid,)).fetchone()['login']
            target=c.execute('SELECT login FROM users WHERE id=%s',(self.oid,)).fetchone()['login']
            c.execute('INSERT INTO friendships(requester,addressee) VALUES(%s,%s)',(self.uid,self.oid))
        with db.connect() as held:
            M.lock(held,self.uid)
            declined=self.owner.post('/api/friends/'+actor+'/decline',json={})
            self.assertEqual(declined.status_code,200,declined.text)
            self.assertEqual(self.owner.post('/api/friends/'+actor+'/decline',json={}).status_code,200)
        with db.connect() as c:
            self.assertIsNone(c.execute('SELECT 1 FROM friendships WHERE requester=%s AND addressee=%s',(self.uid,self.oid)).fetchone())
            wait=c.execute('SELECT extract(epoch FROM expires-now()) AS n FROM member_pair_cooldowns WHERE user_id=%s AND recipient_id=%s',(self.uid,self.oid)).fetchone()['n']
            self.assertGreater(wait,604000)
        denied=self.actor.post('/api/friends',json={'login':target})
        self.assertEqual(denied.status_code,429,denied.text)
        self.assertGreater(int(denied.headers['Retry-After']),604000)

    def test_decline_and_resend_race_keeps_cooldown_and_no_pending_request(self):
        with db.connect() as c:
            actor=c.execute('SELECT login FROM users WHERE id=%s',(self.uid,)).fetchone()['login']
            target=c.execute('SELECT login FROM users WHERE id=%s',(self.oid,)).fetchone()['login']
        for _ in range(5):
            with db.connect() as c:
                c.execute('DELETE FROM member_pair_cooldowns WHERE user_id=%s AND recipient_id=%s',(self.uid,self.oid))
                c.execute('INSERT INTO friendships(requester,addressee) VALUES(%s,%s)',(self.uid,self.oid))
            start=threading.Barrier(2)
            def send():
                start.wait();return self.actor.post('/api/friends',json={'login':target})
            def decline():
                start.wait();return self.owner.post('/api/friends/'+actor+'/decline',json={})
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                sent=pool.submit(send);declined=pool.submit(decline)
                self.assertIn(sent.result(timeout=10).status_code,(200,429))
                response=declined.result(timeout=10);self.assertEqual(response.status_code,200,response.text)
            with db.connect() as c:
                self.assertIsNone(c.execute('SELECT 1 FROM friendships WHERE requester=%s AND addressee=%s',(self.uid,self.oid)).fetchone())
                self.assertIsNotNone(c.execute('SELECT 1 FROM member_pair_cooldowns WHERE user_id=%s AND recipient_id=%s AND expires>now()',(self.uid,self.oid)).fetchone())

    def test_private_delivery_rows_follow_mute_and_block_but_are_not_exported(self):
        gid=self.group()
        update=self.owner.post(f'/api/groups/{gid}/updates',json={'text':'Fictional morning run'})
        self.assertEqual(update.status_code,200,update.text)
        path=f'/api/groups/{gid}/updates/{update.json()["id"]}/reaction'
        with db.connect() as c:
            c.execute('UPDATE group_members SET notifications_muted=true WHERE group_id=%s AND user_id=%s',(gid,self.oid))
        self.assertEqual(self.actor.post(path,json={'kind':'clap'}).status_code,200)
        self.assertEqual(self.events('reaction_notice'),[])
        with db.connect() as c:c.execute('UPDATE group_members SET notifications_muted=false WHERE group_id=%s AND user_id=%s',(gid,self.oid))
        self.assertEqual(self.actor.post(path,json={'kind':'fire'}).status_code,200)
        self.assertEqual(len(self.events('reaction_notice')),1)
        with db.connect() as c:
            c.execute('INSERT INTO group_members(group_id,user_id) VALUES(%s,%s)',(gid,self.tid))
            c.execute('INSERT INTO blocks(user_id,blocked) VALUES(%s,%s)',(self.tid,self.uid))
        sent=self.actor.post(f'/api/groups/{gid}/updates',json={'text':'Fictional meeting point'})
        self.assertEqual(sent.status_code,200,sent.text)
        self.assertCountEqual([r['recipient_id'] for r in self.events('comment_delivery')],[self.oid,self.tid],'budgeting is independent of private blocks')
        with tempfile.TemporaryDirectory() as folder:
            archive=Path(folder)/'private-counters.zip';api_mydata._write_export(self.uid,archive)
            with zipfile.ZipFile(archive) as z:
                self.assertFalse(any('member_action_events' in name or 'member_pair_cooldowns' in name for name in z.namelist()))
        with db.connect() as c:
            for table in ('member_action_events','member_pair_cooldowns'):
                for role in ('fit_readers','fit_all_readers'):
                    self.assertFalse(c.execute("SELECT has_table_privilege(%s,%s,'SELECT') AS ok",(role,table)).fetchone()['ok'])
                self.assertTrue(c.execute('SELECT relrowsecurity AS ok FROM pg_class WHERE oid=%s::regclass',(table,)).fetchone()['ok'])

    def test_account_export_explicit_fields_rls_and_erasure(self):
        with db.connect() as c:
            claim = M.claim(c, self.uid, 'friend', self.oid, request_key=uuid.uuid4()); M.finish(c, claim, self.oid)
            M.cooldown(c, self.uid, self.oid, 86400)
            peer_claim=M.claim(c, self.tid, 'friend', self.uid, request_key=uuid.uuid4());M.finish(c,peer_claim,self.uid)
            M.cooldown(c,self.tid,self.uid,86400)
        for table in ('member_action_receipts',):
            with db.connect() as c:
                rows = c.execute(api_mydata.TABLES[table], (self.uid,)).fetchall()
                self.assertEqual(len(rows), 1)
                self.assertNotIn('user_id', next(iter(rows[0].values())))
        with tempfile.TemporaryDirectory() as folder:
            archive=Path(folder)/'fictional.zip'
            api_mydata._write_export(self.uid,archive)
            with zipfile.ZipFile(archive) as z:
                for table in ('member_action_events','member_pair_cooldowns'):
                    self.assertNotIn(table,api_mydata.TABLES)
                    self.assertNotIn('data/'+table+'.jsonl',z.namelist())
                self.assertIn('data/member_action_receipts.jsonl',z.namelist())
        role = 'zz_test_ml_' + uuid.uuid4().hex[:12]
        root = db._conninfo('postgres', db.secret('POSTGRES_PASSWORD'))
        try:
            with psycopg.connect(root, autocommit=True) as c:
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal('fictional reader password')))
                c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
            with db.connect() as c: c.execute('UPDATE users SET sql_role=%s WHERE id=%s', (role, self.uid))
            with psycopg.connect(db._conninfo(role, 'fictional reader password'),row_factory=dict_row,autocommit=True) as reader:
                rows=reader.execute('SELECT user_id FROM member_action_receipts').fetchall()
                self.assertEqual(rows,[{'user_id':self.uid}])
                reader.execute('SET ROLE fit_readers')
                for table in ('member_action_events','member_pair_cooldowns'):
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                        reader.execute(sql.SQL('SELECT * FROM {}').format(sql.Identifier(table)))
                with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                    reader.execute("DELETE FROM member_action_events")
            with db.connect() as c:
                c.execute('DELETE FROM users WHERE id=%s', (self.uid,))
                for table in ('member_action_events','member_action_receipts','member_pair_cooldowns'):
                    self.assertEqual(c.execute(sql.SQL('SELECT count(*) AS n FROM {} WHERE user_id=%s').format(sql.Identifier(table)), (self.uid,)).fetchone()['n'], 0)
                self.assertEqual(c.execute('SELECT count(*) AS n FROM member_action_events WHERE user_id=%s', (self.tid,)).fetchone()['n'], 1)
        finally:
            with psycopg.connect(root, autocommit=True) as c: c.execute(sql.SQL('DROP ROLE IF EXISTS {}').format(sql.Identifier(role)))

    def test_cleanup_and_actual_133_upgrade_are_replay_safe(self):
        database='zz_test_member_upgrade_'+uuid.uuid4().hex[:12]
        root=db._conninfo('postgres',db.secret('POSTGRES_PASSWORD'))
        with psycopg.connect(root,autocommit=True) as admin:
            try:
                admin.execute(sql.SQL('CREATE DATABASE {} OWNER fit_app').format(sql.Identifier(database)))
                with psycopg.connect(make_conninfo(root,dbname=database),autocommit=True) as setup:
                    setup.execute('ALTER SCHEMA public OWNER TO fit_app')
                    setup.execute('GRANT USAGE ON SCHEMA public TO fit_readers')
                    setup.execute('CREATE EXTENSION postgis');setup.execute('CREATE EXTENSION citext')
                with psycopg.connect(make_conninfo(db.CONNINFO,dbname=database),row_factory=dict_row) as c:
                    self.assertGreaterEqual(len(db.MIGRATIONS),134)
                    for migration in db.MIGRATIONS[:133]:c.execute(migration)
                    uid=c.execute("INSERT INTO users(login,name) VALUES('zz_test_upgrade_member','Fictional Before') RETURNING id").fetchone()['id']
                    self.assertIsNone(c.execute("SELECT to_regclass('public.member_action_events') AS t").fetchone()['t'])
                with psycopg.connect(make_conninfo(db.CONNINFO,dbname=database),row_factory=dict_row) as c:
                    c.execute(db.MIGRATIONS[133]);c.execute(db.MIGRATIONS[133])
                    self.assertEqual(c.execute('SELECT name FROM users WHERE id=%s',(uid,)).fetchone()['name'],'Fictional Before')
                    self.assertEqual(c.execute('SELECT count(*) AS n FROM member_action_events').fetchone()['n'],0)
            finally:
                admin.execute(sql.SQL('DROP DATABASE IF EXISTS {} WITH (FORCE)').format(sql.Identifier(database)))
        with db.connect() as c:
            for table in ('member_action_events','member_action_receipts','member_pair_cooldowns'):
                c.execute(sql.SQL('SELECT 1 FROM {} LIMIT 0').format(sql.Identifier(table)))
            c.execute(db.MIGRATIONS[133]); c.execute(db.MIGRATIONS[133])
            c.execute("INSERT INTO member_pair_cooldowns VALUES(%s,%s,now()-interval '1 day')", (self.uid,self.oid))
        self.seed('search', 1, age=9*86400)
        M.cleanup()
        self.assertEqual(self.events('search'), [])
        with db.connect() as c: self.assertFalse(c.execute('SELECT 1 FROM member_pair_cooldowns WHERE user_id=%s', (self.uid,)).fetchone())


if __name__ == '__main__':
    unittest.main()
