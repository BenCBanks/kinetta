> **Archived, 28 October 2026.** This feature is outside current product scope. The following describes historical implementation, not available behavior. Future reconsideration and provider/offline/device limitations are tracked in [#328](https://github.com/BenCBanks/kinetta/issues/328).

# Share a planned route

Open a route under **Track → Routes → My routes**, then **Share this route**. New routes start **Only me**, independently of your activity-sharing default. Choose **Approved friends** or **Everyone on this server**, a public name and an optional public description. Private notes are never prefilled into the public description. You may choose a shorter stretch before previewing.

**Preview for recipients** shows exactly the protected map, name, sport, shared distance, available climb and public description they will receive. The server applies the current start/end hiding setting as well as your selected stretch. A three-metre rounding margin protects the clipped boundaries. At least 200 metres must remain; a too-short route is refused rather than falling back to the original. Review the whole visible course: endpoint hiding is not a geofence around every sensitive place a loop might revisit.

Tick the acknowledgement and **Share this preview**. A changed route, privacy setting or sharing revision requires another preview. Retrying the same successful confirmation does not publish twice or restore an older audience. A private edit afterwards does not change the reviewed publication: review and publish another preview when you want to update it. Moving to a narrower audience also uses an explicit preview; **Make the original private** revokes sharing immediately.

## Find, copy and export

The **Shared** tab has **Everyone routes** and **Shared by friends**, name search, sport, distance/climb filters and an explicit map-area search. Unknown climb does not pass a numeric climb filter. The initial map fits visible results; no live location is collected. Results describe plans, not proof that someone travelled a path or is currently there. Search and result pages are bounded; repeated requests can be temporarily limited.

A recipient sees only the shared projection. The JSON, map, preview and GPX never contain the original extents, hidden waypoints, private notes, original full distance, activity IDs, timestamps, sensor readings or provider request metadata. Shared distance and heights refer to the shared line. Increasing endpoint protection can immediately shorten an existing publication, or make it unavailable if too little remains. Decreasing protection does not expand an old reviewed publication.

**Save a private copy** is a deliberate confirmation. It creates an independent, editable route from only the data currently shared with you. It starts Only me. The retry receipt survives a lost response; repeating the same confirmation creates one copy. If you already removed that copy, a stale retry cannot recreate it. Source changes and unsharing do not rewrite a deliberate copy. Deleting the creator removes the original and clears the copy's source link while preserving its new owner's route. A source name or description copied as public content is part of that independent copy; copies, downloads and screenshots cannot be remotely recalled.

**Download shared GPX** confirms what goes into the file and rechecks access and the reviewed projection. The iPhone handoff uses a single-use Safari link that expires after 60 seconds. That link also requires the originating login session still to be active and rechecks friendship, blocks, the audience and current privacy protection when redeemed. A changed route requires another review. A server restart may expire a link earlier.

**Share this link** sends the existing shared URL through Web Share when available, or displays it for copying. Cancelling the system share sheet changes no publication. Everyone opening a link must sign in to the same Kinetta server and still be eligible. Signed-out pages contain generic Kinetta sign-in content, without route names, maps or descriptions; successful sign-in returns to that route. The iPhone universal-link handler checks the server origin before navigating. Physical installation and Messages/share-sheet behavior need separate device acceptance.

## Revocation and offline behavior

Every shared view, search, copy and export checks the same access rule: the creator must have a confirmed active account, the route must still be shared, current friendship approval must permit Friends access, and neither member may have blocked the other. A copied URL grants no additional access. Original recipient pages do not use persistent app/API caches and reauthorize when brought back into view. An unavailable or unverifiable original hides its prior map and offers Retry. Already delivered screenshots or disconnected downloads cannot be erased remotely.

The deliberate private copy uses your own route library and its normal device behavior. Downloading a revocable original for an active recording, session-pinned following and offline progress are separate work under #279. The sharing implementation does not claim to complete those recorder requirements or to add offline basemap tiles. See [route services and rights](routes.md).

## Report and moderate

Recipients can report unsafe/restricted access, personal-location disclosure, an inaccurate path or abusive content, with a short note. Duplicate open reports are deduplicated and each reporter can have at most 20 open route reports. Reporting alone does not remove the route or reveal the reporter to its creator.

The separate admin portal has **Shared route reports**. Opening a case shows only its currently published, currently protected route and public description, plus the submitted reason/note. It never opens the private original. If sharing was revoked, only an unavailable notice and Dismiss remain. Reads are audited. **Dismiss report** or **Remove route sharing** requires the current material version, a reason and the exact creator username. A changed projection cannot be actioned from a stale review. Removing sharing preserves the private route and deliberate copies, revokes original access and prevents that route from being republished without support. Decisions use durable operator retry receipts; private case reasons do not become public route descriptions.

## Implementation and verification

Migration 75 adds owner-only RLS tables for publications, previews and copy receipts, and an administrator-only report table with no reader grant. The private source stays in the existing versioned route tables. Publications are an explicit field allowlist; height axes are normalized to the visible stretch and source/provider metadata is discarded. Preview expiry is 15 minutes. Search scans at most 200 eligible candidates and returns at most 25 results per page, with at most four concurrent discovery queries per app process. Application request limits supplement those bounds; they do not replace operator-wide abuse controls.

Copying locks the current publication, source account/privacy state and the relevant friendship/block pair through commit. Revocation uses the same pair lock. An authorized copy therefore commits before the competing block/unfriend, or is refused afterwards. Source account deletion removes publications/previews, and foreign keys anonymize deliberate copies' source links. Personal exports include the new owner-held tables; deletion removes their account rows. Raw private GPS/activity stores gain no additional reader grant.

Automated API, SQL/RLS, concurrency, retry and client-account guards use fictional data and stand-in heights. Browser checks cover phone light/dark, desktop and enlarged text, including review, discovery, private copy, GPX, sign-in return, reports and revoked originals. Browser/native stand-ins and unsigned builds do not close physical-iPhone acceptance. No production deployment, provider notice or TestFlight upload is implied by implementation.

Shared originals can also be saved on the device and used in Track after a fresh access check. Only the currently shared protected stretch is downloaded. Revoked/changed originals leave the reusable cache when learned; a workout already started keeps its previously authorized snapshot until completion. An independent private copy follows its own rules. See [route following](route-following.md).
