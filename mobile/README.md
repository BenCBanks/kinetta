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

## Not yet

Signing, TestFlight and background sync: see [docs/ios.md](../docs/ios.md).
