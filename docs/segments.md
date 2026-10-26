# Segments and leaderboards

A segment is a fixed named course for Run, Walk, Hike or Ride. Create one from a map, a selected stretch of a planned route or your own activity. The final review shows the course, audience, similar segments and warnings, and requires acknowledgement that it cannot be edited. A segment can start **Only me** and later be published to **Everyone on this server**. Publishing is deliberate and one way. A copied link never grants access to a private segment.

The name, description, path, endpoints, direction, sport and competition settings freeze at creation, enforced by a database trigger. Correcting a typo, moving a finish or changing sport requires a new ID and independent results. Editing a source route changes neither the segment nor someone else's recording. A private segment can be deleted by its creator. A published one uses the report/moderation lifecycle below.

Boards are **on at release**. Each member's participation starts **off** in Settings → Sharing → Segment leaderboards. Joining includes eligible historical activities. Leaving removes that member's public times on the next read while retaining private times. Admins can pause every board at once without changing members' choices.

## Which times count

The server derives elapsed crossing times from GPS timestamps, never from a typed duration, edited workout summary or route plan. One best eligible whole-second time appears per member on the exact segment. Equal seconds share competition rank (1, 1, 3); hidden fractions never break ties. A neutral account order makes pagination stable and does not confer a better rank.

A public time additionally requires a confirmed, active account; an Everyone activity; a visible shared map including the whole pass outside the hidden start/end; no activity exclusion; an allowed source; and no hold/exclusion. Blocking works in both directions for result visibility. Visibility, participation, source rights and moderator decisions are checked again on every board read, so withdrawal does not wait for a cached board or worker. Removing the current best falls back to the next eligible time.

| Source | Public-board handling |
| --- | --- |
| Phone recording (`track`) | Eligible with the checks above |
| Member-uploaded original file (`file`) | Eligible with the checks above; uploader must have rights to use it |
| Apple Health (`healthkit`, `apple`) | Eligible only for records actually written, permitted and synced; summaries without timed GPS cannot produce a time |
| Garmin Connect API and every unlisted source | Private times only; no approval for public competition is inferred |

This is a conservative application allowlist, not a promise of ownership of every upstream file or approval of all future provider uses. No Strava API feed is integrated. Recheck official provider terms and update the allowlist before admitting another source. Following a route or syncing a workout never joins boards automatically.

Your private times show why an attempt does not count publicly, including participation, audience, map trimming, source restrictions and moderation. **Keep off leaderboards** excludes an individual activity. Reports and reporter identity never appear in public results.

## Matcher rules and limits

Matcher version 1 samples the segment path at five-metre intervals. Start and finish crossings are interpolated between timestamped fixes, within 25 metres of the endpoints; a recording beginning within ten metres can start on the line. Matching proceeds forward along nearby path sections, rather than jumping to a similar parallel road or a later switchback. The nominal corridor is 35 metres; an 80-metre outlier stops an attempt, and at most 5% of fixes may lie between those distances. Backtracking more than 60 metres stops it. Courses are 100 metres to 50 km long.

A gap over 30 seconds fails the pass. Sampling over 25 seconds or 60 metres apart (Run/Walk/Hike), or 150 metres apart (Ride), cannot establish the course. Pauses count in elapsed time. Repeated complete, non-overlapping passes can produce several private efforts. Phone/watch copies count once when crossings begin within 30 seconds and durations differ by at most three seconds or 5%; separate attempts outside that test remain separate.

Wrong-sport and known assisted, virtual, indoor or motor categories do not enter the unassisted board. Sport-specific jumps and unusually fast averages are **held for review**, not called cheating. Average thresholds in metres/second are Run 7.5 for courses at least 1 km and 10.5 for shorter ones; Walk 3.3, Hike 3.5, Ride 22. The underlying GPS jump limits are shared with activity filtering. These are conservative software rules covered by fictional fixtures; they have not been validated as universal outdoor accuracy thresholds.

An uploaded file can contain falsified coordinates, timestamps or sport labels. This implementation cannot independently prove that an unlabelled ride was unassisted. There is no new owner assistance declaration yet, and no guarantee against a forged upload. Physical outdoor evidence and the remaining #286 acceptance must be reviewed before treating competition integrity as complete.

New GPS activity geometry queues matching; new segments backfill existing activities in bounded batches. Retries are idempotent. Retired/removed courses are rechecked before matching, and board eligibility remains authoritative at read time. Failed jobs stop after five attempts for operator review.

## Moderator guide

Use the separate **Administration → Segments & times** portal. An ordinary app login, including an administrator's personal login, cannot open it. The existing portal authenticator and CSRF rules apply. The section contains open reports, appeals, the oldest 50 held times, queue counts, outcome totals, Retry failed jobs and Pause/Resume all boards.

1. Read the submitted reason and note. A report alone changes no result and cannot remove a rival. Members can have at most 20 open reports; repeats of the same open target are deduplicated.
2. Review a case's derived evidence: segment, day, sport/source/audience, elapsed time, sample count, average speed, matcher version and current hold/exclusion reason. No private GPS stream, heart rate, notes, meals or unrelated activity history is available. Direct effort lookup requires an open matching report/appeal or a held time on a published course. Ask the owner through support if additional private evidence is needed.
3. Choose **Hold**, **Exclude** or **Restore**, with a specific, short reason. Restore can clear a review hold or moderator exclusion; it cannot turn an automatically invalid or duplicate pass into a qualifying effort. A decision checks the reviewed revision and binds any report/appeal to that effort. An already handled or stale case needs a fresh review; it cannot overwrite a newer decision.
4. Dismiss a report with a reason when no action is warranted. An owner can appeal a held/excluded time once while an appeal is open. Keep current decision closes only the appeal. Restoring with that appeal selected closes it as restored. The private effort view shows the resulting eligibility reason; appeals never restore automatically.
5. Course actions require an open report, the current course status, a reason and typed segment ID. **Retire** stops new competition but preserves a non-sensitive historical course/board. An optional replacement must be a different active published segment. **Take down** permanently clears the published name, description, path and creator and removes its derived efforts; only its unavailable-ID tombstone remains. Workouts owned by other members survive. A replacement never inherits ranks or times.

Effort decisions, case closure, retirement and takedown write minimal administrator-only receipts containing actor, target, action, reason, reviewed effort revision when applicable and time. They do not store raw streams. Account deletion removes private personal records; deleting a creator takes down their public courses while preserving others' workouts. Reports and moderation reasons should contain only the evidence needed for the case, never copied health records or personal location descriptions. The present receipt retention follows the server's administrator audit policy; a separate timed retention control is not implemented.

## Recovery and remaining acceptance

Pause boards during an investigation. Check backlog and failed-job counts; repair the cause before Retry failed jobs. Retrying does not clear decisions or join anyone. Resume only after checking cases and current eligibility. A code-wide matcher change needs reviewed fixtures and a consistent rebuild plan before new criteria are exposed. Version-1 workers do not implement a generation-switching rebuild facility; do not increment the matcher version and claim a mixed-version rollout is safe.

Fresh/upgrade/API/SQL/browser evidence belongs with the PR. Browser checks and unsigned iPhone builds cannot prove actual WKWebView dragging, Safari/Files downloads or outdoor timestamp accuracy. The source/provider review in [routes.md](routes.md), physical-iPhone checks, truthful assistance classification and a generation-based rebuild remain explicit #275/#279/#286 release/acceptance gaps. Do not close the whole #272 parent merely because this implementation PR passes its automated checks.
