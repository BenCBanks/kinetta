# Checked Kit answer stream

`POST /api/coach/conversation/messages/{client_id}/stream` accepts the same authenticated
`{generation, visit_id}` body as `/answer`. First create the message normally. Use authenticated
fetch with a POST body and the existing request protection; native EventSource cannot send this request.
The ordinary `/answer` endpoint stays unchanged.

Responses use `text/event-stream`, `Cache-Control: no-store` and `X-Accel-Buffering: no`:

- `start`: `{version:1}`. No answer content or provider text.
- Comment heartbeats about every ten seconds while generation is pending.
- `block`: `{index, block}`. Each paragraph/list is already checked, app-formatted and saved.
- `complete`: `{message}`. The existing saved message envelope is authoritative, including facts/actions.
- `error`: `{code}` where code is `access_changed`, `answer_failed`, `conversation_changed`,
  `answer_timeout` or `stream_failed`. No exception/model text. Read the saved turn for normal recovery.

Clients replace blocks by index, then replace the whole message on complete. Reconnect with the same
message ID: it reuses the existing lease or saved answer, not a new paid generation. Replayed events
are expected; do not append duplicate blocks. There are no event IDs or unchecked partial JSON fragments.
Weekly/workout/legacy answers send complete without ordinary block events. Plain text needs escaping
in the client renderer, just as for the existing conversational contract.

The transport waits for whole-answer validation and persistence before sending any answer blocks.
It does **not** stream raw model tokens or reduce first-text latency. Incremental generation/validation
is a later change requiring separate model-quality evidence. This foundation has no new UI.

Ownership, generation/visit validity, AI access and applicable saved-answer Health/Garmin consent are
checked before content and between blocks. Clearing/deleting a chat or revoking access stops subsequent
events. Disconnect stops later provider rounds through the existing active guard. An already in-flight
provider request may finish and incur its normal charge; it is never restarted automatically. The stream
ends after five minutes. Budget reservations, settlement, cancellation and final save checks remain in
the existing generation path. No new storage, tools, retention rules or provider settings are introduced.
