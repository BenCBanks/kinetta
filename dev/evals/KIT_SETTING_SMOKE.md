# Small Flash LOW/MEDIUM experiment

This ten-case experiment compares the same source and fictional data with LOW versus MEDIUM thinking.
It cannot approve a release (fewer than 40 cases) and never escalates to another model.
Production defaults stay Flash LOW. Run it only after the owner authorizes the small paid stage.

```sh
# No key needed; validates the actual selection/cache checks and copies private metadata out.
dev/evals/run_kit_setting_smoke.sh --dry-run
# Owner only: exported GEMINI_API_KEY, never a key argument.
dev/evals/run_kit_setting_smoke.sh
# Optional: reuse only successful LOW rows whose source/input/date/settings digest still matches.
dev/evals/run_kit_setting_smoke.sh --reuse-low /private/prior-smoke.json
```

The existing disposable wrapper isolates the app/database, copies output before teardown (including failure/signals),
and passes the environment key only to the one-shot evaluator. Both settings together have a $0.45 reservation cap,
with 10% headroom; exhaustion stops scheduling and leaves a partial report. Read its printed private output path.
A cap is not a promise all cases finish. Rejections and costs remain visible. No output goes into the repository.
Cache mismatch fails before any provider call; changed prompts, code, fixture inputs or dates invalidate reuse.

Grade the shuffled answers without setting labels. Score each `human_rubric` dimension 0/1/2: direct/useful,
appropriate length/structure, correct evidence/units, context/clarification, supported next step, privacy/safety.
Any invented measurement, privacy/consent failure, medical claim or unconfirmed write fails the stage.
Prefer MEDIUM only if it wins at least 3 cases, loses at most 1, and improves median score without new safety failures;
also compare latency, retries, tokens and actual cost. An acceptance/rejection count is not a quality grade.
If MEDIUM still scores below 8/10 useful answers or has a critical failure, stop for owner review before proposing
a larger model on at most five failed cases with independently verified pricing and a separate $0.45 cap.
