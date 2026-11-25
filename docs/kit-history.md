# Saved Kit conversations (storage foundation)

The planned history API keeps conversations until the person deletes them, with
confirmed single/all deletion in the client. Account export includes thread metadata
and messages; account deletion cascades both. Conversation deletion does not erase
separately saved preference notes, which retain their existing inspect/delete/off controls.
Deleted content may remain in backups until those backups are replaced.

Migration 119 adds owner-RLS threads and owner-constrained references from visits and
turns. The model role cannot browse the archive. Saved turns can be detached before
24-hour visit cleanup; interrupted work becomes Retry without a provider call.
Legacy unlinked visits retain their existing expiry. No existing records are rewritten.

This foundation exposes no new endpoints or runtime activation. A separate API Draft
will wire preservation into cleanup and stage history behind a default-off rollout
switch. Disabling rollout must preserve already saved conversations. Privacy policy
publication and client deletion confirmations accompany the reviewed rollout.
