# Map backgrounds

Kinetta uses one operator setting for activity maps, feed previews, recording, segments, personal heatmaps,
moderation maps and activity share pictures. The route and recording work independently of the background.
Missing tiles retain a plain background; **Map unavailable** with Retry appears when at least half the requested tiles fail. Tiles that loaded stay visible, and panning can load other tiles without Retry.
A picture can still be shared without it.
Map data, permission to use a service and the renderer's software licence are separate matters.

## Choose a source

| Source | Settings | Light and dark |
| --- | --- | --- |
| One operator-hosted Protomaps v4-compatible PMTiles archive | `KINETTA_MAP_KIND=pmtiles`, HTTPS archive URL | Real built-in light/dark vector styles |
| Protomaps-compatible vector Z/X/Y endpoint | `KINETTA_MAP_KIND=vector`, HTTPS template ending in `/{z}/{x}/{y}.mvt` | Same styles |
| Permitted raster service | `KINETTA_MAP_KIND=raster`, HTTPS PNG/WebP template | Supply a separate dark template for a genuine dark map |
| No background | `KINETTA_MAP_TILES=off` | Route, position and recording controls remain available |

The renderer is vendored Protomaps Leaflet 5.0.0, which also draws the vector background into exported pictures.
Upstream is [in maintenance mode](https://docs.protomaps.com/basemaps/leaflet); it is suitable for this existing
Leaflet application and avoids replacing every interactive map with MapLibre. Revisit that choice if measured
phone performance or upstream maintenance becomes a problem. No runtime CDN or external font service is used.

Empty settings retain OSMF's light raster tiles for personal installs. This default is **not a production-capacity
or App Store approval**. Check its [usage policy](https://operations.osmfoundation.org/policies/tiles/): correct
identification/referrer, attribution, caching and appropriate load are required; availability is best effort and
prefetch/bulk downloading is prohibited. The policy does not categorically ban every distributed app. A hosted or
widely distributed install should use a permitted operator-controlled or contracted source before release.
The personal default has no genuine dark tiles; it remains a light map in dark appearance, without CSS inversion. Routes use the darker action blue on a light-only raster background to retain contrast.
Configured vector maps switch light/dark live with system appearance and the app's theme hook, retaining the view.

## Settings

Pass settings to the app container and recreate it. The bundled Compose file passes them through from `.env`.

```dotenv
KINETTA_MAP_TILES=https://maps.example.test/basemap.pmtiles
KINETTA_MAP_KIND=pmtiles
KINETTA_MAP_DARK_TILES=
KINETTA_MAP_ATTRIBUTION=Fictional map service
KINETTA_MAP_ATTRIBUTION_URL=https://example.test/map-credits
KINETTA_MAP_MAX_ZOOM=19
```

`KINETTA_MAP_DARK_TILES` applies only to raster templates. Templates require `{z}`, `{x}` and `{y}`.
Attribution is plain text, up to 160 characters; its optional HTTPS credit link is separate. Linked OpenStreetMap
credit is always added. Archive kind is inferred from `.pmtiles` if kind is empty. Display zoom is 3–22 (default 19);
Protomaps' usual archive data levels are 0–15 and the renderer overzooms them.

URLs must be HTTPS with an explicit host and no credentials, secret query parameters or fragments. For a provider
requiring a private storage key, use a controlled tile endpoint; never expose that key through a public URL.
Invalid settings fail startup rather than silently contacting a different provider. `/api/map-config` is public,
non-secret and cacheable for five minutes. It contains only the source/style/credit contract. The startup CSP allows
only the configured tile hosts for tile/image requests; changing sources requires recreating the app. No added
`unsafe-inline`, `unsafe-eval` or worker permission is needed.

All map tile fetches omit credentials, cookies and account headers, including on same-origin services. No account,
health readings, times or activity identifiers are included in tile requests. Coordinates are implicit in the tiles
requested. Start/end trimming protects the geometry other people receive; it does not conceal the viewed map area
or network address from a background-map provider. Publish the actual provider and operational log retention in
your installation's privacy policy.

## Coverage: USA first, UK if the incremental cost is modest

Owner direction, 28 October 2026. Measure both extracts before choosing storage. Do not assume a continental-US
rectangle covers Alaska and Hawaii. Use licensed country/region polygons that include the intended coverage, and
verify sample areas at several zoom levels. A combined USA/UK GeoJSON MultiPolygon can produce one archive for
this single-source configuration. Other areas remain a plain background when high-detail tiles are absent.

Install the official [PMTiles CLI](https://docs.protomaps.com/pmtiles/cli) and choose a versioned source from the
[Protomaps basemap builds](https://docs.protomaps.com/basemaps/downloads). Do not hotlink the daily build as the app's
runtime source. Check its published integrity hash and data/style compatibility. With the chosen source URL in
`KINETTA_BASEMAP_SOURCE` and your reviewed region files:

```sh
pmtiles extract "$KINETTA_BASEMAP_SOURCE" usa.pmtiles --region=usa.geojson --maxzoom=15
pmtiles extract "$KINETTA_BASEMAP_SOURCE" usa-uk.pmtiles --region=usa-uk.geojson --maxzoom=15
pmtiles show usa.pmtiles
pmtiles show usa-uk.pmtiles
wc -c usa.pmtiles usa-uk.pmtiles
```

Keep a small tested version first. The planet build is approximately 120 GB; regional extract sizes must be measured,
not guessed from country area. Retain the upstream attribution/licence and comply with any database redistribution
obligations. OSM data's ODbL is independent of the BSD renderer licence.

## Host it

For a small self-hosted installation, serve the immutable `.pmtiles` file from your own HTTPS static file server.
It must support byte ranges (`206`, `Content-Range`, stable `ETag`) and CORS. No database or Kinetta session is needed.
Use a versioned object name with long-lived public immutable caching; keep the old version while clients expire.
Do not gzip the archive as an HTTP content encoding: it must retain byte offsets.

For object storage, use the documented [R2/Workers arrangement](https://docs.protomaps.com/deploy/cloudflare).
Upload with `rclone`/S3 tooling (large archives exceed the dashboard upload limit). Keep access credentials solely
in the operator's storage tooling/secret manager. The upstream Worker can expose Z/X/Y vector tiles from a private
R2 archive; point Kinetta's vector setting at that endpoint. Starting with upstream's actual Worker source, a minimal
Wrangler configuration is:

```toml
name = "kinetta-map-tiles"
main = "src/index.ts"
compatibility_date = "2026-10-28"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "example-map-archives"

[vars]
ALLOWED_ORIGINS = "https://app.example.test,capacitor://localhost"
```

This is a configuration example, not an automatic deployment. Pin/review the upstream Worker revision, add your
own hostname and actual app origins, and verify its cache behaviour. For an object `basemap.pmtiles`, the upstream
Worker's vector template is `https://maps.example.test/basemap/{z}/{x}/{y}.mvt`; use `KINETTA_MAP_KIND=vector`.
Direct-range PMTiles hosting uses the full `.pmtiles` URL instead. Test both transport variants independently if
both are offered.

CORS must allow the actual web origin and `capacitor://localhost`, GET/HEAD/OPTIONS and Range/If-Match headers;
expose ETag, Content-Range, Content-Length, Accept-Ranges and Cache-Control. Do not enable credentialed CORS.
Return the matched allowed origin and `Vary: Origin`, rather than a comma-separated Access-Control-Allow-Origin.
CORS is browser access control, not protection against people copying a public tile URL or generating bills.

Avoid per-request access logging. If operational logs are necessary, omit raw IP-and-tile pairs and use a short,
documented retention period (proposed maximum 24 hours for diagnostic logs). Check account-wide Cloudflare logging,
analytics and Logpush settings too; this PR cannot establish an operator's actual retention policy.

## Costs and limits

Reviewed against [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) on 28 October 2026. Recheck before
provisioning. These are calculations, not a quote or an approved spend.

- R2 Standard storage is $0.015/GB-month before allowances: an extra measured 2 GB is about $0.03/month, 10 GB $0.15.
  Thus adding UK coverage may cost little in storage; its real archive size and traffic still need measurement.
  As an upper comparison, the cited 120 GB planet is about $1.80/month before allowances. Coverage is unlikely to be
  the main beta cost under these assumptions; request/CPU use and any existing account plan still matter.
- R2 includes 10 GB-month, 10 million Class B reads and 1 million Class A operations monthly in its current free tier;
  those allowances may already be used by other services. Internet egress is free under the published R2 terms.
- Workers Free has daily/request/CPU limits; do not assume it is an unlimited production tier. A paid Standard plan
  starts at $5/month and includes 10 million requests/30 million CPU milliseconds. Overage and storage reads are separate.
- For illustration, 100 accounts × 20 map sessions/month × 20 tile/range requests/session is 40,000 requests/month;
  1,000 accounts is 400,000; 10,000 accounts is 4 million. Initial PMTiles directory reads, panning, image exports,
  feed previews and cache misses can change this substantially. A range read is not necessarily one visible tile.
- Suggested beta target: $0–10/month if the measured coverage/load fit allowances and caching. This is not a guarantee.
  Enable billing alerts, appropriate request/rate/CPU limits, cache-hit/error counters and an operator kill switch.
  Alerts are not a hard spending cap. Use `KINETTA_MAP_TILES=off` for a deliberate safe shutdown of backgrounds.

Compare USA-only with the combined extract: bytes stored, requests per representative visit/share, cache-hit ratio,
latency and provider bill estimate. Include archive updates, temporary duplicate objects and operational work. Do not
approve the UK addition or a paid subscription solely from the illustrative storage calculation above.

## Verify and release

1. On an isolated install, check `/api/map-config` and CSP. A custom source must produce no OSMF tile requests.
2. Inspect activity/feed/recording/summary/segment/personal-heatmap/moderation maps at 330/390 px in both themes.
   Credit must stay readable and clear of GPS/full-screen/Follow controls. Live theme changes preserve pan/zoom.
3. Generate a share picture; confirm the configured basemap, protected geometry and printed provider/OSM credit.
   Block tiles and repeat: route/controls still work, Retry is honest and the image still exports.
4. Check CORS and Range responses from both browser and Capacitor origins; inspect requests for absent cookies,
   authorization and account identifiers. Verify coverage in USA/UK locations before promising it.
5. On the next signed iPhone build, measure feed scrolling, panning/zooming and memory/battery during a 30-minute
   recording against the previous build on the same device. Browser/stand-in measurements do not close this check.
6. Separately record approved hosting/billing/coverage, actual log retention, merged revision, hosted configuration,
   deployment, TestFlight upload and physical acceptance. This implementation does not provision or switch hosting.

Saved-route planning/following and offline basemaps are outside current scope; future reconsideration is #328.
Map background configuration does not activate Valhalla, Nominatim, elevation, community aggregation or any new
source rights. Existing OSMF offline restrictions still apply to the personal default.
