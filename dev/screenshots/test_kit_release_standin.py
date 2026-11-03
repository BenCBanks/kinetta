"""Regression checks for the disposable screenshot-only Kit gate fixture."""
import json
import os
import tempfile
import unittest
from pathlib import Path

from kit_release_standin import render_report, write_report

ROOT = Path(__file__).resolve().parents[2]
SCREENSHOTS = ROOT / "dev" / "screenshots"
REPORT_NAME = "".join(("kit-release", ".standin.json"))


def fixture_references_outside_screenshots():
    violations = []
    ignored = {".git", ".venv", "node_modules", "__pycache__"}
    for folder, dirs, files in os.walk(ROOT):
        dirs[:] = [name for name in dirs if name not in ignored]
        for name in files:
            path = Path(folder) / name
            if SCREENSHOTS in path.resolve().parents:
                continue
            if REPORT_NAME in name:
                violations.append(path.relative_to(ROOT).as_posix())
                continue
            try:
                if REPORT_NAME in path.read_text(errors="ignore"):
                    violations.append(path.relative_to(ROOT).as_posix())
            except OSError:
                continue
    return violations


class KitScreenshotStandinTests(unittest.TestCase):
    def test_report_uses_runtime_fingerprint_callable(self):
        expected = "a" * 64
        report = render_report(lambda: expected)
        self.assertEqual(report["candidate_fingerprint"], expected)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / REPORT_NAME
            write_report(target, lambda: expected)
            self.assertEqual(json.loads(target.read_text())["candidate_fingerprint"], expected)

    def test_fixture_disclaims_real_evaluation_results(self):
        template = json.loads((SCREENSHOTS / REPORT_NAME).read_text())
        self.assertTrue(template["fixture_only"])
        self.assertFalse(template["real_evaluation_performed"])
        self.assertIn("synthetic placeholders", template["fixture_note"])
        self.assertIsNone(template["evaluation_results"])
        self.assertIsNone(template["evidence"])
        self.assertIn("No real evaluation was run or claimed", template["fixture_note"])

    def test_fixture_is_referenced_only_under_screenshots(self):
        self.assertEqual(fixture_references_outside_screenshots(), [])

    def test_screenshot_compose_enables_only_the_disposable_gate(self):
        compose = (SCREENSHOTS / "compose.standin.yml").read_text()
        standin = (SCREENSHOTS / "standin.py").read_text()
        self.assertIn('KINETTA_KIT_ENABLED: "1"', compose)
        self.assertIn("/kit-screenshot-runtime/" + REPORT_NAME, compose)
        self.assertIn("GEMINI_API_KEY: placeholder-for-screenshots", compose)
        self.assertIn('ANTHROPIC_API_KEY: ""', compose)
        self.assertIn("ai_release.kit_fingerprint", standin)
        self.assertIn("ai_release.kit_enabled()", standin)


if __name__ == "__main__":
    unittest.main()
