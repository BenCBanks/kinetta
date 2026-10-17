"""Durable food-estimator limits. No prompts, photos, keys or food names in the ledger.

Reserve a padded estimate of each request before *each* attempt. A
successful response with complete usage releases unused money; timeouts, missing
usage and crashes keep the reservation. USD figures are estimates, not invoices.
"""
import datetime as dt
import os
import json
from contextlib import contextmanager
from contextvars import ContextVar
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from uuid import uuid4
from fastapi import HTTPException
from . import db

_owner = ContextVar('food_estimator_owner', default=None)
# Standard text/image rates per million tokens; verified against Google's pricing
# on 2026-10-17. The higher post-promotion Flash rate is deliberately reserved.
RATES = {'gemini-3.1-flash-lite': (Decimal('.25'), Decimal('1.50')),
         'gemini-3.8-flash': (Decimal('1.50'), Decimal('7.50'))}
REVIEW_BY = dt.date(2027, 1, 1)
FALLBACK = 'AI is paused. You can still search, scan a barcode or enter nutrition yourself.'


def enabled():
    return os.environ.get('KINETTA_AI_ENABLED', '1') == '1'


def require_enabled():
    if not enabled(): raise HTTPException(503, FALLBACK)


@contextmanager
def scope(uid):
    if type(uid) is not int or uid <= 0: raise ValueError('Authenticated account required')
    token = _owner.set(uid)
    try: yield
    finally: _owner.reset(token)


def daily(uid, kind, limit, what):
    """Charge a request once, independently of later provider/food transactions."""
    require_enabled()
    if type(uid) is not int or uid <= 0 or not 0 < limit <= 1000 or not 0 < len(kind) <= 40:
        raise ValueError('Invalid daily limit')
    with db.connect() as c:
        row = c.execute('''INSERT INTO ai_daily_usage(user_id,day,kind,requests)
                            VALUES (%s,(now() AT TIME ZONE 'UTC')::date,%s,1)
                            ON CONFLICT(user_id,day,kind) DO UPDATE SET requests=ai_daily_usage.requests+1
                            WHERE ai_daily_usage.requests < %s RETURNING requests''',(uid,kind,limit)).fetchone()
        if not row: raise HTTPException(429, f'That is {limit} {what} today. Search, barcodes and manual logging still work.')


def budget_micros():
    try:
        value = Decimal(os.environ.get('KINETTA_FOOD_AI_DAILY_USD', '5'))
        if not value.is_finite() or value < 0 or value > 10000: raise ValueError()
        return int(value * 1_000_000)
    except (InvalidOperation, ValueError): raise HTTPException(503, FALLBACK) from None


def price(model, input_tokens, output_tokens):
    rate_in, rate_out = RATES[model]
    return int((rate_in * input_tokens + rate_out * output_tokens).to_integral_value(rounding=ROUND_CEILING))


def request_tokens(payload=None):
    # Local, deliberately padded estimate. Never send a second counting request,
    # retain a prompt/image, or charge base64 transport bytes as text tokens.
    images=0
    def compact(value):
        nonlocal images
        if isinstance(value,dict):
            if 'inlineData' in value or 'inline_data' in value:
                images+=1;return {'image':True}
            return {k:compact(v) for k,v in value.items()}
        if isinstance(value,list):return [compact(v) for v in value]
        return value
    if payload is None:return 8192,2048
    body=json.loads(payload) if isinstance(payload,(str,bytes)) else payload
    text_bytes=len(json.dumps(compact(body),ensure_ascii=False).encode())
    output=(body.get('generationConfig') or {}).get('maxOutputTokens',2048)
    if type(output) is not int or not 1<=output<=65536:raise HTTPException(503,FALLBACK)
    return min(1_048_576,1024+2*text_bytes+images*16384),output


def review_by():
    try:return dt.date.fromisoformat(os.environ.get('KINETTA_AI_PRICING_REVIEW_BY',REVIEW_BY.isoformat()))
    except ValueError:raise HTTPException(503,'AI pricing review date is invalid') from None


def reserve(model, label, payload=None):
    require_enabled()
    uid = _owner.get()
    if uid is None: raise HTTPException(503, 'An authenticated AI request is required')
    if model not in RATES or dt.datetime.now(dt.timezone.utc).date() >= review_by():
        raise HTTPException(503, 'AI model pricing needs a server review. Search, barcodes and manual logging still work.')
    input_tokens,output_tokens=request_tokens(payload)
    hold = price(model,input_tokens,output_tokens)
    limit = budget_micros()
    rid = uuid4()
    with db.connect() as c:
        # The service row survives account deletion. Independent workers/restarts
        # share the same short lock; no network work is done under it.
        c.execute("INSERT INTO ai_service_budget(day) VALUES ((now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING")
        row = c.execute("SELECT day,charged_micros FROM ai_service_budget WHERE day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE").fetchone()
        if row['charged_micros'] + hold > limit: raise HTTPException(429, FALLBACK)
        c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros+%s WHERE day=%s',(hold,row['day']))
        c.execute('''INSERT INTO ai_food_attempts(id,user_id,day,model,kind,reserved_micros,charged_micros)
                     VALUES (%s,%s,%s,%s,%s,%s,%s)''',(rid,uid,row['day'],model,label[:40],hold,hold))
    return rid


def settle(rid, data):
    usage = data.get('usageMetadata') or {}
    names = ('promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount')
    # Thinking may be omitted when no thinking tokens were generated. Input and
    # candidate counts must be present; an incomplete response keeps its hold.
    values = [usage.get(names[0]), usage.get(names[1]), usage.get(names[2], 0)]
    if any(type(v) is not int or v < 0 for v in values): return
    with db.connect() as c:
        row = c.execute('SELECT * FROM ai_food_attempts WHERE id=%s FOR UPDATE',(rid,)).fetchone()
        if not row or row['state'] != 'reserved': return
        actual = price(row['model'], values[0], values[1] + values[2])
        c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros+%s WHERE day=%s',(actual-row['charged_micros'],row['day']))
        c.execute("""UPDATE ai_food_attempts SET state='measured',input_tokens=%s,output_tokens=%s,
                      thinking_tokens=%s,charged_micros=%s WHERE id=%s""",(*values,actual,rid))


def release_failed(rid,status):
    """An explicit Gemini HTTP failure is not a bill; a timeout without response stays held."""
    if type(status) is int and 400<=status<600:
        settle(rid,{'usageMetadata':{'promptTokenCount':0,'candidatesTokenCount':0,'thoughtsTokenCount':0}})
