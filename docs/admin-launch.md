# Admin portal: launch review and preparation

Reviewed 24 October 2026 against the current admin source and issue [#233](https://github.com/BenCBanks/kinetta/issues/233). This is a proposed order of work and acceptance checklist, not a declaration that launch gates have passed. The only application change in the accompanying PR is the Sign-in history fix.

## Scope and evidence

The operator's main task is to find someone, understand the account's status, take the smallest appropriate action and see whether it worked. Private workouts, routes, food, body measurements, photos and conversations stay outside ordinary support views. Reported material needs its own narrowly scoped moderation review.

The current portal was captured before edits using its real HTML/CSS/JavaScript, with fictional API responses at 390px in light/dark and 1200px desktop. All non-GET requests and outside service calls were blocked. The eight sections, a paginated account list, account-support dialog and reset-email confirmation were inspected. These captures establish rendered behavior and navigation; they do not establish real authentication, production settings, email delivery, sensor behavior or database protection. Screenshots are attached to the PR rather than committed to this public repository.

Source checks: `app/static/admin.js`, `admin.html`, `admin.css`, `app/api_admin.py`, `admin_auth.py`, `admin_usage.py`, `api_account.py`, `api_social.py`, and existing admin API tests. Account search and actions have substantially improved since #233 was written; the issue's original problem list is historical, not an accurate list of everything still missing.

## Current journey

| Step | Observed health | What matters next |
| --- | --- | --- |
| 1. Enter the portal | Separate password/authenticator flow exists in source; signed-in preview renders. Real sign-in not tested here. | Keep MFA, recovery codes, separate sessions and CSRF. Make password-only mode conspicuous on every section, not just Overview or folded session details. |
| 2. Read Overview | Account cap, signup mode, reports, failed imports and connection counts are visible. Phone layout fits, but long status text breaks into large fragments. | Lead with things needing attention and direct next actions. Separate numbers from short status labels. Configuration alone must not imply successful email delivery or backup recovery. |
| 3. Find an account | Name/username/email search, role/status filters, test-account switch and 50-row pages exist. | Preserve these. Add clear loading/error feedback and prevent an older search reply replacing newer results. Add date/report filters and sorting only as needed. |
| 4. Diagnose and confirm help | Support dialog shows account state, device kinds, connection status, imports, counts and account audit labels. Actions ask for confirmation. | Name sources plainly, add available app-version/last-success evidence, put failures and next steps first, and show a clear completion receipt. Keep private records out. |
| 5. Review reports | Queue and resolve/remove actions render. The visible card contains the complaint, not the reported comment/photo/bio itself. | Provide scoped reported-item context and type-specific actions before an operator removes anything. A person-report removal currently removes the profile photo; it does not remove a bio. |
| 6. Investigate sign-ins | **Broken before the fix:** `people.map is not a function`. | Fix the response contract and test pagination, filters, empty/error states, expired sessions and late replies. |
| 7. Read Usage | Period totals, sources and expandable daily counts render with UTC explanations. | Keep “not tracked” distinct from zero and explain what counts mean. Add links to relevant support queues instead of more charts first. |
| 8. Read Audit history | History renders, but action codes and target IDs require interpretation; the endpoint returns only its latest 200 rows. | Reuse plain-language action labels, identify targets safely, add search/pagination and distinguish requested, succeeded and failed actions. |

Beta requests and Invitations also rendered, including empty states. They remain useful for a full account cap or invitation exceptions; they should not dominate the open-signup operator's daily work.

## The reported error and its fix

`GET /api/admin/people` now returns `{rows, total, page, pages}`. Sign-in history still called `.map` on that object as if it were the former array. The account list itself already used `rows` correctly.

The fix reads validated account pages before building the filter. It includes test accounts because sign-in history includes their events, retains the selected account, and stops if the view/session changes. A selected account that is no longer listed keeps an explicit label instead of appearing to become “All accounts”. A failed or malformed page uses the existing section error and Retry; it is not silently converted to an empty account list. The script cache version changes with it.

Simply replacing `.map` with `.rows.map` would hide everyone after the first 50. The regression covers a later-page account, escaped names, filter/cursor preservation, empty/unlisted accounts, a failed second page and stale replies. A separate Admin UI workflow runs it without a server/database. Existing API authorization tests remain separate.

This complete dropdown is appropriate for the current capped launch. At larger scale, replace full-list fetching with a paginated account lookup that retains the selected account; do not increase an unbounded browser preload. The current endpoint permits at most page 1000, and invalid/out-of-range pagination is reported as an error.

## Now: before expanding the public launch

### 1. Restore and protect the essential operator paths

**Problem:** one successful API contract change broke a different admin screen, which API-only tests did not catch.

**Required:** the Sign-in history fix above; a browser smoke path through every section; complete filter selection beyond 50 accounts; useful failure/Retry states; stale search/detail/modal responses must not reopen an old account or overwrite the current view.

**Done when:** production UI functions pass regression tests and the fictional browser walkthrough passes on phone and laptop, with no unhandled errors. Account search, detail, reset confirmation, sign-out confirmation, suspension/restoration and deletion confirmation are included; actual writes remain covered by isolated backend tests. Expiry/demotion returns to portal sign-in and clears sensitive modal content. The fix alone does not establish every asynchronous path is guarded.

### 2. Add an honest launch-readiness panel

**Problem:** Overview says whether email is configured, but does not establish that delivery works. It has no backup/restore evidence or complete operator checklist.

**Required:** show **Verified / Needs attention / Not checked**, the last checked time and a next action for: portal MFA; encryption-key availability; signup mode and cap; sender/webhook/support mailbox checks; backup freshness and a separately dated restore drill; release/rollback version; unresolved critical reports. Distinguish configuration, a successful test and old evidence. Never display keys, routes, database locations or personal content. Missing evidence is “Not checked”, not green. Make an MFA-off warning visible throughout the portal.

**Done when:** stand-in missing/stale/failing evidence produces the correct state. A backup existing cannot pass the restore gate. An email API acceptance cannot pass the delivery gate. Every warning links to a useful next step; no probe sends real email or changes production automatically.

This follows Google's launch checklist emphasis on capacity, backup/restore, failure behavior, monitoring and controlled releases. Apply it at Kinetta's size, without adding enterprise machinery merely to fill a checklist. [Google SRE launch checklist](https://sre.google/sre-book/launch-checklist/)

### 3. Make moderation decisions informed and specific

**Problem:** an operator currently sees a report's allegation and a generic removal button without the actual reported content or a clear target-specific effect.

**Required:** a report-detail view with only the submitted item, reporter/reason, dates and relevant prior reports; plain actions such as “Remove this comment”, “Hide this activity” or “Remove profile photo”. Do not imply that removing a photo removes a reported bio. Offer account suspension through its existing confirmed flow. Keep ordinary support unable to browse private activity/food/chat records. Access to reported content must be scoped, authorized and audited; deleted/unavailable items remain explainable.

**Done when:** fixtures for comment/activity/person reports show exactly the permitted item and action; another member cannot access them; confirmation names what will change; the audit receipt records the actor, target, action and outcome without copying private content. Establish a documented daily report triage and support contact before recruiting more users.

### 4. Prefer reset links and complete the fallback safeguards

**Problem:** the account dialog offers “Set temporary password” even for members with confirmed email. The existing reset path sets a normal password; no forced-change/expiry mechanism was found. “Temporary” currently describes operator intent, not an enforced security property.

**Required:** make Send password reset email the normal path for confirmed accounts. Hide manual reset in an explicit fallback flow for accounts that cannot receive email; explain the consequences. Implement and test forced change/expiry before claiming a password is technically temporary. Never show an existing password or add account impersonation. Retain server-side authorization, typed confirmation, session revocation and audits. Make verified identity a prerequisite for assisted account-email changes or data requests.

**Done when:** confirmed-account support uses the member's single-use link; fallback UI cannot promise expiry or forced change until the backend enforces it; old sessions are invalidated according to the action; duplicate taps and failed/ambiguous responses have honest outcomes. Verify account recovery with fictional accounts and a mail stand-in, then record a separately authorized real delivery check.

### 5. Prove the launch, recovery and support path

Before broader invitations, run the evidence table below. Existing open signup is not proof that every readiness gate has passed. Do not silently raise the account cap. Stop expansion if sign-in/recovery, account isolation, moderation or recovery evidence fails; keep a documented owner decision for any accepted limitation.

## Next: make support faster without collecting more private data

1. **Actionable Overview:** link open reports, failed imports, connection failures and unanswered requests to the affected queue. Show age/last success as well as counts. Do not present an empty filtered list as a service success.
2. **Clear operation receipts:** after reset, sign-out, suspend/restore, role change and delete, show what happened, to which account and when. Put validation errors beside the control/dialog that caused them, preserve drafts and expose pending/error states to assistive technology. [W3C form notifications](https://www.w3.org/WAI/tutorials/forms/notifications/)
3. **Useful audit investigation:** reuse `AUDIT_LABEL` in the main audit view, link non-deleted account targets, add filters and pagination beyond the latest 200, and preserve minimum useful receipts after deletion under the chosen retention policy. Record administrative actions and failures, but exclude passwords, tokens, health data and message bodies. [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
4. **Account support hierarchy:** keep status, verified email, device/app version, last connection success/error and next step above long counts/history. App version is not currently provided by this account response; add it deliberately rather than inventing it. AI request counts are not a cost/cap indicator.
5. **Data-request register:** record request type, receipt date, identity verification, owner, status and completion evidence. Start with a documented private manual process if necessary. Self-service export/delete already exist; an admin-delivered export must go only to the verified person, never become an admin download. Agree retention before implementing storage.
6. **Phone/accessibility polish:** keep 44px controls and 16px inputs; use short wrapping status text rather than numeric display sizing for phrases. Align headings with the approved sans design. Give repeated “Open” actions account-specific accessible names; label tables and preserve header relationships when stacked on phones. Validate keyboard focus, dialog error announcements, zoom and VoiceOver separately. Captions can help people identify tables; a screenshot is not proof of screen-reader compatibility. [W3C table captions](https://www.w3.org/WAI/tutorials/tables/caption-summary/)

## Later: only when scale or staffing requires it

- Server-backed searchable account picker, richer account sorting and saved filters.
- Signup → confirmed → first workout/food → returning-user aggregates, with explicit definitions and no private-content drill-through. Do not infer iPhone installs from account creation.
- Batched beta approvals with one complete preview and replay-safe sending, if the waitlist becomes busy.
- A restricted Support role when a second helper actually needs one. Retain Administrator/Member until then; design permission tests before granting new access.
- Further operational automation only after probes, ownership and failure handling are established. Monitoring must not become a mechanism for sending unsolicited notices or changing accounts.

## Reconcile issue #233 with the current implementation

| Part | Present in source | Still missing or unverified |
| --- | --- | --- |
| A: safety | Separate MFA/session/CSRF model; database-backed sign-in limits; MFA state in Overview | Complete readiness page, persistent MFA-off banner, backup/restore evidence |
| B: find accounts | Search, role/status filters, pagination, test-account control | Requested joined/active/report filters and sorting; robust asynchronous error/race handling |
| C: account support | Identity/status, device kinds, connection/import status, counts, reports and account audit | App version, storage/AI cap context, clearer last-success/next-step presentation |
| D: actions | Reset email, manual password reset, sign out everywhere, suspend/restore, role change, remove | Enforced temporary-password fallback, assisted verified-email changes, verified-recipient export workflow |
| E: moderation | Report queue and resolve/take-down; block/report in the app | Reported-item context, target-specific actions, warnings, reserved-name policy and useful moderation history |
| F: data requests | Member self-service export/delete | Request/verification/completion register, agreed retention and visible job outcomes |
| G: invites/beta | Invitations, queued replies, provider states and joined status | Summarized funnel, recipient-bound invitations and bounded bulk preview/send |
| H: roles | Administrator and Member | Support role intentionally deferred until needed |

“Present” is source evidence, not a claim that this review executed production actions or passed release acceptance.

## Launch evidence to collect

| Gate | Required proof | Status of this review |
| --- | --- | --- |
| Portal essentials | Exact candidate's UI regression, eight-section walkthrough, later-page filtering, Retry/empty/expiry checks | Before crash reproduced; fix tested with fictional stand-ins; final PR/CI status recorded separately |
| Authorization | Isolated member/expired/demoted/last-admin/CSRF tests; no private fields or credentials in support responses | Existing tests identified; not rerun locally because no database access is authorized |
| Account lifecycle | Fictional signup → confirm → welcome → first activity → recovery → export/delete; cap/waitlist race | Existing implementations/tests identified; end-to-end real service check pending |
| Email | Confirm/reset/safety examples; provider acceptance vs delivery; monitored reply-to and signed webhook | Configuration and UI source only; no real mail sent |
| Moderation | Report → scoped review → correct action → audit receipt, with a response owner | Queue/confirmation preview only; gaps above remain |
| Recovery | Recent backup plus isolated restore drill, correct encryption-key recovery, rollback procedure | Not checked; no production or database access |
| Operations | Sanitized error/latency and failed-job monitoring, capacity test at planned launch size, explicit cap/stop conditions | Proposed; not measured or changed |
| iPhone/provider acceptance | Installed signup, recording/locked audio, Health/APNs, Garmin sync, privacy and account switching | Not tested; keep device/provider gates separate from portal work |
| Release | Reviewed PR, candidate CI, owner-authorized merge/deploy, observed result and rollback reference | PR-only scope; no release authorized by this review |

Use fictional test accounts and keep real routes, emails, recovery keys, tokens and raw device evidence out of public PRs. Assign an owner and dated result to each gate before marking it verified. No new paid monitoring provider, analytics SDK, support role, database table or infrastructure change is required by this research PR.
