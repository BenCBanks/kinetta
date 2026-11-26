"""Spend controls must never turn changed or interrupted inputs into a cache hit."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from kit_eval_savings import FIXTURE_DATE,plan,reuse,require_receipt,SMOKE_IDS,case_keys
from kit_fixture_clock import INSTANT,Date,DateTime,install


class Savings(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'cache.json'
        self.keys={'baseline':{'meal':'old'},'candidate':{'meal':'new'}}
        self.report={'fixture_date':FIXTURE_DATE,'candidate_commit':'head','results':[
            {'case':'meal','variant':'candidate','case_input_digest':'new','passed':True,'provider_requests':2},
            {'case':'meal','variant':'baseline','case_input_digest':'old','passed':False,'provider_requests':1}]}

    def cached(self):
        self.path.write_text(json.dumps(self.report));return reuse([self.path],self.keys,['meal'])

    def test_cross_day_rows_and_live_failures_reuse_without_paying(self):
        with patch('kit_eval_savings.FIXTURE_DATE',FIXTURE_DATE):
            self.assertEqual(len(self.cached()),2)
        self.assertEqual(plan(self.cached(),2,.8)['expected_cost_usd'],0)

    def test_changed_inputs_and_failed_candidate_pay_only_that_case(self):
        self.keys['candidate']['meal']='changed'
        self.assertEqual([r['variant'] for r in self.cached()],['baseline'])
        self.keys['candidate']['meal']='new';self.report['results'][0]['passed']=False
        self.assertEqual([r['variant'] for r in self.cached()],['baseline'])

    def test_unpinned_and_interrupted_captures_never_silently_repay(self):
        self.report['fixture_date']='2026-11-25'
        with self.assertRaises(ValueError):self.cached()
        self.report['fixture_date']=FIXTURE_DATE;self.report['results'][0]['interrupted']=True
        with self.assertRaises(ValueError):self.cached()

    def test_cost_counts_smoke_once_and_never_buys_80_by_default(self):
        self.assertAlmostEqual(plan([{}]*50,80,.8,.18)['expected_cost_usd'],.54)
        self.assertAlmostEqual(plan([],40,.8)['expected_cost_usd'],.72)
        with self.assertRaises(ValueError):plan([],80,.8)
        with self.assertRaises(ValueError):plan([],40,.8,.1)
        for n in (float('nan'),float('inf'),-.1,1):
            with self.assertRaises(ValueError):plan([],40,n)
        self.assertEqual(len(set(SMOKE_IDS)),10)

    def test_missing_or_wrong_head_receipt_refuses(self):
        with self.assertRaises(FileNotFoundError):require_receipt(self.path,Path('.'))
        self.path.write_text('{}')
        with patch('kit_eval_savings.receipt',return_value={'head':'new','fixture_date':FIXTURE_DATE}):
            with self.assertRaises(ValueError):require_receipt(self.path,Path('.'))

    def test_case_keys_bind_source_case_and_clock_but_not_wall_date_or_head(self):
        root=Path(__file__).resolve().parents[2]
        sources={'live':'old provider','candidate':'new provider'}
        def git(command,**kwargs):
            if 'ls-tree' in command:return 'app/coach_chat.py\n'
            revision=command[-1].split(':')[0]
            return sources[revision].encode()
        cases=[('meal','Question A',set()),('food','Question B',set())]
        with patch('kit_eval_savings.subprocess.check_output',side_effect=git):
            keys=case_keys(root,cases,'live','candidate')
            other=case_keys(root,[cases[0],('food','changed',set())],'live','candidate')
            self.assertEqual(keys['candidate']['meal'],other['candidate']['meal'])
            self.assertNotEqual(keys['candidate']['food'],other['candidate']['food'])
            sources['candidate']='changed prompt'
            changed=case_keys(root,cases,'live','candidate')
            self.assertEqual(keys['baseline'],changed['baseline'])
            self.assertNotEqual(keys['candidate'],changed['candidate'])
            sources['live']='new live code'
            self.assertNotEqual(keys['baseline'],case_keys(root,cases,'live','candidate')['baseline'])

    def test_clock_guard_python_dates_and_price_deadline(self):
        import types,datetime as dt
        from kit_fixture_clock import patch_module
        self.assertEqual(Date.today(),INSTANT.date());self.assertEqual(DateTime.now(dt.timezone.utc),INSTANT)
        module=types.ModuleType('app.example');module.dt=dt;patch_module(module)
        self.assertEqual(module.dt.datetime.now(dt.timezone.utc),INSTANT)
        module=types.ModuleType('app.ai_budget');module.dt=dt;patch_module(module);self.assertIs(module.dt,dt)
        with patch.dict('os.environ',{},clear=True):
            with self.assertRaises(ValueError):install(None)


if __name__=='__main__':unittest.main()
