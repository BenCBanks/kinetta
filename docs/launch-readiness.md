# Launch work and acceptance checklist · 28 October 2026

This consolidates the owner’s requests and all 24 currently open issues. It is the working acceptance plan; it does not claim that an open PR is deployed. Keep [ROADMAP.md](../ROADMAP.md) as the ordered queue, and update this checklist as evidence arrives. P3 work is explicitly deferred. No merge, hosted deployment, billing activation or TestFlight release is authorized by this checklist.

## Current state

| Work | Priority | Implementation and remaining acceptance |
| --- | --- | --- |
| [#325 Friends](https://github.com/BenCBanks/kinetta/issues/325) | P1 | [PR330](https://github.com/BenCBanks/kinetta/pull/330): complete local regression suite, eight browser configurations and CI passed. Final combined UI/account/privacy review remains. |
| [#327 maps](https://github.com/BenCBanks/kinetta/issues/327) | P1 | [PR334](https://github.com/BenCBanks/kinetta/pull/334): configuration, real dark vector maps, attribution, exports and failure handling tested; CI passed. Real USA coverage, optional UK cost, hosting, billing, retention and physical performance remain release steps. |
| Saved-route removal | P1 owner scope | [PR331](https://github.com/BenCBanks/kinetta/pull/331): active planning/library/sharing/following removed; completed activity maps, matched routes and segments retained. Full suite/browser/CI passed. Verify all combined app, website, native-link and help references. Future reconsideration is [#328](https://github.com/BenCBanks/kinetta/issues/328), P3. |
| [#332 recipe gap/deletion](https://github.com/BenCBanks/kinetta/issues/332) | P1 | [PR339](https://github.com/BenCBanks/kinetta/pull/339): repeated inset in the fixed editor corrected and visible trash/confirmation added; full suite/browser/CI passed. Actual native run40774161633 passed all16 compact/Pro cases with OS status bars: safe-top20/Back30 and safe-top62/Back72. The repeated recipe inset is resolved in that scope. Physical device and final exact-head combined review remain. |
| [#333 stationary charts](https://github.com/BenCBanks/kinetta/issues/333) | P1 | [PR338](https://github.com/BenCBanks/kinetta/pull/338): no generated zero-speed line; available HR is shown only with sharing permission, including when pace is private. Full suite/API/browser/CI passed. Follow-upc6738f9 also removes unmeasured speed from summaries/feed/pictures, accepts explicit indoor provider metadata and preserves manual/outdoor values. Seven API groups, actual-renderer contract, eight browser configurations, full suite and CI passed. Final combined review remains. |
| [#335 account deletion](https://github.com/BenCBanks/kinetta/issues/335) | P1 | [PR337](https://github.com/BenCBanks/kinetta/pull/337): consistent account-before-segment locks; deterministic concurrency regression, full suite and CI passed. Apply the same order to new relationship writes. |
| [#340 food-first Me](https://github.com/BenCBanks/kinetta/issues/340) | P1 | [PR342](https://github.com/BenCBanks/kinetta/pull/342): Food today leads and Latest activity is hidden when today has food; full suite/eight browser configurations/CI passed. Verify with all other home additions combined. |
| [#341 deliberate recipe creation](https://github.com/BenCBanks/kinetta/issues/341) | P1 | [PR343](https://github.com/BenCBanks/kinetta/pull/343): separate ingredient editor, name first, Save recipe, off-default logging and visible Add food quick actions. Ingredient/whole-recipe SQL regressions and eight flow plus keyboard browser configurations passed. The complete fresh suite also passed; actual native spacing evidence passed. Requested pictograms on every suggestion bubble and Kit sparkles pass eight browser configurations without prompt calls. Final combined review remains. [PR343](https://github.com/BenCBanks/kinetta/pull/343) contains this flow change. |
| [#347 private native photos](https://github.com/BenCBanks/kinetta/issues/347) | P1 | PR348 and combined PR344: reproduced cross-session/server cache reuse; owner-scoped abort/revoke/late-response guards and authenticated optional identity-photo fetch now pass client contracts, including a hung decoder. Final combined verification remains. |
| [#349 yesterday copying/type evidence](https://github.com/BenCBanks/kinetta/issues/349) | P1 | One quiet outlined Copy yesterday button replaces repeated empty-meal links and the duplicate footer. A meal/all-meals choice opens explicit review; original meals, dates, unknowns, retry identities and Undo stay intact. Eight phone/theme/short/narrow/enlarged/desktop browser configurations and client regressions passed. Normal body15px, copy-button14.5px and meal-heading19.2px are measured separately from enlarged accessibility captures. |
| [#350 prediction explanations](https://github.com/BenCBanks/kinetta/issues/350) | P1 | A short estimate note plus a collapsed How estimates work section replaces the long paragraph. Pace and source have separate lines; the grid has breathing room. Numbers, best comparisons and source links are unchanged. Renderer regression passed; final collapsed/expanded browser checks remain. |
| [#351 every-screen loading/functionality/speed](https://github.com/BenCBanks/kinetta/issues/351) | P1 | Expanded scope: inventory all55 registered route definitions and significant view/sheet states, exercise real navigation/retry/empty/first-use flows, and measure cold/warm/delayed-API behavior. The initial32×8 pass found no page overflow/runtime errors. Suggestion-carousels need scroll-reachability checks;32px dismissal/New-food actions and indefinite partial-script loading are being corrected. Final full validations restart after this expanded audit. |
| [#305 intervals](https://github.com/BenCBanks/kinetta/issues/305) | P1 | Existing implementation needs signed physical-iPhone voice/locked-screen/offline/interruptions/battery acceptance. Saved-route co-use is outside current scope. The executable coverage map and complete signed-device test sheet are in [interval-acceptance.md](interval-acceptance.md). Browser, simulator or unsigned compilation cannot close this device issue. |
| [#294 recaps](https://github.com/BenCBanks/kinetta/issues/294) | P2 | [PR336](https://github.com/BenCBanks/kinetta/pull/336): full suite, SQL/renderer tests, eight browser configurations, monthly-offer edge checks and CI passed. Replace any mid-scroll/mid-animation evidence with representative stable captures and perform combined review. |
| [#295 public cards](https://github.com/BenCBanks/kinetta/issues/295) | P2 | [PR345](https://github.com/BenCBanks/kinetta/pull/345): complete fresh suite,12 API groups, schema80→81 preservation/defaults upgrade, eight browser configurations including public enlarged text and real QR decoding passed. All unsigned native compilation and CI passed. Final combined review and physical share/QR/install/link-preview checks remain. |
| [#296 milestones](https://github.com/BenCBanks/kinetta/issues/296) | P2 | [PR346](https://github.com/BenCBanks/kinetta/pull/346): full fresh regression suite with16 new API/SQL/privacy/concurrency groups, schema81→82 upgrade, eight browser configurations and CI passed. Visual review fixed banner sizing and recent-row icons. Combined and physical push/share acceptance remain. |
| [#297 challenges](https://github.com/BenCBanks/kinetta/issues/297) | P2 | [PR348](https://github.com/BenCBanks/kinetta/pull/348): templates, explicit join/signup/waitlist continuation, aggregate privacy, local dates, limits, leave/remove/block/end, notifications, retention and UI/share/QR. Full fresh suite,21 API/SQL/privacy/concurrency groups, schema82→83 upgrade, eight challenge browser configurations and eight production form configurations passed. CI found two test assumptions about the server time zone; those assertions now use the actual configured zone and UTC timestamps. Final combined verification remains. |
| [#293 sharing umbrella](https://github.com/BenCBanks/kinetta/issues/293) | P2 | Keep open until the four children and their shared privacy/source/explicit-sharing rules are accepted. |
| [#352 admin age/Kit](https://github.com/BenCBanks/kinetta/issues/352) | P1 | Birth year and approximate age, visible operator permission/personal consent status, confirmed admin editing and backend access enforcement. Nine targeted API/privacy/retry/generation groups pass; final browser/upgrade/full validation remains. No production account changed. |
| Original product/business analysis | Owner request | Delivered in the existing private owner reference: honest prospects, seven business/distribution avenues, strategy, risks, pricing hypotheses, unit economics and validation gates, checked against current official provider/store sources. Private content stays outside this repository. |
| [#300 private overview](https://github.com/BenCBanks/kinetta/issues/300) | P2 | Maintain the owner-only overview throughout. The owner resolved the Garmin-AI wording: keep the existing separate-consent option. The remaining plain-language read-through needs the owner; private contents do not belong in this repository. |

[#275](https://github.com/BenCBanks/kinetta/issues/275), [#273](https://github.com/BenCBanks/kinetta/issues/273), [#280](https://github.com/BenCBanks/kinetta/issues/280), [#281](https://github.com/BenCBanks/kinetta/issues/281) and [#328](https://github.com/BenCBanks/kinetta/issues/328) remain P3. No new routing service or community heatmap implementation is included. The earlier food-macro issue #319 was completed separately in PR322.

## Required behavior

### Recipe creation and editing

- My Recipes → Create a recipe opens a fresh ingredient editor. A pending Add food conversation is retained separately; it must never become the recipe’s ingredients implicitly.
- Recipe name appears above ingredients/nutrition in creation, editing and review. Long names wrap and remain editable.
- A saved whole recipe must not replace milk, espresso or sugar supplied as individual new ingredients. Known source quantities remain authoritative; unknown weights/nutrients are not invented. Remembered shots require a known per-shot weight.
- Save recipe is a clear action. Changes saving as the person builds must be disclosed accurately. No food entry is written when Add to log is off; it starts off for deliberate creation.
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

- Food today appears above the weekly chart when this local day has food, with useful numbers visible on opening. Hide Latest activity in that case. A goal or historical food alone keeps the normal training layout. Adding/removing today’s food updates the arrangement without shifting an exposed control during the initial load.
- Friend count is visible to anyone allowed to see the profile; the friends list stays owner-only. Pending, blocked, suspended and unconfirmed accounts follow existing rules.
- Stationary HR-only recordings have no artificial speed line. Explicit values and normal outdoor charts remain useful. HR requires real samples and the owner’s sharing choice. Private pace must not be reconstructed from paired time/distance series.
- No private account, activity, location or food data enters public fixtures/screenshots/issues. Use made-up demo and zz_test records only.

### Sharing features

- Recaps: local week/month/year totals match Progress; empty/lifting/unknown cases are honest; Food and identity are opt-in; no body or location data; private activity highlights are not named; Garmin attribution remains visible. Cancelled sharing does not dismiss an offer.
- Cards: off by default, username-only, selected photo/sports/up-to-two stats, revocable random links and accurate previews. Opening a card never auto-friends. Requests are pending, limited and owner-approved; signup confirmation, blocked/unconfirmed/suspended/deleted owners and disabled/rotated links are enforced. Do not bypass server signup/waitlist settings.
- Milestones: fixed first/best/total thresholds, cumulative food days rather than food streaks, at most one visible banner, once-only records, silent older imports, edits/deletion invalidation, private-activity reminder and off-default notification settings.
- Challenges: fixed templates and generated names, explicit joining without friendship, only username/photo/aggregate progress shared, private food/protein targets, per-participant local dates, limits, immediate leave/remove/block behavior, end/finish pictures and90-day cleanup.
- Reuse the reviewed child issues for detailed behavior. Do not replace their acceptance criteria with this shorter summary.

## Execution order and evidence

1. Finish the requirements reconciliation and native spacing investigation before adding further features.
2. Finish P1 recipe creation/quick actions and any related spacing defects; retain all earlier P1 branches.
3. Finish public cards → milestones → challenges in dependency order, with migrations, ownership/RLS, source credit, notifications and failure/retry checks.
4. Combine the branches in an isolated integration copy. Resolve shared CSS, cache versions, native links, migration numbers and documentation; verify saved-route removal stays complete.
5. Run the entire existing `dev/tests/run.sh` suite on the combined fresh install, plus required upgrade tests for every new migration. Run syntax, generated content/design/contrast, API/privacy/concurrency and relevant native state checks. CI must pass on the exact review head.
6. Perform a screenshot-first full UI review using fictional data in both themes, all target widths and larger text. Exercise real controls with external writes/devices/providers blocked or replaced by recorded stand-ins. Fix findings and repeat affected checks; rerun the full suite when shared changes justify it.
7. Recheck every open issue and priority label, update each implementation/evidence status, update the private overview and shared work log, and present the reviewable PRs with remaining operator/device/release steps.

Physical iPhone share sheets, camera, VoiceOver, locked-screen intervals and actual hosted map coverage/cost remain distinct from software evidence. Never silently turn on a billed provider, change someone’s sharing settings, publish to TestFlight or describe a PR as a live deployment.

## Code reviews and integration findings

Two deliberate reviews covered the combined changes, followed by targeted rechecks.

1. Ownership, privacy, permissions, validation and concurrency: fixed a challenge membership snapshot changing while the worker waited for account locks; retention now follows account-before-group order. Reproduced a card-confirmation lock inversion and moved relationship writes after confirmation commits, with background retry and serialized request caps. Migration84 grants SQL readers only their own safe card/intent metadata; invitation codes remain inaccessible. Legacy invalid time zones use the configured default. Actual API/SQL tests cover these boundaries.
2. Flow, retry, offline/native compatibility and maintainability: activity details now render before optional milestone polling. A late milestone cannot decorate another account. Empty recipe retries are serialized and reuse only an unfinished draft. Optional share photos are authenticated and bounded through decoding, native photo blobs are revoked on session changes, and card-copy fallback sheets close on account change. A remaining home shortcut to the retired Routes screen now opens completed Matched routes. Invitation QR codes use larger integer pixels and decode from the actual exported PNG.

Earlier integration checks also caught a duplicate recap include, missing segment-moderation reason labels, four narrow segment-filter clips and small practical action targets. They were corrected with regressions. Dense chart/calendar data points retain the compact grid allowed by the design standard. The #349 follow-up was reviewed for the same ownership/retry and UI criteria. Final screenshot review remains required after all changes.

## iPhone CI

The initial Debug bridge compiler error, missing Swift-package cache and Simulator cold-boot failures were diagnosed and repaired. Compilation/archive checks stay enabled. Compact and Pro layout jobs run on separate fresh Apple Silicon runners, select a matching runtime, wait for positive/stable native safe areas and retain failure diagnostics. The bounded fictional-measurement bridge is Debug-only and absent from Release registration.

Combined candidate a06d87e passed all CI and16 native layout cases: compact safe-top20/Back30 and Pro safe-top62/Back72, with actual OS status bars, both themes and larger text. That is valid software spacing evidence; it is not physical-device acceptance. The final combined head must pass again. No TestFlight or beta release job ran.

## Final completion gates · owner,28 October

Do not stop at component PRs. PR344 is the combined review candidate; stacked component PRs are review aids and must not be merged independently.

- Two complete fresh runs of the entire existing `dev/tests/run.sh` against final combined code, including the required schema80→86 upgrade. Earlier component/partial passes do not replace them. Exercise both UTC and America/New_York server time zones.
- Two code-review passes after the final profile/website additions, concrete findings repaired and targeted checks added. Recheck any subsequent code finding.
- Complete final UI review in both themes,330/390px, short phones, larger text and desktop. Verify clear primary actions, reachable long content, keyboard/draft behavior, no clipping and valid native spacing evidence.
- Exact-head CI, including both eight-case native jobs, passes; representative screenshots are reviewed and attached.
- Reconcile all27 issues/labels/evidence, update the private overview/work log and keep remaining operator/device gates explicit.

PR344 records the current evidence, screenshots and remaining release steps.

Physical iPhone share sheets/camera/VoiceOver/locked-screen spoken intervals, actual hosted map coverage/cost, owner overview read-through, merge, deployment, TestFlight upload and Apple processing remain separate outcomes. No release or paid-provider activation is authorized by this checklist.


## Admin age and Kit access · owner, 29 October

Show age and Kit settings in Accounts and the private account detail. Use birth year with approximate age; allow clearing an unknown year. Administrator permission is distinct from the member’s consent and 18+ confirmation, product entitlements, provider configuration and reviewed release. Allowing access never creates consent. Blocking access and a known under-18 birth year prevent AI generation on the backend, including default-open installations; manual tools remain available. Confirm writes with the account username, preserve failed drafts, use durable retry receipts and audit the action without copying birth year or consent into the audit record. Existing operator permission defaults to allowed on upgrade. Check a fresh install including migration85 and preservation/defaults from80, private export/erasure, API permissions and actual phone/desktop edit/retry flows before final acceptance. The two complete final regression runs must include this addition; earlier7bf8f38 evidence is superseded.


## Website and feature priorities · owner,29 October

Include the public website in the launch review: current fictional screenshots, accurate feature coverage and clear enrollment/invitation/waitlist paths. Use current official competitor sources to identify Kinetta’s strongest feature priorities and decide which app and website actions lead. Preserve the approved profile/private Overview design and existing server enrollment policy. Check every site destination, responsive layout, light/dark appearance and real signup/confirmation/invite continuation with stand-in delivery. Preparing the source, publishing the site and opening enrollment are separate outcomes.


## Profile/home addition · owner,29 October

Use [the approved requirements](profile-home-requirements.md) for the profile-first Me page, private Overview, combined Activity feed, separate history, customizable shared profile and persistent optional setup dismissal. Earlier baseline tests passed twice, but this addition requires fresh final-suite, upgrade, review and screenshot evidence. Pull-to-refresh preserves unchanged cards/maps. Website/enrollment work is tracked under #354 and remains part of the final combined gates.

The [feature-priority decision](feature-priorities.md) records the current official competitor evidence and how it informs app/website prominence. Website enrollment must resolve the configured signup/waitlist/invitation policy, retain origin links on temporary failures and ignore responses from an older view/account.

Cold Me loading must keep the plan and chart untappable until their first placement is known, while logged food can lead as soon as it is ready. Optional native Health status must not delay history classification or shift primary navigation. Fresh setup offers one connection step; established optional reminders remain hideable. Incomplete enrollment replies must preserve invitations and offer Retry.


## Bounded segment-job retry · #355

Repeated full regression exposed a locking subquery choosing more than100 jobs under an adverse execution plan. Retry now materializes one locked candidate set before updating it, preserving administrator/CSRF/audit and skip-locked behavior. The actual SQL/HTTP regression forces that plan, retains the exact100 bound, checks a worker-held row and retries the remaining batch separately. This follow-up requires the final two whole-suite runs to include the repair. No production retry or provider activation is part of verification.

The final351/354 visual pass also checks loaded Segments maps against tab/sheet painting order, separates the drawing hint from provider attribution, and uses the Sky Blue link role on the privacy page. Successful fictional tiles and real browser hit checks are required; an unavailable map cannot establish correct layering.

The351 enlarged-text check includes the Add food composer on first entry, restored multiline drafts, clearing/sending and width/keyboard changes. The field must fit its content up to the existing scrollable height limit without losing a draft or forcing repeated layout writes on every keyboard frame. Browser checks must respect the production security policy.
