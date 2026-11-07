# App Privacy — owner-review draft, 2 November 2026

Reviewed against this branch's source, not a production-data inspection. Enter matching answers for the submitted build and configured services in App Store Connect; changing this file or the bundled manifest does not do that. Apple defines collection as readable retention beyond serving a request, including partners. Optional core features still need disclosure. See [Apple's definitions](https://developer.apple.com/app-store/app-privacy-details/).

Every row below is **linked: Yes; tracking: No**. Account authorization and daily matching keys prevent an unlinked claim, even when administrators see only totals. No advertising SDK, IDFA, sale or cross-company ad matching is implemented. Purposes: **F** = App Functionality, **A** = Analytics, **P** = Product Personalization (optional tailored Kit/training/food suggestions). These are proposed disclosure answers, not permission to enable anything.

| Apple data type | Retained/sent fields and purposes | Source pointers |
| --- | --- | --- |
| Name | Display/profile name; F | `app/api_account.py`, `app/db.py` users |
| Email Address | Account email, confirmation/reset and account-safety mail; F | `app/account_email.py`, `app/signup.py`, `app/db.py` migration67 |
| User ID | Username, account/session identifiers; F,A | `app/auth.py`, `app/db.py`, `app/admin_features.py` |
| Device ID | APNs token, push endpoint and device/session registration; F | `app/notify.py`, `mobile/ios/App/App/NativePush.swift`, `app/db.py` |
| Health | Body profile, weight, permitted Health reads, food/nutrition/targets; F,A,P | `app/api_health.py`, `app/api_food.py`, `app/energy.py`, `app/kit_tools.py`, `app/admin_features.py`, native `HealthFood.swift`/`HealthBackgroundSync.swift` |
| Fitness | Workouts, lifting, training plans, effort and summaries; F,A,P | `app/api_activities.py`, `app/api_lifts.py`, `app/coach.py`, `app/admin_features.py`, native `NativeTrack.swift` |
| Precise Location | Saved/imported routes and GPS samples; F | `app/api_activities.py`, `app/db.py` streams, native `NativeTrack.swift` |
| Photos or Videos | Account/activity photos; food photos can be retained by the selected AI provider despite transient Kinetta processing; F | `app/api_photos.py`, `app/api_account.py`, `app/food_photo.py` |
| Contacts | Accepted friendship/social graph, requests and blocks; F | `app/api_social.py`, `app/db.py` friendships/blocks; no address-book access |
| Other User Content | Bio, comments, titles, notes, recipes, food threads, Kit conversations/memory/preferences; F,P | `app/api_social.py`, `app/api_dishes.py`, `app/kit_thread.py`, `app/kit_memory.py`, `app/food_thread.py` |
| Search History | Public-food queries/barcodes in a shared cache with30/60-day freshness windows and no automatic expiry deletion; conservatively linked because requests are authenticated and access logs may retain URLs; F | `app/api_food.py` `_cached`, `_off_search`, `_usda_search`; `Dockerfile` |
| Product Interaction | Fixed feature opens, setup dates, food-entry method and cohort/count reports; A | `app/admin_features.py`, `app/static/feature-usage.js`, `app/db.py` migration93 |
| Other Diagnostic Data | API route pattern/status/duration/channel/request ID with account ID, sign-in/push/Health-sync failures and operational logs; F | `app/request_log.py`, `app/auth.py`, `app/notify.py`, `app/main.py`, `Dockerfile` |
| Other Data Types | Birth year/age declarations and consent/Terms receipts; F | `app/ai_access.py`, `app/signup.py`, `app/db.py` profile/consent records |

The manifest includes this conservative inventory. Retain existing Health/Fitness/User ID Analytics purposes: feature reports inspect Health-sourced workouts and weight/food counts. **Collection is operator-controlled for all accounts, not per-person opt-in**. It is reported OFF in the issue's release record; source review does not verify today's live switch. Before enabling, the owner must resolve Guideline5.1.3 Health-data analytics eligibility (or exclude those sources and revise disclosures) and collection/consent requirements. Do not infer Apple approval from aggregation. See [review guidelines](https://developer.apple.com/app-store/review/guidelines/#health-and-health-research) and `docs/admin-features.md`.

## Providers and exclusions

Kit requires18+ eligibility, the person's AI opt-in and reviewed server gates (`app/ai_access.py`, `app/ai_release.py`). Health/Garmin inclusion additionally requires its specific consent. Authenticated tools supply only relevant own records (`app/kit_tools.py`, `app/coach_chat.py`); food estimates can send descriptions, photos and selected private context (`app/food_photo.py`, `app/food_memory_understand.py`). Review/confirmation still gates writes. Never claim AI accuracy from these contract checks.

`app/ai_release.py` defaults: food Gemini `gemini-3.1-flash-lite`, fallback `gemini-3.8-flash`; coach Gemini `gemini-3.8-flash`, fallback `gemini-3.1-flash-lite`. `app/coach.py` also supports configured Anthropic `claude-opus-5-5`. Environment overrides and reviewed feature gates determine the actual release. The policy names both providers and links their retention terms. Do not claim zero provider retention or declare only Google without the owner checking the submitted configuration. P above covers tailored suggestions even though ordinary food estimation is F.

Maps: `app/static/maps.js`/`app/map_config.py` request configured map tiles/file ranges; the hosted policy describes Cloudflare/R2 processing network addresses and viewed areas without account cookies or workout times. Location is already declared. Unsaved GPS samples are not uploaded as workout records; configured map requests still disclose viewed areas. Saved recordings are uploaded. USDA/Open Food Facts receive queries/barcodes; recipe import fetches a supplied public URL without account credentials (`app/api_food.py`, `app/recipe_import.py`). Imported recipe source URLs persist as user content, not a general browsing-history tracker. Mail receives addresses and message contents; Apple delivers optional push (`app/account_email.py`, `app/notify.py`). Review configured partners' retention before submission.

No crash-reporting or third-party analytics SDK appears in `mobile/package.json` or the native dependency list. No automatic crash dump, microphone recording, address-book read, payment, advertising identifier or medical-record import is implemented. Server exception/status logs are operational diagnostics, not evidence of native crash collection. Free-form notes can contain sensitive subjects; Apple instructs generic fields to use Other User Content, rather than inventing every possible category. No dedicated sensitive-category prompt exists. Recheck if dependencies, recording or data flows change.

## Policy comparison and remaining owner decisions

`site/content/privacy.md` (generated `site/privacy.html`) already covers account email, Health/fitness/GPS, photos, private chat/memory, sharing, diagnostics, feature counts, providers, map requests and retention. No product behavior is changed here. Two wording qualifications remain for owner review: the policy's “never what you entered or sent” describes the application request table, while default Uvicorn access logs can contain URL query values; public-food queries have a persistent catalog cache whose30/60-day freshness windows do not delete old entries. This PR adds a narrow policy clarification for both. The policy does not promise per-person analytics choice; this audit does not add one.

Before submission: review every declared category/purpose against the exact configured build and partners, resolve Health analytics, confirm final age answers, reviewer isolation and moderation/Terms availability. Actual Connect answers, release credentials, signed entitlement inspection and physical delivery are separate owner steps.
