# Workout-review gate runbook

Run these commands from the candidate checkout. Only the owner runs the paid step.
Use fictional records, an exported `GEMINI_API_KEY`, and private files outside the repository.
The wrapper never accepts a key argument, writes a key file, or passes the key to the app service.

## 1. Preflight and capture

Commit the candidate first. The wrapper builds a fresh app/database, copies the runner and
fixtures into the image, and copies the private result back before removing all test containers
and volumes, including on failure or Ctrl-C. It refuses to overwrite an existing capture.

```sh
dev/evals/run_workout_review_eval.sh --thinking LOW --cases 40 --dry-run
```

This runs the same expected-pass and input-distinctness selection checks as the paid path,
then copies a header-only file to the host with mode 0600. It makes no provider calls.

When authorized, with `GEMINI_API_KEY` already exported in the owner's environment:

```sh
dev/evals/run_workout_review_eval.sh --thinking LOW --cases 40
```

`--thinking MEDIUM` is available if separately selected. The default is 40 gate inputs:
20 workout scenarios covering relations, hot/hillier/PR/longest, missing HR, no history,
strength, walks, rides and swims, exercised in metric and imperial settings. Two unit
variants also exercise matched-route wording, keeping all 40 inputs distinct. `--cases 20`
is a smoke evaluation and cannot produce a release report. Validator-rejection fixtures
are separate provider-free tests and are never sent as expected-success paid cases.

Each case prints its rejection code; the last line gives total charged or reserved dollars.
The reservation hook stops a send that would cross $1 for the entire run. An incomplete
capture exits nonzero and cannot create a report. Captures include raw and rendered answers,
fictional input evidence, token counts, latency, cost, source revision, model settings and Kit
fingerprints. Keep the original full capture private for human review.

## 2. Prepare and complete the human review

Set `CAPTURE` to the completed 40-case JSONL path printed by the wrapper. Set
`BASELINE_REPORT` to the existing reviewed private Kit release report. Select new paths
`REVIEW` and `REPORT` beside the capture in its private output directory. Do not reuse paths.

```sh
python3 dev/evals/workout_review_report.py \
  --capture "$CAPTURE" --baseline-report "$BASELINE_REPORT" \
  --prepare-review "$REVIEW"
```

Read every raw/rendered answer against its input evidence and compare with the reviewed
baseline behavior. Fill the reviewer name, baseline comparison and existing chat/weekly
regression decisions, then the five checks for each case: numeric support, isolation,
absence of health disclosures, conversation behavior, and quality. The initial review
file leaves every decision unanswered. A validator pass alone is insufficient.

Preparation rejects a smoke/dry/partial/stale capture, duplicate inputs, provider failures,
rejections, missing answers or missing usage. It requires an existing reviewed Kit baseline
with at least 40 cases. Review decisions are bound to the capture and baseline file hashes.
Existing chat/weekly evaluations must still pass; the workout cases do not replace that review.

## 3. Build the private report

After the owner has completed the review:

```sh
python3 dev/evals/workout_review_report.py \
  --capture "$CAPTURE" --baseline-report "$BASELINE_REPORT" \
  --review "$REVIEW" --output "$REPORT"
```

The report is written only if every case and overall decision is explicitly approved.
It contains the measured case count (at least 40), current Kit fingerprint/model settings,
required Kit gate fields, reviewer, source and evidence hashes, and run cost. It is mode
0600 and cannot overwrite a file. Preparation never writes an approved gate report.

Sage checks CI and the report on the final deployment candidate, merges, deploys and installs
the report through the normal private release procedure. The fingerprint covers model-facing
text and settings; a squash commit changes the revision but does not change matching text.
Any changed Kit text/model settings require a matching review. This tooling does not enable Kit,
modify runtime settings, install a report, deploy, or run TestFlight.
