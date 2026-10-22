"""Sunday calendar buckets are independent of locale, DST and year boundaries."""
import datetime as dt
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.activity_chart import sunday, weekly_distances

for text in ('2026-10-18', '2026-10-24', '2027-01-01', '2026-11-01', '2026-03-08'):
    today = dt.date.fromisoformat(text)
    first = sunday(today) - dt.timedelta(weeks=6)
    totals = {first - dt.timedelta(days=1): 99999, first: 1000,
              sunday(today) - dt.timedelta(days=1): 2000, sunday(today): 3000,
              today + dt.timedelta(days=1): 99999}
    # On Saturday tomorrow is outside the current week; on Sunday today is its first day.
    weeks = weekly_distances(today, totals)
    assert len(weeks) == 7 and all(r['d'].weekday() == 6 for r in weeks)
    assert weeks[0]['d'] == first and weeks[0]['distance_m'] == 1000
    assert weeks[-2]['distance_m'] == 2000 and weeks[-1]['distance_m'] == 3000
    assert weeks[-1]['end'] == today and weeks[-1]['today']
    assert all(not r['today'] for r in weeks[:-1])
    assert len(weekly_distances(today, {})) == 7
    assert all(r['distance_m'] == 0 for r in weekly_distances(today, {}))
print('Sunday weekly buckets: seven zero-filled periods, boundaries, partial/current week, year/DST and no future totals PASS')

from app.activity_chart import distance_days
mixed=distance_days([{'d':today,'sport':'run','distance_m':3000,'moving_s':1200},
                     {'d':today,'sport':'ride','distance_m':9000,'moving_s':1800},
                     {'d':today,'sport':'run','distance_m':2000,'moving_s':600},
                     {'d':today,'sport':'new-sport','distance_m':100,'moving_s':20}])
assert mixed[today]['distance_m']==14100 and mixed[today]['moving_s']==3620
assert mixed[today]['by_sport']=={'run':5000,'ride':9000,'other':100}
weekly=weekly_distances(today,{d:v['distance_m'] for d,v in mixed.items()},{d:v['by_sport'] for d,v in mixed.items()})
assert weekly[-1]['by_sport']=={'other':100,'ride':9000,'run':5000}
assert sum(weekly[-1]['by_sport'].values())==weekly[-1]['distance_m']
assert weekly_distances(today,{}, {})[-1]['by_sport']=={}
print('Sport segments: same-day multiple activities, totals, unknown sports, weeks and empty groups PASS')
