"""Real database rollback after the second photo fails; no provider/device actions or personal records."""
import base64
import datetime as dt
import io
from pathlib import Path
import shutil
import uuid
import threading
import time
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from app import api_photos, api_account, auth, activities, db
from app.main import app

def photo_erasure_lock_order(prepared):
    """A photo holding its activity must finish before erasure can take the account; never invert their locks."""
    with db.connect() as c:
        uid = c.execute("INSERT INTO users(login,name) VALUES(%s,'Fictional photo lock') RETURNING id", ('zz_test_photolock_' + uuid.uuid4().hex[:12],)).fetchone()['id']
        c.execute('INSERT INTO profile(user_id) VALUES(%s)', (uid,))
        aid = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source) VALUES(%s,'run','Fictional lock test',now(),'manual') RETURNING id", (uid,)).fetchone()['id']
    ready, release, entered = (threading.Event(), threading.Event(), threading.Event())
    pid = []

    def upload():
        with db.connect() as c:
            c.execute("SET statement_timeout='8s'")
            api_photos.lock_activity_photos(c, uid)
            c.execute('SELECT id FROM activities WHERE id=%s FOR UPDATE', (aid,))
            ready.set()
            assert release.wait(6)
            api_photos.insert_activity_photo(c, aid, uid, prepared)

    def erase():
        assert ready.wait(5)
        with db.connect() as c:
            c.execute("SET statement_timeout='8s'")
            pid.append(c.execute('SELECT pg_backend_pid() AS pid').fetchone()['pid'])
            entered.set()
            c.execute('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE')
            api_account.erase(c, {'id': uid, 'sql_role': None})
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            photo_future = pool.submit(upload)
            erase_future = pool.submit(erase)
            assert entered.wait(5)
            blocked = False
            try:
                for _ in range(200):
                    with db.connect() as c:
                        r = c.execute('SELECT wait_event_type FROM pg_stat_activity WHERE pid=%s', (pid[0],)).fetchone()
                    if r and r['wait_event_type'] == 'Lock':
                        blocked = True
                        break
                    time.sleep(0.02)
            finally:
                release.set()
            assert blocked, 'erasure reaches the competing database lock'
            errors = []
            for future in [photo_future, erase_future]:
                try:
                    future.result(timeout=10)
                except Exception as e:
                    errors.append(type(e).__name__)
            assert not errors, errors
            with db.connect() as c:
                try:
                    api_photos.lock_activity_photos(c, uid)
                except HTTPException as e:
                    assert e.status_code == 404
                else:
                    raise AssertionError('An erased account cannot acquire photo write access')
    finally:
        release.set()
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=%s', (uid,))


uid = None
client = None
try:
    login = 'zz_test_track_atomic_' + uuid.uuid4().hex[:10]
    with db.connect() as c:
        uid = c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                        (login, 'Fictional Recorder', auth.hash_pw('green teapot on the hill'))).fetchone()['id']
        c.execute('INSERT INTO profile(user_id) VALUES(%s)', (uid,))
    client = TestClient(app, raise_server_exceptions=False)
    client.headers['Origin'] = 'http://testserver'
    response = client.post('/api/login', json={'login': login, 'password': 'green teapot on the hill', 'app': True})
    assert response.status_code == 200
    client.headers['Authorization'] = 'Bearer ' + response.json()['token']
    im = Image.new('RGB', (16, 12), 'teal')
    exif = im.getexif();exif[0x0110] = 'FictionalCameraWithGPSMetadata'
    data = io.BytesIO();im.save(data, 'JPEG', exif=exif)
    image = base64.b64encode(data.getvalue()).decode()
    payload = {'client_id': str(uuid.uuid4()), 'sport': 'run', 'name': 'Fictional atomic run',
               'start': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=3)).isoformat(),
               'elapsed_s': 60, 'moving_s': 60, 'points': [], 'visibility': 'me', 'review_version': 1,
               'photos': [image, image]}
    original, calls = api_photos.insert_activity_photo, []

    def fail_second(*args):
        calls.append(1)
        if len(calls) == 2:
            raise HTTPException(503, 'Fictional interrupted second photo')
        return original(*args)

    with patch.object(api_photos, 'insert_activity_photo', side_effect=fail_second):
        assert client.post('/api/activities/track', json=payload).status_code == 503
    assert len(calls) == 2, 'failure occurs after one photo and the activity have actually been inserted'
    with db.connect() as c:
        for table in ('activities', 'activity_photos', 'track_recording_receipts'):
            assert c.execute(f'SELECT count(*) AS n FROM {table} WHERE user_id=%s', (uid,)).fetchone()['n'] == 0, table
    folder = Path(activities.DATA) / 'files' / str(uid)
    assert not list(folder.glob('*.json')), 'failed review does not retain its newly written raw GPS file'
    saved = client.post('/api/activities/track', json=payload)
    assert saved.status_code == 200
    aid = saved.json()['id']
    detail = client.get(f'/api/activities/{aid}').json()
    assert len(detail['photos']) == 2
    pixels = client.get('/api/activity-photos/' + str(detail['photos'][0]['id'])).content
    assert b'FictionalCameraWithGPSMetadata' not in pixels and b'Exif' not in pixels
    assert 'photos' not in __import__('json').loads(next(folder.glob('*.json')).read_bytes()), 'raw GPS file does not duplicate photo pixels'
    assert client.post('/api/activities/track', json=payload).json() == {'id': aid, 'duplicate': True}
    assert len(client.get(f'/api/activities/{aid}').json()['photos']) == 2
    # Different recordings share one person-wide photo quota; exactly one may take the remaining slot.
    with patch.object(api_photos, 'PER_PERSON', 3):
        bodies = [dict(payload, client_id=str(uuid.uuid4()), photos=[image]) for _ in range(4)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda body: client.post('/api/activities/track', json=body).status_code, bodies))
        assert sorted(results) == [200, 400, 400, 400], results
    with db.connect() as c:
        assert c.execute('SELECT count(*) AS n FROM activity_photos WHERE user_id=%s', (uid,)).fetchone()['n'] == 3
        assert c.execute('SELECT count(*) AS n FROM activities WHERE user_id=%s', (uid,)).fetchone()['n'] == 2
        assert c.execute('SELECT count(*) AS n FROM track_recording_receipts WHERE user_id=%s', (uid,)).fetchone()['n'] == 2
    assert len(list(folder.glob('*.json'))) == 2
    photo_erasure_lock_order(api_photos.prepare_activity_photo(api_photos.PhotoIn(image=image)))
    print('PASS concurrent photo upload and account erasure follow account-first locking')
    print('PASS mid-save rollback, raw-file cleanup, exact retry, photo metadata stripping and no duplicate pixels')
finally:
    if client: client.close()
    if uid:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s', (uid,))
        shutil.rmtree(Path(activities.DATA) / 'files' / str(uid), ignore_errors=True)
