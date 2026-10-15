# Native iPhone notifications

Kinetta sends phone alerts through Apple Push Notification service (APNs), to the native iPhone app only.
Browser and Home Screen web-app push delivery is retired. Everyone can still read their own notification history
under the bell in Kinetta.

A workout that arrives by itself (from Apple Health or your watch, or Garmin sync) in the last 24 hours gets a private
“Nice work! Morning Run saved” alert with its distance in your units and duration. Only its owner receives it. Workouts
you type in or upload yourself, duplicate uploads, richer details arriving later, and older history imports stay quiet.
The number on the app icon is your unread count; it clears when you read your notifications in Kinetta. No AI service writes these messages. Friend requests, Cheers, comments and shared meals use the same
native delivery and retain separate notification preferences.

## Apple account setup (server owner)

1. In Apple Developer → Certificates, Identifiers & Profiles → Identifiers, open your app's identifier (the bundled
   app uses `com.kinetta.app`). Enable **Push Notifications**. Regenerate the distribution provisioning profile with
   this capability, or let Xcode automatic signing update it during the signed build.
2. In Keys, create a key with **Apple Push Notifications service** enabled. Use a Production key for TestFlight and
   App Store builds. A sandbox-only key is for development builds. Record the Key ID and your Apple Team ID and
   download the `.p8` private key. An App Store Connect API key is a different credential and cannot replace it.
3. Configure `KINETTA_APNS_TEAM_ID`, `KINETTA_APNS_KEY_ID` and `KINETTA_APNS_TOPIC` on the app server. The topic must
   match the app bundle ID. Supply the private key as `KINETTA_APNS_PRIVATE_KEY` (PEM, optionally escaped newlines)
   or `KINETTA_APNS_KEY_FILE` (a read-only file mounted inside the container). Keep it outside source control.
   The example Compose file passes the inline environment option; for a file, add a read-only mount and set the file
   variable to its container path in your own Compose override.
4. Rebuild the server and ship a new signed iPhone build. The export check requires the production `aps-environment`
   entitlement before TestFlight upload. Old installed builds do not gain the capability from a server update.

APNs uses HTTP/2 and ES256 provider tokens. Production and sandbox device tokens go only to their respective fixed
Apple host; there is no user-supplied delivery URL. Provider JWTs refresh after 50 minutes. Device tokens are stored
on the server with their authenticated session and user; logout or deletion of that session revokes registration.
An installation that logs in as someone else moves to that account. Invalid/expired tokens are removed after Apple's
response. The app requests a fresh device token on registration; it does not persist APNs tokens locally.

## On the iPhone

Open **Me → Notification settings → Turn on iPhone notifications**, then allow Kinetta in Apple's permission prompt.
Switch **New workouts** off if you do not want workout congratulations (they then don't appear under the bell
either). Logging out and back in to the same account turns alerts back on by itself. Turn off on this iPhone revokes
this device's registration and is remembered; iOS Settings → Notifications → Kinetta controls Apple's system permission. Permission is never requested
just by opening the app. Tapping an alert opens its activity or the corresponding Kinetta page.

If the server's APNs credentials are missing, the settings page explains that setup is incomplete. It must not claim
that a registration or a passing test means Apple has delivered a real notification. TestFlight uses production APNs.
A physical iPhone must verify permission, background delivery, alert taps, account switching, and logout after rollout.
No tests send alerts to real devices: transport tests use a generated key and a mocked HTTP client.

References: [Registering your app](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns),
[Token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns),
[Sending alerts](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns).
