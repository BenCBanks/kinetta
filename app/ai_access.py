"""AI product access, separate from provider configuration, consent and usage limits.

Default-open preserves existing installations. A future verified billing adapter owns
entitlement writes; no profile field, model tool or public endpoint can grant access.
"""
import os
from fastapi import HTTPException
from . import db

FEATURES = ('food', 'coach')


def mode():
    # Unknown configuration fails closed rather than accidentally granting paid access.
    return 'open' if os.environ.get('KINETTA_AI_ACCESS_MODE', 'open') == 'open' else 'entitled'


def has(user_id, feature, connection=None):
    if type(user_id) is not int or user_id <= 0 or feature not in FEATURES:
        raise ValueError('Authenticated account and known AI feature required')
    if mode() == 'open': return True
    def read(c):
        return bool(c.execute('''SELECT 1 FROM ai_entitlements WHERE user_id = %s AND feature = %s
                                 AND enabled AND (expires_at IS NULL OR expires_at > now())''', (user_id, feature)).fetchone())
    if connection is not None: return read(connection)
    with db.connect() as c: return read(c)


def require(user_id, feature, connection=None):
    if not has(user_id, feature, connection):
        raise HTTPException(402, 'This AI feature is not included in your access. Food search, barcodes, manual logging, Meals, Health sync and training plans are still available.')


def capabilities(user_id):
    from . import coach
    return {feature: {'entitled': has(user_id, feature),
                      'available': bool(os.environ.get('GEMINI_API_KEY')) if feature == 'food' else coach.enabled()}
            for feature in FEATURES}
