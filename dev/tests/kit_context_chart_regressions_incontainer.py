"""Saved-context and past-week chart regressions, fictional records/provider stand-ins only."""
import copy
import datetime as dt
import json
import unittest
from unittest.mock import patch
from uuid import uuid4
from fastapi import HTTPException
from app import coach_chat, db, kit_charts, kit_coaching, kit_conversation, kit_history_api, kit_thread
from app.kit_tools import KitTools

QUESTION='Show my recorded running distance by workout over the past week as a chart.'
ARGS=dict(metric='distance',aggregate='sum',group_by='workout',period_unit='weeks',period_count=1,sport='run')
PROFILE=dict(evidence_id='e1',tool='profile',data={'units':'metric'})
SERIES=dict(metric='distance',aggregate='sum',group_by='workout',period_unit='weeks',period_count=1,
    sport='run',timezone='UTC',start='2026-11-23',end='2026-11-26',workouts=1,missing=0,truncated=False,
    points=[dict(start='2026-11-24',value=7000,n=1,missing=0,partial=False,in_progress=False)],
    summary=dict(first=7000,last=7000,overall=7000,highest=7000,lowest=7000,change=0,direction='same'))
EVIDENCE=[PROFILE,dict(evidence_id='e2',tool='chart_series',data=SERIES)]
CHART=dict(blocks=[dict(kind='paragraph',text='You have one recorded run, with a total distance of {e2:0}.')],
    facts=[dict(evidence_id='e2',path=['summary','overall'],value=7000)],chart={'evidence_id':'e2'})
HISTORY=dict(blocks=[dict(kind='paragraph',text='You noted that you can train on Tuesday and Saturday.'),
    dict(kind='paragraph',text='As a next step, you can map your weekly sessions to those two days in your training plan or record your next workout when you complete it.')],
    facts=[],actions=['plan','record'])


class Checks(unittest.TestCase):
    def check(self,raw=CHART,evidence=EVIDENCE,question=QUESTION):
        return kit_conversation.checked_answer(raw,evidence,question=question)

    def test_saved_history_wording_drops_only_redundant_anaphoric_count(self):
        result=self.check(HISTORY,[PROFILE],'Which days did I say I can train? Suggest one next step.')
        self.assertIn('Tuesday and Saturday',result['interpretation'])
        self.assertIn('those days',result['interpretation'])
        corrected=copy.deepcopy(HISTORY)
        corrected['blocks'][1]['text']='As a concrete next step, you can schedule your weekly sessions on those two days or log your workout when you complete it.'
        self.assertIn('those days',self.check(corrected,[PROFILE])['interpretation'])
        for text in ['two days of rest','I can train two days','two recorded runs','two grams','two hours','Your training took those two days.']:
            self.assertEqual(kit_coaching.wording(text),text)
            with self.assertRaises(ValueError):self.check(dict(blocks=[dict(kind='paragraph',text=text)]),[PROFILE])
        for text in ['Use those two days.','Choose these seven days.']:
            self.assertNotRegex(kit_coaching.wording(text),r'two|seven')
        for text in ['Your workouts confirm an injury.','Double your medication on those two days.']:
            with self.assertRaises(ValueError):self.check(dict(blocks=[dict(kind='paragraph',text=text)]),[PROFILE])

    def test_record_count_requires_one_complete_exact_sport_source(self):
        result=self.check()
        self.assertIn('one recorded run',result['interpretation'])
        self.assertIn(dict(evidence_id='e2',path=['workouts'],relation='equal'),result['claim_evidence'])
        over=copy.deepcopy(CHART);over['blocks'][0]['text']='Over the past week, you have one recorded run.'
        self.assertIn('one recorded run',self.check(over)['interpretation'])
        for text in ['two recorded runs','zero recorded runs','one recorded ride','thirty one recorded runs',
                     'twenty-one recorded runs','twenty–one recorded runs','twenty and one recorded runs','over one recorded run','not one recorded run','more than one recorded run']:
            bad=copy.deepcopy(CHART);bad['blocks'][0]['text']='You have '+text+'.'
            with self.subTest(text=text),self.assertRaises(ValueError):self.check(bad)
        for change in [dict(workouts=2),dict(workouts=True),dict(workouts=None),dict(truncated=True),
                       dict(truncated=None),dict(group_by='week'),dict(error='Unavailable')]:
            ev=copy.deepcopy(EVIDENCE);ev[1]['data'].update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):self.check(evidence=ev)
        for ev in [[PROFILE],EVIDENCE+[dict(evidence_id='e3',tool='chart_series',data=SERIES)],
                   [PROFILE,dict(evidence_id='e2',tool='chart_series',error='Unavailable',data=SERIES)]]:
            with self.assertRaises(ValueError):self.check(evidence=ev)

    def test_chart_correction_cannot_drop_an_available_requested_chart(self):
        raw=dict(blocks=[dict(kind='paragraph',text='Your recorded distances are available.')])
        with self.assertRaisesRegex(ValueError,'chart reference is missing'):self.check(raw)
        self.assertNotIn('chart',self.check(raw,question='What is available?'))
        self.assertNotIn('chart',self.check(raw,question='No chart, just describe my records.'))
        unavailable=dict(blocks=[dict(kind='paragraph',text='I cannot show that chart from the available records.')])
        self.assertNotIn('chart',self.check(unavailable,[PROFILE,dict(evidence_id='e2',tool='chart_series',error='Unavailable')]))

    def test_only_explicit_past_week_workout_request_uses_rolling_local_dates(self):
        self.assertEqual(kit_charts.request_arguments(ARGS,QUESTION),{**ARGS,'period_unit':'days','period_count':7})
        self.assertEqual(ARGS['period_unit'],'weeks','Do not mutate model arguments')
        for q in ['Chart this week.','Chart last week.','Compare the past week with the previous week.',
                  'Chart the past calendar week.','Show a chart.']:
            self.assertEqual(kit_charts.request_arguments(ARGS,q),ARGS)
        for change in [dict(group_by='week'),dict(period_count=2),dict(period_count=True),dict(period_unit='days')]:
            args={**ARGS,**change};self.assertEqual(kit_charts.request_arguments(args,QUESTION),args)


class RealPath(unittest.TestCase):
    def setUp(self):
        self.ids=[];self.calls=[]
        with db.connect() as c:
            for _ in range(2):
                uid=c.execute('INSERT INTO users(login,name) VALUES(%s,%s) RETURNING id',
                    ('zz_test_context_chart_'+uuid4().hex,'Fictional Runner')).fetchone()['id'];self.ids.append(uid)
                c.execute("INSERT INTO profile(user_id,tz,units,ai_ok,ai_adult_at,health_ai_ok,garmin_ai_ok) VALUES(%s,'UTC','metric',true,now(),true,true)",(uid,))
        self.uid,self.other=self.ids
        self.patches=[patch.dict('os.environ',{'KINETTA_KIT_HISTORY_ENABLED':'1'}),
            patch('app.ai_release.enabled',return_value=True),patch('app.coach.allowed',return_value=True),
            patch('app.coach.provider',return_value='gemini'),patch('app.kit_thread.brake'),
            patch('urllib.request.urlopen',side_effect=AssertionError('No provider network'))]
        for p in self.patches:p.start()

    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        with db.connect() as c:c.execute('DELETE FROM users WHERE id=ANY(%s)',(self.ids,))

    def thread(self,uid):
        with db.connect() as c:generation=kit_thread.locked(c,uid)
        return kit_history_api.create(kit_history_api.ThreadIn(generation=generation,conversation_id=uuid4(),visit_id=uuid4()),user={'id':uid})

    def send(self,view,question):
        row=kit_thread.create(kit_thread.MessageIn(client_id=uuid4(),generation=view['generation'],visit_id=view['visit_id'],question=question),user={'id':self.uid})
        return kit_thread.generate(row['client_id'],kit_thread.GenerationIn(generation=view['generation'],visit_id=view['visit_id']),user={'id':self.uid})

    def test_real_saved_chat_resume_history_and_current_override(self):
        view=self.thread(self.uid)
        prior=kit_thread.create(kit_thread.MessageIn(client_id=uuid4(),generation=view['generation'],visit_id=view['visit_id'],question='I can train on Tuesday and Saturday only.'),user={'id':self.uid})
        with db.connect() as c:
            c.execute("UPDATE kit_turns SET state='answered',answer=%s WHERE user_id=%s AND client_id=%s",
                (json.dumps({'interpretation':'Tell me what you would like to review.','health_included':False}),self.uid,prior['client_id']))
        kit_thread.end_visit(view['visit_id'],user={'id':self.uid})
        view=kit_history_api.resume(view['conversation_id'],kit_history_api.ResumeIn(generation=view['generation'],visit_id=uuid4()),user={'id':self.uid})
        foreign=self.thread(self.other)
        with self.assertRaises(HTTPException) as refused:
            kit_history_api.resume(view['conversation_id'],kit_history_api.ResumeIn(generation=foreign['generation'],visit_id=uuid4()),user={'id':self.other})
        self.assertEqual(refused.exception.status_code,404)
        def provider(messages,definitions,**kw):
            self.calls.append(copy.deepcopy(messages))
            return [],json.dumps(HISTORY),{}
        with patch('app.coach_chat._gemini_turn',side_effect=provider):
            row=self.send(view,'Which days did I say I can train? Suggest one next step.')
        self.assertEqual(row['state'],'answered',row.get('error'));self.assertEqual(len(self.calls),1)
        self.assertIn('Tuesday and Saturday',json.dumps(self.calls[0][0]))
        self.assertIn('those days',row['answer']['interpretation'])
        def correction(messages,definitions,**kw):
            self.assertIn('Sunday only',messages[-1]['parts'][0]['text'])
            return [],json.dumps(dict(blocks=[dict(kind='paragraph',text='You can plan your next walk for Sunday.')])),{}
        with patch('app.coach_chat._gemini_turn',side_effect=correction):
            row=self.send(view,'Actually, I can train on Sunday only. Suggest one practical next step.')
        self.assertEqual(row['state'],'answered',row.get('error'));self.assertIn('Sunday',row['answer']['interpretation'])

    def test_real_tool_sql_and_answer_uses_all_three_own_runs(self):
        today=dt.date.fromisoformat(str(KitTools(self.uid).call('profile',{})['today']))
        with db.connect() as c:
            for uid,days,distance in [(self.uid,6,3000),(self.uid,4,5000),(self.uid,2,7000),(self.other,2,999999)]:
                when=dt.datetime.combine(today-dt.timedelta(days=days),dt.time(12),dt.timezone.utc)
                c.execute("INSERT INTO activities(user_id,name,sport,source,start_time,distance_m,moving_s) VALUES(%s,'Fictional run','run','manual',%s,%s,900)",(uid,when,distance))
        data=KitTools(self.uid).call('chart_series',kit_charts.request_arguments(ARGS,QUESTION))
        self.assertEqual([p['value'] for p in data['points']],[3000,5000,7000]);self.assertEqual(data['summary']['overall'],15000)
        # The captured one-run answer must not pass against the corrected, wider date range.
        with self.assertRaises(ValueError):kit_conversation.checked_answer(CHART,[PROFILE,dict(evidence_id='e2',tool='chart_series',data=data)],question=QUESTION)
        def provider(messages,definitions,**kw):
            self.calls.append(copy.deepcopy(messages))
            if len(self.calls)==1:return [dict(name='chart_series',args=ARGS,id='fictional-chart')],'',{}
            response=next(p['functionResponse']['response'] for p in messages[-1]['parts'] if 'functionResponse' in p)
            self.assertEqual(response['arguments']['period_unit'],'days');self.assertEqual(response['arguments']['period_count'],7)
            self.assertEqual(response['data']['workouts'],3)
            raw=copy.deepcopy(CHART);raw['blocks'][0]['text']='You have three recorded runs, with a total distance of {e2:0}.';raw['facts'][0]['value']=15000
            return [],json.dumps(raw),{}
        with patch('app.coach_chat._gemini_turn',side_effect=provider):
            row=self.send(self.thread(self.uid),QUESTION)
        self.assertEqual(row['state'],'answered',row.get('error'));self.assertEqual(len(self.calls),2)
        self.assertIn('15 km',row['answer']['interpretation']);self.assertEqual(len(row['answer']['chart']['points']),3)


unittest.main()
