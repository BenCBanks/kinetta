# Returning from Apple Health permissions

The reported symptom was a wait in Kinetta after tapping Done on Apple's individual permission choices. Without a
physical-device trace we cannot establish the exact callback that stalled. Inspection found several concrete ways the
old flow could wait indefinitely: two sequential authorization requests, awaited background-delivery registration,
and a large first import (including routes/heart rate) held under the same “Asking…” button. A pre-connection auto-sync
could also suppress the initial import for ten minutes.

The app now issues one combined read-only request through its own native plugin, on the main thread, coalescing
repeat taps. After permission completion it records only that syncing is enabled for the current account; it does not
claim individual read grants. The page becomes usable independently of background registration and the first import.
Import progress explains the current phase. Device reads/uploads have bounded waits, retain retry cursors and release
busy state after failure. Late callbacks cannot enable a timed-out connection or cross an account boundary.

“Manage Health access” opens the supported app settings route and explains how to reach the individual switches in
Health → profile → Apps/Apps and Services → Kinetta. Re-requesting previously decided read permissions is not a way to
reopen those switches. Empty results may mean no records or denied categories; never infer a granted/denied bit.

Sources inspected: [Apple authorization guidance](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data),
[Apple requestAuthorization](https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization(toshare:read:completion:)),
and the installed `capacitor-health` 8.4.0 source/its [upstream documentation](https://github.com/mley/capacitor-health).
Apple's privacy protections intentionally prevent an app from distinguishing denied read access from missing records.

Regression coverage uses stand-in callbacks and isolated data. Simulator/device/archive compilation is CI evidence;
manual permission selection, return from Done, leaving/reopening the app and a real Health import still need physical
acceptance. The app never writes Health records and AI consent is separate.
