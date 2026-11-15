import importlib.util
import pathlib
import unittest


MODULE = pathlib.Path(__file__).parent / 'native-ui' / 'startup_timing.py'
SPEC = importlib.util.spec_from_file_location('startup_timing', MODULE)
startup_timing = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(startup_timing)


class StartupTimingTests(unittest.TestCase):
    def setUp(self):
        self.timing = {
            'performanceTimeOriginEpochMs': 1_000_000,
            'webViewReadyPerfMs': 100,
            'indexLoadedPerfMs': 240,
            'apiMeDonePerfMs': 310,
            'firstUsefulRenderPerfMs': 510,
            'metricsSnapshotPerfMs': 560,
        }

    def test_phase_durations_use_launch_and_monotonic_web_timeline(self):
        phases = startup_timing.phase_durations(self.timing, 9_999_000, 620)
        self.assertEqual(phases, {
            'launch_to_webview_ready_ms': 160.0,
            'webview_ready_to_index_loaded_ms': 140.0,
            'index_loaded_to_api_me_done_ms': 70.0,
            'api_me_done_to_first_useful_ms': 200.0,
            'total_launch_to_first_useful_ms': 570.0,
        })

    def test_phase_durations_ignore_simulator_runner_wall_clock_skew(self):
        phases = startup_timing.phase_durations(self.timing, -50_000_000, 620)
        self.assertEqual(phases['launch_to_webview_ready_ms'], 160.0)

    def test_phase_durations_reject_missing_or_non_monotonic_marks(self):
        with self.assertRaises(KeyError):
            startup_timing.phase_durations({}, 1_000_050, 620)
        self.timing['firstUsefulRenderPerfMs'] = 300
        with self.assertRaisesRegex(ValueError, 'not monotonic'):
            startup_timing.phase_durations(self.timing, 1_000_050, 620)

    def test_summary_labels_fictional_fixture_and_contains_all_phases(self):
        phases = startup_timing.phase_durations(self.timing, 1_000_050, 620)
        text = startup_timing.summary_markdown([{'device': 'iPhone 17', 'phases': phases}])
        self.assertIn('fictional Me fixture', text)
        self.assertIn('not production network measurements', text)
        self.assertIn('570.0 ms', text)


if __name__ == '__main__':
    unittest.main()
