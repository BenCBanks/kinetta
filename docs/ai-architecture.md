# Kit: application tools, constrained planning and evidence

Product requirements agreed October 14, 2026.

## Structured data stays in PostgreSQL

Do not embed activity, food or weight rows in a vector database. Kit calls deterministic application tools and receives compact JSON. Date-range totals, averages and comparisons are computed by the application, not guessed by a model. A vector store is a later possibility for genuinely unstructured notes or race reports; none is introduced here.

The tool catalog covers profile units/targets, nutrition summaries, recent runs, individual activities, comparable routes, weight trend, training load, current plan, permissible plan options and known-food combinations. Nutrition summaries report logged versus unlogged days and average per logged day; an absent food day is not zero intake. Tools describe missing data and avoid pretending that all runs were intended to be easy or that correlations prove causes.

## Bound identity and read-only access

Tool schemas contain no SQL, user ID, credentials or URLs. Extra arguments are rejected. The server binds the authenticated account before calling a tool. Fixed SQL includes that identity and runs as the dedicated `fit_coach` role with a transaction-local RLS identity. Standalone model tools also use a read-only transaction and statement timeout. Confirmation validation uses the same restricted role within the locked application transaction, so concurrent retries cannot exhaust the pool by borrowing a second connection. Settings and roles are restored before pooled reuse. Existing SQL logins and the operator's separate read-all role are unaffected.

AI and Apple Health consent are checked before anything is sent to a provider. Tool loops are bounded by rounds and calls. Provider results preserve function IDs and Gemini thought signatures. Names and notes are untrusted data. Quantitative claims must reference exact successful tool-result paths and values; the application generates their labels and displayed numbers. Qualitative interpretation is separated from facts and still needs evaluation/human review.

## Adaptive planning is an engine plus AI

The current training engine builds the schedule, progression, paces and completion state. Algorithms produce allowed candidates from completed/missed sessions and recorded training load. AI selects a candidate ID and explains the choice; it never supplies a rewritten plan.

The first implemented adaptations are intentionally conservative: maintain the schedule or reduce upcoming unfinished sessions, optionally replacing hard work with easy effort. They cannot increase distance/intensity, change dates/rest days/race day, alter completed workouts or reclaim missed mileage. Repeated reductions have a floor against the original generated distance. Approved overrides are separate from the generator and are shown in the normal plan.

More extensive rescheduling around new available days, changes informed by expected pace/HR, and richer progression/recovery rules remain a separate reviewed phase. Those constraints need explicit definitions and fixture coverage before increasing the allowed action set. There is no nightly model-driven rewrite.

## Meal proposals use stored nutrition

The application reads remaining targets, own saved meals and commonly logged foods. It calculates portion macros and ranks single/pair combinations using those stored values. AI can choose/explain an existing combination, not invent calories, protein or serving weights. Allergy/preferences are not inferred from missing records.

No suggestions are inserted beneath meal cards. Recommendations are available only when the person asks Kit. The Add food UI cleanup remains a separate change.

## Review, then confirm

The app shows exactly what would change. A proposal is pending metadata, not a plan/food mutation. Confirmation requires an explicit true value, the same authenticated account, an unexpired proposal and a matching current-data fingerprint. The backend revalidates candidates and constraints under per-account confirmation locks. Stale or altered proposals are rejected. Confirmation is idempotent, including a lost network acknowledgement; food/plan changes and proposal status commit together.

## Evaluations before rollout

[dev/evals/README.md](../dev/evals/README.md) defines scoring, 300 synthetic reference contracts, real benchmark collection and baseline comparison. CI runs contract/regression checks and coach evidence/isolation/confirmation tests without paid model calls. Real photo accuracy is not claimed from fabricated ground truth or stand-in responses.

New Kit questions are disabled by default. Turning them on requires `KINETTA_COACH_TOOLS_ENABLED=1` and a private `KINETTA_AI_EVAL_REPORT` with owner review, a passing food comparison, coach factual/isolation checks and qualitative review. Its candidate fingerprint must match the actual code/prompts/models; a change invalidates it. Existing coach notes remain available while this work is evaluated.

Release requirements still outstanding: a reviewed multimodal dataset with known portions, captured production/candidate responses and model-specific prices, paid-run authorization, human review of qualitative claims and end-to-end real-provider validation. A synthetic CI pass does not satisfy that gate. Before any subsequent prompt/model rollout, compare it with the current production version on the same reviewed cases.

## Next engineering steps

1. Review and expand real reference fixtures, especially weighed meals/label images and source conflicts.
2. Run and review a bounded production-versus-candidate benchmark.
3. Validate real Gemini/Claude tool transport, refusals, timing/cost and useful answers, then enable the new feature explicitly.
4. Extend scheduling constraints and available-days support with deterministic tests; keep every write confirmation-only.

Technical references: [PostgreSQL roles](https://www.postgresql.org/docs/17/sql-set-role.html), [Gemini tool calls](https://ai.google.dev/api/generate-content), [Claude tool definitions](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools).

## Product access without making the app depend on AI

`app/ai_access.py` is the server boundary for product access. `food` covers model-powered food/label estimates and
ingredient interpretation; `coach` covers generated workout, weekly, food and recipe reviews and future Kit answers.
These capabilities are separate from provider availability, `ai_ok` consent, `health_ai_ok` consent, usage limits and
the reviewed-evaluation release gate. Access never implies consent and payment will never override a release gate.

`KINETTA_AI_ACCESS_MODE=open` is the default: existing installations keep their current access. A future hosted rollout
can explicitly choose `entitled`; only enabled, unexpired per-account feature records then allow new model work.
Unknown mode values fail closed. Migration 39 creates the RLS-protected access table with SELECT-only personal SQL
access. No profile field, model tool, client claim or public write endpoint can grant an entitlement. The server must
bind every future billing update to a verified account and validated provider event/transaction. There is no checkout,
price, trial clock or billing integration in this change; platform purchase rules need review when that is introduced.

Generation endpoints and automatic coaching check access before provider work. Requests without access receive a
clear 402 response, while cook ingredient input falls back to manual database selection. UI capabilities come from
`GET /api/me`; the server rechecks each generation request so stale client state cannot bypass revocation. Previously
saved user records/reviews remain readable. Feature access can expire without deleting plans, meals or logged data.

The non-AI product remains complete: direct food search, barcodes, known totals, custom foods, reusable Meals and
portion calculations, Health imports, activity detail/maps/social, ordinary training-engine plans, progress, gear and
profile/body settings do not depend on these grants. Deterministic application tools/proposal validation are separate
from billable model calls. New model features must choose an existing capability or deliberately extend this catalog,
with server-denial, consent, isolation and non-AI regression coverage.

Describe or snap first matches the person's own foods (saved meals, combinations, My foods, logged history) with fixed SQL and arithmetic and no provider work (`app/meal_chat.py`, `docs/conversational-meals.md`). Only the words of foods that weren't found, or a photo, go to the existing model estimator, behind the usual food access/consent/usage checks; it does **not** guarantee a USDA lookup.
Adding a grounded lookup stage is a separate prompt/model change requiring the reviewed food evaluation process.
