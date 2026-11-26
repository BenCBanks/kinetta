"""Actual shipped-main121 -> Kit122/123 upgrade, in a separate disposable DB."""
from contextlib import contextmanager
import uuid
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from app import db

name = 'zz_test_main_kit_upgrade_' + uuid.uuid4().hex[:8]
admin = db._conninfo('postgres', db.secret('POSTGRES_PASSWORD'))
with psycopg.connect(admin, autocommit=True) as c:
    c.execute(sql.SQL('CREATE DATABASE {} OWNER fit_app').format(sql.Identifier(name)))
try:
    with psycopg.connect(make_conninfo(admin, dbname=name), autocommit=True) as c:
        c.execute('ALTER SCHEMA public OWNER TO fit_app')
        c.execute('CREATE EXTENSION postgis')
        c.execute('CREATE EXTENSION citext')
    @contextmanager
    def target():
        with psycopg.connect(make_conninfo(db.CONNINFO, dbname=name), row_factory=dict_row) as c:
            yield c
    with patch.object(db, 'connect', target), patch.object(db, 'bootstrap'):
        migrations = db.MIGRATIONS
        with patch.object(db, 'MIGRATIONS', migrations[:121]):
            db.migrate()
        with target() as c:
            assert c.execute('SELECT max(version) v FROM schema_version').fetchone()['v'] == 121
            oid = c.execute("SELECT 'group_challenges'::regclass::oid AS oid").fetchone()['oid']
            uid = c.execute("INSERT INTO users(login,name) VALUES(%s,'Fictional Upgrade') RETURNING id",
                ('zz_test_main_kit_' + uuid.uuid4().hex[:8],)).fetchone()['id']
            old = c.execute("INSERT INTO kit_memories(user_id,text,created) VALUES(%s,'I train on Tuesdays.',now()-interval '7 days') RETURNING id,created", (uid,)).fetchone()
        db.migrate()
        with target() as c:
            assert c.execute('SELECT max(version) v FROM schema_version').fetchone()['v'] == 123
            assert c.execute("SELECT 'group_challenges'::regclass::oid AS oid").fetchone()['oid'] == oid
            memory = c.execute('SELECT kind,source,created FROM kit_memories WHERE id=%s', (old['id'],)).fetchone()
            assert memory == dict(kind='routine', source='chat', created=old['created'])
            constraint = c.execute("SELECT pg_get_constraintdef(oid) AS value FROM pg_constraint WHERE conname='coach_proposals_kind_check'").fetchone()['value']
            assert 'goal' in constraint
    print('Shipped main121 -> Kit memory122/goal123 upgrade: existing Groups table/memory retained PASS')
finally:
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
