# Kit batch 2 — integration candidate

This candidate integrates saved chats, memory corrections, confirmed goal changes, checked-answer streaming, contextual next steps and on-demand charts on main after #1559 squash `67d35104`. It needs its own reviewed evaluation; no batch-1 approval is inherited.

| Component | Reviewed source |
| --- | --- |
| Conversational renderer / base | #1559 `67d35104` (same tree as `feb41ac4`) |
| Owned, versioned memory API | #1557 `2e6d5140` (identical restack `2ee82099`) |
| Saved-history client | #1553 `241c896f` (identical restack `7996634a`) |
| Memory editor | #1558 `eddeb75e` (identical restack `3de2af83`) |
| Typed goal preview / confirmation | #1563 `c9a47b1d` |
| Checked-answer streaming | #1555 `7c2c4d7e` (`41b70455` + `7c2c4d7e`) |
| Plain recovery / weekly coaching | #1565 `b4b30d15` |
| Permitted context and one useful clarification | #1567 `05b64b06` |
| Conversational, evidence-bound workout charts | #1540 `1164ca4b` |
| Pinned live-baseline evaluation tooling | #1573 `c1daf687`, with combined-scope and automatic training cases |
| Checked weekly fallback on main | #1579 `7a9fb03f` |
| Saved-chat advice and chart evidence regressions | #1580 `b63e7d5b` |
| Checked ordinary recovery and supported warm training | #1586 `ce73e9d3`, `d1582a02`, `669c6ead` |
| Weekly total-chart declutter | #1586 `300a652d` |

Memory migration 121 precedes goal migration 122. Both router hooks and independent test registrations are retained. The approved 12px answer/action spacing, saved-message goal dispatch, ownership, consent/invalidation, SQL RLS, export and delete fences remain intact.

Streaming emits checked blocks only after the entire answer validates and saves. The first checked block can paint before completion; actions and confirmation controls wait for the authoritative complete envelope. This does not reduce provider generation latency or expose raw model tokens. Legacy and saved-thread envelopes advertise the capability; thread switches abort the transport and retain account/generation/visit fences. Closed quota/unavailable events retain the original question after rejected-turn removal, including the missing-row race, without automatically generating again.

Plain wording runs after original measurements and claims validate. Recovery/weekly displays omit internal scores and provide concrete next steps. Existing low-intake and consent refusals remain app-owned.

Contextual coaching uses only the existing permitted memories and current-chat history. Current requests take priority over old preferences; saved goals require current tool evidence. A single checked clarifying question renders as an ordinary final paragraph. It adds no storage or automatic action.

On-demand workout charts use the conversational blocks contract and one verified tool reference. The app draws at most 30 account-bound points with account units, unknown-value gaps, empty/single-point states and keyboard/pointer selection. Exact summary claims, direction, source consent and final-save fences remain enforced. Charts live only inside Kit answers; weekly starters cannot request charts. Stored chart points do not enter later model history.

“Review my training” opens with a supported positive and a concrete optional next step. Its app-owned six-week distance-total chart appears only with at least three measured weeks; missing distance stays unknown. Weekly totals use bars, three single-line date labels and selectable empty slots with a “No distance” readout. One missing-record note remains. The ordinary weekly-review flow stays text-only. Natural counts and signed comparisons require complete, current, matching evidence; ambiguous sugar and conflicting nutrition periods still reject and use checked app recovery.

Combined Kit text: `15e6c988b4d5815e1c0f27d0452f93932555c6523038cfa69d469de0409bacc4`.
Gemini `gemini-3.8-flash` release candidate: `3cadff0fd1bc20e4f630aaa324aa6be7afa91b474f4ba9cd743b3bb058ecfa66`.

The combined text is a new singleton group, separate from batch 1 and standalone quality. General and food model-facing text match main. Offline tests and a zero-provider dry-run establish integration mechanics, not model quality or release approval. A fresh reviewed combined evaluation, privacy review and Ben preview are required before rollout; no old paid cache is reused.

The evaluation uses the reviewed weekly installed-report pin and full baseline helper tree at `7a9fb03f`. Use `dev/evals/run_kit_release_eval.sh --installed-report "$REPORT" --replay` for an exact-head offline receipt, then `--dry-run` for a zero-provider preflight. Its default owner run selects ten smoke cases; matching baseline and successful smoke rows are reused before full continuation. Expected candidate cost is about $0.18 smoke plus $0.54 remaining, with a shared $0.80 allowance. A one-time new-baseline bootstrap costs about $0.72 separately. Paid execution and review remain owner actions. The gate documentation records exact selection, cost limits and resume rules.

Ben preview set: contextual next step and useful clarification; chart bars/pace, missing measurements, empty/single-point states and selection; first checked block versus completed answer/actions; recovery and weekly wording. Use fictional stand-ins at 390 light/dark with 330 checks. History, memory-editor and goal-preview screens retain their approved layouts. Browser evidence does not claim physical-iPhone verification.
