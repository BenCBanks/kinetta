# Current-app screenshot brief — owner review required

Prepared26 November2026 against main `fffd877f`; capture only after the exact submission source and fixes are frozen. Existing #1330/#1511 artifacts are historical references, not refreshed by this document. Nothing is captured, dispatched or uploaded here.

Propose ten full-screen portrait images at1320×2868, light mode, from one unsigned native Simulator bundle with real UIKit safe areas. Use the actual large-display slot accepted by Connect; Apple's [current specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) accept these dimensions. No resizing website captures, stitched views, fake system prompts or transparency. Start with raw app screens; an optional caption treatment needs a separate Ben preview.

| Order / proposed caption | Actual screen and fictional setup | Capture readiness |
| --- | --- | --- |
| 1. Your workouts and food | Home activity feed with Alex Example and fictional friends; a recent park run and ride | Existing `header-activity`; revalidate from final bundle |
| 2. Start with Track | New idle Track, outdoor Run selected, larger map and compact Start controls; fixed fictional park location | Existing `header-track`; retake after #1587; no real GPS |
| 3. Look back at every workout | Saved3mi run with matching time/pace, map, Pace and Heart rate charts; no duplicated/hidden needed chart | Existing `activity`; revalidate #1511's corrective capture; not an old selector crop |
| 4. See your food day | Two fictional meals,915/1800kcal, units and macros agree; no medical/weight-loss claim | Existing `header-food`; reconcile exact fixture totals |
| 5. Review before logging | Add food with editable, unconfirmed food/portion card and clear Add to log action | Existing `food`; use deterministic stand-in, no provider call |
| 6. Ask Kit, see your progress | Real Kit average-climb line card:125/171/200ft, round100/150/200ft axis, dates, selection and missing-data note | New Store scene needed; reuse tested `dev/tests/kit_chart_ui.cjs` fixture, not website phone framing |
| 7. Pick up a saved chat | Actual Kit history list with2 fictional chats and dates; reopen returns the same saved answer | New Store scene needed; mirror `dev/tests/kit_history_ui.cjs`; no real history |
| 8. Choose what Kit remembers | Actual What Kit remembers list: “I prefer morning runs.” and “I'm vegetarian.”, toggle and editable rows | New Store scene needed; mirror `dev/tests/kit_memory_ui.cjs`; show supported controls, not all sheets at once |
| 9. Catch up in Notifications | Current flat inbox: fictional reaction, comment and friend request, Today/Earlier groups and clear timestamps | New Store scene needed; use `dev/tests/notifications_compact_ui.cjs` fixture; no sent push/email |
| 10. Follow your progress | Progress with fictional activity totals/achievements that satisfy their thresholds | Existing `header-progress`; retake exact bundle |

Every value above is a fixture brief, not a medical target or model-quality result. Resolve dates from one fixed fictional capture clock; screenshots, week range, units, meal sums, achievement thresholds and chat dates must agree. Points for the line card are already in display units; the fixture must not convert them twice. Include missing-data/in-progress qualification. If the final bundle lacks an enabled listed feature, remove or replace that image and its listing claim before submission.

## Runner and evidence handoff

The current `dev/tests/native-ui/run.py` `STORE_STAGES` has eight scenes (`header-activity`, `activity`, `header-track`, `header-food`, `food`, `header-progress`, `header-me`, `friends-typical`). It cannot capture rows6–9 merely by changing a command: `--store-stage` is restricted to those existing choices. A follow-up fixture/runner change must add four real routes/states and choose this reviewed ten-scene set; no workflow or runner change is included here. The old stage name `friends-typical` must not be advertised as a separate friends-only feed if the actual frame is the Friends list.

- Record source/bundle hash, Simulator model/OS, fixed clock, scene readiness, image hashes, dimensions and safe areas with the artifact. Keep images/results out of git; attach Ben previews to the capture Draft.
- Test new scenes first at390/330 light/dark in a disposable app with writes/provider calls blocked. Those browser checks do not replace native Store captures. Verify selection and text fit at the final native size.
- For Kit examples, use intercepted fictional answer envelopes through the production renderer. Mark stand-ins in the evidence; never imply a generated claim was evaluated because the UI rendered it. No release bypass or real API key is needed for screenshots.
- Verify all ten native frames visually at full size: status/home bars, tab bar, keyboard absence, no error/unavailable banner, no clipping, legible axes and values. No account emails, remote credentials, actual location or people may appear.
- Freeze one artifact from the exact final source. On physical iPhone, check navigation, Track permissions/background, keyboard, Health and push separately. Ben approves the images before upload.

## Groups and optional replacements

Keep pending Groups/challenge redesign out of this set. After its complete release and review, propose replacing one image (maximum ten retained) with a real group/challenge screen, fictional members and accurate per-challenge sharing. Do not show an unreleased “Add challenge” flow or imply workouts/food details are shared when only eligible totals are. Lifting or a dark Kit card can be alternate previews; they are not an eleventh upload. The separate dark review is evidence, not a requirement to duplicate every Store image.
