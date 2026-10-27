# Planned routes

Open **Progress → Routes → Planned**, or **Track → Add a planned route**. Planned routes are editable plans, separate from completed activities, Matched routes and fixed competitive segments. Saving a plan adds no workout, distance total or leaderboard result. Routes start private. [Deliberate route sharing](route-sharing.md) adds protected recipient previews, discovery and independent copies; an activity's audience never publishes a plan automatically.

Choose Run, Walk, Hike or Ride. Tap the map to add points, drag a point to move it, or tap/drag a line to insert one. **Points** in More offers labelled controls without dragging. Undo/Redo, Reverse, Back to start and Out and back operate on the plan. Reverse requests paths again because cycling access can differ by direction. Distance updates in miles or kilometres; unavailable connections retain the last line and require a deliberate straight-line choice. Straight lines do not promise a usable trail or crossing. Heights are approximate terrain measurements; missing heights stay unknown.

Save a name and optional description. Drafts autosave to the server with a device fallback. A conflicting edit offers the latest saved version or a separate copy. The library also supports Rename, Duplicate, Delete and GPX import/export. Import preserves separate tracks rather than drawing a bridge across a recording gap. A route can be copied from your own activity's selected continuous section. Export contains the route's name and shape, with description only when selected; no timestamps, account or device details. Check that the route itself is safe to share. The iPhone export uses a single-use link that expires after 60 seconds and opens Safari; a server restart can expire it sooner.

**Use in Track** completes an account/server-bound route-only download and reviews the selected version before Start. An active recording pins that snapshot independently of later edits. The dashed plan, actual trail and position remain distinct, with conservative along/remaining progress when known. No turn instructions or tile download are provided. See [route following](route-following.md) for offline use, revocation, recovery and private plan history. Signed physical-iPhone acceptance remains open (#279/#234).

## Map services and rights

Reviewed October 26, 2026 against the linked primary documentation. Data licenses and permission to use someone else's servers are separate.

| Function | Implementation | Operator choice and limits |
| --- | --- | --- |
| Basemap | Existing OpenStreetMap tiles | Preserve visible attribution; no bulk/offline tile download. [Tile policy](https://operations.osmfoundation.org/policies/tiles/). |
| Paths | Valhalla; FOSSGIS public demo by default | Walking costing for Run/Walk/Hike with different trail tolerance; bicycle costing for Ride. [Costing documentation](https://valhalla.github.io/valhalla/api/route/api-reference/). |
| Elevation | Valhalla `/height` | SRTM-derived heights on the default service; approximate, with gaps. [Height API](https://valhalla.github.io/valhalla/api/elevation/api-reference/). A custom operator must check and label its actual elevation data. |
| Place search | Nominatim public service by default | Explicit Search only, no autocomplete/background searches; proxy, identifying User-Agent and cache. Aggregate maximum one request/second. [Usage policy](https://operations.osmfoundation.org/policies/nominatim/). Do not submit confidential text. |

Valhalla was chosen over OSRM because the same service supports pedestrian/bicycle costing and heights. Kinetta implements its own editor; On The Go Map is an interaction reference, not an API or embedded product. No paid provider or new packaged dependency is introduced. The [Valhalla engine is MIT licensed](https://github.com/valhalla/valhalla/blob/master/COPYING); it runs separately. OpenStreetMap data is [ODbL](https://www.openstreetmap.org/copyright). Display its attribution and licence link, including when distributing derived data as required; a permissive engine licence does not remove data-licence obligations.

FOSSGIS provides a best-effort demo, with [fair-use limits](https://routing.openstreetmap.de/about.html). The [Valhalla README](https://github.com/valhalla/valhalla#demo-server) also asks end-user applications to notify the maintainers through GitHub Discussions and send an identifying `X-Client-Id`; Kinetta sends `kinetta.app`. **Before release against that demo, the operator must provide that notice or configure another permitted endpoint. No notice has been sent by this implementation.** Recheck terms when changing providers or growing the audience. Nominatim requires a deliberate operator decision to accept its application-wide restrictions; it is not a generic unrestricted geocoding backend.

Routing, heights and search go through Kinetta's server. Providers receive coordinates or search text/map area and the server's network address; they can log requests. They receive no member ID, phone address, activity timestamps, health readings or account history. Search is user initiated; routing runs as points change and elevation follows the drawn line. Browser basemap tile requests go directly to the existing tile provider. Keep user-facing disclosures and the privacy policy aligned with any provider changes.

## Configuration, capacity and costs

Set these on the **app container**; recreate the app after changing them:

| Variable | Default | `off` |
| --- | --- | --- |
| `KINETTA_ROUTING_URL` | `https://valhalla1.openstreetmap.de` | Straight-line planning only |
| `KINETTA_ELEVATION_URL` | Same as routing | No height estimate |
| `KINETTA_GEOCODER_URL` | `https://nominatim.openstreetmap.org` | Search unavailable |

Use compatible service base URLs. The bundled Compose file passes these three variables from `.env` into the app container. Other installations must explicitly pass the values into their container too. No provider key is required for the public defaults. Do not put credentials in committed configuration or provider URLs.

Routing and elevation share one serialized gate; search has another. Gates wait at least one second between completed requests, use an eight-second transport timeout and a bounded queue. Each member has an allowance of 90 cache misses per five minutes. Bounded process-memory caches reduce repeats and disappear at restart. This contract assumes **one app process**. Multiple workers/replicas or separate installations cannot share the in-memory gate: use an aggregate rate-limited proxy or a suitably provisioned/self-hosted service before scaling. Do not reduce the public-service gap below one second.

Public-demo requests have no per-call charge and no availability promise. Capacity planning example, not a provider quote: 100 people drawing one route with 20 uncached changes each is 2,000 routing calls, plus up to a similar number of height requests and any searches. At one call/second this is over an hour of serialized routing/height capacity, so simultaneous demand needs a different service. For self-hosting, price regional graph storage, graph rebuilds, RAM/CPU, bandwidth and operations with your host; no hosting purchase or monthly price is approved here. A commercial service needs a current quote covering route storage/export, competitive segment use and privacy, not just permission to display a map.

## Release checks

Browser screenshots with fictional data and stand-in path/height responses demonstrate the interface, not provider coverage or outdoor accuracy. Before release, review the provider notice/rights above and run the documented physical-iPhone checks: point/line dragging in WKWebView, GPX arriving in Files through Safari, recording against the saved version, offline overlay/recovery, background/locked-screen recording and account cleanup. Sharing's universal-link/system-share acceptance and #279 following acceptance remain distinct from its implemented server/browser behavior.
