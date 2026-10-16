# The Kinetta iPhone app

The iPhone app is the same Kinetta you use in Safari, inside a real app, so it can read **Apple Health**. Garmin, Apple
Watch, Coros, Wahoo, Strava and most other apps write their workouts to Apple Health, so once you connect it, your
workouts show up in Kinetta without uploading files.

For the owner steps, remaining engineering work and approval prospects, start with [External beta readiness](beta-readiness.md).

The build and conditional signing/upload workflow exist. A green unsigned build is not proof of a TestFlight upload:
check that signing and upload actually ran, then verify the processed build in App Store Connect. Background sync and
real-device acceptance remain separate readiness gates. Once the Apple setup below is complete, app changes on `main`
can be signed and uploaded automatically.

## What the app does today

- **Log in to your own server.** The login screen asks for the server's address (`https://login.kinetta.app` by default,
  or your own). The server must be on `https://`; iPhones don't let apps talk to plain `http://` addresses.
- **Me > Apple Health.** Explains what Kinetta reads (workouts, heart rate during workouts, routes), then shows Apple's
  permission sheet. Kinetta only reads; it never writes to Apple Health.
- **Sync.** The first sync brings in the last 30 days ("Also bring in the past year" goes further back). After that,
  the app sends new workouts whenever it's opened or brought back to the front. The native background component also watches HealthKit changes, saves pending workout IDs and retries unacknowledged uploads independently of the web view. iOS decides when it can run; delivery can be delayed while locked or after force-quitting. This implementation still requires a Mac build and signed physical-device acceptance before release. Failed ranges stay queued for the next sync, including a failed past-year import. The Apple Health screen shows the latest attempt and any error. Connecting is specific to your account and server; logging out stops sync and clears that connection. Each workout is sent with Apple
  Health's own id for it, so a workout sent twice is stored once. A workout that's already in Kinetta from somewhere
  else (a Garmin file, a Strava export) isn't added again either.
- **Kit AI consent.** Kit reads Apple Health workouts only after you tick "Let Kit read my Apple
  Health workouts". Until then Kit is off for anyone with Apple Health workouts (Apple's rules require consent
  before health data goes to an AI service).

## The plan (roadmap step 3)

1. **The app and Apple Health permission** (done in this first piece): the shell around `app/static`, the permission
   screen, syncing when the app is open, the server endpoint, and a build on GitHub's Mac computers for every change.
2. **TestFlight** (ready, waiting for the Apple setup below): the `testflight` job in `.github/workflows/ios.yml` signs
   the app with Apple's own cloud signing and uploads it. Build numbers count up by themselves. Already in place for
   Apple's checks: a privacy manifest (`mobile/ios/App/App/PrivacyInfo.xcprivacy`), the "no special encryption"
   answer, the Apple Health permission texts, the 1024-pixel icon, delete-my-account in the app and the privacy policy
   at https://kinetta.app/privacy.
3. **Background sync**: native observer, anchored reads and a durable per-account queue have merged and passed Mac builds and a TestFlight upload. Complete the physical-device checklist below before declaring background delivery reliable.
4. **More from Apple Health**: weight, resting heart rate and sleep.
5. **App Store**: screenshots and a demo account for Apple's reviewers (see "Before outside testers" below).
6. **Android** (Health Connect) after that. The Health plugin already supports it.

## What you need to do in your Apple Developer account

Do these in order. Nothing here costs money except the membership.

1. **Join the Apple Developer Program** at <https://developer.apple.com/programs/enroll/> ($99 a year).
   - Enrolling as an *individual* is quickest; the App Store will show your own name as the seller.
   - Enrolling as an *organization* shows a company name but needs a D-U-N-S number and takes longer.
2. **Accept the agreements.** In [App Store Connect](https://appstoreconnect.apple.com) open **Business** (or the
   banner at the top) and accept the latest Apple Developer Program License Agreement. A free app needs no paid
   agreement or bank details.
3. **Register the app's id.** In [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list)
   choose **Identifiers > + > App IDs > App**:
   - Description: `Kinetta`
   - Bundle ID: **Explicit**, `com.kinetta.app`
     (if Apple says it's taken, pick another, such as `com.kinetta.ios`, and tell me: it's set in
     `mobile/capacitor.config.json` and the Xcode project)
   - Capabilities: tick **HealthKit** and enable **Background Delivery** within it for a build containing the native sync component. Leave "Clinical Health Records" unticked. Regenerate the signing profile if needed.
4. **Create the app in App Store Connect.** **Apps > + > New App**:
   - Platform: iOS. Name: `Kinetta` (must be unique on the App Store; try "Kinetta: Workouts & Food" if it's taken).
   - Primary language: English (U.S.). Bundle ID: the one from step 3. SKU: `kinetta-ios`. User access: Full Access.
5. **Make an API key for GitHub Actions**, so the Mac runner can sign and upload without your password or two-factor
   codes. In App Store Connect: **Users and Access > Integrations > App Store Connect API > Team Keys > +**.
   - Name: `GitHub Actions`. Access: **Admin** (needed so the build can create its own signing certificate).
   - Download the `.p8` file. **Apple lets you download it only once**; keep it somewhere safe, like a password manager.
   - Note the **Key ID** (next to the key) and the **Issuer ID** (above the list of keys).
6. **Find your Team ID**: [Membership details](https://developer.apple.com/account#MembershipDetailsCard), "Team ID"
   (10 letters and numbers).
7. **Add four GitHub secrets.** In this repository on GitHub: **Settings > Secrets and variables > Actions > New
   repository secret**:

   | Name | Value |
   |---|---|
   | `APPLE_TEAM_ID` | the Team ID from step 6 |
   | `ASC_KEY_ID` | the Key ID from step 5 |
   | `ASC_ISSUER_ID` | the Issuer ID from step 5 |
   | `ASC_KEY_P8` | the whole text of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` lines |

8. **Set up TestFlight testers.** Two kinds; beta testers want the second.
   - **Family (internal testing):** **TestFlight > Internal Testing > +**, group `Family`. Internal testers must be on
     your App Store Connect team (**Users and Access > +**, role "Customer Support"). New builds reach them at once.
   - **Beta testers (external testing, with a public link):** **TestFlight > External Testing > +**, group `Beta`,
     then add a build. The first build of each version goes through Apple's short beta review (usually a day). Then
     turn on **Public Link** and send that link with each tester's Kinetta invite: they tap it, install TestFlight,
     and install Kinetta. Up to 10,000 people, no Apple team accounts needed.
   - Beta review asks for **Test Information**: a sentence on what to test, your contact details, and a **sign-in for
     the reviewer** (see below).
9. **Fill in App Privacy** (App Store Connect > the app > **App Privacy**), needed before outside testing or the App
   Store. Answers for Kinetta: data collected: **Health & Fitness** (Health, Fitness), **Contact Info** (name),
   **Identifiers** (user ID), **Location** (precise: workout routes), **User Content** (photos of food, other content: recipes
   and comments); all *linked to the user*, *not used for tracking*, used for *App Functionality*. These match the
   app's privacy manifest. If the AI features are on for your server, also say that health, fitness and food data and
   food photos are shared with Google (Gemini) when the person turns AI features on.

The workflow archives without a development profile, preserves the HealthKit entitlements, then lets Xcode
automatically sign for App Store Connect during export. You do not need to register a development iPhone for this
TestFlight upload. A successful upload and physical-device HealthKit test are still required.

After step 7, start the upload once by hand: GitHub > **Actions > iPhone app > Run workflow** (branch `main`). The build
shows up in App Store Connect under **TestFlight** 10 to 30 minutes later. From then on every change to the app on
`main` uploads a new build by itself.

**Testers get each new build by themselves.** After the upload, the workflow's `beta` job waits for Apple's
processing, writes "What to Test" from the merged change's title, submits the build for beta review and adds it to
the `Beta` group. Apple releases it to external testers once the review approves it: the first build of a new version
can take about a day, later builds are often quicker. Nothing to pick in App Store Connect. To send builds to other
groups, add a repository variable `TESTFLIGHT_GROUPS` (GitHub > Settings > Secrets and variables > Actions >
Variables) with the group names, comma separated, for example `Beta,Family`. Internal groups need no review; you can
also turn on **Automatic Distribution** for them in App Store Connect instead. Managing groups needs the API key from
step 5 to have the **App Manager** role (or Admin); with a lower role the `beta` job fails with a note saying so, and
the build can still be added by hand. Beta review needs **Test Information** and the reviewer sign-in filled in.

## Before outside testers or the App Store

Already done: the **privacy policy URL** (https://kinetta.app/privacy, which covers Apple Health), **delete my account**
inside the app (Me > Your data), and **download my data**.

Still to do when you submit:
- **A sign-in for Apple's reviewer** on login.kinetta.app, with some made-up workouts and food in it. Before making it,
  remember that "Everyone" on a shared server means every account there, reviewer included: activities testers share
  with *Everyone* would be visible to it (activities are *Only me* unless a person changes that).
- **Screenshots** at 6.9-inch iPhone size (1320 x 2868). The app is iPhone-only, so no iPad screenshots are needed.
- **Support URL**: https://kinetta.app works. **Marketing URL**: optional.
- **Age rating** questionnaire: no objectionable content; friends can comment on each other's activities, so answer
  yes to "user-generated content" if asked.

## For developers

See [mobile/README.md](../mobile/README.md).

## Background sync device acceptance

Use a signed build whose provisioning profile includes `com.apple.developer.healthkit.background-delivery`. Record the app build, iOS version and sanitized pass/fail results; never publish workout routes, tokens or tester identities. Simulator and stand-in tests do not satisfy this checklist.

1. Connect with access denied, then change access in Health settings and retry. Empty reads must not be presented as proof of permission.
2. Import initial history while unlocked; replay it through both foreground and native uploads and verify one activity per HealthKit UUID.
3. Record a new workout while Kinetta is inactive. Let iOS deliver it; confirm available route and heart-rate details. Record actual timing without promising instant uploads.
4. Lock the phone during a read; unlock and reopen. Pending IDs remain, failed reads retry, and no incomplete route is silently confirmed as complete.
5. Disconnect the network during upload; terminate/relaunch the process and reconnect. Pending state survives, and a lost acknowledgement followed by retry does not double-count.
6. Force-quit and record another workout; reopen to catch up. Check the on-screen explanation of iOS delivery limits.
7. Expire the login token. Uploads pause with a sign-in error while IDs remain queued. Reauthenticate and explicitly reconnect; history catches up without duplicates.
8. Switch accounts and servers during reads/uploads. Logout cancels native work; no old pending workout reaches the new account or server; the new account needs explicit Health consent.
9. Stop syncing and relaunch. No Health observer/uploads resume. Previously imported activities stay on the server.
10. Interrupt a large import with a background time expiry. Next activation resumes pending work; one failed item does not discard other items.
11. Compare Nutrition, Today, activity details and the Apple Health screen in light/dark mode. Pending/error text and foreground Sync now remain usable.

HealthKit read access is private: denied access can look like an empty result. Kinetta cannot prove authorization merely from a successful empty query. If a queued workout was deleted from Health or access revoked, its reference remains pending with a readable error; disconnect/reconnect resets that queue without deleting server activities.

References: [Apple observer queries](https://developer.apple.com/documentation/healthkit/hkobserverquery), [executing observer queries](https://developer.apple.com/documentation/healthkit/executing-observer-queries), and [background delivery entitlement](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.healthkit.background-delivery).

## App icon and upload checks

The existing Kinetta track-and-dot icon is bundled in the app's `AppIcon` asset catalog.
The [1024-pixel PNG](../mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png) is an opaque RGB square; iOS applies its own corner mask. App Store Connect takes the icon from the uploaded build, so there is no separate icon upload step.

The signing workflow checks that its API key can read the `com.kinetta.app` app record before archiving. It signs/exports an IPA first, then uploads that signed file with Apple's `altool`. This separates account access, signing and upload errors. Keys stay on the temporary runner and are removed even after a failure.

## Available Health details

Kinetta rereads the recent overlap when opened and queues native detail refreshes without advancing the new-workout anchor. A known Health UUID can enrich its existing activity with a later route, heart rate or recorded metrics. Empty retries preserve fuller recordings. Compatible imports from another source can gain missing details while keeping their title, sharing, gear and existing summary values. Legacy installed apps still receive `added`/`duplicate` acknowledgements; the API separately reports `details_updated` and an `updated` count.

A compatible original workout file arriving after a Health summary can also fill in its route and signals on the same activity. Duplicate matching checks sport and duration as well as time/distance; enrichment applies a tighter distance check. Dense but incomplete recordings do not replace recordings covering the full workout.

Additional read permission is requested only through Connect or Change what Kinetta can read. Native statistics include steps, elevation, running power/speed/stride/vertical oscillation/ground contact time (supported on iOS 16+) and cycling power/speed/cadence (iOS 17+), when the recording provides them. Aggregate values do not invent time-series charts. Stored running stride/vertical oscillation use millimetres, ground contact uses milliseconds, speed uses metres per second and power uses watts.

Apple Health does not guarantee that every recording app shares every metric. [Garmin documents that its GPS tracks are not transmitted to Apple Health](https://support.garmin.com/es-CL/?faq=lK5FPB9iPF5PXFkIpFlFPA&searchType=noProduct). Use a compatible original FIT/GPX/TCX file or an independently configured connection for fuller Garmin workouts. A missing route is not proof that permission was denied: HealthKit intentionally does not reveal denied read access.

Physical acceptance must include an Apple Watch outdoor workout with route permission, a summary-only Garmin import, a delayed-route replay, an empty/denied-detail retry, an existing file import and account switching. Compare the values with their recorded source; verify one activity remains after foreground/background retries. Linux stand-ins establish API/state contracts, not actual HealthKit delivery.

For how server releases, bundled screens and database migrations fit together, see [Developing and releasing Kinetta](development-and-updates.md).

Native iPhone alerts and APNs credentials: [notification setup](ios-notifications.md). Browser push delivery is retired.
