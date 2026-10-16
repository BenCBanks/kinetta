"""CI-only: after an upload, send that build to the TestFlight groups so testers get it without anyone picking it.

Waits for Apple to finish processing the build, fills in "What to Test", submits it for beta review (needed for
external groups; Apple then releases it to testers by itself once approved) and adds it to each group. Never prints
credentials or account records; the job log of this public repository is public.
"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

spec = importlib.util.spec_from_file_location("preflight", Path(__file__).with_name("check-app-store.py"))
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)

API = "https://api.appstoreconnect.apple.com/v1/"
BUNDLE = "com.kinetta.app"
WAIT_MINUTES = 90      # Apple's processing is usually 10-30 minutes
POLL_SECONDS = 30


class Stop(Exception):
    """A plain-language reason to stop, safe for a public log."""


def call(method, path, body=None):
    # A fresh token for every request: each lasts 5 minutes and the wait can be much longer.
    jwt = preflight.token(Path(os.environ["RUNNER_TEMP"]) / "AuthKey.p8", os.environ["KEY_ID"], os.environ["ISSUER"])
    data = json.dumps(body).encode() if body is not None else None
    request = Request(API + path, data=data, method=method,
                      headers={"Authorization": "Bearer " + jwt, "Content-Type": "application/json"})
    with urlopen(request, timeout=60) as response:
        raw = response.read()
    return json.loads(raw) if raw else {}


def apple_error(error):
    # Apple's error codes and titles describe the request, not the account; safe to show.
    try:
        errors = json.loads(error.read() or b"{}").get("errors", [])
        return "; ".join(f"{e.get('code', '')}: {e.get('title', '')}".strip(": ") for e in errors[:3])
    except (ValueError, AttributeError):
        return ""


def find_build(app_id, number):
    query = urlencode({"filter[app]": app_id, "filter[version]": number, "limit": 1})
    found = call("GET", "builds?" + query).get("data", [])
    return found[0] if found else None


def wait_for_build(app_id, number, sleep=time.sleep):
    for _ in range(WAIT_MINUTES * 60 // POLL_SECONDS):
        build = find_build(app_id, number)
        state = build and build.get("attributes", {}).get("processingState")
        if state == "VALID":
            return build
        if state in ("FAILED", "INVALID"):
            raise Stop(f"Apple could not process build {number} ({state}). Check App Store Connect > TestFlight.")
        sleep(POLL_SECONDS)
    raise Stop(f"Build {number} was still processing after {WAIT_MINUTES} minutes. Add it to the groups by hand "
               "in App Store Connect, or re-run this job later.")


def what_to_test(build_id, text):
    found = call("GET", f"builds/{build_id}/betaBuildLocalizations").get("data", [])
    english = [x for x in found if x.get("attributes", {}).get("locale") == "en-US"]
    if english:
        call("PATCH", f"betaBuildLocalizations/{english[0]['id']}",
             {"data": {"type": "betaBuildLocalizations", "id": english[0]["id"], "attributes": {"whatsNew": text}}})
    else:
        call("POST", "betaBuildLocalizations",
             {"data": {"type": "betaBuildLocalizations", "attributes": {"locale": "en-US", "whatsNew": text},
                       "relationships": {"build": {"data": {"type": "builds", "id": build_id}}}}})


def submit_for_review(build_id):
    try:
        call("POST", "betaAppReviewSubmissions",
             {"data": {"type": "betaAppReviewSubmissions",
                       "relationships": {"build": {"data": {"type": "builds", "id": build_id}}}}})
    except HTTPError as error:
        if error.code != 409:
            raise
        # 409 also covers "already submitted"; only that case is fine.
        existing = call("GET", f"builds/{build_id}/betaAppReviewSubmission").get("data")
        if not existing:
            raise Stop("Apple refused the beta review submission (" + (apple_error(error) or "HTTP 409") + "). Usual "
                       "causes: Test Information or the reviewer sign-in is missing (TestFlight > Test Information), "
                       "or another build is still waiting for review.")


def message(raw):
    # The merge commit's first line, without the "(#123)" GitHub adds; testers see this in TestFlight.
    lines = (raw or "").strip().splitlines()
    line = lines[0].strip() if lines else ""
    if line.endswith(")") and " (#" in line:
        line = line[:line.rindex(" (#")]
    return (line or "Latest Kinetta test build.")[:4000]


def main(sleep=time.sleep):
    number = os.environ["BUILD_NUMBER"]
    names = [x.strip() for x in os.environ.get("GROUPS", "").split(",") if x.strip()] or ["Beta"]
    try:
        apps = call("GET", "apps?" + urlencode({"filter[bundleId]": BUNDLE, "limit": 2})).get("data", [])
        if len(apps) != 1:
            raise Stop(f"The API key cannot see exactly one {BUNDLE} app.")
        app_id = apps[0]["id"]
        groups = call("GET", "betaGroups?" + urlencode({"filter[app]": app_id, "limit": 200})).get("data", [])
        by_name = {g.get("attributes", {}).get("name"): g for g in groups}
        missing = [n for n in names if n not in by_name]
        if missing:
            raise Stop("No TestFlight group named " + ", ".join(missing) + ". Create it in App Store Connect or set "
                       "the repository variable TESTFLIGHT_GROUPS to the right names (comma separated).")
        chosen = [by_name[n] for n in names]
        external = [g for g in chosen if not g.get("attributes", {}).get("isInternalGroup")]

        print(f"Waiting for Apple to finish processing build {number}...", flush=True)
        build = wait_for_build(app_id, number, sleep)
        if build.get("attributes", {}).get("usesNonExemptEncryption") is None:
            # Info.plist already says no; this only fills the same answer in if Apple has not picked it up.
            call("PATCH", f"builds/{build['id']}",
                 {"data": {"type": "builds", "id": build["id"], "attributes": {"usesNonExemptEncryption": False}}})
        what_to_test(build["id"], message(os.environ.get("WHAT_TO_TEST")))
        if external:
            submit_for_review(build["id"])
        for group in chosen:
            call("POST", f"betaGroups/{group['id']}/relationships/builds", {"data": [{"type": "builds", "id": build["id"]}]})
        note = (" External testers get it as soon as Apple's beta review approves it (the first build of a new "
                "version can take about a day).") if external else ""
        print(f"::notice::Build {number} added to TestFlight group(s): {', '.join(names)}.{note}")
        return 0
    except Stop as stop:
        print(f"::error::{stop}")
    except HTTPError as error:
        hints = {401: "Check that Key ID, Issuer ID and .p8 belong to the same active team key.",
                 403: "The API key may need the App Manager role to manage TestFlight groups (Users and Access > Integrations)."}
        detail = apple_error(error)
        print(f"::error::App Store Connect returned HTTP {error.code}" + (f" ({detail})" if detail else "") + ". "
              + hints.get(error.code, "Apple API request failed; re-run the job or add the build by hand."))
    except (URLError, TimeoutError):
        print("::error::App Store Connect could not be reached. Re-run the job or add the build by hand.")
    except (ValueError, KeyError, OverflowError):
        print("::error::Apple API credentials or response could not be validated. Check the saved signing secrets.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
