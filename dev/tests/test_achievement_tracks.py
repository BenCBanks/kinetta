"""Pure tier boundary and endless-tail tests; no database or server needed."""
import math
import unittest

from app import achievement_tracks as tracks, api_achievements, milestones


class AchievementTrackRules(unittest.TestCase):
    def test_canonical_catalog_contains_the_reference_ladders_exactly(self):
        expected = {
            'consistency': ('weeks', ['Spark','Kindling','Steady flame','Bonfire','Campfire circle','Volcano',
                                      'Solar flare','North Star','Constellation','Galaxy'],
                            [4,10,20,52,100,150,200,250,300,350]),
            'years_active': ('years', ['First orbit','Comet','Three-peat','Olympiad','High five','Decade',
                                       'Silver jubilee','Golden jubilee','Century'],
                             [1,2,3,4,5,10,25,50,100]),
            'workouts': ('workouts', ['Seed','Sprout','Sapling','Young tree','Evergreen','Grove','Forest',
                                      'Old-growth forest'], [10,50,100,250,500,1000,1500,2000]),
            'active_time': ('hours', ['First ten hours','Round the clock','Four days moving','Six workweeks',
                                      'A season of effort','Half a working year','A working year',
                                      'Mastery (10,000 hours)'], [10,24,100,250,500,1000,2000,10000]),
            'journey': ('km', ['Marathon','Ironman 70.3','Ironman 140.6','Length of Britain','Across the US',
                               'Length of Africa','Around Australia','Around Earth','To the Moon'],
                        [42.195,113.137,226.274,1406.567,4506.163,8046.72,14484.096,40074.275,384399.861]),
            'climbing': ('m', ['Ben Nevis','Mount Fuji','Mont Blanc','Kilimanjaro','Denali','Aconcagua','Everest',
                               'Cruising altitude','Edge of the sky','Edge of space'],
                         [1345.1,3775.9,4807.9,5895.1,6190.5,6961,8849,10668,18897.6,100000]),
            'lifted': ('kg', ['A car','An elephant','A school bus','A loaded semi truck','A blue whale',
                              'Statue of Liberty','A jumbo jet','A heavy-lift rocket','Eiffel Tower','Titanic'],
                       [1497,5897,11340,36287,149685,204117,396893,2041166,9979032,52163123]),
            'personal_bests': ('records', ['First record','On a roll','Record keeper','Hall of fame','Record shelf',
                                           'Record library','Record constellation','Legend'],
                               [1,5,10,25,50,75,100,150]),
            'sport:run': ('km', ['5K','10K','Half marathon','Marathon','50-mile ultra','100 miles','250 miles',
                                 '500 miles','1,000 miles'], [5,10,21.0975,42.195,80.467,160.934,402.336,804.672,1609.344]),
            'sport:run:fastest': ('benchmarks', [name for name, _distance, _seconds in tracks.RUN_FASTEST_LEVELS],
                                  list(range(1, len(tracks.RUN_FASTEST_LEVELS) + 1))),
            'sport:ride': ('km', ['First 10 miles','25 miles','Metric century','Century','250 miles','500 miles',
                                  '1,000 miles','Coast to coast'], [16.093,40.234,100,160.934,402.336,804.672,
                                                                     1609.344,4506.163]),
            'sport:walk-hike': ('km', ['5K','10K','Half marathon','Marathon','50 miles','100 miles','250 miles',
                                       '500 miles','Appalachian Trail'],
                                [5,10,21.0975,42.195,80.467,160.934,402.336,804.672,3524.463]),
            'sport:swim': ('km', ['First mile','Ironman swim','Marathon swim (10K)','English Channel','50 miles',
                                  '100 miles','250 miles','500 miles'],
                           [1.609,3.862,10,33.796,80.467,160.934,402.336,804.672]),
            'sport:lift': ('sessions', ['First set','Warmed up','Ten sessions','Strong foundation','Strength cycle',
                                        'Power block','Iron habit','Strength hall'], [1,5,10,25,50,100,200,400]),
        }
        for sport, levels in tracks.SPORT_WORKOUT_LEVELS.items():
            expected[f'sport:{sport}:workouts'] = ('workouts', [name for name, _ in levels], [value for _, value in levels])
        for sport, levels in tracks.SPORT_LONGEST_LEVELS.items():
            expected[f'sport:{sport}:longest'] = ('km', [name for name, _ in levels], [value / 1000 for _, value in levels])
        catalog = api_achievements._level_catalog()['tracks']
        self.assertEqual(set(catalog), set(expected))
        for code, (unit, names, thresholds) in expected.items():
            with self.subTest(code=code):
                levels = catalog[code]['levels']
                self.assertEqual([level['name'] for level in levels], names)
                self.assertEqual([level['canonical_unit'] for level in levels], [unit] * len(levels))
                self.assertEqual([bool(level.get('quiet')) for level in levels],
                                 [tracks.is_quiet_level(code, rank) for rank in range(1, len(levels) + 1)])
                actual = [api_achievements._canonical_threshold(level) for level in levels]
                factor = 3600 if unit == 'hours' else 1000 if unit == 'km' else 1
                for got, want in zip(actual, thresholds):
                    self.assertAlmostEqual(got, want * factor, places=6)

    def test_api_catalog_tail_matches_worker_for_every_track_and_boundary(self):
        catalog = api_achievements._level_catalog()
        self.assertEqual(catalog['tail']['rule'], api_achievements._CATALOG_TAIL_RULE)
        self.assertEqual(len(catalog['tracks']), 22)

        for code, definition in catalog['tracks'].items():
            with self.subTest(code=code):
                fixed = definition['levels']
                base = api_achievements._canonical_threshold(fixed[-1])
                boundaries = [api_achievements._canonical_threshold(level) for level in fixed]
                boundaries.extend(base * multiple for multiple in (2, 3))
                for boundary in boundaries:
                    for value in (math.nextafter(boundary, -math.inf), boundary,
                                  math.nextafter(boundary, math.inf)):
                        api_levels = api_achievements._levels_through(definition, value)
                        worker_levels = tracks.tiers_for(code, value)
                        expected = [(tier.rank, tier.label, tier.threshold) for tier in worker_levels]
                        actual = [(level['rank'], level['name'], level['threshold']) for level in api_levels]
                        self.assertEqual(actual, expected, f'{code} at canonical value {value}')
                        next_level = tracks.next_tier(code, value)
                        if next_level:
                            self.assertEqual(next_level.rank, len(api_levels) + 1)
                            self.assertGreater(next_level.threshold, value)

                repeated = api_achievements._catalog_level(code, threshold=2 * base)
                self.assertEqual(repeated['rank'], len(fixed) + 1)
                self.assertEqual(repeated['name'], f"{fixed[-1]['name']} ×2")
                self.assertEqual(repeated['icon'], fixed[-1]['icon'])

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
                         [n * 3_600 for n in (10, 24, 100, 250, 500, 1_000)])
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
        self.assertEqual((moon_tiers[-1].rank, moon_tiers[-1].label), (9, 'To the Moon'))
        next_after_moon = tracks.next_tier('journey', moon)
        self.assertEqual((next_after_moon.rank, next_after_moon.threshold, next_after_moon.label),
                         (10, 2 * moon, 'To the Moon ×2'))
        next_after_two = tracks.next_tier('journey', 2 * moon)
        self.assertEqual((next_after_two.rank, next_after_two.threshold, next_after_two.label),
                         (11, 3 * moon, 'To the Moon ×3'))

    def test_climbing_and_lifting_equivalence_tails(self):
        edge = tracks.CLIMBING_LEVELS[-1][1]
        self.assertEqual([t.label for t in tracks.tiers_for('climbing', 3 * edge)][-3:],
                         ['Edge of space', 'Edge of space ×2', 'Edge of space ×3'])
        self.assertEqual(tracks.next_tier('climbing', 3 * edge).threshold, 4 * edge)
        self.assertEqual([t.label for t in tracks.tiers_for('lifted', 300_000)],
                         ['A car', 'An elephant', 'A school bus',
                          'A loaded semi truck', 'A blue whale', 'Statue of Liberty'])
        self.assertEqual(tracks.next_tier('lifted', 300_000).threshold, 396_893)

    def test_sport_distance_and_lift_session_tails(self):
        self.assertEqual([t.label for t in tracks.tiers_for('sport:run', 50_000)],
                         ['5K', '10K', 'Half marathon', 'Marathon'])
        self.assertEqual(tracks.next_tier('sport:run', 50_000).threshold, 80_467)
        self.assertEqual(tracks.next_tier('sport:ride', 200_000).threshold, 402_336)
        self.assertEqual(tracks.next_tier('sport:walk-hike', 42_195).threshold, 80_467)
        self.assertEqual(tracks.next_tier('sport:swim', 20_000).threshold, 33_796)
        self.assertEqual([t.threshold for t in tracks.tiers_for('sport:lift', 100)], [1, 5, 10, 25, 50, 100])
        self.assertEqual(tracks.next_tier('sport:lift', 100).threshold, 200)

    def test_phase_one_sport_tracks_count_rows_and_max_single_workout(self):
        self.assertEqual([tier.threshold for tier in tracks.tiers_for('sport:run:workouts', 128)], [1, 10, 50, 100])
        self.assertEqual(tracks.next_tier('sport:run:workouts', 128).threshold, 250)
        self.assertEqual([tier.label for tier in tracks.tiers_for('sport:run:longest', 42_195)],
                         ['5K outing', '10K day', 'Half-marathon day', 'Marathon day'])
        self.assertEqual(tracks.next_tier('sport:swim:longest', 3_862.68).threshold, 5_000)
        self.assertEqual(tracks.display_value('sport:run:longest', 80_467.2, 'imperial'), (50.0, 'mi'))

    def test_phase_one_count_exact_threshold_is_earned_and_advances(self):
        reached = tracks.tiers_for('sport:run:workouts', 10)
        self.assertEqual((reached[-1].rank, reached[-1].label, reached[-1].threshold),
                         (2, 'Training block', 10.0))
        next_level = tracks.next_tier('sport:run:workouts', 10)
        self.assertEqual((next_level.rank, next_level.label, next_level.threshold),
                         (3, 'Local circuit', 50.0))

    def test_fastest_run_uses_only_exact_recorded_efforts(self):
        class Cursor:
            def __init__(self, rows): self.rows = rows
            def execute(self, _query, _params):
                class Result:
                    def __init__(self, rows): self.rows = rows
                    def fetchall(self): return self.rows
                return Result(self.rows)

        rows = [
            {'activity_id': 1, 'sport': 'run', 'distance_m': 1_609.344, 'elapsed_s': 570},
            {'activity_id': 2, 'sport': 'run', 'distance_m': 1_600, 'elapsed_s': 1},
            {'activity_id': 3, 'sport': 'run', 'distance_m': 5_000, 'elapsed_s': 1_700},
        ]
        count, found = milestones._fastest_effort_facts(Cursor(rows), 7,
                                                         {1: {'id': 1}, 2: {'id': 2}, 3: {'id': 3}})
        self.assertEqual(count, 2)
        self.assertEqual(sorted(found), [1.0, 3.0])
        self.assertNotIn(2.0, found, 'a 9:30 mile does not earn the 8-minute tier')
        self.assertNotIn(4.0, found, 'a 28:20 5K does not earn the 25-minute tier')
        self.assertEqual(tracks.next_tier('sport:run:fastest', 3).label, 'Five-K club')

    def test_legacy_starters_are_readable_without_canonical_credit(self):
        self.assertEqual(sum(map(len, tracks.LEGACY_STARTER_LEVELS.values()))
                         + len(tracks.LEGACY_FIRST_ACTIVITY_LABELS), 19)

        old_run_mile = api_achievements._tier({
            'code': 'trackt:sport:run:1609.344', 'kind': 'track', 'rank': 1002,
            'title': 'First mile',
            'details': {'track':'sport:run','rank':2,'threshold':1609.344,'label':'First mile','unit':'m'},
        }, 'sport:run', 'metric')
        self.assertEqual(old_run_mile['label'], 'First mile')
        self.assertTrue(old_run_mile['legacy'])
        self.assertEqual(old_run_mile['rank'], 0)
        self.assertNotIn('trigger', old_run_mile)
        self.assertEqual(api_achievements._levels_through(
            api_achievements._level_catalog()['tracks']['sport:run'], 1609.344), [])
        self.assertEqual(tracks.next_tier('sport:run', 1609.344).label, '5K')

        old_starter = api_achievements._tier({
            'code': 'track:workouts:1', 'kind': 'track', 'rank': 1001,
            'title': 'First workout',
            'details': {'track':'workouts','rank':1,'threshold':1,'label':'First workout','unit':'workouts'},
        }, 'workouts', 'metric')
        self.assertEqual(old_starter['rank'], 0)
        self.assertTrue(old_starter['legacy'])
        history = api_achievements._legacy_history_tiers('workouts', [(1, {
            'kind':'track','activity_id':123,'day':'2026-01-02',
        })], {})
        self.assertEqual(history, [{
            'rank':0,'name':'First workout','threshold':1.0,'day':'2026-01-02',
            'activity_id':None,'date_source':'legacy','legacy':True,
        }])

        first_activity = api_achievements._tier({
            'code':'sport:run:first','kind':'sport','rank':20,'title':'First run on Kinetta',
            'details':{'sport':'run','trigger':'first_activity','quiet':True},
        }, 'sport:run', 'metric')
        self.assertEqual((first_activity['label'],first_activity['rank']),('First run',0))
        self.assertTrue(first_activity['legacy'])
        self.assertNotIn('trigger',first_activity)

    def test_new_running_catalogue_first_tier_is_5k(self):
        self.assertEqual([(tier.rank, tier.label, tier.threshold)
                          for tier in tracks.tiers_for('sport:run', 5_000)], [(1, '5K', 5_000.0)])
        self.assertIsNone(tracks.level_trigger('sport:run', 1))

    def test_legacy_first_activity_rows_are_quiet_and_canonical_levels_keep_quiet_window(self):
        self.assertTrue(tracks.is_quiet_level('workouts', 1))
        self.assertTrue(tracks.is_quiet_level('sport:ride', 2))
        self.assertFalse(tracks.is_quiet_level('sport:ride', 3))
        self.assertTrue(tracks.is_quiet_level('lifted', 1))
        self.assertFalse(tracks.is_quiet_level('lifted', 2))
        self.assertEqual(tracks.level_trigger('sport:run', 1), None)
        self.assertEqual(tracks.level_trigger('sport:run', 2), None)

    def test_quiet_levels_are_hidden_from_friend_moments_but_remain_owner_tiers(self):
        first_run = {'sport': 'run', 'trigger': 'first_activity', 'quiet': True}
        self.assertIsNone(api_achievements._sport_code(first_run))
        self.assertEqual(api_achievements._sport_code(first_run, include_quiet=True), 'sport:run')
        legacy_first_run = {'sport': 'run', 'quiet': True, 'trigger': 'first_activity'}
        self.assertIsNone(api_achievements._sport_code(legacy_first_run),
                          'the saved prior first-activity row stays quiet in friend moments')
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
