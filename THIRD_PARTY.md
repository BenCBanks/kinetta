# Third-party software included in Kinetta

| What | Where | License |
|---|---|---|
| [Leaflet](https://leafletjs.com) 1.9.4: maps | `app/static/vendor/leaflet.*` | BSD 2-Clause, © 2010-2023 Vladimir Agafonkin, © 2010-2011 CloudMade |
| [ZXing for JavaScript](https://github.com/zxing-js/library): barcode scanning | `app/static/vendor/zxing.min.js` | Apache License 2.0, © ZXing authors |
| [Capacitor](https://capacitorjs.com) 8 and `@capacitor/preferences`: the iPhone app's shell | `mobile/` (installed by npm) | MIT, © Ionic and contributors |
| [@capacitor/keyboard](https://capacitorjs.com/docs/apis/keyboard) 8: hides the bar iOS puts above the keyboard | `mobile/` (installed by npm) | MIT, © Ionic and contributors |
| [capacitor-health](https://github.com/mley/capacitor-health): Apple Health in the iPhone app | `mobile/` (installed by npm) | MIT, © 2024 Martin Ley |
| [Pillow](https://python-pillow.github.io) 11: re-saving photos (profile and activity photos) without their hidden details | installed by pip (`requirements.txt`) | MIT-CMU (HPND), © Jeffrey A. Clark and contributors, © Secret Labs AB, © Fredrik Lundh |

Demo photos in `dev/demo/photos` (and the homepage screenshots showing them) are by James Willamor (CC BY-SA 3.0),
City Dweller 2 (CC BY-SA 4.0) and Andy Li (CC0 1.0, the meal photo), from Wikimedia Commons; see `dev/demo/README.md`.

Map tiles are loaded from [OpenStreetMap](https://www.openstreetmap.org/copyright) (© OpenStreetMap contributors).
Food data comes from [Open Food Facts](https://world.openfoodfacts.org) (ODbL) and [USDA FoodData Central](https://fdc.nal.usda.gov) (public domain).
The Kinetta wordmark is drawn from Source Serif 4 (SIL Open Font License; see the local font attribution below).

Demo route shapes in `dev/demo/routes.json` come from OpenStreetMap routing (© OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright)).

- Source Serif 4 by Adobe, locally hosted Latin subset; SIL Open Font License 1.1. License: `app/static/fonts/OFL.txt` and `site/assets/fonts/OFL.txt`. Font source: https://github.com/google/fonts/tree/main/ofl/sourceserif4 .

- Six Phosphor regular icons (house, heartbeat, chart-bar, fork-knife, user, sneaker), MIT. Source: https://github.com/phosphor-icons/core ; license: `app/static/vendor/phosphor-LICENSE`.

- [HTTPX](https://www.python-httpx.org/) and h2 (HTTP/2), BSD/MIT; [PyJWT](https://pyjwt.readthedocs.io/) (MIT) and cryptography (Apache-2.0/BSD): native Apple push delivery, installed through requirements.txt.
