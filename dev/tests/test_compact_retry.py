import unittest

from dev.ci.compact_retry import eligible


def jobs(compact=None, pro=None):
    return [
        {
            "name": "native-ui (compact)",
            "conclusion": "cancelled",
            "runner_id": 0,
            "runner_name": "",
            "started_at": "2026-11-17T19:37:35Z",
            "completed_at": "2026-11-17T19:52:37Z",
            "steps": [],
            **(compact or {}),
        },
        {"name": "native-ui (pro)", "conclusion": "success", **(pro or {})},
    ]


class CompactRetryTests(unittest.TestCase):
    def test_queue_cancellation_after_ten_minutes_is_eligible(self):
        self.assertTrue(eligible(jobs()))

    def test_short_queue_cancellation_is_not_retried(self):
        self.assertFalse(
            eligible(
                jobs(
                    compact={
                        "completed_at": "2026-11-17T19:46:00Z",
                    }
                )
            )
        )

    def test_runner_assignment_blocks_retry(self):
        self.assertFalse(eligible(jobs(compact={"runner_id": 123, "runner_name": "mac"})))

    def test_any_step_blocks_retry(self):
        self.assertFalse(eligible(jobs(compact={"steps": [{"name": "Set up job"}]})))

    def test_actual_test_failure_blocks_retry(self):
        self.assertFalse(eligible(jobs(compact={"conclusion": "failure"})))

    def test_simctl_launch_timeout_then_missing_metrics_is_eligible_once(self):
        compact = {
            "id": 1234,
            "conclusion": "failure",
            "runner_id": 42,
            "runner_name": "GitHub Actions 42",
            "steps": [{
                "name": "Retry native UI once after a failed attempt",
                "conclusion": "failure",
            }],
        }
        log = "Command timed out: xcrun simctl launch DEVICE com.kinetta.app\nAssertionError: No native metrics: iPhone SE light header-me\n"
        self.assertTrue(eligible(jobs(compact=compact), log))

    def test_real_assertion_blocks_timeout_retry_even_if_later_launch_stalls(self):
        compact = {
            "id": 1234,
            "conclusion": "failure",
            "runner_id": 42,
            "runner_name": "GitHub Actions 42",
            "steps": [{
                "name": "Retry native UI once after a failed attempt",
                "conclusion": "failure",
            }],
        }
        log = (
            "AssertionError: Activity title was clipped\n"
            "Command timed out: xcrun simctl launch DEVICE com.kinetta.app\n"
            "AssertionError: No native metrics: iPhone SE light header-me\n"
        )
        self.assertFalse(eligible(jobs(compact=compact), log))

    def test_missing_metrics_without_simctl_launch_timeout_is_not_eligible(self):
        compact = {
            "id": 1234,
            "conclusion": "failure",
            "runner_id": 42,
            "runner_name": "GitHub Actions 42",
            "steps": [{
                "name": "Retry native UI once after a failed attempt",
                "conclusion": "failure",
            }],
        }
        self.assertFalse(eligible(jobs(compact=compact), "AssertionError: No native metrics: SE\n"))

    def test_launch_timeout_without_missing_metrics_is_not_eligible(self):
        compact = {
            "id": 1234,
            "conclusion": "failure",
            "runner_id": 42,
            "runner_name": "GitHub Actions 42",
            "steps": [{
                "name": "Retry native UI once after a failed attempt",
                "conclusion": "failure",
            }],
        }
        self.assertFalse(eligible(jobs(compact=compact), "Command timed out: xcrun simctl launch DEVICE app\n"))

    def test_simctl_signature_requires_failed_native_ui_retry_step(self):
        compact = {
            "id": 1234,
            "conclusion": "failure",
            "runner_id": 42,
            "runner_name": "GitHub Actions 42",
            "steps": [{"name": "Check native WebView layout with fictional records", "conclusion": "failure"}],
        }
        log = "Command timed out: xcrun simctl launch DEVICE app\nAssertionError: No native metrics: SE\n"
        self.assertFalse(eligible(jobs(compact=compact), log))

    def test_pro_failure_blocks_retry(self):
        self.assertFalse(eligible(jobs(pro={"conclusion": "failure"})))

    def test_missing_compact_job_blocks_retry(self):
        self.assertFalse(eligible([{"name": "native-ui (pro)", "conclusion": "success"}]))


if __name__ == "__main__":
    unittest.main()
