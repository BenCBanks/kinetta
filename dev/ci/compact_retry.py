#!/usr/bin/env python3
"""Decide whether an unassigned Compact simulator job deserves one retry."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


MIN_QUEUE_SECONDS = 10 * 60


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _queue_eligible(compact: dict[str, Any], pro: dict[str, Any]) -> bool:
    """A cancellation before runner assignment consumed no simulator minutes."""
    if pro.get("conclusion") != "success":
        return False
    if compact.get("conclusion") != "cancelled":
        return False
    if compact.get("runner_id") != 0 or compact.get("runner_name") not in (None, ""):
        return False
    if compact.get("steps") != []:
        return False

    started = _parse_time(compact.get("started_at"))
    completed = _parse_time(compact.get("completed_at"))
    if started is None or completed is None:
        return False
    return (completed - started).total_seconds() >= MIN_QUEUE_SECONDS


def _timeout_log_candidate(compact: dict[str, Any], pro: dict[str, Any]) -> bool:
    """Only inspect logs for a Compact job whose existing retry step failed."""
    if pro.get("conclusion") != "success" or compact.get("conclusion") != "failure":
        return False
    runner_id = compact.get("runner_id")
    if not isinstance(runner_id, int) or runner_id <= 0 or not compact.get("runner_name"):
        return False
    return any(
        step.get("name") == "Retry native UI once after a failed attempt"
        and step.get("conclusion") == "failure"
        for step in compact.get("steps", [])
    )


def _simctl_timeout_signature(log_text: str) -> bool:
    """Accept the known launch-timeout/no-metrics cascade, never another assertion."""
    launch = re.search(r"Command timed out: xcrun simctl launch\b", log_text)
    missing = re.search(r"AssertionError: No native metrics:", log_text)
    if not launch or not missing or launch.start() > missing.start():
        return False
    assertions = re.findall(r"AssertionError:.*", log_text)
    return bool(assertions) and all("No native metrics:" in line for line in assertions)


def eligible(jobs: list[dict[str, Any]], compact_log: str = "") -> bool:
    """Allow one retry for queue-only cancellation or the known simctl timeout."""
    by_name = {job.get("name"): job for job in jobs}
    compact = by_name.get("native-ui (compact)")
    pro = by_name.get("native-ui (pro)")
    if not compact or not pro:
        return False
    if _queue_eligible(compact, pro):
        return True
    return _timeout_log_candidate(compact, pro) and _simctl_timeout_signature(compact_log)


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} JOBS_JSON", file=sys.stderr)
        return 2
    with Path(sys.argv[1]).open(encoding="utf-8") as source:
        payload = json.load(source)
    jobs = payload.get("jobs", []) if isinstance(payload, dict) else payload
    by_name = {job.get("name"): job for job in jobs}
    compact = by_name.get("native-ui (compact)", {})
    pro = by_name.get("native-ui (pro)", {})
    logs = ""
    if not _queue_eligible(compact, pro) and _timeout_log_candidate(compact, pro):
        repository = os.environ.get("GITHUB_REPOSITORY", "")
        job_id = compact.get("id")
        if repository and job_id:
            try:
                result = subprocess.run(
                    ["gh", "api", "--allow-escape-sequences",
                     f"repos/{repository}/actions/jobs/{job_id}/logs"],
                    check=True, capture_output=True, text=True, timeout=30,
                )
                logs = result.stdout
            except (OSError, subprocess.SubprocessError) as error:
                print(f"::warning::Compact failure logs unavailable; not retrying ({type(error).__name__}).", file=sys.stderr)
    print(f"retry_compact={str(eligible(jobs, logs)).lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
