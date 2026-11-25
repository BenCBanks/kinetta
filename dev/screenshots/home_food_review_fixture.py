"""Stage a fictional two-food Kit review for the Home website frame."""
import datetime as dt
import sys
import urllib.request
import uuid
from unittest.mock import patch
from zoneinfo import ZoneInfo

sys.path.insert(0, '/srv')

from fastapi.testclient import TestClient
from app import db, food_thread as thread, food_thread_compose as compose, food_thread_sources as sources
from app.main import app

FOODS = [
    {'name': 'Toast', 'amount': '½ slice', 'grams': 20, 'kcal': 40,
     'protein_g': 1, 'carbs_g': 7, 'fat_g': 1, 'fiber_g': 1},
    {'name': 'Butter', 'amount': '2 g', 'grams': 2, 'kcal': 15,
     'protein_g': 0, 'carbs_g': 0, 'fat_g': 2, 'fiber_g': 0},
]
BODY = 'Toast with a little butter for a snack'
CAPTURED_AT = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00')) if len(sys.argv) > 1 else dt.datetime.now(ZoneInfo('America/New_York'))
if CAPTURED_AT.tzinfo is None:
    CAPTURED_AT = CAPTURED_AT.replace(tzinfo=ZoneInfo('America/New_York'))
CAPTURED_AT = CAPTURED_AT.astimezone(ZoneInfo('America/New_York'))
DAY = CAPTURED_AT.date()

with patch('urllib.request.urlopen', side_effect=AssertionError('Screenshot fixture must not make external requests')):
    for theme in ('light', 'dark'):
        login = f'zz_test_home_food_{theme}'
        client = TestClient(app)
        client.headers['Origin'] = 'http://testserver'
        assert client.post('/api/login', json={
            'login': login, 'password': 'green teapot on the hill'
        }).status_code == 200

        response = client.post('/api/food/thread/messages', json={
            'client_id': str(uuid.uuid4()), 'draft_id': str(uuid.uuid4()),
            'review_only': True, 'body': BODY, 'meal': 'breakfast', 'day': str(DAY), 'captured_at': CAPTURED_AT.isoformat(),
        })
        assert response.status_code == 201, response.text
        message = response.json()['message']
        drafts = sources.model_drafts({'items': FOODS, 'notes': '', 'model': 'fictional-layout-standin'})
        part = {'index': 0, 'status': 'ready', 'estimated': True,
                'drafts': drafts, 'entries': sources.draft_entries(drafts)}

        with db.connect() as connection:
            uid = connection.execute('SELECT id FROM users WHERE login=%s', (login,)).fetchone()['id']
            result = compose.write(connection, uid, thread.locked_message(connection, uid, message['id']), {
                'composed': True, 'day': str(DAY), 'meal': 'breakfast', 'parts': [part],
            })

        reply = next(row for row in result['messages'] if row.get('reply_to') == message['id'])
        assert reply['result']['kind'] == 'preview', reply['result']
        entries = reply['result']['parts'][0]['entries']
        assert [entry['name'] for entry in entries] == ['Toast', 'Butter']
        assert sum(entry['kcal'] for entry in entries) == 55
        assert client.get(f'/api/food/day?d={DAY}').json()['entries'] == []
        print(theme, 'fictional two-food review staged; nothing logged')
