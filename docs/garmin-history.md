# Garmin activity history

Checked October 23, 2026, against Garmin's official developer documentation.

Garmin Connect brings **new activities after the watch syncs**. For older history, import a Strava export or past workouts available in Apple Health in the iPhone app. Apple Health can only import workouts the source has shared; Garmin does not send GPS routes to Apple Health. Original FIT, GPX or TCX files remain another import option.

## What Garmin documents

The [current Garmin Connect Developer Program page](https://developerportal.garmin.com/developer-programs/connect-developer-api) covers both Activity API (JSON/FIT) and Health API (JSON). It lists:

- Starter: push delivery only, no historical data, up to 1,000 connected users.
- Enterprise options: push or ping/pull delivery, history of one month or more, with capabilities and commercial terms tailored to the integration.
- Activity/Health event delivery follows the user's device sync.

The linked [Start Guide/API documentation](https://developerportal.garmin.com/developer-programs/programs-docs) and [FAQ](https://developerportal.garmin.com/developer-programs/faqs) returned HTTP 403 without portal access during this check. The older developer.garmin.com Health/Activity pages returned 404. Public pages therefore do not verify evaluation versus production key permissions, an exact backfill request window, or successful history delivery for any particular application. A sign-in or accepted request is not proof that historical activities arrived.

## Kinetta's behavior

Connection status, browser callback and iPhone callback text promise new activities after a watch sync and explain the older-history import options. They do not promise that Garmin is sending the previous 30 days. Sync now describes a resend request conditional on Garmin access.

The existing best-effort backfill request remains: it can serve access that supports history and does not prevent saving a connection or receiving new pushes when Garmin rejects it. Non-409 HTTP failures set an informative connection status; other failures log an exception type. A 409 is treated as an already-requested response. Tests use a stand-in Garmin to cover denial while retaining the connection and normal new-activity ingestion. These tests establish behavior under simulated responses, not Garmin service delivery or production approval.

Operational log checks are inconclusive when there are no failure messages: HTTP failures are saved as connection status rather than printed as `garmin backfill failed`. No historical-data promise should be inferred from silence. Confirm endpoint entitlement in the authenticated portal and actual historical delivery before strengthening the wording.
