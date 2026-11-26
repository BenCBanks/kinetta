"""Offline selection/cache/cap checks; no app dependencies or provider calls."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from kit_setting_smoke import CASE_IDS,CAP_USD,input_digest,cached_low,cached_rows,prepare_cache,replay_row
from kit_cases import CASES


class Settings(unittest.TestCase):
    def test_selection(self):
        cases=[c for c in CASES if c[0] in CASE_IDS]
        self.assertEqual(len(cases),10);self.assertEqual(len(set(CASE_IDS)),10)
        self.assertLess(CAP_USD,.5)
        self.assertIn('conversation-detail',CASE_IDS)

    def test_cache(self):
        good={'setting_smoke':True,'input_digest':'exact','thinking_settings':{'baseline':'LOW','candidate':'MEDIUM'},
              'results':[{'case':CASE_IDS[0],'variant':'baseline','passed':True,'answer':{'interpretation':'Fictional'},'error':None}]}
        self.assertEqual(len(cached_low(good,'exact')),1)
        for mutate in (lambda d:d.update(input_digest='old'),):
            bad=copy.deepcopy(good);mutate(bad)
            with self.assertRaises(ValueError):cached_low(bad,'exact')
        wrong=copy.deepcopy(good);wrong['thinking_settings']={'baseline':'MEDIUM'}
        self.assertEqual(cached_low(wrong,'exact'),[])
        good['results'][0]['passed']=False;self.assertEqual(cached_low(good,'exact'),[])

    def test_resume_replay_and_deduplication(self):
        report={'setting_smoke':True,'input_digest':'exact','thinking_settings':{'baseline':'LOW','candidate':'MEDIUM'},
                'results':[{'case':CASE_IDS[0],'variant':'baseline','passed':False,'error':'validation'},
                           {'case':CASE_IDS[1],'variant':'baseline','passed':False,'error':'cap'},
                           {'case':CASE_IDS[0],'variant':'candidate','passed':True}]}
        def replay(row):return {'passed':True,'error':None,'revalidated':True} if row['error']=='validation' else None
        rows=cached_rows(report,'exact',{'baseline':'LOW'},replay)
        self.assertEqual(len(rows),1);self.assertTrue(rows[0]['revalidated']);self.assertTrue(rows[0]['passed'])
        report['results'].append(report['results'][0])
        with self.assertRaises(ValueError):cached_rows(report,'exact',{'baseline':'LOW'},replay)


    def test_replay_does_not_grandfather_a_now_unsafe_success(self):
        row={'passed':True,'answer':{'interpretation':'Old answer'},'answer_evidence':[{'fictional':True}],
             'provider_turns':[{'raw_model_json':'{}'}]}
        def reject(*args,**kwargs):raise ValueError('numeric_unsupported')
        replay=replay_row(row,json.loads,reject)
        self.assertFalse(replay['passed']);self.assertIsNone(replay['answer'])
        self.assertIn('numeric_unsupported',replay['error'])
        row['error']='HTTPException: 429: AI is paused.'
        self.assertIsNone(replay_row(row,json.loads,reject))

    def test_source_and_date_identity(self):
        root=Path(__file__).resolve().parents[2]
        a=input_digest(root,[],['coach_chat.py'],today=('2026-11-25','2026-11-25'))
        self.assertEqual(a,input_digest(root,[],['coach_chat.py'],today=('2026-11-25','2026-11-25')))
        self.assertNotEqual(a,input_digest(root,[],['coach_chat.py'],today=('2026-11-26','2026-11-25')))
        self.assertNotEqual(a,input_digest(root,[['different input']],['coach_chat.py'],today=('2026-11-25','2026-11-25')))


if __name__=='__main__':unittest.main()
