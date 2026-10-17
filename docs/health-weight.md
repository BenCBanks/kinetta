# Apple Health weight input

This backend foundation is part of #122 Workstream I. It does not yet query HealthKit or add native permission controls.

`GET /api/health/weights` returns the signed-in person's status, profile time zone and synchronization epoch. `PUT /api/health/weights/preferences` requires boolean `enabled` and, when enabling, explicit `confirmed: true`. It defaults off. A state change invalidates older batches and clears weight-specific AI consent; disabling retains private raw samples but removes Health projections from weight history and derived profile weight. Re-enabling restores eligible samples.

`POST /api/health/weights` accepts that epoch/time zone, a recent timezone-aware `observed_at`, at most 500 measured samples and 500 explicit deleted UUIDs. Each sample has its Health UUID, timezone-aware measurement date, kilograms (20–400), source name and optional source bundle. UUIDs cannot change their measured date or weight. Deletes are permanent tombstones. Empty batches do not imply denial, missing history or deletion. Settings changes reject stale uploads.

The latest sample per profile-local day becomes a Health-labelled weight point. Existing manual or imported points win. Deleting a day in Kinetta prevents old Health measurements from restoring it; a genuinely later measurement can still appear. This only affects Kinetta: it never deletes another app's Health data. Health deletion clears a cached Health-derived profile weight when no weight points remain. Existing targets, day overrides, macros and resting-energy choice are preserved.

Raw samples and deletion exclusions are private, have row-level SQL read policies, appear in the owner's export and cascade with account deletion. The coach SQL role cannot read these raw tables. General Health-dependent AI checks require both the global Health permission and a fresh Health-weight permission if Health weight is present; old workout permission alone is insufficient.

Apple's [body mass type](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/bodymass) uses a discrete mass quantity. Native implementation must convert it to kilograms and observe explicit sample deletions. Apple's [privacy rules](https://developer.apple.com/documentation/healthkit/protecting-user-privacy) explain why an empty read cannot reveal whether read permission was denied.

Physical iPhone permission, background delivery, lock/unlock, account switching and deletion behavior remain unverified until the native implementation and device checks. No device data is used by backend contract tests.

Review corrections: legacy Health Auto Export weights use the same opt-in, source provenance, manual priority and AI consent as native weights. Deleting a Health point excludes its sample identities across time-zone changes; manual re-entry lifts the local-day fence. Manual history imports clear Health provenance and Undo restores eligible Health points. Normal upload pages rebuild only touched days. Turning reading off prevents projection rebuilds; saving the same effective time zone does not rotate the epoch.
