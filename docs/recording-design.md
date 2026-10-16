# Track recording design

This revision follows the owner's issue #108 feedback: every recording tool belongs in Track, and personal/public
profiles show one fixed fourteen-day distance chart. Activity keeps the original Friends feed / My activities switch,
feed cards, ordering, search, sport filters, cheers, comments and pagination. Recording controls move to Track;
the feed itself is not redesigned. It supersedes the earlier daily/weekly filter and foreground-only
native prototype. Kinetta keeps its Evergreen Agenda colors, typography, privacy and navigation.

Strava's [official recording guide](https://support.strava.com/en-us/articles/15402137-how-do-i-record-an-activity-on-strava)
describes a dedicated recording destination, last-used sport selection, map/stat displays, a prominent start action,
then pausing and finishing into a separate save review. Kinetta adopts those interaction patterns. It labels its
current pace/speed as averages rather than claiming Strava's split pace or instantaneous cycling speed. It does not
present Beacon, sensors, auto-pause or navigation controls until those features exist.

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
