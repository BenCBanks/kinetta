"""Owner-captured fictional release findings, exact outputs and counterfactual evidence."""
import copy,json
from unittest.mock import patch
from app import coach_chat,kit_claims,kit_conversation
cases={c['case']:c for c in json.load(open('/tmp/kit-release-claims.json'))}
def checked(case,evidence=None,raw=None):
    return coach_chat.checked_answer(raw or coach_chat._json(case['raw_model_json']),
        evidence if evidence is not None else case['evidence'],kit=True,
        weekly_review=case['case'].startswith('weekly-'),conversation_question=case['question'])
for name,case in cases.items():
    if name=='low-intake':
        try:checked(case)
        except kit_claims.ClaimRejected as error:assert error.reason_code=='health_claim'
        else:raise AssertionError('Unsafe restriction advice accepted')
    else:assert checked(case)['answer_blocks']
for name in ('meal','food-detail','weekly-activity-injection'):
    text=checked(cases[name])['interpretation']
    assert 'g protein' in text and 'protein protein' not in text,text
assert 'may reflect natural day-to-day fluctuations' in checked(cases['weight'])['interpretation']
assert checked(cases['sodium'])['claim_evidence']
for name,change in (
    ('weekly-steady-prior',lambda e:next(s for s in e if s['tool']=='period_compare')['data']['change']['duration_s'].update(absolute=None)),
    ('weekly-steady-prior',lambda e:next(s for s in e if s['tool']=='period_compare')['data']['change']['distance_m'].update(absolute=-5000)),
    ('weekly-rest-heavy',lambda e:next(s for s in e if s['tool']=='period_compare')['data']['change']['duration_s'].update(absolute=5400)),
    ('saturated-fat',lambda e:e[0]['data'].update(saturated_fat_target_g=10)),
    ('saturated-fat',lambda e:e[0]['data'].pop('saturated_fat_target_g')),
    ('plan-change',lambda e:next(s for s in e if s['tool']=='plan_options')['data']['facts']['latest_load'].update(form=10)),
    ('sodium',lambda e:e[1]['data']['foods'][2].update(sodium_mg=700)),
    ('sodium',lambda e:e[1]['data']['foods'][2].update(amount=2)),
    ('sodium',lambda e:e[1]['data'].update(next_before_id=5)),
):
    evidence=copy.deepcopy(cases[name]['evidence']);change(evidence)
    try:checked(cases[name],evidence)
    except ValueError:pass
    else:raise AssertionError('Unsupported counterfactual accepted: '+name)
plan=cases['plan-change'];raw=coach_chat._json(plan['raw_model_json']);raw['selection']=None
for change in (
    lambda e:next(s for s in e if s['tool']=='plan_options')['data'].update(candidates=[]),
    lambda e:[c.update(changes=[{**x,'type':'long'} for x in c.get('changes',[])]) for c in next(s for s in e if s['tool']=='plan_options')['data']['candidates']],
):
    evidence=copy.deepcopy(plan['evidence']);change(evidence)
    try:checked(plan,evidence,raw)
    except kit_claims.ClaimRejected:pass
    else:raise AssertionError('Missing easy reduction accepted')
# The selected plan must support the easy-run wording; another candidate cannot lend its proof.
evidence=copy.deepcopy(plan['evidence'])
next(s for s in evidence if s['tool']=='plan_options')['data']['candidates'][1]['changes'][0]['type']='long'
try:checked(plan,evidence)
except kit_claims.ClaimRejected:pass
else:raise AssertionError('A different easy candidate licensed the selected long workout')
# Nutrient labels stay adjacent, without duplicating already named metrics.
ev=cases['meal']['evidence'];raw=coach_chat._json(cases['meal']['raw_model_json'])
for wording in ('Protein is {e2:1}.','The meal provides {e2:1} protein.','The meal provides {e2:1}.'):
    example=copy.deepcopy(raw);example['blocks']=[{'kind':'paragraph','text':wording}]
    result=coach_chat.checked_answer(example,ev,kit=True)['interpretation']
    assert 'protein protein' not in result.lower() and 'protein' in result.lower(),result
# Production takes the application-owned safety route BEFORE any tool/provider access.
with patch('app.coach.allowed',return_value=True),patch('app.coach.provider',side_effect=AssertionError('No provider')), \
     patch('app.kit_tools.KitTools.call',side_effect=AssertionError('No data reads')):
    answer=coach_chat.answer(1,cases['low-intake']['question'],kit=True)
    assert answer==kit_claims.eating_safety_answer(cases['low-intake']['question'])
    assert 'doctor or registered dietitian' in answer['interpretation'] and 'deficit' not in answer['interpretation']
    assert not answer['facts'] and not answer['health_included']
assert kit_claims.eating_safety_answer('Did I eat nothing on days with no food logged?') is None
kit_claims.claim_evidence(['General guidance includes increasing volume gradually.'],[])
for text in ('General guidance says you increased distance.','Your distance is higher.','Your heart rate is lower.','You improved your fitness.','This workout was shorter.','Your weight is the same.','You recorded none.','Keep in mind your heart rate is higher.'):
    try:kit_claims.claim_evidence([text],[])
    except kit_claims.ClaimRejected:pass
    else:raise AssertionError('Unbacked comparison accepted')
period=[{'evidence_id':'e2','tool':'period_compare','data':{'change':{'pace_s_per_km':{'absolute':-12},'avg_hr':{'absolute':3}}}}]
assert kit_claims.claim_evidence(['Your pace was faster.'],period)
for text in ('Your pace was slower.','Your heart rate improved.'):
    try:kit_claims.claim_evidence([text],period)
    except kit_claims.ClaimRejected:pass
    else:raise AssertionError('Wrong relation interpretation accepted')
print('Twelve exact release cases: eleven safely rendered replies pass; unsafe low-intake raw rejects; free production safety route passes; counterfactuals and nutrient naming pass')

# Tool evidence survives both successful reads and a consent error before answer validation.
from app.kit_eval_diagnostics import RejectionDiagnostics
class FakeAnswer:
    def _json(self,text):return json.loads(text)
    def checked_answer(self,*args,**kwargs):return {}
    def _gemini_turn(self,*args,**kwargs):return [],'{}',{}
    def _claude_turn(self,*args,**kwargs):return [],'{}',{}
class Tools:
    def call(self,name,arguments):
        if name=='denied':raise ValueError('consent')
        return {'units':'metric'}
recorder=RejectionDiagnostics(FakeAnswer());recorder.observe_tools(Tools);capture=recorder.begin()
assert Tools().call('profile',{})=={'units':'metric'}
try:Tools().call('denied',{})
except ValueError:pass
else:raise AssertionError('Observer changed error behavior')
assert capture['tool_calls']==[{'tool':'profile','arguments':{},'data':{'units':'metric'}},
                              {'tool':'denied','arguments':{},'error':'ValueError'}]
recorder.end()
print('Read/denied tool evidence retained without changing results or exceptions PASS')


# A row value is not a range total; the app can repair only a proven equal-entry group.
sugar=cases['sugar'];raw=coach_chat._json(sugar['raw_model_json'])
answer=checked(sugar)
assert 'Four logged entries each show 4 g sugar.' in answer['interpretation']
assert len([p for p in answer['claim_evidence'] if p['relation']=='equal_entries'])==4
facts=answer['facts'];sentence=raw['blocks'][0]['text']
try:kit_claims.food_scopes([sentence],facts,sugar['evidence'])
except kit_claims.ClaimRejected:pass
else:raise AssertionError('Unscoped row value passed without safe rendering')
for text in ('Your total sugar was {e2:0}.','Each entry shows {e2:0}.'):
    bad=copy.deepcopy(raw);bad['blocks']=[{'kind':'paragraph','text':text}]
    try:checked(sugar,raw=bad)
    except kit_claims.ClaimRejected:pass
    else:raise AssertionError('False total or uncounted each statement accepted')
for mutate in (
    lambda e:e[1]['data']['foods'][3].update(sugar_g=5),
    lambda e:e[1]['data'].update(next_before_id=99),
    lambda e:e[1]['data'].pop('next_before_id'),
):
    evidence=copy.deepcopy(sugar['evidence']);mutate(evidence)
    try:checked(sugar,evidence)
    except kit_claims.ClaimRejected:pass
    else:raise AssertionError('Unequal/paginated/unknown-completeness group silently repaired')
# Unknown flags beat stored numeric placeholders, including zero.
evidence=copy.deepcopy(sugar['evidence'])
evidence[1]['data']['foods'][0]['sugar_g']=0
evidence[1]['data']['foods'][0]['unknown_nutrients']=['sugar_g']
assert 'Four logged entries each show' in checked(sugar,evidence)['interpretation']
adequacy=cases['nutrition-adequacy'];out=checked(adequacy)['interpretation']
assert 'Unlogged days mean intake' in out and 'unknown nutrients mean' not in out
assert 'may include partial entries' in out
for text in ('Unknown nutrients mean full intake is unknown.',
             'Your calorie and protein values are missing.',
             'Foods lack nutrient details.'):
    try:kit_claims.missing_nutrient_evidence([text],adequacy['evidence'])
    except kit_claims.ClaimRejected:pass
    else:raise AssertionError('Generic limitations asserted a nonexistent unknown item')
# A current-day missing protein value cannot justify a completed-week missing-nutrient claim.
foreign_range=adequacy['evidence']+cases['sugar']['evidence'][1:]
try:kit_claims.missing_nutrient_evidence(['Unknown nutrients prevent comparison.'],foreign_range)
except kit_claims.ClaimRejected:pass
else:raise AssertionError('Borrowed a missing value from another period')
evidence=copy.deepcopy(adequacy['evidence'])
evidence[1]['data']['days'][-1]['protein_g']['unknown_items']=1
assert kit_claims.missing_nutrient_evidence(['Unknown nutrients prevent comparison.'],evidence)
text='Unlogged days and unknown nutrients mean intake cannot be evaluated.'
assert kit_claims.nutrition_wording(text,[],evidence)==text
assert kit_claims.missing_nutrient_evidence(['If nutrient values are missing, a full total is unknown.'],adequacy['evidence'])==[]
print('Per-entry count/scope, fake totals, known flags, real missing-item reasons and period isolation PASS')

assert kit_claims.missing_nutrient_evidence(['Unknown nutrient values must not be treated as zero.'],adequacy['evidence'])==[]

for text in ('Four logged entries each show unknown intake.', 'Three logged entries each show {e2:0}.'):
    bad=copy.deepcopy(raw);bad['blocks']=[{'kind':'paragraph','text':text}]
    try:checked(sugar,raw=bad)
    except kit_claims.ClaimRejected:pass
    else:raise AssertionError('Count phrase escaped exact food evidence')
