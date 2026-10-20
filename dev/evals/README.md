# Kinetta AI evaluations

AI functionality is tested on Kinetta's own tasks, not chosen from generic provider rankings. No CI job calls a paid model.

`python3 dev/evals/check.py` runs 300 synthetic reference cases and tests that worse nutrition, product, portion, schema, latency and cost results fail comparison. These tests validate the scorer/gates; their perfect reference answers are not model predictions and do not measure AI accuracy. Categories: text, label text, barcode metadata, fictional restaurant menus and follow-up corrections, including fractional quantities. Human-reviewed photographed meals and actual label images are a separate release requirement.

`dev/tests/coach_incontainer.py` checks quantitative evidence references, unsupported values/paths, invented options, numerical claims outside evidence, loop bounds and consent. API tests prove real PostgreSQL RLS isolation, read-only tools, identity/SQL argument rejection, empty histories, stale proposals, explicit confirmation and idempotent replay. Semantic interpretations still need human review; evidence checks cannot prove every qualitative claim or causality.

## Capture a real benchmark

1. Build a reviewed, nonpersonal manifest with at least several hundred examples, including text, weighed-meal photos, labels, barcode products, restaurant portions and follow-up corrections. Every case needs reviewed calorie/protein/macros/grams and product names. Keep licensed image files beside the manifest; record provenance and review. Do not invent ground truth for unknown photo portions.
2. Use an isolated image of the current production revision, then an isolated image of the proposed revision. Supply the same manifest, a dedicated key, reviewed model prices, a request limit and an approved budget. The collector reads no account/health data.
3. Run `dev/evals/run.py` inside the isolated environment. It requires `--accept-paid-calls`, `--manifest`, `--output`, `--source-commit`, `--prices`, `--max-requests` and `--budget-usd`. The budget stops subsequent requests after observed spending; retries and the final call can add charges, so it is not a provider billing cap. Cost is an estimate from actual token usage at supplied prices. Partial runs are not valid release comparisons.
4. Compare complete saved results: `python3 dev/evals/compare.py /private/baseline.json /private/candidate.json --output /private/comparison.json`. Use the same reviewed dataset. Outputs stay private; publish only a sanitized summary or CI artifact when authorized.
5. Before deployment, review the comparison: no schema or large-error regression; no worse product/serving accuracy; calorie/protein MAE within the stated tolerance; latency/cost within 20%; every modality covered, with no skipped cases. Large errors currently mean more than the greater of 250 kcal or 50% of the known calorie total, or more than the greater of 25 g or 50% of known protein. These are explicit initial engineering thresholds for owner review.

The current production baseline has not been captured and there is no reviewed real-photo dataset yet. Legacy coach functionality and food prompt/model changes remain behind that release gate; the shared Kit conversation has the separate owner-approved gate below. A passing synthetic contract suite does not satisfy either gate. No model was called to create the reference fixtures.

## Private rollout report

The new coach needs `KINETTA_COACH_TOOLS_ENABLED=1` and `KINETTA_AI_EVAL_REPORT` pointing at a reviewed private JSON report. Fields: `reviewed: true`, `candidate_fingerprint` from `app.ai_release.fingerprint()`, the actual comparison under `food`, and `coach` with `case_count >= 30`, `unsupported_numeric_claims: 0`, `isolation_failures: 0`, `qualitative_review_passed: true`. These fields are completed from real recorded results and human review; do not create a passing report from the contract stand-ins. Any relevant code/prompt/model fingerprint change disables new questions until a matching reviewed comparison is supplied.

Food-chat Kit additionally requires `food_chat` in the same private report: `case_count >= 30`, `unsupported_numeric_claims: 0`, `isolation_failures: 0`, `health_disclosures: 0`, and `qualitative_review_passed: true`. Review food-only questions, unknown nutrients, reassurance, missing days, source/portion fidelity and proposed meals with the actual food-scoped tool runner. Include malicious tool/name content and activity/Health requests; no stored Health data may appear in that scope. A general coach report alone does not enable food-chat Kit. Tests exercise this contract with stand-ins; they do not supply a real passing report or measure model accuracy.

Evening food summaries and the optional daily Kit version were retired on 20 October 2026. Their older-client generation endpoint returns 410; historical notes remain readable. Shared Kit nutrition insights use the separate conversation gate below.

## Food-chat understanding (19 October 2026)

`app/food_thread_understand.py` reads what a food-chat message means (log, answer a question, correct, remove, move,
cancel, ask about the log or a food, chat) and which foods and amounts were said. Code does everything else. It is
off unless `KINETTA_FOOD_CHAT_AI=1` and the private report has `food_chat_understanding` with
`candidate_fingerprint` from `app.ai_release.understanding_fingerprint()`, `case_count >= 200`, `intent_accuracy >= 0.95`,
`invented_amounts: 0`, `reply_number_violations: 0`, `better_than_rules: true` and `qualitative_review_passed: true`.

`dev/evals/chat_cases.py` holds 212 fictional messages with the expected reading (setup messages build the card
first). `dev/evals/chat_eval.py` runs inside a throwaway app container: `CHAT_EVAL_MODE=rules` scores the code-only
chat for free; `CHAT_EVAL_MODE=ai` with `CHAT_EVAL_ACCEPT_PAID_CALLS=1` calls the real model through the normal budget
accounting, so the container's `KINETTA_AI_DAILY_USD` is a hard dollar cap. Results stay private.

First runs (gemini-3.1-flash-lite, 19 Oct 2026, fictional cases; later run after live fixes: 214/216, 0 invented): code-only rules 192/212 on a lenient intent+food-word
measure (no amounts checked); model 210/212 on the strict measure (intent 212/212, foods 137/138, invented amounts 0,
reply number violations 0), about $0.085 per full run. The case set was written by the same author as the rules, so it
favours them; the owner's qualitative review of real replies is still required before enabling.

## Shared Kit conversation

The app-wide assistant has its own owner-approved gate: `KINETTA_KIT_ENABLED=1` and `KINETTA_KIT_EVAL_REPORT` pointing at a reviewed report with a `candidate_fingerprint` matching `ai_release.kit_fingerprint()`. It requires a `kit` report block with `case_count >=40`, `unsupported_numeric_claims:0`, `isolation_failures:0`, `health_disclosures:0`, `conversation_review_passed:true` and `qualitative_review_passed:true`. The Kit block also requires `baseline_compared:true`; the report's top-level `reviewed:true` is set only after actual owner review. Existing food/food-chat report requirements remain separate and unchanged. Include all sports, strength, individual food records/unknown nutrients, goals, general diet/exercise education, multi-turn follow-ups, proposed changes and app actions, missing histories and injection/consent failures. Compare the current coach and candidate on the same fictional records and questions. Record real responses and token/cost/latency; schema/evidence pass is not proof of useful or medically sound advice. Owner review and physical-phone checks remain separate.

Session/memory revision: the Kit fingerprint also includes `kit_memory.py`. The previous ongoing-chat comparison does not approve fresh-visit memory behavior. Include multi-visit preference continuity, stale/conflicting statements, deletion/off during a running answer, independent devices, visit-close races, memory injection and Health consent changes in the next reviewed real-provider comparison. Synthetic visit/memory tests remain contract evidence only.

## Photo descriptions and ingredient mode

The optional photo `itemize` prompt variant is not approved by synthetic API/browser fixtures. Before rollout, compare production and candidate on the existing reviewed food benchmark, adding reviewed, nonpersonal mixed-food photos with known ingredients/portions (including subs, sauces, partial portions and multiple views). Review ingredient omissions, duplicated whole-food-plus-component calories, hidden-ingredient assumptions, totals, schemas, nutrition error, latency and cost under the existing criteria. Include an ordinary-photo control group: its prompt remains unchanged. No real-provider comparison or owner approval is supplied by this change. Food-photo release requirements remain separate from the app-wide Kit gate.

### Enforced ingredient rollout

Ingredient generation stays disabled until the existing `KINETTA_AI_EVAL_REPORT` has `reviewed: true`, the current `ai_release.fingerprint()` as `candidate_fingerprint`, and `food.passed: true` from the complete reviewed production/candidate food comparison above. This does not introduce a weaker or separate photo benchmark. The fingerprint includes photo estimation, composition, replacement and explanatory routing. Kit approval alone does not enable it. The backend rejects unreviewed ingredient requests before a provider call; `/api/me` hides the ingredient checkbox and reanalysis action. Photo descriptions and code-calculated explanations of existing rows remain available. Saved ingredient answers remain readable.

### Conversational gap exposed by photo follow-ups

Add food and app-wide Kit currently have different conversation paths. The food path routes logging/corrections/factual questions, with a short generic question fallback; its understanding prompt has no intent for explaining the current photo. It sees food names/amounts, not retained image pixels or a full description of why the estimate was made. A request to itemize a sub could therefore receive generic estimate guidance, and a single whole-sub row cannot support an honest invented ingredient split. This diagnosis is from source inspection, not a replay of a real user's private exchange.

This change addresses explicit photo breakdown requests with the selected card's actual rows, unknown-aware totals and assumptions. It does not establish general conversational ability. Before broadening the assistant, evaluate a common context/intent path for explain, clarify, edit and log: paraphrased ingredient questions, “why that much?”, references to bread/sauces, uncertainty, portion corrections, new foods, successive follow-ups and retries. Quantities still come from validated records/estimators, writes require confirmation, and missing visual context needs an honest request to reattach. Real response usefulness must be reviewed alongside accuracy and isolation.
