"""Fictional conversational charts, fixed reader/RLS and source consent; no provider calls."""
from copy import deepcopy
from uuid import uuid4
from unittest.mock import patch
from app import coach_chat, db
from app.kit_charts import measurement, source_markers, consent_still_valid
from app.kit_tools import KitTools, specifications

series=dict(metric='ascent',aggregate='average',group_by='week',period_unit='weeks',period_count=3,
 sport='run',timezone='UTC',start='2026-11-10',end='2026-11-26',workouts=9,missing=0,truncated=False,
 points=[dict(start=d,value=v,n=3,missing=0,in_progress=i==2,partial=i==2)
         for i,(d,v) in enumerate(zip(('2026-11-10','2026-11-17','2026-11-24'),(20,30,40)))],
 summary=dict(first=20,last=40,overall=30,highest=40,lowest=20,change=20,direction='up'))
evidence=[dict(evidence_id='e1',tool='profile',data={'units':'imperial'}),dict(evidence_id='e2',tool='chart_series',data=series)]
raw=dict(blocks=[dict(kind='paragraph',text='Your recorded climb rose from {e2:0} to {e2:1} so far.')],
 facts=[dict(evidence_id='e2',path=['summary',k],value=v) for k,v in [('first',20),('last',40)]],chart={'evidence_id':'e2'})
def check(value=raw,ev=evidence):return coach_chat.checked_answer(value,ev,kit=True)
def reject(value,ev=evidence):
 try:check(value,ev)
 except ValueError:return
 raise AssertionError(value)
answer=check();assert answer['chart']['points'][-1]['display_value']=='131.2 ft'
assert 'answer_blocks' in answer and 'plot_value' not in series['points'][0]
for mutation in [dict(chart={'evidence_id':'e1'}),dict(chart={'evidence_id':'e9'}),dict(chart={'evidence_id':'e2','points':[]}),
 dict(facts=[dict(evidence_id='e2',path=['points',0,'value'],value=20)]),
 dict(blocks=[dict(kind='paragraph',text='Your recorded climb fell so far.')]),
 dict(blocks=[dict(kind='paragraph',text='Your climb rose because you are fitter so far.')]),
 dict(blocks=[dict(kind='paragraph',text='Your recorded climb rose.')])]:reject({**raw,**mutation})
for count in (0,1,2):
 ev=deepcopy(evidence);ev[1]['data']['points']=ev[1]['data']['points'][:count];reject(raw,ev)
 sparse={**raw,'blocks':[dict(kind='paragraph',text='The available measurements are shown so far.')]}
 assert check(sparse,ev)['chart']
# Plain paragraphs/lists, eight fact references and longer requested detail keep their current shape.
longer={**raw,'blocks':raw['blocks']+[dict(kind='paragraph',text='Choose which recorded period to explore next.')]}
assert len(check(longer)['answer_blocks'])==2
try:coach_chat.checked_answer(raw,evidence,kit=True,weekly_review=True)
except ValueError:pass
else:raise AssertionError('Weekly starter must not request charts')
for metric,value,units,expected in [('pace',300,'imperial','8:03/mi'),('distance',1609.344,'imperial','1 mi'),('avg_hr',150,'metric','150 bpm')]:
 assert measurement(metric,value,units)[0]==expected
spec=next(s for s in specifications() if s['name']=='chart_series');assert 'user_id' not in spec['input_schema']['properties']
uids=[]
try:
 with db.connect() as c:
  for _ in range(2):
   uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',('zz_test_chart_'+uuid4().hex,'Fictional chart')).fetchone()['id'];uids.append(uid)
   c.execute("INSERT INTO profile(user_id,tz,health_ai_ok,garmin_ai_ok) VALUES(%s,'UTC',true,false)",(uid,))
  for uid,source,dist,hid in [(uids[0],'manual',1000,None),(uids[0],'garmin_connect',2000,None),(uids[0],'healthkit',4000,None),(uids[0],'garmin_connect',8000,'fictional-mixed'),(uids[1],'manual',999999,None)]:
   c.execute("INSERT INTO activities(user_id,name,sport,source,start_time,distance_m,moving_s,healthkit_id) VALUES(%s,'Fictional chart row','run',%s,now()-interval '1 hour',%s,300,%s)",(uid,source,dist,hid))
 args=dict(metric='distance',aggregate='sum',group_by='day',period_unit='days',period_count=2,sport='run')
 tool=KitTools(uids[0])
 try:tool.call('chart_series',args)
 except ValueError:pass
 else:raise AssertionError('Existing broad source gate must fail closed')
 # Exercise reader-level per-source SQL in addition to the conservative outer gate.
 with patch('app.coach.health_ok',return_value=True):
  assert tool.call('chart_series',args)['summary']['overall']==5000,'Garmin denied and foreign rows excluded'
 with db.connect() as c:c.execute('UPDATE profile SET garmin_ai_ok=true WHERE user_id=%s',(uids[0],))
 both=tool.call('chart_series',args);assert both['summary']['overall']==15000 and both['garmin_included']
 assert source_markers([{'tool':'chart_series','data':both}])['garmin_included']
 with db.coach_connect(uids[0]) as c:assert consent_still_valid(c,uids[0],{'garmin_included':True})
 with db.connect() as c:c.execute('UPDATE profile SET garmin_ai_ok=false WHERE user_id=%s',(uids[0],))
 with db.coach_connect(uids[0]) as c:assert not consent_still_valid(c,uids[0],{'garmin_included':True})
 with db.connect() as c:c.execute('UPDATE profile SET health_ai_ok=false WHERE user_id=%s',(uids[0],))
 try:tool.call('chart_series',args)
 except ValueError:pass
 else:raise AssertionError('Existing Health consent gate must remain closed')
 for invalid in [dict(user_id=uids[1]),dict(metric='pace',aggregate='sum'),dict(period_count=53)]:
  try:tool.call('chart_series',invalid)
  except ValueError:pass
  else:raise AssertionError(invalid)
finally:
 if uids:
  with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(uids,))
print('Conversational chart binding, direction, sparse/unknown, units, weekly exclusion, RLS and Health/Garmin source gates PASS; no providers')
