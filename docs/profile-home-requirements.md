# Me, shared profiles and Activity

Owner direction, 29 October 2026, [#353](https://github.com/BenCBanks/kinetta/issues/353). This adds to the existing [launch requirements](launch-readiness.md); every earlier non-P3 item remains selected.

The owner approved the prominent profile direction, with **Overview** for personal information because it covers more than one day. The profile header is open and obvious; private content has an **Only you** label. Keep the slightly larger activity cards. Use the existing Sky Blue tokens, system typography, icons and five tabs.

## Information and navigation

| Surface | Contents and access |
| --- | --- |
| Me | Superseded 29 October (owner-approved mockup): "Hi, first name", then the profile card exactly as friends see it, with small Edit (in place) and Share pills; "Only you below this line"; Your dashboard with one optional setup checklist, conditional food and plan, weekly activity and private insights. See design.md. |
| Shared profile | Explicit owner preview for approved friends or other members; audience-filtered identity, progress, charts and workouts. Other people see their real permitted projection. |
| Activity | One chronological feed containing the person's activities and approved friends' permitted activities. No Friends feed/My activities selector. Compact discovery leaves workouts prominent. |
| Your activities | Complete private history with search, sport filters and pagination, clearly accessible from Me. Old My activities URLs redirect here. |
| Progress / Nutrition / Track | Existing analysis, logging, planning and recording continue. Explore Kinetta remains the searchable feature catalog. |

Food logged today must be visible promptly on opening Me, including normal text on a short phone. No historical food/goal alone creates an empty food panel. Keep active plans, goals, fitness, recaps, milestones and challenges reachable without repeating the feed or six large shortcut tiles. Remove Latest activity under the newer owner permission. Long names/bios and enlarged text remain readable and scrollable; do not shrink accessibility text.

## Profile customization

The owner selected content and layout first: name/photo/bio, section visibility and order, featured sports and selected summary statistics. Keep the app's visual controls consistent. Offer a real preview and explain that layout choices do not change activity audiences.

Use fixed section/stat/sport catalogs, reject duplicates/unknown/private fields and validate writes on the backend. Store preferences per account; use defaults for upgraded accounts. All numbers and rows come from the audience's permitted activities. No food, body values, Kit conversations, hidden details or untrimmed maps enter shared projections. Keep friend counts visible to allowed profile viewers and the friends list owner-only.

## Setup and refresh

Optional setup can be hidden and restored across devices. People can choose not to connect Health; Connections remains accessible. Required email/account-status notices remain separate from optional tips. Hiding a tip never changes Health permission or AI consent.

Review the reported clunky pull-to-refresh under #351. Exercise the actual gesture, loading/retry/cancel, stable list/scroll/controls, refreshed data and repeated pulls; preserve drafts and ownership. Confirm behavior at phone widths, both themes and enlarged text.

## Verification and cleanup

Use fictional accounts and inspect the chosen concepts beside current rendered screenshots. Record differences caused by actual data, conditional panels, accessibility or established design tokens. Review removed selectors/sections and their callers/styles/tests for dead code; retain necessary legacy data, migrations and exports. Update the route/state inventory and earlier requirements affected by the new navigation. Add meaningful audience/configuration/persistence/retry tests, fresh and upgrade checks, then repeat the entire original regression suite twice, two code-review passes, UI cleanup and exact-head native CI. Build, review, merge, deploy and physical acceptance remain separate.
