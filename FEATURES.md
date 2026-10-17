# Kinetta — features

Goal: everything the big fitness and food apps do, plus deeper analysis and optional AI — private, on your own server.
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
- [x] Upload FIT / GPX / TCX (also .gz) from phone or PC
- [x] Upload the whole Strava export .zip (names, descriptions, gear, private notes, commute flag kept; photos later)
- [x] Very large exports: drop the zip in `data/inbox/<login>/` and run the importer on the server
- [x] Duplicate detection (same start time ±2 min + similar distance), so Garmin and Strava copies never double-count
- [x] Garmin automatic sync through intervals.icu (needs your intervals.icu API key)
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
- [x] A watch strength workout (Apple Health, file, intervals.icu) that overlaps a logged session joins it (heart rate, calories) instead of doubling
- [x] Log a past session by hand, then add its sets; the AI coach note reads the sets and last time's; SQL view `v_lift_sets`

## Food
- [x] Optional goal-first setup (#122 A): five goals, private optional body details, everyday activity and bounded pace;
      review/edit calorie and protein estimates before an explicit Save. Skip writes nothing; existing macro targets,
      daily overrides and Health/resting choices are preserved. Available from Me and Nutrition without a watch or AI.
- [x] Native Me setup restores optional Connect Apple Health until sync is enabled, including accounts with history;
      finished setup never leaves an empty heading/card. Physical-iPhone permission/haptic/text checks remain separate.
- [x] Describe what you ate in your own words (several foods, amounts, day/meal, follow-up corrections): matched against your own meals, foods and history with no AI; only unknown foods go to the AI estimate, and without AI you search for them
- [x] Log by search (USDA + Open Food Facts), barcode, quick add (cal/P/C/F), custom foods, saved meals, recipes
- [x] Photo (+ optional description) -> AI estimate (Gemini Flash-Lite; cost varies with input and retries, with durable caps) -> check -> logged
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
- [x] Invite links (one use, 7 days); each new account starts in its phone's time zone and units
- [x] Private accounts, read-only SQL login per person with row-level security + friendly views, one-command database backups
- [x] Notifications (2026-10-11, `notify.py`): friend requests, accepted requests, cheers, comments and shared meals in
      Me > Notifications (a number on the Me tab, a dot on Today's bell), and in the native iPhone app through APNs when turned on; browser push is retired
      (each kind can be switched off); the iPhone app gets them once it can use Apple's push service
- [x] Sharing between people (2026-10-11, off by default): friends found by name or username, a Feed of yours and your
      friends' activities (Mine for just yours), sharing per activity, hidden map ends, cheers and comments
- [x] Admin: reset a person's password, remove a person + all their data (Me > Account > People)

## Me and native activity tracking (issue #108, under review; not released)

- [x] Me replaces Today as home, with the fixed fourteen-day chart, personal identity, current-day panels, useful tools and grouped settings.
- [x] Personal/profile fixed14day distance charts use exactly the shared feed visibility rules.
- [x] Track owns outdoor GPS, indoor timers, lifting, past entries/imports and source connections. Native iPhone GPS is independent of the WebView.
- [x] Pause/resume, review/private save, retry without duplicates and account-scoped recoverable drafts.
- [x] Native background location engine, protected point journal, account guards and WebView recovery.
- [ ] Apple SDK build and physical-iPhone background/locked-screen GPS acceptance.
- [x] Owner activity detail renders all recorded route sections; shared map previews retain the trimmed longest section.

See [Recording activities](docs/activity-tracking.md).

- Optional Apple Health Resting Energy for passive burn, added to existing activity calories with independent food goals; explicit read permission and source/time labels. Under review; Apple SDK/device acceptance pending. See [resting calories](docs/resting-calories.md).

- **Food-first home:** Today’s calories and macros, direct Describe/Snap/Scan/Usual logging, a preview of yesterday’s meal, and today’s workout calories. Friends and distance appear when there is something to show; all training tools remain available.
- **Shared ＋ Log:** fast food entry, workout recording and a prefilled weigh-in from the centre tab. A recording indicator returns to your draft in one tap. Progress switches between Food & weight and Training, remembering your choice.
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
