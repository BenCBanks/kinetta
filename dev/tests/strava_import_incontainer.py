"""Fictional, local-only import contract, privacy and crash regressions. No outbound sends."""
import datetime as dt
import asyncio
import gzip
from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
import uuid
import zipfile
import zlib
from unittest.mock import patch
import psycopg
from psycopg import sql
from fastapi.testclient import TestClient
from fastapi import HTTPException
from app import db,auth,coach,account_email,strava_upload as U,strava_stage as S,strava_archive as A,api_strava_import as API
from app.main import app

PW='fictional import test passphrase'


def bundle(extra=None):
    buf=io.BytesIO()
    # Two manual activities plus a recording and one unreadable referenced file.
    with zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('activities.csv','Activity ID,Activity Date,Activity Type,Filename,Activity Name,Distance,Elapsed Time\n'
          '101,"Nov 01, 2025, 08:00:00 AM",Run,,Fictional easy run,5,1800\n'
          '102,"Nov 03, 2025, 08:00:00 AM",Walk,,Fictional walk,3,2400\n'
          '103,"Nov 05, 2025, 08:00:00 AM",Run,activities/run.gpx,Fictional recorded run,5,1800\n'
          '104,"Nov 07, 2025, 08:00:00 AM",Run,activities/bad.fit,Fictional unreadable run,5,1800\n')
        z.writestr('activities/run.gpx','''<?xml version="1.0"?><gpx version="1.1"><trk><type>run</type><trkseg>
<trkpt lat="40.70" lon="-73.9"><ele>20</ele><time>2025-11-05T08:00:00Z</time></trkpt>
<trkpt lat="40.71" lon="-73.9"><ele>25</ele><time>2025-11-05T08:30:00Z</time></trkpt>
</trkseg></trk></gpx>''')
        z.writestr('activities/bad.fit',b'not a recording')
        for key,value in (extra or {}).items():z.writestr(key,value)
    return buf.getvalue()


class Import(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if account_email.mail_ready():raise AssertionError('Use a disposable fixture with mail disabled')
        # Exclude the running HTTP application's background worker for deterministic crash cuts.
        cls.lease=db.pool().getconn()
        cls.lease.execute("SELECT pg_advisory_lock(hashtextextended('strava-worker',0))");cls.lease.commit()
        cls.coach=patch.object(coach,'after_import',side_effect=AssertionError('No AI permitted'));cls.coach.start()
        cls.mail=patch.object(account_email,'send',side_effect=AssertionError('Real email prohibited'));cls.mail.start()
        cls.transport=patch.object(account_email.httpx,'post',side_effect=AssertionError('Outbound mail transport prohibited'));cls.transport.start()

    @classmethod
    def tearDownClass(cls):
        cls.coach.stop();cls.mail.stop();cls.transport.stop()
        cls.lease.execute("SELECT pg_advisory_unlock(hashtextextended('strava-worker',0))");cls.lease.commit();db.pool().putconn(cls.lease)

    def setUp(self):
        self.ids=[];self.clients=[]
        for tag in ('one','two'):
            with db.connect() as c:
                login='zz_test_strava_'+tag+'_'+secrets.token_hex(4)
                uid=c.execute("INSERT INTO users(login,name,pw_hash,email,email_verified_at) VALUES(%s,'River Test',%s,%s,now()) RETURNING id",(login,auth.hash_pw(PW),login+'@example.test')).fetchone()['id']
                c.execute("INSERT INTO profile(user_id,share_default) VALUES(%s,'friends')",(uid,))
                token=auth.new_session(c,uid,'fictional import fixture')
            self.ids.append(uid)
            client=TestClient(app);client.headers.update({'Origin':'http://testserver','Content-Type':'application/json','Authorization':'Bearer '+token});self.clients.append(client)
        self.me,self.other=self.ids;self.a,self.b=self.clients
        self.addCleanup(self.clean)

    def clean(self):
        from app.api_account import erase_files
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))
        for uid in self.ids:erase_files(uid)
        for client in self.clients:client.close()

    def create(self,raw=None,client=None,**kw):
        raw=bundle() if raw is None else raw;client=client or self.a
        body={'id':str(uuid.uuid4()),'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),**kw}
        r=client.post('/api/strava-import/uploads',json=body)
        self.assertEqual(r.status_code,200,r.text)
        return body['id'],raw

    def piece(self,identity,raw,offset=0,client=None,digest=None):
        return (client or self.a).put(f'/api/strava-import/uploads/{identity}/pieces/{offset}',content=raw,
           headers={'Content-Type':'application/octet-stream','X-Content-Sha256':digest or hashlib.sha256(raw).hexdigest()})

    def status(self,identity):
        r=self.a.get('/api/strava-import/uploads/'+identity);self.assertEqual(r.status_code,200);return r.json()

    def process(self,identity):
        with db.connect() as c:r=dict(U.owned(c,self.me,identity))
        U.process(r,threading.Event())

    def worker_once(self):
        # Reenter our test session's worker lock once, keeping the unrelated HTTP
        # process excluded; all nested reads still borrow their ordinary sessions.
        original=db.connect;first=[True]
        @contextmanager
        def connect():
            if first:
                first.clear();yield type(self).lease
            else:
                with original() as c:yield c
        with patch.object(db,'connect',connect):return U.run_one()

    def ready(self):
        identity,raw=self.create();self.assertEqual(self.piece(identity,raw).status_code,200)
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/finalize',json={}).status_code,200)
        self.process(identity);self.assertEqual(self.status(identity)['state'],'review')
        return identity

    def test_resume_integrity_ownership_and_length(self):
        identity,raw=self.create();half=len(raw)//2
        self.assertEqual(self.piece(identity,raw[:half],client=self.b).status_code,404)
        self.assertEqual(self.b.get('/api/strava-import/uploads/'+identity).status_code,404)
        for action in ('finalize','confirm'):
            self.assertEqual(self.b.post(f'/api/strava-import/uploads/{identity}/{action}',json={'confirm':True,'audience':'friends'}).status_code,404)
        self.assertEqual(self.b.delete('/api/strava-import/uploads/'+identity).status_code,404)
        self.assertEqual(self.piece(identity,raw[:half],digest='0'*64).status_code,422)
        self.assertEqual(self.piece(identity,raw[:half]).status_code,200)
        self.assertEqual(self.piece(identity,raw[:half]).status_code,200,'lost-response retry is idempotent')
        self.assertEqual(self.piece(identity,b'X'*half).status_code,409)
        self.assertEqual(self.piece(identity,raw[half:],offset=half+1).status_code,422)
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/finalize',json={}).status_code,409)
        # Crash after disk write before SQL commit: status remains the authoritative cursor.
        with U.path(self.me,identity).open('ab') as f:f.write(b'orphan-tail')
        self.assertEqual(self.piece(identity,raw[half:],offset=half).status_code,200)
        self.assertEqual(U.path(self.me,identity).read_bytes(),raw)
        self.assertEqual(self.status(identity)['received'],len(raw))
        self.assertEqual(self.piece(identity,b'x',offset=len(raw)).status_code,422)
        self.assertEqual(self.piece(identity,b'x'*(U.CHUNK+1)).status_code,413)
        U.path(self.me,identity).write_bytes(b'x'*len(raw))
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/finalize',json={}).status_code,422)
        self.assertEqual(self.status(identity)['state'],'uploading')
        self.assertEqual(self.a.get('/api/strava-import/stage').json()['upload']['id'],identity,'another device can resume from SQL')
        self.assertEqual(TestClient(app).get('/api/strava-import/stage').status_code,401)
        self.assertEqual(self.a.put('/api/strava-import/stage',json={'filename':'private.zip'}).status_code,422)

    def test_native_preflight_and_unchanged_origin_guard(self):
        response=self.a.options('/api/strava-import/uploads/'+str(uuid.uuid4())+'/pieces/0',headers={
          'Origin':'capacitor://localhost','Access-Control-Request-Method':'PUT',
          'Access-Control-Request-Headers':'authorization,content-type,x-content-sha256,x-kinetta-account'})
        self.assertEqual(response.status_code,200,response.text)
        self.assertIn('X-Content-Sha256',response.headers['access-control-allow-headers'])
        identity,raw=self.create()
        response=self.a.put(f'/api/strava-import/uploads/{identity}/pieces/0',content=raw,headers={
          'Origin':'https://unrelated.example.test','Content-Type':'application/octet-stream',
          'X-Content-Sha256':hashlib.sha256(raw).hexdigest()})
        self.assertEqual(response.status_code,403)
        self.assertEqual(self.a.post('/api/strava-import/uploads',content=raw,headers={'Content-Type':'application/octet-stream'}).status_code,415)
        response=self.a.put(f'/api/strava-import/uploads/{identity}/pieces/0',content=raw,headers={
          'Content-Type':'application/octet-stream','X-Content-Sha256':hashlib.sha256(raw).hexdigest(),'X-Kinetta-Account':str(self.other)})
        self.assertEqual(response.status_code,409)

    def test_actual_eight_mib_pieces_and_idempotent_reservation(self):
        raw=bundle({'photos/fictional.bin':os.urandom(U.CHUNK+1024)})
        identity,raw=self.create(raw)
        body={'id':identity,'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
        self.assertEqual(self.a.post('/api/strava-import/uploads',json=body).status_code,200)
        self.assertEqual(self.b.post('/api/strava-import/uploads',json=body).status_code,409)
        self.assertEqual(self.a.post('/api/strava-import/uploads',json={**body,'sha256':'0'*64}).status_code,409)
        first=self.piece(identity,raw[:U.CHUNK]);self.assertEqual(first.status_code,200)
        self.assertEqual(first.json()['received'],U.CHUNK)
        self.assertEqual(self.piece(identity,raw[U.CHUNK:],offset=U.CHUNK).status_code,200)
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/finalize',json={}).status_code,200)
        self.process(identity)
        self.assertEqual(self.status(identity)['preview'],{'added':3,'already_here':0,'unreadable':1})
        self.assertEqual(self.a.get('/api/strava-import/stage').json()['upload']['id'],identity)

    def test_preview_confirm_privacy_and_restart(self):
        identity=self.ready()
        self.assertFalse(U.run_one(),'another SQL worker lease prevents concurrent work')
        self.assertEqual(self.status(identity)['preview'],{'added':3,'already_here':0,'unreadable':1})
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s',(self.me,)).fetchone()['n'],0)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM gear WHERE user_id=%s',(self.me,)).fetchone()['n'],0)
            c.execute("UPDATE profile SET share_default='me' WHERE user_id=%s",(self.me,))
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/confirm',json={'confirm':True,'audience':'friends'}).status_code,409)
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/confirm',json={'confirm':True}).status_code,422)
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/confirm',json={'confirm':True,'audience':'me'}).status_code,200)
        with db.connect() as c:c.execute("UPDATE profile SET share_default='everyone' WHERE user_id=%s",(self.me,))
        real=U.activities.store;calls=[]
        def die_after_one(*a,**k):
            if calls:raise SystemExit('simulated process exit')
            calls.append(True);return real(*a,**k)
        with patch.object(U.activities,'store',side_effect=die_after_one):
            with self.assertRaises(SystemExit):self.process(identity)
        self.assertEqual(self.status(identity)['result']['added'],1)
        self.assertEqual(self.status(identity)['state'],'importing')
        restart="from app import db,strava_upload as U;import threading;uid,identity="+repr((self.me,identity))+";\nwith db.connect() as c:r=dict(U.owned(c,uid,identity))\nU.process(r,threading.Event())"
        subprocess.run([sys.executable,'-c',restart],check=True,timeout=45)
        self.assertEqual(self.status(identity)['state'],'done')
        self.assertEqual(self.status(identity)['result'],{'added':3,'already_here':0,'unreadable':1})
        with db.connect() as c:
            rows=c.execute('SELECT name,visibility FROM activities WHERE user_id=%s',(self.me,)).fetchall()
        self.assertEqual(len(rows),3);self.assertEqual({r['visibility'] for r in rows},{'me'},'audience captured at confirmation')
        self.assertFalse(U.path(self.me,identity).exists())
        # Existing edits/audience survive a repeated archive and late imports.
        with db.connect() as c:c.execute("UPDATE activities SET name='My edited run',visibility='friends' WHERE user_id=%s AND strava_id=101",(self.me,))
        again=self.ready();self.assertEqual(self.status(again)['preview'],{'added':0,'already_here':3,'unreadable':1})
        self.a.post(f'/api/strava-import/uploads/{again}/confirm',json={'confirm':True,'audience':'everyone'});self.process(again)
        self.assertEqual(self.status(again)['result'],{'added':0,'already_here':3,'unreadable':1})
        with db.connect() as c:self.assertEqual(dict(c.execute('SELECT name,visibility FROM activities WHERE user_id=%s AND strava_id=101',(self.me,)).fetchone()),{'name':'My edited run','visibility':'friends'})

    def test_quota_disk_expiry_and_deletion(self):
        identity,raw=self.create()
        with patch.object(U,'USER_JOBS',1):
            r=self.a.post('/api/strava-import/uploads',json={'id':str(uuid.uuid4()),'size':1,'sha256':'0'*64});self.assertEqual(r.status_code,429)
        with patch.object(U,'GLOBAL_JOBS',1):
            r=self.b.post('/api/strava-import/uploads',json={'id':str(uuid.uuid4()),'size':1,'sha256':'0'*64});self.assertEqual(r.status_code,429)
        with patch.object(U,'USER_BYTES',len(raw)):
            self.assertEqual(self.a.post('/api/strava-import/uploads',json={'id':str(uuid.uuid4()),'size':1,'sha256':'0'*64}).status_code,429)
        with patch.object(U,'GLOBAL_BYTES',len(raw)):
            self.assertEqual(self.b.post('/api/strava-import/uploads',json={'id':str(uuid.uuid4()),'size':1,'sha256':'0'*64}).status_code,429)
        with patch.object(U.shutil,'disk_usage',return_value=shutil._ntuple_diskusage(100*1024**3,90*1024**3,10*1024**3)):
            self.assertEqual(self.piece(identity,raw).status_code,507)
        self.assertEqual(self.piece(identity,raw).status_code,200)
        with db.connect() as c:c.execute("UPDATE strava_uploads SET expires=now()-interval '1 second' WHERE id=%s",(identity,))
        U.cleanup();self.assertFalse(U.path(self.me,identity).exists())
        self.assertEqual(self.a.get('/api/strava-import/stage').json()['upload'],None)
        identity,raw=self.create();self.piece(identity,raw)
        self.assertEqual(self.a.post('/api/account/delete',json={'password':PW}).status_code,200)
        self.assertFalse(U.path(self.me,identity).parent.exists())
        with db.connect() as c:
            for table in ('strava_import_stage','strava_uploads'):
                self.assertEqual(c.execute('SELECT count(*) AS n FROM '+table+' WHERE user_id=%s',(self.me,)).fetchone()['n'],0)

    def test_reminder_opt_in_dedupe_stop_and_cancellation(self):
        with patch.object(account_email,'mail_ready',return_value=True),patch.object(account_email,'_base',return_value='https://example.test'):
            self.assertEqual(self.a.put('/api/strava-import/stage',json={'reminder_opt_in':True}).status_code,200)
            self.assertFalse(S.send_reminder(),'not due for about 24h')
            with db.connect() as c:
                row=c.execute('SELECT * FROM strava_import_stage WHERE user_id=%s',(self.me,)).fetchone()
                self.assertAlmostEqual((row['reminder_due']-row['updated']).total_seconds(),86400,delta=2)
                c.execute("UPDATE strava_import_stage SET reminder_due=now()-interval '1 second' WHERE user_id=%s",(self.me,))
            self.a.put('/api/strava-import/stage',json={'reminder_opt_in':True})
            sent=[]
            with patch.object(account_email,'send',side_effect=lambda *args:sent.append(args) or True):
                self.assertTrue(S.send_reminder());self.assertFalse(S.send_reminder())
                self.a.put('/api/strava-import/stage',json={'reminder_opt_in':True});self.assertFalse(S.send_reminder())
            self.assertEqual(len(sent),1);self.assertIn('/me/connections?strava=resume',sent[0][2])
            from urllib.parse import urlsplit
            stop_url=sent[0][2].split('Stop this reminder: ')[1].strip()
            self.assertEqual(TestClient(app).get(urlsplit(stop_url).path+'?'+urlsplit(stop_url).query).status_code,200)
            with db.connect() as c:
                row=c.execute('SELECT * FROM strava_import_stage WHERE user_id=%s',(self.me,)).fetchone()
                self.assertFalse(row['reminder_opt_in']);self.assertIsNone(row['stop_hash'])
                c.execute('UPDATE users SET email_verified_at=NULL WHERE id=%s',(self.other,))
            self.assertEqual(self.b.put('/api/strava-import/stage',json={'reminder_opt_in':True}).status_code,409)
            self.assertEqual(self.a.delete('/api/strava-import/stage').status_code,200)

    def test_unrepresentable_activity_is_unreadable_not_a_stuck_job(self):
        raw=bundle()
        with zipfile.ZipFile(io.BytesIO(raw)) as before:
            out=io.BytesIO()
            with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as after:
                for name in before.namelist():
                    content=before.read(name)
                    if name=='activities.csv':content=content.replace(b'Fictional easy run,5,1800',b'Fictional easy run,5,1e308')
                    after.writestr(name,content)
        identity,raw=self.create(out.getvalue());self.piece(identity,raw)
        self.a.post(f'/api/strava-import/uploads/{identity}/finalize',json={});self.worker_once()
        self.assertEqual(self.status(identity)['preview'],{'added':2,'already_here':0,'unreadable':2})
        U.confirm(self.me,identity,'friends');self.worker_once()
        self.assertEqual(self.status(identity)['state'],'done')
        self.assertEqual(self.status(identity)['result'],{'added':2,'already_here':0,'unreadable':2})

    def test_corrupt_gzip_is_unreadable_and_next_job_runs(self):
        # Valid gzip header, invalid deflate block (BTYPE=3): specifically zlib.error.
        corrupt=gzip.compress(b'fictional')[:10]+b'\x07'+b'\0'*8
        with self.assertRaises(zlib.error):gzip.decompress(corrupt)
        raw=bundle({'activities/bad.fit.gz':corrupt})
        with zipfile.ZipFile(io.BytesIO(raw)) as before:
            out=io.BytesIO()
            with zipfile.ZipFile(out,'w') as after:
                for name in before.namelist():
                    value=before.read(name)
                    if name=='activities.csv':value=value.replace(b'activities/bad.fit,',b'activities/bad.fit.gz,')
                    after.writestr(name,value)
        identity,raw=self.create(out.getvalue());self.piece(identity,raw)
        self.a.post(f'/api/strava-import/uploads/{identity}/finalize',json={});self.worker_once()
        self.assertEqual(self.status(identity)['preview'],{'added':3,'already_here':0,'unreadable':1})
        U.confirm(self.me,identity,'friends');self.worker_once()
        self.assertEqual(self.status(identity)['state'],'done')
        self.assertEqual(self.status(identity)['result'],{'added':3,'already_here':0,'unreadable':1})
        # Unexpected item/outer failures are terminal too; only transient SQL is retried.
        poison,raw=self.create();self.piece(poison,raw)
        self.a.post(f'/api/strava-import/uploads/{poison}/finalize',json={})
        with patch.object(A,'items',side_effect=zlib.error('fictional poison')):self.assertTrue(self.worker_once())
        self.assertEqual(self.status(poison)['state'],'failed')
        self.assertEqual(self.status(poison)['error_code'],'processing_failed')
        healthy,raw=self.create();self.piece(healthy,raw)
        self.a.post(f'/api/strava-import/uploads/{healthy}/finalize',json={})
        self.assertTrue(self.worker_once())
        self.assertEqual(self.status(healthy)['state'],'review','a later healthy queued job progresses')

    def test_cleanup_keeps_receipt_until_removal_and_reconciles_deleted_account(self):
        identity,raw=self.create();self.piece(identity,raw);directory=U.path(self.me,identity).parent
        with db.connect() as c:c.execute("UPDATE strava_uploads SET expires=now()-interval '1 second' WHERE id=%s",(identity,))
        for error in (PermissionError,FileNotFoundError):
            with patch.object(U.shutil,'rmtree',side_effect=error('fictional filesystem failure')):U.cleanup()
            self.assertTrue(directory.exists())
            self.assertEqual(self.status(identity)['state'],'cancelled','failed cleanup retains its retry record')
        U.cleanup();self.assertFalse(directory.exists())
        with db.connect() as c:self.assertIsNone(c.execute('SELECT 1 FROM strava_uploads WHERE id=%s',(identity,)).fetchone())
        identity,raw=self.create();self.piece(identity,raw);directory=U.path(self.me,identity).parent
        unrelated=directory.parent/'legacy-upload';unrelated.mkdir()
        from app import api_account
        with patch.object(api_account.shutil,'rmtree',side_effect=PermissionError('fictional delayed erasure')):
            # Simulate process interruption after the existing SQL cascade, before file erasure.
            with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(self.me,))
            U.cleanup()
        self.assertTrue(directory.exists())
        U.cleanup();self.assertFalse(directory.exists());self.assertTrue(unrelated.exists())

    def test_resume_starts_at_cursor_without_scanning_completed_items(self):
        identity=self.ready();U.confirm(self.me,identity,'friends')
        with db.connect() as c:c.execute("UPDATE strava_uploads SET cursor=9999,result='{}'::jsonb||%s::jsonb WHERE id=%s",(json.dumps({'added':9999,'already_here':0,'unreadable':0}),identity))
        # A valid final manual entry; no prefix enumeration or per-prefix SQL read is allowed.
        with A.open_archive(U.path(self.me,identity)) as z:tail=A.items(z)[0]
        class Entries:
            def __len__(self):return 10000
            def __getitem__(self,index):
                if index!=9999:raise AssertionError('Completed items must not be visited')
                return tail
        real=U.owned;reads=[]
        def counted(*args,**kw):reads.append(True);return real(*args,**kw)
        with patch.object(U,'owned',side_effect=counted):U.import_items(self.me,identity,Entries(),threading.Event())
        self.assertEqual(len(reads),3,'one cursor read, one locked item read, one completion read')
        self.assertEqual(self.status(identity)['state'],'done')
        self.assertEqual(self.status(identity)['result']['added'],10000)

    def test_stale_cursor_is_rechecked_under_write_lock(self):
        identity=self.ready();U.confirm(self.me,identity,'friends');real=A.parse_item
        def advanced(*args):
            value=real(*args)
            with db.connect() as c:c.execute("UPDATE strava_uploads SET cursor=1,result=%s WHERE id=%s",(json.dumps({'added':1,'already_here':0,'unreadable':0}),identity))
            return value
        with patch.object(A,'parse_item',side_effect=advanced),patch.object(U.activities,'store',side_effect=AssertionError('Stale worker must not store')):
            self.process(identity)
        with db.connect() as c:self.assertEqual(U.owned(c,self.me,identity)['cursor'],1)
        self.assertEqual(self.status(identity)['result']['added'],1)
        self.assertEqual(self.status(identity)['state'],'importing')

    def test_lost_worker_session_cannot_commit_then_successor_resumes(self):
        identity=self.ready();U.confirm(self.me,identity,'friends')
        # Separate disposable SQL session: kill it after a parse and after an insert.
        for phase in ('parsed','inserted'):
            with self.subTest(phase=phase):
                lease=psycopg.connect(db.CONNINFO,row_factory=psycopg.rows.dict_row)
                key='zz_test_strava_lease_'+secrets.token_hex(8)
                lease.execute('SELECT pg_advisory_lock(hashtextextended(%s,0))',(key,));lease.commit()
                pid=lease.info.backend_pid
                def terminate():
                    with psycopg.connect(db._conninfo('postgres',db.secret('POSTGRES_PASSWORD')),autocommit=True) as admin:
                        self.assertTrue(admin.execute('SELECT pg_terminate_backend(%s)',(pid,)).fetchone()[0])
                target=A if phase=='parsed' else U.activities;method='parse_item' if phase=='parsed' else 'store';real=getattr(target,method)
                def killed(*args,**kw):
                    value=real(*args,**kw);terminate();return value
                with db.connect() as c:r=dict(U.owned(c,self.me,identity))
                try:
                    with patch.object(target,method,side_effect=killed),self.assertRaises(psycopg.Error):
                        U.process(r,threading.Event(),lease)
                finally:lease.close()
                with db.connect() as c:
                    self.assertEqual(U.owned(c,self.me,identity)['cursor'],0)
                    self.assertEqual(c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s',(self.me,)).fetchone()['n'],0)
                    self.assertTrue(c.execute('SELECT pg_try_advisory_xact_lock(hashtextextended(%s,0)) AS ok',(key,)).fetchone()['ok'])
        self.process(identity)
        self.assertEqual(self.status(identity)['result'],{'added':3,'already_here':0,'unreadable':1})

    def test_receive_deadlines_and_per_account_slot_release(self):
        identity,raw=self.create();other,other_raw=self.create(raw,client=self.b)
        async def exercise():
            started=asyncio.Event()
            class Body:
                headers={'x-content-sha256':hashlib.sha256(raw).hexdigest()}
                def __init__(self,kind):self.kind=kind
                async def stream(self):
                    if self.kind=='idle':
                        started.set();yield raw[:1];await asyncio.Event().wait()
                    elif self.kind=='drip':
                        while True:
                            yield b'x';await asyncio.sleep(.03)
                    else:yield raw
            with patch.object(API,'_piece_slots',asyncio.Semaphore(2)),patch.object(API,'_piece_accounts',set()),patch.object(API,'PIECE_IDLE_SECONDS',.1),patch.object(API,'PIECE_RECEIVE_SECONDS',.4):
                stalled=asyncio.create_task(API.piece(uuid.UUID(identity),0,Body('idle'),{'id':self.me}))
                await asyncio.wait_for(started.wait(),1)
                with self.assertRaises(HTTPException) as busy:await API.piece(uuid.UUID(identity),0,Body('normal'),{'id':self.me})
                self.assertEqual(busy.exception.status_code,429)
                self.assertEqual((await API.piece(uuid.UUID(other),0,Body('normal'),{'id':self.other}))['received'],len(other_raw))
                with self.assertRaises(HTTPException) as idle:await stalled
                self.assertEqual(idle.exception.status_code,408)
                self.assertFalse(API._piece_accounts);self.assertEqual(API._piece_slots._value,2)
                with patch.object(API,'PIECE_RECEIVE_SECONDS',.15):
                    with self.assertRaises(HTTPException) as total:await API.piece(uuid.UUID(identity),0,Body('drip'),{'id':self.me})
                self.assertEqual(total.exception.status_code,408)
                self.assertEqual(self.status(identity)['received'],0,'timed-out bodies never append partial bytes')
                self.assertEqual((await API.piece(uuid.UUID(identity),0,Body('normal'),{'id':self.me}))['received'],len(raw))
                self.assertFalse(API._piece_accounts);self.assertEqual(API._piece_slots._value,2)
        asyncio.run(exercise())

    def test_crash_inside_workout_transaction_rolls_back_cursor_and_activity(self):
        identity=self.ready();U.confirm(self.me,identity,'friends')
        real=U.activities.store
        def crash(*args,**kw):
            real(*args,**kw)
            raise SystemExit('simulated exit before cursor commit')
        with patch.object(U.activities,'store',side_effect=crash):
            with self.assertRaises(SystemExit):self.process(identity)
        with db.connect() as c:
            self.assertEqual(U.owned(c,self.me,identity)['cursor'],0)
            self.assertEqual(c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s',(self.me,)).fetchone()['n'],0)
        self.process(identity);self.assertEqual(self.status(identity)['result']['added'],3)

    def test_late_duplicate_and_confirmation_and_cancel_idempotency(self):
        identity=self.ready()
        # A watch upload lands after the preview; a match must be checked again, not blindly added.
        from app import parsers
        parsed={'sport':'run','sub_sport':None,'start':dt.datetime(2025,11,1,8,tzinfo=dt.timezone.utc),
          'device':None,'laps':[],'session':{'elapsed_s':1800,'distance_m':5000},'streams':{k:[] for k in ('t',)+parsers.STREAMS}}
        U.activities.store(self.me,parsed,{'name':'My watch title'},source='healthkit',visibility='me')
        for _ in range(2):self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/confirm',json={'confirm':True,'audience':'friends'}).status_code,200)
        self.process(identity)
        self.assertEqual(self.status(identity)['result'],{'added':2,'already_here':1,'unreadable':1})
        with db.connect() as c:
            watched=c.execute("SELECT name,visibility FROM activities WHERE user_id=%s AND source='healthkit'",(self.me,)).fetchone()
            self.assertEqual(dict(watched),{'name':'My watch title','visibility':'me'})
        self.assertEqual(self.a.post(f'/api/strava-import/uploads/{identity}/confirm',json={'confirm':True,'audience':'friends'}).status_code,200)
        second,raw=self.create();self.piece(second,raw)
        for _ in range(2):self.assertEqual(self.a.delete('/api/strava-import/uploads/'+second).status_code,200)
        self.assertEqual(self.piece(second,raw).status_code,409)
        self.assertFalse(U.path(self.me,second).exists())

    def test_reminder_all_stop_paths_and_failed_send_are_single_attempt(self):
        with patch.object(account_email,'mail_ready',return_value=True),patch.object(account_email,'_base',return_value='https://example.test'):
            for reason in ('stop','cancel','unverified','confirmed','failed'):
                with self.subTest(reason=reason):
                    with db.connect() as c:
                        c.execute('DELETE FROM strava_import_stage WHERE user_id=%s',(self.me,))
                        c.execute('UPDATE users SET email_verified_at=now() WHERE id=%s',(self.me,))
                    S.save(self.me,True)
                    with db.connect() as c:c.execute("UPDATE strava_import_stage SET reminder_due=now()-interval '1 second',stop_hash=%s WHERE user_id=%s",(hashlib.sha256(b'fictional-stop-token-long-enough').hexdigest(),self.me))
                    if reason=='stop':S.stop('fictional-stop-token-long-enough')
                    elif reason=='cancel':S.cancel(self.me)
                    elif reason=='unverified':
                        with db.connect() as c:c.execute('UPDATE users SET email_verified_at=NULL WHERE id=%s',(self.me,))
                    elif reason=='confirmed':
                        identity=self.ready();U.confirm(self.me,identity,'friends')
                    calls=[]
                    with patch.object(account_email,'send',side_effect=lambda *args:calls.append(args) or False):
                        self.assertFalse(S.send_reminder());self.assertFalse(S.send_reminder())
                    self.assertEqual(len(calls),1 if reason=='failed' else 0)
                    if reason=='confirmed':S.cancel(self.me)
            S.save(self.other,True)
            with db.connect() as c:c.execute("UPDATE strava_import_stage SET reminder_due=now()-interval '1 second' WHERE user_id=%s",(self.other,))
            self.assertEqual(self.b.post('/api/account/delete',json={'password':PW}).status_code,200)
            self.assertFalse(S.send_reminder())

    def test_reminder_rechecks_due_and_expiry_after_selection_and_before_send(self):
        real_account=U.account
        with patch.object(account_email,'mail_ready',return_value=True),patch.object(account_email,'_base',return_value='https://example.test'):
            for reason in ('claim_due','claim_no_due','claim_expired','send_expired'):
                with self.subTest(reason=reason):
                    with db.connect() as c:c.execute('DELETE FROM strava_import_stage WHERE user_id=%s',(self.me,))
                    S.save(self.me,True)
                    with db.connect() as c:c.execute("UPDATE strava_import_stage SET reminder_due=now()-interval '1 second' WHERE user_id=%s",(self.me,))
                    locks=[];sent=[]
                    def account(c,uid):
                        locks.append(uid)
                        if len(locks)==(2 if reason=='send_expired' else 1):
                            # A concurrent stage change after candidate selection, or
                            # between the committed claim and the actual send lock.
                            change={
                              'claim_due':"reminder_due=now()+interval '1 day'",
                              'claim_no_due':'reminder_due=NULL',
                              'claim_expired':"expires=now()-interval '1 second'",
                              'send_expired':"expires=now()-interval '1 second'"}[reason]
                            with db.connect() as other:other.execute('UPDATE strava_import_stage SET '+change+' WHERE user_id=%s',(uid,))
                        real_account(c,uid)
                    with patch.object(U,'account',side_effect=account),patch.object(account_email,'send',side_effect=lambda *args:sent.append(args) or True):
                        self.assertFalse(S.send_reminder())
                    self.assertEqual(sent,[])
                    with db.connect() as c:
                        stage=c.execute('SELECT reminder_attempted,reminder_sent FROM strava_import_stage WHERE user_id=%s',(self.me,)).fetchone()
                    self.assertEqual(stage['reminder_attempted'] is not None,reason=='send_expired','only an eligible locked row may consume the one attempt')
                    self.assertFalse(stage['reminder_sent'])

    def test_original_upload_still_imports(self):
        import time
        # Legacy endpoint and its callback retain their original contract; this stand-in cannot call a provider.
        with patch.object(coach,'after_import',return_value=None):
            del self.a.headers['Content-Type']
            response=self.a.post('/api/import',files={'files':('fictional.zip',bundle(),'application/zip')})
            self.a.headers['Content-Type']='application/json'
            self.assertEqual(response.status_code,200,response.text)
            job=response.json()['job'];last=None
            for _ in range(100):
                with db.connect() as c:last=c.execute('SELECT status,added,failed FROM imports WHERE id=%s AND user_id=%s',(job,self.me)).fetchone()
                if last['status'] in ('done','failed'):break
                time.sleep(.05)
            self.assertEqual((last['status'],last['added'],last['failed']),('done',3,1))

    def test_rls_and_actual_migration_replay(self):
        first,_=self.create();second,_=self.create(client=self.b)
        from app import db as D
        # Actual preceding migrations remain unchanged; rerunning this migration preserves identities/data.
        with db.connect() as c:
            before=c.execute('SELECT id,user_id FROM strava_uploads ORDER BY id').fetchall()
            c.execute(D.MIGRATIONS[-1]);c.execute(D.MIGRATIONS[-1])
            self.assertEqual(c.execute('SELECT id,user_id FROM strava_uploads ORDER BY id').fetchall(),before)
            with self.assertRaises(psycopg.errors.ForeignKeyViolation):
                with c.transaction():c.execute('UPDATE strava_import_stage SET upload_id=%s WHERE user_id=%s',(second,self.me))
        role='zz_test_strava_sql_'+secrets.token_hex(4)
        with psycopg.connect(db._conninfo('postgres',db.secret('POSTGRES_PASSWORD')),autocommit=True) as admin:
            admin.execute(sql.SQL('CREATE ROLE {} LOGIN').format(sql.Identifier(role)))
            try:
                admin.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
                admin.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.me))
                admin.execute(sql.SQL('SET SESSION AUTHORIZATION {}').format(sql.Identifier(role)))
                for table in ('strava_uploads','strava_import_stage'):
                    rows=admin.execute('SELECT user_id FROM public.'+table).fetchall();self.assertEqual({r[0] for r in rows},{self.me})
                    with self.assertRaises(psycopg.errors.InsufficientPrivilege):admin.execute('DELETE FROM public.'+table)
            finally:
                admin.execute('RESET SESSION AUTHORIZATION');admin.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.me,))
                admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))


if __name__=='__main__':unittest.main()
