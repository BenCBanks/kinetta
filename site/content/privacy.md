# Privacy policy website copy

Edit the text below each section key and regenerate with dev/design/build_content.py.

## title

Privacy policy

## updated

Last updated October 18, 2026

## intro

This policy explains how Kinetta collects, uses, shares and retains personal information, and the choices available to you.

## scope-heading

About this policy

## scope

This policy covers the Kinetta hosted beta at login.kinetta.app and the website at kinetta.app, operated by Ben Banks in North Carolina, United States. If you use a Kinetta installation operated by somebody else, ask that operator for their privacy information.

## collect-heading

Information we collect

## collect

We store the account details you provide, including your username, display name, password hash, optional photo and biography.

## collect-food

Food conversation text and links to logged foods are private account records. They are included in your download and removed with your account. Logged AI estimates may become reusable private foods with their source and assumptions marked. You can edit or remove saved foods in My foods.

## collect-processing

Reuse mappings store a hash of the food words rather than another copy of your conversation. Processing metadata and cancellation identifiers prevent duplicate or cancelled uploads. Deleting a message removes its text and processing job; already logged and saved foods remain until you remove them. No food-photo thumbnails or full photos are kept in server thread history. Pending food messages and selected photos may be kept in the app’s private storage on your device so an interrupted upload can resume. Pending photos are removed from that outbox after processing or cancellation; clearing the app’s local data also removes unsent messages. Saved conversation copies and drafts on the device are bound to the selected server and account.

## collect-imports

When you explicitly read a recipe link, we keep only its parsed recipe draft, source URL, matched own-food references and processing identifiers, not the web page. Discard immediately clears the source URL and parsed content. Drafts and minimal rate-limit records are removed after their UTC day ends, within the next cleanup pass (normally five minutes); an expired draft also loses its URL and content. A saved recipe is independent of its temporary draft. Parsed drafts are included in your data download. Reading a link does not save a recipe or log food. A recipe text draft and its server identity may be cached privately on your device under your selected server and account; account deletion clears that local draft. Recipe screenshots use the existing optional food AI service only after image review. No screenshot is kept in a server recipe draft; a private input hash binds retries. Parsed estimate values, portions and AI source labels may be kept in the draft and saved recipe. An optional ingredient estimate sends only the unresolved ingredient you explicitly choose, rather than the web page or known foods.

We also store workouts and original activity files, GPS routes, recorded measurements, food entries, recipes, weight entries, goals, plans and settings that you add or import. Optional body details help calculate personal estimates. Beta requests include your name, email, device information and message.


## use-heading

How we use information

## use

We use this information to provide your account, record and display your activities and food, calculate summaries, operate features you choose, respond to requests and maintain the service. Technical records such as IP addresses, browser or device information, login sessions and errors help protect accounts and troubleshoot failures. We do not sell personal information or use health information for advertising.

## health-heading

Apple Health and location

## health

The iPhone app reads only the Apple Health categories you allow and sends the available records to your Kinetta account. It does not write to Apple Health. You can change access in the Health app’s settings. The recording source determines which measurements and routes are available. Kinetta receives location as part of recorded or imported activities; it does not continuously track your location. Permission to read Health records is separate from permission to use them for optional AI reviews.

## sharing-heading

Sharing with other members

## sharing

Activities start private. You may share an activity with approved friends or with everyone who has an account on the same Kinetta service. You choose which supported measurements are included. Shared maps remove the route’s start and end, but the remaining route, date and time may still identify places or routines. Photos are visible to the activity’s audience; we remove embedded photo metadata when processing uploads.

## identity-heading

Profiles and shared content

## identity

Other members may find your name and username through people search and see your public profile and permitted activity summaries. People who can see an activity can also see its cheers and comments. Your food log, weight, body settings and private notes are not shared with other members. Recipes you deliberately share, including recipe feedback shown with them, are visible to the approved recipients; sharing a recipe does not share your food log.

## providers-heading

Service providers and connections

## providers

When you explicitly import a public recipe link, the recipe website receives a server-side page request and the URL you supplied. Kinetta sends no account identity, cookies or login credentials to that website. The page is not sent to an AI service.

Cloudflare processes network traffic to the hosted app. OpenStreetMap receives map-area requests from your device. USDA FoodData Central and Open Food Facts receive food-search words, product words or scanned barcodes, rather than your Kinetta account identity. Services you connect, such as intervals.icu or Health Auto Export, exchange information needed for the connection under their own policies. Disconnecting a source stops future imports through that connection; records already imported remain until you delete them.

## ai-heading

Optional AI features

## ai

If you enable an AI feature, the configured provider receives the information needed for that feature: selected food text or photos for estimates; workout measurements and relevant training history for training notes; food summaries and weight trends for nutrition reviews; or ingredients for recipe feedback. Kinetta supports Google’s Gemini and Anthropic’s Claude; the app identifies the configured provider. AI use is optional, and Apple Health workouts require your separate agreement before inclusion. You can change these choices in Me. Previously generated results remain stored until the associated records or account are deleted.

## provider-retention-heading

AI provider handling

## provider-retention

Food photos submitted for estimates are processed and are not kept by Kinetta as saved photos. The selected AI provider may retain requests and responses under its own terms. Data use and retention differ by provider, service tier and region; enabling an app setting does not change those terms. Review the [Gemini terms](https://ai.google.dev/gemini-api/terms) or [Anthropic commercial privacy information](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) as applicable. Do not include information you do not want processed by the provider.

## notifications-heading

Notifications and administrative access

## notifications

If you enable iPhone alerts, Apple Push Notification service processes the app’s device token and notification text. New-workout alerts are sent only to the workout owner; other supported alerts follow your notification choices. Browser push is not supported. Administrators use account details, beta requests, response history and submitted moderation reports to operate the service. The service operator can technically access its database; access is limited to service operation, support, security and legal obligations.

## email-heading

Beta requests and email

## email

We use the contact information in a beta request to review eligibility, respond and provide invitations or installation instructions. When response email is configured, the email provider processes the recipient address and message, which may include a private account-invitation link. Replies go to the designated support mailbox. Request status, delivery outcomes and administrative actions may be recorded. We do not treat an email-provider receipt as proof that a person received or read a message.

## retention-heading

Storage and retention

## retention

The hosted beta stores account records in the United States until you remove them or delete your account. Beta requests and related response history are kept for administration until removed; requests linked to a joined account are removed when that account is deleted. Operational logs rotate using size limits, rather than a guaranteed number of days.

## retention-ai

AI usage records contain model names, token counts and estimated costs, without food text or photos. Account deletion removes their account and message references; usage and cost records may remain to enforce service budgets and keep operational totals. Service providers apply their own retention terms.

## backups-heading

Backups

## backups

The hosted beta keeps the newest 14 scheduled local database backup files. These local copies are not separately encrypted. Additional copies made before updates may be retained longer; encrypted off-site backups are not currently active. Deleted information may remain in a backup until that copy is removed. Deleting live records does not immediately erase older backups.

## choices-heading

Your choices

## choices

Use Me to change personal details, AI choices, notification preferences and connected sources. You can edit or remove your activities, food entries and weigh-ins. Me → Your data lets you download your records and original activity files, or delete your account after confirming your password. Account deletion removes live account records and uploaded files and revokes account access. Backup copies follow the retention described above. Email [feedback@kinetta.app](mailto:feedback@kinetta.app) if you cannot access your account or need help with a privacy request.

## security-heading

Security

## security

We use encrypted connections, password hashing, account-based access controls and restrictions on administrative access. No service can guarantee complete security. If an incident affects personal information, we will assess it and provide notices required by applicable law. Kinetta is a fitness and food tracker; its measurements, estimates and reviews are not medical advice.

## age-heading

Age requirements

## age

Kinetta is not intended for children under 16, and we do not knowingly collect their information. Optional third-party services may impose additional eligibility restrictions. Email [feedback@kinetta.app](mailto:feedback@kinetta.app) if you believe a child has provided information that should be removed.

## contact-heading

Contact and changes

## contact

Send privacy questions and requests to [feedback@kinetta.app](mailto:feedback@kinetta.app). Please don't include passwords; we will never ask for one. Do not put personal records, passwords or private requests in public GitHub issues. We update the date on this page when this policy changes and will notify affected users of material changes as appropriate.

## training-training-food-food-friends-friends-compare-co-55

[Training](training) · [Food](food) · [Friends](friends) · [Compare](compare) · [Feature guide](guide) · [Privacy policy](privacy) · [Contact](mailto:feedback@kinetta.app) · [GitHub](https://github.com/BenCBanks/kinetta)

## free-for-personal-use-under-the-polyform-noncommercial-56

Free for personal use under the [PolyForm Noncommercial License](https://github.com/BenCBanks/kinetta/blob/main/LICENSE); commercial licenses on request.

## 2026-ben-banks-name-and-logo-not-covered-by-the-licens-57

© 2026 Ben Banks. Name and logo not covered by the license. Demo data in screenshots.
