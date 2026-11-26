# Spend-controlled release evaluation

Use `run_kit_release_eval.sh` for release testing. It retains the batch wrapper's
reviewed live source/report pin, disposable DB, environment-only key, private
captures and teardown. No production settings change. A report still needs human
review; cached results never create an equivalence entry or approve a release.

```sh
# REPORT is the installed report matching the reviewed live baseline pin.
# No provider key needed: captured-output replay + real-path stand-ins.
dev/evals/run_kit_release_eval.sh --installed-report "$REPORT" --replay
# Validate selection, reuse and cost without a provider call.
dev/evals/run_kit_release_eval.sh --installed-report "$REPORT" --dry-run
# Owner only, exported environment key: default is ten cases, not forty.
dev/evals/run_kit_release_eval.sh --installed-report "$REPORT" --cache "$BASELINE"
# Carry both baseline and successful smoke rows into the full comparison.
dev/evals/run_kit_release_eval.sh --installed-report "$REPORT" --full \
  --cache "$BASELINE" --cache "$SMOKE"
```

The first use of these pinned fixtures needs a one-time baseline bootstrap:
`--bootstrap-baseline --dry-run`, then owner-run `--bootstrap-baseline`.
Paid candidate testing refuses missing cached live rows, so the default smoke
cannot silently buy part of a second baseline. This generates only the forty live rows. Its capture becomes `$BASELINE` above.
When live source changes, review/update the existing baseline source/report pin
and bootstrap that source once. Old moving-date captures cannot be relabelled.

Fixture time is **2026-11-26 12:00 UTC**, including Python dates, SQL `now()`,
new-record defaults and memory timestamps. Pricing expiry remains real time.
Clock installation requires both disposable test flags. Weekly inputs retain
their explicit timezone; different weekly scenarios still cover both periods.

Cache identity includes each case, frozen clock/seed/helper source, all Python
app source for its variant and model/settings. Candidate or fixture changes
invalidate potentially affected answers. Candidate failures run again; live
failures remain historical baseline outcomes. Interrupted paid reservations
refuse automatic repayment and require owner reconciliation. Every reused row
records source capture/commit and its original evidence. Failed smoke candidates
block the full run. Successful smoke rows are reused, never bought twice.

`--replay` writes a private receipt for the exact committed HEAD after captured
replays and disposable stand-ins pass. A paid call refuses missing/stale receipts
before reading the key or building a container. `--dry-run` prints the same
selection/cost plan; it does not grant an offline receipt. Receipts and captures
land in the existing private evaluator output directory, mode 0600. Changing
HEAD requires offline replay again, even when paid rows can safely be reused.

Based on the observed $1.43/80-response gate, plan **$0.18 smoke + $0.54 remaining
candidate = $0.72** per release with a reusable baseline (about **50% saved**).
The first baseline costs about $0.72 once per live source/fixture contract.
An explicitly approved cold release can use `--budget-usd 1.80`; the default
remains $0.80. The cap covers baseline + smoke + remaining candidate calls,
including cached spending. With the observed $0.582174 baseline + $0.208383
smoke, thirty remaining candidates estimate $0.54, or $1.330557 total.
Repeat failed cases cost roughly $0.018 each. Estimates vary with provider usage;
preflight reserves $0.08 planning headroom and the ledger retains its padded
request reservations. A shared allowance counts prior spend across commits with identical whole-app
bytes and matching case inputs (including tooling-only changes) and
halts safely if it cannot fit the next reservation; no automatic budget increase.
An uncached run exceeding the selected allowance is refused. Each historical
reservation ID is counted once, even when later captures carry it forward. Cached baseline costs are historical, not
charged again. The wrapper automatically checks matching economy captures in its private output
directory, including partial/failed runs so prior spending is retained. Use repeated
`--cache` for captures moved elsewhere. Baseline bootstrap can exit nonzero for
existing live rejections; its captured outcomes remain reusable historical rows.
After any new commit, run `--replay` again for an exact-head receipt. Changing
only spend tooling preserves case keys; every app byte must match the captures.

```sh
# Approved batch continuation: cache paths may be repeated; matching private
# captures are also discovered automatically. Dry-run adds no provider calls.
dev/evals/run_kit_release_eval.sh --installed-report "$REPORT" --full \
  --budget-usd 1.80 --cache "$BASELINE" --cache "$SMOKE" --dry-run
```

Final continuation uses an explicit approved $1.80 release cap; the default
remains $0.80. The scoped `kit_release_replay.py` migration accepts the final
partial capture plus `--recovery-capture` from the original full gate. It proves
unchanged provider inputs and exact render-only changes, re-formats checked count
nouns, and rebuilds the missing recovery answer as a checked app fallback from
its original evidence. This is explicitly offline evidence, not a generated
model answer or human approval. Only the capped `load` question is omitted.
The resulting cache contains 79 rows, preserves $1.452946 prior spending, and
schedules one answer (estimated $0.018; expected release total $1.470946).
The disposable app receives the remaining $0.347054 for its actual padded
reservations; production caps are untouched. Run exact-head `--replay`, then
`--full --budget-usd 1.80 --cache "$REPLAYED" --dry-run` before owner continuation.
