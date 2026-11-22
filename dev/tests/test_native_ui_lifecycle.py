"""A stalled stop cannot allow fixture replacement in a still-running Simulator app."""
import importlib.util
import subprocess
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('native_ui_lifecycle', Path(__file__).parent/'native-ui/lifecycle.py')
lifecycle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lifecycle)


class LifecycleTests(unittest.TestCase):
    def exercise(self, stop_timeout=False, recovered=False, failure=None, already_stopped=False):
        calls = []
        def sim(command, *args, **kwargs):
            calls.append((command, args, kwargs))
            if command == failure:
                raise subprocess.CalledProcessError(1, command, stderr='simulator operation failed')
            if command == 'terminate' and already_stopped:
                raise subprocess.CalledProcessError(3, command, stderr='Process is not running')
            if command == 'terminate' and stop_timeout:
                raise subprocess.TimeoutExpired(command, 10)
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
        self.assertEqual([c[0] for c in calls], ['terminate', 'shutdown', 'erase', 'boot', 'bootstatus', 'ui', 'status_bar', 'prepare'])
        for _, _, kwargs in calls[:-1]:
            self.assertTrue(kwargs.get('check', True), 'Recovery failure must abort the fixture update')
        self.assertEqual(calls[1][1], ('all',), 'A stalled terminate shuts down all disposable simulator processes')
        self.assertEqual(calls[4][1], ('fictional-device', '-b'))
        self.assertLess(sum(c[2]['timeout'] for c in calls[:7]), 300, 'Recovery commands fit under five minutes')
        self.assertTrue(all(c[2]['timeout'] <= 160 for c in calls[:7]), 'No recovery command can block for five minutes')

    def test_only_one_recovery_per_device(self):
        with self.assertRaisesRegex(RuntimeError, 'fixture was not updated'):
            self.exercise(stop_timeout=True, recovered=True)

    def test_restart_errors_abort_before_fixture_update(self):
        for command in ['shutdown', 'erase', 'boot', 'bootstatus', 'ui', 'status_bar']:
            with self.subTest(command=command), self.assertRaises(subprocess.CalledProcessError):
                self.exercise(stop_timeout=True, failure=command)

    def test_failed_termination_also_aborts_before_fixture_update(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.exercise(failure='terminate')

    def test_already_stopped_is_success_and_does_not_restart(self):
        result, calls = self.exercise(already_stopped=True)
        self.assertFalse(result)
        self.assertEqual([c[0] for c in calls], ['terminate', 'prepare'])

    def test_each_attempt_creates_a_unique_simulator(self):
        created = []
        def sim(command, *args, **kwargs):
            created.append((command, args, kwargs))
            return args[0] if command == 'create' else ''
        device={'identifier':'com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro'}
        runtime={'identifier':'com.apple.CoreSimulator.SimRuntime.iOS-27-2'}
        first = lifecycle.create_fresh_sim(sim, device, runtime)
        second = lifecycle.create_fresh_sim(sim, device, runtime)
        self.assertNotEqual(first, second)
        self.assertEqual([row[0] for row in created], ['shutdown','create','shutdown','create'])
        self.assertEqual(created[0][1], ('all',)); self.assertEqual(created[0][2]['timeout'], 20)
        self.assertEqual(created[2][1], ('all',)); self.assertEqual(created[2][2]['timeout'], 20)
        self.assertEqual([row[1][1:] for row in created if row[0]=='create'], [(device['identifier'],runtime['identifier'])]*2)

    def test_failed_shutdown_all_prevents_reusing_or_creating_a_device(self):
        calls=[]
        def sim(command,*args,**kwargs):
            calls.append(command)
            if command=='shutdown': raise subprocess.TimeoutExpired(command,20)
            return 'unexpected'
        with self.assertRaises(subprocess.TimeoutExpired):
            lifecycle.create_fresh_sim(sim, {'identifier':'fictional-device'}, {'identifier':'fictional-runtime'})
        self.assertEqual(calls,['shutdown'])

    def test_repeated_stop_timeout_fails_immediately(self):
        import time
        started = time.monotonic()
        with self.assertRaisesRegex(RuntimeError, 'termination timed out again'):
            self.exercise(stop_timeout=True, recovered=True)
        self.assertLess(time.monotonic() - started, 1, 'The forced simulator hang fixture fails immediately')

    def test_prior_recovery_does_not_restart_a_successful_stop(self):
        result, calls = self.exercise(recovered=True)
        self.assertTrue(result)
        self.assertEqual([c[0] for c in calls], ['terminate', 'prepare'])


if __name__ == '__main__':
    unittest.main()
