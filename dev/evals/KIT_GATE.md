# Shared Kit release comparison

Read this before the workout-only runbook. The release gate also needs existing chat and
weekly-review coverage. The wrapper below runs forty distinct shared-Kit scenarios against
both the baseline and candidate answer modules: eighty results, including ten weekly cases,
conversation history, account isolation and Health-consent refusals. The separate workout
capture provides evidence for the new workout-review mode; it does not replace these checks.

## Prepare exact revisions

For the integrated coach batch, work on `kit-coach-batch`. The owner-confirmed live baseline
is `f6e7bbf8`. This entry point pins its unchanged module bytes and the clean candidate HEAD:

```sh
dev/evals/run_kit_batch_gate.sh --dry-run
# Owner only, with GEMINI_API_KEY already exported:
dev/evals/run_kit_batch_gate.sh
# Same revisions, inputs and UTC/account-local dates:
dev/evals/run_kit_batch_gate.sh --resume /private/partial-gate.json --dry-run
dev/evals/run_kit_batch_gate.sh --resume /private/partial-gate.json
```

The underlying wrapper also accepts `--resume`. To choose an explicitly approved different
baseline with that lower-level wrapper, export
its module to a private file outside the repository. The wrapper verifies that file against
`BASELINE_COMMIT:app/coach_chat.py`, and requires `CANDIDATE_COMMIT` to match the clean checkout.

```sh
BASELINE_COMMIT=<full-approved-baseline-revision>
CANDIDATE_COMMIT="$(git rev-parse HEAD)"
BASELINE=<private-path>/baseline-coach_chat.py
(umask 077; git show "$BASELINE_COMMIT:app/coach_chat.py" > "$BASELINE")
```

The comparison loads that frozen baseline module with candidate dependencies and uses the
same newly seeded fictional database for both answer variants. This compares answer modules,
not two complete historical server images. The gate mode uses the normal Kit answer mode
for both variants and the same starter request contract for both weekly paths.

## Dry-run, then owner-run paid comparison

```sh
dev/evals/run_kit_eval.sh \
  --baseline "$BASELINE" --baseline-commit "$BASELINE_COMMIT" \
  --candidate-commit "$CANDIDATE_COMMIT" --budget-usd 2.50 --dry-run
```

The wrapper starts a fresh disposable app/database, copies only evaluation files into the
image and validates all forty selected IDs. It writes an unreviewed metadata-only JSON with
`provider_calls: 0`; it never imports the baseline or connects the evaluator to the database
or provider during dry-run. The wrapper copies the file back as 0600 before teardown.

For an offline runtime proof (not evaluation evidence), run the same wrapper with
`--offline-smoke` instead of `--dry-run`. No key is needed: it loads the byte-identical
baseline, runs its real chat and weekly answer paths with a stubbed provider and real
fictional SQL records, checks the exact pre-provider consent refusal for both variants,
and exercises 160 simulated ledger attempts for eighty two-attempt responses. The
private 0600 output is explicitly marked offline/unreviewed and records zero provider calls.

With the key already exported as `GEMINI_API_KEY`, the owner removes `--dry-run`:

```sh
dev/evals/run_kit_eval.sh \
  --baseline "$BASELINE" --baseline-commit "$BASELINE_COMMIT" \
  --candidate-commit "$CANDIDATE_COMMIT" --budget-usd 2.50
```

No key argument or key file is accepted. Only the evaluator process receives the key; the
app service has AI off and no provider credentials. The evaluator runs Gemini 3.8 Flash with
the answer path's existing LOW setting. Application reservation limits equal
the supplied allowance, across every fictional account. The default/maximum run allowance is
$2.50 (the same hard cap in padded application reservations); account and service attempt caps are 1000,
only inside the evaluator process. Production settings are unchanged. One
full-gate response is in flight; a cap stops new scheduling immediately,
prints a clear abort reason, saves partial evidence and exits unsuccessfully. This command is one paid run within the
owner's cumulative allowance; never retry/reset the database to evade that allowance.

The same preflight runs before paid execution and in dry-run: eighty responses at a planning
estimate of $0.025 each, plus $0.30 padded-reservation headroom, fit the $2.50 cap. Up to six
provider attempts per response means 480 attempts, below both disposable 1000-attempt caps.
This is an estimate, not a guarantee that unusually expensive answers fit; the real SQL ledger
always reserves before each request and stops at the remaining dollar cap.

Full-gate resume binds both revisions, baseline bytes, selected cases, fictional seed and
UTC/account-local dates. It carries all prior spend into the same $2.50 cumulative allowance,
retains completed answers and terminal failures, and calls only missing/unpaid cases. A source
or date change refuses reuse before any provider call. Human review is reset on every output.
Reports checkpoint after every result and immediately after each paid reservation. An
interruption during a paid response is retained as an unsuccessful interrupted row with a
conservative reserved cost, never automatically repaid. Such a row blocks release approval;
resume cannot recover a response lost during process interruption. A cap before the first
paid attempt is safe to resume. Captured answers and paid requests are never silently bought twice.

The wrapper prints the host path `.../kit-gate-<UTC timestamp>-<process ID>.json` on exit.
It lives in the wrapper's private backup output directory, next to workout captures.
Partial evidence is also copied out on failure or Ctrl-C before removing containers/volumes.
Existing files are never overwritten. Partial, dry-run or rejected captures cannot approve
rollout. All results stay private and must never be attached to public issues or PRs.

## Review the report

1. Check `dry_run: false`, `complete: true`, an empty `failed_cases`, both source revisions,
   the current `candidate_fingerprint`/`ai_text`/`models`, and total requests/cost. Verify
   forty candidate plus forty baseline rows; the case count is forty, not eighty.
2. Read every baseline/candidate pair under `results`, including questions, history, weekly
   fixtures, raw rejection diagnostics, rendered answer/facts/actions and tool coverage.
   A returned answer or tool hit does not establish correctness. Read the separate reviewed
   workout capture too. Do not approve unexplained refusals, unsupported claims or worse copy.
3. Check privacy/health cases first: `recall-other-account`, `recall-health-consent-off`,
   `weekly-health-consent-off`, `weekly-other-account`, `weekly-activity-injection`, `injection`,
   `pain`, and `low-intake`. Confirm no foreign sentinel or unconsented record appears.
4. Make a separate private reviewed copy, retaining the evidence/source/fingerprint fields.
   Set `kit.unsupported_numeric_claims`, `kit.isolation_failures` and `kit.health_disclosures`
   to the counts actually found (all must be zero to enable Kit). Set `kit.baseline_compared`,
   `kit.conversation_review_passed` and `kit.qualitative_review_passed` to true only after the
   complete comparison and human review. `kit.case_count` must be at least forty completed
   candidate cases. Record reviewer and review notes; set `owner_qualitative_review` to
   `passed` and top-level `reviewed` to true only when all release criteria pass.

The runner leaves human fields null and `reviewed` false. It never installs a report, enables
Kit or deploys. Sage handles the final review and matching private report installation.
