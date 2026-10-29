# Track recording design

This revision follows the owner's issue #108 feedback: every recording tool belongs in Track, and personal/public
profiles show one fixed fourteen-day distance chart. The later profile-first Me and unified Activity feed (#353) supersede the original feed-switch proposal. Recording controls stay in Track; complete private history/search remain reachable from Me. This supersedes the earlier foreground-only native prototype and uses the current Sky Blue system, privacy and five-tab navigation.

Strava's [official recording guide](https://support.strava.com/en-us/articles/15402137-how-do-i-record-an-activity-on-strava)
describes a dedicated recording destination, last-used sport selection, map/stat displays, a prominent start action,
then pausing and finishing into a separate save review. Kinetta adopts those interaction patterns. It labels its
whole-activity pace/speed as averages, with separate automatic-mile/manual lap pace under the owner's October29 rule. Optional auto-pause and spoken splits remain independent of manual laps and interval Skip. Beacon, new sensors and saved-route navigation stay outside this task. The [current GPS review requirements](tracking-review.md) add durable laps, expanded maps, local photo/chart review and an atomic retry-safe save.

Apple's [background location property](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates)
and [background-location guide](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)
provide the implementation basis: start the location service in response to a foreground action, enable the location
background mode, keep the native location manager alive and show background-location use. WebView visibility cannot
own the recorder. Account-local durable state and interruption recovery remain necessary; force-quitting is not an
uninterrupted-recording promise.

The [iOS bridge](https://capacitorjs.com/docs/plugins/ios) uses the existing custom-plugin pattern without adding a
dependency. Files use Apple's [first-unlock protection](https://developer.apple.com/documentation/foundation/nsdata/writingoptions/completefileprotectionuntilfirstuserauthentication)
so locked-screen recording can write protected data. See [the recording guide](activity-tracking.md) for lifecycle,
privacy and device acceptance checks.
