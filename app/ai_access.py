"""AI product access, separate from provider configuration, consent and usage limits.

Default-open preserves existing installations. Operator permission and known age apply
in every mode. Product entitlements and the person's own consent remain separate.
"""
import datetime as dt
import os
from fastapi import HTTPException
from . import db

FEATURES = ('food', 'coach')
OPERATOR_BLOCK = 'Kit access is blocked by the administrator. Search, barcodes and manual logging still work.'
AGE_BLOCK = 'Kit is for people 18 or older. Search, barcodes and manual logging still work.'
PRODUCT_BLOCK = 'This AI feature is not included in your access. Food search, barcodes, manual logging, Meals, Health sync and training plans are still available.'


def age_eligible(birth_year):
    # A birth year alone is approximate; the separate 18+ confirmation is still required.
    return birth_year is None or dt.datetime.now(dt.timezone.utc).year - birth_year >= 18


def restriction(profile):
    if not profile or not profile['ai_access_allowed']: return OPERATOR_BLOCK
    if not age_eligible(profile['birth_year']): return AGE_BLOCK
    return None


def mode():
    # Unknown configuration fails closed rather than accidentally granting paid access.
    return 'open' if os.environ.get('KINETTA_AI_ACCESS_MODE', 'open') == 'open' else 'entitled'


def _decision(user_id, feature, connection=None):
    if type(user_id) is not int or user_id <= 0 or feature not in FEATURES:
        raise ValueError('Authenticated account and known AI feature required')
    def read(c):
        profile=c.execute('SELECT ai_access_allowed,birth_year FROM profile WHERE user_id=%s',(user_id,)).fetchone()
        reason=restriction(profile)
        if reason: return False, reason
        if mode() == 'open': return True, None
        entitled=bool(c.execute('''SELECT 1 FROM ai_entitlements WHERE user_id = %s AND feature = %s
                                 AND enabled AND (expires_at IS NULL OR expires_at > now())''', (user_id, feature)).fetchone())
        return entitled, None if entitled else PRODUCT_BLOCK
    if connection is not None: return read(connection)
    with db.connect() as c: return read(c)


def has(user_id, feature, connection=None):
    return _decision(user_id, feature, connection)[0]


def require(user_id, feature, connection=None):
    allowed, reason=_decision(user_id, feature, connection)
    if not allowed: raise HTTPException(402 if reason == PRODUCT_BLOCK else 403, reason)


def capabilities(user_id, connection=None):
    from . import coach
    if connection is None:
        with db.connect() as c:return capabilities(user_id,c)
    result={}
    for feature in FEATURES:
        allowed,reason=_decision(user_id,feature,connection)
        result[feature]={'entitled':allowed,'available':bool(os.environ.get('GEMINI_API_KEY')) if feature == 'food' else coach.enabled(),
                         'reason':reason}
    return result
