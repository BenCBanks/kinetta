# Guided Strava history: backend contract

The web **Upload activities** page uses this resumable flow for Strava ZIP archives.
Single FIT, GPX, TCX and gzip recording uploads keep using `POST /api/import` and
`GET /api/imports`, whose contracts are unchanged.

The browser hashes the archive in bounded slices on a worker, sends pieces of at most
8 MiB, and shows the dry-run counts and current activity privacy before confirmation.
Leaving the page pauses transfer; reselect the same ZIP to resume from the server
offset after a reload or on another device. A different file cannot resume it.
Confirmed imports continue on the server. The upload page never opts into reminders.

All endpoints below require the signed-in account, except the opaque reminder-stop link.
Cookie and native bearer authentication use the same ownership checks, including
`X-Kinetta-Account` when supplied. Upload IDs do not authorize another account.

1. `PUT /api/strava-import/stage` with `{reminder_opt_in:false}` records that the person
   requested their archive. Opt-in must be an explicit `true`; it requires verified email
   and available mail configuration. `GET /stage` returns the saved stage, current upload,
   current activity audience, piece size and maximum archive size, across devices/relaunch.
2. `POST /uploads` with `{id:<client UUID>,size:<bytes>,sha256:<hex>}` reserves an upload.
   Repeating the same identity/length/hash returns it; changing its content is rejected.
   No filename, Strava download link or external credentials are accepted or saved.
3. `PUT /uploads/{id}/pieces/{offset}` sends **raw octet-stream**, at most **8 MiB**, with
   `X-Content-Sha256`. The response's `received` is the authoritative next byte offset.
   A lost-response retry compares existing bytes. Interrupted writes are truncated back
   to the committed offset before the next append. Query status before resuming.
4. `POST /uploads/{id}/finalize` verifies the complete length and SHA-256 and queues a
   dry-run. Poll `GET /uploads/{id}`. A valid Strava `activities.csv` is required; unrelated
   ZIPs and empty archives fail explicitly. `preview` contains `added`, `already_here`
   and `unreadable` counts. No activities, gear, food or AI are written/called by preview.
5. Show the account's **current activity privacy** in the review. Import requires
   `POST /uploads/{id}/confirm` with `{confirm:true,audience:"me"|"friends"|"everyone"}`.
   The supplied audience must equal the current saved setting; a changed setting requires
   refreshing the review. The server captures it at confirmation, with no private override.
   Later setting changes do not alter that job. Matching workouts keep their existing
   audience, title and edits. Matching is rechecked after preview; actual results can differ.
6. Confirmation starts durable work. `result` reports actual added/already_here/unreadable
   counts. Activity writes and the next-item cursor commit in one transaction. A fresh
   worker resumes queued/importing rows after restart. No coach/provider calls occur.
   `DELETE /uploads/{id}` cancels remaining work; already imported workouts remain.
   `DELETE /stage` also cancels all pending uploads and the reminder.

Upload states: `uploading`, `preview_queued`, `review`, `importing`, `done`, `failed`,
`cancelled`. Errors use fixed codes, never archive names or private parser exceptions.
The underlying duplicate matcher is heuristic; preview is an estimate, not a guarantee
that two independently recorded activities are the same.

## Resource limits and recovery

Conservative initial limits: 2 GiB/archive, two active uploads and 4 GiB reserved/account,
16 active uploads and 12 GiB globally; ten upload reservations/account/day and 100/day
across the server. Reservations are serialized in SQL, survive restarts and include
expired bytes until cleanup. Pieces have length and SHA checks. At most two receiving bodies
per application process, and one per account in that process, bound transient memory.
Body reception has a 15-second idle and 60-second total deadline; 408 releases both slots
and leaves the saved offset unchanged. Every write retains at least 25% free
disk and 1 GiB headroom, also reserving expected pending bytes on admission.

Archives allow 20,000 entries, 10,000 workouts and 8 GiB declared uncompressed content;
individual workout/gzip output is capped at 32 MiB and CSV at 8 MiB. Central-directory
size is checked before allocation. Path traversal, links, encryption, duplicate names,
unsupported compression and expansion ratios over 200 are rejected. Nothing is extracted
by archive path. Individual recording parsers run in bounded child processes (512 MiB
address space, 15 CPU seconds, 25 wall seconds). Preview has a ten-minute bound; import
passes yield after about one minute and start directly at the saved cursor, without
reading completed items. Corrupt gzip/recordings count as unreadable; unexpected archive
processing failures are terminal, allowing the queue to advance. SQL/session failures
and lack of disk space remain resumable. One SQL-backed worker lock serializes parsing
across application processes. Worker writes use the same connection holding that lock;
session loss stops writes and rolls back uncommitted work. The cursor is rechecked under
the account/job write locks before adding a workout or updating its receipt.

Staged bytes expire after seven days, including interrupted work. Terminal archives are
removed; an expired upload's SQL receipt remains until directory removal succeeds,
including partial removal errors. Later passes retry; account-deletion orphans are
reconciled only under canonical Strava staging paths, leaving other uploads alone.
Stage/reminder metadata expires after 90 days. Account deletion cascades both
personal tables and uses the existing account uploads-directory erasure. A cancelled
or expired import does not roll back workouts already committed. SQL readers see only
their own rows; ordinary/public SQL roles cannot modify either table.

These limits are foundations, not a multi-GB phone/tunnel performance claim. Native Files,
background transfer, the public proxy and physical-iPhone acceptance belong to the client
follow-up. The future client must recognize `?strava=resume` on Connections and reopen the
saved stage; this backend adds that deep link to reminder copy but no client handling.

## Optional reminder

No reminder is scheduled by default. Explicit opt-in schedules approximately 24 hours
later, once, for that account. Repeated requests/devices retain the original due time.
Verified email and a pending, non-expired stage are checked again before sending.
Due time and expiry are rechecked under the claim lock; expiry is checked again under
the send lock using the database wall clock after any lock wait.
Import confirmation, cancellation, account deletion and the opaque one-click stop URL
cancel it. The message links to Connections with `?strava=resume`; it includes no Strava
link, archive name or workout data. Copy lives in two replaceable constants.

An attempt is durably claimed **before** sending through the existing mail sender.
A provider timeout/crash after that claim is never retried, preventing duplicate emails;
consequently a reminder can be lost on an uncertain send. The account retains at most
one reminder attempt while its stage record exists, even after toggling opt-in again.
Tests require mail to be unconfigured in the disposable server, replace the mail sender,
and block its HTTP transport as a second guard. Reminder coverage uses stand-ins only;
tests never send actual mail.
