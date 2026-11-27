"""Shared Pillow admission, real API retries, and failure cleanup. Fictional data only."""
import asyncio
import httpx
from contextvars import ContextVar
import base64
import io
import threading
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image
from app import api_photos as photos, api_food_photos as food, cards, db, image_work
from app.auth import current_user
from app.main import app


def picture(fmt='JPEG', size=(16, 12)):
    out = io.BytesIO()
    with Image.new('RGB', size, 'green') as pixels:
        pixels.save(out, fmt)
    return base64.b64encode(out.getvalue()).decode()


class ImageWork(unittest.TestCase):
    def setUp(self):
        with db.connect() as c:
            self.uid = c.execute("INSERT INTO users(login,name) VALUES(%s,'Fictional images') RETURNING id",
                                 ('zz_test_image_' + uuid.uuid4().hex[:10],)).fetchone()['id']
            c.execute('INSERT INTO profile(user_id) VALUES(%s)', (self.uid,))
            self.aid = c.execute("INSERT INTO activities(user_id,sport,name,start_time,source) VALUES(%s,'run','Fictional run',now(),'manual') RETURNING id", (self.uid,)).fetchone()['id']
        app.dependency_overrides[current_user] = lambda: {'id': self.uid}
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.data = {'image': picture()}
        self.webp = {'image': picture('WEBP')}

    def tearDown(self):
        app.dependency_overrides.pop(current_user, None)
        with db.connect() as c:
            c.execute('DELETE FROM auth_attempts WHERE key=ANY(%s)',
                      ([f'photo-upload:{self.uid}', f'food-photo-decode:{self.uid}'],))
            c.execute('DELETE FROM users WHERE id=%s', (self.uid,))

    def busy(self, response):
        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.headers['retry-after'], '2')
        self.assertIn('try again', response.json()['detail'])

    def test_photo_holds_slot_until_actual_worker_finishes(self):
        entered, release = threading.Event(), threading.Event()
        original = photos._open
        def held(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(5))
            return original(*args, **kwargs)
        with patch.object(photos, '_open', side_effect=held), ThreadPoolExecutor(1) as pool:
            pending = pool.submit(self.client.put, '/api/me/photo', json=self.data)
            try:
                self.assertTrue(entered.wait(5))
                self.assertFalse(pending.cancel(), 'HTTP cancellation cannot release a running Pillow worker')
                with patch.object(Image, 'open', side_effect=AssertionError('busy must not decode')):
                    self.busy(self.client.post(f'/api/activities/{self.aid}/photos', json=self.data))
                    self.busy(self.client.get('/api/card/image.png'))
                    # Shared ingress also covers recipe photos, food labels, and thread resolve.
                    with patch.object(food.ai_budget, 'require_enabled'), patch.object(food.ai_access, 'require'), patch.object(food.coach, 'enabled', return_value=False):
                        with self.assertRaises(HTTPException) as error:
                            food.clean(food.food_photo.PhotoIn(**self.data), {'id': self.uid})
                        self.assertEqual(error.exception.status_code, 503)
                self.assertEqual(self.client.get('/api/health').status_code, 200)
                with db.connect() as c:
                    self.assertEqual(c.execute('SELECT count(*) AS n FROM activity_photos WHERE user_id=%s', (self.uid,)).fetchone()['n'], 0)
            finally:
                release.set()
            self.assertEqual(pending.result().status_code, 200)
        self.assertEqual(self.client.post(f'/api/activities/{self.aid}/photos', json=self.data).status_code, 200)
        with db.connect() as c:
            self.assertEqual(c.execute('SELECT count(*) AS n FROM activity_photos WHERE user_id=%s', (self.uid,)).fetchone()['n'], 1)

    def test_food_and_card_work_exclude_other_decoders_but_cache_is_usable(self):
        self.assertEqual(self.client.get('/api/card/image.png').status_code, 200)
        with image_work.slot(), patch.object(Image, 'open', side_effect=AssertionError('busy decode')):
            self.assertEqual(self.client.get('/api/card/image.png').status_code, 200, 'cached picture needs no decoder')
            self.busy(self.client.put('/api/me/photo', json=self.data))
        with patch.object(cards, 'image', side_effect=RuntimeError('render failed')):
            with cards._picture_lock: cards._pictures.clear()
            with self.assertRaisesRegex(RuntimeError, 'render failed'):
                self.client.get('/api/card/image.png')
        self.assertEqual(self.client.put('/api/me/photo', json=self.data).status_code, 200, 'failed render releases admission')
        app.dependency_overrides.pop(current_user)
        with image_work.slot():
            self.assertEqual(TestClient(app).put('/api/me/photo', json=self.data).status_code, 401)

    def test_request_cancellation_and_single_worker_context(self):
        entered, release = threading.Event(), threading.Event()
        original = photos._open
        def held(*args, **kwargs):
            entered.set()
            self.assertTrue(release.wait(5))
            return original(*args, **kwargs)
        async def exercise():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url='http://testserver') as client:
                pending = asyncio.create_task(client.put('/api/me/photo', json=self.data))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait, 5))
                    pending.cancel()
                    await asyncio.sleep(0)
                    self.busy(await client.post(f'/api/activities/{self.aid}/photos', json=self.data))
                finally:
                    release.set()
                    with self.assertRaises(asyncio.CancelledError): await pending
        with patch.object(photos, '_open', side_effect=held): asyncio.run(exercise())
        # Wait for the cancelled request's actual worker, then verify normal admission.
        image_work._worker.submit(lambda: None).result(timeout=5)
        value = ContextVar('fictional_image_owner')
        value.set(self.uid)
        first = image_work.run(lambda: (threading.get_ident(), value.get()))
        second = image_work.run(lambda: (threading.get_ident(), value.get()))
        self.assertEqual(first, second)
        self.assertNotEqual(first[0], threading.get_ident())
        self.assertEqual(first[1], self.uid, 'worker carries request context')

    def test_invalid_decode_releases_slot_and_webp_limit_precedes_load(self):
        self.assertEqual(self.client.put('/api/me/photo', json={'image': 'not-an-image'}).status_code, 400)
        with patch.object(photos, 'WEBP_PIXELS', 100), patch.object(Image.Image, 'load', side_effect=AssertionError('oversize must not load')):
            self.assertEqual(self.client.put('/api/me/photo', json=self.webp).status_code, 400)
        self.assertEqual(self.client.put('/api/me/photo', json=self.data).status_code, 200)

if __name__ == '__main__':
    unittest.main()
