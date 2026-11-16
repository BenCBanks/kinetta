#!/usr/bin/env python3
"""Guard the Draft/Ready CI contract without needing a GitHub runner."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/tests.yml").read_text()


class CITieringTests(unittest.TestCase):
    def test_drafts_keep_backend_and_spacing_and_run_changed_screen_checks(self):
        quick = WORKFLOW.split("\n  quick:\n", 1)[1].split("\n  backend:\n", 1)[0]
        self.assertIn("github.event.pull_request.draft == true", quick)
        self.assertIn("dev/tests/changed.sh", quick)
        self.assertIn("fetch-depth: 0", quick)

        backend = WORKFLOW.split("\n  backend:\n", 1)[1].split("\n  browser_shards:\n", 1)[0]
        self.assertNotIn("\n    if:", backend)
        self.assertIn("  spacing:\n", WORKFLOW)

    def test_full_browser_shards_are_ready_only(self):
        browser = WORKFLOW.split("\n  browser_shards:\n", 1)[1].split("\n  reviewer_integration:\n", 1)[0]
        self.assertIn("github.event.pull_request.draft == false", browser)
        reviewer = WORKFLOW.split("\n  reviewer_integration:\n", 1)[1].split("\n  tests:\n", 1)[0]
        self.assertIn("github.event.pull_request.draft == false", reviewer)

    def test_aggregate_gate_requires_each_tier_and_accepts_only_intended_skips(self):
        gate = WORKFLOW.split("\n  tests:\n", 1)[1].split("\n  spacing:\n", 1)[0]
        for result in ("QUICK_RESULT", "CHANGED_SCREEN_MAP_RESULT", "BACKEND_RESULT", "BROWSER_SHARDS_RESULT", "REVIEWER_INTEGRATION_RESULT", "SPACING_RESULT"):
            self.assertIn(result, gate)
        self.assertIn('success|skipped', gate)
        self.assertIn('test "$result" = success', gate)


if __name__ == "__main__":
    unittest.main()
