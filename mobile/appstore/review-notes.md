# App Review notes — fill and review before pasting

Server: `[REVIEW SERVER HTTPS URL]`
Username: `[DEDICATED FICTIONAL REVIEWER LOGIN]`
Password: `[SUPPLY PRIVATELY IN APP STORE CONNECT; NEVER COMMIT]`
Contact: `[OWNER’S REVIEW CONTACT]`
Submitted version/build: `[EXACT VERSION AND BUILD]`

This account contains fictional workouts, food, a recipe and a fictional friend. Its routes are deliberately synthetic and do not demonstrate real exercise or location accuracy. The reviewer does not need a real watch or personal Health history to inspect the populated app. Confirm the separate review server and its enabled services before providing this login.

- Sign in with the server and credentials above. The five tabs are Home, Progress, Track, Nutrition and Me. Home opens to Feed; use the Feed | Groups switch below the Home header to open Groups. [App guide](https://kinetta.app/guide).
- Apple Health: open Me → Settings → Connections → Apple Health in the iPhone app. Reading supported workout/health categories and writing logged nutrition are separate choices. The user grants permissions in Apple Health; no unrelated category is granted by turning on a Kinetta setting. The demo account already has fictional activity history. [Training and connections](https://kinetta.app/training).
- Track: choose a sport and Start to record a workout. Outdoor tracking asks for location; background location is used to continue that user-started recording while the screen is locked or another app is open. Pause, Finish and review before Save. Permission is not needed merely to browse the demo. [Workout recording](https://kinetta.app/training).
- Nutrition → Add food: search, barcode and manual entry are available without AI consent. Kit’s description/photo estimates are optional, require the person’s AI opt-in, and may require server access. Review the proposed food, portion, meal and day, then confirm before saving. [Food logging](https://kinetta.app/food).
- Kit: available only for18+ accounts with explicit opt-in and the server’s reviewed feature gate enabled. It sends relevant question/context/records to the configured provider; Apple Health and Garmin inclusion have separate consents. AI proposals require confirmation before changes. Confirm `[ENABLED KIT FEATURES AND PROVIDER]` for this exact review server. Do not claim that an unavailable feature is enabled. [Kit and privacy](https://kinetta.app/privacy).
- Activity/Friends: view the fictional friend’s shared activity, open a profile and inspect cheers/comments. Per-activity audiences are Only me, Friends and Everyone on this server. The route’s privacy trimming stays in effect for other people. Food, weights and private notes stay private. [Friends](https://kinetta.app/friends).
- Data controls: Me → Settings → Your data offers export and account deletion. Health/fitness records are used for tracking, summaries and explicitly enabled review features; they are not sold or used for advertising. [Privacy policy](https://kinetta.app/privacy).

## TestFlight “What to Test” draft

For a build that includes #724 and #725:

- Navigation: confirm the five tabs are Home, Progress, Track, Nutrition and Me. Home opens to Feed; switch to Groups from the Home header.
- Reactions: in Feed or Groups, check the compact emoji stack and total. Open it to inspect the people list and All/emoji filters; add or remove your reaction.
- Add food: advance to a later Nutrition sheet, then tap the back chevron to return one step. Check that your search text and scroll position remain; X should still close the flow.

- Community safety: activity/comment menus offer Report; profile menus offer Block. Submitted public text is filtered. The [Terms of Use](https://kinetta.app/terms), version 2026-11-01-v1, supply the EULA reference; the owner must enter the reviewed custom agreement in App Store Connect. Check the submitted build’s active agreement settings separately.

## Reviewer exposure decision — owner chooses before credentials are supplied

Recommended: **use a separate review server populated only with fictional accounts**. This gives the reviewer a full friend/feed experience without exposing testers’ Everyone-audience activities.

Other options are to accept exposure on a shared server, after considering that Everyone includes the reviewer, or temporarily suppress real Everyone-audience content for that account. The latter would require a separately reviewed visibility change; this issue does not implement it. Creating a fresh reviewer account does not by itself isolate the public feed. The script must not change other accounts or their activity audiences.
