"""Fixed selection, no-provider dry run and live-report pin regressions."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from kit_batch2_cases import BATCH2_CASES, EXTRA
from kit_batch2_pin import LIVE, verify
from kit_gate_resume import identity
from test_kit_gate import KitGatePreflight


class Batch2Gate(KitGatePreflight):
    def test_batch2_dry_run_uses_exact_selection_and_caps(self):
        result=self.run_eval('--gate','--batch2','--dry-run')
        self.assertEqual(result.returncode,0,result.stderr)
        report=json.loads(self.output.read_text())
        self.assertEqual(report['selected_case_ids'],[c[0] for c in BATCH2_CASES])
        self.assertEqual(len(set(report['selected_case_ids'])),40)
        self.assertEqual(sum(c[0].startswith('weekly-') for c in BATCH2_CASES),10)
        self.assertEqual(len(EXTRA),8)
        self.assertLessEqual(report['budget_preflight']['estimated_remaining_usd']+
                             report['budget_preflight']['reservation_headroom_usd'],2.50)
        self.assertEqual(report['feature_coverage']['charts'],'unsupported; separate Draft excluded')
        self.assertEqual(report['provider_calls'],0)

    def test_fixture_source_is_bound_to_resume(self):
        root=Path(__file__).resolve().parents[2]
        def changed(name):
            value=(root/name).read_text()
            return value+'\n# different seed' if name.endswith('kit_batch2_cases.py') else value
        args=(root,BATCH2_CASES,LIVE,'candidate','baseline bytes')
        self.assertNotEqual(identity(*args),identity(*args,read=changed))

    def test_installed_report_pin_rejects_unreviewed_file(self):
        report=self.directory/'report.json';report.write_text('{"reviewed":false}')
        with self.assertRaisesRegex(ValueError,'pinned installed'):
            verify(self.directory,report)


if __name__=='__main__':unittest.main()
