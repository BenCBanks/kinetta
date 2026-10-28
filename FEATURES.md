# Kinetta — features

Release checkpoint — October 24, 2026: PRs #248–251 add welcome steps, account/device safety, in-app sign-up, filtered GPS distance, phone/watch matching, live pace, spoken splits and auto-pause. The hosted service has open sign-up with a 100-account cap and a waitlist when full; other installations configure their own mode. Physical-iPhone recording and locked-pocket speech acceptance remain pending. [ROADMAP.md](ROADMAP.md) records the current next steps.
Some entries below describe the scope when an earlier foundation was introduced; later entries complete their
integration. “Built” does not establish production/Apple processing, physical-device acceptance or public-launch
readiness. Food chat, recipe links and the Health food UI are integrated; the native Share extension remains
storage-only, restaurant integration still requires licensed-provider approval, and beta/device/model acceptance
remains open. No new implementation resumes automatically.


Goal: everything the big fitness and food apps do, plus deeper analysis and optional AI — private to each person.
Status key: [x] built · [~] partly · [ ] planned. Keep this list current when you build something.

## Research summary (what the best apps do)
- **Strava (paid)**: Fitness & Freshness, Performance Predictions, grade-adjusted pace (GAP), custom HR zones, power
  analysis, Athlete Intelligence (AI run summaries), compare past efforts, **Matched Activities** (same start, end,
  direction and distance -> pace-over-time chart with a trend line, fastest effort highlighted), best efforts + PRs,
  training log, weekly/yearly progress, goals, gear (shoes/bikes) mileage, personal heatmap, segments, photos.
- **Runalyze / intervals.icu**: effective VO2max per run from pace vs heart rate, race prediction from *current*
  shape (not just old PRs), acute/chronic load, pace/HR/power curves over 90 days, detailed equipment tracking.
- **MacroFactor / Cronometer (food)**: fast logging matters most (MacroFactor ~40% fewer taps); verified database
  (USDA) vs crowd data; barcode + label scan; recipes; custom foods; copy meals; weight trend; adaptive targets
  from the weight trend (expenditure estimate).
- **Strava bulk export**: `activities.csv` (Activity ID, Date, Name, Type, Description, Gear, Filename, Media,
  private note, commute, many duplicate metric columns), `activities/` (.fit/.gpx/.tcx, often .gz), `bikes.csv`,
  `shoes.csv`, `media/`. Activities with no file = manual entries (use the CSV numbers).

## Getting data in
- [x] Upload FIT / GPX / TCX (also .gz) in a browser; omitted in the iPhone app
- [x] Upload the whole Strava export .zip (names, descriptions, gear, private notes, commute flag kept; photos later)
- [x] Very large exports: drop the zip in `data/inbox/<login>/` and run the importer on the server
- [x] Duplicate detection: a phone recording and import merge at 80% overlap of the longer workout in either order, with available watch heart rate; short workouts inside much longer ones and two phone recordings stay separate. Other imports use time, sport, duration and distance checks.
- [x] Garmin Connect: sign in with Garmin; new activities can arrive by push after watch sync when the server supports it and Garmin activity sharing is enabled. Maps and heart rate depend on the source.
- [x] Apple Watch automatic sync through Health Auto Export (needs the app + a private upload link)

## Each activity
- [x] Map of the route, start/finish
- [x] Charts: pace (and GAP), heart rate, elevation, cadence, power — with a crosshair and readout on touch
- [x] Splits per mile/km (pace, GAP, HR, elevation change), laps from the watch
- [x] Moving vs elapsed time, elevation gain, calories, temperature
- [x] Heart-rate zones (time in each), effort score (TRIMP), aerobic decoupling (did HR drift?)
- [x] Effective VO2max estimate for runs with HR
- [x] Best efforts inside the activity (400 m … marathon) with PR / 2nd / 3rd badges
- [x] Edit everything: name, sport, description, private note, gear, commute; delete
- [x] AI coach note (what went well, what to watch, next suggestion) — honest, never guesses

## Over time
- [x] **Matched routes**: same route grouped automatically, pace + HR over time with trend line, fastest highlighted,
      "faster at the same heart rate" efficiency trend, rename routes
- [x] **Similar efforts**: compare with your other runs of similar distance
- [x] Personal records page: every distance, all-time and this year, history of each PR
- [x] Fitness / fatigue / form chart (42-day / 7-day load), ramp-rate warning
- [x] VO2max trend + race predictions (5K, 10K, half, marathon) from current shape
- [x] Training calendar, weekly and yearly totals per sport, streaks
- [x] Goals (weekly/yearly distance or time)
- [x] Training plans (2026-10-10, `plans.py` + `static/plan.js`): 5K/10K/half/marathon; first-timer run/walk (5K), beginner,
      intermediate, advanced; 6-20 weeks; 3-6 runs/week; long run Sat/Sun; optional race date + goal time; base/build/peak/
      cutback every 4th week/taper; paces from current VDOT (update as you get fitter); runs tick off workouts automatically; Today card;
      Progress > Plan tab, numbered setup with sticky Start, progress so far (workouts, distance, planned-vs-ran chart), About this plan,
      tap a workout for what/why, Change / Restart from week 1 / End
- [x] Gear: shoes and bikes with mileage, retire, replacement reminder
- [x] Personal heatmap of everywhere you've been
- [x] Weekly AI review (short; one-line summary on Today, full text in a sheet)

## Lifting (2026-10-13, `api_lifts.py` + `static/lift.js`)
- [x] Start a session from + (empty, or repeat a past one: its exercises and weights come along as planned sets to tick)
- [x] Per set: weight (lb/kg) and reps, seconds for holds, warm-up flag; last time's numbers shown grey in each box and beside the exercise
- [x] Session clock and time since the last set (a rest timer with nothing to set up); saves after every change, kept on the phone offline
- [x] Records per exercise: heaviest set, estimated one-rep max (Epley, 1-12 reps), most reps, longest hold, biggest session; marked on the set
- [x] Exercise page: records, a chart of the estimated 1RM per session, every session's sets, a note for next time ("seat on 4")
- [x] Progress > Lifting: recent sessions and every exercise with its best; feed cards show sets, weight lifted and the exercises
- [x] A watch strength workout (Apple Health, Garmin Connect, file) that overlaps a logged session joins it (heart rate, calories) instead of doubling
- [x] Log a past session by hand, then add its sets; the AI coach note reads the sets and last time's; SQL view `v_lift_sets`

## Food
- Pending food nutrition (#319, implementation branch): protein, carbs and fat before logging, with unknown values preserved; tap a food for source-serving and chosen-amount nutrition, source/brand/package details, amount changes, one-food label correction or removal. Scanned products with known calories can retain missing macros through explicit review; no AI prompt/model changes or provider calls are added. Physical-iPhone acceptance follows the next TestFlight build.
- [x] Optional goal-first setup (#122 A): five goals, private optional body details, everyday activity and bounded pace;
      review/edit calorie and protein estimates before an explicit Save. Skip writes nothing; existing macro targets,
      daily overrides and Health/resting choices are preserved. Available from Me and Nutrition without a watch or AI.
- [x] Native Me setup restores optional Connect Apple Health until sync is enabled, including accounts with history;
      finished setup never leaves an empty heading/card. Physical-iPhone permission/haptic/text checks remain separate.
- [x] Describe what you ate in your own words (several foods, amounts, day/meal, follow-up corrections): matched against your own meals, foods and history with no AI; only unknown foods go to Kit’s estimate, and without AI you search for them
- [x] Log by search (USDA + Open Food Facts), barcode, quick add (cal/P/C/F), custom foods, saved meals, recipes
- [x] Photo (+ optional description) -> Kit’s estimate (Gemini Flash-Lite; cost varies with input and retries, with durable caps) -> check -> logged
- [x] Edit / move / copy / delete any entry; copy a day or a meal
- [x] Daily totals vs targets (calories + macros), remaining
- [x] Weight log + trend line; later: expenditure estimate from weight trend + food
- [x] Faster logging (2026-10-10): "Same as <day>" on empty meals, Your usuals with one-tap +, default meal learned from your log hours
- [x] Offline (2026-10-10): app opens without signal (service worker), key screens kept on the phone, food/weight queue with
      client_id so resends never duplicate; Today food card (eaten/left/protein/weigh-in)
- [x] Cooking mode (2026-10-11, `api_dishes.py` + `static/cook.js`): add ingredients while cooking ("100 g chicken"), or type
      the dish's total; weigh the cooked dish (pans remembered), weigh your plate, and your share is logged; leftovers stay 5 days
- [x] AI feedback on food (2026-10-11, `food_coach.py`): a review of the last two weeks of eating (going well, what to
      try, anything to watch) on Nutrition > Trends, and feedback on a dish's recipe or a saved meal (per portion + tweaks);
      AI consent rules apply

- [x] Calendar (2026-10-11): the month at a glance for training and food together - each day's workout and whether you
      ate on target, weekly distance, trained / on-target / weigh-in counts; tap a day for the details

## Platform
- [x] One-command Docker install; passwords generated on first start; first account becomes the admin
- [x] Open sign-up with email confirmation, age 16+ check and an account cap; waitlist when full. Administrators can still invite members. Installations can choose invite-only or waitlist mode.
- [x] Invite links (one use, 7 days); each new account starts in its phone's time zone and units
- [x] Four optional welcome steps: profile, who sees activities, bring in workouts and find friends. Pending name/bio/audience changes save on Continue; Skip/Not now do not undo photo uploads or requests already confirmed.
- [x] Email or username login, password reset by email, and Create an account / Forgot password inside the iPhone app.
- [x] Settings → Signed-in devices: device labels/dates without IP addresses; sign out one other login or all others. Optional New sign-in emails for confirmed addresses, initially on; first and known device types are silent.
- [x] Private accounts, read-only SQL login per person with row-level security + friendly views, one-command database backups
- [x] Notifications (2026-10-11, `notify.py`): friend requests, accepted requests, cheers, comments and shared meals in
      Me > Notifications (a number on the Me tab, a dot on Today's bell), and in the native iPhone app through APNs when turned on; browser push is retired
      (each kind can be switched off); the iPhone app gets them once it can use Apple's push service
- [x] Sharing between people (new accounts default to Everyone on Kinetta, with welcome/per-activity/Settings choices; existing choices stay): friends found by name or username, a Feed of yours and your
      friends' activities (Mine for just yours), sharing per activity, hidden map ends, cheers and comments
- [x] Admin: separate /admin portal for invitations, password-reset emails, signing out sessions, suspension/restoration and account management, including removing an account and its data; members can also delete their own account in Settings → Your data

## Me and native activity tracking (issue #108; physical-device acceptance open)

- [x] Me replaces Today as home, with a fourteen-day chart, personal identity, current-day panels, useful tools and a separate Settings & account screen. Until activity or food history exists, Get started leads and the empty chart is hidden; profiles with nothing shared also omit empty charts.
- [x] Personal/profile fixed14day distance charts use exactly the shared feed visibility rules.
- [x] Track owns outdoor GPS (iPhone app only), indoor timers, lifting, past entries and source connections, plus file imports in browsers only. Native iPhone GPS is independent of the WebView.
- [x] Phone recordings keep every section for splits, charts and best efforts (never across a gap), record elevation, and hold up to 72,000 points (~360 km).
- [x] Pause/resume, review and audience choice before save, retry without duplicates and account-scoped recoverable drafts.
- [x] Native background location engine, protected point journal, account guards and WebView recovery.
- [x] Apple SDK builds; physical-iPhone background/locked-screen GPS acceptance remains pending.
- [x] Shared web/native/server GPS distance filter; live pace over 30 seconds, average and last mile/km.
- [x] Spoken mile/km splits initially on; native locked-screen audio configured. Physical locked-pocket acceptance pending.
- [x] Auto-pause after 15 seconds still with no backwards clock jump; initially on for run/walk/hike, off for rides, voice remembered per device/account, auto-pause also per sport. Lock Screen Live Activity remains planned.
- [x] Owner activity detail renders all recorded route sections; shared map previews retain the trimmed longest section.

See [Recording activities](docs/activity-tracking.md).

- Optional Apple Health Resting Energy for passive burn, added to existing activity calories with independent food goals; explicit read permission and source/time labels. Merged implementation; physical-device acceptance pending. See [resting calories](docs/resting-calories.md).

- **Activity-first home:** the 14-day chart, latest activity, today's plan, friends' recent activities, goals and fitness. People who track food (a calorie goal or food in the last 14 days) also see a compact Food today card with one Log food button and their weekly check-in; nobody else sees food on Me.
- **Tabs:** Me, Activity, Track, Progress, Nutrition. A recording indicator on Track returns to your draft in one tap. Progress opens on Training; food users can switch to Food & weight, and the choice is remembered.
- **Private food-thread API (foundation):** durable text messages, safe retries, older-history pagination, individual deletion, export and account deletion. Food links are owner-bound; no food-photo history is retained. Conversation processing and the visible thread follow in the remaining #122 D work.
- **Food-thread facts API:** private code-computed daily/weekly numbers, historic meals and burn-source explanations, plus supportive or numeric feedback helpers. Stored answers have an as-of time and safe retries. The visible conversation and food-processing integration are the next #122 D pieces.
- **Own-food thread engine:** code-resolved foods can auto-log with durable Undo, or wait for an explicit Log tap. Destination inference, stale-preview refresh and atomic reply/food saves are supported. The visible thread, corrections and unknown-food processing remain in the next #122 D pieces.
- **Thread corrections and references:** update current logged portions without losing manual edits, resolve owned-food/portion choices, move day/meal, copy recorded meals with explicit exclusions, and ask an honest remainder quantity. Retries are safe and require-a-tap remains effective. These APIs await the final #122 D interface.

- Food-estimator request caps survive restarts and concurrent workers. Structured
  estimates reserve a shared daily dollar budget for every attempt, with token-only
  accounting and a pause switch; non-AI logging remains available. See
  [AI budgets](docs/ai-budgets.md) for coverage and conservative failure behavior.
- Coach notes/reviews and every Kit tool-loop turn use the same durable provider
  budget and kill switch as food estimates, with per-account/service attempt and
  concurrency caps. Paid unbounded search grounding is paused; USDA lookups remain.
- **Thread source resolution API (interface follows):** ready parts save once while
  remaining foods use public catalog choices, barcodes, photos or manual nutrition.
  Unknown estimates use the existing consent/access/budget-gated model; clear own
  matches retain stored nutrition with an estimated portion. Logged AI foods become
  editable private foods with origin/assumption labels and zero-model reuse. Cancel,
  delete and retry guards keep late work from recreating food or text; photos are
  not retained. Omitted manual macros remain unknown in factual answers.

- [x] Pending food and weight uploads retain server errors with Review, Retry and
  Discard. Queue/cache ownership includes the server and account; an authenticated
  expected-account check blocks a changed cookie from receiving another account's
  queued write. Older native queues without a recorded server are retained without
  automatic upload. Permanent conversation UI remains in progress (#122 D).
- [x] Private quick food log with a fresh conversation on each visit, stable composer,
  durable text/photo outbox, capture timestamps, explicit retry/cancel, meal/day
  correction, source labels, Edit/Undo, require-tap logging and tone settings.
  Snap, Photo library, Scan, Paste and keyboard dictation share the conversation.
  New entries default to Today; already logged food stays saved and pending uploads
  remain visible across visits. Create a Recipe saves reusable ingredients separately.
  Private switch acceptance remains a separate #122 D requirement; the optional
  daily note was retired on 20 October 2026.

- [x] Search, Quick, usual and recipe-portion logs can create neutral conversation
  cards atomically; replays respect Undo and text deletion. Stable recipe-portion
  retries work offline. Held previews retain sources/estimates, blank Quick macros
  stay unknown, and delayed corrections remember their original food context
  (#122 D).

- **Shared Kit assistant (release gated):** one assistant across training, nutrition, strength, goals and progress, with a fresh chat each visit and manageable automatic memory of useful user statements, with contextual starting prompts, relevant own-record lookups, verified numeric evidence, explicit review/confirmation for changes, Retry and Start a new chat. Requires AI access/consent and a matching separately reviewed Kit report. Existing food-chat answers and reviews remain readable.

- **Evening food summaries retired (20 October 2026):** the setting, shortcut and automatic generation are removed. Nutrition insights start through the Nutrition Kit icon. Historical notes remain readable/exportable.

Connections shows Garmin Connect and Apple Health as ordinary connection choices, with Connect/Manage status. The iPhone app omits file imports; browser activity-history import remains available. Health Auto Export is under Other connections. Garmin Health sharing may be delayed and excludes GPS; direct Garmin can supply routes on new activities. Browser-only original-file import can enrich a matching own Health activity while preserving edits.

Nutrition insights distinguish logged food, a rough burn/energy model and recorded scale trends. A discrepancy names water changes, missed or underestimated food and burn-estimate error, then points to the weekly check-in; agreement is described as broad consistency rather than proof. Weight text uses the account's units. No per-bodyweight advice is inferred from a fallback weight. Energy captions identify Apple Health resting + activity, imported daily burn or formula sources, and never equate being under the food goal with a measured deficit or modelled energy with actual fat loss. These wording changes do not alter targets, calorie arithmetic or Health's passive-only rule.

- **Weekly adaptive check-in:** own food and weight history can suggest a goal-based calorie target once a week, with the numbers, source/uncertainty and resting-burn floor visible. Accept is required; Not now hides the card on Me until next week. Progress retains decision history and shows one next action when data is insufficient. Works with no watch, workout or AI; macros and the selected resting source remain unchanged.

Me's setup hints recognise any of the person's own saved food history as well as workout history, even when today is empty. The first-food/friends introduction stops after either kind of history exists. Food and activity responses may arrive in either order; setup redraws from the latest scoped results. Optional Apple Health remains visible on iPhone until enabled, and a setup heading never appears without rows. Shared facts/AI readers are unchanged; the extra history flag is on the authenticated HTTP day response only.

Recipe-link foundation (#122 N1, pending review): bounded public-HTTPS fetching and non-AI schema.org Recipe parsing, with fictional parser and SSRF tests. No user-facing import action yet; draft review, ingredient matching, rate limiting and screenshots follow in N2. See [recipe link design](docs/recipe-links.md).

Recipe-link draft API (#122 N2, pending review): authenticated, per-person rate-limited reads create private parsed drafts with matches to your own saved foods. No recipe or food entry is saved; retry, cancellation, expiry, data export and account deletion are covered. The review/save interface follows separately.

Recipe-link review/save API (#122 N3, pending review): explicit review and confirmation, per-nutrient published/matched/entered sources, unknown-preserving totals and fiber, stale-source second review, atomic replay-safe saves and imported multi-serving portions. Saving a recipe does not log food. User-facing import/review screen follows in N4; existing recipes retain their serving convention.

Recipe from a link (#122 N4, pending review): My Recipes reads a public HTTPS recipe into an editable private draft, shows per-serving nutrition/source labels and saves only after explicit review/confirmation. Multiple candidates, unknowns, stale sources, account-safe recovery and replay-safe saves are handled. Screenshot fallback and unknown-only ingredient estimates reuse existing opt-in food AI and stay in a held recipe draft; no automatic food log. Imported recipes log the right serving fraction; existing recipes keep their prior convention. Portion logging includes offline pending feedback and replay-safe toast Undo; reused estimated ingredients keep their AI source labels.

Extra nutrient foundation (#122 O1, pending review): nullable sodium in mg, total sugar and saturated fat in g; official USDA/Open Food Facts mappings, private food/custom/copy/export storage, coverage counts and optional unset limits. Unknown values remain unknown; reported zeros are preserved. Full recipe/thread/picker integration and phone controls follow separately; no new UI or AI recognition schema yet.

Recipes, imported published nutrition, logged portions, food chat, manually entered thread foods, learned catalog foods and corrections preserve sodium (mg), total sugar (g) and saturated fat (g). Unknown stays unknown through receipts and Undo, including calories-only recipes with missing macros. Existing five-field AI schemas remain unchanged, so they do not provide the extra nutrients. No new taps or UI controls in this backend part; the food detail/day/Overview controls follow separately.

- Optional sodium, total sugar and saturated-fat detail: folded daily totals with honest known/missing coverage, recorded totals in Overview, shared food/recipe entry and rescaling, and personal daily limits that start unset and require Save. Unknown is never displayed as zero. Existing label/photo AI does not infer missing extra nutrients.

- Weekly food review without AI: seven completed local days, days with food logged, protein across meals, fiber/sodium/total-sugar/saturated-fat coverage, top recorded calorie sources and up to two suggestions from your own log. Missing data stays unknown, Kit is separate, and no targets change automatically.

- Deliberate recipe sharing with approved friends: visible Share with…, Shared with you in usuals/food chat, two-tap default portions with Undo, separate private food logs, existing opt-in native alerts, and immediate access/notice revocation when sharing stops or a friend is blocked. Recent foods preserve current logged nutrition and all eight nutrients.

- **Apple Health weight foundation (#122 I1, backend only):** separately confirmed, off-by-default weight import with source labels, daily deduplication, manual-entry priority, replay/deletion protection and account isolation. Existing budgets/resting-calorie choices stay intact. New Health weight requires fresh category-specific AI consent. Native permission/setup and nutrition writing are follow-up parts of workstream I; this PR does not enable device sync.

- **Apple Health nutrition output foundation (#122 I2, backend only):** separate confirmed, off-by-default output of logged daily calories, protein, carbs, fat and fiber, with updates/deletions, unknown-value coverage and retry-safe revision history. Native permission controls and actual Health writes follow in I3.

- **Native Health food bridge foundation (#122 I3):** separate optional weight-read/nutrition-write permission methods, anchored weight acknowledgement and account-bound nutrition reconciliation with app-owned deletion and protected cursors. Registered but awaiting UI wiring in I4; physical-iPhone acceptance remains pending.

- **Optional Apple Health nutrition and weight (#122 I4):** independent Read weight and Share nutrition setup, no launch prompt, open/resume catch-up, status/retry/off and partial-permission feedback. Food edits/deletions/Undo update this app's allowed Health quantities; imported weight shows its source and respects manual entries. Account changes/disconnect stop native work first. Budgets and resting-calorie choices stay unchanged. Browser/native stand-in checks do not replace physical-iPhone acceptance.

- **Optional meal-time reminders (#122 K):** off-by-default native reminders around your own logging habits, only7am–9pm, skipping meals already logged. No guilt streaks or calorie alerts. Me → Notification settings shows the usual times, setup status and off switch. Today's current empty meal offers yesterday's meal or your usuals; copying preserves all8 nutrients and needs explicit confirmation. The weekly food review supplies the days-logged count. Real APNs/device acceptance remains pending #98.

- **iPhone food entry (#122 T1):** signed-in home-screen Log food action and a device-authenticated Log food in Kinetta Shortcuts/Siri text action open the permanent food chat for review. Existing drafts are preserved, interrupted handoffs deduplicate and nothing logs before Send. Physical entry-point/keyboard acceptance remains pending; Share to Kinetta follows in T2.

- **Entered nutrition in food chat (#122 D12):** calorie/macro/nutrient text becomes a held Your numbers review, with all8 values, units and unknown/zero meaning preserved. It is never catalog-matched as protein/carbs/fat foods. Explicit Log is required; unclear amounts/bases/dates stay held with a prefilled manual review. No AI or automatic target changes.

- **Undo queued food (#122 D13):** Quick, usual, combination, yesterday and Log again saves offer Undo, including offline. Stable-ID cancellation prevents an interrupted upload from restoring removed food; failures retain a retryable pending operation.

- **Food and training week (#122 R):** a private shared7-completed-day summary on Me and Progress; own today's workout links to the existing food-log energy calculation without double counting. My activities shows optional Health last-sync/pending/retry status, with bounded foreground catch-up and Garmin delay explanation. Physical GPS acceptance remains pending.


- **Native food-share foundation (#122 T2):** owner-bound durable job storage, immutable retry IDs, image integrity and bounded cross-process writes; separate unlocked/device-only credential storage. Runtime, Share-sheet UI, provisioning and physical acceptance follow separately.

- **Compact reactions and navigation:** one Cheers action with a hold/hover/keyboard/tap-accessible picker for Cheers, Strong and Applause; count opens the people list and failed saves roll back. Me puts the latest activity and conditional day before smaller shortcuts; Progress has a compact focus menu; Track keeps Start above a smaller map with secondary activities folded, skips hidden indoor maps and briefly caches the recent lifting session. Nutrition folds secondary goal/resting-source explanations into available energy details.

- **Calmer app typography:** app-specific 30px page titles, 18–20px card/section headings and 28px summary figures, tighter card/day spacing, readable body text and scalable inputs. Reactions use a small icon strip with full 44px choice targets and names on hover/keyboard focus.

- **Keyboard and short food replies:** no extra app keyboard Done strip; tap background/message text or swipe down to dismiss, with field/control/selection/map exclusions. Bare unresolved taco descriptions ask type/count and preserve either-order replies and the original meal/day without guessing a serving.

- Food entry uses one conversation and capture flow. Foods stay in an unfinished draft until final review, where an optional save-as-recipe checkbox, explicit meal and portion support saving, logging or both with one retry-safe confirmation. Manual foods retain their names, source and unknown nutrients as recipe ingredients; serving yield and cooked weight stay separate from the amount eaten. Visible meal logs refresh after completed writes, including late chat acknowledgements. Short unknown descriptions ask for missing amounts/type before lookup; ingredient estimates preserve supplied weights and ambiguous edits ask which ingredient.

- **Refresh and sharing:** pull-to-refresh on the main read-only tabs, without a header refresh icon, retained cached content during refresh, protected active chats/forms on app return. New accounts default to Everyone on Kinetta with a signup choice; existing privacy choices remain. Phone recordings show their audience before Save.

- [x] Every food estimate displays its current food/ingredient breakdown and total, including descriptions; reviewed ingredient generation is automatic rather than a checkbox and remains behind the food accuracy gate.
- [x] Submitted food photos appear as temporary on-device chat previews; clear/log/cancel/delete removes them. Completed previews use memory only and disappear on a full reload; pending uploads remain retryable. No server photo history or permanent food-photo storage.


Activity sharing: one 4:5 picture for texts, Instagram and anything else, opening the phone's own share sheet, with a browser save fallback and the start/end trimming choice. Tapping an activity's route opens the full-screen map; Close, Escape or Back restores the detail view. Native Instagram handoff still needs physical-device acceptance; browser and stand-in checks do not prove a post was published.

## App cleanup · October 24, 2026

- Me remains the daily summary. Settings & account opens a dedicated screen from Me or your own profile, with Log out near the top and existing unsent-data checks.
- Detail-page Back controls remain in a solid top bar while scrolling. Fitness charts expand into full-height analysis sheets with touch/hover/keyboard readouts, pinch/scroll zoom and drag/sideways-scroll panning, with no date sliders; Progress bars use sky blue.
- The activity picture is one size (1080×1350, 4:5). The map fills it and the details sit on a frosted, see-through card; start and finish markers show when not hidden. Route maps in the app show the same start and finish markers.
- Notifications use a short title and full body. iOS owns final banner size. The Help catalog covers definitions and the updated flows.
- Training-day nutrition guidance and automatic calorie adjustments are parked in `dev/deferred/training-food/`; see issue #236. The usual target and explicit day goals remain.


## Fixed segments and matched efforts

Immutable named segments, private matched times, opt-in public best-time boards and browser admin reports/appeals/holds with a global pause. See [segments](docs/segments.md). Generation-based rebuilds and integrity checks are implemented. Physical-iPhone/provider checks remain separate from implementation.

## Run/walk interval review build (#274)

Track holds private time/distance/mixed presets, exact repeat/final-recovery previews, immutable preloads and native interval controls. Guidance is spoken only; the vibration option was removed on 27 October 2026. The recorder owns clock/GPS progression and voice/system-vibration requests; one activity retains private planned/actual results with retry safety and account export/deletion. Browser authoring does not provide browser or indoor guidance. This implementation remains in review; signed locked/stationary/pocket delivery acceptance (#303/#305), merge, hosted deployment and TestFlight are separate gates. [Contract and capability matrix](docs/run-walk-intervals.md).
