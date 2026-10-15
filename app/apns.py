"""Native iPhone alert delivery. Credentials stay on the server; tests replace the HTTP transport."""
import os
from pathlib import Path
import threading
import time

import httpx
import jwt

_lock = threading.Lock()
_cached = None


def ready():
    return bool(os.environ.get('KINETTA_APNS_KEY_ID') and os.environ.get('KINETTA_APNS_TEAM_ID') and
                (os.environ.get('KINETTA_APNS_PRIVATE_KEY') or os.environ.get('KINETTA_APNS_KEY_FILE')))


def provider_token():
    global _cached
    with _lock:
        now = int(time.time())
        if _cached and now - _cached[0] < 3000: return _cached[1]
        key = os.environ.get('KINETTA_APNS_PRIVATE_KEY', '').replace('\\n', '\n')
        if not key: key = Path(os.environ['KINETTA_APNS_KEY_FILE']).read_text()
        token = jwt.encode({'iss': os.environ['KINETTA_APNS_TEAM_ID'], 'iat': now}, key, algorithm='ES256',
                           headers={'kid': os.environ['KINETTA_APNS_KEY_ID']})
        _cached = (now, token)
        return token


def deliver(device, payload, transport=None):
    """Return True if accepted, False if Apple retired the token. Never log a token, key or payload."""
    host = 'api.sandbox.push.apple.com' if device['environment'] == 'sandbox' else 'api.push.apple.com'
    headers = {'authorization': 'bearer ' + provider_token(),
               'apns-topic': os.environ.get('KINETTA_APNS_TOPIC', 'com.kinetta.app'),
               'apns-push-type': 'alert', 'apns-priority': '10',
               'apns-expiration': str(int(time.time()) + 86400),
               'apns-collapse-id': payload['tag']}
    with httpx.Client(http2=True, timeout=10, transport=transport) as client:
        response = client.post(f'https://{host}/3/device/{device["token"]}', headers=headers,
                               json={'aps': {'alert': {'title': payload['title'], 'body': payload['body']},
                                             'sound': 'default', 'badge': payload['badge']},
                                     'url': payload['url']})
    if response.status_code == 200: return True
    reason = response.json().get('reason', '')
    if response.status_code == 410 or reason in ('BadDeviceToken', 'DeviceTokenNotForTopic'): return False
    # Only the status is safe for logs; request exceptions can include a device-token URL.
    raise RuntimeError(f'Apple push rejected the notification (HTTP {response.status_code})')
