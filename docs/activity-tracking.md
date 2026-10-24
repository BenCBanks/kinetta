# Recording activities

All activity creation lives in **Track**: outdoor GPS, indoor timers, lifting, manual entries and file imports.
Activity and Progress show history and results. Me shows personal summaries and settings.

Choose an activity at the top of Track. Outdoor options include runs, trail runs, road/mountain rides, walking,
hiking, open-water swimming, rowing, skiing and other outdoor activities. Indoor options use a timer; lifting opens
exercise, set, rep, weight and rest controls. The last selected activity is remembered on this device for the account.

Choosing an outdoor activity shows where you are straight away (tap **Locate me** to re-centre), then **Start** begins. The recorder shows distance, active time and average
pace or speed. **Map/Stats** changes the display. **Pause** reveals **Resume** and **Finish**; Finish opens the editable
review. **Save activity** stores a private activity, regardless of the account's default sharing choice. Recording
and saving stay in Track; View activity opens the finished result when you choose it. The “More ways to add” list includes past
activity entry, activity files, watch connections and Apple Health.

## iPhone background recording

The new native recorder uses Core Location independently of the web screen. Once a GPS activity is started with
location permission, it is designed to keep receiving points while you switch apps or lock the screen. A visible
system location indicator shows the background use. iOS asks for location permission once, the first time Track shows your position or you start a GPS activity, and remembers the answer (unless you pick "Allow Once"). The preview position stays on the phone.
This needs an installed iPhone build containing the recorder. Browser/Home Screen recording remains foreground-only
and pauses when its page is hidden; it cannot provide the native background guarantee.

The native recorder keeps an account-specific atomic manifest and point journal, protected on disk and available
after the device's first unlock. Points are appended durably; the UI requests incremental snapshots. Signing out
pauses and disconnects the recorder before changing accounts. Another account cannot read, resume or save the draft.
A failed server save retains the draft, and retrying returns the same activity. Native data clears only after the
server acknowledges saving or after explicit discard confirmation.

Force-quitting, device shutdown, permission revocation or OS termination can interrupt location delivery. Reopening
recovers the durable points as a paused GPS session; it does not invent travel while the process was absent. Choose
Resume when ready. Timer-only sessions use elapsed timestamps without needing a background GPS service.

GPS is approximate. Old, weak and implausible fixes are rejected. Pauses and signal gaps form separate sections;
the distance never counts the straight-line jump. Your own activity detail renders all recorded sections, and the
original recording is included in your data export. Shared feed/profile map previews retain the existing trimmed
single-section geometry (longest continuous section); they never receive the raw private recording file. Corrected
motion summaries continue hiding original map/record data until restored.

**Distance and GPS wobble.** GPS positions wander by a few metres even when you stand still. Only fixes accurate to
about ±25 m count toward distance (less accurate ones still draw the map), and distance is added only once you've moved
further from the last counted point than the GPS's own error (at least 5 m). Standing at a crossing therefore adds
nothing. The web recorder, the iPhone recorder and the server use the same rule, checked against the shared fictional
fixes in `dev/tests/fixtures/gps_filter.json`, so the number you watch while recording is the number that's saved.

**Phone and watch at the same time.** If you record on the phone while your watch also records (through Apple Health,
Garmin Connect or a file), Kinetta keeps one activity. The two count as the same workout when at least 80% of the longer
one overlaps the other, whatever sport each calls it and however far apart they started. Whichever arrives second merges
into the first: your title, notes and sharing choice stay, and the watch's heart rate fills in. A short workout inside a
much longer one (a run during a long hike) stays separate, and two phone recordings are never merged with each other.

## Verification and release

Foundation Swift state/journal tests and browser-native stand-ins exercise recovery, gaps, account changes and
save acknowledgements. They do not establish physical GPS accuracy or Apple's runtime behavior. Before release,
build with the Apple SDK and verify on an iPhone: first permission/denial, precise/reduced accuracy, screen lock,
app switching, pause/resume, network loss, storage failure, logout/account switch and interrupted recovery. Compare
the exported route and elapsed/distance totals with the actual trip; check battery usage and accessibility too.
Sensors, audio splits, auto-pause, navigation/Beacon, Live Activities and opt-in Health write-back are separate work.
