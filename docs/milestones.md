# Private milestones

A new achievement appears on the activity that earned it, at the bottom of the relevant Food day,
and in **Me → Recent milestones** for seven days. The highest achievement leads; **+ more** opens
other offers. Share opens a picture preview, and Dismiss removes the offer permanently.

The fixed first release includes first sports, first run/walk 5K, 10K, half and marathon distances,
standard-distance personal bests, calendar-year 100/250/500/1,000/2,000km or miles, 4/12/26/52 active
weeks, and 7/30/100/365 cumulative food-logging days. Missing a food day never resets progress.
There are no body, weight, calorie or macro achievements.

Pictures use the existing recap renderer and approved colors. Photo and username start off.
A private activity displays a reminder before sharing because the picture can show time and distance.
Safe Garmin attribution follows contributing records. Cancelling the share sheet retains the offer.
If sharing succeeds but its receipt cannot save, Finish retries only that receipt.

**Me → Notifications → Milestones** starts off. When enabled, it allows at most one notification per
local day. Notification text says only that a milestone is ready to review; it contains no workout,
food, real name or location. Native transport is verified with stand-ins; physical push remains a
separate signed-device acceptance check.

Imports and edits enqueue a small coalesced job; a background worker derives fixed facts, without
scanning history on page requests or calling AI. Existing history and arrivals over seven days old
stay silent. An edit or deletion hides an unshared offer until the job confirms its current facts.
Only the best standard-distance personal best on each local day remains offered. Shared snapshots
stay in the person's private export; external pictures cannot be recalled. Account deletion cascades
the state, offers and notifications. Read-only SQL access exposes only the owner's milestone rows.

Migration 82 adds private state and offer tables, an optional notification reference and enqueue
triggers. It keeps existing activity and food records. Its worker takes the account lock first, matching
account erasure, and claims work separately from the dirty state row so history scans do not block saves. A changed generation discards the scan and retries. Quiet history
sleeps until data changes or an actual future entry becomes eligible. Push dispatch starts after commit. No live migration,
deployment or push delivery is implied by passing local tests. Implementation is tracked in [#296](https://github.com/BenCBanks/kinetta/issues/296).
