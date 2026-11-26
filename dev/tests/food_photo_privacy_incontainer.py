"""Fictional metadata at the HTTP ingress and serialized provider boundary; zero paid calls."""
import base64
import io
import json
import unittest
import uuid
from contextlib import ExitStack, nullcontext
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image
from app import api_food_photos as P, auth, db
from app.main import app

SENTINEL = b'FictionalPrivateLocationSentinel'
ESTIMATE = {'items': [{'name': 'Fictional beans', 'amount': '100 g', 'grams': 100,
                       'kcal': 200, 'protein_g': 10, 'carbs_g': 25, 'fat_g': 3, 'fiber_g': 6}]}
LABEL = {'readable': True, 'name': 'Fictional beans', 'serving_g': 100,
         'per_serving': {'kcal': 200, 'protein_g': 10, 'carbs_g': 25, 'fat_g': 3, 'fiber_g': 6}}


def jpeg(size=(12, 10)):
    raw = io.BytesIO()
    exif = Image.Exif()
    exif[271] = SENTINEL.decode()
    exif[274] = 6  # Upright pixels must survive removing the orientation tag.
    exif[34853] = {1: 'N', 2: (1.0, 2.0, 3.0), 3: 'W', 4: (4.0, 5.0, 6.0)}
    Image.new('RGB', size, 'green').save(raw, 'JPEG', exif=exif, icc_profile=SENTINEL, comment=SENTINEL)
    # Also include XMP, IPTC and bytes after EOI, none of which belong in the output.
    def segment(marker, data):
        return marker + (len(data) + 2).to_bytes(2, 'big') + data
    data = raw.getvalue()
    data = data[:2] + segment(b'\xff\xe1', b'http://ns.adobe.com/xap/1.0/\0' + SENTINEL) + segment(b'\xff\xed', b'Photoshop 3.0\0' + SENTINEL) + data[2:] + SENTINEL
    assert SENTINEL in data and Image.open(io.BytesIO(data)).getexif().get_ifd(34853)
    return 'data:image/jpeg;base64,' + base64.b64encode(data).decode()


class Privacy(unittest.TestCase):
    def setUp(self):
        self.ids, self.clients, self.payloads = [], [], []
        for _ in range(2):
            login = 'zz_test_food_privacy_' + uuid.uuid4().hex[:10]
            with db.connect() as c:
                uid = c.execute('INSERT INTO users(login,name,pw_hash) VALUES(%s,%s,%s) RETURNING id',
                                (login, 'Fictional tester', auth.hash_pw('fictional photo password'))).fetchone()['id']
                c.execute('INSERT INTO profile(user_id,ai_ok,ai_adult_at) VALUES(%s,true,now())', (uid,))
            self.ids.append(uid)
            client = TestClient(app, headers={'Origin': 'http://testserver'})
            self.assertEqual(client.post('/api/login', json={'login': login, 'password': 'fictional photo password'}).status_code, 200)
            self.clients.append(client)
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        # Exercise the real JSON serialization, replacing only transport and its money ledger.
        for name, value in (('reserve', 'fictional'), ('lease', nullcontext()), ('settle', None), ('finish', None)):
            self.stack.enter_context(patch('app.ai_budget.' + name, return_value=value))
        self.stack.enter_context(patch('app.food_photo.brake'))
        self.stack.enter_context(patch('app.meal_chat.lookup', side_effect=lambda text: {'kind': 'none', 'foods': [], 'text': text}))
        self.stack.enter_context(patch('urllib.request.urlopen', side_effect=self.transport))

    def tearDown(self):
        for client in self.clients:
            client.close()
        with db.connect() as c:
            c.execute('DELETE FROM users WHERE id=ANY(%s)', (self.ids,))

    def transport(self, request, **kwargs):
        self.assertTrue(request.full_url.startswith('https://generativelanguage.googleapis.com/'), 'Unexpected network request blocked')
        body = json.loads(request.data)
        images = [p['inline_data'] for p in body['contents'][0]['parts'] if 'inline_data' in p]
        self.assertTrue(images)
        for image in images:
            self.assertEqual(image['mime_type'], 'image/jpeg')
            data = base64.b64decode(image['data'], validate=True)
            self.assertNotIn(SENTINEL, data)
            decoded = Image.open(io.BytesIO(data)); decoded.load()
            self.assertEqual(decoded.size, (10, 12))
            self.assertFalse(decoded.getexif())
            self.assertFalse(set(decoded.info) & {'exif', 'icc_profile', 'comment', 'xmp'})
            self.assertFalse(any(marker in data for marker in (b'\xff\xe1', b'\xff\xe2', b'\xff\xed', b'\xff\xfe')))
            self.assertTrue(data.endswith(b'\xff\xd9'))
        self.payloads.append(body)
        answer = LABEL if 'readable' in body['generationConfig']['responseSchema']['properties'] else ESTIMATE
        return io.BytesIO(json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(answer)}]}}]}).encode())

    def test_all_photo_routes_and_account_isolation(self):
        a, b = self.clients
        image = jpeg()
        for path in ('/api/food/photo', '/api/food/label'):
            for body in ({'image': image}, {'images': [image, image]}):
                response = a.post(path, json=body)
                self.assertEqual(response.status_code, 200, response.text)
        draft = {'client_id': str(uuid.uuid4()), 'image': image}
        response = a.post('/api/recipe-links/photo', json=draft)
        self.assertEqual(response.status_code, 200, response.text)
        before = len(self.payloads)
        self.assertEqual(a.post('/api/recipe-links/photo', json=draft).status_code, 200)
        self.assertEqual(len(self.payloads), before, 'Recipe replay makes no provider call')
        self.assertEqual(b.get('/api/recipe-links/' + draft['client_id']).status_code, 404)
        m = a.post('/api/food/thread/messages', json={'client_id': str(uuid.uuid4()), 'body': 'Fictional beans', 'media': 'photo'}).json()['message']
        self.assertEqual(a.post(f"/api/food/thread/messages/{m['id']}/process", json={}).status_code, 200)
        path = f"/api/food/thread/messages/{m['id']}/resolve"
        response = a.post(path, json={'images': [image]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(len(self.payloads), before + 1)
        self.assertEqual(b.post(path, json={'image': image}).status_code, 404)
        self.assertEqual(len(self.payloads), before + 1)

    def test_bad_images_pixel_cap_and_access_before_decode(self):
        a = self.clients[0]
        with patch.object(P, 'MAX_PIXELS', 120):
            self.assertEqual(a.post('/api/food/photo', json={'image': jpeg()}).status_code, 200)
            for bad in (jpeg((13, 10)), base64.b64encode(b'\xff\xd8' + SENTINEL).decode(), 'bad'):
                before = len(self.payloads)
                response = a.post('/api/food/photo', json={'image': bad})
                self.assertEqual(response.status_code, 400, response.text)
                self.assertNotIn(SENTINEL.decode(), response.text)
                self.assertEqual(len(self.payloads), before)
        with db.connect() as c:
            c.execute('UPDATE users SET needs_email_confirm=true,email_verified_at=NULL WHERE id=%s', (self.ids[0],))
        for path in ('/api/food/photo', '/api/food/label', '/api/recipe-links/photo'):
            response = a.post(path, json={'image': 'bad', 'client_id': str(uuid.uuid4())})
            self.assertEqual(response.status_code, 403, response.text)


if __name__ == '__main__':
    unittest.main()
