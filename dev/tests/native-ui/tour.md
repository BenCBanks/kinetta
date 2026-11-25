# Native website tour previews

`python3 dev/tests/native-ui/run.py --app <unsigned App.app> --output <private folder> --tour`

The capture-only **Native tour previews** PR job builds an unsigned app, then records the 17 scenes in `tour.cjs` in light/dark on iPhone 16 (393×852 points; 1179×2556 PNG). `--tour-scene <name>` selects a smaller set. The artifact contains original frames, scene metrics, source revision and SHA-256 hashes. Nothing writes to the website or signs/releases the app.

The disposable bundle uses app-rendered screens and fictional Store responses. Unknown API requests, writes and provider endpoints fail closed; visit creation is an in-memory fixture response. The only external data is the published credential-free basemap. A fictional demo photo is copied into the disposable bundle. Each frame restores 9:41, four cellular bars and a full unplugged battery.

The proposed sport-profile scene uses `/people/alex` because Me's owner card is weekly-only. Completed lifting uses `/activity/3`; the Track route edits the session. Food review uses `/food/describe`. The Kit scene is a **fictional answer stand-in**, rendered by the current verdict/facts UI: a chart cannot be captured until the Kit chart renderer exists. No chart UI is fabricated here.

Review the native frames before a separate change replaces website illustrations. Browser smoke checks help validate fixture completeness; they are not native evidence or physical-device verification.
