# Food-estimator limits

Food photo/description, label and cooking requests have per-account UTC-day caps
stored in PostgreSQL. Restarting the app or running a second worker does not reset
them. A failed request consumes its request slot, including an ambiguous provider
failure; search, barcodes, recipes and manual logging still work.

Structured food-estimator calls also share `KINETTA_FOOD_AI_DAILY_USD` (default
`5`, USD per UTC day). Each primary attempt, retry and fallback reserves enough for
the supported model's entire input/output context **before** making the request.
Complete provider usage replaces that hold with estimated input + response +
thinking cost, rounded up to a microdollar. Missing usage, a timeout, invalid JSON
without usage, a crash or an HTTP failure keeps the hold: unknown bills are never
silently treated as free. This is deliberately conservative and may pause AI early.
Concurrent requests share the same database lock. Deleting an account removes its
identity from attempt records but does not refund the service's spent budget.

`KINETTA_AI_ENABLED=0` stops the shared food request brake before provider work.
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

This foundation covers the shared structured food estimator. Grounded web product
search has a durable per-account request cap but its search-query charges and
separate coach transports still need the shared monetary reservation boundary
before this can be described as a cap on **all** service AI spending. The remaining
food-thread work must not claim that broader guarantee from this PR.
