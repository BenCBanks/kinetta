"""No-provider full-gate resume identity, accounting and interruption tests."""
import copy
import unittest
import tempfile,subprocess
from unittest.mock import patch
from pathlib import Path
from kit_gate_resume import identity,preflight,resume_rows,serial_results,prepare_cache,refusal_replay
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

    def test_replay_required_and_retry_only_explicit_failed_paid_candidate(self):
        report=self.report();report['results'][0].update(passed=False,error='numeric_unsupported')
        report['source_report_commit']='old'
        with self.assertRaises(ValueError):resume_rows(report,'exact',['meal'])
        rows,spent=resume_rows(report,'exact',['meal'],recheck=lambda row:{'passed':True},retry_cases=['meal'])
        self.assertEqual(len(rows),1);self.assertEqual(rows[0]['variant'],'baseline');self.assertEqual(spent,.05)
        rows,_=resume_rows(report,'exact',['meal'],recheck=lambda row:{'passed':True})
        self.assertFalse(rows[0]['source_row']['passed']);self.assertTrue(rows[0]['passed'])
        for changes in ({'passed':True},{'provider_requests':0},{'interrupted':True}):
            invalid=copy.deepcopy(report);invalid['results'][0].update(changes)
            with self.assertRaises(ValueError):resume_rows(invalid,'exact',['meal'],recheck=lambda row:{},retry_cases=['meal'])
        with self.assertRaises(ValueError):resume_rows(report,'exact',['meal'],recheck=lambda row:{},retry_cases=['unknown'])

    def test_zero_call_refusal_only_exact_envelope(self):
        answer={'interpretation':'sharing','answer_blocks':[{'kind':'paragraph','text':'sharing'}],
                'facts':[],'actions':[],'follow_ups':[],'selection':None,'health_included':False,'consent_refused':True}
        row={'variant':'candidate','case':'weekly-health-consent-off','answer':answer,
             'provider_requests':0,'error':'Weekly answer returned without an AI provider request.'}
        self.assertTrue(refusal_replay(row,'sharing')['passed'])
        for changes in ({'provider_requests':1},{'error':'different failure'},
                        {'answer':{**answer,'private_health':100}}):
            self.assertIsNone(refusal_replay({**row,**changes},'sharing'))

    def test_validator_cache_proves_archived_source_and_unchanged_provider_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            def git(*args):return subprocess.check_output(['git','-C',directory,*args],stderr=subprocess.DEVNULL,text=True).strip()
            git('init');git('config','user.email','fixture@example.test');git('config','user.name','Fictional fixture')
            sources={'app/kit_claims.py':"NUMBER_WORD='before'\ndef bound_logged_days(x):return x\ndef weekly_system():return 'fixed prompt'\n",
                     'app/coach_chat.py':"SYSTEM='fixed prompt'\n",'app/db.py':'# fixed schema\n',
                     'app/kit_eval_diagnostics.py':'# fixed capture\n',
                     'dev/evals/kit_weekly_fixtures.py':"SEED='fixed'\ndef is_expected_health_consent_refusal():return False\n",
                     'dev/evals/kit_eval.py':' with db.connect() as c:\n  for suffix in fixed: pass\n def run(item):pass\n'}
            for name,value in sources.items():
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(value)
            git('add','.');git('commit','-m','Fictional archived source');revision=git('rev-parse','HEAD')
            report={'candidate_commit':revision,'baseline_commit':'live','baseline_sha256':'bytes',
                    'input_digest':identity(root,[],'live',revision,'bytes')}
            (root/'app/kit_claims.py').write_text(sources['app/kit_claims.py'].replace("NUMBER_WORD='before'","NUMBER_WORD='after'"))
            accepted=prepare_cache(root,report,[],['kit_claims.py','coach_chat.py'])
            self.assertEqual(accepted['source_report_commit'],revision)
            for name in ('app/coach_chat.py','app/db.py','dev/evals/kit_weekly_fixtures.py','dev/evals/kit_eval.py'):
                before=(root/name).read_text();(root/name).write_text(before.replace('fixed','changed'))
                with self.assertRaises(ValueError):prepare_cache(root,report,[],['kit_claims.py','coach_chat.py'])
                (root/name).write_text(before)
            with self.assertRaises(ValueError):prepare_cache(root,{**report,'input_digest':'different date'},[],['kit_claims.py','coach_chat.py'])


if __name__=='__main__':unittest.main()
