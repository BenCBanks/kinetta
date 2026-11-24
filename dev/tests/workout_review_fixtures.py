"""Fictional, provider-free Kit workout-review cases. Run by coach_incontainer.py."""
from app import kit_workout_review, workout_compare


def comparison(sport='run', status='compared', notable='none'):
    return {'sport':sport,'status':status,'baseline_count':3,
        'current':{'distance_m':8046.72,'moving_s':2340,'pace_s_per_km':300,'speed_mps':None,
                   'avg_hr':150,'ascent_m':100,'avg_temp_c':22},
        'deltas':{'pace_s_per_km':-12,'avg_hr':-3,'ascent_m':40},
        'relations':{'pace_s_per_km':'faster','avg_hr':'lower'},'notable':notable}


def answer(path, value, *, verdict='My workout was {e2:0}.', next_step='Keep the effort comfortable next time.', follow_ups=None):
    return {'facts':[{'evidence_id':'e2','path':path,'value':value}],
            'workout_review':{'verdict':verdict,'next_step':next_step},
            'follow_ups':follow_ups or ['Compare it with my last workout.']}


def fixture(name, units='metric', data=None, raw=None, expected='pass', expected_display=None):
    data=data or comparison()
    raw=raw or answer(['deltas','pace_s_per_km'],-12)
    return {'name':name,'units':units,'data':data,'raw':raw,'expected':expected,'display':expected_display}


CASES = [
    fixture('run faster metric',data=comparison(),expected_display='12 s/km faster'),
    fixture('run slower imperial',units='imperial',data={**comparison(),'deltas':{'pace_s_per_km':14},'relations':{'pace_s_per_km':'slower'}},raw=answer(['deltas','pace_s_per_km'],14),expected_display='23 s/mi slower'),
    fixture('run same pace',data={**comparison(),'deltas':{'pace_s_per_km':2},'relations':{'pace_s_per_km':'about_the_same'}},raw=answer(['deltas','pace_s_per_km'],2),expected_display='about the same'),
    fixture('hot workout',data={**comparison(),'current':{**comparison()['current'],'avg_temp_c':30}},raw=answer(['current','avg_temp_c'],30,verdict='The recorded temperature was {e2:0}.')),
    fixture('hilly workout',data=comparison(notable='hillier'),raw=answer(['deltas','ascent_m'],40,verdict='My route is {e2:0}.'),expected_display='40 m more climbing'),
    fixture('first run',data={**comparison(status='not_enough_similar'),'baseline_count':0,'deltas':{},'relations':{}},raw=answer(['current','distance_m'],8046.72,verdict='My run covered {e2:0}.')),
    fixture('one comparable baseline',data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}},raw=answer(['current','moving_s'],2340,verdict='My workout was {e2:0}.')),
    fixture('no heart rate',data={**comparison(),'current':{**comparison()['current'],'avg_hr':None},'deltas':{'pace_s_per_km':-12},'relations':{'pace_s_per_km':'faster'}},raw=answer(['deltas','pace_s_per_km'],-12)),
    fixture('ride speed faster metric',data={**comparison('ride'),'current':{**comparison()['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':0.4},'relations':{'speed_mps':'faster'}},raw=answer(['deltas','speed_mps'],0.4,verdict='My speed difference was {e2:0}.')),
    fixture('ride speed slower imperial',units='imperial',data={**comparison('ride'),'current':{**comparison()['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':-0.4},'relations':{'speed_mps':'slower'}},raw=answer(['deltas','speed_mps'],-0.4,verdict='My speed difference was {e2:0}.')),
    fixture('ride speed same',data={**comparison('ride'),'current':{**comparison()['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':0.05},'relations':{'speed_mps':'about_the_same'}},raw=answer(['deltas','speed_mps'],0.05,verdict='My speed was {e2:0}.')),
    fixture('walk pace',data={**comparison('walk')},raw=answer(['deltas','pace_s_per_km'],-12)),
    fixture('strength summary only',data={**comparison('workout','summary_only'),'current':{**comparison('workout','summary_only')['current'],'moving_s':2700},'baseline_count':0,'deltas':{},'relations':{}},raw=answer(['current','moving_s'],2700,verdict='My session was {e2:0}.')),
    {'name':'health consent off','expected':'denied','source':'healthkit','consents':{'health_ok':False,'garmin_ok':True}},
    {'name':'garmin consent off','expected':'denied','source':'garmin_connect','consents':{'health_ok':True,'garmin_ok':False}},
    fixture('imperial current distance',units='imperial',data=comparison(),raw=answer(['current','distance_m'],8046.72,verdict='My run covered {e2:0}.')),
    fixture('metric current speed',data={**comparison('ride'),'current':{**comparison()['current'],'pace_s_per_km':None,'speed_mps':3.1}},raw=answer(['current','speed_mps'],3.1,verdict='My recorded speed was {e2:0}.')),
    fixture('reject raw number',raw=answer(['deltas','pace_s_per_km'],-12,verdict='I was 12 seconds faster.'),expected='numeric_unsupported'),
    fixture('reject number word',raw=answer(['deltas','pace_s_per_km'],-12,verdict='I was twice as fast.'),expected='numeric_unsupported'),
    fixture('reject foreign evidence',raw={**answer(['deltas','pace_s_per_km'],-12),'facts':[{'evidence_id':'e9','path':['deltas','pace_s_per_km'],'value':-12}]},expected='fact_unsupported'),
    fixture('reject follow-up addressed to the user',raw=answer(['deltas','pace_s_per_km'],-12,follow_ups=['I can tell you how you feel.']),expected='follow_up_invalid'),
]


def run():
    assert len(CASES)==21
    assert kit_workout_review.REJECTION_CODES==frozenset({'answer_shape','numeric_unsupported','fact_unsupported','follow_up_invalid'})
    assert kit_workout_review.WorkoutReviewRejected('model supplied arbitrary text').reason_code=='answer_shape'
    for case in CASES:
        if case['expected']=='denied':
            activity={'source':case['source'],'healthkit_id':None}
            assert not workout_compare._source_allowed(activity,case['consents']),case['name']
            assert case.get('provider_calls',0)==0,case['name']
            continue
        evidence=[{'evidence_id':'e1','tool':'profile','data':{'units':case['units']}},
                  {'evidence_id':'e2','tool':'workout_compare','data':case['data']}]
        try:
            result=kit_workout_review.checked_answer(case['raw'],evidence)
        except kit_workout_review.WorkoutReviewRejected as error:
            assert case['expected']==error.reason_code,(case['name'],error.reason_code,case['expected'])
            continue
        assert case['expected']=='pass',case['name']
        assert set(result['workout_review'])=={'verdict','next_step'},case['name']
        assert len(result['facts'])<=3 and len(result['follow_ups'])<=2,case['name']
        assert all(f['tool']=='workout_compare' and f['evidence_id']=='e2' for f in result['facts']),case['name']
        if case['display']:
            assert result['facts'][0]['display_value']==case['display'],(case['name'],result['facts'][0]['display_value'])
    return '21 fictional workout-review cases passed with stand-ins; no provider calls'


if __name__=='__main__':
    print(run())
