"""Development-only fake provider transport; ordinary APIs, validation and budgets remain real."""
import io
import json
import os
import sys
import socket
import threading
import time
import urllib.request

sys.path.insert(0, '/srv')
assert os.environ.get('KINETTA_LOAD_FIXTURE') == '1'
assert os.environ.get('GEMINI_API_KEY') == 'load-standin'
from app import api_food, coach, account_email, apns, notify, meal_reminders, personal_notifications
from app.main import app

database_ips = {x[4][0] for x in socket.getaddrinfo('db', 5432)}
real_connect = socket.socket.connect


def connect(sock, address):
    if not isinstance(address, tuple) or address[0] not in database_ips or address[1] != 5432:
        raise OSError('Load fixture blocked outgoing socket')
    return real_connect(sock, address)


socket.socket.connect = connect


def transport(request, *args, **kwargs):
    url = request.full_url if isinstance(request, urllib.request.Request) else str(request)
    if not url.startswith('https://generativelanguage.googleapis.com/v1beta/models/'):
        raise RuntimeError('Load fixture blocked outbound HTTP')
    time.sleep(.2)  # Simulated latency, never a provider-performance measurement.
    answer = {'items': [{'name': 'Fictional lentil bowl', 'amount': '1 bowl', 'grams': 300,
                         'kcal': 400, 'protein_g': 20, 'carbs_g': 55, 'fat_g': 11, 'fiber_g': 12}],
              'notes': 'Fictional load stand-in; not nutrition advice.'}
    return io.BytesIO(json.dumps({'candidates': [{'content': {'parts': [{'text': json.dumps(answer)}]}}],
                                 'usageMetadata': {'promptTokenCount': 100, 'candidatesTokenCount': 60,
                                                   'totalTokenCount': 160}}).encode())


def catalog(url, timeout=6, body=None):
    time.sleep(.05)
    if 'openfoodfacts' in url:
        product = {'code': '0000000000000', 'product_name': 'Fictional oats', 'serving_size': '100 g',
                   'serving_quantity': 100, 'nutriments': {'energy-kcal_100g': 380, 'proteins_100g': 13,
                   'carbohydrates_100g': 66, 'fat_100g': 7, 'fiber_100g': 10}}
        return {'hits': [product], 'products': [product]}
    if 'api.nal.usda.gov' in url:
        return {'foods': []}
    raise RuntimeError('Load fixture blocked unexpected catalog request')


def idle_worker():
    stop = threading.Event()
    worker = threading.Thread(target=stop.wait, daemon=True)
    worker.start()
    return stop, worker


urllib.request.urlopen = transport
api_food._get = catalog  # Preserve normalization, cache and OFF's six-second pacing.
coach.after_import = lambda *a, **k: None
coach.weekly_scheduler = lambda: None
meal_reminders.scheduler = lambda: None
personal_notifications.start_worker = idle_worker
notify._push_later = lambda *a, **k: None
apns.deliver = lambda *a, **k: None
account_email.send = lambda *a, **k: None


@app.get('/__load_fixture')
def marker():
    return {'fictional_load_fixture': 1}


# The application's GET fallback was registered on import; keep the fixture marker ahead of it.
app.router.routes.insert(0, app.router.routes.pop())


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000, access_log=False)
