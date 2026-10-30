# Run/walk intervals in Track

Implementation for #274, selected by the owner on 26 October 2026. Outdoor iPhone first, with spoken prompts as the only guidance (vibration option removed 27 October 2026; the native vibration request path remains but the app always asks for voice only). Indoor/treadmill, Watch and Android guidance remain later work. This branch is a review build, not a claim of physical acceptance or release.

Track → Intervals is the single authoring/loading home. A browser can save private presets and preview the exact sequence. Choosing a preset does not start a recording. The iPhone recorder receives a complete immutable copy only after Start. Run phases and Walk recovery remain one activity of the deliberately selected sport.

## Contract

`app/intervals.py` validates a schema-1 definition with sequential blocks, total execution counts, ordered Run/Walk steps and one time-or-distance target per step. Targets retain decimal strings and their units; expansion supplies seconds/metres without a pace estimate. Stable expanded keys identify block, authored step and execution. An explicit final Walk recovery can be omitted on only the last execution; warm-up/cool-down are separate labelled steps.

Limits: 50 authored rows, 100 executions per block, 1,000 expanded steps, 5 seconds–6 hours per time target, 10 m–100 km per distance target, at most 24 hours of time targets and 500 km of distance targets. The recorder's separate time/point limits still apply: a large planned target does not promise uninterrupted recording to its end. Nested/open-ended repeats and simultaneous AND/OR conditions are not supported.

Preset saves use owner-scoped mutation receipts and expected versions. A deleted ID becomes an empty tombstone so delayed retries cannot recreate it. Source edits/deletion never mutate a loaded or active snapshot. Account export includes active presets, receipts and private workout results; account deletion cascades through all three new tables. The ordinary SQL reader sees only its own rows.

## Execution and measurement

`IntervalState.swift` consumes eligible active seconds and accepted cumulative recording distance. It never takes distance from a route plan. Continuous accepted sample pairs allocate a crossing between phases; discontinuities cannot provide an invented bridge. A time-to-distance boundary can wait for a defensible distance baseline. Results keep unknown distance boundaries unknown.

`NativeTrackRecorder` owns the only GPS stream and a sleep-inclusive `mach_continuous_time` adapter, tested independently of forward/backward wall-clock changes. A 100 ms native timer advances logical time while iOS permits execution; GPS callbacks supply accepted sample evidence. Manual pause freezes the same eligible recording clock. Interval auto-pause initially overrides the session to off, with a separate explicit choice that does not rewrite ordinary sport preferences.

Transitions and attempted effects are persisted before delivery. Each channel retains logical boundary, pre-call request-mark time and optional OS-acknowledgement time on the shared active clock; these are distinct from physically observed delivery. A late batch suppresses obsolete instructions. Controls carry the expected phase key where needed; pause/end/finish/account changes cancel outstanding speech and pending effects. Relaunch restores a defensible paused recording, marks uncertain requests unknown and does not replay them. Resume is deliberate. Completion/end leaves ordinary recording running; Finish remains explicit.

Private results are validated in the same transaction as activity save. Before upload the client checks server support; an unavailable/older server keeps the draft. Native cleanup requires either acknowledged result saving or explicit discard, so an older WebView cannot erase the only interval copy. Their totals cannot replace recorded activity metrics or supply competitive times. Recording UUID receipts also survive phone/watch deduplication. Friends' activity responses do not include preset names, notes or per-step observations.

## Platform decision and honest capability boundary

- Outdoor background recording uses the existing Core Location configuration. Apple's [background-location guidance](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background) permits this workout use, but does not guarantee servicing an arbitrary deadline while stationary, suspended or without updates. The timer is an execution mechanism, not evidence of continuous execution.
- Voice uses the existing AVSpeechSynthesizer/AVAudioSession playback path, explicitly uses the application's audio session and the existing audio background mode, with shared cancellation and interval priority over split speech. Apple's [speech synthesizer documentation](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer) describes the API; interrupted, locked, Bluetooth and silent/Focus behavior still requires actual tests.
- Phone vibration requests use the documented [kSystemSoundID_Vibrate](https://developer.apple.com/documentation/audiotoolbox/ksystemsoundid_vibrate) through [AudioServicesPlayAlertSound](https://developer.apple.com/documentation/audiotoolbox/audioservicesplayalertsound(_:)). Availability depends on device and settings. Missing vibration never rejects voice-enabled Start, live alert changes or a foreground voice test; an unavailable vibration-only request must be changed deliberately rather than silently becoming quiet. Completion callbacks acknowledge an API operation, not felt vibration. The Simulator is explicitly unavailable.
- Core Haptics and UIKit tap feedback are not used as evidence of locked delivery. Apple's [haptic preparation guidance](https://developer.apple.com/documentation/corehaptics/preparing-your-app-to-play-haptics) describes background/suspension stoppage.
- No silent-audio keepalive, dummy GPS, push dependency, background-task abuse or undocumented API is added. No local notifications/alarms are pre-scheduled, so pause or skip cannot leave a notification instructing the old action. [AlarmKit](https://developer.apple.com/videos/play/wwdc2025/230/) is not adopted: its newer OS/permission/system-alarm behavior is a separate product decision; minimum iOS remains 15.

The owner accepts voice-only guidance, and on 27 October 2026 removed the vibration option and the pre-Start acknowledgement checkbox to keep the screens simple. Start always asks the recorder for voice on, vibration off and interval auto-pause off; older saved alert choices are ignored. The Intervals sheet carries one short note that locked/stationary spoken delivery is an early version to check. There is no in-app voice test button (removed at the owner's request on 27 October 2026); the native `intervalTest` method remains but is unused.

| Mode | Logical progression / spoken guidance acceptance |
| --- | --- |
| Foreground outdoor | Voice implemented; physical delivery pending |
| Outdoor locked / another app | Spoken requests implemented; acceptance pending |
| Stationary time boundary / temporary GPS loss | Native clock path implemented; actual execution/delivery pending |
| Force quit / reboot | No continued-cue promise; recover paused, no stale replay |
| Indoor / treadmill | Not offered in first release |

## Verification and remaining release gates

Shared fictional JSON fixtures drive Python/browser/native expansion checks. Native Foundation tests cover exact boundaries, mixed overshoot allocation, gaps, controls and recovery. HTTP/SQL checks use separate fictional accounts on a disposable install. Review, full suites, upgrade, unsigned compilation, merge, hosted deployment, signed upload and device tests are separate recorded outcomes in the PR.

#303 and #305 remain physical spoken-guidance acceptance gates. Haptics are optional, may be deferred without delaying voice-only release and are not required to close the voice-first gate. Record optional vibration separately without advertising a pass that has not occurred. Record build/phone/iOS/settings, audio route, app/lock state, movement/GPS, target and logical boundary, attempted API event, and observed/heard/felt delivery separately. Proposed logical tolerance is 0.1 s; the proposed ordinary physical target is two seconds and is not yet demonstrated. Keep evidence free of real health records and private device identifiers. If a required mode cannot pass, obtain a scope/mechanism decision before advertising it.


### Spoken totals (#377)

In the interval builder or Track’s pre-Start Recording settings, choose **Say total time** and **Say average pace**.
Both start on and are remembered together for your account on this device. They are Track voice settings; editing
them does not change a saved preset. These are the owner-approved exceptions to the earlier “no alert switches” rule.

The instruction comes first, followed by moving time since Start and average pace for the whole workout. Manual
and automatic pauses do not count. Pace needs at least 0.1 mi or 150 m and a recent good GPS fix; without it you
still hear the time. Distance instructions and pace use your distance units. The completion prompt includes the
same enabled totals. Turning **Spoken updates** off silences all speech. Nearby mile/km splits give way to an
interval change so the prompts do not compete; other split announcements keep their wording.

A new iPhone build is required. Software/simulator checks do not establish that speech is audible with a real
phone locked: check a short outdoor run/walk, compare the spoken average with Track, and turn each extra off once.
Keep the #303/#305 background, offline, stationary, GPS-loss and interruption acceptance checks open until observed.
