"""Real transport construction with blocked network; Kit tuning never changes legacy/food settings."""
import io,json,os
from unittest.mock import patch
from app import coach_chat,kit_tools
bodies=[]
class Reply(io.StringIO):
 def __enter__(self):return self
 def __exit__(self,*args):self.close()
def respond(req,**kw):
 bodies.append(json.loads(req.data));return Reply(json.dumps({'candidates':[{'content':{'role':'model','parts':[{'text':'{"interpretation":"Use the saved target as context.","facts":[]}'}]}}],'usageMetadata':{'promptTokenCount':100,'candidatesTokenCount':30,'totalTokenCount':130}}))
with patch.dict(os.environ,{'GEMINI_API_KEY':'placeholder','GEMINI_MODEL':'gemini-3.8-flash'}),patch('app.ai_budget.reserve',return_value=None),patch('app.ai_budget.settle'),patch('app.ai_budget.finish'),patch('urllib.request.urlopen',side_effect=respond):
 messages=[{'role':'user','parts':[{'text':'Fictional question'}]}]
 coach_chat._gemini_turn(messages,kit_tools.specifications(),system=coach_chat.KIT_SYSTEM)
 assert bodies[-1]['generationConfig']['thinkingConfig']=={'thinkingLevel':'LOW'}
 assert bodies[-1]['generationConfig']['maxOutputTokens']==2500
 coach_chat._gemini_turn([{'role':'user','parts':[{'text':'Fictional question'}]}],[],system=coach_chat.KIT_SYSTEM)
 assert 'tools' not in bodies[-1] and bodies[-1]['generationConfig']['responseMimeType']=='application/json'
 coach_chat._gemini_turn([{'role':'user','parts':[{'text':'Fictional question'}]}],kit_tools.specifications())
 assert 'thinkingConfig' not in bodies[-1]['generationConfig'],'legacy/food provider settings unchanged'
for action in ['javascript:bad',{'path':'/admin'}]:
 try:coach_chat.checked_answer({'interpretation':'Open a tool.','facts':[],'actions':[action]},[])
 except ValueError:pass
 else:raise AssertionError('Arbitrary model destination')
print('Kit transport: configured low thinking, finite final JSON turn, unchanged legacy settings, no arbitrary action paths PASS')
