"""Fixed selection, no-provider dry run and live-report pin regressions."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from kit_batch2_cases import BATCH2_CASES, EXTRA, chart_records, training_records, required_shape
from kit_batch2_pin import LIVE, verify, verify_candidate, CANDIDATE_TEXT
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
        self.assertEqual(len(EXTRA),9)
        self.assertLessEqual(report['budget_preflight']['estimated_remaining_usd']+
                             report['budget_preflight']['reservation_headroom_usd'],2.50)
        self.assertIn('supported distance chart',report['feature_coverage']['charts'])
        self.assertIn('explicit memory override',report['feature_coverage']['contextual_coaching'])
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

    def test_supported_chart_requires_actual_seeded_records_and_card(self):
        import datetime as dt
        records=chart_records(dt.date(2026,11,26))
        self.assertEqual([r['distance_m'] for r in records],[3000,5000,7000])
        chart={'metric':'distance','sport':'run','group_by':'workout','points':[{'value':r['distance_m']} for r in records]}
        self.assertIsNone(required_shape('batch2-chart-distance','candidate',{'chart':chart}))
        self.assertIsNotNone(required_shape('batch2-chart-distance','candidate',{'interpretation':'No chart'}))
        self.assertIsNone(required_shape('batch2-chart-distance','baseline',{'interpretation':'No chart'}))
        chart['points'][1]['value']=99999
        self.assertIsNotNone(required_shape('batch2-chart-distance','candidate',{'chart':chart}))

    def test_training_next_step_requires_three_measured_weeks_and_app_card(self):
        import datetime as dt
        for day in range(23,30):
            records=training_records(dt.date(2026,11,day))
            dates=[dt.date.fromisoformat(r['start_time'][:10]) for r in records]
            self.assertEqual(len({d-dt.timedelta(days=d.weekday()) for d in dates}),3)
        chart=dict(presentation='weekly_totals',metric='distance',aggregate='sum',group_by='week',sport='all',
                   summary={'overall':15000},points=[{'value':v} for v in [7000,None,5000,None,3000,None]])
        self.assertIsNone(required_shape('batch2-next-step','candidate',{'chart':chart}))
        self.assertIsNotNone(required_shape('batch2-next-step','candidate',{'interpretation':'No chart'}))
        self.assertIsNone(required_shape('batch2-next-step','baseline',{'interpretation':'No chart'}))
        chart['points'][0]['value']=99999
        self.assertIsNotNone(required_shape('batch2-next-step','candidate',{'chart':chart}))

    def test_candidate_pin_checks_final_source_and_rejects_app_delta(self):
        from unittest.mock import patch
        root=Path(__file__).resolve().parents[2]
        self.assertEqual(verify_candidate(root)['ai_text'],CANDIDATE_TEXT)
        with patch('kit_batch2_pin.subprocess.run',return_value=type('Diff',(),{'returncode':1})()):
            with self.assertRaisesRegex(ValueError,'final combined freeze'):verify_candidate(root)


if __name__=='__main__':unittest.main()
