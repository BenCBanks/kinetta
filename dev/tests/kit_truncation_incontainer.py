"""Real transport/answer-path truncation replay; fake HTTP only, never a provider call."""
import copy
import io
import json
from unittest.mock import patch
from app import coach_chat,kit_conversation
from app.kit_eval_diagnostics import RejectionDiagnostics

COMPLETE={'blocks':[{'kind':'paragraph','text':'Choose a routine you enjoy.'}],'facts':[]}
TRUNCATED='```json\n{"blocks":[{"kind":"paragraph","text":"Choose a routine'

def response(text,reason,thinking=6000):
    return {'candidates':[{'finishReason':reason,'content':{'role':'model','parts':[{'text':text}]}}],
            'usageMetadata':{'promptTokenCount':1000,'candidatesTokenCount':120,
                             'thoughtsTokenCount':thinking,'totalTokenCount':1120+thinking}}


diag=RejectionDiagnostics(coach_chat)

def replay(responses,*,level='LOW',corrections=True,revoked=False):
    requests=[];bodies=iter(responses)
    def fake_http(request,**kwargs):
        requests.append(json.loads(request.data))
        return io.BytesIO(json.dumps(next(bodies)).encode())
    def allowed(uid):return not revoked or not requests
    original=coach_chat._gemini_turn
    def setting(messages,definitions,**kwargs):
        return original(messages,definitions,thinking_level=level,**kwargs)
    capture=diag.begin()
    try:
        with patch.dict('os.environ',{'GEMINI_API_KEY':'fixture','GEMINI_MODEL':'gemini-3.8-flash'}), \
             patch('app.coach.allowed',side_effect=allowed),patch('app.coach.provider',return_value='gemini'), \
             patch('app.kit_tools.KitTools.call',return_value={'units':'metric'}), \
             patch('app.coach_chat.ai_budget.reserve',return_value=1),patch('app.coach_chat.ai_budget.lease'), \
             patch('app.coach_chat.ai_budget.settle'),patch('app.coach_chat.ai_budget.finish'), \
             patch('app.coach_chat.urllib.request.urlopen',side_effect=fake_http), \
             patch('app.coach_chat._gemini_turn',side_effect=setting),kit_conversation.correction_policy(corrections):
            try:answer=coach_chat.answer(1,'How can I build a routine?',kit=True)
            except ValueError as error:answer=error
    finally:diag.end()
    return answer,requests,capture

for level,ceiling in [('LOW',8192),('MEDIUM',16384)]:
    answer,requests,capture=replay([response(TRUNCATED,'MAX_TOKENS'),response(json.dumps(COMPLETE),'STOP')],level=level)
    assert isinstance(answer,dict),answer
    assert answer['interpretation']=='Choose a routine you enjoy.'
    assert len(requests)==2 and 'tools' not in requests[1]
    assert [r['generationConfig']['maxOutputTokens'] for r in requests]==[ceiling,ceiling*2]
    assert requests[1]['generationConfig']['responseMimeType']=='application/json'
    assert requests[1]['generationConfig']['thinkingConfig']=={'thinkingLevel':level}
    assert answer['usage']=={'promptTokenCount':2000,'candidatesTokenCount':240,
                              'thoughtsTokenCount':12000,'totalTokenCount':14240}
    assert capture['attempts'][0]['validation_error']=='provider_max_tokens'
    assert capture['attempts'][0]['raw_model_json']==TRUNCATED
    assert [t['finish_reason'] for t in capture['provider_turns']]==['MAX_TOKENS','STOP']
    assert capture['provider_turns'][0]['usage']['thoughtsTokenCount']==6000
    assert capture['provider_turns'][1]['max_output_tokens']==ceiling*2
    assert any('COMPLETE JSON' in p.get('text','') for c in requests[1]['contents'] if c['role']=='user' for p in c['parts'])
    assert kit_conversation.output_tokens(kit_conversation.SYSTEM,0,thinking_level=level)==ceiling

# Even apparently valid JSON marked MAX_TOKENS must not be displayed as a completed answer.
answer,requests,_=replay([response(json.dumps(COMPLETE),'MAX_TOKENS'),response(json.dumps(COMPLETE),'STOP')])
assert isinstance(answer,dict) and len(requests)==2
# Thinking can consume the whole allowance, leaving no content at all; still retry once.
empty=response('', 'MAX_TOKENS');empty['candidates'][0].pop('content')
answer,requests,_=replay([empty,response(json.dumps(COMPLETE),'STOP')])
assert isinstance(answer,dict) and len(requests)==2
# Two truncations fail closed; no loop, no partial answer, and all failed-turn metadata survives.
answer,requests,capture=replay([response(TRUNCATED,'MAX_TOKENS'),response(TRUNCATED,'MAX_TOKENS')])
assert isinstance(answer,ValueError) and len(requests)==2
assert len(capture['provider_turns'])==2 and len(capture['attempts'])==2
# A retry still receives exact numeric validation, rather than a permissive fallback.
bad=copy.deepcopy(COMPLETE);bad['blocks'][0]['text']='You logged 999 kcal.'
answer,requests,_=replay([response(TRUNCATED,'MAX_TOKENS'),response(json.dumps(bad),'STOP')])
assert isinstance(answer,ValueError) and len(requests)==2
# Smoke disables production correction; revoked consent/visit guards cannot generate a retry.
for options in ({'corrections':False},{'revoked':True}):
    answer,requests,_=replay([response(TRUNCATED,'MAX_TOKENS')],**options)
    assert isinstance(answer,ValueError) and len(requests)==1
# Other modes retain reviewed budgets; the ceiling is scoped and never spills across requests.
assert kit_conversation.output_tokens(coach_chat.SYSTEM,2500,thinking_level='MEDIUM')==2500
assert kit_conversation.output_tokens(coach_chat.KIT_WEEKLY_SYSTEM,4096,thinking_level='MEDIUM')==4096
print('Kit truncation: LOW/MEDIUM budgets, one larger no-tools retry, repeated truncation, exact validation, consent, smoke cap and per-turn finish/token diagnostics PASS')

# Frozen adapters that discard finishReason still expose it at their existing settlement boundary.
from types import SimpleNamespace
class Frozen:
    ai_budget=SimpleNamespace(settle=lambda *args:None)
    def _gemini_turn(self,*args,**kwargs):
        payload=response(TRUNCATED,'MAX_TOKENS')
        self.ai_budget.settle(1,payload)
        return [],TRUNCATED,payload['usageMetadata']
    _claude_turn=_gemini_turn
    def _json(self,text):return json.loads(text)
    def checked_answer(self,*args,**kwargs):return {}
frozen=Frozen();legacy_diag=RejectionDiagnostics(frozen);capture=legacy_diag.begin()
frozen._gemini_turn([],[])
legacy_diag.end()
assert capture['provider_turns'][0]['finish_reason']=='MAX_TOKENS'
assert capture['provider_turns'][0]['usage']['thoughtsTokenCount']==6000
assert capture['attempts'][0]['raw_model_json']==TRUNCATED
print('Frozen-baseline finish metadata captured without altering baseline bytes PASS')
