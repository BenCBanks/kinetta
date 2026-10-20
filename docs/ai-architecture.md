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

Legacy tool-based coach questions are disabled by default. Turning them on requires `KINETTA_COACH_TOOLS_ENABLED=1` and a private `KINETTA_AI_EVAL_REPORT` with owner review, a passing food comparison, coach factual/isolation checks and qualitative review. Its candidate fingerprint must match the actual code/prompts/models; a change invalidates it. The shared Kit conversation has its own gate, described below. Existing coach notes remain available while this work is evaluated.

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

Describe, Snap or Scan first matches the person's own foods (My Recipes, combinations, My foods, logged history) with fixed SQL and arithmetic and no provider work (`app/meal_chat.py`, `docs/conversational-meals.md`). Unknown food words are checked in the public food catalogs in one request; everyday foods then go to the existing model estimator automatically, named brands offer products to pick, and a photo goes to the estimator, all behind the usual food access/consent/usage checks. Catalog coverage and nutrition accuracy vary.
Adding a grounded lookup stage is a separate prompt/model change requiring the reviewed food evaluation process.

## Described branded products

Food descriptions still resolve against the authenticated person's saved records first. All new food words from one
message are looked up together through the authenticated `/api/food/meals-chat/lookup` read endpoint (the older
single-food `/products` endpoint stays for earlier app builds). It removes the spoken amount and classifies each food:
**brand** when a word is used more often as a brand than as a plain food name in the USDA results (Siggi's, Kodiak),
returning that brand's products closest to the words said; **plain** for everyday foods with USDA plain-food matches
("a banana" → Banana, raw); or **none**. A word that names plain foods is never taken as a brand, so "a banana" is not
offered banana-flavoured products. Open Food Facts is asked only when USDA has neither, because it is paced at about one
search every six seconds. Public queries contain food words only, with the existing provider cache and pacing; no
private recipe contents, history or identity is sent to the catalogs. Catalog completeness and accuracy are not
guaranteed. The person selects a product, checks the package/serving and confirms an amount using the normal
validated food-entry API. No new schema, arbitrary tools, prompts or model configuration are introduced.

Everyday unknown foods (plain or none) are sent together to the existing access/consent-gated food estimator
automatically, so describing a meal needs no extra tap. Named brands are never sent automatically; the person can
choose "Use an AI estimate instead". Without AI access the plain matches are offered to pick from.
Existing reviewed-evaluation release gates continue to apply to subsequent model or prompt changes.

Structured food estimate transports now reserve durable service budget before each
attempt and record token-only usage; per-account request brakes survive restarts.
See [AI budgets](ai-budgets.md) for pricing review and all-provider coverage.
Prompts, models and generation configuration are unchanged. The normal reviewed
evaluation gate still applies.

The shared provider budget now covers generated notes/reviews and each Kit turn as
well as food estimates. Durable attempt/concurrency/spend limits and the kill switch
run before provider work. Paid Google Search grounding is paused until its query
charges can be bounded; the USDA path remains. See [AI budgets](ai-budgets.md).
Claude's hidden SDK retries and unpriced server-side model fallback are disabled;
Gemini's existing explicit, individually reserved retry sequence remains. No prompt
or model selection was changed; real-provider acceptance and evaluation stay pending.

Food-thread Kit reuses the existing prompt/model and bounded tool runner with a smaller code-enforced allowlist (`profile`, `nutrition_summary`, `meal_options`, `meal_combinations`). Its profile excludes body/heart-rate data; no activity/weight/Health tools are callable, including forged tool calls. The current question alone is sent, never the code answer or entire thread. Consent is checked before each provider turn/tool and before storing. A durable per-message lease commits before provider work, retains a saved answer, and drops late results after cancellation or deletion. Suggestions remain pending until explicit backend-validated confirmation; food and neutral thread receipt commit together. The existing general Kit Health gate is retained; food-only questions need no separate Health disclosure consent because that scope cannot read stored Health data. The fingerprint covers the food entrypoint and deterministic routing, with a separate reviewed food-chat block required to enable it.

Evening food summaries were retired on 20 October 2026. Existing historical messages remain readable; new preferences cannot enable them and older-client generation requests return410. Nutrition insights now start through the shared Kit conversation.

Training-day targets use one deterministic day-goal calculation in the food log, calendar, insights and Kit meal options. Tools receive the calculated food calorie target only; raw workout, weight, age and plan records used by backend arithmetic are not added to food-only model responses or tool permissions. Normal targets, explicit day overrides and unknown-intake rules remain in force.

Food-chat household-portion recovery reuses the existing estimator when a plain catalog entry cannot convert an
explicitly described amount (for example two chicken tacos with only per-100g catalog nutrition). It sends the
completed food description, not the surrounding confusion/help conversation. Valid saved-food/catalog portions
keep their arithmetic; catalog data with missing required nutrition is not silently replaced. Named brands need
an explicit estimate request or product choice. Help sentences are handled without provider calls. Existing
access/consent/budget, strict source validation, cancellation/replay and final confirmation remain in force.
No model/prompt/grounding configuration or reviewed release gate changes; stand-ins test routing contracts, not
real estimate accuracy.

Food-chat routing pass (19 October 2026): when a sentence names several new foods and at least one has no amount,
the existing estimator receives that sentence as written (“2 eggs and toast”) instead of one request per word group,
and returns its usual per-food items. “Not sure” answers send “a typical serving of …” / “typical taco” to the same
estimator, and “how many calories in …” questions use the same review-only food path. Acknowledgements, cancel words,
bare amounts and corrections to unconfirmed cards are code-only and never reach a provider. No model, prompt,
grounding or budget configuration changed; stand-in tests check routing and wording, not estimate accuracy.

Food-chat understanding (19 October 2026, owner-approved): one small model call per text message, made before the
account lock and stored on the message so retries never pay twice, returns a validated reading (intent, foods with
only the amounts actually said, target, meal, question topic). Code acts on it with the existing own-food, catalog,
estimator, correction and review paths; the model supplies no nutrition and writes nothing. Amounts the model leaves
blank are recovered only from the person's own words. Its wording is shown for questions and small talk only when every
number in it was typed by the person or shown on the card, and never mentions calories. The model sees the message,
the previous message and the unconfirmed card's food names, not the log, Health data or other people. Disabled unless
`KINETTA_FOOD_CHAT_AI=1` and a reviewed `food_chat_understanding` report matches its fingerprint; otherwise, or on any
failure, consent/access/budget refusal or daily cap (300 messages), the code-only rules answer as before.

## App-wide Kit conversation (20 October 2026)

[The implementation decision record](kit-assistant.md) describes the shared chat. `kit_thread.py` binds identity before every read/write, stores UUID-idempotent turns and a conversation generation under RLS, and leases one turn before provider work. Model work holds no database transaction. Clear chat replaces the generation and removes turns; late responses and old-device sends cannot restore them. Expired work becomes visible Retry rather than automatically repeating paid calls. Export includes conversations/turns and account deletion cascades them.

`kit_tools.py` adds all-sport history, individual food records, saved recipes/custom foods/meal combinations (including incomplete records), all eight nutrition totals/averages, strength sets, goals, body settings, gear, resting energy and trusted app destinations. Fixed schemas reject identities, SQL, URLs and extra arguments. Date windows and page sizes bound reads; the existing read-only coach role and RLS apply. Health-sensitive tools require the existing explicit Health permissions. Food/general app questions remain possible without Health disclosure. Revoking Health consent removes sensitive previous answers from future model history and stops subsequent turns with sensitive evidence. Generation and consent are checked again before an answer is saved.

Only the latest six completed turns are sent as conversational context, capped per message; historical numbers are not fresh evidence. New measurements still need exact current tool references. Model-selected action IDs map to fixed app destinations, not arbitrary URLs. Existing plan/known-food proposals retain explicit backend confirmation; other changes use their normal app editors. Opening Kit or seeing starter prompts makes no model request.

The owner approved a separate Kit release gate on 20 October 2026. The app-wide prompt and conversation scope requires `KINETTA_KIT_ENABLED=1`, `KINETTA_KIT_EVAL_REPORT` pointing to its own reviewed report, and `ai_release.enabled('kit')`. The report must match `kit_fingerprint()`, compare the baseline, and cover at least40 reviewed Kit cases with zero unsupported numeric claims, isolation failures or Health disclosures, plus explicit conversation/qualitative review. Unrelated food-photo models and benchmarks do not enable or block Kit; existing food/food-chat release rules remain in force. Changes to its tools/conversation/prompt invalidate the fingerprint. Paid evaluation authorization does not itself enable the release gate; stand-ins never supply a passing private report.
