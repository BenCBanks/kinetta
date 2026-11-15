# App Store preparation — owner review required

Nothing here uploads, signs or submits an app. `listing-en-US.json` holds plain-text field values; JSON escapes become normal newlines when copied. The owner reviews the exact submitted build, configuration and partner practices before entering anything in App Store Connect.

| JSON field | App Store Connect field/limit |
| --- | --- |
| `name` | App information → Name,30 characters |
| `subtitle` | Subtitle,30 |
| `promotional_text` | Version → Promotional text,170 |
| `description` | Description,4000 |
| `keywords` | Keywords,100 including commas |
| `support_url` | Support URL; the About page provides the contact email |
| `marketing_url` | Marketing URL |
| `privacy_url` | App Privacy → Privacy policy URL |
| `eula_url` | Terms reference for the owner's custom License Agreement entry; review actual agreement text |
| `whats_new` | What's new,4000; replace release placeholders |
| `copyright` | Copyright; owner supplies legal holder/year |

Run `python3 mobile/scripts/test_listing.py`. Review `privacy-audit.md`, `age-rating.md` and `review-notes.md` together. Unfilled placeholders deliberately block a submission-ready claim. The guarded reviewer CLI is implemented and passed its marked disposable integration. This preparation alone creates no production reviewer account; choosing a separate fictional review server and providing private credentials remain owner gates.

## Native screenshot artifacts

The current native runner defines this eight-shot, light-mode story in `dev/tests/native-ui/run.py` (`STORE_STAGES`): Home feed (`header-activity`), Activity detail (`activity`), Track ready (`header-track`), Nutrition day (`header-food`), Add food chat (`food`), Progress (`header-progress`), Me with three earned featured medals (`header-me`), and Friends feed (`friends-typical`). The Nutrition fixture shows 915 of 1,800 kcal across two fictional meals; Me's medals meet their catalog thresholds. These are the current App Store capture plan, not newly generated shots in this docs change.

Capture from the exact source revision intended for review using the unsigned Simulator bundle, actual UIKit safe areas and fictional API responses. Screenshot mode hides map labels; Track uses a supplied point from the fictional park route, with no GPS permission or real position read. The runner verifies the public basemap contract without account credentials and emits eight native light-mode JPEGs at 1320 × 2868, plus source revision, image hashes and readiness metrics. Never resize browser/website captures into App Store screenshots or commit image artifacts. Inspect the raw native artifact against the current app before choosing an optional Sky Blue caption treatment.

The Activity map/charts scene uses the `activity` stage, separate from the Home feed’s `header-activity` stage. Generate both from the same current app bundle; do not reuse an older artifact when either layout has changed.

## 6.9-inch screenshot upload checklist

Use the `appstore-6.9-fictional` artifact from the exact green `iPhone app` workflow run for the submitted source revision. The eight files are native Simulator JPEGs; upload the `.jpg` files only. The `.json` files are evidence for review, not App Store Connect uploads. Each image must be 1320 × 2868, light mode, and show fictional demo data.

Upload the images to the iOS version’s **6.9-inch Display** screenshot slot in this order. Drag them one at a time if App Store Connect sorts a multi-file selection by filename:

| Order | Store scene | Capture filename |
| ---: | --- | --- |
| 1 | Home activity feed | `iPhone-16-Pro-Max-light-header-activity-16.jpg` |
| 2 | Activity detail map and charts | `iPhone-16-Pro-Max-light-activity-16.jpg` |
| 3 | Track ready | `iPhone-16-Pro-Max-light-header-track-16.jpg` |
| 4 | Nutrition day | `iPhone-16-Pro-Max-light-header-food-16.jpg` |
| 5 | Add food chat | `iPhone-16-Pro-Max-light-food-16.jpg` |
| 6 | Progress | `iPhone-16-Pro-Max-light-header-progress-16.jpg` |
| 7 | Me | `iPhone-16-Pro-Max-light-header-me-16.jpg` |
| 8 | Friends feed | `iPhone-16-Pro-Max-light-friends-typical-16.jpg` |

The device prefix is the Simulator model reported by the runner; if Apple’s runner uses a different exact 6.9-inch model, keep the same `light-<stage>-16.jpg` suffixes and use that prefix. Do not upload browser crops, dark-mode images, metric JSON, `public-map.json`, or screenshots from an older workflow run. Review each thumbnail after upload for a complete safe-area header, full bottom navigation and no clipped row.

### App Store Connect order

1. **App and version:** open the Kinetta app record in App Store Connect, choose the iOS platform and create or open the version being submitted.
2. **Build:** wait for the signed build from the green release workflow to finish processing in TestFlight. Select that exact processed build for the version; a Simulator artifact cannot be submitted as a build.
3. **Screenshots:** upload the eight JPEGs above under 6.9-inch Display, in the listed order. Check the generated smaller-device previews if App Store Connect creates them.
4. **Listing:** copy the reviewed values from `listing-en-US.json` into the name, subtitle, promotional text, description, keywords, support/marketing URLs, privacy URL, EULA reference, What's New and copyright fields.
5. **App information:** confirm the primary language, category, age rating answers from `age-rating.md`, and copyright before leaving the version page.
6. **Privacy and review:** complete App Privacy from `privacy-audit.md`; fill Review Information from `review-notes.md` with a dedicated fictional reviewer account and server, supplied privately in App Store Connect.
7. **Final checks:** confirm the privacy URL, support URL, screenshots, processed build, export compliance and pricing/availability. Save the version, then use **Add for Review** and submit only after the owner has reviewed the exact build and account exposure.

The capture runner accepts repeatable `--store-stage <stage>` arguments for future whole-screen scenes. Extra stages are previews only until their order, copy and fictional data have been reviewed; they do not change this eight-image upload set.

## Existing push protection

`NativePush.swift` selects sandbox only for DEBUG and production otherwise. `ios.yml` archives Release; `mobile/scripts/check-export.py` inspects the actual exported IPA signature for `aps-environment=production` and a distribution profile before upload. This PR retains those assertions. An unsigned Simulator check cannot prove the final exported entitlement or real push delivery; signing/export and physical testing remain release steps.

Primary references checked2 November2026: [metadata](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/), [screenshots](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/), [privacy](https://developer.apple.com/app-store/app-privacy-details/), and the age worksheet's linked Apple questionnaire. Apple supports multiple6.9-inch sizes; this issue specifically requires1320×2868.
