# Kinetta administration

Open `/admin` in a browser at your Kinetta server's HTTPS address. Administration has its own layout and sign-in; it is not a tab in the phone app. Me retains only personal account settings. The old `/me/people` route explains that administration moved. Old app-session admin API paths are retired; integrations must use `/api/admin/...` with a separate portal session.

## Access and roles

The first account remains the administrator. Invitations create Members. No existing account is promoted by this update. The Accounts & roles page lists every role explicitly. Administrators can change roles after typing the target username; the last administrator cannot be demoted. Demotion revokes portal sessions immediately. Administrators cannot reset/remove other administrators through member-management controls; first make an explicit role change where appropriate.

Portal access requires the account password plus a time-based authenticator code. A server owner may turn the authenticator step off with `KINETTA_ADMIN_MFA=off`; the password alone then opens a 30-minute portal session, the portal header says “password only”, and each such sign-in is audited. That is weaker protection for a public admin page, so keep the setting on unless you have decided otherwise. On first sign-in, add the displayed setup key to an authenticator app, then enter its six-digit code. Save the ten single-use recovery codes privately; they are shown once. Ordinary app cookies and native tokens do not authorize portal requests. Portal sessions expire after 30 minutes, use HTTP-only SameSite Strict cookies and require a per-session request-forgery token on writes. Password changes and app logout revoke elevated access. Authenticator codes and recovery codes cannot be reused. Admin sign-in attempts are counted in the database across workers/restarts.

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

## Other operator controls

Invitations provides private manual account links and revocation, explicitly without claiming an email was sent. Accounts supports member creation, password reset and account removal. Reports supports resolving a report or taking down reported material. The overview includes aggregate counts and import/connection failures, not private workout, food or health records. Audit history records role, session and management actions without passwords, keys, message bodies or health records. Back up the database and encryption key safely before upgrades.

Before release, install the migration on a restored/test database, prove owner MFA/recovery and member exclusion, configure the real email identity and verified sender, and complete the signed-iPhone/browser acceptance checks. Keep credentials and physical-device evidence separate from the public PR.

References: [Resend send API](https://resend.com/docs/api-reference/emails/send-email), [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys), [signed webhooks](https://resend.com/docs/webhooks/verify-webhooks-requests).


Sign-in history records successful web, native-app and separate portal sessions, rejected passwords or authenticator codes, rate limits and the portal authenticator challenge. It retains 90 days of metadata. Known accounts are identified by current account name and username; unknown attempted usernames are not retained. Passwords, tokens, IP addresses, user agents and request contents are never added to this history. Deleting an account cascades its identified events. The separate portal session and MFA rules apply to both new screens.

Usage shows aggregate accounts, successful sign-ins, workouts and food entries added, workout sources and import job outcomes over 7, 30 or 90 UTC days. Workouts are counted when added, including historic imports, rather than when exercised. Food entries are counted when added, rather than the day they describe. Counts reflect stored records and decrease on deletion. A completed import job may include failed individual files.

An active account is one that requested its signed-in profile (`/api/me`) that UTC day. This records one account/day rather than every request; it does not measure session duration, screen visits or background sync. Active-account and sign-in tracking begins at the migration and cannot reconstruct earlier history. Earlier active days display “Not tracked”. Account/day rows are retained for up to 365 days and do not contain food, chat, workout, location or health contents. The new tables have RLS enabled and no grants or policies for account SQL readers or AI tools.
