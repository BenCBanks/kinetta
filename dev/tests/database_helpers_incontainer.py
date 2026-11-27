"""Fictional SQL-reader identity, group privacy and helper migration checks on a disposable database."""
import datetime as dt
from contextlib import contextmanager
import unittest
import uuid
from unittest.mock import patch

import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row

from app import db


def seed(c, role):
    ids, groups, challenges = [], [], []
    for i in range(3):
        uid = c.execute("""INSERT INTO public.users(login,name,sql_role)
            VALUES(%s,'Fictional reader',%s) RETURNING id""",
            ('zz_test_helpers_' + uuid.uuid4().hex[:12], role if i == 0 else None)).fetchone()['id']
        ids.append(uid)
        c.execute('INSERT INTO public.profile(user_id) VALUES(%s)', (uid,))
    for i in range(2):
        gid = c.execute("""INSERT INTO public.event_groups(organizer_id,title,goal_start_date,event_date,time_zone,
            goal_type,goal_target,goal_unit) VALUES(%s,'Fictional crew','2026-11-01','2026-12-01','UTC',
            'sessions',3,'sessions') RETURNING id""", (ids[1],)).fetchone()['id']
        groups.append(gid)
        for uid in (ids[:2] if i == 0 else ids[1:]):
            c.execute('INSERT INTO public.group_members(group_id,user_id) VALUES(%s,%s)', (gid, uid))
        challenges.append(c.execute("""INSERT INTO public.group_challenges(group_id,creator_id,
            title,metric,target,unit,sports,start_date,time_zone) VALUES(%s,%s,'Fictional challenge',
            'sessions',3,'sessions',ARRAY['run'],'2026-11-01','UTC') RETURNING id""",
            (gid, ids[1])).fetchone()['id'])
    return ids, groups, challenges


def behavior(check, owner, mapped, unmapped, fixture):
    """Assert the same real-reader outcomes on the previous schema and after each helper upgrade."""
    ids, groups, challenges = fixture
    observed = {}
    with mapped() as reader:
        def record(label, allowed=True, blocked=False, creator=ids[1]):
            row = reader.execute("""SELECT public.fit_me() AS me, public.fit_group_blocked(%s) AS blocked,
                public.fit_group_challenge_access(%s,%s) AS access,
                public.fit_group_challenge_access(%s,%s) AS other_access""",
                (ids[1], groups[0], creator, groups[1], creator)).fetchone()
            profiles = [r['user_id'] for r in reader.execute('SELECT user_id FROM public.profile')]
            visible = [r['id'] for r in reader.execute('SELECT id FROM public.group_challenges ORDER BY id')]
            observed[label] = (row, profiles, visible)
            check(observed[label], ({'me': ids[0], 'blocked': blocked, 'access': allowed, 'other_access': False},
                                   [ids[0]], [challenges[0]] if allowed else []), label)

        record('active member; nonmember group denied')
        for status in ['left', 'removed']:
            owner.execute('UPDATE public.group_members SET status=%s,removed_invite_generation=%s WHERE group_id=%s AND user_id=%s',
                          (status, 1 if status == 'removed' else None, groups[0], ids[0]))
            try: record(status, allowed=False)
            finally:
                owner.execute("UPDATE public.group_members SET status='active',removed_invite_generation=NULL WHERE group_id=%s AND user_id=%s", (groups[0], ids[0]))
        for actor, target in [(ids[0], ids[1]), (ids[1], ids[0])]:
            owner.execute('INSERT INTO public.blocks(user_id,blocked) VALUES(%s,%s)', (actor, target))
            try:
                record('block by ' + str(actor), allowed=False, blocked=True)
                owner.execute('UPDATE public.group_challenges SET creator_id=NULL WHERE id=%s', (challenges[0],))
                try: record('no creator; block by ' + str(actor), blocked=True, creator=None)
                finally: owner.execute('UPDATE public.group_challenges SET creator_id=%s WHERE id=%s', (ids[1], challenges[0]))
            finally: owner.execute('DELETE FROM public.blocks WHERE user_id=%s AND blocked=%s', (actor, target))
        for uid in ids[:2]:
            for field, value in [('needs_email_confirm', True),
                                 ('suspended_at', dt.datetime(2026, 11, 26, tzinfo=dt.timezone.utc)),
                                 ('password_change_expires', dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc))]:
                owner.execute(sql.SQL('UPDATE public.users SET {}=%s WHERE id=%s').format(sql.Identifier(field)), (value, uid))
                try: record(str(uid) + ':' + field, allowed=False)
                finally:
                    owner.execute(sql.SQL('UPDATE public.users SET {}=%s WHERE id=%s').format(sql.Identifier(field)),
                                  (False if field == 'needs_email_confirm' else None, uid))
        observed['null arguments'] = reader.execute('SELECT public.fit_group_blocked(NULL) AS b, public.fit_group_challenge_access(NULL,NULL) AS a').fetchone()
        check(observed['null arguments'], {'b': False, 'a': False})
    # The two quoted SQL role names differ only in case; sql_role is text, not citext.
    with unmapped() as reader:
        observed['unmapped'] = reader.execute("""SELECT public.fit_me() AS me,
            public.fit_group_blocked(%s) AS blocked, public.fit_group_challenge_access(%s,%s) AS access""",
            (ids[1], groups[0], ids[1])).fetchone()
        check(observed['unmapped'], {'me': None, 'blocked': False, 'access': False})
        check(reader.execute('SELECT user_id FROM public.profile').fetchall(), [])
        check(reader.execute('SELECT id FROM public.group_challenges').fetchall(), [])
    return observed


class DatabaseHelpers(unittest.TestCase):
    def setUp(self):
        self.ids = []
        self.role = 'zz_test_Helpers_' + uuid.uuid4().hex[:12]
        self.unmapped_role = self.role.lower()
        self.password = uuid.uuid4().hex
        with db.connect() as c:
            for role in [self.role, self.unmapped_role]:
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {} IN ROLE fit_readers').format(
                    sql.Identifier(role), sql.Literal(self.password)))
            self.ids, self.groups, self.challenges = seed(c, self.role)

    def tearDown(self):
        with db.connect() as c:
            c.execute('DELETE FROM public.users WHERE id=ANY(%s)', (self.ids,))
            c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(self.role)))
            c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(self.unmapped_role)))

    @contextmanager
    def reader(self):
        # Fresh SQL logins exercise session_user and avoid plans cached before temporary relations exist.
        with psycopg.connect(db._conninfo(self.role, self.password), row_factory=dict_row, autocommit=True) as reader:
            try:
                yield reader
            finally:
                # Closing the socket does not wait for server-side temp-table
                # cleanup. Finish it synchronously before tearDown drops roles.
                reader.execute('DISCARD TEMP')

    def shadow(self, reader, name, columns):
        reader.execute(sql.SQL('CREATE TEMP TABLE {} ({})').format(sql.Identifier(name), sql.SQL(columns)))
        # Give the function owner access so the regression tests resolution, rather than a permission error.
        reader.execute(sql.SQL('GRANT SELECT ON pg_temp.{} TO fit_app').format(sql.Identifier(name)))

    def visible_challenges(self, reader):
        return [r['id'] for r in reader.execute('SELECT id FROM public.group_challenges ORDER BY id').fetchall()]

    def test_inactive_null_creator_bidirectional_blocks_and_unmapped_reader(self):
        with psycopg.connect(db.CONNINFO, row_factory=dict_row, autocommit=True) as owner:
            behavior(self.assertEqual, owner, self.reader,
                     lambda: psycopg.connect(db._conninfo(self.unmapped_role, self.password), row_factory=dict_row, autocommit=True),
                     (self.ids, self.groups, self.challenges))

    def test_comparison_operand_types_and_catalog_operator_semantics(self):
        # Exhaustive operand inventory for the three helpers plus the migration125 retention trigger.
        expected = {'users': {'id': 'bigint', 'sql_role': 'text', 'needs_email_confirm': 'boolean',
                             'suspended_at': 'timestamp with time zone', 'password_change_expires': 'timestamp with time zone'},
                    'blocks': {'user_id': 'bigint', 'blocked': 'bigint'},
                    'group_members': {'group_id': 'uuid', 'user_id': 'bigint', 'status': 'text'},
                    'group_challenges': {'creator_id': 'bigint', 'legacy_group_id': 'uuid'}}
        with db.connect() as c:
            for table, columns in expected.items():
                for column, kind in columns.items():
                    row = c.execute("""SELECT a.atttypid::regtype::text AS kind,n.nspname
                        FROM pg_attribute a JOIN pg_type t ON t.oid=a.atttypid
                        JOIN pg_namespace n ON n.oid=t.typnamespace
                        WHERE a.attrelid=%s::regclass AND a.attname=%s""", ('public.' + table, column)).fetchone()
                    self.assertEqual(row, {'kind': kind, 'nspname': 'pg_catalog'}, (table, column))
            self.assertEqual(c.execute('SELECT pg_typeof(session_user)::text AS kind').fetchone()['kind'], 'name')
            for signature, arguments, result in [('public.fit_me()', '', 'bigint'),
                    ('public.fit_group_blocked(bigint)', 'target bigint', 'boolean'),
                    ('public.fit_group_challenge_access(uuid,bigint)', 'target_group uuid, creator bigint', 'boolean')]:
                self.assertEqual(c.execute('SELECT pg_get_function_identity_arguments(oid) AS args,prorettype::regtype::text AS result FROM pg_proc WHERE oid=%s::regprocedure', (signature,)).fetchone(),
                                 {'args': arguments, 'result': result})
            c.execute('SET LOCAL search_path=pg_catalog, pg_temp')
            for operands, implementation in [('bigint,bigint', 'int8eq'), ('uuid,uuid', 'uuid_eq'),
                                              ('text,text', 'texteq'), ('text,name', 'texteqname')]:
                row = c.execute("""SELECT n.nspname,o.oprcode::regproc::text AS implementation FROM pg_operator o
                    JOIN pg_namespace n ON n.oid=o.oprnamespace WHERE o.oid=%s::regoperator""", ('=(' + operands + ')',)).fetchone()
                self.assertEqual(row, {'nspname': 'pg_catalog', 'implementation': implementation})
            # The status literal coerces to text; NULL tests and boolean NOT do not resolve extension operators.
            self.assertEqual(c.execute("""SELECT 'active'::text='active' AS active,'active'::text='Active' AS other,
                'Reader'::text='Reader'::name AS exact,'Reader'::text='reader'::name AS folded""").fetchone(),
                {'active': True, 'other': False, 'exact': True, 'folded': False})

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

    def test_actual_previous_migrations_upgrade_preserves_behavior_ownership_and_all_acls(self):
        name = 'zz_test_helper_upgrade_' + uuid.uuid4().hex[:8]
        admin = db._conninfo('postgres', db.secret('POSTGRES_PASSWORD'))
        migrations = db.MIGRATIONS
        index = next(i for i, m in enumerate(migrations) if 'CREATE OR REPLACE FUNCTION public.fit_me()' in m)
        with psycopg.connect(admin, autocommit=True) as c:
            c.execute(sql.SQL('CREATE DATABASE {} OWNER fit_app').format(sql.Identifier(name)))
        try:
            with psycopg.connect(make_conninfo(admin, dbname=name), autocommit=True) as c:
                c.execute('ALTER SCHEMA public OWNER TO fit_app')
                c.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
                c.execute('GRANT USAGE ON SCHEMA public TO fit_readers')
                c.execute('CREATE EXTENSION postgis'); c.execute('CREATE EXTENSION citext')

            @contextmanager
            def target():
                with psycopg.connect(make_conninfo(db.CONNINFO, dbname=name), row_factory=dict_row) as c: yield c

            with patch.object(db, 'connect', target), patch.object(db, 'bootstrap'):
                # Build the baseline only from the actual preceding migration strings.
                with patch.object(db, 'MIGRATIONS', migrations[:index]): db.migrate()
                with target() as c:
                    self.assertEqual(c.execute('SELECT max(version) AS v FROM schema_version').fetchone()['v'], 125)
                    fixture = seed(c, self.role)
                with psycopg.connect(make_conninfo(db.CONNINFO, dbname=name), row_factory=dict_row, autocommit=True) as c:
                    def snapshot():
                        functions = c.execute("""SELECT oid,proname,proowner,proacl,prosecdef,provolatile,prorettype,proargtypes
                            FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef ORDER BY proname""").fetchall()
                        # Expand default ACLs too: grantee0 is PUBLIC. Compare every grantor/grantee/grant option.
                        acls = c.execute("""SELECT p.proname,a.* FROM pg_proc p
                            CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                            WHERE p.pronamespace='public'::regnamespace AND p.prosecdef
                            ORDER BY p.proname,a.grantor,a.grantee,a.privilege_type,a.is_grantable""").fetchall()
                        roles = c.execute("""SELECT p.proname,r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') AS execute
                            FROM pg_proc p CROSS JOIN pg_roles r
                            WHERE p.pronamespace='public'::regnamespace AND p.prosecdef ORDER BY p.proname,r.rolname""").fetchall()
                        data = {t: c.execute(sql.SQL('SELECT to_jsonb(t) AS row FROM public.{} t ORDER BY to_jsonb(t)::text')
                            .format(sql.Identifier(t))).fetchall() for t in ['users', 'profile', 'group_members', 'group_challenges', 'blocks']}
                        policies = c.execute("SELECT * FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname").fetchall()
                        return functions, acls, roles, data, policies

                    def read(role):
                        return psycopg.connect(make_conninfo(db._conninfo(role, self.password), dbname=name), row_factory=dict_row, autocommit=True)

                    before = snapshot()
                    public = {r['proname'] for r in before[1] if r['grantee'] == 0 and r['privilege_type'] == 'EXECUTE'}
                    self.assertEqual(public, {'fit_me'})
                    self.assertTrue(all(r['proowner'] == c.execute("SELECT oid FROM pg_roles WHERE rolname='fit_app'").fetchone()['oid'] for r in before[0]))
                    baseline = behavior(self.assertEqual, c, lambda: read(self.role), lambda: read(self.unmapped_role), fixture)
                    for attempt in range(2):
                        if attempt == 0:
                            with patch.object(db, 'MIGRATIONS', migrations[:index + 1]): db.migrate()
                        else: c.execute(migrations[index])
                        self.assertEqual(snapshot(), before, 'function identity/ownership, complete ACLs, all roles, data and policies survive')
                        self.assertEqual(behavior(self.assertEqual, c, lambda: read(self.role), lambda: read(self.unmapped_role), fixture), baseline)
                        paths = c.execute("SELECT proconfig FROM pg_proc WHERE pronamespace='public'::regnamespace AND prosecdef").fetchall()
                        self.assertTrue(all('search_path=pg_catalog, pg_temp' in r['proconfig'] for r in paths))
        finally:
            with psycopg.connect(admin, autocommit=True) as c:
                c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


unittest.main()
