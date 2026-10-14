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
