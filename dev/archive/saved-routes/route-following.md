> **Archived, 28 October 2026.** This feature is outside current product scope. The following describes historical implementation, not available behavior. Future reconsideration and provider/offline/device limitations are tracked in [#328](https://github.com/BenCBanks/kinetta/issues/328).

# Follow a planned route

In the iPhone app, open a route and choose **Use in Track**, or choose **Save and use in Track** after editing a plan. Track also offers **Add a planned route** and **Choose a route**. You can use your own route, a private copy, or a currently shared original that you can access. No segment or leaderboard enrollment is needed. Choosing a route does not start a recording or change your activity audience.

Review the sport, version, start/finish and any legacy or gap warnings before Start. The distance to the planned start is a straight-line distance from a recent clear position, not directions to reach it. A stale or inaccurate fix leaves that distance unknown. The map preview's automatic location check uses permission already granted; choosing a route does not prompt for new location permission. Locate me is an explicit request, and Start uses the existing iPhone recorder and permission flow.

New routes must follow mapped paths; imported guide points are replanned before saving. If a path cannot be found, keep editing or retry.

## Save the route on this device

**Save route on this device** stores a complete route line, version, warnings and credits for this account and server. Use in Track also completes that download. The route page shows its size and version and offers **Remove device download**. Up to 30 routes and about 4 MiB of route data fit in one account's library; normal device storage limits can be smaller. A failed write keeps the previous complete download and selection. Free storage and retry.

**Route saved; offline basemap unavailable** means the line is stored, including when map tiles are missing. Tile-region downloads are not offered. New routing, heights, searches and routes that have not been downloaded require a connection. When disconnected, Track's chooser lists completed downloads. A different route version is a separate deliberate choice; a failed fetch does not silently substitute a different saved version.

Shared-original access is checked when selecting, downloading, starting while connected, and checking saved routes after returning online. Revoked originals and changed shared projections are removed from the reusable device library when learned. Account/server changes purge shared-original downloads and their selected-route copy. Owned downloads remain isolated for the same account; deliberate private copies follow their own ownership rules. Opening an unavailable shared original also clears its revocable device copy. Kinetta cannot recall a disconnected person's previous independent export or private copy.

## During a recording

Start pins the reviewed route snapshot into the account-bound native recording journal. Its large line is written once separately from the small GPS checkpoint manifest. Library edits, source edits and reusable-download removal cannot move that route during the workout. A shared original that is subsequently unshared or blocked leaves this already-started snapshot available until the recording finishes or is discarded, as the review explains. A source account's deletion does not erase another person's actual workout. Deleting your own account clears its device route library, selected route and native recording journal; a local cleanup failure is reported so app storage can be cleared.

The plan is dashed with direction arrows and start/finish markers. The recorded GPS trail is solid, and your current location is a dot. The legend names all three. **Follow me / Whole route**, panning and zooming control the view; a user pan does not get pulled back on the next map update. Gaps between route sections are not drawn as verified connecting paths.

Distance along and remaining appear only when the position match is sufficiently clear. Matching uses direction and the nearby upcoming section, rather than jumping to a later loop or a return leg. Starting partway can show **First matched partway**. Gaps, backwards travel, overlapping sections, poor accuracy and stale fixes can leave **Route position uncertain**. This does not stop the recording. Completion is informational and never presses Finish for you. There are no turn instructions, rerouting, spoken off-route alerts or safety guidance in this release.

**Measured distance, active time, splits and auto-pause remain based on actual recording data.** The plan, its length and its progress cannot supply workout totals or competitive segment times. Following is independent of any future interval preset engine; interval presets themselves remain separate work under #274, and combined physical-device acceptance remains open.

Pause/resume, permission loss, offline save and interruption recovery retain the existing recording protections. Native recovery preserves the pinned line even when the WebView's reusable cache is gone. Older journals without a route still open. Damaged optional route metadata can be dropped while the measured workout journal survives. Older iPhone builds that cannot persist route snapshots ask you to update before starting with a route; clearing the route still permits ordinary recording.

## Private history and verification

Saving a recording stores the selected plan's name, source kind, route ID/version, snapshot identity and planned length privately with the activity. It stores no second server-side route geometry and never refetches hidden source portions at save time. This history is user-supplied context, not evidence that an uploaded recording is authentic. Owner detail and data export include it; shared activity payloads do not. Activity/account deletion removes it. Recording receipts keep upload retries stable, including when a phone recording merges with an existing Watch workout; a retry cannot resurrect a deleted activity.

Automated fixtures cover direction, loops, overlapping/out-and-back sections, gaps, stale/poor fixes, partial starts, offline geometry, cache writes, version pinning, revocation, account guards, private SQL readers, export/deletion and unchanged measured totals. Browser native callbacks and GPS positions are explicitly stand-ins. They do not verify an actual iPhone's lock/background behavior, force-quit durability, permission prompts, Safari/Files or outdoor accuracy. A signed physical-iPhone run and the operator/provider review in [routes.md](routes.md) remain release gates.
