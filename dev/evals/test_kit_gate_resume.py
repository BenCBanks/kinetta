"""No-provider full-gate resume identity, accounting and interruption tests."""
import copy
import unittest
from pathlib import Path
from kit_gate_resume import identity,preflight,resume_rows,serial_results
from kit_cases import CASES


class Resume(unittest.TestCase):
    def report(self):
        return {'gate_resume_version':1,'input_digest':'exact','reserved_or_estimated_usd':.05,
                'results':[{'case':'meal','variant':'candidate','answer':{'interpretation':'Fictional'},
                            'passed':True,'provider_requests':2},
                           {'case':'meal','variant':'baseline','passed':False,'provider_requests':0,
                            'error':'HTTPException: 429: AI is paused.'}]}

    def test_identity_and_money_survive_resume(self):
        rows,spent=resume_rows(self.report(),'exact',['meal'])
        self.assertEqual(len(rows),1);self.assertTrue(rows[0]['reused']);self.assertEqual(spent,.05)
        plan=preflight(2.5,spent,79)
        self.assertEqual(plan['maximum_remaining_attempts'],474)
        self.assertAlmostEqual(plan['remaining_budget_usd'],2.45)
        self.assertTrue(plan['estimate_only'])

    def test_never_repay_validation_or_interrupted_paid_rows(self):
        report=self.report()
        for error in ('numeric_unsupported','Interrupted paid response','HTTPException: 429: AI is paused.'):
            report['results'][1].update(provider_requests=1,error=error)
            rows,_=resume_rows(report,'exact',['meal'])
            self.assertEqual(len(rows),2)
            self.assertFalse(rows[1]['passed'])

    def test_wrong_source_bad_cost_and_duplicates_refuse(self):
        for change in ({'input_digest':'other'},{'gate_resume_version':0},
                       {'reserved_or_estimated_usd':float('nan')},{'reserved_or_estimated_usd':2.6}):
            with self.assertRaises(ValueError):resume_rows({**self.report(),**change},'exact',['meal'])
        report=self.report();report['results'].append(copy.deepcopy(report['results'][0]))
        with self.assertRaises(ValueError):resume_rows(report,'exact',['meal'])

    def test_source_dates_and_baseline_are_bound(self):
        root=Path(__file__).resolve().parents[2]
        def digest(**kw):return identity(root,CASES,'live','batch','bytes',**kw)
        today=('2026-11-25','2026-11-25')
        self.assertEqual(digest(today=today),digest(today=today))
        self.assertNotEqual(digest(today=today),digest(today=('2026-11-26','2026-11-25')))
        self.assertNotEqual(digest(today=today),identity(root,CASES,'old-live','batch','bytes',today=today))

    def test_full_gate_cap_plan_and_eighty_serial_responses(self):
        plan=preflight(2.5,0,80)
        self.assertEqual(plan['maximum_remaining_attempts'],480)
        self.assertLess(plan['estimated_remaining_usd']+plan['reservation_headroom_usd'],2.5)
        with self.assertRaises(ValueError):preflight(1,0,80)
        called=[]
        def run(i):called.append(i);return {'case':i,'error':None}
        self.assertEqual(len(list(serial_results(run,range(80)))),80)
        self.assertEqual(len(set(called)),80)
        self.assertEqual(preflight(2.5,2.5,0)['responses_remaining'],0)

    def test_resume_only_runs_missing_jobs_once(self):
        previous=self.report();rows,_=resume_rows(previous,'exact',['meal'])
        jobs=[(v,'meal') for v in ('baseline','candidate') if (v,'meal') not in {(r['variant'],r['case']) for r in rows}]
        self.assertEqual(jobs,[('baseline','meal')])
        called=[]
        list(serial_results(lambda job:called.append(job) or {'error':None},jobs))
        self.assertEqual(called,[('baseline','meal')])


if __name__=='__main__':unittest.main()
