# Replaying the batch-two release review

No provider calls are needed to verify the captured findings or prepare this cache.
The fictional date remains 2026-11-26. Keep the original capture unchanged.

The review fixes sport-subtotal scope, complete-date activity claims and empty-distance
buckets. Six weekly replies and both context replies now verify against their exact
counts, periods and directions. The ambiguous sugar amount still uses an app-owned
per-entry answer. Failed production answers retain owner/consent/cancellation checks;
the fallback uses the current availability correction or the user's food-logging goal.
Weekly fallback copy is shorter and does not append a duplicate next step.

The source records prove the six-week training chart's 7/5/3 km, 15 km known total
and three workouts. Empty weeks have no measured distance: no zero or downward change.
Tuesday/Saturday comes from the actual permitted user history or routine memory.
`context_evidence` now exposes those exact user statements, and `app_tool_evidence`
includes automatic chart reads performed after prose validation. Assistant history
is not promoted into personal evidence. These fields are fictional evaluation data,
not new production logging.

## Owner commands

From the final committed candidate tree, with `E` set to a private directory:

```sh
python3 dev/evals/kit_release_replay.py \
  --capture "$E/kit-gate-20261126T155757Z-2884002.json" \
  --output "$E/kit-release-review-replayed.json"
dev/evals/run_kit_release_eval.sh \
  --installed-report "$E/kit-report-install-20261126-weekly.json" --replay
dev/evals/run_kit_release_eval.sh \
  --installed-report "$E/kit-report-install-20261126-weekly.json" \
  --full --budget-usd 1.60 --cache "$E/kit-release-review-replayed.json" --dry-run
```

Only after the dry run and exact-head offline receipt pass, the owner may remove
`--dry-run` from the final command. The expected plan is 78 reused responses,
two remaining candidates (`load`, `recovery`), approximately $0.036 additional,
$1.470816 cumulative including the original $1.434816. The hard stop is $1.60,
including historical reservations. Actual cost can differ.

The cache preparation proves archived per-case digests, unchanged fixture/context/
provider-call inputs, and exact hashes of the scoped validation/rendering changes.
Unexpected prompt, schema, reader, fixture or source changes refuse reuse. Captured
provider turns are replayed in order, stopping at the first currently valid reply.
Automatic charts and required app fallbacks are rebuilt offline. Original response
provenance and paid reservations remain; neither the archived report nor its human
review is rewritten. All approval fields remain pending. The new Kit fingerprint
is a singleton and still needs the owner's full answer/evidence review before release.

After integration, refresh the strict candidate source/text/release pin and regenerate
this cache and receipt on that final head. A changed app node or provider input needs
a fresh proof/review, not an added equivalence hash. Prepared files are exclusive 0600;
provider keys are never passed to the replay container, which has no network.

## Offline checks

```sh
python3 dev/evals/test_kit_release_replay.py
python3 dev/evals/test_kit_eval_savings.py
python3 dev/evals/test_kit_gate_resume.py
python3 dev/tests/ai_fingerprints.py
```

The standard `--replay` also runs all 40 fictional review inputs with counterfactual
sport/count/date/scope tests, existing recovery replays and real SQL/consent chart
stand-ins. Direct check: `dev/tests/kit_release_review_incontainer.py` inside a
no-network app image. SQL checks live in `dev/tests/progress_series_incontainer.py`.
