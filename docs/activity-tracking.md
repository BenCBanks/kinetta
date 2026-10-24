# Recording activities

All activity creation lives in **Track**: outdoor GPS, indoor timers, lifting and manual entries. File imports are available in the browser; the iPhone app omits them.
Activity and Progress show history and results. Me shows personal summaries; Settings & account opens account and app settings.

Choose an activity at the top of Track. Outdoor options include runs, trail runs, road/mountain rides, walking,
hiking, open-water swimming, rowing, skiing and other outdoor activities. Indoor options use a timer; lifting opens
exercise, set, rep, weight and rest controls. The last selected activity is remembered on this device for the account.

Choosing an outdoor activity shows where you are straight away (tap **Locate me** to re-centre), then **Start** begins. The recorder shows distance, active time and pace over the last 30 seconds (speed for rides and skiing), with average and last mile/km underneath. **Map/Stats** changes the display. **Pause** reveals **Resume** and **Finish**; Finish opens the editable
review. **Save activity** uses the audience shown in the review: your saved sharing choice unless you change it before saving. If that saved default changed elsewhere, you must review it again. Retrying an already-saved recording returns the same activity without changing its audience. Older app builds that send no audience information still save privately. Recording
and saving stay in Track; View activity opens the finished result when you choose it. The “More ways to add” list includes past
activity entry, watch connections and Apple Health, plus activity files in the browser.

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
further from the last counted point than the GPS's own error (at least 5 m). Small movements within that threshold add nothing; GPS can still drift farther than its reported error. The web recorder, the iPhone recorder and the server use the same rule, checked against the shared fictional
fixes in `dev/tests/fixtures/gps_filter.json`, so the number you watch while recording is the number that's saved.

**Phone and watch at the same time.** If you record on the phone while your watch also records (through Apple Health,
Garmin Connect or a file), Kinetta keeps one activity. The two count as the same workout when at least 80% of the longer
one overlaps the other, whatever sport each calls it and however far apart they started. If the phone saves first, the watch copy enriches it with available heart rate; an edited title and existing sharing choice stay. If the watch arrives first, saving the phone recording returns that activity, using the audience reviewed on the phone. An automatically generated title may be replaced by an incoming title. A short workout inside a
much longer one (a run during a long hike) stays separate, and two phone recordings are never merged with each other.

**While you record.** The big number is your pace (or, for rides and skiing, speed) over the last 30 seconds; your
average and the time of your last mile or km sit underneath. Two choices on the Track screen, remembered on this device for your account (auto-pause separately for each sport):
- **Say my time every mile/km** (on by default; miles or km follow your units): "2 miles. Time 18 minutes 40 seconds.
  Last mile 9 minutes 5 seconds." The iPhone app speaks even with the phone locked in a pocket, lowering your music
  while it talks; a browser speaks only while its page is open.
- **Auto-pause when I stop** (on for runs, walks and hikes; off for rides): after 15 seconds without moving the clock
  stops and the screen says Auto-paused; it starts again as soon as you move. Only the time beyond those 15 seconds is
  left out of your active time, so the clock never jumps backwards.

## Verification and release

Foundation Swift state/journal tests and browser-native stand-ins exercise recovery, gaps, account changes and
save acknowledgements. They do not establish physical GPS accuracy or Apple's runtime behavior. Before release,
build with the Apple SDK and verify on an iPhone: first permission/denial, precise/reduced accuracy, screen lock,
app switching, pause/resume, network loss, storage failure, logout/account switch and interrupted recovery. Compare
the exported route and elapsed/distance totals with the actual trip; check battery usage and accessibility too.
Spoken splits and auto-pause are implemented as described above, with locked-pocket audio and real-stop acceptance still pending. Navigation/Beacon and Lock Screen Live Activities remain separate work. Apple Health nutrition writing is a separate, optional connection setting; saved phone workouts are not written back to Health.
