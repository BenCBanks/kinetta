"""Photo receipts: real fresh/128/132/133/134 upgrade/repeat, fictional existing photo retained."""
from contextlib import contextmanager
import uuid
from unittest.mock import patch
import psycopg
from psycopg import sql
from psycopg.conninfo import make_conninfo
from psycopg.rows import dict_row
from app import db

assert len(db.MIGRATIONS) >= 135 and 'photo_upload_receipts' in db.MIGRATIONS[132]
admin = db._conninfo('postgres', db.secret('POSTGRES_PASSWORD'))
for previous in (0, 128, 132, 133, 134):
    name = 'zz_test_photo_upgrade_' + uuid.uuid4().hex[:8]
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(sql.SQL('CREATE DATABASE {} OWNER fit_app').format(sql.Identifier(name)))
    try:
        with psycopg.connect(make_conninfo(admin, dbname=name), autocommit=True) as c:
            c.execute('ALTER SCHEMA public OWNER TO fit_app')
            c.execute('CREATE EXTENSION postgis'); c.execute('CREATE EXTENSION citext')
        @contextmanager
        def target():
            with psycopg.connect(make_conninfo(db.CONNINFO, dbname=name), row_factory=dict_row) as c:
                yield c
        with patch.object(db, 'connect', target), patch.object(db, 'bootstrap'):
            migrations = db.MIGRATIONS
            receipt_key=uuid.uuid4()
            if previous:
                with patch.object(db, 'MIGRATIONS', migrations[:previous]): db.migrate()
                with target() as c:
                    uid = c.execute("INSERT INTO users(login,name) VALUES('zz_test_upgrade','Fictional Upgrade') RETURNING id").fetchone()['id']
                    aid = c.execute("INSERT INTO activities(user_id,sport,start_time,source,name) VALUES(%s,'run',now(),'manual','Fictional upgrade run') RETURNING id",(uid,)).fetchone()['id']
                    photo = c.execute("INSERT INTO activity_photos(activity_id,user_id,img,thumb,w,h) VALUES(%s,%s,'fictional','fictional',12,10) RETURNING id",(aid,uid)).fetchone()['id']
                    if previous>=133:
                        c.execute("INSERT INTO photo_upload_receipts(user_id,client_id,activity_id,photo_id,request_hash) VALUES(%s,%s,%s,%s,repeat('0',64))",(uid,receipt_key,aid,photo))
            db.migrate()
            with target() as c:
                oid = c.execute("SELECT 'photo_upload_receipts'::regclass::oid AS oid").fetchone()['oid']
            db.migrate()
            with target() as c:
                c.execute(migrations[134]);c.execute(migrations[134])
                for index_name,column in [('photo_upload_receipts_activity','activity_id'),('photo_upload_receipts_photo','photo_id')]:
                    index=c.execute("SELECT i.indisvalid,i.indisunique,a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=i.indkey[0] WHERE i.indexrelid=%s::regclass AND i.indrelid='photo_upload_receipts'::regclass",(index_name,)).fetchone()
                    assert index==dict(indisvalid=True,indisunique=False,attname=column),index
                assert c.execute('SELECT count(*) AS n,max(version) AS v FROM schema_version').fetchone()==dict(n=len(migrations),v=len(migrations))
                assert c.execute("SELECT 'photo_upload_receipts'::regclass::oid AS oid").fetchone()['oid']==oid
                assert c.execute('SELECT count(*) AS n FROM photo_upload_receipts').fetchone()['n']==int(previous>=133)
                if previous>=133:
                    assert c.execute('SELECT user_id,activity_id,photo_id,request_hash FROM photo_upload_receipts WHERE client_id=%s',(receipt_key,)).fetchone()==dict(user_id=uid,activity_id=aid,photo_id=photo,request_hash='0'*64)
                if previous:
                    assert bytes(c.execute('SELECT img FROM activity_photos WHERE id=%s',(photo,)).fetchone()['img'])==b'fictional'
    finally:
        with psycopg.connect(admin, autocommit=True) as c:
            c.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
print('Photo receipt migrations133/135: fresh,128/132/133/134 upgrade,repeat,FK indexes,existing photo preserved PASS')
