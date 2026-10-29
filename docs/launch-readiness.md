# Launch work and acceptance checklist · 29 October 2026

All 27 open issues and their comments have been reviewed. Twenty implementation issues are **in review** in
[combined PR344](https://github.com/BenCBanks/kinetta/pull/344); five P3 issues remain deferred. Physical-device
acceptance (#305), owner overview acceptance (#300), and real map hosting/coverage/cost remain open gates.
No issue is closed merely because its code passes. Component PRs are draft review aids and must not be merged
independently. This checklist does not authorize merge, deployment, enrollment changes, billing or TestFlight.

## Current implementation

| Work | Priority | Result in the combined candidate |
| --- | --- | --- |
| [#325 Friends](https://github.com/BenCBanks/kinetta/issues/325) | P1 | Allowed profile viewers see the count; the list stays owner-only. Friends opens the list first, with filtering and clear remove/block confirmations. |
| [#327 maps](https://github.com/BenCBanks/kinetta/issues/327) | P1 | Operator-configured raster/vector/PMTiles, attribution, independent failed tiles, cancellation and reachable Retry. Configured vectors have real dark styling. A light-only raster stays light with a legible route stroke. USA hosting and optional UK cost/coverage remain operator gates. |
| Saved-route deferral | Owner scope | Planning, saved libraries, sharing, downloads and following are removed from active app/help/site/native links. Recorded maps, completed matched routes, personal heatmaps and fixed segments remain. Future reconsideration is [#328](https://github.com/BenCBanks/kinetta/issues/328), P3. |
| [#332 recipe gap/deletion](https://github.com/BenCBanks/kinetta/issues/332) | P1 | One native safe-area clearance; title first; visible owner-only trash with confirmation that existing logged portions remain. Actual Simulator OS-bar evidence passes on compact and Pro. |
| [#333 stationary charts](https://github.com/BenCBanks/kinetta/issues/333) | P1 | No unmeasured stationary speed in charts, summaries, feed or pictures. Explicit manual values remain. Genuine HR uses time and appears only when shared, even when pace is private. |
| [#335 account deletion](https://github.com/BenCBanks/kinetta/issues/335) | P1 | Account-before-segment locking prevents the reproduced worker/deletion deadlock. Deterministic concurrent-erasure coverage passes. |
| [#355 bounded admin retry](https://github.com/BenCBanks/kinetta/issues/355) | P1 | One materialized locked candidate set enforces the 100-job limit. Worker-held rows, administrator checks, request protection and audit remain intact. |
| [#340 food-first Me](https://github.com/BenCBanks/kinetta/issues/340) | P1 | Today's food leads private Overview when logged. Historical food or goals alone retain the training layout. Later approved #353 removes Latest activity globally. Cold loading resolves placement before exposing plan controls. |
| [#341 deliberate recipes](https://github.com/BenCBanks/kinetta/issues/341) | P1 | My Recipes manages/creates; Add food logs. Fresh ingredients cannot silently become an old whole recipe. Name first, Save recipe, logging off initially, explicit meal/portion review. Quick actions have pictograms and Kit stars. Drafts stay separate. |
| [#347 private native photos](https://github.com/BenCBanks/kinetta/issues/347) | P1 | Image caches/requests are fenced by server/account/session, cancelled and revoked on changes. Optional share identity photos use authenticated bounded decoding. |
| [#349 yesterday copying/type](https://github.com/BenCBanks/kinetta/issues/349) | P1 | One quiet outlined Copy yesterday action with meal/all-meal review replaces repeated links. Dates, original meals, unknowns, durable retry and Undo remain. Normal phone type is distinguished from enlarged stress tests. |
| [#350 prediction help](https://github.com/BenCBanks/kinetta/issues/350) | P1 | Short visible caveat, collapsed How estimates work, separated pace/source lines and clearer spacing. Prediction numbers and source links remain intact. |
| [#351 every-screen review](https://github.com/BenCBanks/kinetta/issues/351) | P1 | Full route inventory, actual navigation/retry/draft/loading checks and multiple visual passes. Findings fixed include map painting over tabs, clipped restored food drafts, narrow headings and startup recovery. |
| [#352 admin age/Kit](https://github.com/BenCBanks/kinetta/issues/352) | P1 | Private birth year/approximate age and confirmed editable operator Kit access. Consent/18+ and provider/product/release status stay separate. Blocked or known-under-18 generation is denied; manual tools remain. No production account changed. |
| [#353 profile/home/Activity](https://github.com/BenCBanks/kinetta/issues/353) | P1 | Profile-first Me, private Overview / Only you, one Activity feed and separate searchable private history. Customize section visibility/order, featured sports and selected stats with real draft/audience previews. Optional setup can be hidden/restored. Refresh preserves unchanged cards/maps. |
| [#354 website/enrollment](https://github.com/BenCBanks/kinetta/issues/354) | P1 | Seven current pages, 56 fictional screenshots, rich shared feature guide, clear open/waitlist/full/invitation paths and preserved card/friend/challenge intent. [Official competitive evidence](feature-priorities.md) informs prominence. Publication remains separate. |
| [#294 recaps](https://github.com/BenCBanks/kinetta/issues/294) | P2 | Local week/month/year pictures match Progress; optional food/identity start off, private highlights stay unnamed, Garmin source credit retained. |
| [#295 public cards](https://github.com/BenCBanks/kinetta/issues/295) | P2 | Off-default revocable username-only cards/QR with explicit pending requests, accurate preview and policy-respecting signup/confirmation/waitlist continuation. Exported QR pictures decode. |
| [#296 milestones](https://github.com/BenCBanks/kinetta/issues/296) | P2 | Fixed once-only firsts/bests/totals, silent historical imports, withdrawal after edits/deletion, cumulative food days, optional notifications initially off. |
| [#297 challenges](https://github.com/BenCBanks/kinetta/issues/297) | P2 | Fixed templates, explicit join without friendship, aggregate progress/private targets, participant-local dates, limits, leave/remove/block/end and 90-day cleanup. |
| [#293 sharing parent](https://github.com/BenCBanks/kinetta/issues/293) | P2 | All four children integrated; parent remains open through review and acceptance. |
| [#305 intervals](https://github.com/BenCBanks/kinetta/issues/305) | P1 | Existing software is covered. [Signed physical-device matrix](interval-acceptance.md) remains required for locked/background/offline/audio/GPS/battery behavior. |
| [#300 private overview](https://github.com/BenCBanks/kinetta/issues/300) | P2 | Maintained owner reference and business/opportunity assessment delivered privately. Separate Garmin-AI consent retained by owner decision; plain-language owner read-through remains. |

P3 [#275](https://github.com/BenCBanks/kinetta/issues/275), [#273](https://github.com/BenCBanks/kinetta/issues/273),
[#280](https://github.com/BenCBanks/kinetta/issues/280), [#281](https://github.com/BenCBanks/kinetta/issues/281) and
[#328](https://github.com/BenCBanks/kinetta/issues/328) remain deferred. The earlier food-macro #319 was completed
separately in PR322. There is no current P0 incident.

## Earlier completed software verification

App candidate **bc8e58e** includes the guide/navigation and native-runner follow-ups. Later website wording and
acceptance-document updates do not change its app, server, migrations, native wrapper, test suite or fixtures. Concrete CI links and reviewed captures are in PR344.

- The entire original `dev/tests/run.sh` passed **twice**, on independent fresh databases in America/New_York and UTC.
  Syntax, generated content/design/contrast, API/SQL/RLS/concurrency, native state, AI/push stand-ins and synthetic
  evaluation contracts are included. No paid model was called; synthetic contracts are not accuracy evidence.
- Combined schema **80→86** preservation/defaults upgrade passed. No migration changed after that check.
- Two deliberate code reviews covered ownership/access/validation/locking and lifecycle/retry/UI/maintenance,
  with targeted rechecks after later fixes. Reproduced lock inversions, stale responses and cache leaks were fixed.
- All **56 route definitions / 82 explicit views × 8 configurations = 656** inventory captures pass runtime,
  meaningful-content, overflow, internal-clipping and loading checks. Normal phone top/bottom views, short/enlarged
  critical views and desktop comparisons were inspected. The inventory alone is not interaction evidence.
- Five final eight-configuration interaction matrices cover profile/audience/customization/refresh, enrollment,
  loading/recovery, first use/recipe management vs logging, and recipe keyboard/draft/deletion behavior.
- All required GitHub checks pass on the app candidate: complete tests, screenshots, admin checks, unsigned iPhone
  compilation/archive and both real Simulator jobs. All **20 native captures** were inspected with actual OS bars
  and positive stable safe areas, including enlarged food-field fitting. TestFlight/beta jobs were skipped.
- Website checks cover **56 page/width/theme combinations**, 14 local destinations, gallery/lightbox/keyboard,
  feature search/empty states and reduced motion. All **54 fictional phone frames** and 44 full-page review strips
  were inspected. The final shared-guide instructions/counts passed two eight-configuration browser runs, including
  actual app destinations. The obsolete duplicate template catalog was removed; all 59 entries still come from the
  app catalog. Successful fictional map tiles are labelled as substitutes, not actual hosted coverage.

Final visual findings have meaningful regressions: loaded map layers stay below tabs/sheets and credits do not
cover drawing instructions; restored/empty food composers fit after entry and resizing; narrow enlarged headings
keep words intact. The old source fails the corresponding browser assertions. Polling preserves production CSP.
An additional read-only semantic-name check across 82 views found no unnamed focusable controls; this is separate
from physical VoiceOver acceptance. Old home/selector/shortcut renderers and their unused styles were removed;
compatibility migrations/storage were retained.

## Subsequent PR rereview and lifting audit

All13 PRs and current review comments were rechecked. Source1eb3df2 passed the entire original suite twice on fresh New York/UTC databases, the schema80→86 preservation upgrade and all GitHub checks. Final656 app layouts,56 website layouts/14 destinations, repeated recipe-recovery/sharing flows and eight crop interactions pass. All20 compact/Pro native captures from identical-native-tree7df4bb4 were inspected. PR344 records the exact code-only AI fingerprint trace, fixes and outstanding release gates.

The subsequent [lifting review](lifting-review.md) repairs Finish/autosave, draft/account safety, copied-value precision, previous-value clipping, timing and discoverability. Its final revision and whole-suite/browser evidence are recorded in PR344; the prior1eb3df2 results do not stand in for these later changes. Additional configurable notification research is explicitly queued after all prior work; it has not started.

## Required behavior

### Recipe creation and editing

- My Recipes → Create a recipe opens a fresh ingredient editor. A pending Add food conversation is retained separately; it must never become the recipe’s ingredients implicitly.
- Recipe name appears above ingredients/nutrition in creation, editing and review. Long names wrap and remain editable.
- A saved whole recipe must not replace milk, espresso or sugar supplied as individual new ingredients. Known source quantities remain authoritative; unknown weights/nutrients are not invented. Remembered shots require a known per-shot weight.
- Save recipe cannot proceed with a pending request, unresolved ingredient match/clarification or unsent ingredient; cancelling an ingredient fences late replies. Save recipe is a clear action. Changes saving as the person builds must be disclosed accurately. No food entry is written when Add to log is off; it starts off for deliberate creation.
- Add to log explicitly leads to meal/portion review. Cancellation, retry, lost acknowledgements and account changes cannot duplicate or misdirect a food write.
- Visible trash opens an app confirmation that says existing logged portions remain. Reader views cannot delete another person’s recipe.
- Add food retains its own logging purpose and optional recipe saving. My Recipes, Take a photo, Scan a barcode and Search foods use Kit’s existing suggestion-bubble style; + remains available. Quick actions make no model call merely by appearing.

### Spacing, layout and keyboard

- Apply safe-area clearance once. Check native WebView inset configuration, CSS padding and sticky/fixed positioning together. A toolbar must not sit an extra safe-area height below the status bar.
- Native evidence must show the actual OS status bar or record the real WebView/safe-area measurements. A browser with a fabricated inset is a stand-in and must be labelled as such. Do not present a blank fabricated band as proof that native spacing is correct.
- Check recipe editor/review, Add food, Kit, Friends, profiles, activity detail/charts, recording, plans, settings, public cards and all newly added flows.
- No horizontal clipping or overlapping controls. Titles, body text, labels, units and errors wrap. Long content remains reachable by scrolling. Main buttons are centered/full width where appropriate; targets are at least44px and inputs at least16px.
- Verify330/390px, a short phone, desktop, both themes and enlarged text. Use approved Sky Blue tokens and maintain readable contrast.
- Opening/closing the keyboard retains drafts and visible focused fields/composer. No app-supplied Done bar. Preserve background/swipe dismissal, text selection and normal control actions.
- Capture only after animations/layout settle. Review every representative screenshot before attaching it.

### Home, social and activity privacy

- Food today appears above the weekly chart when this local day has food, with useful numbers visible on opening. Latest activity is removed throughout Me under the later #353 direction. A goal or historical food alone keeps the normal training layout. Adding/removing today’s food updates the arrangement without shifting an exposed control during the initial load.
- Friend count is visible to anyone allowed to see the profile; the friends list stays owner-only. Pending, blocked, suspended and unconfirmed accounts follow existing rules.
- Stationary HR-only recordings have no artificial speed line. Explicit values and normal outdoor charts remain useful. HR requires real samples and the owner’s sharing choice. Private pace must not be reconstructed from paired time/distance series.
- No private account, activity, location or food data enters public fixtures/screenshots/issues. Use made-up demo and zz_test records only.

### Sharing features

- Recaps: local week/month/year totals include private-workout aggregates and match Progress; empty/lifting/unknown cases are honest; Food and identity are opt-in; no body or location data; private activity highlights are not named; Garmin attribution remains visible. Cancelled sharing does not dismiss an offer.
- Cards: off by default, username-only, selected photo/sports/up-to-two stats with explicit private-aggregate disclosure, revocable random links and accurate previews. Opening a card never auto-friends. Requests are pending, limited and owner-approved; signup confirmation, blocked/unconfirmed/suspended/deleted owners and disabled/rotated links are enforced. Do not bypass server signup/waitlist settings.
- Milestones: fixed first/best/total thresholds, cumulative food days rather than food streaks, at most one visible banner, once-only records, silent older imports, edits/deletion invalidation, private-activity reminder and off-default notification settings.
- Challenges: fixed templates and generated names, explicit joining without friendship, only username/photo/aggregate progress shared, private food/protein targets, per-participant local dates, live totals after natural completion (late imports/entries/edits/deletions), no repeated completed-notice worker jobs, limits, immediate leave/remove/block behavior, end/finish pictures and90-day cleanup.
- Reuse the reviewed child issues for detailed behavior. Do not replace their acceptance criteria with this shorter summary.

## Remaining acceptance and release steps

Signed physical-iPhone camera, share sheets, QR/install/link preview, push, VoiceOver and locked/background spoken
intervals remain external evidence. Browser emulation, actual Simulator UI and unsigned archives do not establish
those results. Real hosted USA coverage, optional UK cost, retention/disclosure, provider activation and device map
performance remain operator decisions. The private overview still needs the owner's plain-language read-through.

Review, merge, deployment, website publication, enrollment policy, TestFlight upload and Apple processing are distinct
steps. No live consent/sharing setting or account was changed. PR344 is the combined review path; component PRs are
review aids. Keep [ROADMAP.md](../ROADMAP.md), [UI acceptance](ui-acceptance.md), [profile requirements](profile-home-requirements.md)
and the private owner overview aligned when any gate changes.

## Activity charts first — owner follow-up

Charts lead beneath the activity summary; dense numbers and insights move to Details. Own and shared activities keep their existing audiences, stationary speed and HR rules, reactions and explicit tab links. No-chart activities open Details. Named series, units, subtle fills, honest missing-sample gaps and keyboard/touch inspection are covered by the new rendered activity regression. Final combined evidence is recorded in PR344; earlier revision checks do not establish this later scope.
