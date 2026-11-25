"""Fictional, provider-free Kit workout-review cases. Run by coach_incontainer.py."""
from app import kit_workout_review, workout_compare


def comparison(sport='run', status='compared', notable='none'):
    return {'sport':sport,'status':status,'baseline_count':3,
        'current':{'distance_m':8046.72,'moving_s':2340,'pace_s_per_km':300,'speed_mps':None,
                   'avg_hr':150,'ascent_m':100,'avg_temp_c':22},
        'baseline_medians':{'pace_s_per_km':312,'avg_hr':153,'ascent_m':60},
        'deltas':{'pace_s_per_km':-12,'avg_hr':-3,'ascent_m':40},
        'relations':{'pace_s_per_km':'faster','avg_hr':'lower'},'notable':notable}


def answer(path=None, value=None, *, data=None, verdict=None,
           next_step='Try that route again when it suits you.', follow_ups=None):
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
                verdict=f'Compared with your last {{e2:0}}, your {label} was {{e2:1}}.'
        if path and list(path) not in [fact['path'] for fact in facts]:
            facts.append({'evidence_id':'e2','path':list(path),'value':value})
        if verdict is None:
            verdict='Your workout has no measured difference to compare.'
    else:
        if path:
            facts.append({'evidence_id':'e2','path':list(path),'value':value})
        if verdict is None:
            verdict='Your workout gives you a useful starting point.'
    return {'facts':facts,'workout_review':{'verdict':verdict,'next_step':next_step},
            'follow_ups':follow_ups or ['Compare it with my last workout.']}


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
        'verdict':'Compared with your last {e2:0}, your pace was {e2:1}, and your heart rate was {e2:2}.',
        'next_step':'Add a note.'},'follow_ups':['Compare it with my last workout.']}


CASES = [
    fixture('run faster metric',data=comparison(),expected_display='12 s/km faster'),
    fixture('run slower imperial',units='imperial',data={**comparison(),'deltas':{'pace_s_per_km':14},'relations':{'pace_s_per_km':'slower'}},expected_display='23 s/mi slower'),
    fixture('run same pace',data={**comparison(),'deltas':{'pace_s_per_km':2},'relations':{'pace_s_per_km':'about_the_same'}},expected_display='about the same'),
    fixture('heart rate higher',data={**comparison(),'deltas':{'avg_hr':4},'relations':{'avg_hr':'higher'}},raw=answer(data={**comparison(),'deltas':{'avg_hr':4},'relations':{'avg_hr':'higher'}})),
    fixture('heart rate lower',data=comparison(),raw=answer(data=comparison())),
    fixture('ride speed faster metric',data={**comparison('ride'),'current':{**comparison('ride')['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':0.4},'relations':{'speed_mps':'faster'}}),
    fixture('ride speed slower imperial',units='imperial',data={**comparison('ride'),'current':{**comparison('ride')['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':-0.4},'relations':{'speed_mps':'slower'}}),
    fixture('ride speed same',data={**comparison('ride'),'current':{**comparison('ride')['current'],'pace_s_per_km':None,'speed_mps':3.1},'deltas':{'speed_mps':0.05},'relations':{'speed_mps':'about_the_same'}}),
    fixture('walk pace',data=comparison('walk')),
    fixture('swim speed',data={**comparison('swim'),'current':{**comparison('swim')['current'],'pace_s_per_km':None,'speed_mps':1.2},'deltas':{'speed_mps':0.2},'relations':{'speed_mps':'faster'}}),
    fixture('strength summary only',data={**comparison('workout','summary_only'),'current':{**comparison('workout','summary_only')['current'],'moving_s':2700},'baseline_count':0,'deltas':{},'relations':{}},raw=answer(['current','moving_s'],2700,data={**comparison('workout','summary_only'),'current':{**comparison('workout','summary_only')['current'],'moving_s':2700},'baseline_count':0,'deltas':{},'relations':{}})),
    fixture('first run without baseline',data={**comparison(status='not_enough_similar'),'baseline_count':0,'deltas':{},'relations':{}},raw=answer(['current','distance_m'],8046.72,data={**comparison(status='not_enough_similar'),'baseline_count':0,'deltas':{},'relations':{}})),
    fixture('one similar workout',data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}},raw=answer(['current','moving_s'],2340,data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}})),
    fixture('missing heart rate',data={**comparison(),'current':{**comparison()['current'],'avg_hr':None},'deltas':{'pace_s_per_km':-12},'relations':{'pace_s_per_km':'faster'}}),
    fixture('current distance imperial',units='imperial',data=comparison(),raw=answer(['current','distance_m'],8046.72,data=comparison()),expected_display='5 mi'),
    fixture('hot day notable',data={**comparison(notable='hotter'),'current':{**comparison()['current'],'avg_temp_c':30}}),
    fixture('hillier route notable',data=comparison(notable='hillier')),
    fixture('longest in ninety days',data=comparison(notable='longest_90d')),
    fixture('personal record notable',data=comparison(notable='personal_record')),
    fixture('felt unknown without note',data=comparison(),raw=answer(data=comparison(),verdict="Your records can't tell how it felt. Compared with your last {e2:0}, your pace was {e2:1}.")),
    {'name':'Health consent off','expected':'denied','source':'healthkit','consents':{'health_ok':False,'garmin_ok':True}},
    {'name':'Garmin consent off','expected':'denied','source':'garmin_connect','consents':{'health_ok':True,'garmin_ok':False}},
    fixture('reject unsupported digits',raw=answer(data=comparison(),verdict='Your pace was 12 seconds faster.'),expected='numeric_unsupported'),
    fixture('reject unsupported number words',raw=answer(data=comparison(),verdict='Your pace was twice as fast.'),expected='numeric_unsupported'),
    fixture('reject foreign evidence',raw={**answer(data=comparison()),'facts':[{'evidence_id':'e9','path':['deltas','pace_s_per_km'],'value':-12}]},expected='fact_unsupported'),
    fixture('reject follow-up addressed to user',raw=answer(data=comparison(),follow_ups=['I can tell you how you feel.']),expected='follow_up_invalid'),
    fixture('reject missing comparison relation',raw=answer(data={**comparison(),'relations':{}}),data={**comparison(),'relations':{}},expected='relation_unsupported'),
    fixture('reject health claim in verdict',raw=answer(data=comparison(),verdict='Your training is safe and injury-free.'),expected='health_claim_unsupported'),
    fixture('reject medical advice in next step',raw=answer(data=comparison(),next_step='Treat the pain before training again.'),expected='health_claim_unsupported'),
    fixture('reject reversed pace relation',raw=answer(data={**comparison(),'deltas':{'pace_s_per_km':-12},'relations':{'pace_s_per_km':'faster'}},verdict='Your last baseline was {e2:0}, and pace difference: {e2:1} slower.'),data={**comparison(),'deltas':{'pace_s_per_km':-12},'relations':{'pace_s_per_km':'faster'}},expected='relation_unsupported'),
    fixture('reject relation from different metric',raw=answer(data={**comparison(),'relations':{'speed_mps':'faster'}}),data={**comparison(),'relations':{'speed_mps':'faster'}},expected='relation_unsupported'),
    fixture('reject usual without matching relation',raw=answer(data={**comparison(),'relations':{'avg_hr':'lower'}},verdict='Your pace felt usual against your last {e2:0}.'),data={**comparison(),'relations':{'avg_hr':'lower'}},expected='relation_unsupported'),
    fixture('reject invented personal record',raw=answer(data=comparison(),verdict='Your workout set a personal record.'),expected='relation_unsupported'),
    fixture('reject comparison without history',raw=answer(data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}},verdict='Your run was faster.'),data={**comparison(status='not_enough_similar'),'baseline_count':1,'deltas':{},'relations':{}},expected='relation_unsupported'),
    fixture('reject health claim in follow-up',raw=answer(data=comparison(),follow_ups=['Compare my effort when it felt safe.']),expected='follow_up_invalid'),
    fixture('reject invented feeling',raw=answer(data=comparison(),verdict='Your run felt easy.'),expected='voice_invalid'),
    fixture('reject jargon',raw=answer(data=comparison(),verdict='Your cardiovascular load was {e2:1}.'),expected='voice_invalid'),
    fixture('reject five total sentences',raw=answer(data=comparison(),verdict='Clear. Useful. Noted. Thanks.'),expected='voice_invalid'),
    fixture('reject multiple next steps',raw=answer(data=comparison(),next_step='Try the route again and add a note.'),expected='voice_invalid'),
    fixture('reject unnamed baseline',raw=answer(data=comparison(),verdict='Pace: {e2:1}.'),expected='voice_invalid'),
    fixture('pace same and heart rate higher',data={**comparison(),'deltas':{'pace_s_per_km':2,'avg_hr':4},'relations':{'pace_s_per_km':'about_the_same','avg_hr':'higher'}},raw=multi_metric_answer({**comparison(),'deltas':{'pace_s_per_km':2,'avg_hr':4},'relations':{'pace_s_per_km':'about_the_same','avg_hr':'higher'}})),
    fixture('pace faster and heart rate lower',data=comparison(),raw=multi_metric_answer(comparison())),
    fixture('reject harder feeling in verdict',data=comparison(),raw=answer(data=comparison(),verdict='Your run felt harder than usual. Compared with your last {e2:0}, your pace was {e2:1}.'),expected='voice_invalid'),
    fixture('reject tired feeling in next step',data=comparison(),raw=answer(data=comparison(),next_step='You may feel tired after that.'),expected='voice_invalid'),
    fixture('reject first person in verdict',data=comparison(),raw=answer(data=comparison(),verdict="I can't tell how it felt. Compared with your last {e2:0}, your pace was {e2:1}."),expected='voice_invalid'),
    fixture('reject first person in next step',data=comparison(),raw=answer(data=comparison(),next_step='I would add a note. It may help next time.'),expected='voice_invalid'),
    fixture('fixed honesty clause is allowed',data=comparison(),raw=answer(data=comparison(),verdict="You can't tell how it felt. Compared with your last {e2:0}, your pace was {e2:1}.")),
    fixture('reject harder feeling in next step',data=comparison(),raw=answer(data=comparison(),next_step='Your run felt harder than usual.'),expected='voice_invalid'),
    fixture('vs abbreviation is not a sentence end',data=comparison(),raw=answer(data=comparison(),verdict='Compared with your last {e2:0}, your pace was {e2:1} vs. that last run.')),
    fixture('add a note suggestion',data=comparison(),raw=answer(data=comparison(),next_step='Add a note.')),
    fixture('reject record how it felt wording',data=comparison(),raw=answer(data=comparison(),next_step='Record how it felt.'),expected='voice_invalid'),
]


def run():
    assert len(CASES)==51
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
        if case['data'].get('status')=='compared':
            baseline=next(f for f in result['facts'] if f['path']==['baseline_count'])
            noun='similar '+{'run':'runs','walk':'walks','hike':'hikes','ride':'rides','swim':'swims'}.get(case['data'].get('sport'),'workouts')
            assert baseline['label']==noun and baseline['display_value']==str(case['data']['baseline_count']),case['name']
        if case['display']:
            assert case['display'] in [fact['display_value'] for fact in result['facts']],(case['name'],[fact['display_value'] for fact in result['facts']])
    return f'{len(CASES)} fictional workout-review cases passed with stand-ins; no provider calls'


if __name__=='__main__':
    print(run())
