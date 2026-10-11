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

## Food
- [x] Log by search (USDA + Open Food Facts), barcode, quick add (cal/P/C/F), custom foods, saved meals, recipes
- [x] Photo (+ optional description) -> AI estimate (Gemini Flash-Lite, ~$0.001/photo on your own key) -> check -> logged
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
- [ ] Notifications on the phone (web push) for new activity notes and weekly review
- [x] Sharing between people (2026-10-11, off by default): friends found by name or username, a Feed of yours and your
      friends' activities (Mine for just yours), sharing per activity, hidden map ends, cheers and comments
- [x] Admin: reset a person's password, remove a person + all their data (Me > Account > People)
