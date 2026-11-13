"""Fictional TCX import contract: provider elapsed stays separate from moving time."""
import datetime as dt

from app import analysis, parsers


_TRACKPOINTS = ''.join(
    f'<Trackpoint><Time>2026-11-13T10:{i // 60:02d}:{i % 60:02d}Z</Time>'
    f'<DistanceMeters>{8046.72 * (i // 30) / 80:.2f}</DistanceMeters><Speed>3.3528</Speed>'
    f'<Position><LatitudeDegrees>{40 + i / 4000:.6f}</LatitudeDegrees><LongitudeDegrees>-75</LongitudeDegrees></Position></Trackpoint>'
    for i in range(0, 2401, 30)
)
TCX = (f'''<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities><Activity Sport="Running">
    <Id>2026-11-13T10:00:00Z</Id>
    <Lap StartTime="2026-11-13T10:00:00Z">
      <TotalTimeSeconds>3000</TotalTimeSeconds>
      <DistanceMeters>8046.72</DistanceMeters>
      <Track>{_TRACKPOINTS}</Track>
    </Lap>
  </Activity></Activities>
</TrainingCenterDatabase>''').encode()


parsed = parsers.read('fictional-paused-run.tcx', TCX)
assert parsed['session']['elapsed_s'] == 3000, 'TCX TotalTimeSeconds is retained as elapsed time'
assert 'moving_s' not in parsed['session'], 'TCX elapsed is not mislabeled as moving time'
assert parsed['laps'][0]['elapsed_s'] == 3000 and 'moving_s' not in parsed['laps'][0]

streams = analysis.prepare(parsed['streams'], parsed['sport'])
summary = analysis.summary(streams, parsed['sport'], parsed['session'], {'max_hr': 190, 'rest_hr': 60})
assert summary['elapsed_s'] == 3000, 'stored summary uses the provider elapsed total'
assert summary['moving_s'] == 2400, 'moving time remains derived from the fictional track'
assert summary['distance_m'] == 8046.72, 'source five-mile distance remains authoritative'
assert parsed['start'] == dt.datetime(2026, 11, 13, 10, tzinfo=dt.timezone.utc)
print('TCX import: 50:00 elapsed, 40:00 moving and five-mile distance stay distinct PASS')
