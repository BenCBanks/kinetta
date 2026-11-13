"""Fictional TCX import contract: provider elapsed stays separate from moving time."""
import datetime as dt

from app import analysis, parsers


_TRACKPOINTS = ''.join(
    f'<Trackpoint><Time>2026-11-13T10:{i // 60:02d}:{i % 60:02d}Z</Time>'
    f'<DistanceMeters>{8046.72 * (i // 30) / 100:.2f}</DistanceMeters><Speed>2.68224</Speed>'
    f'<Position><LatitudeDegrees>{40 + i / 4000:.6f}</LatitudeDegrees><LongitudeDegrees>-75</LongitudeDegrees></Position></Trackpoint>'
    for i in range(0, 3001, 30)
)
TCX = (f'''<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running">
    <Id>2026-11-13T10:00:00Z</Id>
    <Lap StartTime="2026-11-13T10:00:00Z">
      <TotalTimeSeconds>2400</TotalTimeSeconds>
      <DistanceMeters>8046.72</DistanceMeters>
      <Track>{_TRACKPOINTS}</Track>
    </Lap>
  </Activity></Activities>
</TrainingCenterDatabase>''').encode()


parsed = parsers.read('fictional-paused-run.tcx', TCX)
assert parsed['session']['moving_s'] == 2400, 'TCX TotalTimeSeconds is retained as moving time'
assert 'elapsed_s' not in parsed['session'], 'trackpoint span supplies elapsed time'
assert parsed['laps'][0]['moving_s'] == 2400 and 'elapsed_s' not in parsed['laps'][0]

streams = analysis.prepare(parsed['streams'], parsed['sport'])
summary = analysis.summary(streams, parsed['sport'], parsed['session'], {'max_hr': 190, 'rest_hr': 60})
assert summary['elapsed_s'] == 3000, 'stored summary uses the 50-minute trackpoint span'
assert summary['moving_s'] == 2400, 'moving time uses the 40-minute TCX timer total'
assert summary['distance_m'] == 8046.72, 'source five-mile distance remains authoritative'
assert round(summary['elapsed_s'] / (summary['distance_m'] / 1609.344)) == 600, 'elapsed pace is 10:00 per mile'
assert parsed['start'] == dt.datetime(2026, 11, 13, 10, tzinfo=dt.timezone.utc)

NO_TRACK = b'''<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap StartTime="2026-11-13T10:00:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>1609.344</DistanceMeters></Lap><Lap StartTime="2026-11-13T10:30:00Z"><TotalTimeSeconds>600</TotalTimeSeconds><DistanceMeters>1609.344</DistanceMeters></Lap></Activity></Activities></TrainingCenterDatabase>'''
no_track = parsers.read('fictional-summary-only.tcx', NO_TRACK)
assert no_track['session']['elapsed_s'] == 2400, 'summary-only TCX spans from first lap start to last lap end'
assert no_track['session']['moving_s'] == 1200, 'summary-only TCX sums lap timer durations as moving time'

NO_TIMER = b'''<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities><Activity Sport="Running"><Lap StartTime="2026-11-13T10:00:00Z"><DistanceMeters>100</DistanceMeters><Track><Trackpoint><Time>2026-11-13T10:00:00Z</Time><DistanceMeters>0</DistanceMeters><Speed>2</Speed></Trackpoint><Trackpoint><Time>2026-11-13T10:00:30Z</Time><DistanceMeters>50</DistanceMeters><Speed>2</Speed></Trackpoint><Trackpoint><Time>2026-11-13T10:01:00Z</Time><DistanceMeters>100</DistanceMeters><Speed>2</Speed></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>'''
no_timer = parsers.read('fictional-track-only.tcx', NO_TIMER)
timer_streams = analysis.prepare(no_timer['streams'], no_timer['sport'])
timer_summary = analysis.summary(timer_streams, no_timer['sport'], no_timer['session'], {'max_hr': 190, 'rest_hr': 60})
assert 'moving_s' not in no_timer['session'] and timer_summary['moving_s'] == 60, 'without TCX timer, moving time stays trackpoint-derived'
print('TCX import: 50:00 elapsed, 40:00 moving, 10:00/mi pace and summary-only fallback PASS')
