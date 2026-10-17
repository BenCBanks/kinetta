# Sharing food into Kinetta on iPhone

Workstream T adds a Share extension for a food description, one photo or a secure recipe link. The native storage foundation is implemented first; it does not yet add a Share-sheet action or send food.

## Durable, private queue

The containing app and extension use a process-shared filesystem lock for short local operations. Each job belongs to one normalized HTTPS server and account, using a SHA-256 owner digest. Stable UUIDs make a replay harmless and reject replacement content. Twenty pending jobs per account bound storage. An explicit queued job stays until acknowledgement, deliberate discard or account deletion; it does not expire overnight.

Images are limited to 3 MiB and have a recorded byte count and SHA-256 digest. Image bytes are saved before an atomic metadata commit marker. Interrupted writes cannot advertise a committed job without its photo. Uncommitted orphan images are cleaned up on the next scan; unreadable committed jobs remain available for explicit recovery rather than silently disappearing.

Food-job files contain no credentials. The eventual runtime uses a separate non-synchronizing shared Keychain item, accessible only while the device is unlocked, on this device. A session generation prevents stale work from acknowledging or revoking a later login. Account switches hide the other account's queue, while signing back into the same account can recover its pending jobs. Deleting an account erases only its queue and matching active credential.

The foundation has no network request, Health access or UI. App Group and Keychain entitlements, signed-in binding, lifecycle cleanup, image decoding/resizing and Share-sheet composition must be wired in the following runtime change. No production entitlement or permission is enabled by the foundation.

## Verification and remaining acceptance

The macOS workflow runs fictional Foundation tests for server validation, owner/session changes, immutable retries, disk round trips, byte/hash validation, missing acknowledgement, three-day retention, late acknowledgement, cross-process capacity and deletion isolation. Its credential fixture is outside the tested Group directory and never touches the real Keychain. Both unsigned iPhone builds also compile these sources.

Physical iPhone checks remain required for Photos/Safari sharing, lock/authentication, interrupted delivery, offline retry, account changes, VoiceOver, Dynamic Type and the configured App Group/Keychain provisioning. An unsigned build does not establish these behaviors. No automatic containing-app launch is promised: use public extension APIs only, with an honest saved/waiting state when opening Kinetta is required.
