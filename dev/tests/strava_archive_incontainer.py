"""Hostile fictional archives and a real preceding-schema upgrade; no external data."""
from contextlib import contextmanager
import gzip
import io
from pathlib import Path
import stat
import struct
import warnings
import tempfile
import unittest
import uuid
import zipfile
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from app import db,strava_archive as A


class Guards(unittest.TestCase):
    def zipped(self,files):
        b=io.BytesIO()
        with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
            for k,v in files:z.writestr(k,v)
        return b.getvalue()

    def check(self,data):
        with tempfile.NamedTemporaryFile() as f:
            f.write(data);f.flush()
            with A.open_archive(f.name) as z:return A.checked_names(z)

    def test_directory_names_links_encryption_duplicates_and_bomb(self):
        for name in ('../escape.fit','/absolute.gpx','a\\b.fit'):
            with self.subTest(name=name),self.assertRaises(A.ArchiveError):self.check(self.zipped([(name,b'fictional')]))
        info=zipfile.ZipInfo('link.fit');info.create_system=3;info.external_attr=(stat.S_IFLNK|0o777)<<16
        with self.assertRaises(A.ArchiveError):self.check(self.zipped([(info,b'elsewhere')]))
        with self.assertRaises(A.ArchiveError):self.check(self.zipped([('photo',b'0'*100000)]))
        with patch.object(A,'MAX_ENTRIES',1),self.assertRaises(A.ArchiveError):self.check(self.zipped([('one',b'a'),('two',b'b')]))
        with patch.object(A,'MAX_EXPANDED',1),self.assertRaises(A.ArchiveError):self.check(self.zipped([('one',b'abc')]))
        with tempfile.NamedTemporaryFile() as f:
            f.write(self.zipped([('activities/run.fit',b'fictional')]));f.flush()
            with A.open_archive(f.name) as z:
                with self.assertRaises(A.ArchiveError):A.items(z)
                with self.assertRaises(A.ArchiveError):A.read_entry(z,'activities/run.fit',3)
        with self.assertRaises(A.ArchiveError):self.check(b'not zip')
        with warnings.catch_warnings():
            warnings.simplefilter('ignore')
            raw=self.zipped([('same',b'a'),('same',b'b')])
        with self.assertRaises(A.ArchiveError):self.check(raw)
        raw=bytearray(self.zipped([('encrypted',b'fictional')]))
        directory=raw.index(b'PK\x01\x02');struct.pack_into('<H',raw,directory+8,1)
        with self.assertRaises(A.ArchiveError):self.check(bytes(raw))

    def test_capped_gzip_and_invalid_manual(self):
        with patch.object(A,'MAX_FILE',100):
            with self.assertRaises(A.ArchiveError):A.parse_item('run.gpx.gz',lambda:gzip.compress(b'x'*101),{})
        for distance in (float('nan'),float('inf'),-10):
            with self.assertRaises(A.ArchiveError):A.parse_item('manual',None,{'start':'2025-01-01','elapsed_s':30,'distance_m':distance})

    def test_bad_csv_rows_are_counted_and_extreme_fields_bounded(self):
        import tempfile
        header='Activity ID,Activity Date,Activity Type,Filename\n'
        for text,expected in [(header+'101,not-a-date,Run,\n',1),(header+'1,'+'x'*140000+',Run,\n',None)]:
            with tempfile.NamedTemporaryFile() as f:
                f.write(self.zipped([('activities.csv',text)]));f.flush()
                with A.open_archive(f.name) as z:
                    if expected is None:
                        with self.assertRaises(A.ArchiveError):A.items(z)
                    else:
                        entries=A.items(z);self.assertEqual(len(entries),expected)
                        with self.assertRaises(A.ArchiveError):A.parse_item(*entries[0])
        with self.assertRaises(A.ArchiveError):A.parse_item('manual',None,{'strava_id':10**30})

    def test_actual_previous_migrations_then_upgrade_twice(self):
        name='zz_test_strava_upgrade_'+uuid.uuid4().hex[:8]
        admin=db._conninfo('postgres',db.secret('POSTGRES_PASSWORD'))
        migrations=db.MIGRATIONS;index=next(i for i,m in enumerate(migrations) if 'CREATE TABLE IF NOT EXISTS strava_uploads' in m)
        with psycopg.connect(admin,autocommit=True) as c:
            c.execute(sql.SQL('CREATE DATABASE {} OWNER fit_app').format(sql.Identifier(name)))
        try:
            with psycopg.connect(make_conninfo(admin,dbname=name),autocommit=True) as c:
                c.execute('ALTER SCHEMA public OWNER TO fit_app');c.execute('REVOKE ALL ON SCHEMA public FROM PUBLIC')
                c.execute('GRANT USAGE ON SCHEMA public TO fit_readers');c.execute('CREATE EXTENSION postgis');c.execute('CREATE EXTENSION citext')
            @contextmanager
            def connect():
                with psycopg.connect(make_conninfo(db.CONNINFO,dbname=name),row_factory=dict_row) as c:yield c
            with patch.object(db,'connect',connect),patch.object(db,'bootstrap'):
                with patch.object(db,'MIGRATIONS',migrations[:index]):db.migrate()
                with connect() as c:
                    self.assertEqual(c.execute('SELECT max(version) AS v FROM schema_version').fetchone()['v'],index)
                    uid=c.execute("INSERT INTO users(login,name) VALUES('zz_test_upgrade_strava','River Test') RETURNING id").fetchone()['id']
                    c.execute("INSERT INTO profile(user_id,share_default) VALUES(%s,'everyone')",(uid,))
                    before=c.execute('SELECT * FROM profile WHERE user_id=%s',(uid,)).fetchone()
                db.migrate()
                with connect() as c:
                    c.execute(migrations[index]);c.execute(migrations[index])
                    self.assertEqual(c.execute('SELECT * FROM profile WHERE user_id=%s',(uid,)).fetchone(),before)
                    self.assertEqual(c.execute('SELECT max(version) AS v FROM schema_version').fetchone()['v'],len(migrations))
                    for table in ('strava_uploads','strava_import_stage'):
                        self.assertTrue(c.execute('SELECT relrowsecurity FROM pg_class WHERE oid=%s::regclass',(table,)).fetchone()['relrowsecurity'])
                        self.assertFalse(c.execute('SELECT has_table_privilege(\'public\',%s,\'SELECT\') AS ok',(table,)).fetchone()['ok'])
        finally:
            with psycopg.connect(admin,autocommit=True) as c:
                c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))


if __name__=='__main__':unittest.main()
