# Admin launch preparation

The [24 October review](https://github.com/BenCBanks/kinetta/pull/256) researched the operator journey and fixed `people.map is not a function`. This follow-up implements the four launch priorities and supporting support/accessibility work. Implementation and automated evidence do not mean the public service has passed every launch gate or that a release has been deployed.

## Implemented operator journey

| Step | Result |
| --- | --- |
| Enter | Separate password/authenticator session and CSRF remain. Password-only mode has a persistent warning. Offline authenticator recovery stays separate. |
| Read Overview | Numeric attention cards open their related queues. Long status phrases stay at normal text size. |
| Check launch evidence | Configuration and dated operator attestations are separate. Missing, stale and failing evidence cannot silently pass. Backup and restore are different checks. |
| Find someone | Search, role/status/test-account filters and pagination remain; joined/active UTC dates, support-issue filters, sorting, Retry and stale-response guards are added. |
| Diagnose support | Connections/imports and device/version information lead; counts/history are folded. No ordinary private-content browser. |
| Recover access | Confirmed accounts use reset links. The fallback for an unconfirmed-email member expires in an hour and forces a different password before app access. |
| Act safely | Typed account confirmation, inline errors, durable replay receipts and visible results cover recovery, sign-out, suspend/restore, role and removal. |
| Moderate | Open-report-scoped comment/profile/activity/photo review; version checks; specific actions and audits. Changed material requires another review. |
| Investigate | Readable audit filters and older pages; rejected and uncertain outcomes distinct from confirmed actions. The earlier paginated sign-in-history fix remains covered. |
| Handle data requests | Minimal request/verification/completion register. No admin export download or automatic private-data delivery. Verified deletion completes atomically with removal. |

Phone controls, table labels, sans headings, focus restoration and sticky dialog/section controls follow the approved Sky Blue design. Keyboard interaction and browser screenshots are useful evidence; VoiceOver and a physical iPhone still require separate acceptance. See [the operator guide](admin-portal.md) for exact limits, retention and recovery instructions.

## Why these choices

Lead with the operator’s task: find the account, understand the status, perform the smallest appropriate action and verify the result. Keep private routes, meals, measurements and conversations outside support. A report permits a narrow review of its submitted target, not the rest of the account.

A configured sender is different from a delivered message; an existing backup is different from a successful restore; an API acknowledgement is different from a release or installed build. The readiness page records those distinctions explicitly. This applies the practical launch concerns in [Google SRE’s launch checklist](https://sre.google/sre-book/launch-checklist/) without introducing paid monitoring or an operational control plane.

Errors stay beside the form that caused them, with preserved drafts and clear outcomes, following [W3C form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/). Searchable minimum-content audit records follow [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html); passwords, tokens, report text and health records are excluded. Tables keep headings and accessible names as described by [W3C table guidance](https://www.w3.org/WAI/tutorials/tables/caption-summary/).

## Evidence required before expanding launch

| Gate | Required evidence and remaining operator work |
| --- | --- |
| Candidate software | Passing syntax, fictional fresh-install/API and schema-upgrade suites; production-function UI regressions; phone light/dark and desktop walkthrough. Record the exact candidate commit and CI separately. |
| Authorization/recovery | Member, CSRF, expired/revoked access, last-admin, recovery-only challenge, concurrent retries and request-owner isolation tests. Prove owner MFA/recovery with the real deployment’s protected key separately. |
| Email/support | Real confirmation/reset delivery, signed provider events and a monitored reply-to mailbox. Automated tests use stand-ins; provider acceptance alone is insufficient. |
| Moderation | Named daily triage owner and support contact; report → review → precise action → audit. Decide any content/reserved-name policy separately. |
| Backup/recovery | Recent actual backup and an independently dated isolated restore drill including encryption-key recovery. A schema-upgrade test does not replace a production-backup restore. |
| Operations | Planned cap, measured capacity/latency, failure/retry checks, sanitized monitoring and stop conditions. Do not silently increase signup limits. |
| iPhone/providers | Installed signed build, account recovery/switching, Health, Garmin and notifications on real devices. Simulator compilation and browser stand-ins do not establish these. |
| Release | Reviewed PR, passing required CI, authorized merge/deploy, observed result, rollback reference and a separately tracked TestFlight build. |

Launch checks does not perform these outside actions or claim that an operator has done them. Record dates and privately held evidence only after the check actually happened. Pause expansion if sign-in/recovery, isolation, moderation or recovery evidence fails; document any explicitly accepted limitation.

## Deliberately deferred

A Support role, server-backed searchable sign-in account picker, signup-to-returning-user funnel, bulk beta sending, assisted verified-email changes, moderation warnings/reserved-name policy, saved filters and paid operational automation need separate requirements and permission design. Administrator and Member remain the only roles. The complete sign-in dropdown is bounded by the current capped launch; replace it with server search when account volume requires it.

No new paid service, analytics SDK or production infrastructure is introduced. Migration 72 adds private admin/auth metadata with RLS and no SQL-reader/AI grants. Privacy copy describes client-reported app versions, narrowly scoped moderation, request metadata and activity-triggered cleanup. Real correspondence, keys, raw device evidence and test output stay out of public source.
