import datetime as dt

from app.activity_metrics import close_to_target, week_streak


monday = dt.date(2026, 10, 5)
assert week_streak([monday, monday + dt.timedelta(days=7)], monday + dt.timedelta(days=11)) == 2
assert week_streak([monday, monday + dt.timedelta(days=7)], monday + dt.timedelta(days=14)) == 2, 'no current-week workout keeps the streak ending last week'
assert week_streak([monday, monday + dt.timedelta(days=14)], monday + dt.timedelta(days=14)) == 1, 'a skipped week breaks the streak'
assert week_streak([], monday + dt.timedelta(days=14)) == 0

assert close_to_target(90_000, {}, 'metric') == '10 km to 100 km this year', 'the 10 percent threshold is inclusive'
assert close_to_target(89_999, {}, 'metric') is None, 'just outside the threshold stays hidden'
assert close_to_target(100_000, {}, 'metric') is None, 'a reached target is not described as close'
assert close_to_target(90 * 1609.344, {}, 'imperial') == '10 mi to 100 mi this year'
assert close_to_target(0, {'run': 49, 'walk': 5000}, 'metric') == '1 run to your 50th run'
assert close_to_target(0, {'ride': 48, 'walk': 5000}, 'metric') == '2 rides to your 50th ride'
assert close_to_target(0, {'run': 40, 'walk': 50}, 'metric') == '10 workouts to your 100th'
assert close_to_target(91_000, {'run': 48, 'walk': 5000}, 'metric') == '2 runs to your 50th run', 'nearest means smallest percentage remaining across target types'
assert close_to_target(0, {}, 'metric') is None

print('Activity metrics: local Monday streak/current-or-last week, gaps, distance units, inclusive 10% thresholds and nearest target PASS')
