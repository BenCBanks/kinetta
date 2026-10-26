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

    def __init__(self, states=("PROCESSING", "VALID"), groups=None, review=201, localizations=(), external=("READY_FOR_BETA_SUBMISSION",)):
        self.states, self.writes, self.polls = list(states), [], 0
        self.groups = groups if groups is not None else [
            {"id": "private-beta", "attributes": {"name": "Beta", "isInternalGroup": False}},
            {"id": "private-family", "attributes": {"name": "Family", "isInternalGroup": True}}]
        self.review, self.localizations = review, list(localizations)
        self.external, self.beta_reads = list(external), 0

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
        if path == "builds/private-build/buildBetaDetail":
            self.beta_reads += 1
            state = self.external.pop(0) if len(self.external) > 1 else self.external[0]
            if state is None:
                raise HTTPError(request.full_url, 404, "private", {}, io.BytesIO(b'{}'))
            return self.reply({"data": {"attributes": {"externalBuildState": state}}})
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

    def test_what_to_test_lists_each_change_since_the_last_release(self):
        self.assertEqual(distribute.message("Kit welcome step (#291)"), "Kit welcome step")
        self.assertEqual(distribute.message("Kit welcome step (#291)\nTrack maps (#271)\n\nA private commit body"), "What's new:\n- Kit welcome step\n- Track maps")
        self.assertEqual(distribute.message(""), "Latest Kinetta test build.")
        self.assertLessEqual(len(distribute.message("\n".join(["x" * 300] * 40))), 4000)

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

    def test_approved_testing_and_pending_review_skip_resubmission(self):
        for state in distribute.REVIEW_COMPLETE_OR_PENDING:
            with self.subTest(state=state):
                store = FakeAppStore(states=("VALID",), external=(state,))
                code, output = run(store)
                self.assertEqual(code, 0)
                self.assertIn(state, output)
                self.assertFalse(any(p == "betaAppReviewSubmissions" for _, p, _ in store.writes))
                self.assertTrue(any(p.startswith("betaGroups/") for _, p, _ in store.writes))

    def test_processing_and_missing_resource_wait_before_review(self):
        store = FakeAppStore(states=("VALID",), external=(None, "PROCESSING", "MISSING_EXPORT_COMPLIANCE", "READY_FOR_BETA_SUBMISSION"))
        self.assertEqual(run(store)[0], 0)
        self.assertEqual(store.beta_reads, 4)
        self.assertEqual(sum(p == "betaAppReviewSubmissions" for _, p, _ in store.writes), 1)

    def test_review_race_conflict_or_422_requires_confirmed_state(self):
        for status in (409, 422):
            for state in distribute.REVIEW_COMPLETE_OR_PENDING:
                with self.subTest(status=status, state=state):
                    store = FakeAppStore(states=("VALID",), review=status, external=("READY_FOR_BETA_SUBMISSION", state))
                    self.assertEqual(run(store)[0], 0)
                    self.assertTrue(any(p.startswith("betaGroups/") for _, p, _ in store.writes))

    def test_review_refusals_are_not_treated_as_success(self):
        for status in (409, 422, 403):
            store = FakeAppStore(states=("VALID",), review=status)
            code, output = run(store)
            self.assertEqual(code, 1)
            self.assertIn("POST /v1/betaAppReviewSubmissions", output)
            self.assertIn("STATE_ERROR: Build cannot be submitted", output)
            self.assertFalse(any(p.startswith("betaGroups/") for _, p, _ in store.writes))
            self.assertNotIn("private-", output)
            if status == 403:
                self.assertIn("App Manager", output)
        store = FakeAppStore(states=("VALID",), review=422, external=("READY_FOR_BETA_SUBMISSION", None))
        self.assertEqual(run(store)[0], 1, 'missing status cannot turn a 422 into success')

    def test_rejected_expired_compliance_and_unknown_states_stop(self):
        for state in ("BETA_REJECTED", "EXPIRED", "PROCESSING_EXCEPTION", "IN_EXPORT_COMPLIANCE_REVIEW", "private-unknown-state"):
            store = FakeAppStore(states=("VALID",), external=(state,))
            code, output = run(store)
            self.assertEqual(code, 1)
            self.assertIn("App Store Connect > TestFlight", output)
            self.assertFalse(any(p == "betaAppReviewSubmissions" or p.startswith("betaGroups/") for _, p, _ in store.writes))
            self.assertNotIn("private-", output)

    def test_beta_readiness_wait_is_bounded(self):
        store = FakeAppStore(states=("VALID",), external=("PROCESSING",))
        code, output = run(store)
        self.assertEqual(code, 1)
        self.assertEqual(store.beta_reads, distribute.BETA_WAIT_MINUTES * 60 // distribute.POLL_SECONDS)
        self.assertIn("before retrying", output)
        self.assertFalse(any(p == "betaAppReviewSubmissions" for _, p, _ in store.writes))

    def test_failed_operation_masks_resource_ids_and_queries(self):
        store = FakeAppStore(states=("VALID",), external=("BETA_APPROVED",))
        def failed_group(request, timeout=None):
            if request.get_method() == "POST" and "relationships/builds" in request.full_url:
                raise HTTPError(request.full_url, 422, "private", {}, io.BytesIO(b'{}'))
            return store(request, timeout)
        code, output = run(failed_group)
        self.assertEqual(code, 1)
        self.assertIn("POST /v1/betaGroups/{id}/relationships/builds", output)
        self.assertNotIn("private-", output)


if __name__ == "__main__":
    unittest.main()
