# mobile/: the Kinetta iPhone app

A [Capacitor](https://capacitorjs.com) shell around the phone pages in `app/static`. There is no second copy of the
app: `npm run sync` copies `app/static` into `www/`, and Capacitor builds that into the iPhone app. What's different
inside the app lives in `app/static/native.js` (it does nothing in a browser):

- requests go to the server chosen at login, with the login token in an `Authorization: Bearer` header instead of the
  cookie (the pages aren't on the server's address). The server allows this one origin, `capacitor://localhost`
  (`APP_ORIGINS` in `app/main.py`);
- Me > Apple Health: permission, sync, and the AI coach consent. Workouts go to `POST /api/health/workouts`
  (`app/api_health.py`).

Plugins: [`capacitor-health`](https://github.com/mley/capacitor-health) (HealthKit, later Health Connect) and
`@capacitor/preferences` (keeps the server address and login). Both come in through Swift Package Manager; there is
no CocoaPods.

## Build

On a Mac with Xcode 26 or newer:

```sh
cd mobile
npm ci
npm run sync          # copy app/static into the app, update the native project
npx cap open ios      # opens Xcode; pick a Simulator and press Run
```

Apple Health works in the Simulator too: open the Health app there and add a workout by hand first.

Without a Mac: every pull request that touches `mobile/` or `app/static/` is built on a GitHub Actions Mac runner
(`.github/workflows/ios.yml`). The Simulator build is attached to the run as `Kinetta-simulator` for 7 days.

## After changing the phone pages

Bump the `?v=` numbers in `app/static/index.html` as usual. The app picks up the change the next time it's built;
people with the app need an app update to see it.

## Native background component

`HealthBackgroundSync.swift` starts at application launch and observes HealthKit workouts. Anchored query pages atomically save their anchor and pending UUIDs in `HealthSyncState.swift`. Routes and heart rate are read at upload time; read errors leave UUIDs queued. The record uses iOS file protection and is excluded from cloud backup. Background credentials use a device-only Keychain item. Each successful server acknowledgement removes only its matching UUID. Expired authentication pauses the queue. Logout/disconnect cancels reads/uploads and deletes the credential and queue. HTTP redirects are refused to keep bearer credentials on the chosen server.

The existing foreground importer remains available, including failed-history retry. Uploads use the same HealthKit UUID so replay between the two paths is deduplicated by the server. The engine requests finite background execution time; if iOS suspends it, pending UUIDs remain for the next HealthKit wake or foreground activation. This does not promise continuous or immediate background uploads.

Pure Swift queue checks are in `tests/main.swift` and run in the iPhone workflow before its build. The simulator can test permissions/foreground queries, but Apple requires physical-device testing for background delivery. See [the acceptance checklist](../docs/ios.md#background-sync-device-acceptance).

## Release gates

Background sync implementation is in development; Mac compilation and signed real-device acceptance are still needed. Signing and upload are implemented conditionally in
GitHub Actions; missing Apple secrets skip the upload. See [docs/ios.md](../docs/ios.md) for setup and
[beta readiness](../docs/beta-readiness.md) for owner steps and approval gates.

## Health food bridge foundation (#122 I3)

`KinettaHealthFood` adds separate explicit body-mass read and nutrition-write permission methods. It is registered but not called by the UI until the next workstream-I wiring PR. It stores no credentials and makes no network requests. The WebView must bind the signed-in server/account before every operation and stop the bridge before logout, disconnect or account replacement.

Weight uses an anchored query with source labels and explicit deleted UUIDs, kilograms, a500-object page and25-second timeout. The caller acknowledges the returned batch only after server acceptance; interrupted uploads replay safely. Settings epochs reset the anchor. An empty read does not reveal permission denial.

Nutrition uses the server's changed-day pages, a hashed server/account/day/type sync identifier and revision metadata. Calories use kcal and the four macros/fiber use grams. Known zero is preserved; unknown/deleted values delete only matching samples written by this app, with an older-or-equal version predicate. A page cursor is saved only after all permitted operations succeed. Denied types are skipped, shown separately in status, and a changed permission set resets the cursor to reconcile old days. Disabling/disconnecting does not delete other apps' Health records.

The protected, backup-excluded local file holds only the current owner's cursor/anchor. Account changes invalidate query callbacks; stop waits for an already-submitted Health mutation before completing. No new background-delivery promise is made for these categories: the UI syncs on open/resume in the follow-up. Physical permissions, partial grants, writes/updates/deletions, lock/unlock, account changes and device-to-device Health synchronization remain pending.

## Food quick action and Shortcuts (#122 T1)

After sign-in, the native bridge installs a dynamic home-screen Log food action. Cold and warm scene shortcuts stage an owner-scoped request and open the existing food composer. The App Intent Log food in Kinetta takes text, requires device authentication and requests foreground launch. It stages text for review, never automatic logging. The public backwards-compatible `openAppWhenRun` property supports the app's older iOS deployment target; physical behavior on supported versions still needs acceptance.

Requests use a private app-container file with complete file protection and backup exclusion, a hashed server/account owner,5-item/4,000-UTF16-unit limits and24-hour expiry on read. No App Group or credential sharing is added. Successful sign-out/deletion clears the inbox/action once. Session expiry and failed sign-in preserve the owner-bound inbox; deletion pauses delivery until the password succeeds. A cached signed-in account can receive a local draft offline, while posting still requires server authentication. A separate expiring receipt journal makes interrupted draft writes and acknowledgement replay safe, including after Send clears the draft. Existing text is preserved. Entries that would exceed the composer limit are skipped with feedback so later entries proceed; storage failures keep the native item waiting.

The macOS workflow runs Foundation-only inbox contracts and unsigned builds. Physical acceptance: cold/warm home action, keyboard opening, Siri phrase and dictated Shortcuts input, locked authentication, signed-out no-op, existing/long draft, interrupted acknowledgement, unavailable server and account/server changes. Share extension is a separate T2; no private app-launch API is used.
