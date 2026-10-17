"""Durable provider limits. No prompts, photos, keys or food names in the ledger.

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
_request = ContextVar('ai_request_reference', default=None)
_feature = ContextVar('ai_feature',default=None)
# Standard text/image rates per million tokens; verified against Google's pricing
# on 2026-10-17. The higher post-promotion Flash rate is deliberately reserved.
RATES = {'gemini-3.1-flash-lite': (Decimal('.25'), Decimal('1.50')),
         'gemini-3.8-flash': (Decimal('1.50'), Decimal('7.50')),
         'claude-opus-5-5': (Decimal('4'), Decimal('20'))}
REVIEW_BY = dt.date(2027, 1, 1)
FALLBACK = 'AI is paused. You can still search, scan a barcode or enter nutrition yourself.'


def enabled():
    return os.environ.get('KINETTA_AI_ENABLED', '1') == '1'


def require_enabled():
    if not enabled(): raise HTTPException(503, FALLBACK)


@contextmanager
def scope(uid, request_id=None, *, feature=None):
    if type(uid) is not int or uid <= 0: raise ValueError('Authenticated account required')
    from uuid import UUID
    reference = UUID(str(request_id)) if request_id is not None else (_request.get() if _owner.get()==uid else None)
    feature = feature if feature is not None else (_feature.get() if _owner.get()==uid else None)
    if feature is not None and (not isinstance(feature,str) or not 0<len(feature)<=40):raise ValueError('Known feature required')
    token = _owner.set(uid);ref_token = _request.set(reference);feature_token = _feature.set(feature)
    try: yield
    finally:
        _feature.reset(feature_token);_request.reset(ref_token);_owner.reset(token)


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
        value = Decimal(os.environ.get('KINETTA_AI_DAILY_USD') or os.environ.get('KINETTA_FOOD_AI_DAILY_USD', '5'))
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
            if 'inlineData' in value or 'inline_data' in value or value.get('type') == 'image':
                images+=1;return {'image':True}
            return {k:compact(v) for k,v in value.items()}
        if isinstance(value,list):return [compact(v) for v in value]
        return value
    if payload is None:return 8192,2048
    body=json.loads(payload) if isinstance(payload,(str,bytes)) else payload
    text_bytes=len(json.dumps(compact(body),ensure_ascii=False).encode())
    output=body.get('max_tokens',(body.get('generationConfig') or {}).get('maxOutputTokens',2048))
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
        c.execute('SELECT pg_advisory_xact_lock(122006)')
        c.execute("INSERT INTO ai_service_budget(day) VALUES ((now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING")
        row = c.execute("SELECT day,charged_micros FROM ai_service_budget WHERE day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE").fetchone()
        own = c.execute("""SELECT coalesce(sum(charged_micros),0) AS spent,count(*) AS requests
                            FROM ai_food_attempts WHERE user_id=%s AND day=%s""",(uid,row['day'])).fetchone()
        counts = c.execute("""SELECT count(*) FILTER (WHERE lease_until>now() AND state='reserved') AS active,
                              count(*) FILTER (WHERE lease_until>now() AND state='reserved' AND user_id=%s) AS own,
                              count(*) FILTER (WHERE day=%s) AS daily FROM ai_food_attempts
                              WHERE day=%s OR (lease_until>now() AND state='reserved')""",(uid,row['day'],row['day'])).fetchone()
        if counts['active']>=setting('KINETTA_AI_CONCURRENT',8) or counts['own']>=setting('KINETTA_AI_USER_CONCURRENT',2):
            raise HTTPException(429,'AI is busy. Try again shortly, or use search, barcodes or manual logging.')
        if counts['daily']>=setting('KINETTA_AI_DAILY_ATTEMPTS',2000) or own['requests']>=setting('KINETTA_AI_USER_DAILY_ATTEMPTS',120):
            raise HTTPException(429,FALLBACK)
        if own['spent']+hold > setting('KINETTA_AI_USER_DAILY_MICROUSD',limit//5):
            raise HTTPException(429,FALLBACK)
        if row['charged_micros'] + hold > limit: raise HTTPException(429, FALLBACK)
        c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros+%s WHERE day=%s',(hold,row['day']))
        c.execute('''INSERT INTO ai_food_attempts(id,user_id,day,model,kind,reserved_micros,charged_micros,lease_until,request_id)
                     VALUES (%s,%s,%s,%s,%s,%s,%s,now()+interval '120 seconds',%s)''',(rid,uid,row['day'],model,(_feature.get() or label)[:40],hold,hold,_request.get()))
        warning = c.execute("""UPDATE ai_service_budget SET warned_at=now() WHERE day=%s
                                 AND warned_at IS NULL AND charged_micros >= %s RETURNING day""",(row['day'],limit*8//10)).fetchone()
    if warning: print(f"AI budget warning: {warning['day']} UTC reserved/estimated spending reached 80% of the daily cap",flush=True)
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
        if not row or row['state'] == 'measured': return
        actual = price(row['model'], values[0], values[1] + values[2])
        c.execute('UPDATE ai_service_budget SET charged_micros=charged_micros+%s WHERE day=%s',(actual-row['charged_micros'],row['day']))
        c.execute("""UPDATE ai_food_attempts SET state='measured',finished_at=coalesce(finished_at,now()),input_tokens=%s,output_tokens=%s,
                      thinking_tokens=%s,charged_micros=%s WHERE id=%s""",(*values,actual,rid))


def setting(name, default):
    try:
        value = int(os.environ.get(name) or str(default))
        if not 0 <= value <= 100_000_000: raise ValueError()
        return value
    except ValueError: raise HTTPException(503,FALLBACK) from None


@contextmanager
def lease(rid):
    """Keep the concurrency slot while a provider is actually in flight."""
    import threading
    stopped = threading.Event()
    def renew():
        while not stopped.wait(30):
            try:
                renew_lease(rid)
            except Exception:
                # No request data or exception text in operator logs.
                print('AI concurrency lease renewal failed', flush=True)
    worker = threading.Thread(target=renew, daemon=True)
    worker.start()
    try: yield
    finally:
        stopped.set()
        worker.join()


def renew_lease(rid):
    with db.connect() as c:
        c.execute("UPDATE ai_food_attempts SET lease_until=now()+interval '120 seconds' WHERE id=%s AND state='reserved' AND finished_at IS NULL",(rid,))


def finish(rid):
    """Release a finished attempt's slot, retaining its unknown-cost hold."""
    with db.connect() as c:
        c.execute("UPDATE ai_food_attempts SET state='failed',finished_at=coalesce(finished_at,now()) WHERE id=%s AND state='reserved'",(rid,))


def settle_claude(rid, response):
    u=response.usage
    # No cache is requested by these transports; conservatively account for any
    # provider-reported cache write at twice the input rate, reads at full rate.
    inp=getattr(u,'input_tokens',None);out=getattr(u,'output_tokens',None)
    write=getattr(u,'cache_creation_input_tokens',0) or 0;read=getattr(u,'cache_read_input_tokens',0) or 0
    if any(type(v) is not int or v<0 for v in (inp,out,write,read)):return
    settle(rid,{'usageMetadata':{'promptTokenCount':inp+2*write+read,'candidatesTokenCount':out}})


def report(month):
    """Operator-only aggregate report. No HTTP route, account IDs or private text.

    Thread-linked foods can be attributed; older unlinked logs remain explicitly
    unknown. The report never calls all historical logging zero-token by default.
    """
    if type(month) is not dt.date or month.day != 1: raise ValueError('Use a month start date')
    until = (month.replace(day=28)+dt.timedelta(days=4)).replace(day=1)
    start_at=dt.datetime.combine(month,dt.time(),dt.timezone.utc)
    end_at=dt.datetime.combine(until,dt.time(),dt.timezone.utc)
    with db.connect() as c:
        daily = c.execute('''SELECT day,kind,count(*) AS attempts,
                              count(*) FILTER (WHERE state<>'measured') AS unknown_usage_attempts,
                              coalesce(sum(input_tokens),0) AS input_tokens,
                              coalesce(sum(output_tokens),0) AS output_tokens,
                              coalesce(sum(thinking_tokens),0) AS thinking_tokens,
                              sum(charged_micros) AS estimated_or_reserved_microusd,
                              avg(extract(epoch FROM finished_at-created)) AS mean_elapsed_seconds
                              FROM ai_food_attempts WHERE day>=%s AND day<%s GROUP BY day,kind ORDER BY day,kind''',(month,until)).fetchall()
        active = c.execute('''SELECT count(DISTINCT user_id) AS n FROM (
                               SELECT user_id FROM food_entries WHERE created>=%s AND created<%s
                               UNION SELECT user_id FROM activities WHERE created>=%s AND created<%s
                               UNION SELECT user_id FROM weights WHERE day>=%s AND day<%s) u''',
                               (start_at,end_at,start_at,end_at,month,until)).fetchone()['n']
        coverage = c.execute('''WITH logged AS (
                         SELECT id,user_id FROM food_entries WHERE created>=%s AND created<%s),
                       roots AS (SELECT DISTINCT l.entry_id,l.user_id,m.client_id
                         FROM food_chat_entries l JOIN food_chat_messages m ON m.id=l.message_id AND m.user_id=l.user_id
                         JOIN logged e ON e.id=l.entry_id AND e.user_id=l.user_id WHERE m.kind='user'),
                       shares AS (SELECT user_id,client_id,count(*) AS n FROM roots GROUP BY user_id,client_id),
                       usage AS (SELECT user_id,request_id,count(*) AS ai_calls,
                          bool_or(state<>'measured') AS unknown_usage,
                          sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)+coalesce(thinking_tokens,0)) AS tokens
                          FROM ai_food_attempts WHERE request_id IS NOT NULL GROUP BY user_id,request_id),
                       attributed AS (SELECT r.entry_id,coalesce(sum(a.ai_calls),0) AS ai_calls,
                         bool_or(coalesce(a.unknown_usage,false)) AS unknown_usage,
                         sum(coalesce(a.tokens,0)::double precision/s.n) AS tokens
                         FROM roots r JOIN shares s ON s.user_id=r.user_id AND s.client_id=r.client_id
                         LEFT JOIN usage a ON a.user_id=r.user_id AND a.request_id=r.client_id
                         GROUP BY r.entry_id)
                       SELECT (SELECT count(*) FROM logged) AS logged_items,count(*) AS tracked_items,
                         count(*) FILTER (WHERE ai_calls>0) AS items_needing_ai,
                         count(*) FILTER (WHERE unknown_usage) AS unknown_token_items,
                         percentile_cont(.5) WITHIN GROUP (ORDER BY CASE WHEN NOT unknown_usage THEN tokens END) AS median_attributed_tokens
                         FROM attributed''',(start_at,end_at)).fetchone()
    # Allocate one batch's recorded tokens evenly across its linked foods. Never
    # turn an unmeasured attempt or an unlinked historical food into zero usage.
    tracked=coverage['tracked_items'];needed=coverage['items_needing_ai']
    spent=sum(int(r['estimated_or_reserved_microusd']) for r in daily)
    total_tokens=sum(int(r['input_tokens'])+int(r['output_tokens'])+int(r['thinking_tokens']) for r in daily)
    return {'month':month.isoformat(),'daily':daily,'logging_active_users':active,
            'active_definition':'Logged food, an activity or a weight in this month',
            'estimated_or_reserved_usd':spent/1_000_000,
            'cost_per_logging_active_user_usd':spent/1_000_000/active if active else None,
            **{k:v for k,v in coverage.items() if k!='median_attributed_tokens'},
            'unattributed_items':coverage['logged_items']-tracked,
            'no_ai_share_of_tracked_items':(tracked-needed)/tracked if tracked else None,
            'median_tokens_per_tracked_item':(0 if tracked and needed*2<tracked else coverage['median_attributed_tokens'] if not coverage['unknown_token_items'] else None),
            'recorded_tokens_per_logged_item':total_tokens/coverage['logged_items'] if coverage['logged_items'] else None,
            'usage_complete':all(r['unknown_usage_attempts']==0 for r in daily),
            'note':'Unlinked older logs have unknown attribution. Missing provider usage keeps its cost hold. Batch tokens are allocated evenly across their linked foods; attribution is not available for older unlinked foods.'}


if __name__ == '__main__':
    import json,sys
    month=dt.date.fromisoformat(sys.argv[1]) if len(sys.argv)>1 else dt.datetime.now(dt.timezone.utc).date().replace(day=1)
    print(json.dumps(report(month),default=str,indent=2))


def release_failed(rid,status):
    """An explicit Gemini HTTP failure is not a bill; a timeout without response stays held."""
    if type(status) is int and 400<=status<600:
        settle(rid,{'usageMetadata':{'promptTokenCount':0,'candidatesTokenCount':0,'thoughtsTokenCount':0}})
