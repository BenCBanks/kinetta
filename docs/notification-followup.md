# Useful personal notifications · 29 October 2026

This follow-up starts after the launch, PR, website, lifting and charts-first software reviews completed in PR344. It is a separate, stacked change; it does not authorize deployment or sending alerts to real people.

## Research and selection

[Apple's notification guidance](https://developer.apple.com/design/human-interface-guidelines/notifications) favors timely, concise information, consent, avoiding repeated alerts and keeping sensitive information out of previews. [Apple's delivery documentation](https://developer.apple.com/documentation/usernotifications/) also says delivery is not guaranteed. These are optional conveniences, never an alarm or a requirement for using Kinetta.

[Runna's documented reminders](https://support.runna.com/en/articles/17350012-how-to-set-up-workout-reminders-in-runna) have explicit controls, selectable times, no reminder on a rest day, one combined daily reminder, and suppression after completion or rescheduling. That supports a small, predictable plan reminder. It does not prove a retention benefit for Kinetta.

[Strava's progress summary](https://support.strava.com/en-us/articles/15401618-progress-summary-chart) and [Month in Sport](https://support.strava.com/en-us/articles/15401741-month-in-sport) make reviewing recorded progress a recognizable product use. This is evidence about their review features, not evidence that they send a particular weekly push. A quiet weekly invitation to Kinetta's existing private workouts-and-food summary is our product judgment.

| Avenue | Decision |
| --- | --- |
| Planned workout | Build: useful timing tied to a plan the person chose. |
| Weekly private summary | Build: one useful look back, including people who log food without workouts. |
| Milestones and challenge moments | Preserve existing configurable alerts; avoid duplicate celebrations. |
| Meal logging | Preserve existing optional usual-time reminders. |
| Monthly recap | Keep the existing quiet in-app offer; another push would overlap weekly summaries. |
| Streak rescue, inactivity, calorie/weight/HR warnings or motivational AI | Exclude: pressure, sensitive previews, uncertain interpretation or unnecessary model cost. |

## Requirements

**Problem:** useful plans and private summaries are easy to overlook; existing alerts emphasize activity imports and social events.

**Outcome:** people can independently opt into two predictable iPhone alerts under Settings → Notifications, inspect their schedule, and turn either off. Manual features, Kit consent and existing social choices remain independent.

**Example:** a person chooses an 8 am plan reminder. A still-due workout produces one generic alert; a completed workout or rest day stays quiet. Someone choosing weekly summaries gets one Monday invitation when the preceding seven completed local days contain a finished workout or food log.

### Controls and presentation

- Add a compact Training & progress card, with Planned workouts and Weekly summary switches. Both start off, including existing accounts. Opening settings never enables anything.
- Planned workouts offers 7 am, 8 am, noon, 6 pm or 8 pm in the profile's time zone. Weekly summary states Monday at 9 am in that same zone. These are not workout start times.
- Controls and read-back are available from browser and native settings; enabling requires a valid registered iPhone and ready server delivery setup. Disabling always works, including when setup later fails. Old native versions still show the explanatory controls.
- Saving is explicit per control, reports failure and restores the saved value. Pending controls cannot submit concurrent changes. Account/navigation changes fence late replies. Failed loads offer Retry. Normal/narrow/enlarged light/dark layouts fit; inputs retain 16px minimum and practical controls 44px targets.

### Scheduling and safety

- Use the existing server APNs path and registered session/account checks. No browser delivery, launch permission prompt, bell/feed rows, AI calls, new provider or dependency.
- Store explicit activation times on the server. Enabling or changing the plan time starts at the next future scheduled instant. Never catch up a time already passed, replay an old period, or burst after downtime.
- A worker considers only opted-in accounts. Compute local schedule cheaply before any plan/history read. Use a 15-minute delivery window, valid-zone fallback, and once-only claims across concurrent workers/restarts. One plan attempt per local date and one weekly attempt per local week; at most two new personal alerts in a day if both are chosen.
- Planned workout eligibility uses the existing deterministic plan builder, adjustments, manual completion marks and recorded-distance completion rule. No active plan, rest day, finished workout, past/future day or ended plan means silence. No new training recommendation or pace is calculated for the message.
- Weekly eligibility needs at least one own finished activity or food entry in the previous seven completed local days. Exclude unfinished lifting and future records; a blank account stays quiet. No minimum calorie, weight, streak or performance threshold.
- Recheck preference, current time zone/window, account/session and relevant eligibility immediately before each device delivery. Claim only the current account just before delivery, after the transaction commits. Slow network work must not hold profile/history locks or preclaim later accounts.
- A failed or uncertain delivery is not automatically replayed for the same period: duplicate avoidance takes precedence for these optional alerts. Device retirement follows existing handling. Explain that delivered notifications cannot be recalled and iOS may delay or suppress them.
- Generic titles/bodies contain no names, meals, location, dates of birth, body measurements, targets, totals, pace or HR. Plan opens the current private plan. Weekly opens the existing private Progress summary expanded, with visible current dates; it is not a frozen report or an AI review.
- Keep only bounded attempt metadata (kind, period, attempted time and delivery count), with 90-day cleanup, own-row access, export and account-erasure coverage. Never retain a notification payload or device token in the attempt record.

## Done when

API/SQL tests prove off defaults, explicit opt-in, validation, own-row isolation, RLS/export/erasure, device readiness, concurrent claims, disable/completion/time-zone rechecks, expired sessions, no catch-up, DST/week boundaries, invalid-zone fallback, empty/food-only/open-lift cases, failure isolation and bounded retention. Delivery uses stand-ins throughout.

Rendered checks exercise both switches/time choices, read-back, failures/Retry, stale-account/navigation handling, unavailable setup and the actual summary destination at phone/desktop widths, both themes and enlarged text. Inspect captures, review source twice and run the entire original regression suite twice on final code. Fresh install plus upgrade preservation is required for a migration. Record CI separately from physical-phone push acceptance, merge, deployment and TestFlight.
