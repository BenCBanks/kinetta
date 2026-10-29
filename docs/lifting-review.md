# Lifting usability review · 29 October 2026

This is follow-up software work in combined PR344. It does not establish a signed phone release or physical-device acceptance.

## Requirements

1. Start empty, repeat a past session or resume the current session without duplicate taps. Show useful loading/error recovery. Empty Progress offers Start lifting.
2. Support weight × reps, bodyweight/optional added weight and timed holds. Previous values stay readable; copying them preserves the original kg rather than converting a rounded display value back to kg. Warm-ups do not count as records or working volume.
3. Add, reorder, annotate and remove exercises; remove/warm-up sets; preserve Undo while the original session is current. Search and custom exercises retain the query when loading fails and offer Retry.
4. Save edits in order, including across navigation. Finish waits behind autosave and keeps its finish intent. A late acknowledgement cannot replace a newer unsent draft. Account/server changes cannot replay another person's draft or deferred write.
5. Keep planned sets when Finish fails or is cancelled. Exclude unticked sets only from a successful finished submission. Delete waits for outstanding writes; a failed delete restores saving even if its dialog was dismissed, and late completion does not redirect a newer view. Device-storage failure does not block successful server saves or falsely claim an offline copy exists.
6. Restore rest timing and session drafts after a normal reload. The session duration starts at zero and the summary agrees with the clock. Keep the four-hour server limit.
7. Review title, totals, records, per-exercise previous values and sharing after Finish. Carry on returns to the session within its allowed window. An owner can find Edit sets from activity detail; finished-session edits, history and records remain reachable. Unfinished sessions remain private.
8. Check 390px, short330px,330px with24px-root enlargement, desktop and both themes. Preserve keyboard/drafts, readable controls and Sky Blue. Test actual controls, delayed/failed writes and saved state, not just screenshots.

## Findings and repairs

- **Finish during autosave:** reproduced a false “Session saved” result with the activity still open. Session writes now queue in order, and Finish awaits its own successful response before opening the summary.
- **Draft/retry safety:** newer typing stays dirty when an older response returns; navigation flushes pending edits; account/server-scoped drafts, stale-view guards and serialized discard prevent unrelated writes. Unidentifiable legacy unscoped local drafts are retained in device storage but are not automatically replayed into an account. Existing server-saved sessions remain available.
- **Precision and clarity:** copying rounded lb could turn an unchanged set into a spurious record. The original kg is now authoritative for copy/placeholder actions. Previous-set numbers wrap; weighted rows use a compact dated previous-set line on the narrowest phones so supported decimals/reps/seconds and44px controls fit. Added-weight removal respects its explicit choice, and varied weighted bodyweight sets no longer duplicate the weight in their text.
- **Timing/discovery:** rest state survives reload, quick sessions no longer acquire a fabricated one-minute minimum, activity detail offers Edit sets, and empty Progress offers Start lifting. Failed recent/exercise lists have clear recovery. Day/time fields stack when narrow or enlarged so their selected values remain readable; the shared paired-field layout follows the same rule elsewhere.

## Verification record

Both full interaction passes passed all eight layout/theme configurations with real disposable lifting API writes. It covered repeat, exact previous values in both units, bodyweight/added weight, timed sets, notes/order, rest/reload, failed exercise search/Retry, custom exercises, remove/Undo, cancelled and failed Finish, summary, Carry on, title/sharing, finished edits and exercise history.

`test_lift_lifecycle.js` exercises the real logger handlers with controlled write completion, account changes and storage failure. The old source fails its Finish assertion. The lifting API suite passes54 checks including zero initial duration and clock agreement. The final pass also checks supported numeric widths and opens Finish at the title; enlarged summary cells no longer overlap. The rendered regression runs in the screenshot workflow and fails the old stylesheet. Source32e738b and the later field-fit/summary sourceb6dc6f3 each passed the entire original suite twice. Exact final revisions, current CI and the required whole-suite pair after subsequent repairs are recorded in PR344. Four website lifting/history frames were refreshed and inspected in both themes. No model or real notification delivery is involved.

A later cancellation audit reproduced a second data-loss path: after the delete dialog was dismissed, a failed delete could leave autosave stopped. Recovery now resumes independently of the dialog, retains typing during pending deletion and avoids redirecting a newer view. Real API reproductions in normal/light and narrow/enlarged/dark save the new value after repair; the previous source retains the old value. New real-handler tests cover dismissal, leaving during a pending failure and late-success navigation. First-use/past-session/blank-field/warm-up/delete/discard interactions also pass in both themes. The required final whole-suite pair includes this repair. A further first-use pass checked the past-session day/time values in normal and enlarged text; the rendered CI regression measures those selected values against their available width.
