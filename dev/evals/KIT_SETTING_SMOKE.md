# Small Flash LOW/MEDIUM experiment

This ten-case experiment uses the same source and fictional data with LOW thinking, or an explicit LOW/MEDIUM comparison.
It cannot approve a release (fewer than 40 cases) and never escalates to another model.
Production defaults stay Flash LOW. Both settings use the production answer path: at most five provider
rounds/twelve tool calls and one no-tools validation correction, with unchanged consent and numeric checks.
There is no experiment-only two-call cap or disabled retry. No-tools answers request the matching response
schema; token-limit correction uses the production larger budget. Both settings retain per-call raw final JSON,
finish reason, ceiling, input/visible/thinking/total tokens and answer evidence in the private report.
A denied data tool returns the existing consent message without another provider call; only the named consent-off
fixture can count that exact refusal as a pass. A truncation remains a failure if its bounded correction fails.
Run it only after the owner authorizes the small paid stage.

```sh
# No key needed; validates the actual selection/cache checks and copies private metadata out.
dev/evals/run_kit_setting_smoke.sh --dry-run
# Owner only: exported GEMINI_API_KEY, never a key argument.
dev/evals/run_kit_setting_smoke.sh
# Optional: reuse only successful LOW rows whose source/input/date/settings digest still matches.
dev/evals/run_kit_setting_smoke.sh --reuse-low /private/prior-smoke.json
```

The existing disposable wrapper isolates the app/database, copies output before teardown (including failure/signals),
and passes the environment key only to the one-shot evaluator. Each resumed stage has a $0.45 total reservation cap; exhaustion stops scheduling and leaves a partial report. Read its printed private output path.
A cap is not a promise all cases finish. Rejections and costs remain visible. No output goes into the repository.
Cache mismatch fails before any provider call; changed prompts, code, fixture inputs or dates invalidate reuse.

Grade the shuffled answers without setting labels. Score each `human_rubric` dimension 0/1/2: direct/useful,
appropriate length/structure, correct evidence/units, context/clarification, supported next step, privacy/safety.
Any invented measurement, privacy/consent failure, medical claim or unconfirmed write fails the stage.
Prefer MEDIUM only if it wins at least 3 cases, loses at most 1, and improves median score without new safety failures;
also compare latency, retries, tokens and actual cost. An acceptance/rejection count is not a quality grade.
If MEDIUM still scores below 8/10 useful answers or has a critical failure, stop for owner review before proposing
a larger model on at most five failed cases with independently verified pricing and a separate $0.45 cap.

The follow-up defaults to **LOW only** (10 responses); MEDIUM is opt-in with `--smoke-thinking COMPARE`.
Use `--resume /private/prior-smoke.json` to reuse completed matching rows, including replaying captured
validation failures after a validator fix. Both cached successes and failures are rechecked locally against
their exact raw JSON and evidence. A terminal rejected response is retained without silently paying again;
cap/transport-only incomplete rows can run. Changed model inputs, source, fixtures, dates or settings fail
cache validation before any provider call. Harness-only changes do not invalidate matching inputs.
Legacy captures are checked against their original Git bytes before migration; originals are never modified.
A different integrated batch needs a fresh smoke because its model-input source has changed.

The padded SQL reservation remains the hard dollar bound; no second 10% haircut is applied. The prior smoke's
20-request stop was reproduced offline as a **dollar reservation** ($0.191112 for the next MEDIUM request),
not the 1,000-attempt limit. LOW reduces the output ceiling and reservation. Resume deducts the prior report's
entire spend from the $0.45 allowance; reports separate prior/new spending and reused/new responses.
`--dry-run --resume FILE` validates the same inputs and replays cached outputs with zero provider calls.
`--offline-smoke` proves 60 actual SQL reservations/settlements (stand-in tokens, no network), enforces the
dollar cap, and reproduces the prior MEDIUM interruption through the real transport body builder.
