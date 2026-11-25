# Kit capability and source-consent inventory

Source baseline: `05d04944`, 25 November 2026. This is an implementation inventory, not a promise that every question can be answered. The active catalog is `coach_tools.TOOLS` plus `kit_tools.EXTRA`: 26 read-only tools. New comparisons, conversation retention and source-specific filtering are separate changes.

## Common boundaries

`kit_thread.permitted` checks the authenticated person's coaching access, AI/18+ consent and reviewed Kit release. `ai_access` also enforces required email confirmation, operator permission, known-age eligibility and any configured feature entitlement. `coach_chat.answer` rechecks access between provider rounds; the thread rechecks consent before saving. Provider availability, budget and release approval are independent gates. A tool is not authorization to make a paid call.

Identity is bound by `KitTools(authenticated_user_id)`, outside model arguments. The fixed schemas forbid extra keys, including another person's ID or SQL. `db.coach_connect` applies read-only mode, a three-second statement timeout and the `fit_coach` RLS identity; a supplied application transaction uses `coach_scope`. Queries also constrain `user_id`. Ownership failures must not distinguish a foreign record from a missing record.

The shared `Range` permits an ordered span of 0–730 days (731 inclusive dates). Specialized bounds below supersede it. Dates are account-local for workouts and stored local dates for food/weight. Missing measurements and food logs are unknown; a logged food day can still be partial. All names, descriptions and remembered statements are untrusted data.

## Current source-consent behavior

| Boundary | Current implementation |
| --- | --- |
| Apple Health workouts | If any own workout has source `healthkit` or a `healthkit_id`, `coach.health_ok` requires `health_ai_ok`. A manually recorded workout with a Health identifier is still Health-derived. |
| Health resting energy | Apple Health resting-energy presence also participates in the Health gate; the dedicated reader explicitly requires `health_ai_ok`. |
| Health-derived weight | If the profile weight is Health-derived or an own weight has source `healthkit`, both `health_ai_ok` and `health_weight_ai_ok` are required. |
| Garmin workouts | Any own `garmin_connect` workout requires the separate `garmin_ai_ok` consent. One source's consent never grants another's. |
| Mixed training tools | Most Kit tools call the **account-wide** `health_ok` gate before reading. One unconsented source can therefore block unrelated manual records or a saved training plan. They do not currently filter individual rows by source. |
| Food/settings/app tools | The Kit dispatcher exempts profile, nutrition summary/adequacy, meal options/combinations, food log, nutrition-days-vs-goal, stored foods, goals and app destinations from that account-wide gate. These outputs omit raw Health/body measurements. |
| Later provider/save checks | The answer runner's non-Health allowlist omits `nutrition_adequacy`, unlike the dispatcher. A successful adequacy result can consequently require the account-wide Health check and be marked Health-included. This is conservative over-blocking, not permission to disclose Health data; align it in a separately reviewed answer-contract change. |
| Revocation/history | Health-included context and answers remain subject to current consent, including an in-flight revocation. Historical answers are not fresh evidence. The broad existing Health marker cannot express which individual source was used. |

The bounded comparison follow-up should filter permitted sources **before aggregation**, retain manual/otherwise permitted records, report the permitted scope and never return denied-source rows or their counts. It must not weaken other tools' existing gates. Registering new evidence with the model requires matching reviewed evaluation; a helper test is not rollout approval.

## Tool coverage

In the final column, **independent** means the Kit dispatcher's food/settings/app exception; **account-wide** means `coach.health_ok` as above. It does not replace the common AI/access/release checks.

| Tool | Own records and result | Bound / qualification | Current source gate |
| --- | --- | --- | --- |
| `profile` | Time zone, units, saved nutrition targets and local today | One profile; no identifying/body fields in the Kit override | independent |
| `nutrition_summary` | Food-day known subtotals, complete totals and per-logged-day means | Range; unknown nutrient flags override placeholder zero | independent |
| `nutrition_adequacy` | Recorded calories/protein against saved targets | Up to 366 inclusive dates; excludes today/future; current targets are not historical target evidence | independent at dispatch; later answer checks differ |
| `meal_options` | Saved dishes/usual foods, portions and remaining recorded targets | One date; up to 30 saved dishes; deterministic candidates, not invented macros | independent |
| `meal_combinations` | Ranked combinations of those known foods | One date; backend candidate IDs; confirmation required to log | independent |
| `food_log` | Food entries, portions, provenance and known nutrients | Range; 50 rows per page with a cursor | independent |
| `nutrition_days_vs_goal` | Daily logged calories and applicable saved calorie goals | Up to 366 inclusive dates; missing/unknown days have no numeric difference | independent |
| `stored_foods` | Private saved recipes, custom foods or meal combinations | 10 records per page; selected own ID for details; up to 60 ingredient/item rows | independent |
| `goals` | Saved activity goals and nutrition settings | Up to 50 activity goals; intention is not completion | independent |
| `app_features` | Fixed app destinations and editor purposes | Fixed allowlist; opening an editor does not save anything | independent |
| `activities` | All-sport workouts and full-range totals by sport | Range; 50 listed rows per page; totals are not page totals | account-wide |
| `activity` | One workout's stored measurements, name and description | Own ID; description capped at 2,000 characters; missing values stay unknown | account-wide |
| `recent_runs` | Running measurements and full-range aggregate count/totals | Range; 100 listed runs; explicit truncation | account-wide |
| `comparable_routes` | Own efforts on the selected own activity's matched route | Own anchor ID; 100 efforts; no route coordinates or other athletes | account-wide |
| `period_compare` | Workouts, distance, duration and protein versus prior equal period | At most 366 completed local dates per period; rejects today/future; exact aggregates | account-wide |
| `trend` | Daily distance, duration, workouts, protein or calories and fitted slope | 2–366 inclusive dates; today/future excluded from fitted values; no causal claim | account-wide, including food metrics |
| `consistency` | Recorded workout/food days and plan-covered run attendance | Up to 366 inclusive dates; completed dates only; no plan means unknown attendance | account-wide |
| `personal_records` | Strictly faster stored best efforts by exact sport/distance | 1–50 improvements, default 20, exact total/truncation; first effort is baseline | account-wide |
| `weight_trend` | Own weight samples, fitted values and endpoint change | Range; missing samples remain missing; endpoint change is not a causal trend | account-wide, including Health-weight category |
| `training_load` | App load-curve estimates and missing-effort count | Range bounds output; prior recorded effort seeds the curve; not measured recovery | account-wide |
| `training_plan` | Current settings, nearby weeks and recorded completion | Weeks starting from 21 days before to 14 days after today | account-wide, even for a saved manual plan |
| `plan_options` | Backend-permitted schedule adjustments | Derived from that current plan; candidate IDs only, separate confirmation | account-wide |
| `strength_history` | Completed sets and exercise summaries | Range; 50 sets per page, up to 100 exercise summaries; unfinished sessions excluded | account-wide |
| `body_profile` | Entered body and heart-rate settings | One profile; no inference that settings are current measurements | account-wide, including Health-weight category |
| `gear` | Equipment and recorded distance including entered starting distance | Up to 50 items; no replacement/health diagnosis | account-wide |
| `resting_energy` | Synced Apple Health resting-energy observations | Range; up to 731 days; missing days stay unknown | account-wide plus explicit Health consent |

Food-thread Kit has a smaller `FoodTools` allowlist: `profile`, `nutrition_summary`, `nutrition_adequacy`, `meal_options` and `meal_combinations`. It has no activity, body, weight or arbitrary tool access. It is a separate scope and release gate.

## Gaps for subsequent small changes

- Source filtering is currently account-wide for mixed tools, with coarse saved-context consent marking. An independent comparison reader needs explicit permitted-source provenance and revocation coverage before model integration.
- No dedicated stored splits or heart-rate-zone reader is registered. Do not promise split/zone analysis merely because workout rows can store those fields.
- All-sport and strength pages have cursors; same-route and recent-run results instead expose truncation. Do not treat a listed page as a complete ranking or baseline.
- Existing equal-period comparisons reject in-progress periods. Month-to-date semantics and charts remain separate product decisions; this inventory does not approve them.
- A fresh visit's recent context is bounded to six completed answers. Closing/expiry deletes transient turns; inspectable preference memory is separately bounded to 12 statements/180 days. The owner decided durable conversations stay until deletion, with single/all controls and account export/delete. Storage/API are separate Drafts; a default-off rollout switch preserves the current transient behavior until reviewed activation.

No new model tool, prompt, provider setting, endpoint, migration or data access is introduced by this inventory.
