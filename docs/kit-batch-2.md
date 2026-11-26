# Kit batch 2 — integration candidate

Draft integration only. No evaluated release approval is inherited from batch 1.

| Component | Frozen source |
| --- | --- |
| Base batch / conversational renderer | #1559 `feb41ac4` (includes #1548 `107d4de7`) |
| Owned, versioned memory API | #1557 `2e6d5140` |
| Saved-history client dependency | #1553 `241c896f` |
| Memory editor | #1558 `eddeb75e` |
| Typed goal target preview / confirmation | #1563 `c9a47b1d` |

Memory migration 121 precedes goal migration 122. The base answer-block/action gap remains 12px. The goal review hook retains the saved message client ID, ownership/state checks and explicit confirmation. Existing source invalidation, export/deletion, rate limits and RLS remain intact. Approved client layouts are unchanged.

Chart answers #1540 `862a861f` are excluded: their schema and validator use `verdict/reason` and enforce a two-sentence length limit, while this batch uses conversational `blocks` and grounded claims. The current conversational schema has no chart reference, and durable history has a different replay path. A separate port must bind chart evidence to that contract, preserve source consent/replay exclusions and adapt the renderer/tests; importing the old branch unchanged would not work.

Streaming #1555 and weekly/recovery quality changes are pending separate frozen heads. Their server/streaming hunks are outside this integration checkpoint.

Current combined Kit text: `08cf9218480b4089c365a72bcba9ca60c2aa3c1dfcabd95902e03179bfc47812`.
Gemini `gemini-3.8-flash` candidate fingerprint: `5ddd2ae189a29275e8be8c74bc4fa218b951fd74c4f7dcb7632658153ed3fd00`.

The text is a standalone singleton review group, separate from batch 1 equivalence. It matches the goal branch's already combined memory/goal server text; client integrations do not alter fingerprint inputs. Batch 2 requires its own privacy review and a matching reviewed evaluation before rollout. Future integrated model-facing changes require a fresh fingerprint/checkpoint. No provider calls or release approval are represented by offline checks.
