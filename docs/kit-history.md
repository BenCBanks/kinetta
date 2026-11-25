# Saved Kit conversations (storage foundation)

The planned history API keeps conversations until the person deletes them, with
confirmed single/all deletion in the client. Account export includes thread metadata
and messages; account deletion cascades both. Conversation deletion does not erase
separately saved preference notes, which retain their existing inspect/delete/off controls.
Deleted content may remain in backups until those backups are replaced.

Migration 119 adds owner-RLS threads and owner-constrained references from visits and
turns. The model role cannot browse the archive. Saved turns can be detached before
24-hour visit cleanup; interrupted work becomes Retry without a provider call.
Legacy unlinked visits retain their existing expiry. On upgrade, sensitive or unknown-provenance
legacy answers are retained in storage and account export but quarantined from history and
model replay with replay_blocked_at. They are not deleted merely because source lineage is unknown.
Upgrade erasure is limited to an actually disabled applicable AI/source permission; unused
source toggles do not erase data. Consented preference notes remain intact.

This foundation exposes no new endpoints or runtime activation. A separate API Draft
will wire preservation into cleanup and stage history behind a default-off rollout
switch. Disabling rollout must preserve already saved conversations. Privacy policy
publication and client deletion confirmations accompany the reviewed rollout.

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
