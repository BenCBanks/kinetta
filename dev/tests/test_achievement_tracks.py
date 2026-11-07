"""Pure tier boundary and endless-tail tests; no database or server needed."""
import unittest

from app import achievement_tracks as tracks, api_achievements


class AchievementTrackRules(unittest.TestCase):
    def test_fixed_tracks_and_step_tails(self):
        cases = {
            'consistency': (150, [1, 2, 4, 10, 20, 52, 100, 150]),
            'workouts': (1_500, [1, 5, 10, 50, 100, 250, 500, 1_000, 1_500]),
            'personal_bests': (50, [1, 5, 10, 25, 50]),
        }
        for code, (value, expected) in cases.items():
            with self.subTest(code=code):
                self.assertEqual([tier.threshold for tier in tracks.tiers_for(code, value)],
                                 [float(n) for n in expected])
        active = tracks.tiers_for('active_time', 1_500 * 3_600)
        self.assertEqual([tier.threshold for tier in active],
                         [n * 3_600 for n in (1, 5, 10, 24, 100, 250, 500, 1_000)])
        self.assertEqual(tracks.next_tier('active_time', 1_500 * 3_600).threshold, 2_000 * 3_600)
        self.assertEqual(tracks.next_tier('workouts', 1_500).threshold, 2_000)
        self.assertEqual(tracks.next_tier('personal_bests', 50).threshold, 75)
        self.assertEqual(tracks.next_tier('consistency', 150).threshold, 200)
        self.assertEqual(tracks.next_tier('active_time', 10 * 3_600).threshold, 24 * 3_600)
        self.assertEqual(tracks.next_tier('workouts', 10).threshold, 50)
        self.assertEqual(tracks.next_tier('personal_bests', 1).threshold, 5)
        self.assertEqual(tracks.next_tier('consistency', 4).threshold, 10)
        self.assertEqual(tracks.next_tier('consistency', 150).label, 'Solar flare')

    def test_years_active_is_one_anniversary_at_a_time(self):
        self.assertEqual([t.threshold for t in tracks.tiers_for('years_active', 3.9)], [1, 2, 3])
        self.assertEqual(tracks.next_tier('years_active', 3).threshold, 4)

    def test_journey_catalog_levels_and_last_level_multiple_tail(self):
        landmarks = tracks.tiers_for('journey', tracks.JOURNEY_LANDMARKS[-1][1])
        self.assertEqual(landmarks[-1].label, 'To the Moon')
        moon = tracks.JOURNEY_LANDMARKS[-1][1]
        moon_tiers = tracks.tiers_for('journey', moon)
        self.assertEqual((moon_tiers[-1].rank, moon_tiers[-1].label), (11, 'To the Moon'))
        next_after_moon = tracks.next_tier('journey', moon)
        self.assertEqual((next_after_moon.rank, next_after_moon.threshold, next_after_moon.label),
                         (12, 2 * moon, 'To the Moon ×2'))
        next_after_two = tracks.next_tier('journey', 2 * moon)
        self.assertEqual((next_after_two.rank, next_after_two.threshold, next_after_two.label),
                         (13, 3 * moon, 'To the Moon ×3'))

    def test_climbing_and_lifting_equivalence_tails(self):
        edge = tracks.CLIMBING_LEVELS[-1][1]
        self.assertEqual([t.label for t in tracks.tiers_for('climbing', 3 * edge)][-3:],
                         ['Edge of space', 'Edge of space ×2', 'Edge of space ×3'])
        self.assertEqual(tracks.next_tier('climbing', 3 * edge).threshold, 4 * edge)
        self.assertEqual([t.label for t in tracks.tiers_for('lifted', 300_000)],
                         ['A grand piano', 'A car', 'An elephant', 'A school bus',
                          'A loaded semi truck', 'A blue whale', 'Statue of Liberty'])
        self.assertEqual(tracks.next_tier('lifted', 300_000).threshold, 396_893)

    def test_sport_distance_and_lift_session_tails(self):
        self.assertEqual([t.label for t in tracks.tiers_for('sport:run', 50_000)],
                         ['First run', 'First mile', '5K', '10K', 'Half marathon', 'Marathon'])
        self.assertEqual(tracks.next_tier('sport:run', 50_000).threshold, 80_467)
        self.assertEqual(tracks.next_tier('sport:ride', 200_000).threshold, 402_336)
        self.assertEqual(tracks.next_tier('sport:walk-hike', 42_195).threshold, 80_467)
        self.assertEqual(tracks.next_tier('sport:swim', 20_000).threshold, 33_796)
        self.assertEqual([t.threshold for t in tracks.tiers_for('sport:lift', 100)], [1, 5, 10, 25, 50, 100])
        self.assertEqual(tracks.next_tier('sport:lift', 100).threshold, 200)

    def test_early_levels_are_quiet_and_sport_firsts_are_activity_triggered(self):
        self.assertTrue(tracks.is_quiet_level('workouts', 1))
        self.assertTrue(tracks.is_quiet_level('sport:ride', 2))
        self.assertFalse(tracks.is_quiet_level('sport:ride', 3))
        self.assertTrue(tracks.is_quiet_level('lifted', 1))
        self.assertFalse(tracks.is_quiet_level('lifted', 2))
        self.assertEqual(tracks.level_trigger('sport:run', 1), 'first_activity')
        self.assertEqual(tracks.level_trigger('sport:run', 2), None)

    def test_quiet_levels_are_hidden_from_friend_moments_but_remain_owner_tiers(self):
        first_run = {'sport': 'run', 'trigger': 'first_activity', 'quiet': True}
        self.assertIsNone(api_achievements._sport_code(first_run))
        self.assertEqual(api_achievements._sport_code(first_run, include_quiet=True), 'sport:run')
        legacy_first_run = {'sport': 'run'}
        self.assertIsNone(api_achievements._sport_code(legacy_first_run),
                          'the current catalog also hides older First rows from friend moments')
        quiet_level = api_achievements._tier({
            'code': 'trackt:workouts:1.0', 'kind': 'track',
            'details': {'track': 'workouts', 'threshold': 1, 'big': False, 'quiet': True},
            'title': 'First workout', 'rank': 1001,
        }, 'workouts', 'metric')
        self.assertTrue(quiet_level['quiet'])
        self.assertFalse(quiet_level['big'], 'the friend-feed big-tier filter omits this award')

    def test_display_units_are_converted_only_at_the_boundary(self):
        miles, unit = tracks.display_value('journey', 1_609.344, 'imperial')
        self.assertAlmostEqual(miles, 1)
        self.assertEqual(unit, 'mi')
        self.assertEqual(tracks.display_value('lifted', 10, 'metric'), (10, 'kg'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
