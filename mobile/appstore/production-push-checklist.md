# Production APNs release check — owner/release operator

Use this checklist for the exact signed TestFlight or App Store build. It distinguishes source/CI evidence from a real device delivery check. Do not record device tokens, provider keys, account credentials or personal notification contents in the release notes.

## Before upload

- [ ] Record the source commit, workflow run and generated build number for this release.
- [ ] Confirm the release configuration is `Release`. In `NativePush.swift`, `DEBUG` selects `sandbox`; a non-debug build reports `production` with its registered device token.
- [ ] Confirm the TestFlight job did not skip because Apple credentials were unavailable, and that `mobile/scripts/check-export.py` ran successfully **before upload**. It verifies the exported IPA signature and requires `aps-environment=production`, a distribution profile, `get-task-allow` not enabled, and the expected app identity.
- [ ] Do not use the unsigned archive check as proof of production APNs. It accepts either `development` or `production` because the archive is unsigned; the exported signed IPA check is the gate that proves the production entitlement.
- [ ] Confirm the workflow uploaded that same verified IPA and that Apple finished processing the matching build. A green unsigned build or a successful upload alone is not proof of push delivery.

## Physical iPhone verification

- [ ] Install the processed build from TestFlight on a designated test iPhone and sign in to an approved fictional test account.
- [ ] Enable Kinetta notifications through the in-app invitation and Apple permission prompt. Confirm the app registers a token for the signed-in account; never copy the token into a report.
- [ ] With the approved test server's APNs configuration, use an existing supported notification flow between fictional test accounts. Confirm the notification arrives while the app is foregrounded and backgrounded/locked; don't add a direct-send endpoint just for this check.
- [ ] Tap the notification and confirm it opens the intended Kinetta screen. Confirm disabling notifications, logging out, or switching accounts prevents delivery to the previous session.
- [ ] Record the build, device/iOS version, test scenarios and pass/fail result without including tokens, credentials, private account data or notification payloads.

## Stop conditions

Stop the release check if the exported entitlement is missing or says `development`, if the signed app/profile does not match the intended distribution, or if delivery evidence is unavailable. Do not treat mocked transport tests, Simulator tokens, or the unsigned archive as a production push pass. Resolve the release issue before claiming production APNs readiness.

Source checks: `mobile/ios/App/App/NativePush.swift`, `.github/workflows/ios.yml`, `mobile/scripts/check-export.py`, and `docs/ios-notifications.md`. This checklist documents verification; it does not send pushes, configure APNs, change signing, upload a build, or submit to App Review.
