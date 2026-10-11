# The Lankki iPhone app

The iPhone app is the same Lankki you use in Safari, inside a real app, so it can read **Apple Health**. Garmin, Apple
Watch, Coros, Wahoo, Strava and most other apps write their workouts to Apple Health, so once you connect it, your
workouts show up in Lankki without uploading files.

It isn't on the App Store or TestFlight yet. This page is the plan, and the list of what the maintainer needs to do in
the Apple Developer account before testers can install it.

## What the app does today

- **Log in to your own server.** The login screen asks for the server's address (`https://app.lankki.com` by default,
  or your own). The server must be on `https://`; iPhones don't let apps talk to plain `http://` addresses.
- **Me > Apple Health.** Explains what Lankki reads (workouts, heart rate during workouts, routes), then shows Apple's
  permission sheet. Lankki only reads; it never writes to Apple Health.
- **Sync.** The first sync brings in the last 30 days ("Also bring in the past year" goes further back). After that,
  the app sends new workouts whenever it's opened or brought back to the front. Each workout is sent with Apple
  Health's own id for it, so a workout sent twice is stored once. A workout that's already in Lankki from somewhere
  else (a Garmin file, a Strava export) isn't added again either.
- **AI coach consent.** The coach reads Apple Health workouts only after you tick "Let the AI coach read my Apple
  Health workouts". Until then the coach is off for anyone with Apple Health workouts (Apple's rules require consent
  before health data goes to an AI service).

## The plan (roadmap step 3)

1. **The app and Apple Health permission** (done in this first piece): the shell around `app/static`, the permission
   screen, syncing when the app is open, the server endpoint, and a build on GitHub's Mac computers for every change.
2. **TestFlight**: signing and uploads from GitHub Actions (fastlane), once the Apple Developer setup below is done.
   Internal testers (people added to the App Store Connect team) can install it right away; outside testers need a
   privacy policy page first (roadmap step 2) and Apple's beta review.
3. **Background sync**: new workouts arrive even when the app isn't opened (HealthKit background delivery; needs a
   small piece of our own Swift code and one more Apple capability).
4. **More from Apple Health**: weight, resting heart rate and sleep.
5. **App Store**: needs delete-my-account in the app and the privacy policy (roadmap step 2), screenshots, and a demo
   account for Apple's reviewers.
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
   - Description: `Lankki`
   - Bundle ID: **Explicit**, `com.lankki.app`
     (if Apple says it's taken, pick another, such as `com.lankki.ios`, and tell me: it's set in
     `mobile/capacitor.config.json` and the Xcode project)
   - Capabilities: tick **HealthKit** only. Leave "Clinical Health Records" unticked. (Background delivery comes later.)
4. **Create the app in App Store Connect.** **Apps > + > New App**:
   - Platform: iOS. Name: `Lankki` (must be unique on the App Store; try "Lankki: Workouts & Food" if it's taken).
   - Primary language: English (U.S.). Bundle ID: the one from step 3. SKU: `lankki-ios`. User access: Full Access.
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

8. **Set up TestFlight testers.** In App Store Connect open the app > **TestFlight > Internal Testing > +**, name the
   group `Family`, and add people. They need to be on your App Store Connect team (**Users and Access > +**, role
   "Customer Support" or "Developer" is enough). Each tester installs the **TestFlight** app from the App Store.
9. **Fill in App Privacy** (App Store Connect > the app > **App Privacy**), needed before outside testing or the App
   Store. Answers for Lankki: data collected: **Health & Fitness** (Health, Fitness), **Contact Info** (name),
   **Identifiers** (user ID); all *linked to the user*, *not used for tracking*, used for *App Functionality*. If the
   AI coach is on for your server, also tick *Health* under "data shared with third parties" and describe the coach.

When steps 1 to 7 are done, tell me and I'll add the signing and TestFlight upload to the GitHub Actions workflow.
Nothing else in the code has to change.

Later, before outside testers or the App Store, Apple will also ask for:
- a **privacy policy URL** (roadmap step 2; for a HealthKit app it must say how health data is used),
- **delete my account** inside the app (roadmap step 2),
- a **demo account** on the hosted server for Apple's reviewers (a `zz_test...` account with demo data),
- screenshots at 6.9-inch iPhone size (the app is iPhone-only, so no iPad screenshots are needed).

## For developers

See [mobile/README.md](../mobile/README.md).
