# Recording activities

All activity creation lives in **Track**: outdoor GPS, indoor timers, lifting, manual entries and file imports.
Activity and Progress show history and results. Me shows personal summaries and settings.

Choose an activity at the top of Track. Outdoor options include runs, trail runs, road/mountain rides, walking,
hiking, open-water swimming, rowing, skiing and other outdoor activities. Indoor options use a timer; lifting opens
exercise, set, rep, weight and rest controls. The last selected activity is remembered on this device for the account.

Tap **Locate me** to preview your position, or **Start** to begin. The recorder shows distance, active time and average
pace or speed. **Map/Stats** changes the display. **Pause** reveals **Resume** and **Finish**; Finish opens the editable
review. **Save activity** stores a private activity, regardless of the account's default sharing choice. Recording
and saving stay in Track; View activity opens the finished result when you choose it. Activity tools includes past
activity entry, activity files, watch connections and Apple Health.

## iPhone background recording

The new native recorder uses Core Location independently of the web screen. Once a GPS activity is started with
location permission, it is designed to keep receiving points while you switch apps or lock the screen. A visible
system location indicator shows the background use. Permission is requested at Start, not when opening a summary.
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

## Verification and release

Foundation Swift state/journal tests and browser-native stand-ins exercise recovery, gaps, account changes and
save acknowledgements. They do not establish physical GPS accuracy or Apple's runtime behavior. Before release,
build with the Apple SDK and verify on an iPhone: first permission/denial, precise/reduced accuracy, screen lock,
app switching, pause/resume, network loss, storage failure, logout/account switch and interrupted recovery. Compare
the exported route and elapsed/distance totals with the actual trip; check battery usage and accessibility too.
Sensors, audio splits, auto-pause, navigation/Beacon, Live Activities and opt-in Health write-back are separate work.
