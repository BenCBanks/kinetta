# Small, friendly challenges

Open **Friends → Challenges → Start a challenge**. Choose a fixed template, then dates and a target.
The app generates the name. Creation includes you; other people choose Join on the invitation preview.
It never creates friendships. Invitations include a picture, a QR code and a link.

| Template | What counts |
| --- | --- |
| Distance | Distance from the selected run, walk, hike and ride sports, in km or miles |
| Active days | Local days with at least one completed activity lasting 10 minutes |
| Activities | Completed workouts lasting 10 minutes |
| Food logging days | Days with at least one food entry |
| Protein goal days | Days reaching the person's own current protein target; unknown protein does not qualify |

There are no calorie, weight-loss or food-streak challenges. Protein targets and food entries stay private.
Changing a personal protein target recalculates that person's goal days, without sharing the target.

Choose this/next week, this/next month, or a custom 3–62 day range. Starts are at most 30 days ahead.
A next-month start 31 days away is unavailable until it is within that limit. Defaults are 80 km/50 mi,
15 active days,4 activities for a week,20 food days or15 protein-goal days; day targets must fit the dates.
Each person can have five active/upcoming memberships; a group has at most 50 active participants.

Participants see usernames, profile photos already permitted by normal profile rules, and the challenge number.
They never receive another person's activity, map, time, meal, calories, grams, body details or protein target.
The table is sorted by progress without ranking positions. Its notes identify manual contributions and safe
Garmin attribution. Private activities can count because joining explicitly shares only this aggregate.

Activities belong to the participant's own local start day, including DST changes. A workout crossing midnight
counts after it completes. Earlier records inside the chosen period count even when they predate joining.
The API recalculates from current records on each read; the open page refreshes every 30 seconds. Edits and
deletions therefore update immediately in the API and normally within 30 seconds on screen. Naturally finished
challenges keep reflecting late imports, food entries and corrections throughout retention; results do not freeze.
Once all eligible participants have received their finish notice, the notification worker stops checking that
challenge. This does not stop live progress calculation.

Joining closes at the end of the creator's period in the time zone saved when it was created. Each participant's
counting period and finish picture use their own local dates. A creator can End early, which closes joining and
counts only workouts completed by that stop and food entries already recorded then. There is no automatic
friendship. Anyone can Leave; the row disappears immediately. A creator can Remove a person, who cannot rejoin
through the same link. New joins reject blocked pairs. Existing blocked members are hidden from each other's
tables and photos. Unconfirmed/suspended creators' links are inactive.

Signup, waitlist and invitation forms show a separate explicit join choice. It survives email confirmation;
closed signup and account caps still apply. An invitation's first email must be confirmed before its remembered
challenge choice is consumed. A background retry covers a lost confirmation acknowledgement. A new challenge
or card link clears stale friend-invitation context. After installing the iPhone app, reopen the original link.

**Me → Notifications** has three separate choices: someone joins your challenge, three days left, and a finish
picture. All start off. Each event is claimed once; opt-out and current membership are rechecked at delivery.
Notifications use usernames and generic challenge wording, never food or workout details. Physical delivery
still requires a signed-device acceptance check; automated tests use stand-ins.

Every participant can make a finish picture, including when the target was not reached. Photo and username
start off. Finished pages remain read-only except for leaving or removing participation. They reflect corrections
to the source records. Ninety days after an early end, or after the final possible local end of the period, the
challenge, membership rows and notifications are deleted; stale signup/waitlist codes are cleared too.
External pictures already saved cannot be recalled.

Migration 83 adds challenges/members, notification references and remembered waitlist choices. Both personal
tables have owner-only RLS. SQL readers can select only their own membership and allowed creator metadata;
invitation codes and replay payloads have no reader grant. Exports exclude codes. Account deletion cascades the
owner's groups and that person's memberships. Writes and the notification worker lock accounts before group
rows, matching account erasure. There is no AI call, new paid service or raw-data sharing permission.

See [#297](https://github.com/BenCBanks/kinetta/issues/297). Implementation, combined verification, merge,
hosted deployment, TestFlight and physical share/join/push acceptance are separate release steps.
