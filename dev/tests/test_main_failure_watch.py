import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("main_failure_watch", ROOT / "dev/ci/main_failure_watch.py")
watch = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(watch)


class MainFailureWatchTests(unittest.TestCase):
    def test_workflow_is_hourly_and_uses_only_read_and_issue_permissions(self):
        workflow = (ROOT / ".github/workflows/main-failure-watch.yml").read_text()
        self.assertIn('cron: "15 * * * *"', workflow)
        self.assertIn("  actions: read", workflow)
        self.assertIn("  contents: read", workflow)
        self.assertIn("  issues: write", workflow)
        self.assertNotIn("contents: write", workflow)
        self.assertIn("timeout-minutes: 5", workflow)

    def test_keeps_only_latest_recent_run_per_workflow(self):
        now = datetime(2026, 11, 14, 18, tzinfo=timezone.utc)
        runs = [
            {"workflowName": "Tests", "createdAt": "2026-11-14T17:00:00Z", "url": "https://example.invalid/1", "headSha": "1" * 40},
            {"workflowName": "Tests", "createdAt": "2026-11-14T17:30:00Z", "url": "https://example.invalid/2", "headSha": "2" * 40},
            {"workflowName": "Homepage screenshots", "createdAt": "2026-11-12T17:00:00Z", "url": "https://example.invalid/3", "headSha": "3" * 40},
        ]
        result = watch.recent_failures(runs, now)
        self.assertEqual([run["url"] for run in result], ["https://example.invalid/2"])

    def test_body_has_dedupe_marker_and_run_link_without_log_text(self):
        body = watch.render_body([{"workflowName": "Tests", "headSha": "a" * 40, "url": "https://example.invalid/run"}])
        self.assertIn(watch.MARKER, body)
        self.assertIn("https://example.invalid/run", body)
        self.assertNotIn("log", body.split("\n")[2].lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
