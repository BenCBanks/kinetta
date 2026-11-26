"""Fictional upload safety: actual SQL budgets, decode boundaries and hidden profile reads. No provider calls."""
import base64
import io
import uuid
import warnings
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from app import api_photos as P, db
from app.auth import current_user
from app.main import app


def image(fmt='JPEG', size=(12, 10)):
    out = io.BytesIO()
    im = Image.new('RGB', size, 'green')
    exif = Image.Exif(); exif[271] = 'FictionalCameraLocationSentinel'
    im.save(out, fmt, **({'exif': exif} if fmt in ('JPEG', 'WEBP') else {}))
    return base64.b64encode(out.getvalue()).decode()


uids = []
try:
    with db.connect() as c:
        for label in ('a', 'b'):
            uid = c.execute("INSERT INTO users(login,name) VALUES(%s,'Fictional Photo Tester') RETURNING id",
                            ('zz_test_photo_safety_' + label + uuid.uuid4().hex[:8],)).fetchone()['id']
            uids.append(uid)
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (uid,))
        aid = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source) VALUES(%s,'run','Fictional run',now(),'manual') RETURNING id", (uids[0],)).fetchone()['id']
    active = {'id': uids[0]}
    app.dependency_overrides[current_user] = lambda: active
    with TestClient(app, headers={'Content-Type': 'application/json'}) as client:
        # All supported formats are decoded and re-encoded, including files carrying metadata.
        for fmt in ('JPEG', 'PNG', 'WEBP'):
            raw = image(fmt)
            r = client.put('/api/me/photo', json={'image': raw})
            assert r.status_code == 200, r.text
            response = client.get('/api/people/zz_test_invalid/photo')
            assert response.status_code == 404
            with db.connect() as c:
                saved = bytes(c.execute('SELECT img FROM profile_photos WHERE user_id=%s', (uids[0],)).fetchone()['img'])
            reopened = Image.open(io.BytesIO(saved))
            assert reopened.format == 'JPEG' and reopened.size == (512, 512)
            assert not reopened.getexif() and b'FictionalCameraLocationSentinel' not in saved
        # Pixel limit is a hard boundary, not Pillow's soft warning (no huge allocation needed).
        with patch.object(P.Image, 'MAX_IMAGE_PIXELS', 100), warnings.catch_warnings():
            warnings.simplefilter('ignore', Image.DecompressionBombWarning)
            assert client.put('/api/me/photo', json={'image': image(size=(10, 10))}).status_code == 200
            assert client.put('/api/me/photo', json={'image': image(size=(11, 10))}).status_code == 400
            assert client.put('/api/me/photo', json={'image': image(size=(21, 10))}).status_code == 400
        assert client.put('/api/me/photo', json={'image': base64.b64encode(b'<svg>fictional</svg>').decode()}).status_code == 400
        # Direct URLs hide suspended/unconfirmed owners too, while permitting their own existing photo.
        with db.connect() as c:
            login = c.execute('SELECT login FROM users WHERE id=%s', (uids[0],)).fetchone()['login']
        for assignment in ('needs_email_confirm=true', 'suspended_at=now()'):
            with db.connect() as c: c.execute('UPDATE users SET '+assignment+' WHERE id=%s', (uids[0],))
            assert client.get('/api/people/'+login+'/photo').status_code == 200
            active = {'id': uids[1]}
            assert client.get('/api/people/'+login+'/photo').status_code == 404
            active = {'id': uids[0]}
            with db.connect() as c: c.execute('UPDATE users SET needs_email_confirm=false,suspended_at=NULL WHERE id=%s', (uids[0],))
        # Failed decoding consumes a committed budget, not a rollback-refunded attempt.
        with db.connect() as c: c.execute('DELETE FROM auth_attempts WHERE key=%s', (f'photo-upload:{uids[0]}',))
        with patch.object(P, 'UPLOADS_PER_MINUTE', 2):
            assert client.put('/api/me/photo', json={'image': image()}).status_code == 200
            assert client.post(f'/api/activities/{aid}/photos', json={'image': 'not-an-image'}).status_code == 400
            r = client.post(f'/api/activities/{aid}/photos', json={'image': image()})
            assert r.status_code == 429 and r.headers['retry-after'] == '60'
            active = {'id': uids[1]}
            assert client.put('/api/me/photo', json={'image': image()}).status_code == 200
            active = {'id': uids[0]}
            assert client.delete('/api/me/photo').status_code == 200, 'removal is never upload-limited'
    # Actual advisory-locked SQL prevents concurrent requests bypassing the per-account limit.
    with db.connect() as c: c.execute('DELETE FROM auth_attempts WHERE key=%s', (f'photo-upload:{uids[0]}',))
    def attempt(_):
        try: P.upload_attempt(uids[0]); return 200
        except HTTPException as e: return e.status_code
    with patch.object(P, 'UPLOADS_PER_MINUTE', 3), ThreadPoolExecutor(max_workers=8) as pool:
        assert sorted(pool.map(attempt, range(8))) == [200]*3 + [429]*5
    with db.connect() as c:
        c.execute("UPDATE auth_attempts SET created=now()-interval '61 seconds' WHERE key=%s", (f'photo-upload:{uids[0]}',))
    P.upload_attempt(uids[0])
    print('PASS photo safety: JPEG/PNG/WebP metadata, hard pixel boundary, hidden accounts, shared durable budget, concurrency, expiry and isolation')
finally:
    app.dependency_overrides.pop(current_user, None)
    if uids:
        with db.connect() as c:
            c.execute('DELETE FROM auth_attempts WHERE key=ANY(%s)', ([f'photo-upload:{u}' for u in uids],))
            c.execute('DELETE FROM users WHERE id=ANY(%s)', (uids,))
