#!/usr/bin/env python3
"""Decide whether an unassigned Compact simulator job deserves one retry."""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any


MIN_QUEUE_SECONDS = 10 * 60


def _parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def eligible(jobs: list[dict[str, Any]]) -> bool:
    """Return true only for a long-queued, runnerless Compact cancellation."""
    by_name = {job.get("name"): job for job in jobs}
    compact = by_name.get("native-ui (compact)")
    pro = by_name.get("native-ui (pro)")
    if not compact or not pro or pro.get("conclusion") != "success":
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


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {Path(sys.argv[0]).name} JOBS_JSON", file=sys.stderr)
        return 2
    with Path(sys.argv[1]).open(encoding="utf-8") as source:
        payload = json.load(source)
    jobs = payload.get("jobs", []) if isinstance(payload, dict) else payload
    print(f"retry_compact={str(eligible(jobs)).lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
