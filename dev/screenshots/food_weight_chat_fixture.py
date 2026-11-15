"""Stage a fictional food-plus-weigh-in review for #1049 site screenshots.

The production deterministic weight parser is used. Food values are an explicit
screenshot stand-in; this never calls Kit, an AI provider, or a food database.
"""
import datetime as dt
import sys
import uuid
from zoneinfo import ZoneInfo
from unittest.mock import patch

sys.path.insert(0, '/srv')

from fastapi.testclient import TestClient
from app import db, food_thread as thread, food_thread_compose as compose, food_thread_sources as sources
from app import food_thread_weight as weight_parser
from app.main import app

BODY = '2 eggs and toast, weighed 165 this morning'
FOODS = [
    {'name': 'Eggs', 'amount': '2 large', 'grams': 100, 'kcal': 144,
     'protein_g': 12.6, 'carbs_g': 0.7, 'fat_g': 9.5, 'fiber_g': 0},
    {'name': 'Whole-wheat toast', 'amount': '1 slice', 'grams': 40, 'kcal': 100,
     'protein_g': 4, 'carbs_g': 18, 'fat_g': 1.5, 'fiber_g': 3},
]
captured = dt.datetime.fromisoformat(sys.argv[1].replace('Z', '+00:00'))
if captured.tzinfo is None:
    captured = captured.replace(tzinfo=ZoneInfo('America/New_York'))
captured = captured.astimezone(ZoneInfo('America/New_York'))
day = captured.date()

with patch('urllib.request.urlopen', side_effect=AssertionError('Screenshot fixture must not make external requests')):
    for theme in ('light', 'dark'):
        login = f'zz_test_1049_food_{theme}'
        client = TestClient(app)
        client.headers['Origin'] = 'http://testserver'
        assert client.post('/api/login', json={
            'login': login, 'password': 'green teapot on the hill'
        }).status_code == 200
        created = client.post('/api/food/thread/messages', json={
            'client_id': str(uuid.uuid4()), 'draft_id': str(uuid.uuid4()),
            'review_only': True, 'body': BODY, 'meal': 'breakfast',
            'day': str(day), 'captured_at': captured.isoformat(),
        })
        assert created.status_code == 201, created.text
        message = created.json()['message']
        with db.connect() as connection:
            uid = connection.execute('SELECT id FROM users WHERE login=%s', (login,)).fetchone()['id']
            locked = thread.locked_message(connection, uid, message['id'])
            weight = weight_parser.parse(connection, uid, BODY, day)
            assert weight and weight['unit'] == 'lb' and weight['amount'] == 165 and weight['food'] == '2 eggs and toast'
            drafts = sources.model_drafts({'items': FOODS, 'notes': 'Fictional screenshot nutrition stand-in.', 'model': 'fictional-layout-standin'})
            part = {'index': 0, 'status': 'ready', 'estimated': True,
                    'drafts': drafts, 'entries': sources.draft_entries(drafts)}
            result = compose.write(connection, uid, locked, {
                'composed': True, 'day': str(day), 'meal': 'breakfast',
                'parts': [part], 'weight': {key: value for key, value in weight.items() if key != 'food'},
            })
        reply = next(row for row in result['messages'] if row.get('reply_to') == message['id'])
        review = reply['result']
        assert review['kind'] == 'preview' and review['weight']['amount'] == 165
        assert [entry['name'] for entry in review['parts'][0]['entries']] == ['Eggs', 'Whole-wheat toast']
        assert client.get(f'/api/food/day?d={day}').json()['entries'] == [], 'The preview must not log anything.'
        print(theme, 'fictional 165 lb review card staged; nothing logged')
