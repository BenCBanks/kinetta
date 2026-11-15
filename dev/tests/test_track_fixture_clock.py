"""The live-date Track fixture selects a supported local training day at every UTC boundary."""
import datetime as dt
import unittest
from zoneinfo import ZoneInfo

from track_fixture_clock import PLAN_WEEKDAYS, ZONES, select_plan_day


class TrackFixtureClock(unittest.TestCase):
    def test_every_utc_weekday_and_hour_has_a_supported_plan_day(self):
        monday = dt.datetime(2026, 11, 9, tzinfo=dt.timezone.utc)
        for weekday in range(7):
            for hour in range(24):
                with self.subTest(weekday=weekday, hour=hour):
                    instant = monday + dt.timedelta(days=weekday, hours=hour)
                    zone, today, long_day = select_plan_day(instant)
                    self.assertIn(zone, ZONES)
                    self.assertEqual(today, instant.astimezone(ZoneInfo(zone)).date())
                    self.assertIn(today.weekday(), PLAN_WEEKDAYS)
                    self.assertEqual(long_day, 6 if today.weekday() == 6 else 5)
                    self.assertEqual(select_plan_day(instant), (zone, today, long_day))

    def test_sunday_afternoon_and_evening_keep_the_sunday_long_run(self):
        for hour in (13, 18):
            with self.subTest(hour=hour):
                instant = dt.datetime(2026, 11, 15, hour, tzinfo=dt.timezone.utc)
                zone, today, long_day = select_plan_day(instant)
                self.assertEqual(today.weekday(), 6)
                self.assertEqual(long_day, 6)
                self.assertEqual(today, instant.astimezone(ZoneInfo(zone)).date())

    def test_naive_instants_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'timezone-aware'):
            select_plan_day(dt.datetime(2026, 11, 15, 13))


if __name__ == '__main__':
    unittest.main()
