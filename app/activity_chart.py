"""Calendar-only helpers; callers supply already authorised, viewer-local daily totals."""
import datetime as dt


def sunday(day):
    return day - dt.timedelta(days=(day.weekday() + 1) % 7)


def weekly_distances(today, by_day):
    start = sunday(today) - dt.timedelta(weeks=6)
    return [{'d': start + dt.timedelta(weeks=i),
             'end': min(start + dt.timedelta(weeks=i, days=6), today),
             'distance_m': sum(by_day.get(start + dt.timedelta(weeks=i, days=j), 0) or 0
                               for j in range(7) if start + dt.timedelta(weeks=i, days=j) <= today),
             'today': i == 6} for i in range(7)]
