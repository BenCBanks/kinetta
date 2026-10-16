"""TestFlight distribution checks against a stand-in App Store Connect; no Apple requests."""
import importlib.util
import io
import json
import os
from pathlib import Path
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

spec = importlib.util.spec_from_file_location("distribute", Path(__file__).with_name("distribute-beta.py"))
distribute = importlib.util.module_from_spec(spec)
spec.loader.exec_module(distribute)

ENV = {"RUNNER_TEMP": "/tmp", "KEY_ID": "private-key-id", "ISSUER": "private-issuer", "BUILD_NUMBER": "250",
       "WHAT_TO_TEST": "Add Track recording (#110)\n\nLonger private description"}


class FakeAppStore:
    """Answers the handful of requests the script makes and records the writes."""

    def __init__(self, states=("PROCESSING", "VALID"), groups=None, review=201, localizations=()):
        self.states, self.writes, self.polls = list(states), [], 0
        self.groups = groups if groups is not None else [
            {"id": "private-beta", "attributes": {"name": "Beta", "isInternalGroup": False}},
            {"id": "private-family", "attributes": {"name": "Family", "isInternalGroup": True}}]
        self.review, self.localizations, self.submitted = review, list(localizations), False

    def __call__(self, request, timeout=None):
        url, method = urlsplit(request.full_url), request.get_method()
        path, query = url.path.removeprefix("/v1/"), parse_qs(url.query)
        body = json.loads(request.data) if request.data else None
        if method != "GET":
            self.writes.append((method, path, body))
        if path == "apps":
            assert query["filter[bundleId]"] == ["com.kinetta.app"]
            return self.reply({"data": [{"id": "private-app", "attributes": {"bundleId": "com.kinetta.app"}}]})
        if path == "betaGroups":
            return self.reply({"data": self.groups})
        if path == "builds":
            assert query["filter[version]"] == ["250"] and query["filter[app]"] == ["private-app"]
            self.polls += 1
            state = self.states.pop(0) if len(self.states) > 1 else self.states[0]
            if state is None:
                return self.reply({"data": []})
            return self.reply({"data": [{"id": "private-build", "attributes": {"processingState": state, "usesNonExemptEncryption": None}}]})
        if path == "builds/private-build/betaBuildLocalizations":
            return self.reply({"data": self.localizations})
        if path == "builds/private-build/betaAppReviewSubmission":
            return self.reply({"data": {"id": "x"} if self.submitted else None})
        if path == "betaAppReviewSubmissions" and self.review != 201:
            raise HTTPError(request.full_url, self.review, "private", {},
                            io.BytesIO(b'{"errors":[{"code":"STATE_ERROR","title":"Build cannot be submitted"}]}'))
        return self.reply({})

    @staticmethod
    def reply(data):
        return io.BytesIO(json.dumps(data).encode())


def run(store, **env):
    with patch.dict(os.environ, {**ENV, **env}), patch.object(distribute.preflight, "token", return_value="private-jwt"), \
            patch.object(distribute, "urlopen", side_effect=store), redirect_stdout(io.StringIO()) as output:
        code = distribute.main(sleep=lambda seconds: None)
    return code, output.getvalue()


class Distribution(unittest.TestCase):
    def test_waits_then_tests_reviews_and_adds_to_beta(self):
        store = FakeAppStore(states=(None, "PROCESSING", "VALID"))
        code, output = run(store)
        self.assertEqual(code, 0)
        self.assertEqual(store.polls, 3)
        steps = [(m, p) for m, p, _ in store.writes]
        self.assertEqual(steps, [("PATCH", "builds/private-build"), ("POST", "betaBuildLocalizations"),
                                 ("POST", "betaAppReviewSubmissions"), ("POST", "betaGroups/private-beta/relationships/builds")])
        self.assertEqual(store.writes[1][2]["data"]["attributes"], {"locale": "en-US", "whatsNew": "Add Track recording"})
        self.assertIn("Build 250 added", output)
        self.assertNotIn("private-", output)

    def test_existing_what_to_test_is_updated_and_internal_only_skips_review(self):
        store = FakeAppStore(states=("VALID",), localizations=[{"id": "loc1", "attributes": {"locale": "en-US"}}])
        code, _ = run(store, GROUPS="Family", WHAT_TO_TEST="")
        self.assertEqual(code, 0)
        steps = [(m, p) for m, p, _ in store.writes]
        self.assertIn(("PATCH", "betaBuildLocalizations/loc1"), steps)
        self.assertNotIn(("POST", "betaAppReviewSubmissions"), steps)
        self.assertIn(("POST", "betaGroups/private-family/relationships/builds"), steps)
        self.assertEqual(store.writes[1][2]["data"]["attributes"]["whatsNew"], "Latest Kinetta test build.")

    def test_missing_group_stops_before_waiting(self):
        store = FakeAppStore(groups=[])
        code, output = run(store)
        self.assertEqual((code, store.polls, store.writes), (1, 0, []))
        self.assertIn("No TestFlight group named Beta", output)

    def test_failed_processing_and_timeout_stop_with_a_reason(self):
        code, output = run(FakeAppStore(states=("INVALID",)))
        self.assertEqual(code, 1)
        self.assertIn("could not process build 250", output)
        store = FakeAppStore(states=("PROCESSING",))
        code, output = run(store)
        self.assertEqual(code, 1)
        self.assertEqual(store.polls, distribute.WAIT_MINUTES * 60 // distribute.POLL_SECONDS)
        self.assertIn("still processing", output)

    def test_review_already_submitted_is_fine_other_refusals_are_not(self):
        store = FakeAppStore(states=("VALID",), review=409)
        store.submitted = True
        self.assertEqual(run(store)[0], 0)
        store = FakeAppStore(states=("VALID",), review=409)
        code, output = run(store)
        self.assertEqual(code, 1)
        self.assertIn("STATE_ERROR: Build cannot be submitted", output)
        self.assertIn("Test Information", output)
        self.assertFalse(any(p.startswith("betaGroups/") for _, p, _ in store.writes))
        store = FakeAppStore(states=("VALID",), review=403)
        code, output = run(store)
        self.assertEqual(code, 1)
        self.assertIn("App Manager", output)
        self.assertNotIn("private-", output)


if __name__ == "__main__":
    unittest.main()
