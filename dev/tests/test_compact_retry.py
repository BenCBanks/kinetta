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

    def test_pro_failure_blocks_retry(self):
        self.assertFalse(eligible(jobs(pro={"conclusion": "failure"})))

    def test_missing_compact_job_blocks_retry(self):
        self.assertFalse(eligible([{"name": "native-ui (pro)", "conclusion": "success"}]))


if __name__ == "__main__":
    unittest.main()
