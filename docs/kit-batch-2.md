# Kit batch 2 — integration candidate

This candidate integrates saved chats, memory corrections, confirmed goal changes, checked-answer streaming and plain coaching on main after #1559 squash `67d35104`. It needs its own reviewed evaluation; no batch-1 approval is inherited.

| Component | Reviewed source |
| --- | --- |
| Conversational renderer / base | #1559 `67d35104` (same tree as `feb41ac4`) |
| Owned, versioned memory API | #1557 `2e6d5140` (identical restack `2ee82099`) |
| Saved-history client | #1553 `241c896f` (identical restack `7996634a`) |
| Memory editor | #1558 `eddeb75e` (identical restack `3de2af83`) |
| Typed goal preview / confirmation | #1563 `c9a47b1d` |
| Checked-answer streaming | #1555 `7c2c4d7e` (`41b70455` + `7c2c4d7e`) |
| Plain recovery / weekly coaching | #1565 `b4b30d15` |

Memory migration 121 precedes goal migration 122. Both router hooks and independent test registrations are retained. The approved 12px answer/action spacing, saved-message goal dispatch, ownership, consent/invalidation, SQL RLS, export and delete fences remain intact.

Streaming emits checked blocks only after the entire answer validates and saves. The first checked block can paint before completion; actions and confirmation controls wait for the authoritative complete envelope. This does not reduce provider generation latency or expose raw model tokens. Legacy and saved-thread envelopes advertise the capability; thread switches abort the transport and retain account/generation/visit fences. Closed quota/unavailable events retain the original question after rejected-turn removal, including the missing-row race, without automatically generating again.

Plain wording runs after original measurements and claims validate. Recovery/weekly displays omit internal scores and provide concrete next steps. Existing low-intake and consent refusals remain app-owned.

Chart answers #1540 are excluded: their old verdict/reason schema, short-answer validator and replay hook need a separate conversational/evidence/consent port. New contextual coaching and charts remain separately reviewed work.

Combined Kit text: `55738ccf3f2ea2d0e3d751e79a5fed16ec0ca730d9bb9971ff931f207ba7fecf`.
Gemini `gemini-3.8-flash` release candidate: `7068923e39052f8b501e0d9cf802d06071dacc690200f99649f5377065e9c0a6`.

The combined text is a new singleton group, separate from batch 1 and standalone quality. General and food model-facing text match main. Offline tests and a zero-provider dry-run establish integration mechanics, not model quality or release approval. A fresh reviewed combined evaluation, privacy review and Ben preview are required before rollout; no old paid cache is reused.

Ben preview set: first checked block versus completed answer with actions; saved-chat streaming/resume; recovery wording and next step; weekly comparison with missing food records and next step; memory correction and goal preview/receipt. Use fictional stand-ins at 390 light/dark with 330 checks. Existing unchanged memory/history/goal captures can be reused. Browser evidence does not claim physical-iPhone verification.
