"""Offline report boundaries with fictional captures; never contacts a provider."""
import copy
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import workout_review_report as report


class ReportChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.capture = self.directory / 'capture.jsonl'
        self.baseline = self.directory / 'baseline.json'
        self.review = self.directory / 'review.json'
        spec = importlib.util.spec_from_file_location('release', report.ROOT / 'app/ai_release.py')
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        text = release.ai_text('kit')
        models = {'provider':'gemini','model':'gemini-3.8-flash'}
        fingerprint = hashlib.sha256(json.dumps({'scheme':2,'text':text,'models':models},sort_keys=True).encode()).hexdigest()
        self.rows = [{'type':'metadata','ai_text':text,'models':models,
            'candidate_fingerprint':fingerprint,'source_commit':'fictional-source',
            'thinking':'LOW','case_count':40}]
        self.rows += [{'type':'case','case':f'fictional-{i}', 'rejection_code':None,'error_type':None,
            'input':{'fictional_input':i},'answer_text':'Fictional stand-in JSON',
            'rendered_answer':{'workout_review':{'verdict':'Fictional stand-in'}},
            'tokens_in':100,'tokens_out':40,'cost_usd':0.001} for i in range(40)]
        self.rows += [{'type':'summary','complete':True,'completed_cases':40,'selected_cases':40,
                       'spent_or_reserved_usd':0.04,'hard_cap_usd':1.0}]
        self.save_capture()
        # This is a stand-in solely for testing the report writer, never rollout evidence.
        self.baseline.write_text(json.dumps({'reviewed':True,'candidate_fingerprint':'fictional-old',
            'kit':{'case_count':40,'unsupported_numeric_claims':0,'isolation_failures':0,
                   'health_disclosures':0,'baseline_compared':True,
                   'conversation_review_passed':True,'qualitative_review_passed':True}}))

    def save_capture(self):
        self.capture.write_text('\n'.join(json.dumps(row) for row in self.rows)+'\n')

    def approve_review(self):
        review = report.build(self.capture,self.baseline)
        review.update(reviewer='Fictional test reviewer',baseline_compared=True,
                      existing_chat_and_weekly_review_passed=True)
        for case in review['cases']:
            case.update({key:True for key in report.CHECKS})
        self.review.write_text(json.dumps(review))

    def test_approval_requires_explicit_bound_review(self):
        blank = report.build(self.capture,self.baseline)
        self.assertNotIn('reviewed',blank)
        self.assertIsNone(blank['cases'][0]['numeric_supported'])
        self.review.write_text(json.dumps(blank))
        with self.assertRaises(ValueError): report.build(self.capture,self.baseline,self.review)
        self.approve_review()
        result = report.build(self.capture,self.baseline,self.review)
        self.assertTrue(result['reviewed'])
        self.assertEqual(result['kit']['case_count'],40)
        changed = json.loads(self.review.read_text())
        changed['cases'][3]['qualitative_passed'] = False
        self.review.write_text(json.dumps(changed))
        with self.assertRaises(ValueError): report.build(self.capture,self.baseline,self.review)

    def test_fail_closed_capture_boundaries(self):
        original = copy.deepcopy(self.rows)
        mutations = [
            lambda rows: rows[0].update(dry_run=True),
            lambda rows: rows[0].update(ai_text='stale'),
            lambda rows: rows[0].update(candidate_fingerprint='wrong'),
            lambda rows: rows[-1].update(complete=False),
            lambda rows: rows[1].update(rejection_code='numeric_unsupported'),
            lambda rows: rows[1].update(error_type='ProviderError'),
            lambda rows: rows[1].update(answer_text=None),
            lambda rows: rows[1].update(rendered_answer=None),
            lambda rows: rows[1].update(tokens_in=None),
            lambda rows: rows[2].update(input=rows[1]['input']),
            lambda rows: rows.pop(1),
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.rows = copy.deepcopy(original)
                mutation(self.rows)
                self.save_capture()
                with self.assertRaises(ValueError): report.build(self.capture,self.baseline)

    def test_review_cannot_be_reused_for_changed_capture(self):
        self.approve_review()
        self.rows[1]['answer_text'] = 'Changed fictional answer'
        self.save_capture()
        with self.assertRaises(ValueError): report.build(self.capture,self.baseline,self.review)

    def test_private_output_refuses_overwrite_and_public_path(self):
        output = self.directory / 'report.json'
        report.write_private(output,{'reviewed':False})
        self.assertEqual(output.stat().st_mode & 0o777,0o600)
        with self.assertRaises(FileExistsError): report.write_private(output,{})
        with self.assertRaises(ValueError): report.private_path(report.ROOT/'report.json')


if __name__ == '__main__':
    unittest.main()
