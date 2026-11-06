"""Pure tier boundary and endless-tail tests; no database or server needed."""
import unittest

from app import achievement_tracks as tracks


class AchievementTrackRules(unittest.TestCase):
    def test_fixed_tracks_and_step_tails(self):
        cases = {
            'consistency': (150, [4, 10, 20, 52, 100, 150]),
            'workouts': (1_500, [10, 50, 100, 250, 500, 1_000, 1_500]),
            'personal_bests': (50, [1, 5, 10, 25, 50]),
        }
        for code, (value, expected) in cases.items():
            with self.subTest(code=code):
                self.assertEqual([tier.threshold for tier in tracks.tiers_for(code, value)],
                                 [float(n) for n in expected])
        active = tracks.tiers_for('active_time', 1_500 * 3_600)
        self.assertEqual([tier.threshold for tier in active],
                         [n * 3_600 for n in (10, 50, 100, 250, 500, 1_000, 1_500)])
        self.assertEqual(tracks.next_tier('active_time', 1_500 * 3_600).threshold, 2_000 * 3_600)
        self.assertEqual(tracks.next_tier('workouts', 1_500).threshold, 2_000)
        self.assertEqual(tracks.next_tier('personal_bests', 50).threshold, 75)
        self.assertEqual(tracks.next_tier('consistency', 150).threshold, 200)
        self.assertEqual(tracks.next_tier('active_time', 10 * 3_600).threshold, 50 * 3_600)
        self.assertEqual(tracks.next_tier('workouts', 10).threshold, 50)
        self.assertEqual(tracks.next_tier('personal_bests', 1).threshold, 5)
        self.assertEqual(tracks.next_tier('consistency', 4).threshold, 10)

    def test_years_active_is_one_anniversary_at_a_time(self):
        self.assertEqual([t.threshold for t in tracks.tiers_for('years_active', 3.9)], [1, 2, 3])
        self.assertEqual(tracks.next_tier('years_active', 3).threshold, 4)

    def test_journey_fixed_landmarks_world_and_moon_tail(self):
        landmarks = tracks.tiers_for('journey', tracks.JOURNEY_LANDMARKS[-1][1])
        self.assertEqual(landmarks[-1].label, 'Across Australia')
        first_world = tracks.tiers_for('journey', tracks.WORLD_M)[-1]
        self.assertEqual((first_world.rank, first_world.label),
                         (len(tracks.JOURNEY_LANDMARKS) + 1, 'Around the world ×1'))
        moon_tiers = tracks.tiers_for('journey', tracks.MOON_M)
        self.assertEqual((moon_tiers[-1].rank, moon_tiers[-1].label),
                         (16, 'To the Moon'))
        next_after_moon = tracks.next_tier('journey', tracks.MOON_M)
        self.assertEqual((next_after_moon.rank, next_after_moon.threshold, next_after_moon.label),
                         (17, 2 * tracks.MOON_M, 'To the Moon ×2'))
        next_after_two_moons = tracks.next_tier('journey', 2 * tracks.MOON_M)
        self.assertEqual((next_after_two_moons.rank, next_after_two_moons.threshold,
                          next_after_two_moons.label),
                         (18, 3 * tracks.MOON_M, 'To the Moon ×3'))

    def test_climbing_and_lifting_equivalence_tails(self):
        everest = tracks.EVEREST_M
        self.assertEqual([t.label for t in tracks.tiers_for('climbing', 3 * everest)],
                         ['¼ Everest', '½ Everest', '1 Everest', '2 Everests', '3 Everests'])
        self.assertEqual(tracks.next_tier('climbing', 3 * everest).threshold, 4 * everest)
        self.assertEqual([t.label for t in tracks.tiers_for('lifted', 300_000)],
                         ['A car', 'An elephant', 'A blue whale', '2 blue whales'])
        self.assertEqual(tracks.next_tier('lifted', 300_000).threshold, 450_000)

    def test_sport_distance_and_lift_session_tails(self):
        self.assertEqual([t.label for t in tracks.tiers_for('sport:run', 50_000)],
                         ['5K', '10K', 'half marathon', 'marathon'])
        self.assertEqual(tracks.next_tier('sport:run', 50_000).threshold, 84_390)
        self.assertEqual(tracks.next_tier('sport:ride', 200_000).threshold, 400_000)
        self.assertEqual(tracks.next_tier('sport:walk-hike', 42_195).threshold, 84_390)
        self.assertEqual(tracks.next_tier('sport:swim', 20_000).threshold, 40_000)
        self.assertEqual([t.threshold for t in tracks.tiers_for('sport:lift', 100)], [1, 5, 10, 25, 50, 100])
        self.assertEqual(tracks.next_tier('sport:lift', 100).threshold, 200)

    def test_display_units_are_converted_only_at_the_boundary(self):
        miles, unit = tracks.display_value('journey', 1_609.344, 'imperial')
        self.assertAlmostEqual(miles, 1)
        self.assertEqual(unit, 'mi')
        self.assertEqual(tracks.display_value('lifted', 10, 'metric'), (10, 'kg'))


if __name__ == '__main__':
    unittest.main(verbosity=2)
