"""Provider-free shared Kit evaluator preflight boundaries."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from kit_eval_support import bounded_results, capped, configure_budget, load_baseline, valid_budget

ROOT = Path(__file__).resolve().parents[2]
BOOTSTRAP = '''
import runpy,sys,types
from pathlib import Path
root=Path(sys.argv.pop(1))
class Unavailable:
 def __getattr__(self,key):raise AssertionError('Dry run touched provider/database: '+key)
app=types.ModuleType('app');app.__path__=[str(root/'app')]
for name in ('db','coach','coach_chat','ai_budget','ai_release'):setattr(app,name,Unavailable())
sys.modules['app']=app
sys.path.insert(0,str(root/'dev/evals'))
runpy.run_path(str(root/'dev/evals/kit_eval.py'),run_name='__main__')
'''


class KitGatePreflight(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.baseline = self.directory/'baseline.py'
        self.baseline.write_text("raise AssertionError('Dry run must not import baseline')\n")
        self.output = self.directory/'result.json'

    def run_eval(self, *options):
        args = [sys.executable,'-c',BOOTSTRAP,str(ROOT),
                '--baseline',str(self.baseline),'--baseline-commit','fictional-baseline',
                '--candidate-commit','fictional-candidate','--output',str(self.output),
                '--budget-usd','1',*options]
        return subprocess.run(args,capture_output=True,text=True,env={'PATH':'/usr/bin:/bin'})

    def test_forty_case_dry_run_never_touches_provider_or_database(self):
        result = self.run_eval('--gate','--dry-run')
        self.assertEqual(result.returncode,0,result.stderr)
        report = json.loads(self.output.read_text())
        self.assertEqual(len(report['selected_case_ids']),40)
        self.assertEqual(len(set(report['selected_case_ids'])),40)
        self.assertEqual(sum(case.startswith('weekly-') for case in report['selected_case_ids']),10)
        self.assertTrue(report['dry_run'])
        self.assertFalse(report['reviewed'])
        self.assertFalse(report['complete'])
        self.assertEqual(report['provider_calls'],0)
        self.assertEqual(self.output.stat().st_mode & 0o777,0o600)
        original = self.output.read_bytes()
        repeat = self.run_eval('--gate','--dry-run')
        self.assertNotEqual(repeat.returncode,0)
        self.assertEqual(original,self.output.read_bytes())

    def test_gate_cannot_be_reduced_or_reuse_baseline(self):
        for options in (('--cases','protein'),('--variant','candidate'),
                        ('--baseline-results','fictional.json')):
            with self.subTest(options=options):
                result = self.run_eval('--gate','--dry-run',*options)
                self.assertNotEqual(result.returncode,0)
                self.assertFalse(self.output.exists())

    def test_paid_execution_requires_opt_in_and_isolation(self):
        for options in ((),('--accept-paid-calls',)):
            result = self.run_eval('--gate',*options)
            self.assertNotEqual(result.returncode,0)
            self.assertFalse(self.output.exists())


class KitGateRuntime(unittest.TestCase):
    def test_loader_registers_namespace_before_execution_and_preserves_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'baseline.py'
            path.write_text("import sys\nassert sys.modules[__name__].__dict__ is globals()\n")
            before = path.read_bytes()
            with patch.dict(sys.modules):
                module = load_baseline(path)
                self.assertIs(sys.modules['app._kit_baseline'], module)
            self.assertEqual(path.read_bytes(), before)

    def test_loader_cleans_up_failed_import(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'baseline.py'
            path.write_text("raise ValueError('fixture import failure')\n")
            with patch.dict(sys.modules):
                previous = object()
                sys.modules['app._kit_baseline'] = previous
                with self.assertRaises(ValueError):
                    load_baseline(path)
                self.assertIs(sys.modules['app._kit_baseline'], previous)

    def test_caps_are_scoped_and_sufficient_for_full_gate(self):
        with patch.dict('os.environ', clear=True):
            import os
            configure_budget(2.50)
            self.assertEqual(os.environ['KINETTA_AI_DAILY_USD'], '2.25')
            self.assertEqual(os.environ['KINETTA_AI_USER_DAILY_MICROUSD'], '2250000')
            self.assertEqual(os.environ['KINETTA_AI_USER_DAILY_ATTEMPTS'], '1000')
        for amount in (0, -1, 2.51, float('nan'), float('inf')):
            self.assertFalse(valid_budget(amount))
        self.assertTrue(valid_budget(2.50))

    def test_cap_stops_after_only_inflight_pair_and_preserves_rows(self):
        called = []
        def run(index):
            called.append(index)
            return {'case': index, 'error': 'HTTPException: 429: AI is paused.' if index == 0 else None}
        results = list(bounded_results(run, list(range(80))))
        self.assertEqual(sorted(called), [0, 1])
        self.assertEqual(len(results), 2)
        self.assertTrue(capped(results[0]['error']))
        self.assertFalse(capped('HTTPException: 429: AI is busy. Try again shortly.'))
        self.assertFalse(capped('ValueError: AI is paused.'))

    def test_successful_run_keeps_all_eighty_responses(self):
        rows = list(bounded_results(lambda index: {'case': index, 'error': None}, list(range(80))))
        self.assertEqual([row['case'] for row in rows], list(range(80)))


if __name__ == '__main__':
    unittest.main()
