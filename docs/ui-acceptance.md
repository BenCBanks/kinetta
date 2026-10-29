# Screen, interaction and loading acceptance

This expands the launch checklist for [#351](https://github.com/BenCBanks/kinetta/issues/351). The executable
[inventory](../dev/tests/ui_inventory.json) covers all 56 registered client route definitions and 89 explicit
route/view cases. `test_ui_inventory.py` fails when a route is added without a case. Dynamic cases use fictional
activities, friends, recipes, exercises, segments, cards and challenges; a missing-resource page cannot count as
the successful resource view. Old addresses are checked as redirects. Eight signed-out entry states and all 11 administration sections are listed separately; these are rendered outside the registered client routes.

## What must be reviewed

| Area | States and actual interactions |
| --- | --- |
| Startup and entry | Cold/warm opening; failed required script and Reload; delayed API; login/logout; invitation/signup/waitlist; confirmation/reset errors; first-use welcome |
| Stable five tabs | Me → Activity → Track → Progress → Nutrition and back; correct selected tab; responsive shell; scroll restoration; interrupted/reordered reads |
| Me and settings | Conditional food-first home, empty home, profile, friends/challenges/milestones, gear/goals, account/body/privacy/AI/notification/device sheets; cancel and validation |
| Activity and recording | Own/shared detail, charts/details/splits/efforts, missing GPS/speed/HR sharing, photos/maps/failure retry, recording start/pause/resume/finish/discard and interval controls |
| Progress | Mileage period/sport/date changes, records/history, fitness/chart gestures/reset, collapsed/expanded prediction help, lifting/exercise history, calendar, matched routes, personal heatmap and segments |
| Nutrition | All log/progress views, date changes, clear empty meals, one yesterday-copy action, meal/all-meal preview/cancel/confirm, saved foods, imports and nutrient forms |
| Recipes and food entry | Fresh creation independent of Add food, name first, ingredient/known-total flows, save with logging off/on, clear deletion, imports, visible quick actions/Kit icons, search/manual/photo/barcode entry and keyboard/drafts |
| Social and sharing | Search/filter/manage friends, long names and carousel reachability, profile permissions, unified feed and separate private history, card/QR/rotation/revocation, recaps, milestone receipt retry, challenge joins/leaves/removal/end/finish |
| Boundaries | Unsupported browser/native capabilities, stale account/server responses, offline cached reads, failed/empty APIs and meaningful retry; no live device/provider actions |

Run normal phone text separately from enlarged accessibility stress captures. The baseline uses the app's 16px
root; its measured body text is 15px. A 24px-root stress capture intentionally enlarges rem-based text and is not
the baseline appearance. Check 330/390px, a short phone, desktop and both themes. Long content must remain reachable;
ordinary labels wrap. Check figures inside their own statistic cells as well as the page edges: narrow/enlarged activity totals must reflow without colliding. Horizontal suggestion cards need an explicit scroll-to-last-card check, not only a page-width
test. Dense chart/calendar points retain their permitted compact grid; practical buttons have 44px touch targets.

## Loading and speed evidence

Measure initial load, navigation's first frame and route readiness separately. Check a warm cache, cold account
and a stated delayed-API condition. A fast heading alone does not prove that its data or controls are ready.
Likewise, a successful API response does not prove the control works. Exercise the actual button, switch or tab,
check the visible result and verify that drafts, selection and the relevant saved state agree.

An unavailable map, model or native capability must explain the situation without trapping the whole screen.
Required script failures offer a clear startup retry. Slower startup retains a Reload action; an active recording
or ordinary API failure must never be replaced by that startup guard.

Record the simulated conditions and limits alongside measured timings. Local browser/API tests do not establish
real mobile-network, physical iPhone, camera, VoiceOver, background-GPS, audio-route or battery performance.

## Completion

Keep concrete findings and verification in the combined PR. After repairs, run the entire original regression
suite twice against the final combined code, repeat the two code-review lenses, and inspect the final captures
and interactions. Merge, deployment, provider activation, signed upload and physical acceptance stay separate.


The owner requested an additional complete [lifting flow review](lifting-review.md) after the PR/website rereview. The final combined code ae1c0ad passed the original suite twice; the expanded712-case inventory and targeted final controls/privacy/touch checks passed, and their changed captures were inspected. Both current Simulator checks passed; all20 native captures were inspected. The subsequently queued notification work can now follow the completed software review.
