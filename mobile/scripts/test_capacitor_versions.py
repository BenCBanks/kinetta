"""Keep the JavaScript shell and Swift runtime on the fixed iOS bridge release."""
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
FIXED = (8, 6, 3)


class CapacitorVersions(unittest.TestCase):
    def test_manifest_and_lock_use_the_same_fixed_release(self):
        manifest = json.loads((ROOT / 'package.json').read_text())
        packages = json.loads((ROOT / 'package-lock.json').read_text())['packages']
        expected = manifest['dependencies']['@capacitor/ios']
        self.assertRegex(expected, r'^\d+\.\d+\.\d+$', 'Pin a release, not a floating range')
        self.assertGreaterEqual(tuple(map(int, expected.split('.'))), FIXED,
                                'Earlier releases contain the iOS bridge advisory')
        for name, section in [('@capacitor/core', 'dependencies'),
                              ('@capacitor/ios', 'dependencies'),
                              ('@capacitor/cli', 'devDependencies')]:
            with self.subTest(package=name):
                self.assertEqual(manifest[section][name], expected)
                self.assertEqual(packages[''][section][name], expected)
                locked = packages['node_modules/' + name]
                self.assertEqual(locked['version'], expected)
                self.assertTrue(locked['integrity'].startswith('sha512-'))
                self.assertTrue(locked['resolved'].endswith('-' + expected + '.tgz'))

    def test_swift_runtime_matches_the_npm_ios_release(self):
        expected = json.loads((ROOT / 'package.json').read_text())['dependencies']['@capacitor/ios']
        package = (ROOT / 'ios/App/CapApp-SPM/Package.swift').read_text()
        pins = re.findall(r'\.package\(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "([^"]+)"\)', package)
        self.assertEqual(pins, [expected], 'cap sync must keep the native bridge on the same fixed release')


if __name__ == '__main__':
    unittest.main()
