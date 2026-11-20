"""Stage a fictional typed lunch for the #1319 screenshot; the UI confirms it locally."""
import datetime as dt
import sys
import uuid
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, '/srv')

from fastapi.testclient import TestClient
from app import db, food_thread as thread, food_thread_compose as compose, food_thread_sources as sources
from app.main import app

BODY = 'Chicken sandwich and an apple for lunch'
FOODS = [
    {'name': 'Chicken sandwich', 'amount': '1 sandwich', 'grams': 220, 'kcal': 420,
     'protein_g': 31, 'carbs_g': 42, 'fat_g': 13, 'fiber_g': 4},
    {'name': 'Apple', 'amount': '1 medium', 'grams': 182, 'kcal': 95,
     'protein_g': 0, 'carbs_g': 25, 'fat_g': 0, 'fiber_g': 4},
]
CAPTURED_AT = dt.datetime.fromisoformat((sys.argv[1] if len(sys.argv) > 1 else '2026-11-20T17:00:00Z').replace('Z', '+00:00'))
if CAPTURED_AT.tzinfo is None:
    CAPTURED_AT = CAPTURED_AT.replace(tzinfo=ZoneInfo('America/New_York'))
CAPTURED_AT = CAPTURED_AT.astimezone(ZoneInfo('America/New_York'))
DAY = CAPTURED_AT.date()

with patch('urllib.request.urlopen', side_effect=AssertionError('Screenshot fixture must not make external requests')):
    for theme in ('light', 'dark'):
        client = TestClient(app)
        client.headers['Origin'] = 'http://testserver'
        assert client.post('/api/login', json={
            'login': f'zz_test_1319_chat_{theme}', 'password': 'green teapot on the hill'
        }).status_code == 200
        response = client.post('/api/food/thread/messages', json={
            'client_id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'https://kinetta.app/demo/1319/meal/{theme}')),
            'draft_id': str(uuid.uuid5(uuid.NAMESPACE_URL, f'https://kinetta.app/demo/1319/draft/{theme}')),
            'review_only': True, 'body': BODY, 'meal': 'lunch', 'day': str(DAY), 'captured_at': CAPTURED_AT.isoformat(),
        })
        assert response.status_code == 201, response.text
        message = response.json()['message']
        drafts = sources.model_drafts({'items': FOODS, 'notes': '', 'model': 'fictional-layout-standin'})
        part = {'index': 0, 'status': 'ready', 'estimated': True,
                'drafts': drafts, 'entries': sources.draft_entries(drafts)}
        with db.connect() as connection:
            uid = connection.execute('SELECT id FROM users WHERE login=%s', (f'zz_test_1319_chat_{theme}',)).fetchone()['id']
            result = compose.write(connection, uid, thread.locked_message(connection, uid, message['id']), {
                'composed': True, 'day': str(DAY), 'meal': 'lunch', 'parts': [part],
            })
        reply = next(row for row in result['messages'] if row.get('reply_to') == message['id'])
        assert reply['result']['kind'] == 'preview', reply['result']
        assert [entry['name'] for entry in reply['result']['parts'][0]['entries']] == ['Chicken sandwich', 'Apple']
        assert client.get(f'/api/food/day?d={DAY}').json()['entries'] == [], 'the fixture is unlogged until the screenshot clicks Add to log'
        print(theme, 'fictional sandwich-and-apple Kit review staged; awaiting explicit screenshot confirmation')
