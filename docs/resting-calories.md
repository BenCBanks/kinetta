# Resting calories from Apple Health

Food targets remain independent of calories burned. A daily target or a target set for one date changes only when
you explicitly edit it. Imported workouts keep their existing calorie values.

In **Nutrition → More → Calorie needs → Resting calories**, choose **Apple Health · Resting Energy**. In an installed iPhone
build containing this feature, allow Kinetta to read Resting Energy and sync. Browsers can choose the source and view
synced data, but cannot read Apple Health directly. Closing Apple's permission screen does not establish read access;
if there are no readable totals, check Kinetta's switches in the Health app.

With Apple Health selected, burned calories are:

**that day's synced Resting Energy + the activity calories already in Kinetta**.

No all-day Active Energy total is imported or added. Kinetta's BMR/activity multiplier is not added in this mode.
Activities without recorded calories retain Kinetta's existing activity estimate, visibly marked as an estimate.
This tracks the requested passive-plus-workout total; it does not claim to reproduce Apple's entire all-day active
energy total, which can include movement outside recorded activities.

Today's resting total is the amount synced so far, not a full-day forecast. Later syncs may update prior days too.
A prior day last read while it was still in progress waits for a later sync before counting as a finished day. Missing days stay unknown; Kinetta does not silently use calculated BMR or zero. Those days are excluded from running
deficit totals until data arrives. Each row retains its observation and sync time. Old cached totals are labeled with
when they were read; the server cannot know whether Apple Health has newer unsynced data.

The iPhone reads daily totals for the current day and previous thirty days using the account's time zone. Source
selection belongs to the account; device consent belongs to that account/server. Sync runs when opening/returning to
the app (throttled), or explicitly using the sync control. This is separate from background workout delivery.
Switching time zones does not silently re-date stored totals. Sync again in the selected time zone. Repeated uploads
replace the same date's total without duplication; a delayed older read cannot overwrite a newer one.

**Remove synced resting calories** deletes this account's imported resting data and returns to the calculated source.
It preserves food targets, food logs and activities. Own-data exports include resting totals; account deletion removes
them. Public profiles and feeds never receive them. Kit needs the existing explicit Apple Health AI consent before
using balances derived from these totals.

The optional target calculator remains labeled as a Kinetta estimate and requires an explicit button press to set a
target; selecting an Apple Health burn source never applies its suggestions.

Implementation references: Apple's [Resting Energy type](https://developer.apple.com/documentation/healthkit/hkquantitytypeidentifier/basalenergyburned)
and [daily statistics guide](https://developer.apple.com/documentation/healthkit/executing-statistics-collection-queries).
Tests use fictional totals and stand-in Health callbacks. Apple SDK compilation and a physical iPhone comparison with
Health's Resting Energy totals, day boundaries/DST, permission changes and sync timing remain release acceptance.
