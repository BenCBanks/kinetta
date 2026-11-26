"""Fictional SQL-reader identity, group privacy and helper migration checks on a disposable database."""
import datetime as dt
import unittest
import uuid

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from app import db


class DatabaseHelpers(unittest.TestCase):
    def setUp(self):
        self.ids = []
        self.role = 'zz_test_helpers_' + uuid.uuid4().hex[:12]
        self.password = uuid.uuid4().hex
        with db.connect() as c:
            c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} IN ROLE fit_readers').format(
                sql.Identifier(self.role), sql.Literal(self.password)))
            for i in range(3):
                uid = c.execute("""INSERT INTO public.users(login,name,sql_role)
                    VALUES(%s,'Fictional reader',%s) RETURNING id""",
                    ('zz_test_helpers_' + uuid.uuid4().hex[:12], self.role if i == 0 else None)).fetchone()['id']
                self.ids.append(uid)
                c.execute('INSERT INTO public.profile(user_id) VALUES(%s)', (uid,))
            self.groups = []
            self.challenges = []
            for i in range(2):
                gid = c.execute("""INSERT INTO public.event_groups(organizer_id,title,goal_start_date,event_date,time_zone,
                    goal_type,goal_target,goal_unit) VALUES(%s,'Fictional crew','2026-11-01','2026-12-01','UTC',
                    'sessions',3,'sessions') RETURNING id""", (self.ids[1],)).fetchone()['id']
                self.groups.append(gid)
                for uid in (self.ids[:2] if i == 0 else self.ids[1:]):
                    c.execute('INSERT INTO public.group_members(group_id,user_id) VALUES(%s,%s)', (gid, uid))
                self.challenges.append(c.execute("""INSERT INTO public.group_challenges(group_id,creator_id,
                    title,metric,target,unit,sports,start_date,time_zone) VALUES(%s,%s,'Fictional challenge',
                    'sessions',3,'sessions',ARRAY['run'],'2026-11-01','UTC') RETURNING id""",
                    (gid, self.ids[1])).fetchone()['id'])

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM public.users WHERE id=ANY(%s)', (self.ids,))
            c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(self.role)))

    def reader(self):
        # Fresh SQL logins exercise session_user and avoid plans cached before temporary relations exist.
        return psycopg.connect(db._conninfo(self.role, self.password), row_factory=dict_row, autocommit=True)

    def shadow(self, reader, name, columns):
        reader.execute(sql.SQL('CREATE TEMP TABLE {} ({})').format(sql.Identifier(name), sql.SQL(columns)))
        # Give the function owner access so the regression tests resolution, rather than a permission error.
        reader.execute(sql.SQL('GRANT SELECT ON pg_temp.{} TO fit_app').format(sql.Identifier(name)))

    def visible_challenges(self, reader):
        return [r['id'] for r in reader.execute('SELECT id FROM public.group_challenges ORDER BY id').fetchall()]

    def test_identity_and_own_profile_ignore_temporary_users(self):
        with self.reader() as reader:
            self.shadow(reader, 'users', 'id bigint, sql_role text')
            reader.execute('INSERT INTO pg_temp.users VALUES(%s,%s)', (self.ids[1], self.role))
            self.assertEqual(reader.execute('SELECT public.fit_me() AS id').fetchone()['id'], self.ids[0])
            self.assertEqual(reader.execute('SELECT user_id FROM public.profile').fetchall(),
                             [{'user_id': self.ids[0]}])
            with self.assertRaises(psycopg.errors.InsufficientPrivilege):
                reader.execute('UPDATE public.profile SET units=\'metric\'')

    def test_blocks_cannot_be_hidden_or_invented_by_temporary_blocks(self):
        with db.connect() as c:
            c.execute('INSERT INTO public.blocks(user_id,blocked) VALUES(%s,%s)', (self.ids[1], self.ids[0]))
        with self.reader() as reader:
            self.shadow(reader, 'blocks', 'user_id bigint, blocked bigint')
            self.assertTrue(reader.execute('SELECT public.fit_group_blocked(%s) AS v', (self.ids[1],)).fetchone()['v'])
            self.assertEqual(self.visible_challenges(reader), [])
            with db.connect() as c:
                c.execute('DELETE FROM public.blocks WHERE user_id=%s', (self.ids[1],))
            reader.execute('INSERT INTO pg_temp.blocks VALUES(%s,%s)', (self.ids[0], self.ids[1]))
            self.assertFalse(reader.execute('SELECT public.fit_group_blocked(%s) AS v', (self.ids[1],)).fetchone()['v'])
            self.assertEqual(self.visible_challenges(reader), [self.challenges[0]])

    def test_group_membership_ignores_temporary_members(self):
        with self.reader() as reader:
            self.shadow(reader, 'group_members', 'group_id uuid, user_id bigint, status text')
            reader.execute("INSERT INTO pg_temp.group_members VALUES(%s,%s,'active')", (self.groups[1], self.ids[0]))
            for gid, allowed in zip(self.groups, [True, False]):
                self.assertEqual(reader.execute('SELECT public.fit_group_challenge_access(%s,%s) AS v',
                    (gid, self.ids[1])).fetchone()['v'], allowed)
            self.assertEqual(self.visible_challenges(reader), [self.challenges[0]])

    def test_account_restrictions_ignore_temporary_users(self):
        with self.reader() as reader:
            self.shadow(reader, 'users', 'id bigint, sql_role text, needs_email_confirm boolean, '
                        'suspended_at timestamptz, password_change_expires timestamptz')
            for i, uid in enumerate(self.ids[:2]):
                reader.execute('INSERT INTO pg_temp.users VALUES(%s,%s,false,NULL,NULL)',
                               (uid, self.role if i == 0 else None))
            for uid in self.ids[:2]:
                for field, value in [('needs_email_confirm', True),
                                     ('suspended_at', dt.datetime(2026, 11, 26, tzinfo=dt.timezone.utc)),
                                     ('password_change_expires', dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc))]:
                    with self.subTest(account=uid, field=field):
                        with db.connect() as c:
                            c.execute(sql.SQL('UPDATE public.users SET {}=%s WHERE id=%s').format(sql.Identifier(field)), (value, uid))
                        self.assertFalse(reader.execute('SELECT public.fit_group_challenge_access(%s,%s) AS v',
                            (self.groups[0], self.ids[1])).fetchone()['v'])
                        self.assertEqual(self.visible_challenges(reader), [])
                        with db.connect() as c:
                            c.execute(sql.SQL('UPDATE public.users SET {}=%s WHERE id=%s').format(sql.Identifier(field)),
                                      (False if field == 'needs_email_confirm' else None, uid))
                        self.assertEqual(self.visible_challenges(reader), [self.challenges[0]])

    def test_all_public_definers_use_restricted_paths_and_keep_reader_grants(self):
        with db.connect() as c:
            rows = c.execute("""SELECT p.proname,p.proconfig FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                WHERE p.prosecdef AND n.nspname='public'""").fetchall()
            self.assertTrue({'fit_me', 'fit_group_blocked', 'fit_group_challenge_access', 'fit_keep_group_goal'}
                            <= {r['proname'] for r in rows})
            for row in rows:
                self.assertIn('search_path=pg_catalog, pg_temp', row['proconfig'] or [], row['proname'])
            for signature in ['public.fit_me()', 'public.fit_group_blocked(bigint)',
                              'public.fit_group_challenge_access(uuid,bigint)']:
                self.assertTrue(c.execute("SELECT has_function_privilege('fit_readers',%s,'EXECUTE') AS v", (signature,)).fetchone()['v'])
            self.assertFalse(c.execute("SELECT has_function_privilege('fit_readers','public.fit_keep_group_goal()','EXECUTE') AS v").fetchone()['v'])

    def test_upgrade_and_replay_preserve_function_ids_grants_and_data(self):
        migration = next(m for m in db.MIGRATIONS if 'CREATE OR REPLACE FUNCTION public.fit_me()' in m)
        with db.connect() as c, c.transaction(force_rollback=True):
            names = ['fit_me', 'fit_group_blocked', 'fit_group_challenge_access']
            snapshot = lambda: c.execute("""SELECT p.oid,p.proname,p.proowner,p.proacl FROM pg_catalog.pg_proc p
                JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
                WHERE n.nspname='public' AND p.proname=ANY(%s) ORDER BY p.proname""", (names,)).fetchall()
            rows = lambda: {t: c.execute(sql.SQL('SELECT to_jsonb(t) AS row FROM public.{} t ORDER BY to_jsonb(t)::text')
                .format(sql.Identifier(t))).fetchall() for t in ['users', 'profile', 'group_members', 'group_challenges']}
            before, data = snapshot(), rows()
            # Restore the previous definitions to exercise the real replacement, not only a replay.
            for name in names:
                definition = c.execute('SELECT pg_get_functiondef(oid) AS sql FROM pg_proc WHERE proname=%s AND pronamespace=\'public\'::regnamespace', (name,)).fetchone()['sql']
                c.execute(definition.replace("SET search_path TO 'pg_catalog', 'pg_temp'", "SET search_path TO 'public'")
                          .replace('public.', ''))
            c.execute(migration)
            c.execute(migration)
            self.assertEqual(snapshot(), before, 'CREATE OR REPLACE retains function identity, ownership and ACLs')
            self.assertEqual(rows(), data, 'the helper upgrade never rewrites account or group data')


unittest.main()
