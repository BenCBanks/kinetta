# Current-app screenshot brief — owner review required

Source-reviewed 27 November 2026 against frozen TestFlight source `f1811e87`; #1607 is recapturing this exact app source unsigned. Existing #1330/#1511 artifacts are historical references, not refreshed by this document. Nothing is captured, dispatched or uploaded by this refresh. See [source-review.md](source-review.md) for claim evidence and [submission-readiness.md](submission-readiness.md) for owner decisions.

Propose ten full-screen portrait images at1320×2868, light mode, from one unsigned native Simulator bundle with real UIKit safe areas. Use the actual large-display slot accepted by Connect; Apple's [current specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/) accept these dimensions. No resizing website captures, stitched views, fake system prompts or transparency. Start with raw app screens; an optional caption treatment needs a separate Ben preview.

| Order / proposed caption | Actual screen and fictional setup | Capture readiness |
| --- | --- | --- |
| 1. Your recent workouts | Home activity feed with Alex Example and fictional friends; a recent park run and ride | Existing `header-activity`; revalidate from final bundle |
| 2. Start with Track | Idle Track, outdoor Run selected, larger map and compact Start controls; fixed fictional park location | Existing `header-track`; #1587 is merged; retake exact bundle, no real GPS |
| 3. Review your run | Saved3mi run with matching time/pace, map, Pace and Heart rate charts | Existing `activity`; use current #1608/#1620 layout and matching elapsed-pace summary, not an old selector crop |
| 4. See your food day | Two fictional meals,915/1800kcal, units and macros agree; no medical/weight-loss claim | Existing `header-food`; reconcile exact fixture totals |
| 5. Review before logging | Add food with editable, unconfirmed food/portion card and clear Add to log action | `food-review` in #1607; use deterministic stand-in, no provider call |
| 6. Chart your recorded progress | Actual Kit average-climb line card:125/171/200ft, round100/150/200ft axis, dates, selection and missing-data note | Separate capture Draft #1607 adds this scene; validate against `dev/tests/kit_chart_ui.cjs`, not website phone framing |
| 7. Pick up a saved chat | Actual Kit history list with8 fictional chats and dates; reopen returns the same saved answer | #1607 scene; compare `dev/tests/kit_history_ui.cjs`; no real history |
| 8. Choose what Kit remembers | Actual What Kit remembers list with6 fictional details, including “I prefer morning runs.” and “I like meals I can prepare ahead.”, toggle and editable rows | #1607 scene; compare `dev/tests/kit_memory_ui.cjs`; show supported controls, not all sheets at once |
| 9. Catch up in Notifications | Current flat inbox: fictional reaction, comment and friend request, Today/Earlier groups and clear timestamps | #1607 scene; compare `dev/tests/notifications_compact_ui.cjs`; no sent push/email |
| 10. Follow your progress | Progress with fictional activity totals/achievements that satisfy their thresholds | Existing `header-progress`; retake exact bundle |

Every value above is a fixture brief, not a medical target or model-quality result. Resolve dates from one fixed fictional capture clock; screenshots, week range, units, meal sums, achievement thresholds and chat dates must agree. Points for the line card are already in display units; the fixture must not convert them twice. Include missing-data/in-progress qualification. If the final bundle lacks an enabled listed feature, remove or replace that image and its listing claim before submission.

## Runner and evidence handoff

Main's `dev/tests/native-ui/run.py` `STORE_STAGES` still has eight scenes (`header-activity`, `activity`, `header-track`, `header-food`, `food`, `header-progress`, `header-me`, `friends-typical`). It cannot capture rows6–9 merely by changing a command: `--store-stage` is restricted to those choices. Separate Draft #1607 implements the ten-scene capture work; its captures are not a merged runner or final approved assets. Recapture remains dependent on the selected final source, including any separately approved layout fixes. This PR changes neither runner nor workflow. The old stage name `friends-typical` must not be advertised as a separate friends-only feed if the actual frame is the Friends list.

- Record source/bundle hash, Simulator model/OS, fixed clock, scene readiness, image hashes, dimensions and safe areas with the artifact. Keep images/results out of git; attach Ben previews to the capture Draft.
- Test new scenes first at390/330 light/dark in a disposable app with writes/provider calls blocked. Those browser checks do not replace native Store captures. Verify selection and text fit at the final native size.
- For Kit examples, use intercepted fictional answer envelopes through the production renderer. Mark stand-ins in the evidence; never imply a generated claim was evaluated because the UI rendered it. No release bypass or real API key is needed for screenshots.
- Verify all ten native frames visually at full size: status/home bars, tab bar, keyboard absence, no error/unavailable banner, no clipping, legible axes and values. No account emails, remote credentials, actual location or people may appear.
- Freeze one artifact from the exact final source. On physical iPhone, check navigation, Track permissions/background, keyboard, Health and push separately. Ben approves the images before upload.

## Groups and optional replacements

Groups and its per-challenge “Share my total” control are merged in this baseline. Ben may choose a current group/challenge screen as a replacement (maximum ten retained); no replacement or new order is approved by this document. Use fictional usernames and eligible workout totals, with the sharing control visible. Do not imply that food entries, individual private workouts or Kit chats are shared with the group. Do not show the unmerged native Strava picker/Open in/guided import, promise uninterrupted background recording/upload, or use simulated permissions as device evidence. Lifting or a dark Kit card can be alternate previews; they are not an eleventh upload.

Apply `docs/design.md` website wording rules to captions: a few words, at most one short sentence, and each picture proves its adjacent claim. A feed alone does not prove food logging, a history list does not prove resume behavior, and a chart stand-in does not prove model quality. Keep consistent whole-screen framing, legible controls and map attribution; do not hide inconvenient error banners in an otherwise failing capture. Caption treatment, final selection and physical-device acceptance remain Ben's decisions.
