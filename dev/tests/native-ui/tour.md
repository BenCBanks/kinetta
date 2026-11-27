# Native website tour previews

`python3 dev/tests/native-ui/run.py --app <unsigned App.app> --output <private folder> --tour`

The capture-only **Native tour previews** PR job builds an unsigned app, then records the 17 scenes in `tour.cjs` in light/dark on iPhone 16 (393×852 points; 1179×2556 PNG). `--tour-scene <name>` selects a smaller set. The artifact contains original frames, scene metrics, source revision and SHA-256 hashes. Nothing writes to the website or signs/releases the app.

The disposable bundle uses app-rendered screens and fictional Store responses. Unknown API requests, writes and provider endpoints fail closed; visit creation and resuming the one fictional saved chat are in-memory fixture responses. The only external data is the published credential-free basemap. A fictional demo photo is copied into the disposable bundle. Each frame restores 9:41, four cellular bars and a full unplugged battery.

The proposed sport-profile scene uses `/people/alex` because Me's owner card is weekly-only. Completed lifting uses `/activity/3`; the Track route edits the session. Food review uses `/food/describe`. The Kit scene resumes a fictional saved chat and uses the released paragraph contract plus the app’s real average-climb line card (three known weekly points). Readiness requires the joined line, not just a legacy verdict. Text and values are a **fictional layout stand-in**, not a provider result or model evaluation. No chart UI is fabricated here.

Refreshed on main `f1811e87`; existing main native lifecycle/navigation/Store assertions remain intact outside tour mode. Previous captures are historical; the new exact-head unsigned capture job must pass before these refreshed frames are accepted. No physical-device acceptance is claimed.

Review the native frames before a separate change replaces website illustrations. Browser smoke checks help validate fixture completeness; they are not native evidence or physical-device verification.
