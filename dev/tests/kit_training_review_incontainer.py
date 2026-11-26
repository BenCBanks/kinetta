"""Fictional automatic training-review cards; no provider calls; disposable fictional accounts only."""
import copy
from unittest.mock import patch
from app import coach_chat, kit_coaching, kit_conversation, kit_training_review as training

assert training.requested('Review my training')
assert training.requested('Coaching context: Review my food\nQuestion: Could you review my training?')
for question in ('Review my week','Review my latest workout','Review my food','Review my training without a chart',
                 'Review my training, no visual','Review my training\nQuestion: Review my food'):
    assert not training.requested(question),question

series=dict(metric='distance',aggregate='sum',group_by='week',sport='all',period_unit='weeks',period_count=6,
            start='2026-10-19',end='2026-11-26',timezone='UTC',truncated=False,garmin_included=True,
            workouts=8,missing=1,summary=dict(overall=36000,direction='up'),
            points=[dict(start=f'2026-{day}',value=v,n=n,missing=m,in_progress=i==5,partial=i==5)
                    for i,(day,v,n,m) in enumerate([('10-19',4000,1,0),('10-26',0,0,0),('11-02',8000,2,0),
                                                   ('11-09',None,1,1),('11-16',10000,2,0),('11-23',14000,2,0)])])
original=copy.deepcopy(series)
for units,unit in [('metric','km'),('imperial','mi')]:
    chart=training.visual(series,dict(units=units))['chart']
    assert chart['presentation']=='line' and chart['axis_unit']==unit
    assert chart['points'][1]['plot_value'] is None and chart['points'][3]['plot_value'] is None
    assert chart['points'][-1]['in_progress'] and chart['points'][-1]['plot_value']>0
    assert chart['points'][0]['display_value']==('4 km' if units=='metric' else '2.5 mi')
assert series==original,'No mutation of source measurements'
for change in [dict(points=series['points'][:3]),dict(truncated=True),dict(metric='workouts'),
               dict(points=[{**p,'n':0} for p in series['points']]),
               dict(points=[{**p,'value':0} for p in series['points']])]:
    assert training.visual({**series,**change},dict(units='metric'))=={}

base=dict(interpretation='Your recorded running gives us a useful starting point.',
          answer_blocks=[dict(kind='paragraph',text='Your recorded running gives us a useful starting point.')],
          facts=[],tools_used=['activities'],health_included=True)

def run(result=None,question='Review my training',health=True,garmin=True,enabled=True,active=None,**kwargs):
    calls=[]
    def tool(self,name,args):
        calls.append((self._uid,name,args))
        if name=='profile':return dict(units='metric')
        if not health:raise ValueError('Consent denied')
        assert args==dict(metric='distance',aggregate='sum',group_by='week',period_unit='weeks',period_count=6,sport='all')
        return series
    @training.attach
    def answer(uid,question,**kwargs):return copy.deepcopy(base if result is None else result)
    with patch('app.coach.allowed',return_value=enabled),patch('app.coach.off',return_value='disabled'), \
         patch('app.kit_tools.KitTools.call',tool),patch('app.db.coach_connect'), \
         patch('app.coach.health_ok',return_value=health),patch('app.kit_charts.consent_still_valid',return_value=garmin):
        answer=answer(999,question,kit=True,active=active,**kwargs)
    assert all(uid==999 for uid,_,_ in calls)
    return answer,calls

answer,calls=run()
assert len(calls)==2 and answer['chart']['presentation']=='line'
assert answer['interpretation']==base['interpretation'] and answer['facts']==base['facts']
assert answer['health_included'] and answer['garmin_included']
assert answer['tools_used']==['activities','profile','chart_series']
answer,_=run({**base,'app_fallback':True,'fallback_reason':'answer_verification'})
assert answer['app_fallback'] and answer['chart'],'Recovery retains the automatic app card'
for args in [dict(question='Review my training, no chart'),dict(weekly_review=True),dict(workout_review=True),
             dict(result=kit_conversation.consent_answer()),dict(result={**base,'chart':{'existing':True}})]:
    answer,calls=run(**args);assert calls==[],args
for args in [dict(health=False),dict(garmin=False)]:
    answer,_=run(**args);assert 'chart' not in answer
for args in [dict(active=lambda:False),dict(enabled=False)]:
    try:run(**args)
    except ValueError:pass
    else:raise AssertionError('Consent/activity/AI gates cannot be bypassed')

# Warmth does not relax factual claims: supported records + optional advice pass;
# invented improvement and unsupported absence still reject.
evidence=[dict(evidence_id='e1',tool='profile',data=dict(units='metric')),
          dict(evidence_id='e2',tool='recent_runs',data=dict(totals=dict(count=4,distance_m=18000)))]
facts=[dict(evidence_id='e2',path=['totals','distance_m'],value=18000)]
for text in ['You have recorded {e2:0} of running. You could choose a comfortable activity for your next session.',
             'Your recorded running adds up to {e2:0}. One thing to consider is whether a strength session would fit your goals.']:
    checked=kit_conversation.checked_answer(dict(blocks=[dict(kind='paragraph',text=text)],facts=facts),evidence,question='Review my training')
    assert '18 km' in checked['interpretation']
for text in ['Your fitness improved with {e2:0} of running.', 'You have a complete lack of strength training.']:
    try:kit_conversation.checked_answer(dict(blocks=[dict(kind='paragraph',text=text)],facts=facts),evidence,question='Review my training')
    except ValueError:pass
    else:raise AssertionError('Unsupported training claim passed: '+text)
assert all(s in kit_coaching.PROMPT for s in ('recorded facts support','Not recorded does not mean not done','as an option'))
print('Training review: measured weeks/gaps/units, independent checked prose+fallback, owner/consent/cancel/AI, warm factual options PASS; 0 provider calls')

# The automatic path uses the real fixed SQL reader with its uid and source gates.
from app import db
from uuid import uuid4
uids=[]
try:
    with db.connect() as c:
        for _ in range(2):
            uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                          ('zz_test_training_'+uuid4().hex,'Fictional training')).fetchone()['id'];uids.append(uid)
            c.execute("INSERT INTO profile(user_id,tz,units,health_ai_ok,garmin_ai_ok,health_weight_ai_ok) VALUES(%s,'UTC','metric',true,true,true)",(uid,))
        for uid,weeks,distance,source in [(uids[0],1,3000,'manual'),(uids[0],2,4000,'healthkit'),
                                          (uids[0],4,5000,'garmin_connect'),(uids[1],1,999999,'manual')]:
            c.execute("INSERT INTO activities(user_id,name,source,sport,start_time,distance_m,moving_s) VALUES(%s,'Fictional workout',%s,'run',date_trunc('week',now())-(%s*interval '1 week')+interval '12 hours',%s,1800)",
                      (uid,source,weeks,distance))
    @training.attach
    def checked(uid,question,**kwargs):return copy.deepcopy(base)
    with patch('app.coach.allowed',return_value=True):
        answer=checked(uids[0],'Review my training',kit=True)
        assert sum(p['value'] or 0 for p in answer['chart']['points'])==12000
        assert sum(p['plot_value'] or 0 for p in answer['chart']['points'])==12
        assert answer['garmin_included'] and sum(p['value'] is None for p in answer['chart']['points'])==3
        with db.connect() as c:c.execute('UPDATE profile SET garmin_ai_ok=false WHERE user_id=%s',(uids[0],))
        assert 'chart' not in checked(uids[0],'Review my training',kit=True),'Existing broad/source gate stays fail-closed'
        with db.connect() as c:c.execute('UPDATE profile SET garmin_ai_ok=true,health_ai_ok=false WHERE user_id=%s',(uids[0],))
        assert 'chart' not in checked(uids[0],'Review my training',kit=True)
finally:
    if uids:
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
print('Automatic training visual real SQL: own-only total, measured-week gaps and both source gates PASS')

# A rejected explicit chart answer still uses the one app-computed card, never
# the rejected wording. It retains Health/Garmin markers for history erasure.
from app import kit_recovery
import time
state=dict(uid=999,evidence=[dict(evidence_id='e1',tool='profile',data=dict(units='metric')),
    dict(evidence_id='e2',tool='chart_series',data=series)],usage={},began=time.monotonic())
with patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True),patch('app.db.coach_connect'):
    result=kit_recovery.fallback(999,'Show my recorded distance as a chart.',state,None,'answer_verification')
assert result['app_fallback'] and result['chart'] and result['health_included'] and result['garmin_included']
assert result['facts']==[] and 'so far' in result['interpretation']
print('Explicit chart rejection retains checked app card/source markers without model prose PASS')
