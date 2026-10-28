# Native WebView layout evidence

This check runs a copy of the unsigned Debug Simulator app against fictional, on-device API stand-ins. It uses the real Capacitor runtime, WKWebView, CSS safe-area values and Simulator status bar. It never signs/uploads a tester build, connects to a real account, reads Health/GPS or operates a physical device.

`prepare.py` injects fixture files only into a disposable copy of the built `.app`; repository app assets and the original build’s UI are unchanged; the bounded measurement bridge is compiled only for Debug. `run.py` boots isolated Simulator devices, installs that copy, collects screenshots and reads bounded measurements through a Debug-only temporary-file bridge (absent from Release builds). The artifacts include the real Simulator status bar and label the stage/device/theme. Browser screenshots with fabricated insets are separate evidence.

This proves native layout under the selected Simulator runtime. It does not replace physical iPhone/Safari/VoiceOver, camera or locked-screen interval acceptance.

Execution uses a separate Apple Silicon `macos-26` job, consuming the unsigned universal Simulator artifact from the existing Intel compile/archive job. The layout job remains required before any tester release. An initial zero safe-area inset is not accepted: fictional measurements wait for a positive status-bar inset and stable layout. Runner boot failures are failures, never UI acceptance.
