# The Kinetta iPhone app

The iPhone app is the same Kinetta you use in Safari, inside a real app, so it can read **Apple Health**. Garmin, Apple
Watch and other apps can make workouts available through Apple Health. Once you connect, Kinetta imports the data those sources actually write and you allow it to read. The iPhone app omits file imports; use a browser for original files or a Strava export.

For the owner steps, remaining engineering work and approval prospects, start with [External beta readiness](beta-readiness.md).

The build and conditional signing/upload workflow exist. A green unsigned build is not proof of a TestFlight upload:
check that signing and upload actually ran, then verify the processed build in App Store Connect. Background sync and
real-device acceptance remain separate readiness gates. Once the Apple setup below is complete, app changes on `main`
can be signed and uploaded automatically.

## What the app does today

- **Sign up or log in.** The app uses `https://login.kinetta.app`. Create an account and Forgot password work inside the app. The hosted service has open sign-up with a 100-account cap; when full, the app offers the waitlist. Other installations choose their own sign-up mode and cap. People who sign up themselves confirm their email before appearing to others or using social actions; people joining by an invite link are not held back.
  Developers can point a build at a test server; it must use `https://`.
- **Welcome.** New accounts see four optional steps: profile, activity audience, bring in workouts and find friends. Skip/Not now do not save pending name, bio or audience edits, or undo actions already confirmed (such as a photo upload or friend request). Me leads with Get started and hides the empty chart until activity or food history exists.
- **Account safety.** Settings → Signed-in devices lists device labels and sign-in dates, without IP addresses. Sign out one other login or all others; use Log out for this one. Settings → Notifications controls New sign-in emails, on by default for confirmed addresses when mail is available. The first device and known device types are silent.
- **Settings → Connections → Apple Health.** Explains what Kinetta reads (workouts, heart rate during workouts, routes), then shows Apple's
  permission sheet. Optional weight reading and nutrition writing have separate controls, described below.
- **Sync.** The first sync brings in the last 30 days ("Also bring in the past year" goes further back). After that,
  the app sends new workouts whenever it's opened or brought back to the front. The native background component also watches HealthKit changes, saves pending workout IDs and retries unacknowledged uploads independently of the web view. iOS decides when it can run; delivery can be delayed while locked or after force-quitting. The native component has passed Mac builds and a TestFlight upload; physical-device background delivery acceptance remains pending. Failed ranges stay queued for the next sync, including a failed past-year import. The Apple Health screen shows the latest attempt and any error. Connecting is specific to your account and server; logging out stops sync and clears that connection. Each workout is sent with Apple
  Health's own id for it, so a workout sent twice is stored once. A workout that's already in Kinetta from somewhere
  else (a Garmin file, a Strava export) isn't added again either.
- **Kit AI consent.** Kit reads Apple Health workouts only after you tick "Let Kit read my Apple
  Health data". Until then Kit is off for anyone with Apple Health workouts (Apple's rules require consent
  before health data goes to an AI service).

## The plan (roadmap step 3)

1. **The app and Apple Health permission** (done in this first piece): the shell around `app/static`, the permission
   screen, syncing when the app is open, the server endpoint, and a build on GitHub's Mac computers for every change.
2. **TestFlight** (workflow implemented; new installations need the Apple setup below): the `testflight` job in `.github/workflows/ios.yml` signs
   the app with Apple's own cloud signing and uploads it. Build numbers count up by themselves. Already in place for
   Apple's checks: a privacy manifest (`mobile/ios/App/App/PrivacyInfo.xcprivacy`), the "no special encryption"
   answer, the Apple Health permission texts, the 1024-pixel icon, delete-my-account in the app and the privacy policy
   at https://kinetta.app/privacy.
3. **Background sync**: native observer, anchored reads and a durable per-account queue have merged and passed Mac builds and a TestFlight upload. Complete the physical-device checklist below before declaring background delivery reliable.
4. **More from Apple Health**: optional weight and Resting Energy reads are implemented with separate permissions; physical-device acceptance remains pending. Resting heart rate and sleep remain planned.
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
     turn on **Public Link** and share that link separately from Kinetta account access: they tap it, install TestFlight,
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

Retrying distribution checks the build's external TestFlight state first. Already approved, testing or pending-review
builds continue to group assignment without a second review submission. A 409 or 422 is accepted only when a fresh
status read confirms review is pending or complete. Processing/temporarily missing TestFlight details are polled;
rejected, expired or blocked builds stop with instructions. Failed API operations are named without account IDs.
An uploaded build does not need rebuilding when only distribution fails. Check the failed operation and the build's
status before retrying: in TestFlight, select the external group and use **Add Builds** (or **+** beside Builds) to add
the existing build. For an approved build already assigned to the group, use **Start Testing** or **Notify Testers**
if offered. See [Apple's external testing guide](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).

## Before outside testers or the App Store

Already done: the **privacy policy URL** (https://kinetta.app/privacy, which covers Apple Health), **delete my account**
inside the app (Me → Settings & account → Your data), and **download my data**.

Still to do when you submit:
- **A sign-in for Apple's reviewer** on login.kinetta.app, with some made-up workouts and food in it. Before making it,
  remember that "Everyone" on a shared server means every account there, reviewer included: activities testers share
  with *Everyone* would be visible to it (new accounts default to *Everyone on Kinetta*, with a choice in welcome, Settings → Sharing & privacy, and before saving a recording; existing activities retain their audience).
- **Screenshots** at 6.9-inch iPhone size (1320 x 2868). The app is iPhone-only, so no iPad screenshots are needed.
- **Support URL**: https://kinetta.app works. **Marketing URL**: optional.
- **Age rating** questionnaire: no objectionable content; friends can comment on each other's activities, so answer
  yes to "user-generated content" if asked.

## Recording with this iPhone

Track records outdoor GPS independently of the web screen, including while locked or using another app. Review the audience before Save; recordings use that choice, not an unconditional private default. The main number is pace over the last 30 seconds (speed for rides and skiing), with average and last mile/km underneath. Small GPS movements within the accuracy threshold do not add distance; GPS remains approximate.

Say my time every mile/km starts on, following account units. Native speech is configured for locked-screen cues and dips music while speaking; real locked-pocket behavior still needs acceptance. Auto-pause starts on for runs, walks and hikes and off for rides. After 15 seconds without counted movement, active time holds without jumping backwards, then resumes when you move. Voice is remembered per account on this device; auto-pause also remembers the sport. No Lock Screen Live Activity is implemented. See [recording details](activity-tracking.md) and the [physical-iPhone acceptance checklist](activity-acceptance.md).

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

A compatible original workout file arriving after a Health summary can also fill in its route and signals on the same activity. For a phone recording paired with an import, matching uses at least 80% overlap of the longer workout, in either order, without requiring the same sport label. A short run inside a long hike stays separate. Other imports use sport, duration and time/distance checks; file enrichment applies a tighter distance check. Dense but incomplete recordings do not replace recordings covering the full workout.

Additional read permission is requested only through Connect or Change what Kinetta can read. Native statistics include steps, elevation, running power/speed/stride/vertical oscillation/ground contact time (supported on iOS 16+) and cycling power/speed/cadence (iOS 17+), when the recording provides them. Aggregate values do not invent time-series charts. Stored running stride/vertical oscillation use millimetres, ground contact uses milliseconds, speed uses metres per second and power uses watts.

Apple Health does not guarantee that every recording app shares every metric. [Garmin documents that its GPS tracks are not transmitted to Apple Health](https://support.garmin.com/es-CL/?faq=lK5FPB9iPF5PXFkIpFlFPA&searchType=noProduct). Use a compatible original FIT/GPX/TCX file or an independently configured connection for fuller Garmin workouts. A missing route is not proof that permission was denied: HealthKit intentionally does not reveal denied read access.

Physical acceptance must include an Apple Watch outdoor workout with route permission, a summary-only Garmin import, a delayed-route replay, an empty/denied-detail retry, an existing file import and account switching. Compare the values with their recorded source; verify one activity remains after foreground/background retries. Linux stand-ins establish API/state contracts, not actual HealthKit delivery.

For how server releases, bundled screens and database migrations fit together, see [Developing and releasing Kinetta](development-and-updates.md).

Native iPhone alerts and APNs credentials: [notification setup](ios-notifications.md). Browser push delivery is retired.

Resting Energy is a separate optional read for Nutrition; see [resting calories](resting-calories.md). Food goals stay independent, and recorded workout calories are not duplicated.

### Health weight/nutrition native foundation (#122 I3)

The registered HealthFood bridge provides independent permission requests, owner-bound anchored weight reading and app-owned nutrition reconciliation. UI setup/autosync follows separately; no new prompt appears on launch from this foundation. Updated Health usage descriptions cover optional weight reading and optional logged nutrition writing. The existing workout recorder/background importer remains separate.

The macOS workflow runs Foundation-only HealthFood state/mapping checks before the unsigned simulator/device builds. Physical acceptance still must cover: allow/deny and partial permissions; unknown versus known-zero quantities; same-day edit/Undo/delete/re-enable; source-labelled weight/manual priority; interrupted upload and locked-phone retry; logout/account/server change during a read/write; current-account-only deletion; Health syncing between devices. A successful unsigned build cannot verify these behaviors.

### Home-screen and Shortcuts food entry (#122 T1)

While signed in, press and hold the app icon → Log food to open the permanent chat with its composer focused. Existing text stays. In Shortcuts/Siri, Log food in Kinetta takes a Food string (including text from Dictate Text), uses the last signed-in account scope and opens the chat. Review and tap Send; the action does not log automatically. A missing signed-in scope cannot stage a request. A cold shortcut waits for the app to confirm the current server/account before delivering its draft. With a cached signed-in account, local drafting works offline; actual food uploads still require server authentication.

The protected local inbox has bounded size/expiry and no shared credentials. Lost acknowledgements/reloads retain the draft without duplicating it; storage failure keeps the request waiting. An entry that would exceed the composer limit is skipped with feedback, allowing later entries to continue. Physical home-screen/Siri/keyboard/locked/account-change acceptance remains pending. Share to Kinetta (photos, screenshots and links) is not implemented by T1. T2 is a separate storage foundation; its extension UI/runtime remains deferred and Workstream T stays open.

Apple references: [scene quick actions](https://developer.apple.com/documentation/uikit/add-home-screen-quick-actions), [intent authentication policy](https://developer.apple.com/documentation/appintents/appintent/authenticationpolicy), [foreground launch compatibility](https://developer.apple.com/documentation/appintents/appintent/openappwhenrun). No signed upload or TestFlight release is implied by a successful unsigned build.


Activity reactions offer Cheers, Strong and Applause, with one choice per account/activity. Selecting another replaces it; tapping the selected choice removes it. Existing Cheers endpoints remain compatible. The “Cheers & reactions” notification switch preserves the existing `cheers` preference. A recipient receives at most one new reaction notice per actor/activity within a day; switches update its label without repeated pushes. Removing a reaction cancels its pending notice, and per-device delivery rechecks cancellation, preferences and session ownership. Actual iPhone delivery requires the documented APNs key/team configuration and notification permission on the device. Tests use generated keys and stand-in transports only.

## Protected-data recovery and notification invitation acceptance

The workout observer treats HealthKit's database-inaccessible error as a temporary protected-data pause. It records a retry marker without advancing the anchor or changing pending UUIDs. While the process can run, protected-data availability triggers the existing sync; activation and later HealthKit wakes also retry. A registered `BGAppRefreshTask` is a fallback, requested no earlier than one minute later, with a 25-second local deadline plus iOS expiration cancellation. iOS chooses whether and when it runs. These are best-effort recovery paths, not a promise of delivery within a minute or after a force-quit.

The existing device-only credentials, protected local queue, source types, redirect refusal, account checks and server UUID deduplication remain in use. Logout/disconnect cancels the scheduled task and active work. The pause has no user-facing error; an actual failed retry keeps its pending references and an actionable error. A successful retry clears the stale error. No tokens or Health contents are logged.

Apple references: [protected Health data while locked](https://developer.apple.com/documentation/healthkit/hkerror/errordatabaseinaccessible), [protected-data availability notification](https://developer.apple.com/documentation/uikit/uiapplication/protecteddatadidbecomeavailablenotification), [registering background tasks at launch](https://developer.apple.com/documentation/backgroundtasks/bgtaskscheduler/register(fortaskwithidentifier:using:launchhandler:)), and [app refresh tasks](https://developer.apple.com/documentation/backgroundtasks/bgapprefreshtask).

Automated evidence is deliberately limited: the Foundation-only Swift tests exercise the actual durable record's pause/unlock, killed/relaunched round trip, queue/anchor preservation, stale-error clearing and repeated UUID acknowledgement with Health/network stand-ins. They do not emulate iOS scheduling. Configuration tests check the registered identifier, `fetch` mode, retained Health entitlement and launch registration order. Unsigned simulator/device builds check compilation; they do not establish physical background delivery.

Physical-iPhone checks (pending; use a throwaway test account and a developer-approved test server):

1. **Locked, app still resident:** connect Health, verify one normal workout, leave Kinetta, lock the phone, then let a new fictional/test workout arrive in Health. Unlock to another app. Observe whether iOS gives Kinetta time, and verify that one activity and its existing workout alert appear. Repeat a delivery and verify that it remains one activity. Connections must not retain an Unlock error after success.
2. **Suspended:** leave the app suspended, repeat the locked arrival/unlock sequence, and observe both the protected-data event and scheduled-refresh behavior when iOS permits execution. Inspect only counts/status, never tokens or raw Health contents. Expire a refresh task in the debugger; completion must occur once, queued UUIDs must survive, and the next opportunity must resume.
3. **OS termination:** arrange a locked pause, terminate the process without clearing app data, then relaunch through the next permitted background wake or activate the app. The preserved anchor/queue must retry safely and create one activity. Separately force-quit from the app switcher: record iOS's suppression of automatic delivery if it occurs, then verify one safe upload on the next activation. Do not promise a force-quit wake.
4. **Account/disconnect:** disconnect or sign out while paused, then unlock or trigger the fallback. No old-account upload may occur. Connect a second account on the same device and confirm it cannot inherit the first account's queue, cursor or registration.
5. **Notification invitation:** ordinary launch while already signed in and fresh sign-in both offer one short native invitation when push is ready and off. Turn on must show the real Apple permission prompt and register through the current session. Deny it, then verify the explanation and Open iPhone Settings action; allow in Settings and verify registration after return.
6. **Quiet contexts and choices:** Not now is remembered per account/device for 30 days, with at most two offers. Check a second account separately. Another sheet, focused field/software keyboard, active/paused recording, Health permission steps, notification tap, URL link and food shortcut must not be interrupted. Return to an ordinary tab home on a later ordinary app entry and verify eligibility. Manual Notification settings remains available.

Release evidence must state which scenarios ran on a physical iPhone. Browser screenshots use a labelled native-bridge stand-in; they do not verify Apple's permission dialog, native Settings, lock/unlock timing, APNs delivery or VoiceOver. The recovery fix requires a new iPhone build. The invitation's web/native adapter code is bundled into the app too; distribute an updated build for these bundled pages, while server readiness and registrations remain server concerns. Merge, deployment and TestFlight upload require separate owner approval.
