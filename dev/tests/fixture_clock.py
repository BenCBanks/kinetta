"""Shared instant and account timezone for fictional date-sensitive fixtures."""
import datetime as dt
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo


CLOCK_PATH = Path(__file__).resolve().parents[1] / 'screenshots' / 'fixture-time.json'


def load_fixture_clock(default: str = 'now') -> tuple[dt.datetime, str]:
    """Use the matrix override, or the requested default when none is supplied."""
    data = json.loads(CLOCK_PATH.read_text())
    raw_instant = os.environ.get('KINETTA_FIXTURE_INSTANT')
    if raw_instant:
        instant = dt.datetime.fromisoformat(raw_instant.replace('Z', '+00:00'))
    elif default == 'fixture':
        instant = dt.datetime.fromisoformat(data['instant'].replace('Z', '+00:00'))
    elif default == 'now':
        instant = dt.datetime.now(dt.timezone.utc)
    else:
        raise ValueError("default must be 'fixture' or 'now'")
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError('fixture instant must include a timezone')
    timezone = data['timezone']
    ZoneInfo(timezone)
    return instant.astimezone(dt.timezone.utc), timezone


def account_day(instant: dt.datetime, timezone: str) -> dt.date:
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError('fixture instant must include a timezone')
    return instant.astimezone(ZoneInfo(timezone)).date()
