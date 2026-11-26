# Saved Kit conversations (staged API)

Kit conversations are kept until the person deletes them. The client confirms single
and all deletion. Account export includes threads and messages; account deletion
cascades them. Separately saved preference notes retain their existing inspect/delete/off
controls and are not erased by deleting a conversation. Deleted content can remain in
backups until those backups are replaced. The matching public wording is included in
`site/content/privacy.md`; ship the saved-chat client with the reviewed API.

`KINETTA_KIT_HISTORY_ENABLED=1` enables new/resumed durable visits; default `0` preserves
legacy transient chats. Saved history stays readable/deletable even when switched off.
No builder changes a running setting. Reading/resuming/deleting makes no model call.
An expanded recent-context scope has a new isolated Kit fingerprint group: the existing
report is not declared equivalent. Obtain matching reviewed evaluation before rollout.

All paths below use `/api/coach/conversation`. Authenticated identity is server-bound;
foreign/missing conversation IDs return the same unavailable response.

| Method/path | Body / result |
| --- | --- |
| GET `/threads?before=<conversation UUID>` | `{enabled,retention:'until_deleted',retention_decision_pending:false,generation,conversations,before}`; 20/page; items `{conversation_id,title,created,updated,message_count}` |
| POST `/threads` | `{conversation_id,visit_id,generation}`; UUIDs idempotent |
| POST `/threads/{id}/resume` | `{visit_id,generation}`; fresh visit, stable conversation |
| GET `/threads/{id}?before=<message ID>` | Latest 50 own messages; no visit required |
| DELETE `/threads/{id}` | `{ok:true,generation}`; erases one thread and its visits |
| DELETE `/threads` | `{ok:true,generation}`; erases all chats and visits |

Create/resume/read return `{conversation_id,generation,visit_id,messages,before,ready}`;
read-only history has `visit_id:null`. Existing message/answer request bodies stay unchanged;
visits map to threads server-side. Always use the current envelope generation for writes.
Deletion rotates it to fence queued creates/resumes and late answers; refresh thread list
after deletion. Single deletion also interrupts other in-flight answers for that account.

Visits still end/expire at 24 hours, cancelling work. Saved turns are detached first and
survive; interrupted turns become Retry with no automatic provider call. A fresh resumed
visit can retry them. At most six completed answers enter model history; consent filtering,
release/access/budget checks and lease races remain. Sensitive saved answers carry a
server-stamped source-permission snapshot: deleting source records cannot bypass later
revocation. Permission changes during a durable turn discard its result; older sensitive
context without provenance is filtered conservatively. Historical numbers are not current
evidence. Legacy Clear starts a fresh transient chat and preserves durable history.

Migration 119 adds owner-RLS threads and owner-constrained visit/message references;
no model role archive grant. Migration 120 extends invalidation and legacy quarantine
to Garmin-only answers marked `garmin_included`, without changing migration 119. Existing records remain unlinked. Privacy, real-provider
quality, client/device checks and rollout remain separate from stand-in contract tests.


Source deletion or consent revocation permanently wipes sensitive/unknown-provenance
answers and cancels pending work; restoring consent or reimporting data cannot restore
them. Questions and an irreversible invalidation timestamp remain until chat deletion.
Database triggers cover consent revocation, imported workout deletion, Garmin disconnect,
weight/sample/exclusion removal, and resting/day-energy/raw-stream deletion. Health daily-weight and best-effort
projection rebuilds retain their underlying source records and never erase Kit data. Routine sync
updates, including corrected measurements, do not erase saved answers or notes or cancel
pending work. Sensitive preference notes are deleted on consent revocation, not on routine
updates or source deletion: they are the person's own saved words. Owner reporting SQL
cannot read Kit text. Single/all deletion removes visits and legacy turns as well as saved turns.

Opening an empty chat keeps only a temporary visit, not a saved thread. The first
accepted question creates the thread atomically. Limits per account: 500 saved chats,
100 retained visits, and 30 new visits/minute; idempotent retries do not count again.
All creation paths share those limits, including legacy visits and Clear.
Invalidated messages retain the question and return `invalidated:true` with the answer
interpretation “This answer was removed because its health data was removed or sharing
was turned off.” They cannot be retried or replayed to the model, even after regrant.

Each chat is capped at 200 turns (including failed/invalidated turns), under the
account lock. Existing message-ID retries remain idempotent at the cap. Exhausted
daily quotas reject create before insertion; generation preflight failures without
a provider reservation erase the new turn and return an empty chat to draft state.
An attempted generation may retain a failed turn for explicit Retry.

Upgrade quarantine is non-destructive: legacy sensitive/unknown-provenance answers
remain in SQL and account export with `replay_blocked_at`, but never appear in history,
thread titles/counts or model replay, and cannot be regenerated by a known message UUID.
Consent-valid preference notes and pending work survive migration. Erasure on upgrade
is restricted to an actually disabled applicable permission; absent lineage/source
records alone are not evidence of deletion. Routine sync updates, including corrected
values, preserve answers, notes, pending leases and memory versions.
