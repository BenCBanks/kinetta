# Kit memory corrections

Kit's existing Memory sheet is the only client entry point. A memory is the person's own goal,
preference or routine, never a model-generated measurement. Up to twelve details remain available
for six months after their latest edit. Current records and current statements take priority.

All routes use the signed-in owner under `/api/coach/conversation/memory`:

- `GET`: `enabled`, `version`, `memories`. Each memory has `id`, `text`, `kind`
  (`goal`, `preference`, `routine`), `source` (`chat`, `user`, `edit`), `created`, `updated`,
  and `health_included`. Dates are server-stamped; editing retains the original creation date.
- `POST`: `{text, kind, version}` explicitly adds a detail.
- `PATCH /{id}`: the same body corrects that owner's existing detail.
- Existing `PUT {enabled}`, `DELETE /{id}` and `DELETE` controls remain compatible.

Read the current version before a write; a stale version returns 409 without overwriting newer work.
Text is trimmed, required and bounded to 400 characters. Unknown fields/kinds are rejected. Adds do
not silently evict a saved detail when full. Goals here are coaching context; editing one does not
change saved activity or nutrition targets. Sources and dates cannot be supplied by a client.

Adding/editing requires AI consent and the adult confirmation, with memory enabled. Health-derived
memories retain their source restriction after editing and cannot be edited into unrestricted notes
after Health consent is revoked. Own-data inspection and forgetting remain possible without AI
consent or a provider. Source-revocation cleanup from the history migration remains in force.

Every correction, forget or opt-out increments the memory version and invalidates pending/running
answer leases. A late provider result cannot save or restore the old detail; Retry is explicit.
There is no separate cached memory summary today. Old chat transcripts are not rewritten by an edit;
conversation deletion remains separate. The existing context envelope stays `said_at`/`user_said`.
All memory columns are included in the owner export; account deletion cascades. Owner-wide SQL reporting cannot read Kit text; ordinary per-person SQL readers retain
the existing RLS boundary, matching durable-history privacy policy.

This changes memory behavior and has a **new Kit fingerprint review group**. Fixture passes do not
replace the reviewed model evaluation required before rollout. No provider calls are needed to
exercise the API, editor, ownership or race protections.
