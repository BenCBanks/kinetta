# App Store preparation — Draft, owner review required

Source-reviewed 27 November 2026 against main `46bbe8c1`. Start with [submission-readiness.md](submission-readiness.md), then [source-review.md](source-review.md), [listing-en-US.json](listing-en-US.json), [screenshots-plan.md](screenshots-plan.md) and [privacy-label-changes.md](privacy-label-changes.md). The full inventory is [privacy-audit.md](privacy-audit.md); [age-rating.md](age-rating.md) and [review-notes.md](review-notes.md) remain owner-review worksheets.

This directory prepares proposed metadata, captions and answers. It does not upload assets, enter Connect answers, submit an app, certify a signed build or verify physical-device behavior. Copyright, release version/build and private review credentials intentionally remain placeholders. Source inclusion does not prove deployment or enabled server gates.

## Proposed metadata fields

| JSON key | App Store Connect field / limit |
| --- | --- |
| `name` | App name, 30 characters |
| `subtitle` | Subtitle, 30 |
| `promotional_text` | Promotional text, 170 |
| `description` | Description, 4000 |
| `keywords` | Keywords, 100 including commas |
| `support_url` | Support URL; the About page provides contact details |
| `marketing_url` | Marketing URL |
| `privacy_url` | Privacy policy URL |
| `eula_url` | Terms reference; owner reviews the actual custom License Agreement |
| `whats_new` | What's new, 4000; replace the release placeholder |
| `copyright` | Owner-supplied legal holder/year |

Validate offline with `python3 mobile/scripts/test_listing.py`. Passing character limits and disclosure contracts is not submission approval. The guarded reviewer-account tooling does not itself create a production reviewer account. Owner-selected isolated fictional review service and credentials remain release gates.

## Screenshot status

The proposed story has ten scenes, not a newly approved artifact. Main's `dev/tests/native-ui/run.py` still defines eight older `STORE_STAGES`: Home, activity detail, Track, Nutrition, Add food, Progress, Me and `friends-typical`. Separate Draft #1607 implements the current ten-scene capture work; use its exact final bundle and capture receipts only after its dependencies and assets are approved. Do not combine generations or call an old eight-frame artifact current because its dimensions pass. See the screenshot brief for captions and source checks.

Historic #415/#1330/#1511 material remains provenance, not the current upload instruction. In particular `friends-typical` is a stage name, not proof of a friends-only feed; label the actual view. Historical browser fallback files with simulated status/home bars are browser evidence, not UIKit or physical-iPhone captures. Never upscale website crops or invent permission prompts.

Prepare raw whole-screen, fictional-data captures at 1320 × 2868 for the accepted large portrait slot; confirm Apple's current slot/dimensions at submission. Record source/bundle hash, image hashes, Simulator model/OS, fixed fictional clock, readiness checks and safe areas. Keep artifacts out of git. Check visible map attribution, matching units/dates/totals, complete controls and no error/unavailable banners. Optional caption treatment and final order need Ben's preview. Captions follow `docs/design.md`: few words, one short sentence at most, with the adjacent screen proving it.

Groups and per-challenge sharing are merged; an optional Groups replacement still needs Ben's selection. Native Strava Open in/Share, picker, guided/background upload and other unmerged Drafts are excluded. Browser import/API implementation is not evidence of those native features. No screenshot proves background recording, APNs delivery, Health permissions or keyboard behavior on a real device.

## Submission gates

Owner decisions are listed separately in [submission-readiness.md](submission-readiness.md). Resolve current website-policy discrepancies (group totals/defaults and name display), Health-derived analytics eligibility, provider terms, contact-hash classification, exact build/configuration, rating/accessibility and physical acceptance before any submission-ready claim. The manifest and App Store Connect answers are separate declarations; neither changes when these docs change.

After Ben approves the final assets and exact processed signed build, the owner can enter approved metadata/privacy/review information in Connect and choose submission. This task performs none of those steps. Private credentials belong only in Connect, never in source, screenshots or PRs.

## Existing push protection

`NativePush.swift` selects sandbox only for DEBUG and production otherwise. `ios.yml` archives Release; `mobile/scripts/check-export.py` inspects the actual exported IPA signature for `aps-environment=production` and a distribution profile before upload. These protections are unchanged. Unsigned Simulator checks do not prove exported entitlements or actual push delivery; see [production-push-checklist.md](production-push-checklist.md).

Apple references last read 26 November 2026 (not freshly certified by this source audit): [metadata](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/), [screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [privacy](https://developer.apple.com/app-store/app-privacy-details/) and [review guidelines](https://developer.apple.com/app-store/review/guidelines/). Recheck the current forms and requirements at submission.
