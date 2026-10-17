# AI limits

Food photo/description, label and cooking requests have per-account UTC-day caps
stored in PostgreSQL. Restarting the app or running a second worker does not reset
them. A failed request consumes its request slot, including an ambiguous provider
failure; search, barcodes, recipes and manual logging still work.

All generated food/coaching calls share `KINETTA_AI_DAILY_USD` (default
`10`, USD per UTC day). Each primary attempt, retry and fallback reserves enough for
the supported model's entire input/output context **before** making the request.
Complete provider usage replaces that hold with estimated input + response +
thinking cost, rounded up to a microdollar. Missing usage, a timeout, invalid JSON
without usage, a crash or an HTTP failure keeps the hold: unknown bills are never
silently treated as free. This is deliberately conservative and may pause AI early.
Concurrent requests share the same database lock. Deleting an account removes its
identity from attempt records but does not refund the service's spent budget.

`KINETTA_AI_ENABLED=0` stops provider generation and the shared food request brake before provider work.
Only the literal `1` enables it. A zero/invalid dollar budget fails closed. New or
renamed models are blocked until their rates and context bounds are reviewed in
`app/ai_budget.py`; the bundled review expires January 1, 2027. No existing model,
prompt, temperature or output limit was changed.

Rates and context bounds checked October 17, 2026:

- [Google standard pricing](https://ai.google.dev/gemini-api/docs/pricing):
  Flash-Lite $0.25 input / $1.50 output per million; Flash uses its higher
  post-promotion $1.50 / $7.50 rates conservatively. Thinking counts as output.
- [Flash-Lite bounds](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)
  and [Flash bounds](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash):
  maximum 1,048,576 input and 65,536 output tokens per request.

These are estimated model costs, not an invoice guarantee or the provider's
billing controls. Keep provider-side spend alerts/limits as well. No free-tier
credits, caching discounts or promotions are assumed. The ledger stores model,
kind, timestamps and token/cost counts; no text, images, keys or food names.
Personal usage is included in export and protected by the existing read-only SQL
identity. The service total is operator-only.


## Shared provider boundary (#122 D follow-up)

All generated coach notes, weekly/food/recipe reviews, Kit tool-loop turns and
structured food estimates now use the same reservation ledger. The historical
`ai_food_attempts` table/export name remains compatible; it now includes coach
attempts. `KINETTA_AI_DAILY_USD` is the preferred service setting, falling back to
`KINETTA_FOOD_AI_DAILY_USD` for existing configuration. The default is now **$10**
to allow one full-context Claude reservation (the cap is a ceiling, not a spend
target). A smaller configured budget deliberately pauses models whose maximum
reservation cannot fit. Existing food prompts/models and coach prompts stay the same.

The supported Claude Opus 5.5 bound is 1,048,576 input /131,072 output tokens at
$4/$20 per million, checked against [Anthropic's model reference](https://platform.claude.com/docs/en/models/opus-5-5/overview)
on October 17, 2026. No cache is requested; any reported cache writes are charged
conservatively at twice the input rate. Invisible SDK retries and server-chosen
Claude model fallbacks are disabled: one ledger attempt must mean one priced
provider request. Gemini's explicit retry/fallback sequence is unchanged and every
attempt is reserved separately. The pricing-review expiry applies to every model.

Additional operator limits (zero pauses generation, invalid values fail closed):

| Setting | Default | Meaning |
| --- | ---: | --- |
| `KINETTA_AI_CONCURRENT` | 8 | Unfinished provider attempts across the service |
| `KINETTA_AI_USER_CONCURRENT` | 2 | Unfinished attempts for one account |
| `KINETTA_AI_DAILY_ATTEMPTS` | 2000 | Service provider attempts per UTC day |
| `KINETTA_AI_USER_DAILY_ATTEMPTS` | 120 | One account's attempts per UTC day |
| `KINETTA_AI_USER_DAILY_MICROUSD` | 10000000 | One account's reserved/estimated spend per UTC day ($10) |

A finished failure releases its concurrency slot while retaining its cost. A crash
leaves its slot occupied for at most two minutes, while the reservation still
counts for that UTC day. A response arriving later can settle once. These guards
are in PostgreSQL, including all workers and app restarts. A single short advisory
lock serializes cross-midnight reservations; network work stays outside it.

Paid Google Search grounding is paused. Google may execute several separately
billed searches in one request and the current transport has no enforceable query
bound. Packaged-food lookups continue through the existing USDA catalog. This
preserves the bounded food lookup path without claiming a prompt or billing alert
can enforce search spending. Re-enable grounding only after adding a provider-side
query bound and corresponding reservation/usage tests.

`KINETTA_AI_ENABLED=0` now also stops generated coaching, including automatic
post-import notes; existing notes and every non-AI feature remain readable. New
Kit tool features still require the separate reviewed evaluation report. No paid
provider calls or model-accuracy conclusions are part of this engineering change.

At 80% of the service's reserved/estimated daily spend the server prints one
payload-free budget warning per UTC day. This is an operator log warning, not a
phone alert; the hard reservation checks apply independently.

Operators can run `python -m app.ai_budget YYYY-MM-01` inside their app container
to obtain a monthly aggregate JSON report: daily attempts/tokens/estimated-or-held
cost by feature, food-attribution coverage, share of tracked foods needing no AI,
median allocated tokens per tracked food, recorded tokens per logged food and
estimated/held cost per logging-active account. Active means a food, activity or
weight was logged that month. One request's tokens are divided across its linked
foods. An unknown provider bill stays unknown; older food records without thread
links are explicitly unattributed. The final thread processor must bind its stable
message UUID to `ai_budget.scope` to connect estimates to food records. Do not use
incomplete coverage to claim the beta's 70% no-AI / zero-median target is met. This
report has no HTTP endpoint and returns no names, account IDs or food text.
