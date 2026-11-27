# App Review notes — owner review required

Fill these fields privately in App Store Connect for the exact submission. Do not commit credentials.

- Review server: `[DEDICATED REVIEW SERVER HTTPS URL]`
- Username: `[DEDICATED FICTIONAL REVIEWER LOGIN]`
- Password: `[SUPPLY PRIVATELY IN APP STORE CONNECT]`
- Review contact: `[OWNER’S REVIEW CONTACT]`
- Submitted version/build: `[EXACT VERSION AND BUILD]`
- Kit features/provider enabled on this server: `[CONFIRM FOR THIS REVIEW BUILD]`
- Existing release documentation records aggregate feature metrics enabled for all hosted accounts; confirm the exact reviewer/submission configuration. The app records feature use and food-entry method linked to the account for aggregate service-improvement counts; the metrics do not contain food details. Totals from fewer than three people are hidden from administrators. For submission, confirm that App Store privacy answers classify Product Interaction as Analytics and linked to the user; Health and Fitness also include Analytics.

The review account should contain fictional activity and food examples on a server chosen for App Review. Do not use a shared server unless its owner accepts that the reviewer can see activities shared with “Everyone.” A separate review server is recommended. Creating a reviewer account on a shared server does not hide other “Everyone” activities.

Source-reviewed against main `46bbe8c1` on 27 November 2026; this is not verification of the selected signed build or device behavior.

## Where to review the app

- Sign in with the server and credentials above. The five tabs are Home, Progress, Track, Nutrition and Me. Home opens to the activity feed; the Home header also leads to Groups and Challenges.
- Activity detail shows the shared activity, map and charts. Comments and reactions are available from its footer. The activity owner controls its audience; food details and protein targets are not exposed in challenge sharing.
- To inspect recording, open Track, choose a sport and tap Start. The current idle screen has the larger map and compact launch controls; Map/Stats changes the live view. Outdoor recording can request location. The native implementation requests background location for a recording started by the person. Lock-screen/app-switch continuity, GPS quality and interruption recovery require physical-iPhone acceptance on the submitted build; these notes do not claim that pass. Location permission is not needed to browse the sample account.
- In Nutrition, open Add food to search, scan a barcode or enter food manually. Kit’s estimate is optional, requires the account’s AI opt-in and an enabled server feature, and asks the person to review the food and portion before saving. The reviewer does not need Kit enabled to inspect ordinary food logging.
- Open Ask Kit from its entry in the app. Ask about the fictional workouts/food; charts appear inside the answer when supported. A chart's numeric values come from the app's recorded data, not model-drawn measurements. Saved chats reopen from Kit's history button when history is enabled; delete one through Chat options or choose Delete all chats in Chat history options. What Kit remembers is under Me → Settings and also accessible from Kit; add/edit/delete a detail or turn memory off. Turning it off forgets notes; deleting a chat does not remove those separate notes. Proposed activity-goal changes need preview and explicit confirmation. No real Health data is needed for these fictional examples.
- The bell opens Notifications, with Today/Earlier updates; notification preferences remain under Me → Settings → Notifications. Permission to receive iPhone push is optional and separate from viewing the inbox.
- Apple Health is optional: Me → Settings → Connections → Apple Health. Kinetta imports only workout categories the person permits; body-mass reading and writing confirmed nutrition to Health have separate controls. The fictional activity history can be reviewed without connecting a real Health account or watch.
- Friends, Groups and Challenges are optional. Groups is also reachable from Me and uses the same screens. Each group challenge exposes Share my total; the account-wide Share achievements setting also applies. Group workout totals exclude Only me activities, while standalone challenges can count them without exposing their details. Joining a challenge does not send a friend request; food details and protein targets are not included in shared challenge progress. Find friends with contacts is also optional; declining the Contacts prompt does not block other features.
- Import activity history in Connections currently opens a browser-import explanation on iPhone. Native ZIP Open in/Share, a native document picker and a guided/background import flow are not included in this source baseline and must not be demonstrated as shipped.
- User content has Report and Block controls. Activity and comment text is filtered at submission. Me → Settings → Your data contains export and account-deletion controls.

Kit is available only to eligible adult accounts with explicit AI consent and the reviewed server feature enabled. Confirm the exact server configuration above; do not claim a disabled feature is available. AI-generated food proposals require review and confirmation before saving.

## Owner review before pasting

Confirm the reviewer server, account, contact, exact build and enabled Kit features. Resolve the policy/privacy/device questions in [submission-readiness.md](submission-readiness.md) separately; no App Store answer is certified by this worksheet. Keep all credentials in App Store Connect only. Check the notes against the selected build and server; these notes do not authorize changing account visibility, creating a production account, or submitting the app.
