"""Evidence validation, controlled options, provider stand-ins and consent gates. No model network."""
import copy
import datetime as dt
from unittest.mock import patch
from app import coach_chat, coach_proposals, coach_tools

valid = {'interpretation': 'Logged intake is the evidence; missing days limit the average.', 'facts': [{'evidence_id': 'e1', 'path': ['average_per_logged_day', 'protein_g'], 'value': 80}], 'selection': None}
evidence = [{'evidence_id': 'e1', 'tool': 'nutrition_summary', 'arguments': {}, 'data': {'average_per_logged_day': {'protein_g': 80}, 'limitations': ['Missing days.']}}]
assert coach_chat.checked_answer(valid, evidence)['facts'][0]['value'] == 80
for name in ['unsupported_value', 'unknown_evidence', 'wrong_path', 'numbers_in_prose', 'invented_selection', 'user_id']:
    bad = copy.deepcopy(valid)
    if name == 'unsupported_value': bad['facts'][0]['value'] = 160
    elif name == 'unknown_evidence': bad['facts'][0]['evidence_id'] = 'e9'
    elif name == 'wrong_path': bad['facts'][0]['path'] = ['other', 'protein_g']
    elif name == 'numbers_in_prose': bad['interpretation'] = 'You average 180 g protein.'
    elif name == 'invented_selection': bad['selection'] = {'kind': 'food', 'evidence_id': 'e1', 'candidate_id': 'invented'}
    elif name == 'user_id': bad['user_id'] = 2
    try: coach_chat.checked_answer(bad, evidence)
    except ValueError: pass
    else: raise AssertionError(name)

plan = {'plan': {'unit': 'km'}, 'today': '2026-10-14', 'weeks': [{'workouts': [
 {'day': '2026-10-12', 'status': 'missed', 'type': 'easy', 'dist': 5},
 {'day': '2026-10-13', 'status': 'missed', 'type': 'easy', 'dist': 5},
 {'day': '2026-10-15', 'status': 'upcoming', 'type': 'tempo', 'dist': 10},
 {'day': '2026-10-18', 'status': 'upcoming', 'type': 'race', 'dist': 42.2}]}]}
choices = coach_proposals.plan_options(plan, {'days': []})
assert len(choices['candidates']) == 2
change = choices['candidates'][1]['changes'][0]
assert change['type'] == 'easy' and change['dist'] == 8
coach_proposals.validate_plan_changes(plan, [change])
for key, value in [('dist', 12), ('type', 'intervals'), ('day', '2026-10-12'), ('day', '2026-10-18'), ('dist', 1)]:
    wrong = {**change, key: value}
    try: coach_proposals.validate_plan_changes(plan, [wrong])
    except ValueError: pass
    else: raise AssertionError((key, value))
healthy = copy.deepcopy(plan)
for workout in healthy['weeks'][0]['workouts']:
 if workout['status']=='missed': workout['status']='done'
assert len(coach_proposals.plan_options(healthy, {'days': []})['candidates']) == 1

# Inspect a complete tool loop with a stand-in provider, including exact provider result envelopes.
from app import db
with db.connect() as c:
 uid=c.execute("SELECT id FROM users WHERE login='alex'").fetchone()['id']
def turn(messages, definitions):
 if len(messages)==1:
  return [{'name':'nutrition_summary','args':{'start':'2026-10-01','end':'2026-10-14'},'id':'call-1'}], '', {}
 result=messages[-1]['parts'][0]['functionResponse']['response']
 assert result['tool']=='nutrition_summary' and result['evidence_id']=='e1'
 value=result['data']['logged_days']
 return [], __import__('json').dumps({'interpretation':'This count covers logged days only.', 'facts':[{'evidence_id':'e1','path':['logged_days'],'value':value}]}), {'promptTokenCount':100,'candidatesTokenCount':40}
with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True),patch('app.coach.provider',return_value='gemini'):
 result=coach_chat.answer(uid,'How many days have I logged?',turn=turn)
 assert result['tools_used']==['nutrition_summary'] and result['facts'][0]['value']>=0
 def endless(messages,definitions): return [{'name':'profile','args':{},'id':'endless'}],'',{}
 try: coach_chat.answer(uid,'Never stop',turn=endless)
 except ValueError: pass
 else: raise AssertionError('Unbounded provider loop')
with patch('app.coach.allowed',return_value=False):
 try: coach_chat.answer(uid,'Any question',turn=turn)
 except ValueError: pass
 else: raise AssertionError('Consent missing')
print('Coach evidence, plan guardrails, provider loop, limits and consent stand-ins passed')

# A missing, mismatched or unreviewed benchmark never turns the new coach on.
import json, os, tempfile
from app import ai_release
with tempfile.TemporaryDirectory() as directory:
 report=__import__('pathlib').Path(directory)/'report.json'
 with patch.dict(os.environ, {'KINETTA_COACH_TOOLS_ENABLED':'1','KINETTA_AI_EVAL_REPORT':str(report)}):
  assert not ai_release.enabled()
  report.write_text(json.dumps({'reviewed':True,'candidate_fingerprint':'wrong','food':{'passed':True},'coach':{'case_count':30,'unsupported_numeric_claims':0,'isolation_failures':0,'qualitative_review_passed':True}}))
  assert not ai_release.enabled()
  report.write_text(json.dumps({'reviewed':True,'candidate_fingerprint':ai_release.fingerprint(),'food':{'passed':True},'coach':{'case_count':30,'unsupported_numeric_claims':0,'isolation_failures':0,'qualitative_review_passed':True}}))
  assert ai_release.enabled()
print('Reviewed comparison/configuration release gate passed')
