# Getting ready for external testers

Readiness checkpoint: October 20, 2026. See the [current usability and wider-beta assessment](usage-readiness.md) for measured limits and the next go/no-go checks. The owner has authorized the reviewed release and TestFlight build.
The current release outcome is recorded separately; physical-device acceptance and external tester readiness remain gates.
[The current roadmap](../ROADMAP.md) and #122 supersede historical setup notes below.

The first beta should use Apple Health. Garmin Connect (Garmin developer program, approved October 2026) is admin-only until it has been checked with real data. A successful unsigned iPhone build does not prove that a TestFlight build was uploaded or approved.

## Owner steps, in order

1. **Choose the Apple account identity.** Individual enrollment is available without forming a company; the seller name is your legal name. Organization enrollment needs a legal entity, D-U-N-S number, authority to sign agreements, work email and a functional organization website. Membership is USD 99/year, subject to regional pricing. [Apple enrollment requirements](https://developer.apple.com/programs/enroll/).
2. **Enroll and accept Apple's agreements.** Use an Apple Account with two-factor authentication. Keep enrollment and signing credentials private.
3. **Register Kinetta and enable HealthKit.** Follow [ios.md](ios.md) for the bundle identifier, App Store Connect record and four GitHub Actions signing secrets. When background delivery is implemented, the registered capability and signing profile must include its entitlement too. Do not paste keys into issues or chat.
4. **Choose a monitored support email.** Provide a feedback contact and accurate privacy information about workouts, routes, food and optional AI. The published backup statement must match verified encryption and retention. The operator must authorize any production backup or infrastructure changes.
5. **Install one signed build on your own iPhone.** We prepare the build; the owner checks its processed state in App Store Connect and installs through internal TestFlight. Confirm permission, history import, replay without duplicates, offline recovery, a newly recorded workout and logout/account switching. Native background delivery needs physical-device testing; browser tests cannot establish it.
6. **Supply Apple's beta review information.** We prepare the description, what to test and step-by-step review notes. The owner supplies review contact details and authorizes creation of a separate reviewer account containing only made-up data. Verify the public server and reviewer login actually work. Explain invite-only registration and Apple Health; complete the required privacy/export compliance answers. [Test information](https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-test-information/).
7. **Submit for external TestFlight review.** Create the testing groups and select the signed build. The first external build requires review; outside users can install after approval. Keep the approved install link together with the Kinetta account invite. No full App Store release is needed to start TestFlight. [TestFlight process](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).
8. **Choose five testers only after that path works.** Send clear instructions: create the account from the web invite, install TestFlight/Kinetta, log into the app with the same credentials, connect Apple Health and keep the phone unlocked for the first history import. Include the support contact and explain actual sync timing. Do not promise background imports before they have passed device testing.
9. **Run the five-person beta for two weeks.** Confirm each tester independently imports history and gets new workouts, navigates Today/activity details, logs food and can recover from a failed sync. Check sanitized failures and support feedback daily. Verify an isolated backup restore. The #122 gate requires all five to log food on most days for two weeks and receive or record workouts without help. Expand to 10–30 only after that gate passes.

## Engineering scope and remaining acceptance

The implementation work below exists; its physical-device/service acceptance is not established by passing CI:

- Recoverable Apple Health imports, visible errors and account-specific consent: [#58](https://github.com/BenCBanks/kinetta/issues/58).
- Native background delivery and a durable queue are implemented; signed physical-device acceptance remains required (see [the checklist](ios.md#background-sync-device-acceptance)): [#59](https://github.com/BenCBanks/kinetta/issues/59).
- Conservative deduplication and authenticated native file uploads: [#60](https://github.com/BenCBanks/kinetta/issues/60).
- Health Auto Export fixtures and intervals.icu history/outage recovery: [#61](https://github.com/BenCBanks/kinetta/issues/61). Real service accounts still need end-to-end validation. Strava-fed activities are unavailable through the intervals API; use a direct watch connection.
- Invite/onboarding/auth tests, support instructions and operational checks: [#62](https://github.com/BenCBanks/kinetta/issues/62).

Existing code already includes HealthKit foreground sync, 30-day history and an optional past year, HealthKit UUID deduplication, invite-only web accounts, export/deletion, legacy file imports, Health Auto Export ingestion and intervals polling. Their existence does not establish the full external-tester success criterion.

## Direct Garmin access

Garmin's [current official program page](https://developerportal.garmin.com/developer-programs/connect-developer-api) lists Starter access as push-only, with historical data excluded. Enterprise options include history of one month or more; access and commercial terms depend on the integration. The older intake/evaluation guidance does not establish backfill permission for current keys.

Kinetta therefore describes new Garmin activities arriving after a watch sync. Older history can come from a Strava export or past workouts available in Apple Health; original watch files can also be uploaded. The best-effort backfill request is retained where supported, but it does not establish that history was delivered. See [the history evidence and limits](garmin-history.md).

Public documentation does not establish a particular application's evaluation/production status or endpoint permission. Verify those privately in Garmin's portal before making a stronger history promise. API-key approval, a successful sign-in, and actual activity delivery are separate checks. Existing consent, revocation, deduplication and privacy rules remain required.

## Approval prospects

Neither provider publishes a reliable approval probability for Kinetta. These are judgments, not percentage forecasts:

| Gate | Assessment | What changes the assessment |
|---|---|---|
| Apple Developer enrollment | Good prospect if identity and eligibility checks pass | Correct legal details, two-factor authentication, agreements and membership payment |
| External TestFlight review | Reasonable prospect once the signed app is dependable; not ready to claim today | Reviewer access, real-device proof, accurate metadata, privacy and account deletion |
| Direct Garmin access now | Starter supports new activity pushes; real delivery still needs verification | Actual permitted watch sync, consent and correct portal delivery settings |
| Garmin history | Excluded from Starter; Enterprise capabilities depend on access | Explicit endpoint entitlement and successful historical delivery |

Apple applies its [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), including useful functionality beyond a repackaged website, health-data handling and permission before third-party AI sharing. Kinetta's native HealthKit integration and workout/food tools strengthen its case, but are not an approval guarantee. Existing export/deletion and consent controls help; remaining bugs and inaccurate promises need fixing before review.
