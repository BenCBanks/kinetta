"""Fictional set provenance through real Kit validation; no database or provider."""
import copy
import itertools
import json
import unittest
from unittest.mock import patch

from app import coach_chat, kit_claims


class SetGrounding(unittest.TestCase):
    def setUp(self):
        self.evidence=[{'evidence_id':'e1','tool':'profile','data':{'units':'imperial'}},
            {'evidence_id':'e2','tool':'strength_history','data':{
                'sets':[{'id':101,'exercise':'Fictional squat','reps':8,'kg':40.0,'secs':60},
                        {'id':102,'exercise':'Fictional squat','reps':6,'kg':45.0,'secs':90}],
                'summary_by_exercise':[{'exercise':'Fictional squat','completed_sets':2,
                    'max_recorded_reps':8,'max_recorded_kg':45.0,'recorded_volume_kg':590.0}]}}]

    def fact(self,row,field,*,collection='sets',evidence_id='e2'):
        data=next(e['data'] for e in self.evidence if e['evidence_id']==evidence_id)
        return {'evidence_id':evidence_id,'path':[collection,row,field],
                'value':data[collection][row][field]}

    def check(self,text,facts,*,blocks=None,legacy=False):
        raw=({'verdict':text,'reason':'These are recorded values.','facts':facts} if legacy else
             {'blocks':blocks or [{'kind':'paragraph','text':text}],'facts':facts})
        return coach_chat.checked_answer(raw,self.evidence,kit=True,
            conversation_question='What completed strength sets did I record recently?')

    def reject(self,*args,**kwargs):
        with self.assertRaises(kit_claims.ClaimRejected) as error:self.check(*args,**kwargs)
        self.assertEqual(error.exception.reason_code,'relation_unsupported')

    def test_captured_summary_maxima_are_not_a_set(self):
        facts=[self.fact(0,'max_recorded_reps',collection='summary_by_exercise'),
               self.fact(0,'max_recorded_kg',collection='summary_by_exercise')]
        text='You recorded completed squat sets in your log, working with sets of {e2:0} reps at {e2:1}.'
        self.reject(text,facts)
        self.reject(text,facts,legacy=True)

    def test_every_metric_pair_requires_the_same_row(self):
        for left,right in itertools.permutations(('reps','kg','secs'),2):
            with self.subTest(left=left,right=right):
                self.reject('Recorded measurements: {e2:0} with {e2:1}.',
                            [self.fact(0,left),self.fact(1,right)])
                self.reject('Recorded measurements: {e2:0} with {e2:1}.',
                            [self.fact(0,left),self.fact(1,right)],legacy=True)
                answer=self.check('Recorded measurements: {e2:0} with {e2:1}.',
                                  [self.fact(0,left),self.fact(0,right)])
                self.assertEqual(len(answer['claim_evidence']),2)

    def test_all_three_metrics_fail_when_any_origin_differs(self):
        for fields in itertools.permutations(('reps','kg','secs')):
            for origins in itertools.product((0,1),repeat=3):
                if len(set(origins))==1:continue
                with self.subTest(fields=fields,origins=origins):
                    self.reject('Recorded: {e2:0} with {e2:1} and {e2:2}.',
                                [self.fact(row,field) for row,field in zip(origins,fields)])

    def test_numeric_coincidence_cannot_supply_row_identity(self):
        self.evidence[1]['data']['sets'][1].update(reps=8,kg=40.0,secs=60)
        for left,right in itertools.permutations(('reps','kg','secs'),2):
            with self.subTest(left=left,right=right):
                self.reject('Recorded measurements: {e2:0} with {e2:1}.',
                            [self.fact(0,left),self.fact(1,right)])

    def test_split_clauses_blocks_and_list_items_do_not_launder_pairs(self):
        facts=[self.fact(0,'reps'),self.fact(1,'kg')]
        for text in ('Reps: {e2:0}. That set used {e2:1}.',
                     'Reps: {e2:0}; load: {e2:1}.',
                     '{e2:0} reps, {e2:1}.',
                     '{e2:0} reps and {e2:1}.'):
            with self.subTest(text=text):self.reject(text,facts)
        for blocks in ([{'kind':'paragraph','text':'Reps: {e2:0}.'},
                        {'kind':'paragraph','text':'That set used {e2:1}.'}],
                       [{'kind':'list','items':['Reps: {e2:0}.','That set used {e2:1}.']}]):
            self.reject('',facts,blocks=blocks)

    def test_complete_sets_remain_distinct_in_lists_and_inline(self):
        facts=[self.fact(0,'reps'),self.fact(0,'kg'),self.fact(1,'reps'),self.fact(1,'kg')]
        first='{e2:0} reps at {e2:1}';second='{e2:2} reps at {e2:3}'
        for blocks in ([{'kind':'list','items':[first+'.',second+'.']}],
                       [{'kind':'paragraph','text':first+'.'}, {'kind':'paragraph','text':second+'.'}],
                       [{'kind':'paragraph','text':first+', and '+second+'.'}],
                       [{'kind':'paragraph','text':first+', followed by '+second+'.'}]):
            answer=self.check('',facts,blocks=blocks)
            self.assertIn('8 reps at 88.2 lb',answer['interpretation'])
            self.assertIn('6 reps at 99.2 lb',answer['interpretation'])
        self.reject('',facts,blocks=[{'kind':'list','items':[first+'.','Weight: {e2:3}.']}])

    def test_all_metrics_can_be_cited_from_a_single_set(self):
        facts=[self.fact(1,field) for field in ('reps','kg','secs')]
        answer=self.check('Duration: {e2:2}. Recorded: {e2:0} reps at {e2:1}.',facts)
        self.assertEqual(len(answer['facts']),3)

    def test_source_identity_and_duplicate_evidence_fail_closed(self):
        other=copy.deepcopy(self.evidence[1]);other['evidence_id']='e3';self.evidence.append(other)
        self.reject('Recorded measurements: {e2:0} with {e3:1}.',
                    [self.fact(0,'reps'),self.fact(0,'kg',evidence_id='e3')])
        self.evidence.append(copy.deepcopy(self.evidence[1]))
        self.reject('{e2:0} reps at {e2:1}.',[self.fact(0,'reps'),self.fact(0,'kg')])

    def test_summary_fields_are_independent_and_explicit(self):
        for field,label in [('max_recorded_reps','Most recorded reps'),
                            ('max_recorded_kg','Highest recorded weight'),
                            ('completed_sets','Completed sets'),('recorded_volume_kg','Recorded volume')]:
            with self.subTest(field=field):
                fact=self.fact(0,field,collection='summary_by_exercise')
                self.check(label+': {e2:0}.',[fact])
                self.reject('That set recorded {e2:0}.',[fact])
                self.reject('{e2:0} with {e2:1}.',[fact,self.fact(0,'secs')])
        facts=[self.fact(0,'max_recorded_reps',collection='summary_by_exercise'),
               self.fact(0,'max_recorded_kg',collection='summary_by_exercise')]
        self.check('',facts,blocks=[{'kind':'list','items':[
            'Most recorded reps: {e2:0}.','Highest recorded weight: {e2:1}.']}])
        self.reject('',facts,blocks=[{'kind':'list','items':['{e2:0} reps.','At {e2:1}.']}])

    def test_invalid_missing_unknown_metrics_remain_rejected(self):
        facts=[self.fact(0,'reps'),self.fact(0,'kg')]
        for path in (['sets',1,'kg'],['sets',-1,'kg'],['sets',99,'kg'],['sets',True,'kg']):
            bad=copy.deepcopy(facts);bad[1]['path']=path
            with self.subTest(path=path),self.assertRaises(ValueError):self.check('{e2:0} reps at {e2:1}.',bad)
        for field in ('id','duration_s','missing'):
            self.evidence[1]['data']['sets'][0][field]=40
            bad=[self.fact(0,'reps'),self.fact(0,field)]
            with self.subTest(field=field),self.assertRaises(ValueError):
                self.check('{e2:0} reps at {e2:1}.',bad)
        for value in (None,True,float('inf')):
            self.evidence[1]['data']['sets'][0]['kg']=value
            with self.subTest(value=value),self.assertRaises(ValueError):
                self.check('{e2:0} reps at {e2:1}.',facts)

    def test_bad_pair_cannot_escape_via_correction_or_recovery(self):
        facts=[self.fact(0,'max_recorded_reps',collection='summary_by_exercise'),
               self.fact(0,'max_recorded_kg',collection='summary_by_exercise')]
        bad={'blocks':[{'kind':'paragraph','text':'You recorded {e2:0} reps at {e2:1}.'}],'facts':facts}
        good={'blocks':[{'kind':'paragraph','text':'You recorded {e2:0} reps at {e2:1}.'}],
              'facts':[self.fact(0,'reps'),self.fact(0,'kg')]}
        for correct in (True,False):
            calls=[]
            def provider(messages,definitions,**kwargs):
                calls.append(1)
                if len(calls)==1:return [{'name':'strength_history','args':{}}],None,{}
                return [],json.dumps(good if correct and len(calls)==3 else bad),{}
            def tool(self,name,args,**kwargs):
                return next(e['data'] for e in self_evidence if e['tool']==name)
            self_evidence=self.evidence
            with patch('urllib.request.urlopen',side_effect=AssertionError('Provider forbidden')), \
                 patch('app.coach.allowed',return_value=True),patch('app.coach.health_ok',return_value=True), \
                 patch('app.coach.provider',return_value='gemini'),patch('app.db.coach_connect'), \
                 patch('app.kit_tools.KitTools.call',tool),patch('app.coach_chat._gemini_turn',provider):
                answer=coach_chat.answer(1,'What completed strength sets did I record recently?',kit=True)
            self.assertEqual(len(calls),3)
            self.assertNotIn('8 reps at 99.2 lb',answer['interpretation'])
            if correct:self.assertIn('8 reps at 88.2 lb',answer['interpretation'])
            else:self.assertTrue(answer['app_fallback'])


if __name__=='__main__':unittest.main()
