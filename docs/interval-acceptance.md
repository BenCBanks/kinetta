# Outdoor spoken intervals: acceptance record

This is the software evidence map and the physical test sheet for [#305](https://github.com/BenCBanks/kinetta/issues/305).
The first release is outdoor iPhone, spoken prompts only. Saved-route co-use and indoor/treadmill delivery are deferred.
An unsigned build, a Simulator capture or a successful speech API callback is not evidence that someone heard a cue.

## Software checks

| Requirement | Executable evidence |
| --- | --- |
| Exact time, distance and mixed expansion; authored order, repeat counts, final recovery and unit preservation | `dev/tests/test_intervals.py`, `test_interval_client.js`, shared `fixtures/interval_presets.json` |
| Exact native thresholds, overshoot allocation, continuity gaps, pause/skip/end and journal recovery | `mobile/tests/intervals/main.swift`, compiled and executed by the iPhone workflow |
| GPS quality, recording recovery and route data never supplying measured distance | `mobile/tests/track/main.swift`, `test_track_native.js`, `test_track.js` |
| Voice-only Start, unsupported/older-app handling, account switch and older-server save guard | `test_interval_client.js`, `test_track_native.js` |
| Preset/result validation, ownership, stale versions, retry receipts, save rollback and Watch merge order | `test_interval_api.py`, `intervals_incontainer.py`, `test_track.py`, `test_phone_watch.py` |
| Private SQL reader, export/deletion and no interval details in friends' responses | `intervals_incontainer.py`, `test_interval_api.py` |

The final combined regression runs execute the Python, JavaScript and API groups above. Exact-head iPhone CI executes
the native Foundation fixtures, Simulator/device compilation, archive checks and the separate native layout matrix.
Record their actual results in the implementation PR; this table identifies coverage, not a substitute pass claim.

## Signed iPhone test sheet

Use the ten INT-01–INT-10 presets and expected sequences in #305. For each applicable scenario, record Pass, Fail,
Not tested or an explicitly accepted limitation. Keep raw routes, phone identifiers and personal records private.
Use fictional preset names and publish only sanitized findings.

| Scenario | Required observation | Current physical result |
| --- | --- | --- |
| Foreground outdoor, time/distance/mixed | Current Run/Walk, remaining target, next phase and one cue per boundary; Finish saves one private result | Not tested in this change |
| Locked pocket and another app | Hear the current cue at the logical boundary; record request and actually heard times separately | Not tested |
| Offline, including relaunch | Preloaded preset works; upload retries once; no discarded recording or fabricated progress | Not tested |
| Stationary time boundary and temporary GPS loss | Timed cue is observed without a fresh location; distance phases wait for trustworthy measured distance | Not tested |
| Poor GPS, jitter, disabled GPS or revoked permission | No invented distance; waiting/fatal-error behavior and recovery match the recording contract | Not tested |
| Pause two minutes at INT-01 2:10, then Resume | Run retains 0:50; no advancement or cue during pause | Not tested |
| Skip, End intervals, Finish and Discard | No obsolete cue; truthful partial/skipped result; ending intervals alone keeps ordinary recording running | Not tested |
| Music/podcast, call/Siri, speaker, wired and Bluetooth changes | No overlapping/stale instructions; playback restoration and any missed delivery reported honestly | Not tested |
| Silent, Focus and denied permissions | Actual spoken behavior is recorded; no promise to override a system setting | Not tested |
| Force quit, reboot, torn journal and storage pressure | Relaunch is defensibly paused; no old cue burst or lost measured workout | Not tested |
| Account/server switch or deletion with a cue/upload pending | No old-account speech, data, draft restoration or late upload | Not tested |
| Low power and a long session | Record start/end battery, duration, background behavior, recovery and any thermal/storage limits | Not tested |
| VoiceOver, large text and one-handed use | Action/remaining/next announced clearly; controls reachable; draft survives keyboard dismissal | Not tested |

For every row record source SHA, signed build/version, iOS/device model, start/end time, audio route, app state,
permissions, movement/GPS/network conditions, target boundary, request timestamp and actually heard timestamp.
Do not put device identifiers or private locations in a public PR. The proposed 0.1-second logical and 2-second
normal physical tolerances remain proposals until the owner records acceptance; report measurements without
silently declaring a new tolerance.

## Release decision

All physical rows remain open until observed on the signed candidate. Vibration is removed from the product and
does not gate voice-only release. Software verification, code review, merge, server deployment, TestFlight upload,
Apple processing and the owner's release decision are separate outcomes. No signed upload or real-phone action
is authorized by this document.
