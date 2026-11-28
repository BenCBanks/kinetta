"""Fictional photo intentions; real transactions, HTTP, export/deletion and SQL readers. No providers."""
import base64
import io
import json
import tempfile
import threading
import time
import unittest
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import psycopg
from psycopg import sql
from PIL import Image
from fastapi import HTTPException
from fastapi.testclient import TestClient
from app import api_photos as P, api_mydata as E, api_account as A, auth, db
from app.main import app


def pixels(colour='blue'):
    out=io.BytesIO();Image.new('RGB',(12,10),colour).save(out,'JPEG')
    return base64.b64encode(out.getvalue()).decode()


class PhotoReplay(unittest.TestCase):
    def setUp(self):
        self.users=[];self.aids=[];self.clients=[];self.image=pixels();self.key=str(uuid.uuid4())
        with db.connect() as c:
            for n in range(2):
                login='zz_test_phretry_'+uuid.uuid4().hex[:12]
                user=c.execute("INSERT INTO users(login,name,pw_hash,email_verified_at) VALUES(%s,'Fictional Retry',%s,now()) RETURNING id,login::text,sql_role",(login,auth.hash_pw('fictional photo retry password'))).fetchone()
                self.users.append(user);c.execute('INSERT INTO profile(user_id) VALUES(%s)',(user['id'],))
                self.aids.append(c.execute("INSERT INTO activities(user_id,sport,start_time,name,source) VALUES(%s,'run',now(),'Fictional retry run','manual') RETURNING id",(user['id'],)).fetchone()['id'])
        for user in self.users:
            client=TestClient(app,headers={'Origin':'http://testserver'});self.clients.append(client)
            self.assertEqual(client.post('/api/login',json={'login':user['login'],'password':'fictional photo retry password'}).status_code,200)

    def tearDown(self):
        for client in self.clients:client.close()
        with db.connect() as c:
            for user in self.users:A.erase(c,user)

    def send(self,n=0,key=None,image=None,aid=None):
        return self.clients[n].post(f'/api/activities/{aid or self.aids[n]}/photos',json={'client_id':key or self.key,'image':image or self.image})

    def count(self,table='activity_photos',n=0):
        with db.connect() as c:return c.execute(sql.SQL('SELECT count(*) AS n FROM {} WHERE user_id=%s').format(sql.Identifier(table)),(self.users[n]['id'],)).fetchone()['n']

    def test_lost_reply_limits_and_no_repeat_decode(self):
        first=self.send();self.assertEqual(first.status_code,200,first.text)  # Caller loses this response.
        with patch.object(P,'prepare_activity_photo',side_effect=AssertionError('replay must not decode')),patch.object(P,'PER_ACTIVITY',1):
            retry=self.send();self.assertEqual(retry.status_code,200,retry.text);self.assertEqual(retry.json(),first.json())
        self.assertEqual(self.count(),1);self.assertEqual(self.count('photo_upload_receipts'),1)
        self.assertEqual(self.send(image=pixels('red')).status_code,409)
        self.assertEqual(self.send(aid=self.aids[1]).status_code,409)
        self.assertEqual(self.send(key='not-a-uuid').status_code,422)
        self.assertEqual(self.count(),1)

    def test_concurrent_retries_commit_one_photo(self):
        barrier=threading.Barrier(2);prepared=P.prepare_activity_photo(P.PhotoIn(image=self.image))
        def prepare(_):barrier.wait(timeout=5);return prepared
        def upload(_):
            # Explicit non-admission can win the race before the receipt lock.
            # Retry only that exact response; both admitted writers still meet at prepare.
            for attempt in range(20):
                try:return P.add_activity_photo(self.aids[0],P.PhotoIn(image=self.image,client_id=self.key),self.users[0])
                except HTTPException as error:
                    if error.status_code!=503 or error.detail!='Kinetta is busy. Please try again shortly.':raise
                    self.assertEqual(error.headers,{'Retry-After':'2'})
                    if attempt==19:raise
                    time.sleep(.01)
        with patch.object(P,'prepare_activity_photo',side_effect=prepare),ThreadPoolExecutor(max_workers=2) as pool:
            saved=list(pool.map(upload,range(2)))
        self.assertEqual(saved[0],saved[1]);self.assertEqual(self.count(),1);self.assertEqual(self.count('photo_upload_receipts'),1)

    def test_owner_scope_and_new_intentions(self):
        first=self.send();self.assertEqual(first.status_code,200)
        self.assertEqual(self.send(n=1,aid=self.aids[0]).status_code,404)
        other=self.send(n=1);self.assertEqual(other.status_code,200);self.assertNotEqual(other.json()['id'],first.json()['id'])
        self.assertEqual(self.send(key=str(uuid.uuid4())).status_code,200,'same pixels, new intention is allowed')
        self.assertEqual(self.count(),2);self.assertEqual(self.count(n=1),1)

    def test_removal_and_activity_deletion_do_not_resurrect(self):
        first=self.send().json();self.assertEqual(self.clients[0].request('DELETE','/api/activity-photos/'+str(first['id']),json={}).status_code,200)
        self.assertEqual(self.send().status_code,410);self.assertEqual(self.count(),0);self.assertEqual(self.count('photo_upload_receipts'),1)
        self.assertEqual(self.clients[0].request('DELETE','/api/activities/'+str(self.aids[0]),json={}).status_code,200)
        self.assertEqual(self.send().status_code,410);self.assertEqual(self.count('photo_upload_receipts'),1)

    def test_expiry_cleanup_and_bounded_count(self):
        self.assertEqual(self.send().status_code,200)
        with patch.object(P,'MAX_REPLAY_RECEIPTS',1):
            self.assertEqual(self.send().status_code,200,'quota never evicts an accepted intention')
            self.assertEqual(self.send(key=str(uuid.uuid4())).status_code,429)
        with db.connect() as c:c.execute("UPDATE photo_upload_receipts SET created=now()-interval '8 days',expires=now()-interval '1 day' WHERE user_id=%s",(self.users[0]['id'],))
        with db.connect() as c:
            c.execute("INSERT INTO photo_upload_receipts(user_id,client_id,request_hash,created,expires) SELECT %s,md5(i::text)::uuid,repeat('0',64),now()-interval '8 days',now()-interval '1 day' FROM generate_series(1,1000)i",(self.users[0]['id'],))
        self.assertEqual(P.prune_photo_receipts(),1000,'cleanup has a bounded batch')
        self.assertEqual(self.count('photo_upload_receipts'),1)
        self.assertEqual(P.prune_photo_receipts(),1);self.assertEqual(self.count('photo_upload_receipts'),0,'inactive accounts expire too')
        with db.connect() as c:
            with self.assertRaises(psycopg.errors.CheckViolation),c.transaction():
                c.execute("INSERT INTO photo_upload_receipts(user_id,client_id,request_hash,expires) VALUES(%s,%s,repeat('0',64),now()+interval '8 days')",(self.users[0]['id'],self.key))
        # Protection is explicitly seven days; a deliberate request after expiry is new.
        self.assertEqual(self.send().status_code,200);self.assertEqual(self.count(),2)

    def test_failure_is_atomic_and_legacy_clients_work(self):
        with patch.object(P,'insert_activity_photo',side_effect=RuntimeError('fictional rollback')):
            with self.assertRaises(RuntimeError):self.send()
        self.assertEqual(self.count(),0);self.assertEqual(self.count('photo_upload_receipts'),0)
        self.assertEqual(self.send().status_code,200)
        r=self.clients[0].post(f'/api/activities/{self.aids[0]}/photos',json={'image':self.image})
        self.assertEqual(r.status_code,200);self.assertEqual(self.count(),2)

    def test_receipt_failure_after_photo_insert_rolls_back_both(self):
        # Fail the real receipt INSERT after observing the photo in its transaction.
        name='zz_test_receipt_failure_'+uuid.uuid4().hex[:12]
        inserted=[];real_insert=P.insert_activity_photo
        def insert(c,aid,uid,prepared):
            saved=real_insert(c,aid,uid,prepared)
            self.assertIsNotNone(c.execute('SELECT 1 FROM activity_photos WHERE id=%s',(saved['id'],)).fetchone())
            inserted.append(saved['id'])
            return saved
        with db.connect() as c:
            c.execute(sql.SQL("CREATE FUNCTION {}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fictional receipt failure' USING ERRCODE='23514'; END $$").format(sql.Identifier(name)))
            c.execute(sql.SQL('CREATE TRIGGER {} BEFORE INSERT ON photo_upload_receipts FOR EACH ROW WHEN (NEW.user_id={}) EXECUTE FUNCTION {}()').format(sql.Identifier(name),sql.Literal(self.users[0]['id']),sql.Identifier(name)))
        try:
            with patch.object(P,'insert_activity_photo',side_effect=insert):
                with self.assertRaisesRegex(psycopg.errors.CheckViolation,'fictional receipt failure'):
                    self.send()
            self.assertEqual(len(inserted),1,'the photo INSERT succeeded before the receipt failed')
            self.assertEqual(self.count(),0)
            self.assertEqual(self.count('photo_upload_receipts'),0)
        finally:
            with db.connect() as c:
                c.execute(sql.SQL('DROP TRIGGER {} ON photo_upload_receipts').format(sql.Identifier(name)))
                c.execute(sql.SQL('DROP FUNCTION {}()').format(sql.Identifier(name)))
        self.assertEqual(self.send().status_code,200,'the same intention remains retryable')
        self.assertEqual(self.count(),1);self.assertEqual(self.count('photo_upload_receipts'),1)

    def test_unconfirmed_and_suspended_cannot_replay(self):
        self.assertEqual(self.send().status_code,200)
        with db.connect() as c:c.execute('UPDATE users SET needs_email_confirm=true,email_verified_at=NULL WHERE id=%s',(self.users[0]['id'],))
        self.assertEqual(self.send().status_code,403)
        with db.connect() as c:c.execute('UPDATE users SET needs_email_confirm=false,suspended_at=now() WHERE id=%s',(self.users[0]['id'],))
        self.assertEqual(self.send().status_code,401)
        self.assertEqual(self.count(),1)

    def test_export_erasure_and_sql_isolation(self):
        self.assertEqual(self.send().status_code,200);self.assertEqual(self.send(n=1).status_code,200)
        role='zz_test_photosql_'+uuid.uuid4().hex[:12]
        try:
            with db.connect() as c:
                c.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role),sql.Literal('fictional SQL password')))
                c.execute(sql.SQL('GRANT fit_readers TO {}').format(sql.Identifier(role)))
                c.execute('UPDATE users SET sql_role=%s WHERE id=%s',(role,self.users[0]['id']))
            with psycopg.connect(db._conninfo(role,'fictional SQL password')) as reader:
                rows=reader.execute('SELECT user_id,client_id FROM photo_upload_receipts').fetchall()
                self.assertEqual(rows,[(self.users[0]['id'],uuid.UUID(self.key))])
        finally:
            with db.connect() as c:
                c.execute('UPDATE users SET sql_role=NULL WHERE id=%s',(self.users[0]['id'],))
            with db.connect() as c:c.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role)))
        with tempfile.TemporaryDirectory() as folder:
            target=folder+'/export.zip';E._write_export(self.users[0]['id'],target)
            with zipfile.ZipFile(target) as z:rows=[json.loads(line) for line in z.read('data/photo_upload_receipts.jsonl').splitlines()]
            self.assertEqual(len(rows),1);self.assertEqual(rows[0]['client_id'],self.key);self.assertEqual(rows[0]['activity_id'],self.aids[0]);self.assertNotIn('user_id',rows[0]);self.assertNotIn('image',rows[0])
        with db.connect() as c:A.erase(c,self.users[0])
        self.assertEqual(self.count('photo_upload_receipts'),0);self.assertEqual(self.count(),0);self.assertEqual(self.count('photo_upload_receipts',n=1),1)


if __name__=='__main__':unittest.main()
