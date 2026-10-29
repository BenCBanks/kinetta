# GPS recording and save review

Selected October 29, 2026, [#358](https://github.com/BenCBanks/kinetta/issues/358). This follows the completed software
review in PR344 and optional notification work in PR357. Software is implemented in PR359; the verification record below distinguishes automated checks from deployment and
physical-iPhone acceptance.

## Requirements

1. **Average pace:** show accepted distance divided by the whole activity's active time, consistently labelled
   Avg pace (Avg speed for rides/skiing). Exclude manual and automatic pauses exactly as the existing timer does.
   Never replace the average with a rolling estimate. No movement/time means an unknown rate, not zero.
2. **Lap pace:** until a manual press, use consecutive one-mile boundaries. This default is one mile even for a
   metric account; displayed pace/speed/distance units still follow the account. The first Lap press finishes
   activity start → press, including any earlier automatic miles. Each later press finishes the previous press →
   current press and starts a new manual lap. Automatic miles never reset a manual lap. Existing mile/km splits
   and spoken split preferences stay independent. Pause/resume does not create a lap or include paused time.
3. **Durability:** native GPS owns lap boundaries, as it owns time/distance. Save a boundary before acknowledging
   it; repeated delivery of the same mark is harmless. Retain boundaries across backgrounding, termination,
   recovery and account/server changes. Older journals still load. Keep interval Skip/End separate from Lap.
   Review and saved activity show manual laps and the final partial lap, alongside ordinary distance splits.
4. **Expanded map:** a deliberate map tap or visible expand control opens it; Close, Escape and Back return.
   Panning/pinching retain their jobs. Time, GPS, drafts and lap state continue. Keep recording controls reachable,
   the map's attribution visible, safe areas correct, focus trapped/restored and background scroll released on exit
   or navigation/account change. Preserve follow/whole-route intent and all recorded sections.
5. **Review before save:** a compact Review activity page contains title, headline distance/time/average, map and
   locally selected photos, then measured charts. Put other statistics, splits and laps in Details & splits.
   Show the audience clearly. Save activity stays available above the tab bar while scrolling. Retain Continue
   recording and deliberate Discard. Timer-only and no-sample recordings have useful honest alternatives.
6. **Pictures:** select/remove before saving, with existing image validation, maximum ten, an aggregate upload
   bound, orientation correction and metadata stripping. Keep pixels in a committed account/server/recording-bound
   local database, separate from the frequent GPS checkpoint. No image reaches the server before explicit Save.
   Save activity and pictures in one transaction. Retrying an uncertain save uses the exact confirmed request,
   including its pictures, so neither pictures nor activities double. Do not silently drop new fields on an older
   server/native build. Account deletion erases this account's local review data; another account cannot read it.
7. **Failures:** short, truthful retry text, with draft retention. Distinguish unknown network outcomes from
   definite validation/sharing failures. Preserve useful backend permission/validation feedback. Disable conflicting
   edits while saving or while resolving an uncertain confirmed request. Storage failure must never claim a photo,
   lap or confirmed request is durably kept when it is not.
8. **Charts:** reuse the activity chart system, units, colors, direct values and keyboard/touch inspection. Show
   only measured pace/speed/elevation available to this recording, preserving gaps and unknowns. No invented HR,
   bridged pause, decorative fake chart or AI call. Bound work for long recordings and resize without resetting drafts.

Out of scope: saved-route libraries/planning/following, new sensors, Health writes, paid map activation, AI changes,
P3 features and guaranteed locked-screen GPS accuracy. Stable five tabs, Sky Blue, keyboard dismissal, privacy,
receipt idempotency, separate Garmin consent and existing intervals remain constraints.

## Research and product choice

[Apple's running guide](https://support.apple.com/guide/watch/run-with-apple-watch-apd73a43493f/watchos) lists average
pace and separate Segment/Split workout views. Its [workout controls](https://support.apple.com/en-gb/guide/watch/apd72879df4d/26/watchos/26)
let people mark a segment and review it afterward. [Garmin Auto Lap](https://www8.garmin.com/manuals/webhelp/legacy/EN-US/GUID-97010D91-30E5-42CD-871D-ED17CA77C5AC.html)
marks laps at a chosen distance, supporting comparison between parts of the activity.

[COROS](https://support.coros.com/hc/en-us/articles/48574240254868-Auto-Laps-and-Distance-Alerts-for-Running) explicitly
separates actual laps from fixed mile/km split views. In its unstructured runs a manual mark restarts the automatic
distance, and in structured workouts Lap advances the workout. **Kinetta intentionally differs:** the owner selected
manual-only boundaries after the first press, starting that first manual lap at activity start. Kinetta's interval
Skip control remains independent, avoiding an overloaded Lap button. This is a product decision, not a claim that
every tracker uses the same behavior.

[Strava's recording guide](https://support.strava.com/en-us/articles/15402137-how-do-i-record-an-activity-on-strava)
describes a dedicated recording view followed by pause/finish/save. Kinetta keeps that separation and adds a local
photo/chart review. No source requires copying Strava's full interface or calculation choices.

## Design and evidence plan

Fresh fictional 390px browser captures cover running, paused and review states. The existing review puts splits
before the map, has no photo/chart preview, and requires scrolling to Save. Native/browser source inspection also
finds the large live rate switches to a rolling 30-second estimate. External tile requests were deliberately blocked
for the initial capture, so its Map unavailable state is test setup, not evidence of a provider outage.

The implementation follows the established Sky Blue tokens, system sans hierarchy, 22px phone gutters, quiet white
surfaces, 16px media corners and minimum 44px controls. Native safe area is applied once. Default phone body text is
15–16px; rem-based enlargement can reflow into fewer columns instead of clipping. No root-font reduction.

Two private image concepts ground the complete live/expanded and scrolling review states. Functional corrections to
the concept are explicit: preserve the existing Map/Stats header placement and navigation icons, keep Continue
recording (omitted by the image revision), and pin Save above tabs rather than placing it in the scrolling content.
Existing source SVGs, real runtime maps and user-selected photos replace concept artwork; no image becomes the UI.
Expanded-map layout retains compact current values and controls. Paused states use existing Resume/Finish/Discard.
Failures, photo removal/loading, no samples, old builds and long/enlarged labels use these same component families.

Validation: arithmetic and shared fictional fixtures; Swift journal/recovery tests; authenticated API photo/lap,
limits, atomic rollback, concurrency, receipt retries and audience tests; local-database and stale-account tests;
real-control browser matrices at normal/narrow/enlarged/desktop sizes in light/dark; map gestures/Back/Escape/focus;
keyboard/draft/photo failure checks. Run the entire original suite twice on final code, fresh install and applicable
preservation upgrade, two source/UI passes and native CI. Inspect final screenshots directly against both concepts.
Physical GPS, camera picker, locked-screen/audio and VoiceOver remain explicitly separate acceptance evidence.

## Software verification · October 29

Core code **4e2a5b2** passed the entire original `dev/tests/run.sh` twice on independent fresh New York/UTC
installations. The cumulative **schema80→87 preservation upgrade** retained fictional accounts, activities, food,
recipes, weights, birth year/consent and explicit notification choices. GPS adds no migration or model-facing change.

Two source-review lenses cover arithmetic/durable native journals and authenticated atomic saves, then account/navigation
races, photo storage, acknowledgement loss, rollback/quota concurrency and lifecycle/UI behavior. Authenticated tests
include six simultaneous first saves, repeated receipts, image sanitization, privacy, validation, deletion tombstones,
a failed second photo rolling back the whole save and independent recordings competing for the photo limit.

Final ten-layout real-control browser matrices pass on Playwright1.48 and1.63, in both themes at390px, short330px,
enlarged330px and desktop. They exercise manual laps, map tap versus pan, focus/Back/Escape, photo preparation/removal
across navigation, local storage failure, charts, reload, old-server rejection, definite validation failure and an exact
uncertain-save retry. The final visual pass keeps narrow-screen pace units together; this CSS-only correction and the
additional map-gesture assertions passed both rendered matrices. No body or input type was reduced.

CI Tests, screenshots, iPhone compilation/archive, Foundation tests and both compact/Pro Simulator jobs pass for4e2a5b2.
Forty actual Simulator captures cover recipe/food plus live/map/review at normal/enlarged sizes; the twenty changed GPS
captures were inspected against the private concepts. Final phone browser captures and both themes were also reviewed.
The website passes56 responsive/theme pages and14 local destinations; its training copy now describes average/lap pace,
expanded maps and photo/chart review. The shared59-feature guide and262 contrast pairs pass.

Tests use fictional data and blocked device/write/provider calls. External map tiles are blocked in browser/native
fixtures; Map unavailable in that evidence is intentional. Physical GPS/camera/locked-screen/voice/VoiceOver acceptance,
real map hosting and actual notification delivery remain separate. Merge, hosted deployment, Pages and the final signed
iPhone upload are tracked independently in the linked PR and release records.

Final map-failure follow-up: on short live maps, compact Retry map feedback fits beside attribution and below GPS,
with44px actions. The full failure message stays available to screen readers. Real-control assertions check the
warning stays inside its map without covering GPS. Map failure/contract/late-layer checks pass; this changes
only map feedback presentation, not tile fetching, recording or save behavior.
