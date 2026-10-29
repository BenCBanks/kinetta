# Kinetta roadmap

Reviewed October 29, 2026 against all 26 open issues and their comments. [FEATURES.md](FEATURES.md) describes built behavior;
[the requirements guide](docs/requirements.md) describes acceptance. Priority, readiness, dependencies and release status
are separate. This queue does not authorize merging, deployment, provider spending or physical-device actions.

## Now

| Order | Issue | Result and remaining gate | Priority |
| --- | --- | --- | --- |
| 1 | [#325](https://github.com/BenCBanks/kinetta/issues/325) | Friends count on profiles, list first, local filter and clear remove/block sheets. Anyone allowed to view a profile sees its count; only the owner sees the list. | P1 — next |
| 2 | [#327](https://github.com/BenCBanks/kinetta/issues/327) | Operator-configured basemaps, real dark styles, visible attribution and safe tile failure. USA coverage first; UK if incremental cost is modest. Hosted setup/billing and signed-iPhone performance remain separate gates. | P1 — next |
| 3 | [#352](https://github.com/BenCBanks/kinetta/issues/352) | Private admin birth year/approximate age and Kit permission/consent status; confirmed editing, backend under-18/access enforcement and preserved manual tools. | P1 — next |
| 4 | [#305](https://github.com/BenCBanks/kinetta/issues/305) | Observed spoken interval guidance on a signed iPhone: locked, background, stationary, offline, GPS loss and audio interruption. The code is built; automated/browser tests cannot close physical acceptance. | P1 — next |

The selected P1 launch repairs also include [recipe layout/deletion #332](https://github.com/BenCBanks/kinetta/issues/332), [stationary charts #333](https://github.com/BenCBanks/kinetta/issues/333), [account deletion locks #335](https://github.com/BenCBanks/kinetta/issues/335), [food-first home #340](https://github.com/BenCBanks/kinetta/issues/340), [deliberate recipe creation #341](https://github.com/BenCBanks/kinetta/issues/341), [native private photos #347](https://github.com/BenCBanks/kinetta/issues/347), [quiet yesterday copying #349](https://github.com/BenCBanks/kinetta/issues/349), [prediction help #350](https://github.com/BenCBanks/kinetta/issues/350) [every-screen responsiveness/functionality review #351](https://github.com/BenCBanks/kinetta/issues/351), [profile-first Me and unified Activity #353](https://github.com/BenCBanks/kinetta/issues/353) and [website/enrollment/feature priorities #354](https://github.com/BenCBanks/kinetta/issues/354). Their complete requirements and verification gates are in [launch readiness](docs/launch-readiness.md).

The combined [PR344](https://github.com/BenCBanks/kinetta/pull/344) contains the selected app and sharing implementations. Component PRs are review aids; use the combined PR for current verification and remaining release gates. Unmerged code is not a hosted release. The [feature-priority decision](docs/feature-priorities.md) records current official competitor overlap and which everyday workflows should lead in the app and website.

There is no current P0 incident. P0 means immediate security, privacy or data loss and takes precedence when one is found.

## Next — shareable Kinetta

Build the children of [#293](https://github.com/BenCBanks/kinetta/issues/293) in this order. All are P2 — planned and
explicitly selected by the owner; a dependency label does not undo that selection.

1. [#294](https://github.com/BenCBanks/kinetta/issues/294): week/month/year recap pictures and the quiet monthly offer.
2. [#295](https://github.com/BenCBanks/kinetta/issues/295): revocable username-only Kinetta cards, QR and an explicit pending friend-request join flow. Depends on #294.
3. [#296](https://github.com/BenCBanks/kinetta/issues/296): once-only milestone offers, silent old imports and optional notifications off initially. Reuses #294.
4. [#297](https://github.com/BenCBanks/kinetta/issues/297): private-group template challenges with explicit joining, aggregate progress and finish pictures. Depends on #294/#295.

Sharing is deliberate and picture first. Logged-out previews show usernames, never real names. Optional food sections
start off and show consistency only: logged days and protein-goal days, never food streaks, intake, weight or body data.
Public card/challenge links never create friendships automatically. Garmin-derived numbers require the applicable
attribution. Tests, reviewed fictional screenshots and actual phone sharing/QR evidence are separate requirements.

[#300](https://github.com/BenCBanks/kinetta/issues/300) is P2 owner acceptance of the existing private overview and its
maintenance workflow. The outstanding plain-language read-through is not another page implementation task.

## Later

| Issue | Work and dependency | Priority |
| --- | --- | --- |
| [#275](https://github.com/BenCBanks/kinetta/issues/275) | Remaining source-use rights/allowlist, benchmarks and capacity decisions for shared geometry, community aggregates and named competitive results. Active basemap configuration belongs to #327. | P3 — later |
| [#280](https://github.com/BenCBanks/kinetta/issues/280) | Community heatmap data: reviewed source eligibility, coarse suppression, block cohorts and immediate revocation with bounded rebuilds. Privacy/projection/source review comes first. | P3 — later |
| [#281](https://github.com/BenCBanks/kinetta/issues/281) | Personal/Community interface and contribution controls, using #280's protected aggregate output. | P3 — later |
| [#273](https://github.com/BenCBanks/kinetta/issues/273) | Community heatmap parent; closes after both children and their privacy/activation gates. Existing personal heatmaps do not complete it. | P3 — later |
| [#328](https://github.com/BenCBanks/kinetta/issues/328) | Possible future saved-route planning, libraries, sharing and following. Outside current scope; provider rights/capacity, honest offline limits and signed-device evidence must be resolved before reconsideration. | P3 — deferred |

The community participation requirement remains same-server, Everyone-only and default-on with preserved explicit
opt-outs. It is not permission to process real histories or activate the feature before its privacy/source review.
Recorded activity maps, matched completed routes, personal heatmaps and fixed segments stay separate from #328.

## Acceptance and release records

Built, tested, merged, deployed, uploaded to TestFlight and accepted on a physical phone are distinct states. Keep
actual revision/build evidence with the issue or PR. Never close an external acceptance gate just because code merged.

Historical launch work (#232/#233), activity accuracy (#234), nutrition roadmap (#122) and beta/security checklist
(#98) are context; their issue closure does not by itself prove every earlier phone, real-model, recovery/security or
five-person two-week beta check. Preserve unresolved evidence in release records instead of presenting closed tickets
as the current open implementation queue. Food-on-training-days remains parked under #236.

Android/Health Connect, Apple Watch quick logging and a supported third-party API remain optional future directions.
No date, pricing tier or platform commitment is implied by this list. The stable Me · Activity · Track · Progress ·
Nutrition tabs, conditional Today panels, existing activity audiences and private food/body data remain the product rules.
