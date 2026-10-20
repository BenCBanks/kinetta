"""Configuration contracts needed for iOS to launch the protected-data recovery task."""
import plistlib
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / 'ios/App/App'


class HealthRecoveryConfig(unittest.TestCase):
    def test_background_identifier_and_modes(self):
        info = plistlib.loads((APP / 'Info.plist').read_bytes())
        code = (APP / 'HealthBackgroundSync.swift').read_text()
        identifier = re.search(r'static let refreshIdentifier = "([^"]+)"', code).group(1)
        self.assertIn(identifier, info['BGTaskSchedulerPermittedIdentifiers'])
        self.assertIn('fetch', info['UIBackgroundModes'])
        self.assertIn('location', info['UIBackgroundModes'])
        entitlement = plistlib.loads((APP / 'App.entitlements').read_bytes())
        self.assertTrue(entitlement['com.apple.developer.healthkit.background-delivery'])

    def test_registered_before_launch_sync(self):
        launch = (APP / 'AppDelegate.swift').read_text().split('return true')[0]
        self.assertLess(launch.index('HealthBackgroundSync.shared.registerRecovery()'),
                        launch.index('HealthBackgroundSync.shared.start()'))


if __name__ == '__main__':
    unittest.main()
