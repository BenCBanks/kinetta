"""Separate Kit release decisions, using temporary stand-in reports and no provider calls."""
import copy,json,os,tempfile
from pathlib import Path
from unittest.mock import patch
from app import ai_release

with tempfile.TemporaryDirectory() as directory,patch('urllib.request.urlopen',side_effect=AssertionError('No model calls')):
 report=Path(directory)/'kit.json'
 env={'KINETTA_KIT_ENABLED':'1','KINETTA_KIT_EVAL_REPORT':str(report),
      'KINETTA_COACH_TOOLS_ENABLED':'0','KINETTA_AI_EVAL_REPORT':'',
      'GEMINI_MODEL':'gemini-3.8-flash','GEMINI_FOOD_MODEL':'food-stand-in','GEMINI_FOOD_FALLBACK_MODEL':'food-fallback-stand-in'}
 with patch.dict(os.environ,env),patch('app.coach.provider',return_value='gemini'):
  assert not ai_release.enabled('kit'),'missing report'
  valid={'reviewed':True,'candidate_fingerprint':ai_release.kit_fingerprint(),
         'kit':{'case_count':42,'unsupported_numeric_claims':0,'isolation_failures':0,'health_disclosures':0,
                'baseline_compared':True,'conversation_review_passed':True,'qualitative_review_passed':True}}
  def checked(data):
   report.write_text(json.dumps(data));return ai_release.enabled('kit')
  assert checked(valid),'Kit uses its own reviewed report without a food-photo result'
  assert not ai_release.enabled() and not ai_release.enabled('food'),'Kit approval does not enable legacy food/coach scopes'
  assert not ai_release.enabled('unknown')
  for flag in ['0','', 'true']:
   with patch.dict(os.environ,{'KINETTA_KIT_ENABLED':flag}):assert not ai_release.enabled('kit')
  for bad in [[],None,{'kit':[]},{'kit':None},{},'invalid']:
   assert not checked(bad),'malformed report fails closed'
  report.write_text('{');assert not ai_release.enabled('kit')
  for key,value in [('reviewed',False),('reviewed','true'),('candidate_fingerprint','mismatched')]:
   bad=copy.deepcopy(valid);bad[key]=value;assert not checked(bad),key
  for key,value in [('case_count',39),('case_count','42'),('unsupported_numeric_claims',1),('isolation_failures',1),('health_disclosures',1),
                    ('baseline_compared',False),('conversation_review_passed',False),('qualitative_review_passed',False)]:
   bad=copy.deepcopy(valid);bad['kit'][key]=value;assert not checked(bad),key
  for key in valid['kit']:
   bad=copy.deepcopy(valid);del bad['kit'][key];assert not checked(bad),key
  assert checked(valid)
  with patch.dict(os.environ,{'GEMINI_FOOD_MODEL':'other-food-model','GEMINI_FOOD_FALLBACK_MODEL':'other-food-fallback'}):
   assert ai_release.enabled('kit'),'unrelated food model settings do not invalidate Kit review'
  with patch.dict(os.environ,{'GEMINI_MODEL':'other-coach-model'}):assert not ai_release.enabled('kit')
  with patch('app.coach.provider',return_value='anthropic'):assert not ai_release.enabled('kit')
  original_read=Path.read_bytes
  def changed_source(path):
   return original_read(path)+(b'\n# changed Kit tool' if path.name=='kit_tools.py' else b'')
  with patch.object(Path,'read_bytes',changed_source):assert not ai_release.enabled('kit'),'Kit tool edits invalidate review'
  # A legacy passing report still cannot enable Kit when its own switch/report are absent.
  old=Path(directory)/'legacy.json'
  old.write_text(json.dumps({'reviewed':True,'candidate_fingerprint':ai_release.fingerprint(),'food':{'passed':True},
   'coach':{'case_count':30,'unsupported_numeric_claims':0,'isolation_failures':0,'qualitative_review_passed':True},
   'food_chat':{'case_count':30,'unsupported_numeric_claims':0,'isolation_failures':0,'health_disclosures':0,'qualitative_review_passed':True}}))
  with patch.dict(os.environ,{'KINETTA_COACH_TOOLS_ENABLED':'1','KINETTA_AI_EVAL_REPORT':str(old),'KINETTA_KIT_ENABLED':'0','KINETTA_KIT_EVAL_REPORT':''}):
   assert ai_release.enabled() and ai_release.enabled('food') and not ai_release.enabled('kit')
print('Separate Kit release gate: explicit review, baseline, source/model binding, food independence and malformed/missing reports PASS')
