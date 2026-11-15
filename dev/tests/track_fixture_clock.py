"""Calendar selection for the fictional Today-plan fixture."""
from datetime import date, datetime
from zoneinfo import ZoneInfo


ZONES = ('Pacific/Kiritimati', 'UTC', 'Etc/GMT+12')
PLAN_WEEKDAYS = (1, 3, 5, 6)  # Tuesday, Thursday, Saturday, Sunday


def select_plan_day(server_now: datetime) -> tuple[str, date, int]:
    """Choose a non-DST persona zone where the live server date has a workout.

    This fixture exercises the real API's Today plan, so its date must follow the
    test server clock. Keep the choice safe at UTC date boundaries, including Sunday.
    """
    if server_now.tzinfo is None or server_now.utcoffset() is None:
        raise ValueError('server_now must be timezone-aware')
    for zone_name in ZONES:
        today = server_now.astimezone(ZoneInfo(zone_name)).date()
        if today.weekday() in PLAN_WEEKDAYS:
            return zone_name, today, 6 if today.weekday() == 6 else 5
    raise AssertionError(f'No fixture zone has a plan day for {server_now.isoformat()}')
