"""A stalled stop cannot allow fixture replacement in a still-running Simulator app."""
import importlib.util
import subprocess
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('native_ui_lifecycle', Path(__file__).parent/'native-ui/lifecycle.py')
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


class LifecycleTests(unittest.TestCase):
    def exercise(self, stop_timeout=False, recovered=False, failure=None):
        calls = []
        def sim(command, *args, **kwargs):
            calls.append((command, args, kwargs))
            if command == failure:
                raise subprocess.CalledProcessError(1, command)
            if command == 'terminate' and stop_timeout:
                raise subprocess.TimeoutExpired(command, 20)
            return ''
        result = lifecycle.stop_for_fixture(sim, 'fictional-device', 'dark', recovered)
        calls.append(('prepare', (), {}))
        return result, calls

    def test_successful_stop_does_not_restart(self):
        result, calls = self.exercise()
        self.assertFalse(result)
        self.assertEqual([c[0] for c in calls], ['terminate', 'prepare'])

    def test_timeout_requires_checked_restart_before_fixture_update(self):
        result, calls = self.exercise(stop_timeout=True)
        self.assertTrue(result)
        self.assertEqual([c[0] for c in calls], ['terminate', 'shutdown', 'boot', 'bootstatus', 'ui', 'status_bar', 'prepare'])
        for _, _, kwargs in calls[:-1]:
            self.assertTrue(kwargs.get('check', True), 'Recovery failure must abort the fixture update')
        self.assertEqual(calls[4][1], ('fictional-device', 'appearance', 'dark'))

    def test_only_one_recovery_per_device(self):
        with self.assertRaisesRegex(RuntimeError, 'fixture was not updated'):
            self.exercise(stop_timeout=True, recovered=True)

    def test_restart_errors_abort_before_fixture_update(self):
        for command in ['shutdown', 'boot', 'bootstatus', 'ui', 'status_bar']:
            with self.subTest(command=command), self.assertRaises(subprocess.CalledProcessError):
                self.exercise(stop_timeout=True, failure=command)

    def test_failed_termination_also_aborts_before_fixture_update(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.exercise(failure='terminate')

    def test_prior_recovery_does_not_restart_a_successful_stop(self):
        result, calls = self.exercise(recovered=True)
        self.assertTrue(result)
        self.assertEqual([c[0] for c in calls], ['terminate', 'prepare'])


if __name__ == '__main__':
    unittest.main()
