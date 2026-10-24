# Kinetta administration

Open `/admin` in a browser at your Kinetta server's HTTPS address. Administration has its own layout and sign-in; it is not a tab in the phone app. Me retains only personal account settings. The old `/me/people` route explains that administration moved. Old app-session admin API paths are retired; integrations must use `/api/admin/...` with a separate portal session.

For the implementation scope and remaining release evidence, see [Admin launch preparation](admin-launch.md). The guide describes the code; the portal’s dated checks describe an operator’s evidence. Neither alone certifies a launch.

## Access and roles

The first account remains the administrator. Invitations create Members. No existing account is promoted by this update. The Accounts & roles page lists every role explicitly. Administrators can change roles after typing the target username; the last administrator cannot be demoted. Demotion revokes portal sessions immediately. Administrators cannot reset/remove other administrators through member-management controls; first make an explicit role change where appropriate.

Portal access requires the account password plus a time-based authenticator code. A server owner may turn the authenticator step off with `KINETTA_ADMIN_MFA=off`; the password alone then opens a 30-minute portal session, a persistent warning says “password only”, and each such sign-in is audited. That is weaker protection for a public admin page, so keep the setting on unless you have decided otherwise. On first sign-in, add the displayed setup key to an authenticator app, then enter its six-digit code. Save the ten single-use recovery codes privately; they are shown once. Ordinary app cookies and native tokens do not authorize portal requests. Portal sessions expire after 30 minutes, use HTTP-only SameSite Strict cookies and require a per-session request-forgery token on writes. Password changes and app logout revoke elevated access. Authenticator codes and recovery codes cannot be reused. Admin sign-in attempts are counted in the database across workers/restarts.

Keep the encryption key with the database recovery material, separately protected. The public Docker installation generates `/run/kinetta/admin_key` in its private secrets volume at first start. Existing custom deployments must configure `KINETTA_ADMIN_KEY` or `KINETTA_ADMIN_KEY_FILE` with a Fernet key (generate using `cryptography.fernet.Fernet.generate_key()` privately). Without a valid key, sign-in is unavailable; an app session is never used as a fallback. The key encrypts authenticator secrets and queued response bodies. Do not replace it without a recovery plan, and never paste it into GitHub or screenshots.

If every authenticator and recovery code is lost, an authorized server operator can run `python -m app.admin_recovery <admin-username>` interactively inside the app container. It asks for the exact username, removes that administrator's MFA enrollment and sessions, and records an audit event. The existing password is still required to re-enroll. It does not create or promote accounts. Losing the encryption key also makes pending encrypted messages unreadable; reconcile/cancel those messages before queuing replacements under a new key.

## Beta requests and response email

The Beta requests page shows website submissions, decisions, response history and account invitation acceptance. Search by name/email/device and filter by status. You can approve/invite, waitlist, decline, ask a question or write a personal reply. Preview the complete recipient/message and generated installation instructions before confirming delivery. Preparing a preview queues a durable message; it does not send email. Closing the preview leaves a queued response that can be sent from response history.

Configure a Resend account with a verified sending domain, authenticated DNS records, a restricted sending API key and a monitored reply-to mailbox. No new paid account is required to install Kinetta; delivery remains disabled until the operator configures it. The initial adapter uses Resend's HTTPS API and idempotency support, without another SDK dependency.

| Setting | Purpose |
| --- | --- |
| `KINETTA_RESEND_KEY` (or `_FILE`) | Private sending API key. Never expose to the browser. |
| `KINETTA_MAIL_FROM` | Verified sender email address. |
| `KINETTA_MAIL_REPLY_TO` | Real, monitored support mailbox for replies. |
| `KINETTA_MAIL_WEBHOOK_SECRET` (or `_FILE`) | Signing secret for provider delivery events. |
| `KINETTA_PUBLIC_URL` | Public HTTPS account URL used in invitations. |
| `KINETTA_TESTFLIGHT_URL` | Optional approved `https://testflight.apple.com/join/...` install link. |

Configure Resend to send signed `email.delivered`, `email.bounced` and `email.failed` events to `/api/admin/email-events`. The endpoint authenticates the original request bytes using the provider's Svix signature, timestamp and event ID; it does not accept portal cookies as authentication. Replayed events are ignored. Keep keys in environment files or mounted secrets outside git. Use a separate test provider/account for integration checks. No real message is sent by the automated suite.

States mean:

- **Queued:** the response is recorded, with no provider acceptance yet.
- **Failed:** an attempt did not receive a usable acceptance receipt. Retry the **same response** within 23 hours; the provider receives the same idempotency key and content, even after a lost acknowledgement.
- **Accepted:** the provider accepted the message; inbox delivery is unconfirmed.
- **Delivered:** the provider reports delivery to the recipient's mail server, not that the person read it or that it reached their inbox.
- **Bounced:** the provider reports delivery failure. This terminal status cannot be overwritten by an older delivery event.
- **Uncertain:** the automatic-safe retry window expired. Reconcile with the provider before preparing another response.
- **Cancelled:** the response was superseded or its invitation expired, was used or revoked.
- **Joined:** the invitation was accepted and a Member account exists. This is distinct from every email state.

There is no automatic retry loop. The portal operator explicitly confirms sends/retries. Requests are limited to 50 prepared responses per hour service-wide and one per applicant per minute; retries keep their identity and do not create another invitation. Creating a fresh approval revokes the previous unused invite and cancels outstanding unsent responses. Each account link is single-use and expires after seven days. If no TestFlight link is configured, the message explains that account access does not grant Apple installation access. Replies are handled in the monitored reply-to mailbox; this version does not import an inbox into the portal.

Delete request removes the applicant's queue entry and response history and revokes an unused invite, while retaining any account already created. Removing a joined member also removes their linked request/history. Keep operational retention and access procedures consistent with the privacy policy; the portal does not automate a fixed retention schedule.

## Launch checks and daily work

Overview links to open reports, failed imports in the past 24 hours, connection failures and unanswered beta requests. Counts describe stored records, not service health. Launch checks keeps automatic configuration separate from administrator evidence:

| Check | What the screen establishes |
| --- | --- |
| Authenticator, encryption key, signup cap/mode, email configuration | Current configuration only. A usable encryption key does not prove it can be recovered. |
| Email delivery and support mailbox | A dated operator attestation, fresh for 7 days. API acceptance is not delivery. |
| Backup and restore | Separate attestations: backup fresh for 1 day, isolated restore drill for 30 days. One does not pass the other. |
| Release/rollback and report triage | Dated evidence, fresh for 7 days. |
| Capacity/failure handling and installed iPhone/provider acceptance | Dated evidence, fresh for 30 days. |

Checks say **Verified**, **Needs attention** or **Not checked**. Old evidence needs attention; missing evidence never passes. Recording evidence requires an explicit checkbox and the time the check actually happened. The portal never runs a restore, sends a test email or accesses a real device when recording a check. Keep detailed proof, backup locations and secrets in the private operating record. The optional runtime `KINETTA_VERSION` is a reported release label; absent metadata says “Not supplied”, rather than guessing an image version. No aggregate green “launch ready” badge is generated.

Assign a daily report/support owner. Review failed connections and imports before asking someone to reconnect. Confirm the support mailbox is monitored, keep the planned signup cap, and collect the release evidence in [the launch guide](admin-launch.md) before recruiting more people.

## Accounts and safe recovery

Search name, username or email; combine role/status, test-account visibility, joined/active UTC dates and open-report/import/connection filters. Sort newest joined, last active or name. Loading, failed searches and Retry are explicit. An older response cannot replace a newer query.

Account support leads with status, confirmed email, connections, recent imports and signed-in devices. A new iPhone sign-in can supply app version/build; existing sessions and older clients may say “not supplied”. This is client-reported metadata, not remote device inspection. Connection timestamps are the last recorded sync, not a guarantee of complete imports. Stored-photo bytes include images and thumbnails, not total account storage; monthly AI requests are a count, not a price or allowance. Ordinary support never opens workouts, GPS routes, food, health measurements or conversations.

Use **Send password reset email** for a member with a confirmed address. It requests the existing single-use reset link. A successful receipt confirms the request, not inbox delivery. The confirmation names the account and requires its exact username. Sign out everywhere, suspend/restore, role changes and removal also require typed confirmation. Suspension retains data and hides shared content; restoration restores the previous sharing choices. The final administrator cannot be demoted. Restore suspended accounts and finish password recovery before promotion.

For a member without a confirmed email, the folded recovery section offers **Issue expiring password**. Verify the person through the private support process and share the fallback through a trusted channel. It expires after one hour, revokes old app/portal sessions and reset challenges, and grants only a password-change step lasting at most ten minutes. It cannot open the app or admin portal. The person must choose a different policy-compliant password, then sign in normally. No password-change challenge is saved as a native session. An expired fallback must be issued again. Confirmed-email accounts and administrators cannot use this fallback. The former unrestricted password-reset endpoint now refuses requests.

Prefer invitations when creating accounts so members choose their own password. The manual Create Member control still sets an **initial** password; it does not claim that credential has the fallback’s expiry/forced-change safeguards. Administrator authenticator recovery remains the separate offline process above.

These confirmed account writes keep durable retry receipts. Repeating the same request ID and unchanged confirmation returns the original receipt; it does not send another reset email, overwrite a completed recovery or repeat deletion. A changed draft gets a new ID. Review an expired confirmation again. A lost acknowledgement is not proof that nothing happened; retry the unchanged confirmation or inspect audit history before starting a different action. The UI keeps validation errors in the dialog and preserves drafts. Successful actions show the target and server confirmation time.

## Reported-item review

Open an unresolved report to review only its submitted target. Comment reports show that comment. Activity reports show its name, sport, date, audience and current attached photos; routes, health measurements and private notes are excluded. Profile reports show the current bio/photo and explicitly explain that older reports lack an original snapshot. Relevant report history is scoped to that account.

Choose a specific action: dismiss, remove this comment, hide this activity, remove one attached photo, remove profile photo, clear bio, or clear both profile fields. Type the account username. If the reviewed material changes, the confirmation is rejected until it is reviewed again. A removed/unavailable target can still be dismissed. Removing a photo does not remove the activity or silently clear a bio. Suspension remains a separate account-support action. The old generic close/remove route is retired.

Review access and decisions are audited without copying reported content. Review images require the open report, current version and separate admin session and are served without cache storage. A closed report cannot keep serving review images. This is a moderation exception, not a general private-account browser.

## Audit and data requests

Audit history names actions in plain language, identifies current account targets where available and supports text/action/result/period filters with older pages beyond 200 rows. Confirmed actions, rejected requests and uncertain server responses are distinct. A rejected request records only a fixed action category and safe target ID, never the submitted password, body or error text. Audit events can retain minimal identifiers after an account is removed; account names are not copied into action receipts. Existing event codes remain readable.

From account support, **Record data request** creates an export, deletion, correction or other request. This stores only linked-account/type/status/dates and the operator who records verification/completion. It does not import correspondence or identity documents, create an export, give administrators a private-data download, or send data automatically. Confirm identity through a signed-in conversation, the account’s confirmed email, or the private identity process before recording completion. A confirmed address alone does not authenticate an incoming message. Deliver any data only through the verified private process; members retain self-service export/delete.

A verified deletion request completes in the same transaction as account removal, which clears its account link. Other request completions require an explicit attestation that the work finished. Closed request metadata is removed after 90 days when the register is checked. Action retry receipts older than 90 days are removed during subsequent confirmed writes. These are activity-triggered cleanups, not a daily scheduler. Members’ own exports include only their own request types/status/dates, without operator notes or identities. New admin/auth tables have RLS and no SQL-reader or AI grants.

Invitations continues to create private manual links without claiming an email was sent. Beta email controls remain as described above. Back up the database and encryption key safely before upgrades. Apply migration 72 on an isolated fresh/restored test database and verify recovery and account isolation before the authorized release. Keep CI, merge, deployment and TestFlight installation distinct.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys), [signed webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests).


Sign-in history records successful web, native-app and separate portal sessions, rejected passwords or authenticator codes, rate limits and the portal authenticator challenge. It retains 90 days of metadata. Known accounts are identified by current account name and username; unknown attempted usernames are not retained. Passwords, tokens, IP addresses, user agents and request contents are never added to this history. Deleting an account cascades its identified events. The separate portal session and MFA rules apply to both new screens.

Usage shows aggregate accounts, successful sign-ins, workouts and food entries added, workout sources and import job outcomes over 7, 30 or 90 UTC days. Workouts are counted when added, including historic imports, rather than when exercised. Food entries are counted when added, rather than the day they describe. Counts reflect stored records and decrease on deletion. A completed import job may include failed individual files.

An active account is one that requested its signed-in profile (`/api/me`) that UTC day. This records one account/day rather than every request; it does not measure session duration, screen visits or background sync. Active-account and sign-in tracking begins at the migration and cannot reconstruct earlier history. Earlier active days display “Not tracked”. Account/day rows are retained for up to 365 days and do not contain food, chat, workout, location or health contents. The new tables have RLS enabled and no grants or policies for account SQL readers or AI tools.
