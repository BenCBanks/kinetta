"""Exact fictional final-gate replies: supported count prose and hard-negative mutations."""
import copy,json
from unittest.mock import patch
from app import coach_chat,kit_claims
capture=json.load(open('/tmp/kit-gate-rest-heavy.json'))
cases=[{'raw_model_json':raw,'evidence':capture['evidence']} for raw in capture['raw_model_json']]
with patch('urllib.request.urlopen',side_effect=AssertionError('No provider calls')):
    # Duration deltas are app-computed evidence and now use the ordinary exact-value guard.
    assert coach_chat.checked_answer(coach_chat._json(cases[0]['raw_model_json']),cases[0]['evidence'],kit=True,weekly_review=True)['answer_blocks']
    invalid=copy.deepcopy(cases[0]['evidence']);invalid[1]['data']['change']['duration_s']['absolute']=None
    try:coach_chat.checked_answer(coach_chat._json(cases[0]['raw_model_json']),invalid,kit=True,weekly_review=True)
    except ValueError:pass
    else:raise AssertionError('Missing duration delta accepted')
    for case in cases[1:]:
        raw=coach_chat._json(case['raw_model_json'])
        answer=coach_chat.checked_answer(raw,case['evidence'],kit=True,weekly_review=True)
        assert answer['answer_blocks']
        for mutate in (
            lambda e:e[1]['data']['current']['totals'].update(workouts=2),
            lambda e:e[3]['data'].update(logged_days=2),
            lambda e:e[1]['data']['current']['totals'].update(workouts=True),
            lambda e:e[3]['data'].update(logged_days=True),
            lambda e:e[3]['data'].update(start='1999-01-01'),
            lambda e:e[3]['data'].update(end='1999-01-01'),
            lambda e:e.append(copy.deepcopy(e[1])),
            lambda e:e.append(copy.deepcopy(e[3])),
            lambda e:e[1].update(error='unavailable'),
            lambda e:e[3].update(error='unavailable'),
            lambda e:e.pop(1),
            lambda e:e.pop(3),
        ):
            evidence=copy.deepcopy(case['evidence']);mutate(evidence)
            try:coach_chat.checked_answer(raw,evidence,kit=True,weekly_review=True)
            except ValueError:pass
            else:raise AssertionError('Wrong/missing/ambiguous/prior-period count accepted')
        for before,after in (('one workout','two workouts'),('one logged meal day','two logged meal days')):
            changed=coach_chat._json(case['raw_model_json'].replace(before,after))
            try:coach_chat.checked_answer(changed,case['evidence'],kit=True,weekly_review=True)
            except kit_claims.ClaimRejected as error:assert error.reason_code=='numeric_unsupported'
            else:raise AssertionError('Invented spelled-out count accepted')
print('Final gate: final exact honest reply passes; duration delta checked exactly; 14 wrong/missing/ambiguous/date/count mutations reject; zero provider calls')
