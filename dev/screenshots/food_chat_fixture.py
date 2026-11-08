"""Seed fictional, already-reviewed Food chat cards for the website screenshots.

This runs only inside the disposable screenshot app. The per-food nutrition is
stand-in data; no model, food provider, live account, or external request is used.
"""
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
    {'name': 'Greek yogurt with berries', 'amount': '1 bowl', 'grams': 220, 'kcal': 220,
     'protein_g': 19, 'carbs_g': 27, 'fat_g': 5, 'fiber_g': 4},
    {'name': 'Oatmeal with banana', 'amount': '1 bowl', 'grams': 280, 'kcal': 290,
     'protein_g': 10, 'carbs_g': 56, 'fat_g': 5, 'fiber_g': 8},
    {'name': 'Chicken salad bowl', 'amount': '1 bowl', 'grams': 350, 'kcal': 430,
     'protein_g': 35, 'carbs_g': 30, 'fat_g': 19, 'fiber_g': 6},
]
BODY = 'Greek yogurt with berries, oatmeal with banana, and a chicken salad bowl'
DAY = dt.datetime.now(ZoneInfo('America/New_York')).date()

with patch('urllib.request.urlopen', side_effect=AssertionError('Screenshot fixture must not make external requests')):
    for theme in ('light', 'dark'):
        login = f'zz_test_658_chat_{theme}'
        client = TestClient(app)
        client.headers['Origin'] = 'http://testserver'
        assert client.post('/api/login', json={
            'login': login, 'password': 'green teapot on the hill'
        }).status_code == 200

        response = client.post('/api/food/thread/messages', json={
            'client_id': str(uuid.uuid4()), 'draft_id': str(uuid.uuid4()),
            'review_only': True, 'body': BODY, 'meal': 'breakfast', 'day': str(DAY),
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
        assert [entry['name'] for entry in entries] == [food['name'] for food in FOODS]
        assert sum(entry['kcal'] for entry in entries) == 940
        assert client.get(f'/api/food/day?d={DAY}').json()['entries'] == []
        print(theme, 'fictional three-food review staged; nothing logged')
