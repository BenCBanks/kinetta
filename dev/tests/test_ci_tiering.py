#!/usr/bin/env python3
"""Guard the Draft/Ready CI contract without needing a GitHub runner."""
from pathlib import Path
from collections import Counter
import os
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / ".github/workflows/tests.yml").read_text()
CHANGED_SCREENS = (ROOT / "dev/tests/changed.sh").read_text()


class CITieringTests(unittest.TestCase):
    def test_drafts_keep_backend_and_spacing_and_run_changed_screen_checks(self):
        quick = WORKFLOW.split("\n  quick:\n", 1)[1].split("\n  backend:\n", 1)[0]
        self.assertIn("github.event.pull_request.draft == true", quick)
        self.assertIn("dev/tests/changed.sh", quick)
        self.assertIn("fetch-depth: 0", quick)

        backend = WORKFLOW.split("\n  backend:\n", 1)[1].split("\n  browser_shards:\n", 1)[0]
        self.assertNotIn("\n    if:", backend)
        self.assertIn("  spacing:\n", WORKFLOW)

    def test_draft_shards_keep_limits_isolation_and_required_spacing(self):
        quick = WORKFLOW.split("\n  quick:\n", 1)[1].split("\n  backend:\n", 1)[0]
        self.assertIn("shard: [1, 2, 3]", quick)
        self.assertIn("fail-fast: false", quick)
        self.assertIn("timeout-minutes: 15", quick)
        self.assertIn("CHANGED_UI_SHARD: ${{ matrix.shard }}/3", quick)
        self.assertIn("KINETTA_CHANGED_SPACING: '0'", quick)
        self.assertIn("docker compose -p kinettatest up -d", quick)
        self.assertIn("docker compose -p kinettatest down -v", quick)
        self.assertIn("scope: tests-quick-${{ matrix.shard }}", quick)
        features = quick.split("- name: Check aggregate Features portal", 1)[1].split("- name: Server log", 1)[0]
        self.assertIn("if: matrix.shard == 1", features)
        self.assertIn("admin_features_ui.cjs", features)
        self.assertIn("feature_collection_ui.cjs", features)
        spacing = WORKFLOW.split("\n  spacing:\n", 1)[1]
        self.assertNotIn("\n    if:", spacing)
        self.assertIn("node dev/tests/test_spacing_dom.cjs", spacing)
        self.assertIn("node dev/tests/spacing_audit.cjs\n", spacing)
        self.assertIn("node dev/tests/loading_audit.cjs", spacing)
        gate = WORKFLOW.split("\n  tests:\n", 1)[1].split("\n  spacing:\n", 1)[0]
        self.assertIn('"$SPACING_RESULT"', gate)
        self.assertIn('test "$result" = success', gate)
        self.assertIn('${KINETTA_CHANGED_SPACING:-1}', CHANGED_SCREENS)

    def test_changed_screen_shards_run_every_suite_exactly_once(self):
        def scheduled(paths, shard):
            result = subprocess.run(
                ["bash", "dev/tests/changed.sh", "--list-tests", *paths], cwd=ROOT,
                # Backend checkouts need not fetch origin/main. Explicit paths must
                # plan the same coverage even when no diff base is available.
                env={**os.environ, "CHANGED_UI_SHARD": shard,
                     "CHANGED_BASE": "refs/heads/zz_test_unavailable_ci_base"}, text=True, capture_output=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stderr, "", "explicit path planning must not attempt Git diffs")
            return [line[4:] for line in result.stdout.splitlines() if line.startswith("UI: ")]

        all_paths = subprocess.check_output(["git", "ls-files", "app/static"], cwd=ROOT, text=True).splitlines()
        for paths in (["app/static/pages.js", "app/static/style.css"],
                      ["app/static/social.js", "app/static/recaps.js"], all_paths):
            with self.subTest(paths=paths[:2]):
                serial = scheduled(paths, "1/1")
                self.assertTrue(serial)
                self.assertEqual(len(serial), len(set(serial)), "serial dispatcher deduplicates contracts")
                shards = [scheduled(paths, f"{n}/3") for n in range(1, 4)]
                self.assertEqual(Counter(item for shard in shards for item in shard), Counter(serial))
                self.assertTrue(all(shards), "all three runners receive work")
                self.assertEqual(max(map(len, shards))-min(map(len, shards)), 1 if len(serial)%3 else 0)
        self.assertIn("loading_audit.cjs", scheduled(["app/static/pages.js"], "1/1"))
        for invalid in ("0/3", "4/3", "one", "1/0"):
            result = subprocess.run(["bash", "dev/tests/changed.sh", "--list-tests", "app/static/pages.js"],
                                    cwd=ROOT, env={**os.environ, "CHANGED_UI_SHARD": invalid}, capture_output=True)
            self.assertNotEqual(result.returncode, 0, invalid)

    def test_a_selected_suite_failure_still_fails_its_shard(self):
        # Exercise the real dispatcher without starting a browser/API fixture.
        dispatcher = CHANGED_SCREENS.split("declare -A ran_ui=()", 1)[1].split("\nfor group in", 1)[0]
        script = "set -euo pipefail\ndeclare -A ran_ui=()\n" + dispatcher
        script += "\nnode() { return 23; }\nrun_ui fictional_failure.cjs\n"
        result = subprocess.run(["bash", "-c", script], cwd=ROOT, env={**os.environ,
                                "shard_index": "1", "shard_count": "3", "list_tests": "0",
                                "ui_shard": "1/3", "browser": "unused"}, capture_output=True)
        self.assertEqual(result.returncode, 23, result.stderr)

    def test_loading_audit_keeps_its_fixtures_when_duplicate_spacing_is_disabled(self):
        dispatcher = CHANGED_SCREENS.split("declare -A ran_ui=()", 1)[1].split("\nfor group in", 1)[0]
        script = "set -euo pipefail\ndeclare -A ran_ui=()\n" + dispatcher
        script += r'''
python3() {
  [[ "$*" == dev/tests/spacing_prepare.py ]] || return 91
  printf 'prepare\n' >> "$events"
  [[ "$preparation_fails" == 0 ]] || return 27
  printf '{}' > "$KINETTA_SPACING_FIXTURES"
}
node() {
  [[ "$*" == dev/tests/loading_audit.cjs ]] || return 92
  [[ -f "$KINETTA_SPACING_FIXTURES" ]] || return 93
  [[ "$KINETTA_LOADING_SCREENS" == Home,Progress,Nutrition\ day,Me ]] || return 94
  [[ "$KINETTA_LOADING_THEMES" == light,dark ]] || return 95
  printf 'audit\n' >> "$events"
}
run_ui loading_audit.cjs
run_ui loading_audit.cjs
'''
        cases = [("0", "1", "0", "0", 0, ["prepare", "audit"]),
                 ("1", "1", "0", "0", 0, ["audit"]),
                 ("0", "2", "0", "0", 0, []),
                 ("0", "1", "1", "0", 0, []),
                 ("0", "1", "0", "1", 27, ["prepare"])]
        for spacing, shard, listing, fails, code, expected in cases:
            with self.subTest(spacing=spacing, shard=shard, listing=listing, fails=fails), tempfile.TemporaryDirectory() as tmp:
                fixture, events = Path(tmp)/"fixtures.json", Path(tmp)/"events"
                if spacing == "1":
                    fixture.write_text("{}")  # Existing spacing preparation remains reused.
                result = subprocess.run(["bash", "-c", script], cwd=ROOT, text=True, capture_output=True,
                                        env={**os.environ, "shard_index": shard, "shard_count": "3",
                                             "ui_shard": f"{shard}/3", "list_tests": listing, "browser": "unused",
                                             "KINETTA_CHANGED_SPACING": spacing, "preparation_fails": fails,
                                             "KINETTA_SPACING_FIXTURES": str(fixture), "events": str(events)})
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertEqual(events.read_text().splitlines() if events.exists() else [], expected)

    def test_full_browser_shards_are_ready_only(self):
        browser = WORKFLOW.split("\n  browser_shards:\n", 1)[1].split("\n  reviewer_integration:\n", 1)[0]
        self.assertIn("github.event.pull_request.draft == false", browser)
        reviewer = WORKFLOW.split("\n  reviewer_integration:\n", 1)[1].split("\n  tests:\n", 1)[0]
        self.assertIn("github.event.pull_request.draft == false", reviewer)

    def test_draft_core_screen_checks_seed_explore_before_lazy_route(self):
        fixture_setup = CHANGED_SCREENS.split('case "$group" in\n', 1)[1].split("\n  esac", 1)[0]
        core_setup = fixture_setup.split("core)", 1)[1].split("food)", 1)[0]
        test_dispatch = CHANGED_SCREENS.split('case "$group" in\n', 2)[2].split("\n  esac", 1)[0]
        core_tests = test_dispatch.split("core)", 1)[1].split("assets)", 1)[0]
        self.assertIn("python3 dev/tests/explore_fixture.py", core_setup)
        self.assertIn("lazy_route_ui.cjs", core_tests)

    def test_aggregate_gate_requires_each_tier_and_accepts_only_intended_skips(self):
        gate = WORKFLOW.split("\n  tests:\n", 1)[1].split("\n  spacing:\n", 1)[0]
        for result in ("QUICK_RESULT", "CHANGED_SCREEN_MAP_RESULT", "BACKEND_RESULT", "BROWSER_SHARDS_RESULT", "REVIEWER_INTEGRATION_RESULT", "SPACING_RESULT"):
            self.assertIn(result, gate)
        self.assertIn('success|skipped', gate)
        self.assertIn('test "$result" = success', gate)


if __name__ == "__main__":
    unittest.main()
