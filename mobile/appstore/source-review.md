# Listing source review — 27 November 2026

Baseline: frozen TestFlight source `f1811e87ceb4b16d33cf965953fc2887b3aa41c2`. This is an offline code/document audit, not a deployed-configuration inspection, final-image approval, provider-quality evaluation or physical-iPhone pass. The Draft remains preparation; owner decisions are separate in [submission-readiness.md](submission-readiness.md). All paths below are repository-relative.

## Listing, promotional text and proposed release notes

| Claim or feature name | Evidence reviewed / permitted wording |
| --- | --- |
| Workouts, food and progress; running/walking/cycling/strength keywords | `app/static/track.js`, `pages.js`, `food.js`, `lift.js`. Describe actual logging/history, not guaranteed fitness outcomes. |
| Outdoor Track, Map/Stats, review before save; indoor timers | `app/static/track.js`, `track-native.js`, `track-route.js`, native `NativeTrack.swift`. Native GPS capabilities are implemented; continuity/accuracy/battery after lock or app switch needs physical acceptance. No speed or background-reliability promise. |
| Lifting sets/history/records and running plans | `app/static/lift.js`, `plan.js`, `app/api_lifts.py`, `plans.py`. Plan entry/interval validation is merged; no promise of a watch-native or universal adaptive plan. |
| Apple Health supported workouts and separate body weight | Native `HealthBackgroundSync.swift`, `HealthFood.swift`, `app/api_health.py`, `api_health_weights.py`. Permissions and available source data determine imported detail; writing confirmed nutrition is separate. No claim that a Watch/Garmin route always exists or that sync never needs foreground use. |
| Garmin new synced workouts | `app/garmin_connect.py`, `app/static/pages.js` Connections. Source-dependent detail; not a promise of all history or every GPS stream. |
| Search, barcode, manual food and optional Kit | `app/static/food.js`, `food-review.js`, `app/api_food.py`, `food_photo.py`, `food_thread_log.py`. Estimates need review; manual/search logging remains available without AI. |
| My Recipes / My foods / Saved combinations; weekly food insights | `app/static/food.js` library and `weeklyReviewHtml`, `cook.js`. Use these current names; do not imply a new shared recipe feed or automated nutrition accuracy. |
| Mention weight with a meal, review both | `app/food_thread_weight.py`, `food_thread_compose.py`, `food_thread_log.py`. Structured parsing and explicit confirmation, not automatic weigh-in recording. |
| Ask Kit, own training/food, weekly review/follow-up/chart | `app/kit_thread.py`, `kit_tools.py`, `kit_conversation.py`, `kit_charts.py`, `progress_series.py`. Checked own-record values; missing records stay missing. No claim of medically reliable AI or unsupported new tools. |
| Saved chats and editable memory | `app/kit_history.py`, `kit_history_api.py`, `kit_memory.py`, `app/static/kit.js`. Server-gated history until deletion; separate bounded memory with add/edit/delete/off. Existing saved-history reads need no new provider call. |
| Confirm a proposed goal change | `app/kit_goal_contract.py`, `kit_goal_actions.py`, `app/static/kit-goal-ui.js`. Existing **activity-goal target** preview and explicit confirmation only; no nutrition/body-target changes or automatic writes. |
| Achievements: run/ride/walk-hike/swim/lift | `app/achievement_tracks.py`, `api_achievements.py`, `app/static/profile.achievement-levels.json`. Earned thresholds, not a promise that every activity gets a medal. |
| Friends, cheers, comments, Notifications | `app/api_social.py`, `notify.py`, `app/static/social.js`, `social-notifications.js`. Current compact inbox is merged; inbox availability does not establish physical APNs delivery. |
| Groups, updates and per-challenge Share my total | `app/group_challenge_api.py`, `group_challenges.py`, `groups.py`, `social.js` `groupChallengePage`. Merged current controls, group/legacy inheritance and account-wide gate; distinguish group totals from standalone challenges. See privacy inventory. |
| Distance/active days/workouts/food logging/protein-goal days | `app/challenges.py` `KINDS`/`progress`. Food sharing is day counts, never meals or personal targets. Group workout goals use their separate supported metrics. |
| Only me / Friends / Everyone and route ends | `app/static/social.js` sharing settings/editor, `app/api_social.py`. New-activity defaults do not rewrite old audiences; route trimming is not anonymity. Raw weigh-ins/chats are not shared with friends. |
| 16+ account, 18+ Kit; explicit AI/Health/Garmin choices | `app/signup.py`, `api_account.py`, `ai_access.py`, `ai_account.py`, `coach.py`, `app/static/app.js`. Declarations, account-state checks, consent, entitlements, quotas and reviewed release gates apply; no verified-ID claim. |
| Export/delete in Me → Settings → Your data | `app/api_mydata.py`, `api_account.py`, `app/static/pages.js`. Includes saved Kit data; separate memory deletion and policy backup/provider exceptions apply. |
| URLs, copyright, version/build | Site `index.html`, `about.html`, `privacy.html`, `terms.html` exist. HTTPS URL syntax checked offline; live availability, legal holder, exact release/build and custom EULA remain owner checks. |

Name/subtitle and the remaining keywords identify implemented categories; promo repeats the supported workouts/food/history/memory/chart claims above. What's New is pinned to f1811e87; only the version/build heading remains an owner field. Feature availability still depends on the selected server. No listing claim relies on the unmerged native Strava flow, following-build #1644/#1645/#1656/#1658, unreviewed AI releases or a future capture runner.

## Frozen-build delta reviewed

- Food entry: `app/static/thread.js` renders Scan/Photo/Usuals/Manual in the compact grid; `cook.js` uses **Review food** for manual review; **Add to log** remains the final save. `food-route.css` owns the layout.
- Comment recovery: `social-data.js` keeps bounded seven-day server/account-scoped drafts; `social.js` sends the same `client_id` on explicit retry. `api_social.py` rechecks account/access before replay and `db.py` migrations131–132 enforce own-account uniqueness and seven-day receipts, including removed comments. This supports duplicate-safe **comment** retries, not a general upload guarantee.
- Sign-in/sign-up: `app.js` bounds POST waits and retains form fields on failure. Enrollment admission and password-work limits are server checks, not promises of uninterrupted service.
- Photos: `pages.js` and `profile.js` retain prepared pixels for explicit retry after the permitted transient failures. **#1656 photo receipts are not in this build**; do not advertise duplicate-safe photo uploads or automatic resend.
- Native/runtime dependencies: the frozen Capacitor package versions and bundled source are the build target. No claim of physical GPS, Health, push, keyboard or share-sheet verification is added.

## Privacy answer coverage

The [full inventory](privacy-audit.md) covers every existing manifest category; the [delta](privacy-label-changes.md) covers retention/purposes in detail. `mobile/ios/App/App/PrivacyInfo.xcprivacy` remains unchanged: tracking false, no tracking domains; declared categories linked except Contacts, whose salted-hash/social-graph classification remains an owner decision.

| Inventory / answer | Evidence and limitations |
| --- | --- |
| Name, email, optional phone, account/device IDs | `app/api_account.py`, `names.py`, `account_email.py`, `api_contacts.py`, `auth.py`, `notify.py`, native `NativePush.swift`. First/last collection and privacy-aware full/first display are now explicit. |
| Health, Fitness, location and archive imports | `api_food.py`, `api_lifts.py`, `api_health*.py`, `api_activities.py`, `energy.py`, `groups.py`, `group_challenge_api.py`, `challenges.py`, `api_strava_import.py`, `strava_upload.py`, `strava_stage.py`. Structured facts/derived totals remain account-linked; web staging does not mean native guided import is shipped. |
| Photos / Videos | `app/api_photos.py`, `food_photo.py`, native `NativeActivityShare.swift` / `Info.plist`. Upload/photo-estimation collection is separate from add-only local Save to Photos; provider retention needs configuration review. |
| Contacts / social graph | `app/api_contacts.py`, native `NativeContacts.swift`, `ContactMatchHasher.swift`, `app/static/contacts-ui.js`. Optional permission, fresh salt, at most 2,000 type-tagged hashes, local name mapping; no claim of private-set-intersection or automatic cache removal on permission revocation. |
| Other User Content, preferences, search history | `app/api_social.py`, `api_dishes.py`, `recipe_import.py`, `food_thread.py`, `kit_history*.py`, `kit_memory.py`, `api_food.py`. Saved content is retained; shared food cache freshness is not deletion. Chat deletion does not delete separate memory. |
| Product Interaction and User ID / Health / Fitness Analytics purposes | `app/admin_features.py`, `app/static/feature-usage.js`, `docs/admin-features.md`. Operator switch; linked ingestion, suppressed small report cells, daily-key cleanup, 13-calendar-month totals. No runtime state independently verified; Health analytics eligibility remains unresolved. |
| Diagnostics / Other Data Types | `app/request_log.py`, `auth.py`, `notify.py`, `ai_access.py`, `signup.py`, `groups.py`, `strava_stage.py`, `db.py`. Operational/account/consent/group/import receipts, not a new advertising SDK. |
| Saved-answer redaction, bounded replay and separate memory | `app/db.py` Kit source/consent triggers, `kit_thread.py`, `kit_history.py`, `kit_memory.py`, `api_mydata.py`. At most six prior permitted turns / twelve role messages and twelve notes; prior chart payloads excluded. Invalidated answers are erased in storage; unknown legacy provenance is quarantined. Consent restoration does not revive erased answers. |
| Third-party processing / tracking No | `app/ai_release.py`, `coach.py`, `food_photo.py`, `map_config.py`, `app/static/maps.js`, `api_food.py`, native dependencies. No first-party ad/IDFA integration found. Actual configured AI/mail/maps/food partners' retention and legal classifications still need owner verification. |

The frozen website policy includes #1632's factual corrections: first/full-name display, per-challenge sharing and recap-only three-member thresholds, browser archive staging, and precise 180-day memory filtering/access cleanup. These earlier discrepancies are resolved in source; publication and final legal/Apple classifications remain separate. Age-rating answers remain proposals: social/UGC/health/contests are implemented; exact content frequency, unrestricted web access, final Apple rating and device accessibility cannot be settled by this source audit.

## Screenshot captions

Each of the ten captions in [screenshots-plan.md](screenshots-plan.md) maps to an actual merged screen: Home feed (`social.js`); Track (`track-route.js`); saved run (`pages.js`); Nutrition (`food.js`); unconfirmed food review (`food-review.js` / `food.js`); chart (`kit.js`); history (`kit.js`); memory (`kit.js`); Notifications (`social-notifications.js`); Progress (`pages.js`). Existing focused fixtures are named in the brief. Current capture implementation is separate Draft #1607; main still has eight Store stages. Final screenshot pixels, exact control visibility, dates/totals, captions and selected bundle need a new visual review; no new artifacts are claimed here.

Applied `docs/design.md` wording rules: few-word literal captions, at most one short sentence per feature, matching current controls, whole-screen consistent framing and visible attribution. Replaced the feed's unproven “workouts and food” caption and the absolute “every workout”; no device/AI guarantees or marketing filler were added.
