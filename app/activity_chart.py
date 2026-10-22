"""Calendar-only helpers; callers supply already authorised, viewer-local daily totals."""
import datetime as dt


def sunday(day):
    return day - dt.timedelta(days=(day.weekday() + 1) % 7)


def distance_days(rows):
    """Combine authorised day/sport groups without dropping mixed-sport days."""
    days = {}
    for row in rows:
        day = days.setdefault(row['d'], {'distance_m': 0, 'moving_s': 0, 'by_sport': {}, '_times': {}})
        sport = row['sport'] if row['sport'] in ('run','ride','walk','hike','swim','row','ski','workout','other') else 'other'
        distance = float(row.get('distance_m') or 0)
        seconds = float(row.get('moving_s') or 0)
        day['distance_m'] += distance
        day['moving_s'] += seconds
        day['by_sport'][sport] = day['by_sport'].get(sport, 0) + distance
        day['_times'][sport] = day['_times'].get(sport, 0) + seconds
    for day in days.values():
        day['sport'] = max(day.pop('_times').items(), key=lambda pair: pair[1])[0]
    return days


def weekly_distances(today, by_day, sports=None):
    start = sunday(today) - dt.timedelta(weeks=6)
    return [{'d': start + dt.timedelta(weeks=i),
             'end': min(start + dt.timedelta(weeks=i, days=6), today),
             'distance_m': sum(by_day.get(start + dt.timedelta(weeks=i, days=j), 0) or 0
                               for j in range(7) if start + dt.timedelta(weeks=i, days=j) <= today),
             'today': i == 6,
             **({'by_sport': {sport: sum((sports.get(start + dt.timedelta(weeks=i, days=j)) or {}).get(sport, 0)
                                           for j in range(7) if start + dt.timedelta(weeks=i, days=j) <= today)
                              for sport in sorted({sport for j in range(7) if start + dt.timedelta(weeks=i, days=j) <= today
                                                   for sport in (sports.get(start + dt.timedelta(weeks=i, days=j)) or {})})}} if sports is not None else {})}
            for i in range(7)]
