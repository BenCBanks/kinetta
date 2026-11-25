"""Fictional, provider-free Kit workout-review cases. Run by coach_incontainer.py."""
from app import kit_workout_review, workout_compare


def comparison(sport='run', status='compared', notable='none'):
    return {'sport':sport,'status':status,'baseline_count':3,
        'current':{'distance_m':8046.72,'moving_s':2340,'pace_s_per_km':300,'speed_mps':None,
                   'avg_hr':150,'ascent_m':100,'avg_temp_c':22},
        'baseline_medians':{'pace_s_per_km':312,'avg_hr':153,'ascent_m':60},
        'deltas':{'pace_s_per_km':-12,'avg_hr':-3,'ascent_m':40},
        'relations':{'pace_s_per_km':'faster','avg_hr':'lower'},'notable':notable}


def answer(path=None, value=None, *, data=None, verdict=None):
    data=data or comparison()
    facts=[]
    if data.get('status') == 'compared':
        facts.append({'evidence_id':'e2','path':['baseline_count'],'value':data['baseline_count']})
        metric = 'pace_s_per_km' if data.get('sport') in {'run','walk','hike'} else 'speed_mps'
        if metric not in data.get('deltas',{}):
            metric = next(iter(data.get('deltas',{})),None)
        if metric:
            delta_path=['deltas',metric]
            facts.append({'evidence_id':'e2','path':delta_path,'value':data['deltas'][metric]})
            if verdict is None:
                label={'pace_s_per_km':'pace','speed_mps':'speed','avg_hr':'heart rate'}.get(metric,metric)
                verdict=f'Compared with {{baseline}}, your {label} was {{e2:1}}.'
        if path and list(path) not in [fact['path'] for fact in facts]:
            facts.append({'evidence_id':'e2','path':list(path),'value':value})
        if verdict is None:
            verdict='Your workout has no measured difference to compare.'
    else:
        if path:
            facts.append({'evidence_id':'e2','path':list(path),'value':value})
        if verdict is None:
            verdict='Your workout gives you a useful starting point.'
    return {'facts':facts,'workout_review':{'verdict':verdict}}


def fixture(name, units='metric', data=None, raw=None, expected='pass', expected_display=None):
    data=data or comparison()
    raw=raw or answer(data=data)
    return {'name':name,'units':units,'data':data,'raw':raw,'expected':expected,'display':expected_display}



def multi_metric_answer(data):
    facts=[
        {'evidence_id':'e2','path':['baseline_count'],'value':data['baseline_count']},
        {'evidence_id':'e2','path':['deltas','pace_s_per_km'],'value':data['deltas']['pace_s_per_km']},
        {'evidence_id':'e2','path':['deltas','avg_hr'],'value':data['deltas']['avg_hr']},
    ]
    return {'facts':facts,'workout_review':{
        'verdict':'Compared with {baseline}, your pace was {e2:1}, and your heart rate was {e2:2}.'}}


CASES = [
    fixture('run faster metric',data=comparison(),expected_display='12 s/km faster'),
    fixture('real Gemini signed deltas and note instruction',data=comparison(),raw={
        'facts':[
            {'evidence_id':'e2','path':['baseline_count'],'value':3},
            {'evidence_id':'e2','path':['deltas','pace_s_per_km'],'value':-12},
            {'evidence_id':'e2','path':['deltas','avg_hr'],'value':-3},
        ],'workout_review':{
            'verdict':'Compared with {baseline}, your pace was {e2:1}, and your heart rate was {e2:2}.'},
    }),
    fixture('real Gemini ride speed delta and previous one',data={
        **comparison('ride'),
        'current':{**comparison('ride')['current'],'pace_s_per_km':None,'speed_mps':3.1},
        'deltas':{'speed_mps':0.4},'relations':{'speed_mps':'faster'}
    },raw={
        'facts':[
            {'evidence_id':'e2','path':['baseline_count'],'value':3},
            {'evidence_id':'e2','path':['deltas','speed_mps'],'value':0.4},
        ],'workout_review':{
            'verdict':'Compared with {baseline}, your speed was {e2:1}.'},
    }),
    fixture('real Gemini hillier sentence boundary',data=comparison(notable='hillier'),raw={
        'facts':[
            {'evidence_id':'e2','path':['baseline_count'],'value':3},
            {'evidence_id':'e2','path':['deltas','pace_s_per_km'],'value':-12},
            {'evidence_id':'e2','path':['deltas','ascent_m'],'value':40},
        ],'workout_review':{
            'verdict':'This route was hillier, with {e2:2} more climbing. Compared with {baseline}, your pace was {e2:1}.'},
    }),
    fixture('real Gemini strength cites unavailable fields',data={
        **comparison('workout','summary_only'),
        'current':{**comparison('workout','summary_only')['current'],'distance_m':None,'moving_s':2700,
                   'pace_s_per_km':None,'avg_hr':None,'speed_mps':None,'ascent_m':None,'avg_temp_c':None},
        'baseline_count':0,'deltas':{},'relations':{}
    },raw={
        'facts':[
            {'evidence_id':'e2','path':['current','distance_m'],'value':8046.72},
            {'evidence_id':'e2','path':['current','moving_s'],'value':2700},
            {'evidence_id':'e2','path':['current','pace_s_per_km'],'value':300},
            {'evidence_id':'e2','path':['current','avg_hr'],'value':150},
        ],'workout_review':{
            'verdict':'You completed a distance of {e2:0} in {e2:1}. Your average pace was {e2:2} with an average heart rate of {e2:3}.'},
    },expected='fact_unsupported'),
    fixture('real Gemini longest period notable',data=comparison(notable='longest_90d'),raw={
        'facts':[
            {'evidence_id':'e2','path':['baseline_count'],'value':3},
            {'evidence_id':'e2','path':['deltas','pace_s_per_km'],'value':-12},
            {'evidence_id':'e2','path':['current','distance_m'],'value':8046.72},
        ],'workout_review':{
            'verdict':'This was your longest run in the last ninety days. Compared with {baseline}, your pace was {e2:1}.'},
    }),
    fixture('real Gemini field-alias response',units='imperial',
        data={**comparison(),'deltas':{'pace_s_per_km':14},'relations':{'pace_s_per_km':'slower'}},
        raw={'facts':[
            {'evidence_id':'e2','field':'baseline_count','value':3},
            {'evidence_id':'e2','field':'deltas.pace_s_per_km','value':14},
        ],'workout_review':{
            'verdict':'Compared with {baseline}, your pace was {e2:1}.'},},
        expected='pass'),
    fixture('reject unknown dotted fact path',raw={**answer(data=comparison()),'facts':[
        {'evidence_id':'e2','path':'deltas.unlisted_metric','value':-12},
    ]},expected='answer_shape'),
    fixture('run slower imperial',units='imperial',data={**comparison(),'deltas':{'pace_s_per_km':14},'relations':{'pace_s_per_km':'slower'}},expected_display='23 s/mi slower'),
    fixture('run same pace',data={**comparison(),'deltas':{'pace_s_per_km':2},'relations':{'pace_s_per_km':'about_the_same'}},expected_display='within 2 s/km'),
    fixture('heart rate higher',data={**comparison(),'deltas':{'avg_hr':4},'relations':{'avg_hr':'higher'}},raw=answer(data={**comparison(),'deltas':{'avg_hr':4},'relations':{'avg_hr':'higher'}})),
    fixture('heart rate lower',data=comparison(),raw=answer(data=comparison())),
    fixture('ride speed faster metric',data={**comparison('ride'),'current':{**comparison('ride')['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':0.4},'relations':{'speed_mps':'faster'}},expected_display='1.4 km/h faster'),
    fixture('ride speed slower imperial',units='imperial',data={**comparison('ride'),'current':{**comparison('ride')['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':-0.4},'relations':{'speed_mps':'slower'}},expected_display='0.9 mph slower'),
    fixture('ride speed same',data={**comparison('ride'),'current':{**comparison('ride')['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':0.05},'relations':{'speed_mps':'about_the_same'}}),
    fixture('walk pace',data=comparison('walk')),
    fixture('swim speed',data={**comparison('swim'),'current':{**comparison('swim')['current'],'pace_s_per_km':None,'speed_mps':1.2},'deltas':{'speed_mps':0.2},'relations':{'speed_mps':'faster'}},expected_display='0.7 km/h faster'),
    fixture('strength summary only',data={**comparison('workout','summary_only'),'current':{**comparison('workout','summary_only')['current'],'distance_m':None,'moving_s':2700,'pace_s_per_km':None,'avg_hr':None,'speed_mps':None,'ascent_m':None,'avg_temp_c':None},'baseline_count':0,'deltas':{},'relations':{}},raw=answer(['current','moving_s'],2700,data={**comparison('workout','summary_only'),'current':{**comparison('workout','summary_only')['current'],'distance_m':None,'moving_s':2700,'pace_s_per_km':None,'avg_hr':None,'speed_mps':None,'ascent_m':None,'avg_temp_c':None},'baseline_count':0,'deltas':{},'relations':{}})),
    fixture('first run without baseline',data={**comparison(status='not_enough_similar'),'baseline_count':0,'deltas':{},'relations':{}},raw=answer(['current','distance_m'],8046.72,data={**comparison(status='not_enough_similar'),'baseline_count':0,'deltas':{},'relations':{}})),
    fixture('real first run field-alias response',data={**comparison(status='not_enough_similar'),'baseline_count':0,'deltas':{},'relations':{}},raw={'facts':[{'evidence_id':'e2','field':'current.distance_m','value':8046.72},{'evidence_id':'e2','field':'current.moving_s','value':2340},{'evidence_id':'e2','field':'current.avg_hr','value':150}],'workout_review':{'verdict':'Your workout gives you a useful starting point.'}}),
    fixture('one similar workout',data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}},raw=answer(['current','moving_s'],2340,data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}})),
    fixture('missing heart rate',data={**comparison(),'current':{**comparison()['current'],'avg_hr':None},'deltas':{'pace_s_per_km':-12},'relations':{'pace_s_per_km':'faster'}}),
    fixture('current distance imperial field alias',units='imperial',data=comparison(),raw={'facts':[{'evidence_id':'e2','field':'current.distance_m','value':8046.72},{'evidence_id':'e2','field':'deltas.pace_s_per_km','value':-12}],'workout_review':{'verdict':'Compared with {baseline}, your pace was {e2:1}.'}},expected_display='5 mi'),
    fixture('hot day notable',data={**comparison(notable='hotter'),'current':{**comparison()['current'],'avg_temp_c':30}}),
    fixture('hillier route notable',data=comparison(notable='hillier'),raw={'facts':[{'evidence_id':'e2','path':['baseline_count'],'value':3},{'evidence_id':'e2','path':['deltas','pace_s_per_km'],'value':-12},{'evidence_id':'e2','path':['deltas','ascent_m'],'value':40}],'workout_review':{'verdict':'This route was hillier, with {e2:2} more climbing. Compared with {baseline}, your pace was {e2:1}.'}}),
    fixture('longest in ninety days',data=comparison(notable='longest_90d'),raw=answer(data=comparison(notable='longest_90d'),verdict='This was your longest run in the last ninety days. Compared with {baseline}, your pace was {e2:1}.')),
    fixture('personal record notable',data=comparison(notable='personal_record'),raw=answer(data=comparison(notable='personal_record'),verdict='You set a personal record. Compared with {baseline}, your pace was {e2:1}.')),
    fixture('felt unknown without note',data=comparison(),raw=answer(data=comparison(),verdict="Your records can't tell how it felt. Compared with {baseline}, your pace was {e2:1}.")),
    {'name':'Health consent off','expected':'denied','source':'healthkit','consents':{'health_ok':False,'garmin_ok':True}},
    {'name':'Garmin consent off','expected':'denied','source':'garmin_connect','consents':{'health_ok':True,'garmin_ok':False}},
    fixture('reject unsupported digits',raw=answer(data=comparison(),verdict='Your pace was 12 seconds faster.'),expected='numeric_unsupported'),
    fixture('reject unsupported number words',raw=answer(data=comparison(),verdict='Your pace was twice as fast.'),expected='numeric_unsupported'),
    fixture('reject foreign evidence',raw={**answer(data=comparison()),'facts':[{'evidence_id':'e9','path':['deltas','pace_s_per_km'],'value':-12}]},expected='fact_unsupported'),
    fixture('reject model-supplied next step',raw={**answer(data=comparison()),'workout_review':{**answer(data=comparison())['workout_review'],'next_step':'Take medicine.'}},expected='answer_shape'),
    fixture('reject model-supplied follow-ups',raw={**answer(data=comparison()),'follow_ups':['Show my heart rate zones.']},expected='answer_shape'),
    fixture('reject missing comparison relation',raw=answer(data={**comparison(),'relations':{}}),data={**comparison(),'relations':{}},expected='relation_unsupported'),
    fixture('reject health claim in verdict',raw=answer(data=comparison(),verdict='Your training is safe and injury-free.'),expected='health_claim_unsupported'),
    fixture('reject reversed pace relation',raw=answer(data={**comparison(),'deltas':{'pace_s_per_km':-12},'relations':{'pace_s_per_km':'faster'}},verdict='Compared with {baseline}, your pace was {e2:1} slower.'),data={**comparison(),'deltas':{'pace_s_per_km':-12},'relations':{'pace_s_per_km':'faster'}},expected='relation_unsupported'),
    fixture('reject relation from different metric',raw=answer(data={**comparison(),'relations':{'speed_mps':'faster'}}),data={**comparison(),'relations':{'speed_mps':'faster'}},expected='relation_unsupported'),
    fixture('reject usual without matching relation',raw=answer(data={**comparison(),'relations':{'avg_hr':'lower'}},verdict='Your pace was usual against {baseline}.'),data={**comparison(),'relations':{'avg_hr':'lower'}},expected='relation_unsupported'),
    fixture('reject invented personal record',raw=answer(data=comparison(),verdict='Compared with {baseline}, your pace was {e2:1}. Your workout set a personal record.'),expected='relation_unsupported'),
    fixture('reject comparison without history',raw=answer(data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}},verdict='Your run was faster.'),data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}},expected='relation_unsupported'),
    fixture('reject invented feeling',raw=answer(data=comparison(),verdict='Your run felt easy.'),expected='voice_invalid'),
    fixture('reject jargon',raw=answer(data=comparison(),verdict='Your cardiovascular load was {e2:1}.'),expected='voice_invalid'),
    fixture('reject five total sentences',raw=answer(data=comparison(),verdict='Clear. Useful. Noted. Thanks.'),expected='voice_invalid'),
    fixture('reject unnamed baseline',raw=answer(data=comparison(),verdict='Pace: {e2:1}.'),expected='voice_invalid'),
    fixture('pace same and heart rate higher',data={**comparison(),'deltas':{'pace_s_per_km':2,'avg_hr':4},'relations':{'pace_s_per_km':'about_the_same','avg_hr':'higher'}},raw=multi_metric_answer({**comparison(),'deltas':{'pace_s_per_km':2,'avg_hr':4},'relations':{'pace_s_per_km':'about_the_same','avg_hr':'higher'}})),
    fixture('pace faster and heart rate lower',data=comparison(),raw=multi_metric_answer(comparison())),
    fixture('reject harder feeling in verdict',data=comparison(),raw=answer(data=comparison(),verdict='Your run felt harder than usual. Compared with {baseline}, your pace was {e2:1}.'),expected='voice_invalid'),
    fixture('reject first person in verdict',data=comparison(),raw=answer(data=comparison(),verdict="I can't tell how it felt. Compared with {baseline}, your pace was {e2:1}."),expected='voice_invalid'),
    fixture('fixed honesty clause is allowed',data=comparison(),raw=answer(data=comparison(),verdict="You can't tell how it felt. Compared with {baseline}, your pace was {e2:1}.")),
    fixture('fixed honesty clause with curly apostrophe is allowed',data=comparison(),raw=answer(data=comparison(),verdict='You can’t tell how it felt. Compared with {baseline}, your pace was {e2:1}.')),
    fixture('vs abbreviation is not a sentence end',data=comparison(),raw=answer(data=comparison(),verdict='Compared with {baseline}, your pace was {e2:1} vs. that last run.')),
]


def run():
    assert len(CASES)>=40
    assert kit_workout_review.REJECTION_CODES==frozenset({'answer_shape','numeric_unsupported','fact_unsupported','relation_unsupported','health_claim_unsupported','follow_up_invalid','voice_invalid'})
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
        assert len(result['facts'])<=5 and len(result['follow_ups'])<=2,case['name']
        assert all(f['tool']=='workout_compare' and f['evidence_id']=='e2' for f in result['facts']),case['name']
        if case['name']=='real Gemini field-alias response':
            assert result['workout_review']['verdict'].startswith('Compared with your last 3 runs,'),result['workout_review']
        if case['data'].get('status')=='compared' and any(f['path']==['baseline_count'] for f in result['facts']):
            baseline=next(f for f in result['facts'] if f['path']==['baseline_count'])
            noun='similar '+{'run':'runs','walk':'walks','hike':'hikes','ride':'rides','swim':'swims'}.get(case['data'].get('sport'),'workouts')
            assert baseline['label']==noun and baseline['display_value']==str(case['data']['baseline_count']),case['name']
        if case['display']:
            assert case['display'] in [fact['display_value'] for fact in result['facts']],(case['name'],[fact['display_value'] for fact in result['facts']])
    table_cases = {
        'strength': ({**comparison('workout','summary_only'), 'baseline_count':0, 'relations':{}}, 'Add a note on how it went so Kit can track it.'),
        'personal_record_or_longest': (comparison(notable='personal_record'), 'Well done. Take an easy day next.'),
        'first_or_under_two': ({**comparison('ride','not_enough_similar'), 'baseline_count':1, 'relations':{}}, 'Log one more ride and Kit can compare.'),
        'hot': (comparison(notable='hotter'), 'Heat raises heart rate. Compare on a cooler day.'),
        'hillier': (comparison(notable='hillier'), 'Hills slow you down. Compare with your last run on this route.'),
        'same_pace_hr_higher': ({**comparison(), 'relations':{'pace_s_per_km':'about_the_same','avg_hr':'higher'}}, 'Keep your next run easy and see if it settles.'),
        'slower_hr_higher': ({**comparison(), 'relations':{'pace_s_per_km':'slower','avg_hr':'higher'}}, 'Take an easy day, then see if it settles.'),
        'faster_hr_lower_or_same': ({**comparison(), 'relations':{'pace_s_per_km':'faster','avg_hr':'lower'}}, 'A good sign. Repeat this effort once this week.'),
        'faster_hr_higher': ({**comparison(), 'relations':{'pace_s_per_km':'faster','avg_hr':'higher'}}, 'Fine for a hard day. Keep the next one easy.'),
        'same_pace_hr_lower': ({**comparison(), 'relations':{'pace_s_per_km':'about_the_same','avg_hr':'lower'}}, 'A good sign: your usual pace is costing you less.'),
        'slower_hr_same_or_lower': ({**comparison(), 'relations':{'pace_s_per_km':'slower','avg_hr':'lower'}}, "Nothing to worry about. One slower run won't change your trend."),
        'steady_or_no_hr': ({**comparison(), 'current':{**comparison()['current'],'avg_hr':None}, 'relations':{'pace_s_per_km':'faster'}}, 'Steady. Keep going.'),
    }
    assert set(table_cases)=={rule for rule,_ in kit_workout_review.NEXT_STEP_RULES}
    for rule,(data,expected) in table_cases.items():
        assert kit_workout_review._next_step_rule(data)==rule,(rule,kit_workout_review._next_step_rule(data))
        assert kit_workout_review.app_next_step(data)==expected,rule
    route_data={**comparison('ride'),'same_route_count':1}
    assert kit_workout_review.app_follow_ups(route_data)==[
        'Compare with my last ride on this route.', kit_workout_review.FOLLOW_UP_WHITELIST[0]]
    assert kit_workout_review.app_follow_ups(comparison())==list(kit_workout_review.FOLLOW_UP_WHITELIST)
    assert kit_workout_review._baseline_phrase(comparison())=='your last 3 runs'
    assert kit_workout_review._baseline_phrase(route_data)=='your last ride on this route'
    hillier=comparison(notable='hillier')
    assert hillier['deltas']['ascent_m']==40
    assert kit_workout_review._format_fact(hillier,('deltas','ascent_m'),40,'metric')[1]=='40 m'
    return f'{len(CASES)} fictional workout-review cases passed with stand-ins; no provider calls'


if __name__=='__main__':
    print(run())
