# Apple Watch GPS routes

Reviewed against Apple documentation on 15 October 2026. **Apple Watch outdoor workout routes can be imported as
maps through Apple Health.** A third-party source's Health workout does not guarantee that it included a route.
An indoor workout or a workout with only distance cannot produce a real GPS map.

## What Kinetta already does

The native permission request includes workouts and `HKSeriesType.workoutRoute()`. For each workout, the native
sync queries associated `HKWorkoutRoute` samples, reads all batches with `HKWorkoutRouteQuery`, and uploads timestamped
latitude/longitude/elevation through the authenticated `/api/health/workouts` endpoint. The foreground plugin also
requests `includeRoute: true`. The backend validates bounds/times and associates the route with the person's existing
activity. Replaying a workout can enrich missing GPS without duplicating it, and shared maps retain server-side
start/end trimming. Never request extra live location permission merely to read an already-stored Health route.

Foreground sync overlaps the last three days and offers historical refresh, so later Watch-to-iPhone route arrival
can be recovered. A background workout observer alone is not proof that a later route sample wakes the app; physical
acceptance must test late route arrival and reopening/Sync now. Do not promise immediate delivery or fabricate a map
when read access or coordinates are absent. Existing queue/native/API tests are synthetic, not a physical Watch test.

## Practical check on a test iPhone/Watch

1. Record an **Outdoor Walk, Run or Cycle** with GPS and check the workout has an actual map in Apple's Fitness app.
2. Allow the Watch to finish syncing to its paired iPhone. Keep both unlocked/nearby for diagnosis.
3. In Health → profile → Apps / Apps and Services → Kinetta, allow Workouts and Workout Routes. The OS wording varies.
   Kinetta's Manage Health access explains where the switches live; Apple does not reveal individual read grants to us.
4. In Kinetta → Me → Apple Health, use Sync now. For older workouts, use the historical import option covering that date.
5. Open the activity. With readable GPS the map leads the photo carousel. If it is absent, distinguish no route in Health,
   denied category, pending Watch sync, an older installed build, a failed import and a genuinely indoor/non-GPS workout.

For recording accuracy, Apple says Location Services and Motion Calibration & Distance should be enabled. That is a
recording-side check, not evidence Kinetta has permission or that old missing GPS can be reconstructed. Garmin Health
exports may omit routes even when Garmin itself displays a map; an original FIT/GPX/TCX or supported full source is then needed.

## Sources

- [Apple: Reading route data](https://developer.apple.com/documentation/healthkit/reading-route-data)
- [Apple: HKWorkoutRouteQuery](https://developer.apple.com/documentation/healthkit/hkworkoutroutequery)
- [Apple: HKWorkoutRoute](https://developer.apple.com/documentation/healthkit/hkworkoutroute)
- [Apple: Authorizing access to health data](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [Apple: Calibrate Apple Watch](https://support.apple.com/en-us/105048)

Connections now leads with Apple Health status and Connect/Manage in the iPhone app, then Upload files. intervals.icu and Health Auto Export remain under Advanced for power users. A watch is optional. Garmin Health sharing can be delayed and excludes GPS tracks; on your own Health-sourced outdoor workout without a route, Add the map explains Garmin Connect website → activity → settings gear → Export Original, then uploads the original ZIP/FIT through the existing importer. Matching sport/time/distance enriches the existing activity and keeps user edits; other recordings remain separate. No provider connection is required.

Official Garmin references (checked October 2026): [Apple Health sharing](https://support.garmin.com/en-US/?faq=lK5FPB9iPF5PXFkIpFlFPA) and [exporting original activity files](https://support.garmin.com/en-US/?faq=W1TvTPW8JZ6LfJSfK512Q8). Delivery timing depends on the source sync and iOS; Kinetta cannot make a recording appear in Health before the source sends it.
