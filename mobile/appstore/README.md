# App Store preparation — owner review required

Nothing here uploads, signs or submits an app. `listing-en-US.json` holds plain-text field values; JSON escapes become normal newlines when copied. The owner reviews the exact submitted build, configuration and partner practices before entering anything in App Store Connect.

| JSON field | App Store Connect field/limit |
| --- | --- |
| `name` | App information → Name,30 characters |
| `subtitle` | Subtitle,30 |
| `promotional_text` | Version → Promotional text,170 |
| `description` | Description,4000 |
| `keywords` | Keywords,100 including commas |
| `support_url`, `marketing_url` | Support and Marketing URLs; Guide includes contact details |
| `privacy_url` | App Privacy → Privacy policy URL |
| `eula_url` | Terms reference for the owner's custom License Agreement entry; review actual agreement text |
| `whats_new` | What's new,4000; replace release placeholders |
| `copyright` | Copyright; owner supplies legal holder/year |

Run `python3 mobile/scripts/test_listing.py`. Review `privacy-audit.md`, `age-rating.md` and `review-notes.md` together. Unfilled placeholders deliberately block a submission-ready claim. The guarded reviewer CLI is implemented and passed its marked disposable integration. This preparation alone creates no production reviewer account; choosing a separate fictional review server and providing private credentials remain owner gates.

## Native screenshot artifacts

The seven scenes are Me, activity map/charts, Track ready, Nutrition day, Add food chat, Progress and the friends’ Activity feed. The capture mode uses an unsigned Simulator bundle, actual UIKit safe areas and fictional API responses. Track’s location is a supplied point from the published fictional park route; no GPS permission or real position is read. Only the public basemap contract and its map-file ranges are requested without account credentials. It must produce7 light-mode JPEGs at1320×2868 with no alpha, source revision, image hashes and readiness metrics. Never resize browser/website captures into App Store screenshots or commit image artifacts. Review raw native captures before choosing an optional Sky Blue caption treatment. Inspect the native CI artifact and attach reviewed examples to the PR before marking preparation complete.

The Activity map/charts scene is recaptured from the merged activity-detail header (#928), including its current title, Kit action and stat layout. The artifact must be generated from the PR’s current bundle; do not reuse the earlier screenshot set.

## Existing push protection

`NativePush.swift` selects sandbox only for DEBUG and production otherwise. `ios.yml` archives Release; `mobile/scripts/check-export.py` inspects the actual exported IPA signature for `aps-environment=production` and a distribution profile before upload. This PR retains those assertions. An unsigned Simulator check cannot prove the final exported entitlement or real push delivery; signing/export and physical testing remain release steps.

Primary references checked2 November2026: [metadata](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/), [screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [privacy](https://developer.apple.com/app-store/app-privacy-details/), and the age worksheet's linked Apple questionnaire. Apple supports multiple6.9-inch sizes; this issue specifically requires1320×2868.
