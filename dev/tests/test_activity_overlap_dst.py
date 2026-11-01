"""Elapsed workout matching uses instants, including both copies of a repeated local hour."""
import datetime as dt
import unittest
from zoneinfo import ZoneInfo

from app import activities


class OverlapDST(unittest.TestCase):
    def test_repeated_hour_in_both_argument_orders(self):
        zone = ZoneInfo('America/New_York')
        for hour in (5, 6, 7):
            utc = dt.datetime(2024, 11, 3, hour, 10, tzinfo=dt.timezone.utc)
            local = utc.astimezone(zone)
            with self.subTest(hour=hour):
                self.assertEqual(activities.overlap(utc, 100, local, 100), 1)
                self.assertEqual(activities.overlap(local, 100, utc, 100), 1)

    def test_rollback_crossing_and_eighty_percent_boundary(self):
        zone = ZoneInfo('America/New_York')
        start = dt.datetime(2024, 11, 3, 5, 59, 30, tzinfo=dt.timezone.utc)
        for shift, expected in ((0, 1), (20, .8), (21, .79), (100, 0)):
            later = (start + dt.timedelta(seconds=shift)).astimezone(zone)
            with self.subTest(shift=shift):
                self.assertAlmostEqual(activities.overlap(start.astimezone(zone), 100, later, 100), expected)
                self.assertAlmostEqual(activities.overlap(later, 100, start.astimezone(zone), 100), expected)
        first = dt.datetime(2024, 11, 3, 1, 10, tzinfo=zone, fold=0)
        self.assertEqual(activities.overlap(first, 100, first.replace(fold=1), 100), 0)

    def test_missing_duration_and_naive_arithmetic_are_preserved(self):
        start = dt.datetime(2024, 11, 3, 1, 10)
        self.assertEqual(activities.overlap(start, 100, start, 100), 1)
        self.assertEqual(activities.overlap(start, None, start, 100), 0)

    def test_candidate_window_uses_elapsed_minutes_for_local_callers(self):
        class Connection:
            def execute(self, query, params):
                self.params = params
                return self

            def fetchall(self):
                return []

        zone = ZoneInfo('America/New_York')
        for hour, minute in ((5, 59), (6, 10)):
            utc = dt.datetime(2024, 11, 3, hour, minute, tzinfo=dt.timezone.utc)
            c = Connection()
            self.assertIsNone(activities.find_duplicate(c, 42, utc.astimezone(zone), 250, 'run', 100, 'track'))
            self.assertEqual(c.params['a'].astimezone(dt.timezone.utc), utc-dt.timedelta(minutes=2))
            self.assertEqual(c.params['b'].astimezone(dt.timezone.utc), utc+dt.timedelta(minutes=2))


if __name__ == '__main__':
    unittest.main()
