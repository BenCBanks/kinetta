"""Offline proof: actual disposable SQL caps allow more than twenty attempts."""
import json,os,uuid
from unittest.mock import patch
from app import ai_budget,db
from kit_eval_support import configure_budget,cap_reason
assert os.environ.get('KINETTA_JOURNEY_FIXTURE')=='1'
assert os.environ.get('KINETTA_KIT_EVAL_ISOLATED')=='1'
uid=None
try:
    with db.connect() as c:
        uid=c.execute("INSERT INTO users(login,name) VALUES (%s,'Fictional cap test') RETURNING id",('zz_test_smoke_caps_'+uuid.uuid4().hex,)).fetchone()['id']
    configure_budget(.45)
    with patch.dict(os.environ,{'KINETTA_AI_ENABLED':'1'}),patch('urllib.request.urlopen',side_effect=AssertionError('No provider calls')):
        with ai_budget.scope(uid,feature='Offline smoke budget proof'):
            for _ in range(60):
                rid=ai_budget.reserve('gemini-3.8-flash','offline',{'contents':[{'text':'fictional '*100}],
                    'generationConfig':{'maxOutputTokens':8192}})
                ai_budget.settle(rid,{'usageMetadata':{'promptTokenCount':1000,'candidatesTokenCount':100}})
                ai_budget.finish(rid)
            try:ai_budget.reserve('gemini-3.8-flash','offline',{'generationConfig':{'maxOutputTokens':65536}})
            except Exception as error:
                assert error.status_code==429
                assert cap_reason(ai_budget,uid)=='padded_dollar_reservation'
            else:raise AssertionError('Dollar cap bypassed')
    with db.connect() as c:
        cost=c.execute('SELECT count(*) AS n,sum(charged_micros) AS cost FROM ai_food_attempts WHERE user_id=%s',(uid,)).fetchone()
    assert cost['n']==60 and cost['cost']==135000,cost
    print(json.dumps({'provider_calls':0,'attempts':60,'simulated_cost_usd':.135,'dollar_cap':'enforced','attempt_limit':1000}))
finally:
    if uid:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))

# Replay the interrupted MEDIUM tool flow through the real transport body builder.
# Only HTTP is a stand-in. The actual reserve() decides whether each request fits.
from functools import partial
from app import coach_chat,coach
fixtures=json.load(open('/tmp/kit-smoke3-fixtures.json'))
evidence=fixtures[0]['evidence']
real_reserve=ai_budget.reserve
holds=[];http=[]
def reserve(model,label,payload=None):
    holds.append(ai_budget.price(model,*ai_budget.request_tokens(payload)))
    return real_reserve(model,label,payload)
def response(request,**kwargs):
    import io
    http.append(1)
    return io.BytesIO(json.dumps({'candidates':[{'finishReason':'STOP','content':{'role':'model','parts':[
        {'functionCall':{'name':'nutrition_adequacy','args':evidence[1]['arguments']}}]}}],
        'usageMetadata':{'promptTokenCount':3859,'candidatesTokenCount':41}}).encode())
uid=None
try:
    with db.connect() as c:
        uid=c.execute("INSERT INTO users(login,name) VALUES (%s,'Fictional cap test') RETURNING id",('zz_test_reservation_'+uuid.uuid4().hex,)).fetchone()['id']
        c.execute("UPDATE ai_service_budget SET charged_micros=217723 WHERE day=(now() AT TIME ZONE 'UTC')::date")
    configure_budget(.405) # exact prior smoke's effective cap
    with patch.dict(os.environ,{'KINETTA_AI_ENABLED':'1','GEMINI_API_KEY':'offline-stand-in'}), \
         patch.object(coach,'allowed',return_value=True),patch.object(coach,'provider',return_value='gemini'), \
         patch('app.kit_tools.KitTools.call',side_effect=lambda name,args:next(e['data'] for e in evidence if e['tool']==name)), \
         patch.object(ai_budget,'reserve',side_effect=reserve),patch('urllib.request.urlopen',side_effect=response), \
         patch.object(coach_chat,'_gemini_turn',partial(coach_chat._gemini_turn,thinking_level='MEDIUM')):
        with ai_budget.scope(uid):
            try:coach_chat.answer(uid,'Review my nutrition adequacy over the last completed week.',kit=True)
            except Exception as error:
                assert getattr(error,'status_code',None)==429,error
                assert cap_reason(ai_budget,uid)=='padded_dollar_reservation'
            else:raise AssertionError('Prior cap did not reproduce')
    assert len(http)==1 and len(holds)==2,(http,holds)
    print(json.dumps({'prior_smoke_cap_reproduced':'padded_dollar_reservation','reserved_holds_usd':[n/1e6 for n in holds],
                      'stubbed_http_calls':len(http),'provider_calls':0}))
finally:
    if uid:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=%s',(uid,))
