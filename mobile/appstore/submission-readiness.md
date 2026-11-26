# Submission readiness — 26 November 2026, owner-review Draft

Source baseline: `fffd877fb3956ef0957f2c53a2faa6e9a009f15e` (main). This includes Track #1587, Notifications #1592 and Kit batch #1564. Source inclusion is not proof of deployment, a processed signed build or enabled reviewer-server features. No App Store Connect entry, upload, submission, provider call or real-account access is part of this preparation.

## What is ready for review

- `listing-en-US.json`: refreshed description/promo and proposed release notes. Name/subtitle/URLs/keywords retained; copyright and exact version/build remain owner fields. The Kit paragraphs require saved history and the reviewed Kit release enabled on the review server.
- [Screenshot plan](screenshots-plan.md): ten proposed fictional scenes, including current Track, Notifications, Kit line card, saved chats and memory. It is a capture brief, not a new artifact or device acceptance claim.
- [Privacy-label changes](privacy-label-changes.md): explicit linked/tracking/purpose answers for metrics, retained chats and memory, checked against existing manifest and policy. The full inventory remains [privacy-audit.md](privacy-audit.md).
- [Review notes](review-notes.md): current entry points and the controls the reviewer should inspect. Supply server/login/contact privately.

## Scope and differences from #415 / #1330

#415's original missing listing/email/privacy preparation has been implemented. Its remaining work is exact-build acceptance and owner decisions, not merely pasting old screenshots. #1330's listing mentions the older weekly review and its eight native scenes predate the new Track, Notifications and saved Kit experience. Do not label those earlier images current solely because their dimensions pass. Keep #1330's workflow work and old artifact provenance intact; this Draft replaces only its proposed listing copy and adds a refreshed capture/privacy brief. Neither issue/PR is closed here.

Source checks: `app/static/track.js`, `track-native.js`, `social-notifications.js`, `kit.js`, `kit_history*.py`, `kit_memory.py`, `kit_charts.py`, `kit_goal_actions.py`, `admin_features.py`, `app/api_mydata.py`, `site/content/privacy.md`, native `PrivacyInfo.xcprivacy`; existing `docs/activity-tracking.md` and `docs/admin-features.md`.

Groups are a separate release gate. Main includes date/legacy-write preservation work (#1590/#1591), not proof that the pending new Groups/challenge UI and cutover have shipped together. The description retains existing friends/challenges only. Do not promise the new group member/challenge-sharing flow or use pending screenshots. After the complete Groups release, review its audience defaults, sharing text, review account and privacy policy; then propose a replacement screenshot/copy in a small follow-up. No “coming soon” claim belongs in the submitted screenshots.

## Owner checklist before uploading

1. Record the exact app version, processed signed build, source commit, deployed server source, enabled Kit/history/streaming gates and installed matching reviewed Kit report. A web-server update alone does not put the new Track/native changes into an older iPhone bundle. No reviewed report equivalence is inferred here.
2. Review the listing and proposed What's New against that build/configuration. Supply copyright owner/year; remove all bracketed placeholders before submission. Confirm support/privacy/Terms URLs and custom EULA, category, availability and export-compliance answers.
3. Decide the Health-derived analytics/consent gate described in the privacy delta. Confirm provider identity, tier, retention/training practices and the explicit AI data-sharing explanation. The manifest already declares purposes; that is not Apple approval.
4. Confirm age-rating answers against current enabled AI/social features; retain Kinetta16+ and Kit18+ eligibility. Recheck [age-rating.md](age-rating.md). Do not tick Larger Text; VoiceOver needs an actual common-task device pass. Review any Dark Interface claim on the exact build.
5. Choose an isolated review server with fictional records and no real “Everyone” feed. Supply credentials/contact in Connect only. Verify ordinary food logging, History/Memory deletion, consent-off behavior, chart values, export and account deletion there; exercise goal preview/cancel/confirm only with fictional data.
6. Capture/review the new screen set; inspect physical-iPhone safe areas, keyboard, permission prompts, Track lock-screen/app-switch behavior and push. Keep signed IPA production APNs entitlement/export assertions and real delivery acceptance separate from Simulator images. See [production-push-checklist.md](production-push-checklist.md).
7. Ben selects/enters approved assets and metadata, then chooses submission. This Draft performs none of those actions.

## Policy cross-check

Apple's public [privacy definitions](https://developer.apple.com/app-store/app-privacy-details/), [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) and [review guidelines](https://developer.apple.com/app-store/review/guidelines/#privacy) were read on26 November2026. The current screenshot reference accepts1320×2868 portrait under its large Dynamic Island display group; select the corresponding slot actually shown in Connect rather than relying on an old “6.9-inch” label. Recheck at submission. This is a source-backed preparation checklist, not legal or App Review approval.
