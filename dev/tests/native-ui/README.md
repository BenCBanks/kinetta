# Native WebView layout evidence

This check runs a copy of the unsigned Debug Simulator app against fictional, on-device API stand-ins. It uses the real Capacitor runtime, WKWebView, CSS safe-area values and Simulator status bar. It never signs/uploads a tester build, connects to a real account, reads Health/GPS or operates a physical device.

`prepare.py` injects fixture files only into a disposable copy of the built `.app`; repository app assets and the original build’s UI are unchanged; the bounded measurement bridge is compiled only for Debug. `run.py` boots isolated Simulator devices, installs that copy, collects screenshots and reads bounded measurements through a Debug-only temporary-file bridge (absent from Release builds). The artifacts include the real Simulator status bar and label the stage/device/theme. Browser screenshots with fabricated insets are separate evidence.

This proves native layout under the selected Simulator runtime. It does not replace physical iPhone/Safari/VoiceOver, camera or locked-screen interval acceptance.

Execution uses a separate Apple Silicon `macos-26` job, consuming the unsigned universal Simulator artifact from the existing Intel compile/archive job. The layout job remains required before any tester release. An initial zero safe-area inset is not accepted: fictional measurements wait for a positive status-bar inset and stable layout. Runner boot failures are failures, never UI acceptance.

CI gives the compact phone and Pro phone separate fresh Apple Silicon runners, with `--device compact` / `--device pro`. Each runs all ten light/dark/editor/review/quick-action/larger-text cases, including food-composer placeholder fit at normal and enlarged text. Both jobs remain required. This avoids sequential Simulator resource/startup contention: the combined run passed all eight SE cases, then failed to boot the Pro. The SE evidence is valid for its covered cases; it is not a substitute for Pro acceptance.

A timed-out app-termination command cannot proceed to changing the installed fixture files. The runner permits one checked shutdown/boot of its own disposable device, restores appearance/status-bar overrides, and records that recovery in the artifacts. Repeated termination stalls or failed recovery stop the job. Missing metrics and layout assertions are never retried to obtain a pass; missing-metrics failures retain an additional screenshot/phase record. The lifecycle unit checks run in the original regression suite; actual native execution remains required.

The GPS review adds ten cases per phone: live, expanded-map and review in both themes, plus live/review with enlarged
text. Each phone now has twenty required captures. The live data comes only from the existing fictional demo route;
native GPS controls are explicitly blocked. The actual WebView still provides its layout/safe areas and renders
the current production map, chart, local-review storage and controls. Assertions include recording-control and Save
placement above the real tab bar. These captures prove layout, not real Core Location accuracy or camera selection.

The floating navigation checks use the actual capsule bounds rather than a fixed tab-height assumption. All five
labels and 44px targets must fit; recording controls, their captions and Save must remain above it. Recipe/food
threads and the expanded map must still hide it. Every fixture also requires a response from the real read-only
UIKit display-preference bridge. Browser checks separately cover opaque accessibility/unsupported-blur fallbacks;
physical iPhone settings changes and rendering performance remain device acceptance work.

Activity detail adds ten cases per phone: mapped, scrolled sticky header, sparse indoor and full-screen map in both themes, plus mapped detail with enlarged text. Each phone requires thirty captures. The mapped hero must start at the viewport edge, stay around 38% of the screen, and leave native-safe 44px return/edit/share actions and analysis tabs visible. Scrolling switches to the compact fixed header. Sparse detail must omit unavailable secondary values and empty social counts. API records and route geometry come from `dev/demo/activity_detail.cjs`; UIKit safe-area/status-bar/display measurements are real. Physical iPhone map gestures and sharing remain separate acceptance checks.

Friends adds eight cases per phone: empty, one request/one friend, and three requests/forty friends in both themes, plus the long list with enlarged text. Each phone now requires thirty-eight captures. The shared named Back header must clear the real top inset, search stays at least 16px, request/manage targets remain 44px, and suggestions/empty actions render without overflow. Fictional read-only API people come from `dev/demo/friends.cjs`; request/search actions run separately against guarded API accounts in the browser suite. Physical keyboard and VoiceOver acceptance remain separate.
