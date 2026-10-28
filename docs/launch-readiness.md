# Launch work and acceptance checklist · 28 October 2026

This consolidates the owner’s requests and all 19 currently open issues. It is the working acceptance plan; it does not claim that an open PR is deployed. Keep [ROADMAP.md](../ROADMAP.md) as the ordered queue, and update this checklist as evidence arrives. P3 work is explicitly deferred. No merge, hosted deployment, billing activation or TestFlight release is authorized by this checklist.

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
| [#341 deliberate recipe creation](https://github.com/BenCBanks/kinetta/issues/341) | P1 | In progress on PR339’s base: separate ingredient editor, name first, Save recipe, off-default logging and visible Add food quick actions. Ingredient/whole-recipe SQL regressions and eight flow plus keyboard browser configurations passed. The complete fresh suite also passed; actual native spacing evidence passed. Requested pictograms on every suggestion bubble and Kit sparkles pass eight browser configurations without prompt calls. Final combined review remains. [PR343](https://github.com/BenCBanks/kinetta/pull/343) contains this flow change. |
| [#305 intervals](https://github.com/BenCBanks/kinetta/issues/305) | P1 | Existing implementation needs signed physical-iPhone voice/locked-screen/offline/interruptions/battery acceptance. Saved-route co-use is outside current scope. Prepare an exact test matrix; browser, simulator or unsigned compilation cannot close this device issue. |
| [#294 recaps](https://github.com/BenCBanks/kinetta/issues/294) | P2 | [PR336](https://github.com/BenCBanks/kinetta/pull/336): full suite, SQL/renderer tests, eight browser configurations, monthly-offer edge checks and CI passed. Replace any mid-scroll/mid-animation evidence with representative stable captures and perform combined review. |
| [#295 public cards](https://github.com/BenCBanks/kinetta/issues/295) | P2 | [PR345](https://github.com/BenCBanks/kinetta/pull/345): complete fresh suite,12 API groups, schema80→81 preservation/defaults upgrade, eight browser configurations including public enlarged text and real QR decoding passed. All unsigned native compilation and CI passed. Final combined review and physical share/QR/install/link-preview checks remain. |
| [#296 milestones](https://github.com/BenCBanks/kinetta/issues/296) | P2 | [PR346](https://github.com/BenCBanks/kinetta/pull/346): full fresh regression suite with16 new API/SQL/privacy/concurrency groups, schema81→82 upgrade, eight browser configurations and CI passed. Visual review fixed banner sizing and recent-row icons. Combined and physical push/share acceptance remain. |
| [#297 challenges](https://github.com/BenCBanks/kinetta/issues/297) | P2 | Partial source on milestones/card base: templates, explicit join/signup/waitlist continuation, aggregate privacy, local dates, limits, leave/remove/block/end, notifications, retention and UI/share/QR. First17 API/SQL/reader/concurrency/signup groups passed. Full UI/upgrade/suite and implementation PR remain pending. |
| [#293 sharing umbrella](https://github.com/BenCBanks/kinetta/issues/293) | P2 | Keep open until the four children and their shared privacy/source/explicit-sharing rules are accepted. |
| Original product/business analysis | Owner request | Research and write an honest opportunity/strategy/concerns assessment, with avenues from established coaching platforms and managed web hosting to a native App Store product. Separate current evidence, business hypotheses and validation gates. |
| [#300 private overview](https://github.com/BenCBanks/kinetta/issues/300) | P2 | Maintain the owner-only overview throughout. Review code/doc conflicts, then leave plain-language owner acceptance explicit; private contents do not belong in this repository. |

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

## CI repair and combination checkpoint

The recipe branch’s initial iPhone failure came from a missing Swift-package cache checkout on GitHub’s Mac runner; its failed-job rerun passed Simulator, device Release and archive/entitlement checks. The launch-review Debug-only measurement bridge had an inferred optional Swift method-array type; eccb7de corrected it and all three compilation/archive stages passed. Its subsequent native-layout step failed before Kinetta launched because the Simulator never completed booting. No image or layout acceptance was produced by that run.

The layout check now runs as a separate required Apple Silicon job using the existing unsigned universal Simulator artifact. Release jobs depend on it. Measurements must wait for a positive status-bar safe inset and stable layout. The Friends, saved-route deferral, map, account-erasure lock, stationary charts, food-priority home, recap and public-card implementations are now combined locally with the recipe work; combined full-suite and UI evidence remain pending. Integration review also caught and fixed missing segment moderation reason labels after route-tool removal, with a nonempty-case regression.

The first combined full `dev/tests/run.sh` passed. The browser pass then exposed a duplicate recap-script include introduced during combination;7035cc2 removes it and adds an entry-asset check.216 fresh views across27 main surfaces/eight size-theme configurations had no runtime errors or page overflow; four narrow segment-filter captures clipped a label and are being corrected. The practical action-target review also found smaller feed toggles, pickers, composer and Memory controls; these are being enlarged and rechecked. Dense calendar/chart data points retain their compact grid, as permitted where44px is not practical in the design standard. Captures are evidence for review, not automatic visual acceptance.

The Apple Silicon compile/archive succeeded. Its initial Simulator startup also exceeded the three-minute harness budget before app launch. Capture now selects a runtime matching the chosen Xcode SDK, retains sanitized startup diagnostics and allows a bounded cold-runtime boot. All required screen/theme/text-size assertions remain enabled.

## Final completion gates · owner,28 October

Do not stop at component PRs. After all non-P3 work is combined and findings are fixed:

1. Run the entire existing regression suite twice against the final combined code, including fresh installation and the required migration/upgrade checks. Earlier partial/component passes do not replace these final runs.
2. Perform two code-review passes: ownership/privacy/permissions/validation/concurrency first; then user-flow/retry/offline/native compatibility/performance/maintainability. Record concrete findings and fixes, then recheck affected behavior.
3. Review the final UI in both themes, narrow/short phones, larger text and desktop. Confirm the experience stays simple, controls and labels fit, primary actions are clear, and native spacing evidence is valid. Repair and recheck findings.
4. Reconcile every issue/requirement with evidence and remaining real operator/device gates, keep priorities and the private overview current, and leave implementation/CI/merge/deployment/TestFlight clearly separate.

Native checkpoint:8e4d23d produced all eight valid compact-iPhone captures with actual status bars, settled20px safe tops, Back at30px, both themes, larger text and no runtime/status errors. Visual review confirms the extra recipe top gap is gone in that scope. The second, Pro Simulator failed during boot. CI now gives each phone a fresh runner; both eight-case jobs stay required. Pro and physical-device acceptance remain open.

Combination checkpointcf35fed: requested chat icons/sparkles, milestonePR346 and map/stationary follow-ups are combined locally. Component full suites and CI are green; final combined twice-suite/twice-code-review/UI gates still remain. The original iPhone failures are resolved in run40774161633; all16 native layout cases passed on fresh compact/Pro runners. No release job ran.
