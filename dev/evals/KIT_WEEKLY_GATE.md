# Weekly-review P0 release gate

This evaluates the exact app bytes of PR #1579 (`21d42242749ba8296e6b95668d283810e3d7d59e`). The evaluator's HEAD is recorded separately. It freezes **all** live app helpers at `ba8e9500049f25b2cb769d09a25d99fc4cb198c1`, sharing only the disposable DB/ledger. The installed report must have SHA-256 `5aae49f41cb3ea4bb8091a34fee4459ca6e7d8cb857c3b82d37b4b361da0e568` and approve that tree. No old-report equivalence is added.

From this evaluator worktree, with an environment-only exported `GEMINI_API_KEY` for the owner-run paid command:

```sh
dev/evals/run_kit_weekly_gate.sh --installed-report "$HOME/pigserver/backup/2026-11-kit-eval-v2/kit-report-install-20261125.json" --reuse-baseline "$HOME/pigserver/backup/2026-11-kit-eval-v2/kit-gate-20261126T122651Z-1705527.json" --budget-usd 2.50 --dry-run
```

Remove `--dry-run` for the paid run. No paid run was performed during preparation. The fixed suite contains forty distinct cases, including ten weekly scenarios, own-data isolation and consent refusals. Every candidate case executes once through the production answer path; production's single bounded correction remains allowed. Historical **candidate** answers are never used as new generations.

On 26 November, the pinned capture has 31 unchanged live-baseline rows. Proof binds both UTC/Los Angeles dates, case definitions, seed code, full frozen live helper fingerprints/report, weekly seed/history/periods, actual starter guidance and baseline question wrapper. Only those rows are reused, preserving baseline failures. Nine missing baseline responses plus forty candidate responses remain. Expected new cost **$0.80–$1.10**, planning estimate $1.225 + $0.30 reservation headroom, hard stop $2.50. This is a cost estimate, not a guaranteed bill. Historical spend is already paid and is not charged against the new-run allowance. The metadata records its provenance separately. Do not compare historical baseline latency as a simultaneous measurement.

If dates or inputs no longer match, preparation fails before provider access. Omit `--reuse-baseline` for eighty fresh responses: expected $1.20–$1.60, planning estimate $2 + $0.30 headroom, same hard cap. Resume the new run with the identical code/date and `--resume /absolute/path/to/new-report.json`, omitting `--reuse-baseline`. Exact completed or interrupted paid rows are not silently purchased twice. A failed paid candidate requires explicit `--retry-case ID` to regenerate.

Reports land privately under `$HOME/pigserver/backup/2026-11-kit-eval-v2/kit-gate-<UTC>-<pid>.json`, mode0600, copied out before teardown even on failure/interruption. The disposable service receives no provider key; only the one-shot evaluator process gets the exported environment variable. All reports start unreviewed.

Read every candidate `answer_blocks` against `tool_evidence` and `claim_evidence`, then rejection attempts and `app_fallback`/`fallback_reason`. App fallback is not model acceptance. Check unknown/missing counts and all ten weekly cases first; then food units/nutrient nouns, account isolation, consent refusal, low-intake safety and comparisons. Review baseline failures as historical results, not candidate regressions. Confirm forty candidate results and the correct candidate fingerprint. Only after human review set `reviewed=true`, `kit.case_count=40`, `kit.unsupported_numeric_claims=0`, `kit.isolation_failures=0`, `kit.health_disclosures=0`, `kit.baseline_compared=true`, `kit.conversation_review_passed=true` and `kit.qualitative_review_passed=true`. Do not mark a failed or incomplete candidate set approved.

Stored weekly captures also replay offline through exact validation and the real runner with stand-ins (`dev/tests/kit_weekly_safe_incontainer.py`); they remain historical regression evidence, never new provider generations. The wrapper's `--offline-smoke` proves the full frozen baseline with provider stand-ins and a real disposable SQL ledger; it makes zero real calls.
