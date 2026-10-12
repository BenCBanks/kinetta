# Third-party software included in Kinetta

| What | Where | License |
|---|---|---|
| [Leaflet](https://leafletjs.com) 1.9.4: maps | `app/static/vendor/leaflet.*` | BSD 2-Clause, © 2010-2023 Vladimir Agafonkin, © 2010-2011 CloudMade |
| [ZXing for JavaScript](https://github.com/zxing-js/library): barcode scanning | `app/static/vendor/zxing.min.js` | Apache License 2.0, © ZXing authors |
| [Capacitor](https://capacitorjs.com) 8 and `@capacitor/preferences`: the iPhone app's shell | `mobile/` (installed by npm) | MIT, © Ionic and contributors |
| [capacitor-health](https://github.com/mley/capacitor-health): Apple Health in the iPhone app | `mobile/` (installed by npm) | MIT, © 2024 Martin Ley |
| [Pillow](https://python-pillow.github.io) 11: re-saving photos (profile and activity photos) without their hidden details | installed by pip (`requirements.txt`) | MIT-CMU (HPND), © Jeffrey A. Clark and contributors, © Secret Labs AB, © Fredrik Lundh |
| [pywebpush](https://github.com/web-push-libs/pywebpush) 2.0 and [py-vapid](https://github.com/web-push-libs/vapid): phone notifications (Web Push) | installed by pip (`requirements.txt`) | MPL-2.0, © Mozilla and contributors |

Map tiles are loaded from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors).
Food data comes from [Open Food Facts](https://world.openfoodfacts.org) (ODbL) and [USDA FoodData Central](https://fdc.nal.usda.gov) (public domain).
The Kinetta wordmark is drawn from the [Sora](https://fonts.google.com/specimen/Sora) typeface (SIL Open Font License).

Demo route shapes in `dev/demo/routes.json` come from OpenStreetMap routing (© OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright)).
