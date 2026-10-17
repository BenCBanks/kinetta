# Getting ready for external testers

Readiness checkpoint: October 17, 2026. The owner has authorized the reviewed release and TestFlight build.
The current release outcome is recorded separately; physical-device acceptance and external tester readiness remain gates.
[The current roadmap](../ROADMAP.md) and #122 supersede historical setup notes below.

The first beta should use Apple Health or the existing intervals.icu connection. Direct Garmin approval is a separate path and must not delay it. A successful unsigned iPhone build does not prove that a TestFlight build was uploaded or approved.

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

Garmin's [official FAQ](https://developer.garmin.com/gc-developer-program/program-faq/) says the program is for business use. A working website and a small beta are useful evidence, but do not guarantee approval. We must not invent a business or imply a user count we do not have.

When ready, the owner should provide a genuine business/legal identity, business contact, product description, website and privacy/support links. We can prepare the technical request: user-authorized workout history and ongoing activity files; FIT, route and heart-rate handling; OAuth, revocation/deletion, deduplication and health-data consent. Request the Activity API, and describe planned AI and social use honestly so Garmin can confirm the permitted scope. Review the agreement before accepting it.

On October 13 the [live application page](https://www.garmin.com/en-US/forms/GarminConnectDeveloperAccess/) displayed an updates notice and no submission form in a JavaScript-enabled browser. A user-posted Garmin response on its [developer forum](https://forums.garmin.com/developer/connect-iq/f/discussion/434798/cannot-access-developer-program-application-form-under-construction/2027757) describes intake as paused; this is corroboration, not a direct response to Kinetta. Do not assume applications have resumed. Once the owner is ready, ask Garmin's program support about current intake or submit through the official form if it reopens. Track the response privately. [Garmin pursuit issue #63](https://github.com/BenCBanks/kinetta/issues/63).

## Approval prospects

Neither provider publishes a reliable approval probability for Kinetta. These are judgments, not percentage forecasts:

| Gate | Assessment | What changes the assessment |
|---|---|---|
| Apple Developer enrollment | Good prospect if identity and eligibility checks pass | Correct legal details, two-factor authentication, agreements and membership payment |
| External TestFlight review | Reasonable prospect once the signed app is dependable; not ready to claim today | Reviewer access, real-device proof, accurate metadata, privacy and account deletion |
| Direct Garmin access now | Cannot plan on approval while the application form is unavailable | Garmin confirms intake reopened and business eligibility |
| Garmin after intake resumes | Uncertain; a legitimate fitness product fits the API's purpose | Honest business/use case, working product, privacy safeguards and acceptance of Garmin's terms |

Apple applies its [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), including useful functionality beyond a repackaged website, health-data handling and permission before third-party AI sharing. Kinetta's native HealthKit integration and workout/food tools strengthen its case, but are not an approval guarantee. Existing export/deletion and consent controls help; remaining bugs and inaccurate promises need fixing before review.
