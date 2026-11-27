# Kit capability and source-consent inventory

Source baseline: `1f7257b05f281d824c74e5608dac4ac5436b7199`, 27 November 2026. This is an implementation inventory, not a promise that every question can be answered or a statement of deployment status. The active catalog is `coach_tools.TOOLS` plus `kit_tools.EXTRA`: **28 read/preview tools**. Goal confirmation, saved history and memory management use separate authenticated application endpoints; a model tool cannot write a goal or log food.

This replaces the 25 November `05d04944`/26-tool snapshot. The inventory is checked from source without providers or personal records. See [AI architecture](ai-architecture.md), [Kit memory](kit-memory.md) and the [goal-change implementation](../app/kit_goal_actions.py) for the surrounding contracts.

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
| Mixed training tools | Most Kit tools call the **account-wide** `health_ok` gate before reading. One unconsented source can therefore block unrelated manual records or a saved training plan. This is not a general per-source filtered tool catalog. The chart reader additionally filters denied Health/Garmin rows, but its earlier account-wide gate still applies. |
| Food/settings/app tools | The Kit dispatcher exempts profile, nutrition summary/adequacy, meal options/combinations, food log, nutrition-days-vs-goal, stored foods, goals, goal-change previews and app destinations from that account-wide gate. These outputs omit raw Health/body measurements. `goal_change_options` is also explicitly non-Health in the answer runner. |
| Later provider/save checks | The answer runner's non-Health allowlist omits `nutrition_adequacy`, unlike the dispatcher. A successful adequacy result can consequently require the account-wide Health check and be marked Health-included. This is conservative over-blocking, not permission to disclose Health data; align it in a separately reviewed answer-contract change. |
| Revocation/history | Context and answers remain subject to current consent, including in-flight revocation. Saved turns carry Health/Garmin markers and a source-consent snapshot; historical answers without sufficient provenance are conservatively excluded. Current source-removal/revocation invalidation and legacy quarantine remain in force. These markers are not per-measurement provenance, and old conversation numbers are not fresh tool evidence. |

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
| `goals` | Saved activity goals and nutrition settings | Own activity goals without pagination or an explicit row limit in the current reader; intention is not completion | independent |
| `goal_change_options` | Preview one explicitly requested target for one own existing activity goal | Positive own goal ID, finite positive value up to 1e9 and a fixed unit; no goal creation/deletion or nutrition/body target changes; separate preview and confirmation | independent; explicitly non-Health at later answer checks |
| `app_features` | Fixed app destinations and editor purposes | Fixed allowlist; opening an editor does not save anything | independent |
| `chart_series` | App-computed workout counts, distance, time, pace, ascent, heart rate or calories | Fixed sport/aggregation/grouping enums; request 1–52 days/weeks, subject to output limits: 30 workouts or day points, 26 week points, 12 month points; pace/heart rate cannot be summed | account-wide, plus permitted-source filtering in the reader |
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

## Answers, charts and confirmed actions

Kit uses checked conversational paragraphs/short lists, with application-formatted evidence values. Numeric, comparison, source-consent and narrow medical-safety checks remain separate from tone. App-owned weekly/ordinary fallbacks use checked facts when generated wording cannot be accepted; an unavailable provider, access restriction or transport failure is a separate condition. Validated streaming sends checked answer blocks rather than unvalidated provider tokens; it does not bypass ownership, claim, cancellation or save-time checks.

Charts appear inside Kit answers. The model selects an existing `chart_series` evidence ID; it cannot supply points or markup. The application formats units, labels and tap values. Total/count comparisons use bars; suitable averages or per-workout trends use joined points with missing gaps. An app-computed training-review visual can be attached without the model requesting a chart. Current/partial periods are labelled; missing distances stay unknown, not zero. Zero recorded workout count is not proof of inactivity. Pace is distance-weighted, heart rate is time-weighted; chart summary direction and completeness constrain claims, and fewer than three measured points cannot establish a trend. The reader has no weight metric: weight analysis uses its separate tool.

The goal preview must match a target/unit explicitly requested in the current message, not remembered text or assistant advice. The app checks the selected candidate, binds the proposal to the owner and source answer, and requires an explicit confirmation. Confirmation rechecks current access, ownership, proposal expiry and the goal's unchanged baseline under a lock; an applied proposal returns its receipt on retry. Existing plan/meal candidates retain their separate confirmation flows. Opening a destination or accepting advice is never permission to save something.

## Saved conversations and memory

- Saved history is implemented in `kit_history.py`, `kit_history_api.py` and `kit_thread.py`, behind `KINETTA_KIT_HISTORY_ENABLED=1`. Source support does not establish that a particular installation enabled it. Saved conversations remain until the person deletes one/all or deletes their account; consent/source invalidation can remove answer content earlier. Legacy answers with unknown provenance are retained privately in quarantine and hidden from display/replay.
- A visit remains transient, but saved turns detach before visit cleanup. Leaving or switching a conversation cancels pending work without erasing its saved answers or silently retrying a provider. Switching apps can reopen the saved chat through the client; this is not unlimited model memory. The generation scope selects up to six earlier completed, non-invalidated answers from the same conversation, then applies current consent checks. It never reads another chat to fill a gap.
- Application limits are 500 saved chats, 200 turns per conversation and 100 visits per account. History pages return 20 conversations or 50 turns with cursors. These storage/list bounds are distinct from the smaller provider context.
- Inspectable memory is separate: at most 12 own goal/preference/routine statements, up to 400 characters each; provider context includes only permitted statements updated within 180 days while memory is enabled. Turning memory off makes it unavailable to Kit; it does not prove that no details were saved. The person can add/edit/forget details and switch memory off. Version checks cancel stale in-flight answers; Health provenance is preserved. Current user instructions override older statements, which remain untrusted data rather than authority for actions.
- Account export/deletion includes the stored Kit data. Saved history, context and memory retain ownership checks; source/consent loss can invalidate answers and consent revocation can erase affected notes. Inspect the current storage triggers for exact erasure scope rather than assuming every routine data update deletes history.

## Remaining boundaries

- Most mixed tools still use the account-wide source gate. An independent source-filtered comparison helper is not registered in this catalog; any future integration needs explicit permitted-source provenance, revocation coverage and current consent checks before provider transmission/saving.
- No dedicated stored splits or heart-rate-zone reader is registered. Do not promise split/zone analysis merely because workout rows can store those fields.
- All-sport and strength pages have cursors; same-route and recent-run results instead expose truncation. Do not treat a listed page as a complete ranking or baseline.
- Existing equal-period comparisons still reject in-progress periods. A chart that includes today is not permission to claim a completed month-versus-month comparison.
- Tool access is bounded and question-specific; it is not arbitrary SQL, access to every stored field, another person's shared records or a medical assessment. The nutrition-adequacy dispatch/answer classification mismatch above remains a conservative limitation at this source revision.

No new model tool, prompt, provider setting, endpoint, migration or data access is introduced by this inventory.
