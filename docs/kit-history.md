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
| DELETE `/threads/{id}` | `{ok:true,generation}`; erases one thread, closes its visits |
| DELETE `/threads` | `{ok:true,generation}`; erases all chats and closes visits |

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
no model role archive grant. Existing records remain unlinked. Privacy, real-provider
quality, client/device checks and rollout remain separate from stand-in contract tests.


Source deletion or consent revocation permanently wipes sensitive/unknown-provenance
answers and cancels pending work; restoring consent or reimporting data cannot restore
them. Questions and an irreversible invalidation timestamp remain until chat deletion.
Database triggers cover profile consent changes, imported workout changes/deletion,
Garmin disconnect, weight/sample/exclusion deletion, resting/day-energy records and
workout projections. Projection rebuilds conservatively invalidate old sensitive answers.
Sensitive preference notes are removed too. Owner reporting SQL cannot read Kit text.
Single/all deletion removes visits and legacy turns as well as saved turns.
